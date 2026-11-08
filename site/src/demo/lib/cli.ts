// The simulated `flint` command. Each handler mirrors src/drivers/clicmd/*.cf: the same
// flags, messages, JSON shapes, error codes and exit codes. A command that needs the
// person (a password, a host key answer) yields an Ask and resumes with the answer.
import { FlintError, exitCodeFor, fail } from './errors.ts';
import { ParsedArgs, parseFlintArgs, parsePort, parseSeconds, wantsJson } from './args.ts';
import { dash, fields, hostTarget, json, table, yesNo } from './format.ts';
import { RemoteShell } from './remote.ts';
import {
	VaultOps, credView, hostView, keyView, serverKeyFor, tokenAllows, tokenReach, tokenStatus, tokenView, utcText,
	type CredPatch, type Host, type HostPatch, type TokenRequest, type Vault, type World,
} from './vault.ts';

export interface Ask {
	/** What the prompt shows; lines before the last one print as output. */
	label: string;
	/** Typed characters are hidden, as with echo off. */
	secret: boolean;
}

export interface Outcome {
	code: number;
	/** Set by `flint connect`: the demo opens this host's fake shell. */
	connect?: { alias: string; user: string; hostname: string; json: boolean };
}

export interface Io {
	out(line: string): void;
	err(line: string): void;
	/** A demo-only remark, styled apart from the CLI's own output. */
	note(line: string, href?: string): void;
	now(): Date;
}

export type Run = Generator<Ask, Outcome, string>;

export const USAGE = `flint - SSH client over one encrypted vault

Usage: flint [--json] [--vault <name|path>] <command> [args] [flags]

Vaults
  vault create <path> [--name <name>]   Create a vault (asks for a master password)
  vault open <path>                     Open an existing vault and make it current
  vault list                            Recent vaults; * marks the current one
  vault use <name|path>                 Make a recent vault the current one
  vault status                          Path, lock state and counts
  vault unlock                          Ask Flint to unlock the vault, and wait
  vault lock                            Lock the vault in Flint; remove any cached key
  vault rename <new-name>               Rename the vault (its file is not moved)
  vault forget <name|path>              Drop a vault from the recent list

Groups
  group add <path>                      Create a group, e.g. homelab/proxmox
  group list | group rename <path> <new-name> | group rm <path>

Hosts
  host add <alias> --hostname <host> [--port N] [--user U] [--label L]
           [--group <path>] [--tag T]... [--color #rrggbb] [--notes N]
           [--jump <alias>] [--cred <name>] [--key <name>]
           [--password | --password-stdin] [--command <cmd> [--no-keep-shell]]
           [--sudo-password | --sudo-password-stdin]
                                        --command runs on connect, then a login
                                        shell (--no-keep-shell: ends the session);
                                        the sudo password defaults to the login one
  host edit <alias> [same flags] [--alias <new>] [--no-tags] [--no-password]
           [--no-sudo-password] [--command ""] [--keep-shell]
  host list [--group <path>] [--tag <tag>] | host show <alias> | host rm <alias>
  host test <alias> [--timeout <secs>] [--accept-new-host-key]
                                        Connect, verify the host key, log in, hang up

Keys
  key add <name> (--file <path> | --key-stdin) [--passphrase | --passphrase-stdin]
  key list | key show <name> | key rename <name> <new-name> | key rm <name>

Credentials
  cred add <name> --user <user> [--key <name>] [--password | --password-stdin]
  cred edit <name> [--name N] [--user U] [--key K] [--password | --password-stdin | --no-password]
  cred list | cred show <name> | cred rm <name>

SSH
  connect <alias> [--timeout <secs>] [--accept-new-host-key] [--no-command]
                                        Interactive shell, through jump hosts; runs
                                        the host's --command unless --no-command
  exec <alias> [--timeout <secs>] [--exec-timeout <secs>] [--accept-new-host-key]
       -- <command>                     Run one command; exits with its status
  exec <alias> --sudo -- <command> [args]
                                        Run it as root: Flint asks you in its window
                                        for each one and types the sudo password
                                        itself (needs Flint open)
  known-host list | known-host rm <alias|address>

Tokens (for programs Flint cannot ask about: cron, launchd, CI on this machine)
  token create --name <name> --allow read,exec[,write] [--hosts <alias,@group,...> | --all]
               [--ttl 15m|1h|4h|1d|7d|30d|90d]
                                        Flint asks you to approve it; prints the
                                        token once (default --ttl 1d)
  token list | token revoke <id|name>

Import
  import tether <file> [--password-stdin] [--dry-run]
                                        Copy a Tether vault into this one (asks for
                                        Tether's master password); --dry-run reports only

Global flags
  --json            Write JSON to stdout (errors as JSON to stderr)
  --vault <v>       Use this vault instead of the current one
  --master-stdin    Read the master password from the first line of stdin
  --version, -V     Print the version and linked libraries

With Flint open and the vault unlocked there, commands run through it and need no
master password, once you allow the program that runs flint in Flint's window, or
it passes a token in FLINT_TOKEN.
Otherwise flint asks for it on the terminal (or --master-stdin), for that one
command; with no terminal, Flint is asked to unlock the vault.

Secrets are never taken from arguments: Flint prompts on the terminal, or reads
them from stdin with the --*-stdin flags.`;

/** Every `flint <noun> <verb>` the demo runs, for Tab completion and the coverage test. */
export const COMMANDS: Record<string, string[]> = {
	vault: ['create', 'open', 'list', 'use', 'status', 'unlock', 'lock', 'rename', 'forget'],
	group: ['add', 'list', 'rename', 'rm'],
	host: ['add', 'edit', 'list', 'show', 'test', 'rm'],
	key: ['add', 'list', 'show', 'rename', 'rm'],
	cred: ['add', 'edit', 'list', 'show', 'rm'],
	'known-host': ['list', 'rm'],
	import: ['tether'],
	token: ['create', 'list', 'revoke'],
	connect: [],
	exec: [],
	help: [],
};

/** `host show`'s command line: "herdr (then a login shell)", "… (ends the session)" or "-". */
function commandText(h: Host): string {
	if (!h.command) return '-';
	return h.command + (h.keepShell ? ' (then a login shell)' : ' (ends the session)');
}

const STDIN_FLAGS = ['--master-stdin', '--password-stdin', '--passphrase-stdin', '--key-stdin'];
const REFERENCE = '/reference/cli/';

/** Runs `flint <args>`. */
export function* runFlint(args: string[], world: World, io: Io): Run {
	const asJson = wantsJson(args);
	try {
		return yield* dispatch(args, world, io, asJson);
	} catch (e) {
		if (!(e instanceof FlintError)) throw e;
		if (asJson) io.err(json({ error: { code: e.code, message: e.message } }));
		else io.err('flint: ' + e.message);
		return { code: exitCodeFor(e.code) };
	}
}

function* dispatch(args: string[], world: World, io: Io, asJson: boolean): Run {
	const p = parseFlintArgs(args);
	if (p.has('--version') || p.has('-V')) {
		if (asJson) {
			io.out(json({ flint: '0.0.0-dev', libssh: '0.12.2/openssl/zlib', libsodium: '1.0.22', sqlite: '3.54.1 (SQLCipher 4.20.0 community)' }));
		} else {
			io.out('flint 0.0.0-dev');
			io.out('  libssh     0.12.2/openssl/zlib');
			io.out('  libsodium  1.0.22');
			io.out('  sqlite     3.54.1 (SQLCipher 4.20.0 community)');
		}
		return { code: 0 };
	}
	const noun = p.positional(0);
	if (!noun || noun === 'help' || p.has('--help') || p.has('-h')) {
		USAGE.split('\n').forEach((l) => io.out(l));
		return { code: 0 };
	}
	const session = noun === 'connect' || noun === 'exec';
	if (!(noun in COMMANDS)) fail('usage', `unknown command '${noun}'; see \`flint help\``);
	if (!p.positional(1)) {
		if (session) fail('usage', `\`flint ${noun}\` needs a host alias; see \`flint help\``);
		fail('usage', `\`flint ${noun}\` needs a command; see \`flint help\``);
	}
	// read_stdin_secrets: the demo prompt is a terminal, so a --*-stdin flag cannot work.
	if (STDIN_FLAGS.some((f) => p.has(f))) {
		fail('usage', 'a --*-stdin flag was given but stdin is a terminal; pipe the secret in, or drop the flag to be prompted');
	}
	const c = new Cmd(p, world, io, asJson);
	switch (noun) {
		case 'vault': return yield* c.vault();
		case 'group': return yield* c.group();
		case 'host': return yield* c.host();
		case 'key': return yield* c.key();
		case 'cred': return yield* c.cred();
		case 'known-host': return yield* c.knownHost();
		case 'import': return c.importVault();
		case 'token': return yield* c.token();
		case 'connect': return yield* c.connect();
		default: return yield* c.exec();
	}
}

const ok: Outcome = { code: 0 };

class Cmd {
	private p: ParsedArgs;
	private world: World;
	private io: Io;
	private asJson: boolean;

	constructor(p: ParsedArgs, world: World, io: Io, asJson: boolean) {
		this.p = p;
		this.world = world;
		this.io = io;
		this.asJson = asJson;
	}

	private say(line: string) {
		this.io.out(line);
	}

	private emit(value: unknown, text: () => void) {
		if (this.asJson) this.say(json(value));
		else text();
	}

	private notInDemo(what: string) {
		this.io.note(`flint (demo): \`flint ${what}\` works with files on your own disk, so this demo leaves it out.`);
		this.io.note('See the CLI reference for what it does.', REFERENCE);
		return ok;
	}

	// ---- vault selection and unlock (open_target) ----

	private resolveVault(selector: string): Vault {
		const vs = this.world.vaults;
		if (!selector) {
			const cur = vs.find((v) => v.name === this.world.current);
			if (!cur) fail('not_found', 'no vault yet; create one with `flint vault create <path>`');
			return cur;
		}
		if (selector.includes('/') || selector.endsWith('.flint')) {
			const byPath = vs.find((v) => v.path === selector);
			if (!byPath) fail('not_found', `no vault file at ${selector}`);
			return byPath;
		}
		const byName = vs.find((v) => v.name === selector);
		if (!byName) fail('not_found', `no recent vault named '${selector}'`);
		return byName;
	}

	// Unlocked in Flint: the command runs there. Otherwise the master password, for this
	// one command; nothing is kept (D-042).
	private *openTarget(): Generator<Ask, Vault, string> {
		const v = this.resolveVault(this.p.value('--vault'));
		if (v.unlocked) {
			// The first command from this terminal waits for the owner's Allow in Flint;
			// the demo plays the owner and allows it.
			if (!this.world.approved) {
				if (!this.asJson) this.io.err('Waiting for approval in Flint (flint, started by Terminal)…');
				this.world.approved = true;
			}
			return v;
		}
		const pw = yield { label: `Master password for '${v.name}': `, secret: true };
		if (pw.length === 0) fail('wrong_password', 'the password is wrong or the file is not a Flint vault');
		return v;
	}

	private *secret(label: string): Generator<Ask, string, string> {
		return yield { label: label + ': ', secret: true };
	}

	// ---- vault ----

	*vault(): Run {
		const p = this.p;
		const verb = p.positional(1);
		const info = (v: Vault) => ({ path: v.path, name: v.name, format: 1, cached: false });
		switch (verb) {
			case 'create':
				p.allowFlags('vault create', ['--name']);
				p.expectArgs('vault create', 1, '<path> [--name <name>]');
				return this.notInDemo('vault create');
			case 'open':
				p.allowFlags('vault open', []);
				p.expectArgs('vault open', 1, '<path>');
				return this.notInDemo('vault open');
			case 'unlock': {
				p.allowFlags('vault unlock', []);
				p.expectArgs('vault unlock', 0, '[--vault <name|path>]');
				const v = this.resolveVault(p.value('--vault'));
				if (!v.unlocked) {
					if (!this.asJson) this.io.err(`Flint is asking for the master password of '${v.name}'…`);
					this.io.note(`flint (demo): Flint's window would ask for the master password of '${v.name}' now. The demo unlocks it for you; Flint holds one vault at a time.`);
					for (const o of this.world.vaults) o.unlocked = false;
					v.unlocked = true;
					this.world.approved = false;
				}
				this.emit(info(v), () => this.say(`Unlocked vault '${v.name}' in Flint. Commands use it until Flint locks it.`));
				return ok;
			}
			case 'lock': {
				p.allowFlags('vault lock', []);
				p.expectArgs('vault lock', 0, '[--vault <name|path>]');
				const v = this.resolveVault(p.value('--vault'));
				v.unlocked = false;
				this.world.approved = false;
				this.emit(info(v), () =>
					this.say(`Locked vault '${v.name}': Flint holds no key for it and none is cached on this machine.`),
				);
				return ok;
			}
			case 'status': {
				p.allowFlags('vault status', []);
				p.expectArgs('vault status', 0, '[--vault <name|path>]');
				const v = this.resolveVault(p.value('--vault'));
				const n = (k: number) => (v.unlocked ? k : 0);
				const st = {
					path: v.path, name: v.name, exists: true, unlocked: v.unlocked, cached: false,
					groups: n(v.groups.length), hosts: n(v.hosts.length), keys: n(v.keys.length), credentials: n(v.creds.length),
					// Set in the app only (D-052); the demo's vaults keep the default.
					activity_days: v.unlocked ? 90 : -1,
				};
				this.emit(st, () => {
					if (!v.unlocked) {
						fields(['vault', 'path', 'state'], [v.name, v.path, 'locked (unlock it in Flint, or pass --master-stdin)']).forEach((l) => this.say(l));
						return;
					}
					fields(
						['vault', 'path', 'state', 'groups', 'hosts', 'keys', 'credentials', 'activity'],
						[v.name, v.path, 'unlocked in Flint', `${st.groups}`, `${st.hosts}`, `${st.keys}`, `${st.credentials}`, 'kept 90 days'],
					).forEach((l) => this.say(l));
				});
				return ok;
			}
			case 'list': {
				p.allowFlags('vault list', []);
				p.expectArgs('vault list', 0, '');
				const cur = this.world.vaults.filter((v) => v.name === this.world.current);
				const rest = this.world.vaults.filter((v) => v.name !== this.world.current);
				const views = [...cur, ...rest].map((v) => ({ name: v.name, path: v.path, current: v.name === this.world.current, exists: true }));
				this.emit(views, () => {
					if (views.length === 0) {
						this.say('No vaults yet. Create one with `flint vault create <path>`.');
						return;
					}
					table(['', 'NAME', 'PATH'], views.map((v) => [v.current ? '*' : ' ', v.name, v.path])).forEach((l) => this.say(l));
				});
				return ok;
			}
			case 'use': {
				p.allowFlags('vault use', []);
				p.expectArgs('vault use', 1, '<name|path>');
				const v = this.resolveVault(p.positional(2));
				this.world.current = v.name;
				this.emit({ name: v.name, path: v.path }, () => this.say(`Vault '${v.name}' is now the current vault.`));
				return ok;
			}
			case 'rename': {
				p.allowFlags('vault rename', []);
				p.expectArgs('vault rename', 1, '<new-name>');
				const v = yield* this.openTarget();
				const name = p.positional(2);
				if (name.length === 0) fail('invalid', 'vault name must not be empty');
				if (name.length > 64) fail('invalid', 'vault name must be at most 64 characters');
				const taken = this.world.vaults.find((x) => x !== v && x.name.toLowerCase() === name.toLowerCase());
				if (taken) fail('conflict', `another recent vault is already named '${taken.name}'`);
				const old = v.name;
				if (this.world.current === old) this.world.current = name;
				v.name = name;
				this.emit(info(v), () => this.say(`Renamed vault '${old}' to '${name}'.`));
				return ok;
			}
			case 'forget': {
				p.allowFlags('vault forget', []);
				p.expectArgs('vault forget', 1, '<name|path>');
				const v = this.resolveVault(p.positional(2));
				this.world.vaults = this.world.vaults.filter((x) => x !== v);
				if (this.world.current === v.name) this.world.current = this.world.vaults[0]?.name ?? '';
				this.emit({ removed: 'vault', name: v.name }, () =>
					this.say(`Forgot vault '${v.name}'. The file at ${v.path} was not touched.`),
				);
				return ok;
			}
		}
		fail('usage', `unknown command \`flint vault ${verb}\`; see \`flint help\``);
	}

	// ---- group ----

	*group(): Run {
		const p = this.p;
		const verb = p.positional(1);
		if (!['add', 'list', 'rename', 'rm'].includes(verb)) {
			fail('usage', `unknown command \`flint group ${verb}\`; see \`flint help\``);
		}
		p.allowFlags('group ' + verb, []);
		if (verb === 'add') p.expectArgs('group add', 1, '<path>');
		else if (verb === 'list') p.expectArgs('group list', 0, '');
		else if (verb === 'rename') p.expectArgs('group rename', 2, '<path> <new-name>');
		else p.expectArgs('group rm', 1, '<path>');
		const ops = new VaultOps(yield* this.openTarget());
		if (verb === 'list') {
			const groups = ops.listGroups();
			this.emit(groups, () => {
				if (groups.length === 0) return this.say('No groups.');
				table(['GROUP', 'HOSTS', 'SUBGROUPS'], groups.map((g) => [g.path, `${g.hosts}`, `${g.subgroups}`])).forEach((l) => this.say(l));
			});
			return ok;
		}
		let g;
		let done;
		if (verb === 'add') {
			g = ops.addGroup(p.positional(2));
			done = 'Added';
		} else if (verb === 'rename') {
			g = ops.renameGroup(p.positional(2), p.positional(3));
			done = 'Renamed to';
		} else {
			g = ops.removeGroup(p.positional(2));
			done = 'Removed';
		}
		this.emit(g, () => this.say(`${done} group '${g.path}'.`));
		return ok;
	}

	// ---- host ----

	private *hostPatch(): Generator<Ask, HostPatch, string> {
		const p = this.p;
		const patch: HostPatch = {};
		if (p.has('--alias')) patch.alias = p.value('--alias');
		if (p.has('--label')) patch.label = p.value('--label');
		if (p.has('--hostname')) patch.hostname = p.value('--hostname');
		if (p.has('--port')) patch.port = parsePort(p.value('--port'));
		if (p.has('--user')) patch.user = p.value('--user');
		if (p.has('--group')) patch.group = p.value('--group');
		if (p.has('--tag')) patch.tags = p.values('--tag');
		if (p.has('--no-tags')) patch.tags = [];
		if (p.has('--color')) patch.color = p.value('--color');
		if (p.has('--notes')) patch.notes = p.value('--notes');
		if (p.has('--jump')) patch.jump = p.value('--jump');
		if (p.has('--cred')) patch.credential = p.value('--cred');
		if (p.has('--key')) patch.key = p.value('--key');
		if (p.has('--command')) patch.command = p.value('--command');
		if (p.has('--keep-shell') && p.has('--no-keep-shell')) {
			fail('usage', '--keep-shell and --no-keep-shell contradict each other');
		}
		if (p.has('--keep-shell') || p.has('--no-keep-shell')) patch.keepShell = p.has('--keep-shell');
		if (p.has('--password')) {
			const pw = yield* this.secret('host password');
			patch.password = pw.length > 0;
		} else if (p.has('--no-password')) {
			patch.password = false;
		}
		if (p.has('--sudo-password')) {
			const pw = yield* this.secret('sudo password');
			patch.sudoPassword = pw.length > 0;
		} else if (p.has('--no-sudo-password')) {
			patch.sudoPassword = false;
		}
		return patch;
	}

	private static HOST_FLAGS = [
		'--label', '--hostname', '--port', '--user', '--group', '--tag', '--no-tags', '--color', '--notes',
		'--jump', '--cred', '--key', '--password', '--password-stdin', '--sudo-password', '--sudo-password-stdin',
		'--command', '--keep-shell', '--no-keep-shell',
	];

	*host(): Run {
		const p = this.p;
		const verb = p.positional(1);
		switch (verb) {
			case 'add': {
				p.allowFlags('host add', Cmd.HOST_FLAGS);
				p.expectArgs('host add', 1, '<alias> --hostname <host> [options]');
				const patch = yield* this.hostPatch();
				patch.alias = p.positional(2);
				const ops = new VaultOps(yield* this.openTarget());
				const h = ops.addHost(patch);
				this.emit(hostView(h), () => this.say(`Added host '${h.alias}' (${hostTarget(h)}).`));
				return ok;
			}
			case 'edit': {
				p.allowFlags('host edit', [...Cmd.HOST_FLAGS, '--alias', '--no-password', '--no-sudo-password']);
				p.expectArgs('host edit', 1, '<alias> [options]');
				const patch = yield* this.hostPatch();
				const ops = new VaultOps(yield* this.openTarget());
				const h = ops.editHost(p.positional(2), patch);
				this.emit(hostView(h), () => this.say(`Updated host '${h.alias}'.`));
				return ok;
			}
			case 'list': {
				p.allowFlags('host list', ['--group', '--tag']);
				p.expectArgs('host list', 0, '[--group <path>] [--tag <tag>]');
				const ops = new VaultOps(yield* this.openTarget());
				const hosts = ops.listHosts(p.value('--group'), p.value('--tag'));
				this.emit(hosts.map(hostView), () => {
					if (hosts.length === 0) return this.say('No hosts.');
					table(
						['ALIAS', 'TARGET', 'GROUP', 'TAGS'],
						hosts.map((h) => [h.alias, hostTarget(h), dash(h.group), dash(h.tags.join(', '))]),
					).forEach((l) => this.say(l));
				});
				return ok;
			}
			case 'show': {
				p.allowFlags('host show', []);
				p.expectArgs('host show', 1, '<alias>');
				const ops = new VaultOps(yield* this.openTarget());
				const h = ops.findHost(p.positional(2));
				this.emit(hostView(h), () =>
					fields(
						['alias', 'label', 'hostname', 'port', 'user', 'group', 'tags', 'color', 'jump', 'credential', 'key', 'password', 'sudo password', 'command', 'notes'],
						[h.alias, dash(h.label), h.hostname, `${h.port}`, dash(h.user), dash(h.group), dash(h.tags.join(', ')), dash(h.color),
							dash(h.jump), dash(h.credential), dash(h.key), h.hasPassword ? 'set' : 'not set', h.hasSudoPassword ? 'set' : 'the login password', commandText(h), dash(h.notes)],
					).forEach((l) => this.say(l)),
				);
				return ok;
			}
			case 'test': {
				p.allowFlags('host test', ['--timeout', '--accept-new-host-key']);
				p.expectArgs('host test', 1, '<alias> [--timeout <secs>] [--accept-new-host-key]');
				if (p.hasRest) fail('usage', '`flint host test` runs no command; use `flint exec <alias> -- <command>`');
				const { host, user, hops } = yield* this.reach(p.positional(2), true);
				let target = (user ? user + '@' : '') + host.hostname;
				if (host.port !== 22) target += `:${host.port}`;
				const ms = 120 + 64 * hops;
				const via = hops === 2 ? ', through 1 jump host' : hops > 2 ? `, through ${hops - 1} jump hosts` : '';
				this.emit({ host: host.alias, target, hops, duration_ms: ms }, () =>
					this.say(`Connection to '${host.alias}' works: ${target}, host key verified, logged in (${ms} ms${via}).`),
				);
				return ok;
			}
			case 'rm': {
				p.allowFlags('host rm', []);
				p.expectArgs('host rm', 1, '<alias>');
				const ops = new VaultOps(yield* this.openTarget());
				const h = ops.removeHost(p.positional(2));
				this.emit({ removed: 'host', name: h.alias }, () => this.say(`Removed host '${h.alias}'.`));
				return ok;
			}
		}
		fail('usage', `unknown command \`flint host ${verb}\`; see \`flint help\``);
	}

	// ---- import ----

	importVault(): Outcome {
		const p = this.p;
		if (p.positional(1) !== 'tether') fail('usage', "Flint imports from 'tether' only: `flint import tether <file>`");
		p.allowFlags('import tether', ['--password-stdin', '--dry-run']);
		p.expectArgs('import tether', 1, '<file> [--password-stdin] [--dry-run]');
		return this.notInDemo('import tether');
	}

	// ---- key ----

	*key(): Run {
		const p = this.p;
		const verb = p.positional(1);
		switch (verb) {
			case 'add':
				p.allowFlags('key add', ['--file', '--key-stdin', '--passphrase', '--passphrase-stdin']);
				p.expectArgs('key add', 1, '<name> (--file <path> | --key-stdin) [--passphrase | --passphrase-stdin]');
				return this.notInDemo('key add');
			case 'list': {
				p.allowFlags('key list', []);
				p.expectArgs('key list', 0, '');
				const keys = new VaultOps(yield* this.openTarget()).listKeys();
				this.emit(keys.map(keyView), () => {
					if (keys.length === 0) return this.say('No keys.');
					table(['NAME', 'TYPE', 'FINGERPRINT', 'PASSPHRASE'], keys.map((k) => [k.name, k.type, k.fingerprint, yesNo(k.hasPassphrase)])).forEach((l) => this.say(l));
				});
				return ok;
			}
			case 'show': {
				p.allowFlags('key show', []);
				p.expectArgs('key show', 1, '<name>');
				const k = new VaultOps(yield* this.openTarget()).findKey(p.positional(2));
				this.emit(keyView(k), () =>
					fields(['name', 'type', 'fingerprint', 'passphrase', 'public key'], [k.name, k.type, k.fingerprint, yesNo(k.hasPassphrase), k.publicKey]).forEach((l) => this.say(l)),
				);
				return ok;
			}
			case 'rename': {
				p.allowFlags('key rename', []);
				p.expectArgs('key rename', 2, '<name> <new-name>');
				const k = new VaultOps(yield* this.openTarget()).renameKey(p.positional(2), p.positional(3));
				this.emit(keyView(k), () => this.say(`Renamed key to '${k.name}'.`));
				return ok;
			}
			case 'rm': {
				p.allowFlags('key rm', []);
				p.expectArgs('key rm', 1, '<name>');
				const k = new VaultOps(yield* this.openTarget()).removeKey(p.positional(2));
				this.emit({ removed: 'key', name: k.name }, () => this.say(`Removed key '${k.name}'.`));
				return ok;
			}
		}
		fail('usage', `unknown command \`flint key ${verb}\`; see \`flint help\``);
	}

	// ---- cred ----

	private *credPatch(): Generator<Ask, CredPatch, string> {
		const p = this.p;
		const patch: CredPatch = {};
		if (p.has('--name')) patch.name = p.value('--name');
		if (p.has('--user')) patch.user = p.value('--user');
		if (p.has('--key')) patch.key = p.value('--key');
		if (p.has('--password')) {
			const pw = yield* this.secret('credential password');
			patch.password = pw.length > 0;
		} else if (p.has('--no-password')) {
			patch.password = false;
		}
		return patch;
	}

	*cred(): Run {
		const p = this.p;
		const verb = p.positional(1);
		switch (verb) {
			case 'add': {
				p.allowFlags('cred add', ['--user', '--key', '--password', '--password-stdin']);
				p.expectArgs('cred add', 1, '<name> --user <user> [--key <key>] [--password | --password-stdin]');
				const patch = yield* this.credPatch();
				patch.name = p.positional(2);
				const c = new VaultOps(yield* this.openTarget()).addCred(patch);
				this.emit(credView(c), () => this.say(`Added credential '${c.name}' for user ${c.user}.`));
				return ok;
			}
			case 'edit': {
				p.allowFlags('cred edit', ['--name', '--user', '--key', '--password', '--password-stdin', '--no-password']);
				p.expectArgs('cred edit', 1, '<name> [options]');
				const patch = yield* this.credPatch();
				const c = new VaultOps(yield* this.openTarget()).editCred(p.positional(2), patch);
				this.emit(credView(c), () => this.say(`Updated credential '${c.name}'.`));
				return ok;
			}
			case 'list': {
				p.allowFlags('cred list', []);
				p.expectArgs('cred list', 0, '');
				const list = new VaultOps(yield* this.openTarget()).listCreds();
				this.emit(list.map(credView), () => {
					if (list.length === 0) return this.say('No credentials.');
					table(['NAME', 'USER', 'KEY', 'PASSWORD'], list.map((c) => [c.name, c.user, dash(c.key), yesNo(c.hasPassword)])).forEach((l) => this.say(l));
				});
				return ok;
			}
			case 'show': {
				p.allowFlags('cred show', []);
				p.expectArgs('cred show', 1, '<name>');
				const c = new VaultOps(yield* this.openTarget()).findCred(p.positional(2));
				this.emit(credView(c), () =>
					fields(['name', 'user', 'key', 'password'], [c.name, c.user, dash(c.key), c.hasPassword ? 'set' : 'not set']).forEach((l) => this.say(l)),
				);
				return ok;
			}
			case 'rm': {
				p.allowFlags('cred rm', []);
				p.expectArgs('cred rm', 1, '<name>');
				const c = new VaultOps(yield* this.openTarget()).removeCred(p.positional(2));
				this.emit({ removed: 'credential', name: c.name }, () => this.say(`Removed credential '${c.name}'.`));
				return ok;
			}
		}
		fail('usage', `unknown command \`flint cred ${verb}\`; see \`flint help\``);
	}

	// ---- known-host ----

	*knownHost(): Run {
		const p = this.p;
		const verb = p.positional(1);
		if (verb === 'list') {
			p.allowFlags('known-host list', []);
			p.expectArgs('known-host list', 0, '');
			const rows = new VaultOps(yield* this.openTarget()).knownHostRows();
			this.emit(rows, () => {
				if (rows.length === 0) return this.say("No known hosts yet. A host's key is recorded the first time you connect.");
				table(['ADDRESS', 'HOST', 'TYPE', 'FINGERPRINT', 'ADDED'], rows.map((k) => [k.addr, dash(k.host), k.key_type, k.fingerprint, k.added_at])).forEach((l) => this.say(l));
			});
			return ok;
		}
		if (verb === 'rm') {
			p.allowFlags('known-host rm', []);
			p.expectArgs('known-host rm', 1, '<alias|address>');
			const k = new VaultOps(yield* this.openTarget()).removeKnownHost(p.positional(2));
			this.emit({ removed: 'known-host', addr: k.addr, fingerprint: k.fingerprint }, () =>
				this.say(`Forgot the host key of ${k.addr} (${k.keyType} ${k.fingerprint}). The next connect will ask again.`),
			);
			return ok;
		}
		fail('usage', `unknown command \`flint known-host ${verb}\`; see \`flint help\``);
	}

	// ---- token (src/drivers/clicmd/tokens.cf) ----

	*token(): Run {
		const p = this.p;
		const verb = p.positional(1);
		const now = Math.floor(this.io.now().getTime() / 1000);
		if (verb === 'create') {
			p.allowFlags('token create', ['--name', '--hosts', '--all', '--allow', '--ttl']);
			p.expectArgs('token create', 0, '');
			const req = tokenRequestFromFlags(p);
			const v = this.resolveVault(p.value('--vault'));
			if (!v.unlocked) fail('locked', '`flint token create` runs in Flint, which asks you to approve it: open Flint, unlock this vault and run it again');
			const ops = new VaultOps(yield* this.openTarget());
			// Flint's window asks every time; the demo plays the owner and allows it.
			if (!this.asJson) this.io.err(`Waiting for approval in Flint (flint, started by Terminal)…`);
			const made = ops.createToken(req, now);
			if (this.asJson) {
				this.say(json({ token: tokenView(made.token, now), secret: made.secret }));
				return ok;
			}
			const t = made.token;
			this.io.err(`Created token '${t.name}' (${tokenAllows(t)} on ${tokenReach(t)}), until ${utcText(t.expiresAt)}.`);
			this.io.err('Flint shows it this once, above. Give it to the program in the FLINT_TOKEN environment variable.');
			this.say(made.secret);
			return ok;
		}
		if (verb === 'list') {
			p.allowFlags('token list', []);
			p.expectArgs('token list', 0, '');
			const v = yield* this.openTarget();
			const list = v.tokens.map((t) => tokenView(t, now));
			this.emit(list, () => {
				if (list.length === 0) return this.say('No tokens. Create one with `flint token create`.');
				table(['ID', 'NAME', 'ALLOWS', 'REACHES', 'STATUS', 'UNTIL'], v.tokens.map((t) => [
					t.id, t.name, tokenAllows(t), tokenReach(t), tokenStatus(t, now), utcText(t.revokedAt > 0 ? t.revokedAt : t.expiresAt),
				])).forEach((l) => this.say(l));
			});
			return ok;
		}
		if (verb === 'revoke') {
			p.allowFlags('token revoke', []);
			p.expectArgs('token revoke', 1, '<id|name>');
			const ops = new VaultOps(yield* this.openTarget());
			const t = ops.revokeToken(p.positional(2), now);
			this.emit(tokenView(t, now), () => this.say(`Revoked token '${t.name}' (${t.id}). A program that uses it is refused from now on.`));
			return ok;
		}
		fail('usage', `unknown command \`flint token ${verb}\`; see \`flint help\``);
	}

	// ---- connect / exec ----

	/** Walks the jump chain, checks each server key and resolves the login (connect.cf). */
	private *reach(alias: string, testOnly = false): Generator<Ask, { host: Host; user: string; hops: number }, string> {
		const p = this.p;
		if (p.has('--timeout')) parseSeconds('--timeout', p.value('--timeout'));
		const v = yield* this.openTarget();
		const ops = new VaultOps(v);
		const target = ops.findHost(alias);
		const chain: Host[] = [target];
		for (let cur = target; cur.jump; ) {
			const next = v.hosts.find((h) => h.alias.toLowerCase() === cur.jump.toLowerCase());
			if (!next) fail('not_found', `a jump host of '${target.alias}' no longer exists`);
			if (chain.includes(next)) fail('invalid', `the jump hosts of '${target.alias}' make a loop`);
			chain.unshift(next);
			cur = next;
		}
		let user = '';
		for (const h of chain) {
			user = yield* this.login(ops, h, testOnly);
		}
		return { host: target, user, hops: chain.length };
	}

	/** `testOnly` never asks for a password (`host test`): no stored method fails with auth. */
	private *login(ops: VaultOps, h: Host, testOnly: boolean): Generator<Ask, string, string> {
		const cred = h.credential ? ops.findCred(h.credential) : undefined;
		const user = h.user || cred?.user || '';
		if (!user) {
			fail('invalid', `host '${h.alias}' has no user; set one with \`flint host edit ${h.alias} --user <user>\` or link a credential`);
		}
		const addr = VaultOps.addrOf(h);
		if (!ops.knownHostFor(h)) {
			const key = serverKeyFor(addr);
			let trusted = this.p.has('--accept-new-host-key');
			if (!trusted) {
				const answer = yield {
					label: `The host '${h.alias}' (${addr}) is not known yet.\n${key.type} key fingerprint is ${key.fingerprint}.\nTrust this key and continue connecting (yes/no)? `,
					secret: false,
				};
				trusted = ['yes', 'y', 'YES', 'Yes', 'Y'].includes(answer.trim());
			}
			if (!trusted) fail('host_key', `the host key of '${h.alias}' was not trusted`);
			const d = this.io.now();
			const pad = (n: number) => String(n).padStart(2, '0');
			ops.v.knownHosts.push({
				addr, keyType: key.type, fingerprint: key.fingerprint,
				addedAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
			});
		}
		const hasStored = h.hasPassword || !!h.key || !!cred?.key || !!cred?.hasPassword;
		if (!hasStored && testOnly) {
			fail('auth', `${user}@${h.alias}: no auth method was accepted (tried: SSH agent)`);
		}
		if (!hasStored) {
			const typed = yield { label: `${user}@${h.alias}'s password: `, secret: true };
			if (typed.length === 0) fail('auth', `${user}@${h.alias}: no auth method was accepted (tried: SSH agent, typed password)`);
		}
		return user;
	}

	*connect(): Run {
		const p = this.p;
		p.allowFlags('connect', ['--timeout', '--accept-new-host-key', '--no-command']);
		if (p.positionals.length !== 2 || p.hasRest) {
			fail('usage', 'usage: flint connect <alias> [--timeout <secs>] [--accept-new-host-key] [--no-command]');
		}
		const { host, user } = yield* this.reach(p.positional(1));
		if (host.command && !p.has('--no-command')) {
			this.io.note(
				`The real flint runs \`${host.command}\` on ${host.alias} now${host.keepShell ? ', then your login shell' : ' and ends the session when it exits'}. The demo opens its shell instead.`,
				'/guides/hosts/#run-a-command-on-connect',
			);
		}
		return { code: 0, connect: { alias: host.alias, user, hostname: host.hostname, json: this.asJson } };
	}

	*exec(): Run {
		const p = this.p;
		p.allowFlags('exec', ['--timeout', '--exec-timeout', '--accept-new-host-key', '--sudo']);
		if (p.positionals.length !== 2 || !p.hasRest || p.rest.length === 0) {
			fail('usage', 'usage: flint exec <alias> [--timeout <secs>] [--exec-timeout <secs>] [--sudo] -- <command>');
		}
		if (p.has('--exec-timeout')) parseSeconds('--exec-timeout', p.value('--exec-timeout'));
		const sudo = p.has('--sudo');
		if (sudo) {
			const v = this.resolveVault(p.value('--vault'));
			if (!v.unlocked) fail('locked', '`flint exec --sudo` runs only through Flint: open Flint, unlock this vault there, and run it again');
			const ops = new VaultOps(yield* this.openTarget());
			ops.findHost(p.positional(1));
			// Flint's window asks for every sudo command; the demo plays the owner and allows it.
			if (!this.asJson) this.io.err('Waiting for approval in Flint (flint, started by Terminal)…');
		}
		const { host, user } = yield* this.reach(p.positional(1));
		const shell = new RemoteShell(host.alias, sudo ? 'root' : user, host.hostname, () => this.io.now());
		const r = shell.run(p.rest.map((w) => (/[\s'"]/.test(w) ? `'${w}'` : w)).join(' '));
		const code = r.exit ? 0 : r.code;
		const stdout = r.exit ? [] : r.stdout;
		if (this.asJson) {
			const text = (lines: string[]) => (lines.length ? lines.join('\n') + '\n' : '');
			this.say(json({ host: host.alias, exit_code: code, signal: '', stdout: text(stdout), stderr: text(r.stderr), duration_ms: 214 }));
		} else {
			stdout.forEach((l) => this.say(l));
			r.stderr.forEach((l) => this.io.err(l));
		}
		return { code };
	}
}

/** token_request_from_flags: "--hosts codebox,@homelab", "--allow exec,read". */
function tokenRequestFromFlags(p: ParsedArgs): TokenRequest {
	const req: TokenRequest = { name: p.value('--name'), all: p.has('--all'), groups: [], hosts: [], read: false, exec: false, write: false, ttl: p.has('--ttl') ? p.value('--ttl') : '1d' };
	for (const v of p.values('--hosts')) {
		for (const part of v.split(',')) {
			const item = part.trim();
			if (item.startsWith('@')) { if (item.length > 1) req.groups.push(item.slice(1)); }
			else if (item) req.hosts.push(item);
		}
	}
	if (!p.has('--allow')) fail('usage', 'say what the token allows: --allow read,exec,write');
	for (const v of p.values('--allow')) {
		for (const part of v.split(',')) {
			const a = part.trim();
			if (a === 'read') req.read = true;
			else if (a === 'exec') req.exec = true;
			else if (a === 'write') req.write = true;
			else if (a) fail('usage', `--allow takes read, exec and write, not '${a}'`);
		}
	}
	if (req.all && (req.hosts.length > 0 || req.groups.length > 0)) fail('usage', '--all and --hosts do not go together');
	return req;
}
