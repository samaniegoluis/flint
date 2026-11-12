// Screenshots of the desktop app for the landing (D-027), taken from the real UI build.
//
//   (cd ../ui && npm run build) && npm run shots:gui
//
// Serves ../ui/dist (the same React bundle the app ships), replaces the GUI driver's
// RPC bridge (window.backend, window.runtime) with a stub that answers from the CLI
// demo's seed vault (app-stub.mjs), opens two hosts from the tree and captures the Files
// and Tunnels views in both themes. The app itself is shown by a video (app-video.mjs).
// Uses the same Chromium lookup as demo-e2e.mjs. Writes src/assets/screens/*.png.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findChromium } from './chromium.mjs';
import { base, server, catalog, recents, screens, listing, homes, tunnelList, stub } from './app-stub.mjs';

const outDir = fileURLToPath(new URL('../src/assets/screens/', import.meta.url));
mkdirSync(outDir, { recursive: true });

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
