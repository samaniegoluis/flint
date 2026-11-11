// Tests of the landing's CLI demo. Run with `npm test` in site/ (node --test).
// The "matches the CLI" tests read the real CLI's source and docs, so a change to the
// CLI that forgets the demo fails here (CLAUDE.md rule 5, D-026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import seed from '../data/seed-vault.json' with { type: 'json' };
import { tokenize } from '../lib/args.ts';
import { COMMANDS, USAGE, runFlint, type Outcome } from '../lib/cli.ts';
import { ERROR_CODES } from '../lib/errors.ts';
import { runJq } from '../lib/jq.ts';
import { DemoSession, TOUR_STEPS, type Line } from '../lib/session.ts';
import { worldFromSeed, type World } from '../lib/vault.ts';

const repo = (p: string) => readFileSync(fileURLToPath(new URL('../../../../' + p, import.meta.url)), 'utf8');
const NOW = () => new Date(2026, 10, 5, 10, 42, 7);

/** Runs `flint <line>` against `world`, answering prompts in order. */
function flint(world: World, line: string, answers: string[] = []) {
	const out: string[] = [];
	const err: string[] = [];
	const notes: string[] = [];
	const asks: string[] = [];
	const t = tokenize(line);
	assert.ok('words' in t);
	const gen = runFlint(t.words, world, {
		out: (l) => out.push(l),
		err: (l) => err.push(l),
		note: (l) => notes.push(l),
		now: NOW,
	});
	let r = gen.next();
	while (!r.done) {
		asks.push(r.value.label);
		const a = answers.shift();
		assert.notEqual(a, undefined, `unexpected prompt: ${r.value.label}`);
		r = gen.next(a as string);
	}
	return { out, err, notes, asks, code: (r.value as Outcome).code, outcome: r.value as Outcome };
}

function session() {
	const lines: Line[] = [];
	const s = new DemoSession({ onLine: (l) => lines.push(l), now: NOW });
	s.start();
	return { s, lines, text: () => lines.map((l) => (l.kind === 'echo' ? l.prompt + l.text : l.text)) };
}

// ---- the demo matches the real CLI --------------------------------------------

test('help is the CLI usage text, word for word', () => {
	const main = repo('src/drivers/clicmd/run.cf');
	const m = main.match(/fn usage_text\(\) -> str \{\s*return `([\s\S]*?)`/);
	assert.ok(m, 'usage_text not found in run.cf');
	assert.equal(USAGE, m[1].replace(/\n$/, ''));
});

test('every command in the CLI reference exists in the demo', () => {
	const ref = repo('site/src/content/docs/reference/cli.md');
	const used = new Set<string>();
	for (const m of ref.matchAll(/^\| `([a-z][a-z-]*)(?: ([a-z-]+))?[ `]/gm)) {
		const [, noun, verb] = m;
		assert.ok(noun in COMMANDS, `\`flint ${noun}\` is in the CLI reference but not in the demo`);
		if (verb && COMMANDS[noun].length > 0) {
			assert.ok(COMMANDS[noun].includes(verb), `\`flint ${noun} ${verb}\` is in the CLI reference but not in the demo`);
		}
		used.add(noun);
	}
	assert.ok(used.size >= 8, 'the CLI reference tables were not found');
});

test('error codes are in the CLI exit-code order', () => {
	const errors = repo('src/domain/errors.cf');
	const list = errors.match(/fn known_error_codes\(\) -> \[\]str \{\s*return \[([^\]]*)\]/);
	assert.ok(list);
	const names = list[1].split(',').map((s) => s.trim());
	const values = names.map((n) => {
		const m = errors.match(new RegExp(`^${n}: str = "([a-z_]+)"`, 'm'));
		assert.ok(m, n);
		return m[1];
	});
	assert.deepEqual([...ERROR_CODES], values);
});

test('the demo knows every CLI flag', () => {
	const args = repo('src/drivers/clicmd/args.cf');
	const demo = readFileSync(fileURLToPath(new URL('../lib/args.ts', import.meta.url)), 'utf8');
	for (const fn of ['value_flags', 'bool_flags']) {
		const m = args.match(new RegExp(`fn ${fn}\\(\\) -> \\[\\]str \\{\\s*return \\[([^\\]]*)\\]`));
		assert.ok(m, fn);
		for (const flag of m[1].match(/"[^"]+"/g) ?? []) {
			assert.ok(demo.includes(`'${flag.slice(1, -1)}'`), `flag ${flag} missing from the demo`);
		}
	}
});

// ---- output, as the real CLI prints it -------------------------------------------

test('host list is the CLI table', () => {
	const r = flint(worldFromSeed(seed), 'host list');
	assert.equal(r.code, 0);
	assert.deepEqual(r.out, [
		'ALIAS    TYPE  TARGET                GROUP    TAGS',
		'bastion  ssh   jump@bastion.example  -        -',
		'db       ssh   admin@10.0.0.12       prod     postgres',
		'nas      ssh   pi@192.168.1.20       homelab  backup',
		'web-01   ssh   deploy@10.0.0.5       prod     nginx',
	]);
});

test('host show and --json carry no secret, only has_password', () => {
	const w = worldFromSeed(seed);
	const show = flint(w, 'host show db');
	assert.ok(show.out.includes('password       set'));
	const j = flint(w, 'host show db --json');
	assert.equal(
		j.out[0],
		'{"alias":"db","label":"","hostname":"10.0.0.12","port":22,"user":"admin","group":"prod","tags":["postgres"],"color":"#e8833a","notes":"","jump":"bastion","credential":"","key":"","has_password":true,"has_sudo_password":false,"command":"","keep_shell":true,"type":"ssh","domain":""}',
	);
});

test('host test walks the jump chain, never asks for a password, and prints the CLI line', () => {
	const w = worldFromSeed(seed);
	const r = flint(w, 'host test db', ['yes']);
	assert.equal(r.code, 0);
	assert.equal(r.asks.length, 1, 'only the unknown db key is asked about');
	assert.deepEqual(r.out, ["Connection to 'db' works: admin@10.0.0.12, host key verified, logged in (248 ms, through 1 jump host)."]);
	const j = flint(w, 'host test bastion --json');
	assert.deepEqual(j.out, ['{"host":"bastion","target":"jump@bastion.example","hops":1,"duration_ms":184}']);
	flint(w, 'host add bare --hostname 203.0.113.9 --user me');
	const bare = flint(w, 'host test bare --accept-new-host-key');
	assert.deepEqual([bare.code, bare.asks], [12, []]);
	assert.deepEqual(bare.err, ['flint: me@bare: no auth method was accepted (tried: SSH agent)']);
	assert.equal(flint(w, 'host test db -- true').code, 2);
});

test('a host keeps an initial command, shows it, and connect notes it unless --no-command', () => {
	const w = worldFromSeed(seed);
	const e = flint(w, 'host edit nas --command htop --json');
	assert.ok(e.out[0].endsWith('"has_sudo_password":false,"command":"htop","keep_shell":true,"type":"ssh","domain":""}'));
	assert.ok(flint(w, 'host show nas').out.includes('command        htop (then a login shell)'));
	flint(w, 'host edit nas --no-keep-shell');
	assert.ok(flint(w, 'host show nas').out.includes('command        htop (ends the session)'));
	assert.equal(flint(w, 'host edit nas --keep-shell --no-keep-shell').code, 2);
	const c = flint(w, 'connect nas', ['yes']);
	assert.equal(c.code, 0);
	assert.ok(c.notes.some((n) => n.includes('runs `htop` on nas')));
	assert.deepEqual(flint(w, 'connect nas --no-command').notes, []);
	assert.equal(flint(w, 'host edit nas --command ""').code, 0);
	assert.ok(flint(w, 'host show nas').out.includes('command        -'));
});

/** A world whose terminal Flint has already allowed (milestone 12). */
function allowed(): World {
	const w = worldFromSeed(seed);
	w.approved = true;
	return w;
}

test('the first command waits for Flint to allow this terminal, once until a lock', () => {
	const w = worldFromSeed(seed);
	const a = flint(w, 'host list');
	assert.deepEqual(a.err, ['Waiting for approval in Flint (flint, started by Terminal)…']);
	assert.equal(a.code, 0);
	assert.deepEqual(flint(w, 'host list').err, []);
	assert.equal(flint(worldFromSeed(seed), 'host list --json').err.length, 0, '--json waits silently');
	flint(w, 'vault lock');
	flint(w, 'vault unlock');
	assert.equal(flint(w, 'host list').err.length, 1, 'a lock ends the grant');
});

test('errors use the CLI message, JSON envelope and exit code', () => {
	const w = allowed();
	const a = flint(w, 'host show nope');
	assert.deepEqual([a.err, a.code], [["flint: no host 'nope'"], 3]);
	const b = flint(w, 'host show nope --json');
	assert.deepEqual([b.err, b.code], [['{"error":{"code":"not_found","message":"no host \'nope\'"}}'], 3]);
	assert.deepEqual(flint(w, 'foo').err, ["flint: unknown command 'foo'; see `flint help`"]);
	assert.deepEqual(flint(w, 'host').err, ['flint: `flint host` needs a command; see `flint help`']);
	assert.deepEqual(flint(w, 'host add bad --hostname').err, ['flint: --hostname needs a value']);
	assert.deepEqual(flint(w, 'host add db --hostname 1.2.3.4').code, 4);
	assert.deepEqual(flint(w, 'host rm bastion').err, ["flint: host 'db' uses 'bastion' as its jump host"]);
	assert.deepEqual(flint(w, 'group rm prod').err, ["flint: group 'prod' is not empty (2 hosts, 0 subgroups)"]);
	assert.deepEqual(flint(w, 'exec db').code, 2);
	assert.equal(flint(w, 'host add x --hostname a --password-stdin').code, 2);
});

test('host add asks for the password with echo off and never prints it', () => {
	const w = worldFromSeed(seed);
	const r = flint(w, 'host add my-server --hostname 203.0.113.10 --user me --password', ['hunter2-secret']);
	assert.deepEqual(r.asks, ['host password: ']);
	assert.deepEqual(r.out, ["Added host 'my-server' (me@203.0.113.10)."]);
	const j = flint(w, 'host list --json');
	assert.ok(!j.out.join('').includes('hunter2-secret'));
	assert.ok(j.out[0].includes('"alias":"my-server"') && j.out[0].includes('"has_password":true'));
});

test('a vault not unlocked in Flint asks for its master password for each command', () => {
	const w = worldFromSeed(seed);
	flint(w, 'vault use Work');
	assert.deepEqual(flint(w, 'vault status').out, ['vault  Work', 'path   /home/you/OneDrive/work.flint', 'state  locked (unlock it in Flint, or pass --master-stdin)']);
	const first = flint(w, 'host list', ['any password']);
	assert.deepEqual(first.asks, ["Master password for 'Work': "]);
	assert.equal(first.out.length, 3);
	assert.deepEqual(flint(w, 'host list', ['again']).asks, ["Master password for 'Work': "]);
});

test('vault status says how long the activity log keeps entries', () => {
	const w = worldFromSeed(seed);
	const st = flint(w, 'vault status');
	assert.equal(st.out[st.out.length - 1], 'activity     kept 90 days');
	assert.ok(flint(w, 'vault status --json').out[0].includes('"activity_days":90'));
});

test('vault unlock asks Flint, which holds one vault at a time; vault lock locks it', () => {
	const w = worldFromSeed(seed);
	const u = flint(w, 'vault unlock --vault Work');
	assert.deepEqual(u.out, ["Unlocked vault 'Work' in Flint. Commands use it until Flint locks it."]);
	assert.ok(u.err.some((l) => l.includes("Flint is asking for the master password of 'Work'")));
	assert.deepEqual(flint(w, '--vault Work host list').asks, []);
	assert.ok(flint(w, 'vault status --json').out[0].includes('"unlocked":false'));
	assert.equal(flint(w, 'vault lock --vault Work').out[0], "Locked vault 'Work': Flint holds no key for it and none is cached on this machine.");
	assert.deepEqual(flint(w, '--vault Work host list', ['pw']).asks, ["Master password for 'Work': "]);
});

test('vault rename renames the current vault and refuses a name in use', () => {
	const w = worldFromSeed(seed);
	assert.deepEqual(flint(w, 'vault rename "Home Lab"').out, ["Renamed vault 'Demo' to 'Home Lab'."]);
	assert.ok(flint(w, 'vault list').out.some((l) => /^\*\s+Home Lab/.test(l)));
	const j = flint(w, 'vault rename Lab --json');
	assert.ok(j.out[0].includes('"name":"Lab"'));
	const taken = flint(w, 'vault rename work');
	assert.equal(taken.code, 4);
	assert.equal(flint(w, 'vault rename').code, 2);
});

test('token create is approved in Flint, prints the token once, and list and revoke follow the CLI', () => {
	const w = worldFromSeed(seed);
	const made = flint(w, 'token create --name nightly --allow exec --hosts nas,@prod --ttl 30d');
	assert.equal(made.code, 0);
	assert.equal(made.out.length, 1, 'only the token on stdout');
	assert.match(made.out[0], /^flint_[0-9a-f]{16}_[0-9a-f]{64}$/);
	assert.ok(made.err.includes('Waiting for approval in Flint (flint, started by Terminal)…'), 'Flint asks for every token');
	assert.match(made.err.find((l) => l.startsWith('Created')) ?? '', /^Created token 'nightly' \(exec on nas, @prod\), until \d{4}-\d\d-\d\d \d\d:\d\d UTC\.$/);
	assert.ok(made.err.includes('Flint shows it this once, above. Give it to the program in the FLINT_TOKEN environment variable.'));
	const list = flint(w, 'token list');
	assert.match(list.out[0], /^ID\s+NAME\s+ALLOWS\s+REACHES\s+STATUS\s+UNTIL$/);
	assert.ok(list.out[1].includes('nightly') && list.out[1].includes('active'));
	const j = JSON.parse(flint(w, 'token list --json').out[0]);
	assert.equal(j[0].name, 'nightly');
	assert.ok(!JSON.stringify(j).includes(made.out[0]), 'the list never carries the token');
	assert.equal(flint(w, 'token create --name nightly --allow read').code, 4, 'a live name is taken');
	assert.equal(flint(w, 'token create --name x --allow exec').code, 2, 'exec needs hosts');
	assert.equal(flint(w, 'token create --name x --allow write --hosts nas').code, 7, 'write needs --all');
	assert.equal(flint(w, 'token create --name x --allow exec --hosts ghost').code, 3);
	assert.deepEqual(flint(w, 'token revoke nightly').out, [`Revoked token 'nightly' (${j[0].id}). A program that uses it is refused from now on.`]);
	assert.ok(flint(w, 'token list').out[1].includes('revoked'));
	assert.equal(flint(w, 'token revoke nightly').code, 3, 'a revoked token is found by id only');
	const work = flint(w, 'token create --vault Work --name x --allow read');
	assert.equal(work.code, 5, 'a vault not unlocked in Flint cannot make tokens');
});

test('exec --sudo is approved in Flint and runs as root; the sudo password is never shown', () => {
	const w = worldFromSeed(seed);
	const r = flint(w, 'exec web-01 --accept-new-host-key --sudo -- whoami');
	assert.equal(r.code, 0);
	assert.deepEqual(r.out, ['root']);
	assert.ok(r.err.includes('Waiting for approval in Flint (flint, started by Terminal)…'), 'Flint asks for every sudo command');
	assert.equal(flint(w, 'exec web-01 --sudo -- ').code, 2, 'no command is a usage error');
	assert.equal(flint(w, 'exec ghost --sudo -- id').code, 3);
	assert.equal(flint(w, 'exec web-01 --vault Work --sudo -- id').code, 5, 'a vault not unlocked in Flint runs no sudo');
	const shown = flint(w, 'host show web-01');
	assert.ok(shown.out.some((l) => /^sudo password\s+the login password$/.test(l)));
	assert.equal(JSON.parse(flint(w, 'host show web-01 --json').out[0]).has_sudo_password, false);
});

test('the landing shows what the demo CLI prints (D-027)', () => {
	const landing = readFileSync(fileURLToPath(new URL('../../content/docs/index.mdx', import.meta.url)), 'utf8');
	const w = worldFromSeed(seed);
	for (const line of flint(w, 'host list').out) assert.ok(landing.includes(line), `landing lacks: ${line}`);
	const r = flint(w, 'exec web-01 --accept-new-host-key --json -- uptime');
	const pretty = runJq(['.'], r.out).lines.map((l) => l.map((p) => p.text).join(''));
	for (const line of pretty) assert.ok(landing.includes(line), `landing lacks: ${line}`);
});

test('exec asks to trust an unknown server key, then runs the command', () => {
	const w = allowed();
	const r = flint(w, 'exec web-01 -- uptime', ['yes']);
	assert.equal(r.asks.length, 1);
	assert.match(r.asks[0], /^The host 'web-01' \(10\.0\.0\.5\) is not known yet\.\nssh-ed25519 key fingerprint is SHA256:\S{43}\.\nTrust this key/);
	assert.deepEqual(r.out, [' 10:42:07 up 41 days,  2:17,  1 user,  load average: 0.08, 0.05, 0.01']);
	assert.equal(flint(w, 'exec web-01 -- uptime').asks.length, 0, 'the key is recorded');
	const no = flint(allowed(), 'exec web-01 -- uptime', ['no']);
	assert.deepEqual([no.err, no.code], [["flint: the host key of 'web-01' was not trusted"], 11]);
	const j = flint(w, 'exec web-01 --json -- cat nope');
	assert.equal(j.code, 1);
	assert.equal(j.out[0], '{"host":"web-01","exit_code":1,"signal":"","stdout":"","stderr":"cat: nope: No such file or directory\\n","duration_ms":214}');
});

test('cp copies to and from a host as the CLI places files, with its errors and JSON', () => {
	const w = allowed();
	const up = flint(w, 'cp ./app.conf web-01:app/ --accept-new-host-key');
	assert.equal(up.code, 0);
	assert.deepEqual(up.out, ['Copied 1 file (20 B) to web-01:app/app.conf in 220 ms.']);
	assert.ok(up.notes.some((n) => n.includes('copies nothing')));
	const j = flint(w, 'cp --json -r ./site web-01:/tmp/');
	assert.equal(j.out[0], '{"host":"web-01","to_host":"","direction":"upload","files":[{"source":"./site/css/site.css","target":"/tmp/site/css/site.css","bytes":34},{"source":"./site/index.html","target":"/tmp/site/index.html","bytes":18}],"folders":2,"bytes":52,"skipped":[],"duration_ms":260}');
	const down = flint(w, 'cp web-01:/var/log/syslog .');
	assert.deepEqual([down.code, down.out[0].startsWith('Copied 1 file (') && down.out[0].endsWith(' to syslog in 220 ms.')], [0, true]);
	assert.equal(flint(w, 'cp web-01:notes.txt ./app.conf').code, 20, 'an existing file needs --force');
	assert.equal(flint(w, 'cp --force web-01:notes.txt ./app.conf').code, 0);
	assert.equal(flint(w, 'cp ./site web-01:/tmp/').code, 7, 'a folder needs -r');
	assert.equal(flint(w, 'cp ./nope web-01:/tmp/').code, 3);
	assert.equal(flint(w, 'cp ./app.conf web-01:/etc/hostname/x').code, 21);
	assert.equal(flint(w, 'cp ./a ./b').code, 2);
	assert.equal(flint(w, 'cp ./app.conf ghost:/tmp/').code, 3);
	const e = flint(w, 'cp ./app.conf web-01:notes.txt --json');
	assert.deepEqual(e.err, ['{"error":{"code":"exists","message":"notes.txt on the host already exists; pass --force to replace it"}}']);
});

test('cp copies from one host to another, naming each host, as milestone 18 does', () => {
	const w = allowed();
	const r = flint(w, 'cp web-01:/var/log/syslog nas:/tmp/ --accept-new-host-key');
	assert.equal(r.code, 0);
	assert.ok(r.out[0].startsWith('Copied 1 file (') && r.out[0].endsWith(' from web-01:/var/log/syslog to nas:/tmp/syslog in 220 ms.'), r.out[0]);
	assert.ok(r.notes.some((n) => n.includes('no key or password goes to a host')));
	const j = flint(w, 'cp --json web-01:/var/log/syslog nas:/tmp/');
	const d = JSON.parse(j.out[0]);
	assert.deepEqual([d.host, d.to_host, d.direction], ['web-01', 'nas', 'relay']);
	const ex = flint(w, 'cp --json web-01:/etc/hostname nas:/etc/');
	assert.deepEqual([ex.code, JSON.parse(ex.err[0]).error.message], [20, '/etc/hostname on nas already exists; pass --force to replace it']);
	assert.equal(flint(w, 'cp web-01:/var/log nas:/tmp/').code, 7, 'a folder needs -r');
	assert.equal(flint(w, 'cp web-01:/nope nas:/tmp/').code, 3);
	assert.equal(flint(w, 'cp web-01:/etc/hostname ghost:/tmp/').code, 3);
});

test('a host with no user is refused, as connect.cf does', () => {
	const w = worldFromSeed(seed);
	flint(w, 'host add bare --hostname 198.51.100.4');
	const r = flint(w, 'connect bare');
	assert.deepEqual(r.err, ["flint: host 'bare' has no user; set one with `flint host edit bare --user <user>` or link a credential"]);
	assert.equal(r.code, 7);
});

test('commands that need local files explain themselves instead', () => {
	const r = flint(worldFromSeed(seed), 'vault create ~/x.flint');
	assert.equal(r.code, 0);
	assert.match(r.notes[0], /vault create.*leaves it out/);
});

test('there is no import command (milestone 24)', () => {
	const r = flint(worldFromSeed(seed), 'import tether ~/vault.tether');
	assert.deepEqual(r.err, ["flint: unknown command 'import'; see `flint help`"]);
	assert.equal(r.code, 2);
});

// ---- tunnels (milestone 22) ----------------------------------------------------------

test('tunnels are saved in a host and run in Flint, as tunnel_commands.cf', () => {
	const w = worldFromSeed(seed);
	let r = flint(w, 'tunnel ls');
	assert.equal(r.code, 0);
	assert.ok(r.out[0].startsWith('TUNNEL'));
	assert.ok(r.out[1].includes('db:postgres') && r.out[1].includes('localhost:5432') && r.out[1].includes('stopped'));
	r = flint(w, 'tunnel add web-01 app --local 8080 --to 127.0.0.1:3000');
	assert.deepEqual(r.out, ["Added tunnel 'web-01:app': 127.0.0.1:8080 to 127.0.0.1:3000 as web-01 sees it."]);
	assert.equal(flint(w, 'tunnel add web-01 APP --local 1').code, 4);
	assert.equal(flint(w, 'tunnel add web-01 x --local 70000').code, 7);
	assert.equal(flint(w, 'tunnel add web-01 x').code, 2);
	assert.equal(flint(w, 'tunnel up web-01').code, 2);
	r = flint(w, 'tunnel up db:postgres --accept-new-host-key');
	assert.equal(r.code, 0);
	assert.deepEqual(r.out, ["Tunnel 'db:postgres' is listening on 127.0.0.1:5432, to localhost:5432 as db sees it. It runs in Flint until `flint tunnel down db:postgres`."]);
	r = flint(w, 'tunnel status --json');
	assert.deepEqual(JSON.parse(r.out[0]).map((t: { name: string; state: string }) => [t.name, t.state]), [['postgres', 'listening']]);
	flint(w, 'tunnel add nas pg --local 5432');
	r = flint(w, 'tunnel up nas:pg --json --accept-new-host-key');
	assert.equal(r.code, 22);
	assert.equal(JSON.parse(r.err[0]).error.code, 'port_in_use');
	r = flint(w, 'tunnel down db:postgres');
	assert.deepEqual(r.out, ["Tunnel 'db:postgres' is stopped."]);
	r = flint(w, 'tunnel rm web-01:app --json');
	assert.deepEqual(JSON.parse(r.out[0]), { removed: 'tunnel', name: 'web-01:app' });
	assert.equal(flint(w, 'tunnel rm web-01:app').code, 3);
	// The Work vault is locked: tunnels need Flint with it unlocked.
	r = flint(w, '--vault Work tunnel status');
	assert.equal(r.code, 5);
	assert.ok(r.err[0].includes('runs only through Flint'));
});

// ---- the session: prompts, remote shell, tour -------------------------------------

test('the tour runs end to end on its suggested commands', () => {
	const { s, text } = session();
	for (let i = 0; i < TOUR_STEPS.length; i++) {
		assert.equal(s.tourStep, i);
		const run = TOUR_STEPS[i].run;
		assert.ok(s.chips().includes(run), `step ${i + 1}: its command is not offered as a chip`);
		s.submit(run);
		if (i === 3 || i === 5) s.submit('yes'); // trust web-01, then db (its tunnel)
		if (i === 6) {
			s.submit('ls');
			s.submit('cat notes.txt');
		}
		if (i === 8) s.submit('pw-typed-in-the-demo');
	}
	assert.equal(s.tourStep, null);
	const all = text().join('\n');
	assert.ok(all.includes("# That's the tour."));
	assert.ok(all.includes('admin@10.0.0.12:~$ ls'));
	assert.ok(all.includes('app/  backups/  notes.txt'));
	assert.ok(!all.includes('pw-typed-in-the-demo'), 'a secret was echoed');
});

test('connect opens the shared fake Linux under the host user, and exit returns', () => {
	const { s, text } = session();
	s.stopTour();
	s.submit('flint connect nas');
	assert.equal(s.prompt().text.startsWith('The host'), false, 'nas is unknown: its key prompt is the last line');
	s.submit('yes');
	assert.equal(s.prompt().text, 'pi@192.168.1.20:~$ ');
	s.submit('cd app');
	s.submit('pwd');
	s.submit('whoami');
	s.submit('exit');
	assert.equal(s.prompt().text, '❯ ');
	const t = text();
	assert.ok(t.includes('/home/pi/app'));
	assert.ok(t.includes('pi'));
	assert.ok(t.includes('logout'));
});

test('connect --json prints the session end after exit', () => {
	const { s, text } = session();
	s.submit('flint --json connect bastion');
	s.submit('exit');
	assert.ok(text().includes('{"host":"bastion","exit_code":0}'));
});

test('Ctrl-C cancels a prompt', () => {
	const { s } = session();
	s.submit('flint host add x --hostname 1.2.3.4 --password');
	assert.deepEqual(s.prompt(), { text: 'host password: ', secret: true });
	s.interrupt('abc');
	assert.equal(s.prompt().text, '❯ ');
	assert.equal(flint(s.world, 'host show x').code, 3, 'nothing was added');
});

test('Tab completes nouns, verbs and aliases', () => {
	const { s } = session();
	assert.equal(s.complete('fl'), 'flint ');
	assert.equal(s.complete('flint ho'), 'flint host ');
	assert.equal(s.complete('flint host sh'), 'flint host show ');
	assert.equal(s.complete('flint connect we'), 'flint connect web-01 ');
});

test('the shell tokenizer refuses pipes and keeps quotes', () => {
	assert.deepEqual(tokenize(`flint host add a --notes "two words" --label 'x y'`), {
		words: ['flint', 'host', 'add', 'a', '--notes', 'two words', '--label', 'x y'],
	});
	assert.deepEqual(tokenize('flint host list --json | jq -r .[].alias'), {
		words: ['flint', 'host', 'list', '--json'],
		pipe: ['jq', '-r', '.[].alias'],
	});
	assert.ok('error' in tokenize('flint host list | jq | jq'));
	assert.ok('error' in tokenize('flint host list > out.txt'));
});

test('the guide always says what to do, with the exact command', () => {
	const { s, text } = session();
	assert.deepEqual(s.guide(), { text: 'Step 1/14 · Every command, on one screen:', command: 'flint help' });
	assert.ok(text().includes('#   flint help'), 'the step hint in the log carries its command');
	s.submit('flint');
	assert.equal(s.tourStep, 1, '`flint` alone shows the help, so it completes step 1');
	s.submit('flint list');
	assert.equal(s.tourStep, 1);
	assert.deepEqual(text().slice(-2), ['# Not quite. For this step, type:', '#   flint host list']);
	assert.equal(s.guide().command, 'flint host list');
	s.submit('flint host add x --hostname 1.2.3.4 --password');
	assert.match(s.guide().text, /^Type any password/);
	s.submit('pw');
	s.submit('flint connect nas');
	assert.equal(s.guide().command, 'yes');
	s.submit('yes');
	assert.equal(s.guide().command, 'exit', 'on a server outside its tour step, the guide says how to leave');
	s.submit('exit');
	s.stopTour();
	assert.equal(s.guide().command, 'flint help', 'with the tour off, the guide still points somewhere');
});

test('jq formats, picks fields and refuses what the demo lacks', () => {
	const text = (r: ReturnType<typeof runJq>) => r.lines.map((l) => l.map((p) => p.text).join(''));
	const input = ['[{"alias":"db","port":22,"tags":["pg"],"jump":null}]'];
	assert.deepEqual(text(runJq([], input)), [
		'[',
		'  {',
		'    "alias": "db",',
		'    "port": 22,',
		'    "tags": [',
		'      "pg"',
		'    ],',
		'    "jump": null',
		'  }',
		']',
	]);
	assert.equal(runJq(['.'], input).lines[2][1].cls, 'key');
	assert.deepEqual(text(runJq(['-r', '.[].alias'], input)), ['db']);
	assert.deepEqual(text(runJq(['.[].alias'], input)), ['"db"']);
	assert.deepEqual(text(runJq(['length'], input)), ['1']);
	assert.deepEqual(text(runJq(['-c', '.[0].tags'], input)), ['["pg"]']);
	assert.equal(runJq(['map(.alias)'], input).code, 3);
	assert.equal(runJq(['.'], ['ALIAS  TARGET']).code, 2);
});

test('the session pipes flint into jq and offers it once as a tip', () => {
	const { s, lines, text } = session();
	s.stopTour();
	s.submit('flint host list --json');
	assert.ok(text().includes('#   flint host list --json | jq'), 'the tip names the exact command');
	assert.ok(s.chips().includes('flint host list --json | jq'));
	s.submit('flint host show db --json');
	assert.equal(text().filter((t) => t.startsWith('# Tip: JSON')).length, 1, 'the tip shows once');
	s.submit('flint host list --json | jq -r .[].alias');
	assert.deepEqual(text().slice(-4), ['bastion', 'db', 'nas', 'web-01']);
	s.submit('flint host show db --json | jq');
	assert.ok(lines.some((l) => l.parts?.some((p) => p.cls === 'key' && p.text === '"alias"')));
	s.submit('flint host list | grep db');
	assert.ok(text().includes('zsh: command not found: grep'));
	assert.equal(s.complete('flint host list --json | j'), 'flint host list --json | jq ');
});

test('an RDP host: --type rdp, port 3389, a domain, refused where only SSH works', () => {
	const w = allowed();
	const a = flint(w, 'host add win-01 --type rdp --hostname 10.0.0.50 --user admin --domain CORP --json');
	assert.equal(a.code, 0);
	const v = JSON.parse(a.out[0]);
	assert.deepEqual([v.type, v.port, v.domain], ['rdp', 3389, 'CORP']);
	assert.ok(flint(w, 'host list').out.some((l) => /^win-01\s+rdp\s+CORP\\admin@10\.0\.0\.50/.test(l)));
	assert.ok(flint(w, 'host show win-01').out.includes('domain      CORP'));
	assert.equal(flint(w, 'host add k --type rdp --hostname x --key laptop').code, 7);
	assert.equal(flint(w, 'host add v --type vnc --hostname x').code, 7);
	assert.equal(flint(w, 'host edit web-01 --domain CORP').code, 7);
	const flip = flint(w, 'host edit win-01 --type ssh');
	assert.equal(flip.code, 7);
	assert.ok(flip.err.join('\n').includes('cannot change'));
	const ex = flint(w, 'exec win-01 -- uptime');
	assert.equal(ex.code, 23);
	assert.ok(ex.err.join('\n').includes("'win-01' is an RDP host; flint exec needs an SSH host"));
	assert.equal(flint(w, 'connect win-01').code, 23);
	assert.equal(flint(w, 'host test win-01').code, 23);
	assert.equal(flint(w, 'cp ./notes.txt win-01:/tmp/').code, 23);
	assert.equal(flint(w, 'tunnel add win-01 t --local 13389').code, 23);
	assert.equal(flint(w, 'host edit web-01 --jump win-01').code, 23);
});
