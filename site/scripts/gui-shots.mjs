// Screenshots of the desktop app for the landing (D-027), taken from the real UI build.
//
//   (cd ../ui && npm run build) && npm run shots:gui
//
// Serves ../ui/dist (the same React bundle the app ships), replaces the GUI driver's
// RPC bridge (window.backend, window.runtime) with a stub that answers from the CLI
// demo's seed vault, opens two hosts from the tree and captures the window in both
// themes. Nothing here talks to a network; the terminal text is canned.
// Uses the same Chromium lookup as demo-e2e.mjs. Writes src/assets/screens/*.png.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findChromium } from './chromium.mjs';

const uiDist = fileURLToPath(new URL('../../ui/dist/', import.meta.url));
const outDir = fileURLToPath(new URL('../src/assets/screens/', import.meta.url));
const seed = JSON.parse(readFileSync(new URL('../src/demo/data/seed-vault.json', import.meta.url), 'utf8'));
if (!existsSync(join(uiDist, 'index.html'))) throw new Error('no ui/dist: run `npm run build` in ui/ first');
mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
	let file = join(uiDist, path);
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
	if (!existsSync(file)) return res.writeHead(404).end('not found');
	res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// The demo vault as the GUI driver's catalog (src/drivers/gui/rpc.cf shapes).
const vault = seed.vaults.find((v) => v.name === seed.current);
const catalog = {
	groups: vault.groups.map((g) => ({
		path: g,
		name: g,
		hosts: vault.hosts.filter((h) => h.group === g).length,
		subgroups: 0,
	})),
	hosts: vault.hosts.map((h) => ({
		alias: h.alias, label: h.label ?? '', hostname: h.hostname, port: 22, user: h.user ?? '',
		group: h.group ?? '', tags: h.tags ?? [], color: h.color ?? '', notes: h.notes ?? '',
		jump: h.jump ?? '', credential: h.credential ?? '', key: h.key ?? '', has_password: Boolean(h.password),
		command: '', keep_shell: true,
	})),
	keys: vault.keys,
	credentials: vault.creds.map((c) => ({ name: c.name, user: c.user, key: c.key, has_password: Boolean(c.password) })),
	known_hosts: [],
};
const recents = seed.vaults.map((v) => ({ name: v.name, path: v.path, current: v.name === seed.current, exists: true }));

// What each host's shell shows. \r\n because it goes to a terminal.
const ESC = '\x1b[';
const prompt = (user, host) => `${ESC}1;32m${user}@${host}${ESC}0m:${ESC}1;34m~${ESC}0m$ `;
const screens = {
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
const homes = { 'web-01': '/home/deploy', nas: '/srv/backups' };
const listing = {
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
const tunnelList = [
	{ host: 'db', name: 'grafana', local_port: 3000, destination: '10.0.0.5:3000', open_on_connect: true, state: 'listening', listen: '127.0.0.1:3000', connections: 0, error: '' },
	{ host: 'db', name: 'pg', local_port: 5432, destination: 'localhost:5432', open_on_connect: true, state: 'listening', listen: '127.0.0.1:5432', connections: 2, error: '' },
	{ host: 'db', name: 'pgbouncer', local_port: 6432, destination: 'localhost:6432', open_on_connect: false, state: 'stopped', listen: '', connections: 0, error: '' },
	{ host: 'nas', name: 'admin', local_port: 8443, destination: 'localhost:443', open_on_connect: false, state: 'stopped', listen: '', connections: 0, error: '' },
];

function stub({ catalog, recents, screens, theme, listing, homes, tunnelList }) {
	const bySession = new Map();
	const now = Math.floor(Date.now() / 1000);
	const listeners = new Map();
	const emit = (event, data) => (listeners.get(event) ?? []).forEach((cb) => cb(data));
	window.__shotsEmit = emit;
	const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
	const settings = {
		theme, accent: 'ember', density: 'default', follow_motion: true, reopen_last_vault: true,
		term_font: '', term_font_size: 13, term_line_height: 100, term_cursor: 'block', term_cursor_blink: false, term_theme: 'default', lock_after: '1h',
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
		vault_unlock: () => ({ path: current.path, name: current.name, format: 1, cached: true }),
		vault_status: () => ({ path: current.path, name: current.name, exists: true, unlocked: true, cached: true, groups: catalog.groups.length, hosts: catalog.hosts.length, keys: catalog.keys.length, credentials: catalog.credentials.length }),
		catalog: () => catalog,
		session_open: ({ session, alias, files_only }) => {
			bySession.set(session, alias);
			setTimeout(() => {
				if (files_only) return emit('session:state', { session, state: 'ready', code: '', message: '', exit_code: 0 });
				emit('session:state', { session, state: 'ready', code: '', message: '', exit_code: 0 });
				emit('terminal:output', { session, data: b64((screens[alias] ?? ['$ ']).join('\r\n')) });
			}, 50);
			return {};
		},
		activity: () => ({}),
		unlock_request: () => ({ path: '', name: '', caller: '' }),
		unlock_request_dismiss: () => ({}),
		vault_lock: () => ({}),
		session_input: () => ({}),
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

const browser = await chromium.launch({ executablePath: findChromium() });
try {
	for (const theme of ['dark', 'light']) {
		const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2, colorScheme: theme });
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await page.addInitScript(stub, { catalog, recents, screens, theme, listing, homes, tunnelList });
		await page.goto(base);
		const tree = page.getByRole('tree');
		await tree.waitFor();
		// A row's name gains "1 open session" once it has a tab, so match the alias text.
		const row = (alias) => tree.getByRole('treeitem').filter({ has: page.locator('.host-name', { hasText: new RegExp(`^${alias}$`) }) });
		for (const alias of ['web-01', 'db']) {
			await row(alias).dblclick();
			await page.waitForTimeout(300);
		}
		await row('db').click();
		await page.mouse.move(0, 0);
		await page.waitForTimeout(500);
		if (errors.length) throw new Error(`page errors (${theme}): ${errors.join('; ')}`);
		const file = join(outDir, `app-${theme}.png`);
		await page.screenshot({ path: file });
		console.log(`wrote ${file}`);
		// The Files view on web-01's tab with a second pane on nas (14d2, milestone 19):
		// deploy.sh copied over, the release on its way.
		await page.locator('.tab', { hasText: 'web-01' }).first().click();
		await page.keyboard.press('Meta+e');
		const first = page.locator('.sidebar[data-for="files"] > .col');
		await first.locator('[data-file="deploy.sh"]').waitFor();
		await page.locator('[data-files-pick]').click();
		await page.locator('[data-files-pick-host="nas"]').click();
		await page.locator('[data-files-pane="2"] [data-file="restic.env"]').waitFor();
		await first.locator('[data-file="nginx.conf"]').click();
		await page.keyboard.press('Meta+ArrowRight');
		await page.locator('[data-transfer="nginx.conf"][data-state="done"]').waitFor();
		await first.locator('[data-file="release-2.3.tar.gz"]').click();
		await page.keyboard.press('Meta+ArrowRight');
		await page.waitForTimeout(1500);
		await first.locator('[data-file="deploy.sh"]').click();
		await page.mouse.move(0, 0);
		if (errors.length) throw new Error(`page errors (${theme}): ${errors.join('; ')}`);
		const filesShot = join(outDir, `app-files-${theme}.png`);
		await page.screenshot({ path: filesShot });
		console.log(`wrote ${filesShot}`);
		await page.locator('[data-files-one-pane]').click();
		await page.keyboard.press('Meta+e');
		await page.locator('.tab', { hasText: 'db' }).first().click();
		// The Tunnels view (20a, milestone 23) beside db's tab, whose toolbar counts them.
		await page.keyboard.press('Meta+Shift+t');
		await page.locator('[data-tunnel="pg"]').waitFor();
		await page.mouse.move(0, 0);
		await page.waitForTimeout(300);
		if (errors.length) throw new Error(`page errors (${theme}): ${errors.join('; ')}`);
		const tunnelsShot = join(outDir, `app-tunnels-${theme}.png`);
		await page.screenshot({ path: tunnelsShot });
		console.log(`wrote ${tunnelsShot}`);
		await page.keyboard.press('Meta+Shift+h');
		// FLINT_SHOTS_EXTRA=<dir>: more screens for a visual check, not used by the landing.
		const extra = process.env.FLINT_SHOTS_EXTRA;
		if (extra) {
			mkdirSync(extra, { recursive: true });
			// Split panes (milestone 20): two side by side, the Split menu, three, four,
			// and four at 900 × 600 (18f).
			await page.keyboard.press('Meta+d');
			await page.waitForTimeout(400);
			await page.screenshot({ path: join(extra, `split-2-${theme}.png`) });
			await page.locator('[data-split-button]').click();
			await page.waitForTimeout(200);
			await page.screenshot({ path: join(extra, `split-menu-${theme}.png`) });
			await page.keyboard.press('Escape');
			await page.keyboard.press('Meta+k');
			await page.keyboard.type('web');
			await page.waitForTimeout(200);
			await page.screenshot({ path: join(extra, `split-palette-${theme}.png`) });
			await page.keyboard.press('Meta+Shift+Enter');
			await page.waitForTimeout(400);
			await page.screenshot({ path: join(extra, `split-3-${theme}.png`) });
			await page.keyboard.press('Meta+Shift+d');
			await page.waitForTimeout(400);
			await page.screenshot({ path: join(extra, `split-4-${theme}.png`) });
			await page.setViewportSize({ width: 900, height: 600 });
			await page.waitForTimeout(600);
			await page.screenshot({ path: join(extra, `split-narrow-${theme}.png`) });
			// A narrow window lays the sidebar over the terminal, drawn whole (milestone 21).
			for (const [view, rail] of [['files', 'Files'], ['hosts', 'Hosts']]) {
				await page.locator('.rail-btn', { hasText: rail }).click();
				await page.waitForTimeout(400);
				await page.screenshot({ path: join(extra, `${view}-narrow-${theme}.png`) });
			}
			await page.keyboard.press('Escape');
			await page.setViewportSize({ width: 1280, height: 640 });
			for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+w');
			await page.waitForTimeout(300);
			await page.getByRole('button', { name: 'Settings' }).first().click();
			await page.locator('.nav-i', { hasText: 'Vault' }).click();
			await page.waitForTimeout(300);
			await page.screenshot({ path: join(extra, `settings-vault-${theme}.png`) });
			await page.evaluate((path) => window.__shotsEmit('vault:locked', { path, name: 'Demo', reason: 'idle' }), recents.find((r) => r.current).path);
			await page.waitForTimeout(300);
			await page.screenshot({ path: join(extra, `locked-${theme}.png`) });
			await page.evaluate((path) => window.__shotsEmit('vault:unlock-request', { path, name: 'Demo', caller: 'flint exec web-01 -- uptime' }), recents.find((r) => r.current).path);
			await page.waitForTimeout(300);
			await page.screenshot({ path: join(extra, `locked-request-${theme}.png`) });
			console.log(`wrote extra screens to ${extra}`);
		}
		await page.close();
	}
} finally {
	await browser.close();
	server.close();
}
