// The desktop app's UI served with its RPC bridge stubbed from the CLI demo's seed vault,
// shared by the landing's screenshots (gui-shots.mjs) and its video (hero-video.mjs).
// Nothing here talks to a network; the terminal text is canned.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiDist = fileURLToPath(new URL('../../ui/dist/', import.meta.url));
const seed = JSON.parse(readFileSync(new URL('../src/demo/data/seed-vault.json', import.meta.url), 'utf8'));
if (!existsSync(join(uiDist, 'index.html'))) throw new Error('no ui/dist: run `npm run build` in ui/ first');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
export const server = createServer((req, res) => {
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
	let file = join(uiDist, path);
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
	if (!existsSync(file)) return res.writeHead(404).end('not found');
	res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
export const base = `http://127.0.0.1:${server.address().port}/`;

// The demo vault as the GUI driver's catalog (src/drivers/gui/rpc.cf shapes).
const vault = seed.vaults.find((v) => v.name === seed.current);
export const catalog = {
	groups: vault.groups.map((g) => ({
		path: g,
		name: g,
		hosts: vault.hosts.filter((h) => h.group === g).length,
		subgroups: 0,
	})),
	hosts: vault.hosts.map((h) => ({
		alias: h.alias, type: h.type ?? 'ssh', domain: h.domain ?? '', label: h.label ?? '', hostname: h.hostname, port: 22, user: h.user ?? '',
		group: h.group ?? '', tags: h.tags ?? [], color: h.color ?? '', notes: h.notes ?? '',
		jump: h.jump ?? '', credential: h.credential ?? '', key: h.key ?? '', has_password: Boolean(h.password),
		command: '', keep_shell: true,
	})),
	keys: vault.keys,
	credentials: vault.creds.map((c) => ({ name: c.name, user: c.user, key: c.key, has_password: Boolean(c.password) })),
	known_hosts: [],
};
export const recents = seed.vaults.map((v) => ({ name: v.name, path: v.path, current: v.name === seed.current, exists: true }));

// What each host's shell shows. \r\n because it goes to a terminal.
export const ESC = '\x1b[';
export const prompt = (user, host) => `${ESC}1;32m${user}@${host}${ESC}0m:${ESC}1;34m~${ESC}0m$ `;
export const screens = {
	'web-01': [
		'Linux web-01 6.8.0-45-generic x86_64',
		'',
		`${prompt('deploy', 'web-01')}uptime`,
		' 10:42:07 up 41 days,  2:17,  1 user,  load average: 0.08, 0.05, 0.01',
		prompt('deploy', 'web-01'),
	],
	db: [
		'Linux db 6.8.0-45-generic x86_64',
		'Last login: Thu Nov  5 09:12:44 2026 from 10.0.0.2',
		'',
		`${prompt('admin', 'db')}systemctl status postgresql --no-pager`,
		`${ESC}1;32m●${ESC}0m postgresql.service - PostgreSQL RDBMS`,
		'     Loaded: loaded (/lib/systemd/system/postgresql.service; enabled)',
		`     Active: ${ESC}1;32mactive (exited)${ESC}0m since Thu 2026-09-24 08:29:51 UTC; 1 month 11 days ago`,
		'   Main PID: 912 (code=exited, status=0/SUCCESS)',
		'',
		`${prompt('admin', 'db')}df -h /var/lib/postgresql`,
		'Filesystem      Size  Used Avail Use% Mounted on',
		'/dev/nvme0n1p2  200G   61G  139G  31% /',
		'',
		`${prompt('admin', 'db')}ls /var/lib/postgresql/16/main`,
		`${ESC}1;34mbase${ESC}0m    ${ESC}1;34mpg_commit_ts${ESC}0m  ${ESC}1;34mpg_logical${ESC}0m    ${ESC}1;34mpg_replslot${ESC}0m  ${ESC}1;34mpg_stat${ESC}0m      ${ESC}1;34mpg_wal${ESC}0m   PG_VERSION`,
		`${ESC}1;34mglobal${ESC}0m  ${ESC}1;34mpg_dynshmem${ESC}0m   ${ESC}1;34mpg_multixact${ESC}0m  ${ESC}1;34mpg_serial${ESC}0m   ${ESC}1;34mpg_tblspc${ESC}0m    ${ESC}1;34mpg_xact${ESC}0m  postmaster.opts`,
		prompt('admin', 'db'),
	],
};

// What the Files view lists (milestones 17 and 19): web-01's login folder, and nas's in
// the second pane. Name, kind, size, minutes ago.
export const homes = { 'web-01': '/home/deploy', nas: '/srv/backups' };
export const listing = {
	'/srv/backups': [
		['db', 'dir', 0, 300], ['web-01', 'dir', 0, 9000], ['deploy.sh', 'file', 2150, 600], ['nginx.conf', 'file', 1830, 0],
		['restic.env', 'file', 288, 70000], ['retention.txt', 'file', 940, 52000],
	],
	'/home/deploy': [
		['releases', 'dir', 0, 90], ['shared', 'dir', 0, 2400], ['site', 'dir', 0, 130],
		['.env', 'file', 412, 30000], ['deploy.sh', 'file', 2150, 8000], ['nginx.conf', 'file', 1830, 240],
		['README.md', 'file', 6550, 40000], ['release-2.3.tar.gz', 'file', 50540000, 9000],
	],
};

// The Tunnels view (milestone 23): db's Postgres and Grafana up, one stopped, one on nas.
export const tunnelList = [
	{ host: 'db', name: 'grafana', local_port: 3000, destination: '10.0.0.5:3000', open_on_connect: true, state: 'listening', listen: '127.0.0.1:3000', connections: 0, error: '' },
	{ host: 'db', name: 'pg', local_port: 5432, destination: 'localhost:5432', open_on_connect: true, state: 'listening', listen: '127.0.0.1:5432', connections: 2, error: '' },
	{ host: 'db', name: 'pgbouncer', local_port: 6432, destination: 'localhost:6432', open_on_connect: false, state: 'stopped', listen: '', connections: 0, error: '' },
	{ host: 'nas', name: 'admin', local_port: 8443, destination: 'localhost:443', open_on_connect: false, state: 'stopped', listen: '', connections: 0, error: '' },
];

// `video` (hero-video.mjs only): the vault locks and unlocks with any password, sessions
// take `connectMs` to connect, and typed lines are answered by `shellLine`, followed by
// the host's prompt from `prompts`.
export function stub({ catalog, recents, screens, theme, listing, homes, tunnelList, video = null }) {
	const bySession = new Map();
	const lines = new Map();
	// What a typed line prints (\r\n-terminated), or null for `exit`.
	const shellLine = (line, alias) => {
		if (line === '') return '';
		if (line === 'exit') return null;
		const echo = /^echo\s+(?:"([^"]*)"|'([^']*)'|(.*))$/.exec(line);
		if (echo) return (echo[1] ?? echo[2] ?? echo[3]) + '\r\n';
		if (line === 'uptime') return ' 10:42:07 up 41 days,  2:17,  1 user,  load average: 0.08, 0.05, 0.01\r\n';
		if (line === 'hostname') return alias + '\r\n';
		return `-bash: ${line.split(' ')[0]}: command not found\r\n`;
	};
	const now = Math.floor(Date.now() / 1000);
	const listeners = new Map();
	const emit = (event, data) => (listeners.get(event) ?? []).forEach((cb) => cb(data));
	window.__shotsEmit = emit;
	const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
	const settings = {
		theme, accent: 'ember', density: 'default', follow_motion: true, reopen_last_vault: true,
		term_font: '', term_font_size: video?.termFontSize ?? 13, term_line_height: 100, term_cursor: 'block', term_cursor_blink: false, term_theme: 'default', lock_after: '1h',
	};
	const uiState = { sidebar_open: true, sidebar_width: 264, files_width: 340, collapsed: [] };
	const current = recents.find((r) => r.current);
	const replies = {
		app_info: () => ({ version: '0.1.0', os: 'mac', libssh: '', libsodium: '', sqlite: '', e2e: false }),
		window_theme: () => ({}),
		settings_get: () => settings,
		settings_set: (s) => s,
		fonts_mono: () => ({ fonts: [] }),
		ui_state_get: () => uiState,
		ui_state_set: (s) => ({ sidebar_open: s.sidebar_open, sidebar_width: s.sidebar_width, files_width: s.files_width, collapsed: s.collapsed }),
		vault_recents: () => recents,
		vault_unlock: ({ password }) => {
			if (video && !password && window.__shotsOpen === false) throw new Error('locked: the vault is locked');
			window.__shotsOpen = true;
			return { path: current.path, name: current.name, format: 1, cached: !video };
		},
		vault_remembered: () => ({ remembered: false }),
		vault_status: () => ({ path: current.path, name: current.name, exists: true, unlocked: window.__shotsOpen !== false, cached: !video, groups: catalog.groups.length, hosts: catalog.hosts.length, keys: catalog.keys.length, credentials: catalog.credentials.length }),
		catalog: () => catalog,
		session_open: ({ session, alias, files_only }) => {
			bySession.set(session, alias);
			setTimeout(() => {
				if (files_only) return emit('session:state', { session, state: 'ready', code: '', message: '', exit_code: 0 });
				emit('session:state', { session, state: 'ready', code: '', message: '', exit_code: 0 });
				emit('terminal:output', { session, data: b64((screens[alias] ?? ['$ ']).join('\r\n')) });
			}, video?.connectMs ?? 50);
			return {};
		},
		activity: () => ({}),
		unlock_request: () => ({ path: '', name: '', caller: '' }),
		unlock_request_dismiss: () => ({}),
		vault_lock: () => { window.__shotsOpen = false; return {}; },
		session_input: ({ session, data }) => {
			if (!video) return {};
			// A line-at-a-time shell: echo what is typed, run it on Enter.
			let line = lines.get(session) ?? '';
			for (const ch of data) {
				if (ch === '\r') {
					lines.set(session, '');
					const out = shellLine(line.trim(), bySession.get(session));
					if (out === null) {
						emit('terminal:output', { session, data: b64('\r\nlogout\r\n') });
						setTimeout(() => emit('session:state', { session, state: 'ended', code: '', message: '', exit_code: 0 }), 150);
						return {};
					}
					emit('terminal:output', { session, data: b64('\r\n' + out + (video.prompts[bySession.get(session)] ?? '$ ')) });
					line = '';
				} else if (ch === '\x7f') {
					if (line) { line = line.slice(0, -1); emit('terminal:output', { session, data: b64('\b \b') }); }
				} else {
					line += ch;
					emit('terminal:output', { session, data: b64(ch) });
				}
			}
			lines.set(session, line);
			return {};
		},
		session_resize: () => ({}),
		session_close: () => ({}),
		// The Files view: one folder, an upload that is done and one under way.
		files_home: ({ session }) => ({ path: homes[bySession.get(session)] ?? '/home/deploy' }),
		files_list: ({ path }) => ({
			path,
			entries: (listing[path] ?? []).map(([name, kind, size, ago]) => ({ name, path: `${path}/${name}`, kind, size, mtime: now - ago * 60, mode: 420 })),
		}),
		dialog_open: () => ({ path: window.__shotsUploads.shift() ?? '' }),
		files_transfer: ({ id, local }) => {
			const size = local.endsWith('.tar.gz') ? 20971520 : 1290;
			if (size < 4096) return new Promise((r) => setTimeout(() => r({ host: 'web-01', direction: 'upload', files: [{ source: local, target: '', bytes: size }], folders: 0, bytes: size, skipped: [], duration_ms: 40 }), 60));
			const ev = (bytes) => emit('files:transfer', { session: '', id, file: local, file_bytes: bytes, file_size: size, files_done: 0, bytes_done: bytes });
			// About 3 MB/s: the rate is read from the second report on.
			setTimeout(() => ev(9750000), 40);
			setTimeout(() => ev(13000000), 1040);
			return new Promise(() => {});
		},
		// A copy to nas (milestone 19): deploy.sh done, the release on its way.
		files_relay: ({ id, path, to_path }) => {
			const size = path.endsWith('.tar.gz') ? 50540000 : 2150;
			if (size < 4096) return new Promise((r) => setTimeout(() => r({ host: 'web-01', to_host: 'nas', direction: 'relay', files: [{ source: path, target: to_path, bytes: size }], folders: 0, bytes: size, skipped: [], duration_ms: 40 }), 60));
			const ev = (bytes) => emit('files:transfer', { session: '', id, file: path, file_bytes: bytes, file_size: size, files_done: 0, bytes_done: bytes });
			setTimeout(() => ev(26000000), 40);
			setTimeout(() => ev(32200000), 1040);
			return new Promise(() => {});
		},
		files_cancel: () => ({}),
		tunnels_list: () => tunnelList,
		tunnel_start: ({ session, host, names }) => {
			setTimeout(() => emit('tunnel:started', { session, host, results: names.map((name) => ({ name, code: '', message: '' })), code: '', message: '' }), 50);
			return {};
		},
		tunnel_stop: ({ host, name }) => tunnelList.find((t) => t.host === host && t.name === name),
	};
	window.__shotsUploads = ['/Users/me/build/nginx.conf', '/Users/me/build/release-2.4.tar.gz'];
	window.backend = new Proxy({}, {
		get: (_, name) => async (params) => {
			const fn = replies[name];
			if (!fn) throw new Error(`unsupported: ${String(name)} is not in the screenshot stub`);
			return fn(params ?? {});
		},
	});
	window.runtime = {
		EventsOn(event, cb) {
			const list = listeners.get(event) ?? [];
			list.push(cb);
			listeners.set(event, list);
			return () => listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== cb));
		},
		Quit() {},
	};
	// The headless shell's WebGL canvas comes out blank in a screenshot. Without a WebGL
	// context the app falls back to xterm.js's DOM renderer, which draws the same text.
	const getContext = HTMLCanvasElement.prototype.getContext;
	HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
		return kind === 'webgl2' || kind === 'webgl' ? null : getContext.call(this, kind, ...rest);
	};
}

