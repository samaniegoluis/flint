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

function stub({ catalog, recents, screens, theme }) {
	const listeners = new Map();
	const emit = (event, data) => (listeners.get(event) ?? []).forEach((cb) => cb(data));
	const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
	const settings = {
		theme, accent: 'ember', density: 'default', follow_motion: true, reopen_last_vault: true,
		term_font: '', term_font_size: 13, term_line_height: 100, term_cursor: 'block', term_cursor_blink: false,
	};
	const current = recents.find((r) => r.current);
	const replies = {
		app_info: () => ({ version: '0.1.0', os: 'mac', libssh: '', libsodium: '', sqlite: '', e2e: false }),
		window_theme: () => ({}),
		settings_get: () => settings,
		settings_set: (s) => s,
		fonts_mono: () => ({ fonts: [] }),
		vault_recents: () => recents,
		vault_unlock: () => ({ path: current.path, name: current.name, format: 1, cached: true }),
		vault_status: () => ({ path: current.path, name: current.name, exists: true, cached: true, groups: catalog.groups.length, hosts: catalog.hosts.length, keys: catalog.keys.length, credentials: catalog.credentials.length }),
		catalog: () => catalog,
		session_open: ({ session, alias }) => {
			setTimeout(() => {
				emit('session:state', { session, state: 'ready', code: '', message: '', exit_code: 0 });
				emit('terminal:output', { session, data: b64((screens[alias] ?? ['$ ']).join('\r\n')) });
			}, 50);
			return {};
		},
		session_input: () => ({}),
		session_resize: () => ({}),
		session_close: () => ({}),
	};
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
		await page.addInitScript(stub, { catalog, recents, screens, theme });
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
		await page.close();
	}
} finally {
	await browser.close();
	server.close();
}
