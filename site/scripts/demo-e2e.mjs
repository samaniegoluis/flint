// Headless check of the landing's CLI demo (D-026), against the built site in dist/.
//
//   npm run build && npm run test:e2e
//
// Uses playwright-core with a Chromium already on the machine: $FLINT_CHROMIUM, the
// one matching playwright-core, or the newest one in the Playwright cache
// (`npx playwright install chromium-headless-shell` puts one there).
// Screenshots go to $DEMO_SHOTS when it is set.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findChromium } from './chromium.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const shots = process.env.DEMO_SHOTS;
let failures = 0;
let checks = 0;

function check(ok, what) {
	checks++;
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4' };
const server = createServer((req, res) => {
	let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
	let file = join(dist, path);
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
	if (!existsSync(file)) {
		res.writeHead(404).end('not found');
		return;
	}
	res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: findChromium() });
const logText = (page) => page.locator('.cli-demo [data-log]').innerText();
async function type(page, text) {
	await page.locator('#cli-demo-input').fill(text);
	await page.keyboard.press('Enter');
}

try {
	// ---- desktop: keyboard, the whole tour ----
	{
		const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await page.goto(base);
		const btn = page.getByRole('link', { name: 'Try the CLI' });
		check(await btn.isVisible(), 'desktop: the hero shows "Try the CLI"');
		if (shots) await page.screenshot({ path: join(shots, 'hero-desktop.png') });
		await btn.click();
		const dialog = page.locator('dialog.cli-demo');
		await dialog.waitFor({ state: 'visible' });
		check(await page.evaluate(() => document.activeElement?.id === 'cli-demo-input'), 'desktop: the input has focus on open');
		check((await logText(page)).includes("Welcome to Flint's demo"), 'desktop: the welcome and first step are shown');
		check((await page.locator('[data-step]').innerText()) === 'Step 1 of 14', 'desktop: the bar shows the tour step');
		check((await page.locator('[data-guide]').innerText()).includes('Every command'), 'desktop: the guide shows the current step');
		check((await page.locator('.cli-demo__chip--next').innerText()).includes('flint help'), 'desktop: the step command is the highlighted chip');
		await type(page, 'flint list');
		check((await page.locator('.cli-demo__chip--next').innerText()).includes('flint help'), 'desktop: a wrong command keeps the guide on the step');

		await type(page, 'flint help');
		await type(page, 'flint host list');
		await type(page, 'flint host show db');
		await type(page, 'flint exec web-01 -- uptime');
		check((await page.locator('[data-prompt]').innerText()).includes('(yes/no)'), 'desktop: an unknown host key asks yes/no');
		await type(page, 'yes');
		await type(page, 'flint cp ./app.conf web-01:app/');
		check((await logText(page)).includes('Copied 1 file (20 B) to web-01:app/app.conf'), 'desktop: cp prints what it copied where');
		await type(page, 'flint tunnel up db:postgres');
		await type(page, 'yes');
		check((await logText(page)).includes("Tunnel 'db:postgres' is listening on 127.0.0.1:5432"), 'desktop: tunnel up says where it listens');
		await type(page, 'flint connect db');
		const remotePrompt = await page.locator('[data-prompt]').textContent();
		check(remotePrompt === 'admin@10.0.0.12:~$ ', `desktop: connect opens the remote prompt (${JSON.stringify(remotePrompt)})`);
		await page.locator('#cli-demo-input').fill('cat no');
		await page.keyboard.press('Tab');
		check((await page.locator('#cli-demo-input').inputValue()) === 'cat notes.txt ', 'desktop: Tab completes a remote path');
		await page.keyboard.press('Enter');
		await type(page, 'exit');
		await type(page, 'flint host add my-server --hostname 203.0.113.10 --user me --password');
		check((await page.locator('#cli-demo-input').getAttribute('type')) === 'password', 'desktop: the password prompt hides the input');
		await type(page, 'secret-typed-in-e2e');
		await type(page, 'flint vault status');
		await type(page, 'flint vault rename "Home Lab"');
		await type(page, 'flint host list --json');
		await type(page, 'flint token create --name nightly --allow exec --hosts nas --ttl 30d');
		await type(page, 'flint exec web-01 --sudo -- whoami');
		const all = await logText(page);
		check(all.includes("That's the tour"), 'desktop: the tour reaches its end');
		check(all.includes('Welcome to Ubuntu'), 'desktop: the remote shell greeted');
		check(!(await page.content()).includes('secret-typed-in-e2e'), 'desktop: the typed password is nowhere in the page');
		check(all.includes('"alias":"my-server"'), 'desktop: the added host is in --json');
		check(/flint_[0-9a-f]{16}_[0-9a-f]{64}/.test(all), 'desktop: token create prints the token once');
		await page.keyboard.press('ArrowUp');
		check(/Waiting for approval in Flint[^\n]*\n(?:[^\n]*\n)?root/.test(all), 'desktop: exec --sudo waits for Flint, then runs as root');
		check((await page.locator('#cli-demo-input').inputValue()) === 'flint exec web-01 --sudo -- whoami', 'desktop: ↑ recalls the last command');
		check(all.includes('#   flint host list --json | jq'), 'desktop: --json offers jq as a tip');
		await page.locator('.cli-demo__chip', { hasText: '| jq' }).click();
		check((await page.locator('.cli-demo__jq-key').count()) > 0, 'desktop: the jq chip runs and colours the JSON');
		check(
			await page.locator('[data-screen]').evaluate((el) => el.scrollWidth <= el.clientWidth),
			'desktop: long lines (the --json output) wrap; no horizontal scroll',
		);
		if (shots) await page.screenshot({ path: join(shots, 'demo-desktop.png') });

		const width = async () => (await dialog.boundingBox()).width;
		const windowed = await width();
		await page.locator('[data-max]').click();
		check((await width()) === 1280, 'desktop: Maximize fills the page');
		check((await page.locator('[data-max]').getAttribute('aria-pressed')) === 'true', 'desktop: the button says it is pressed');
		if (shots) await page.screenshot({ path: join(shots, 'demo-max.png') });
		await page.locator('[data-max]').click();
		check((await width()) === windowed, 'desktop: Restore brings the window size back');
		await page.locator('.cli-demo__bar').dblclick({ position: { x: 400, y: 10 } });
		check((await width()) === 1280, 'desktop: a double click on the bar maximizes');
		await page.locator('[data-restore]').click();
		check((await width()) === windowed, 'desktop: the yellow dot restores');
		await page.locator('[data-maximize]').click();
		await page.keyboard.press('Escape');
		check(!(await dialog.isVisible()), 'desktop: Esc closes the demo, maximized or not');
		check(await page.evaluate(() => document.activeElement?.textContent?.includes('Try the CLI')), 'desktop: focus returns to the button');
		await btn.click();
		check((await width()) === 1280, 'desktop: it reopens maximized, as it was left');
		await page.locator('[data-close]').first().click();
		check(!(await dialog.isVisible()), 'desktop: the red dot closes the demo');
		check(errors.length === 0, `desktop: no page errors ${errors.join(' | ')}`);
		await page.close();
	}

	// ---- phone: taps on chips, no horizontal page scroll ----
	{
		const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		const page = await ctx.newPage();
		await page.goto(base);
		check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: the landing has no horizontal scroll');
		await page.getByRole('link', { name: 'Try the CLI' }).tap();
		await page.locator('dialog.cli-demo').waitFor({ state: 'visible' });
		const box = await page.locator('dialog.cli-demo').boundingBox();
		check(box && box.width === 390, 'phone: the demo fills the screen width');
		check(await page.evaluate(() => document.activeElement?.id !== 'cli-demo-input'), 'phone: no keyboard pops up on open');
		await page.locator('.cli-demo__chip', { hasText: 'flint help' }).tap();
		await page.locator('.cli-demo__chip', { hasText: 'flint host list' }).tap();
		check((await logText(page)).includes('bastion  jump@bastion.example'), 'phone: tapping a chip runs it');
		check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: still no horizontal page scroll');
		if (shots) await page.screenshot({ path: join(shots, 'demo-phone.png') });
		await ctx.close();
	}

	// ---- light theme renders ----
	{
		const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
		await page.goto(base);
		await page.evaluate(() => localStorage.setItem('starlight-theme', 'light'));
		await page.goto(base + '?theme=light#try-the-cli');
		await page.locator('dialog.cli-demo').waitFor({ state: 'visible' });
		check(true, 'light: #try-the-cli opens the demo directly');
		if (shots) await page.screenshot({ path: join(shots, 'demo-light.png') });
		await page.close();
	}

	// ---- the theme button (ThemeToggle.astro, D-087) ----
	// The system's theme until a click; the icon shows the theme on screen.
	{
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
		const page = await ctx.newPage();
		await page.goto(base);
		const btn = page.locator('.flint-theme-toggle');
		const theme = () => page.locator('html').getAttribute('data-theme');
		check((await theme()) === 'dark' && (await btn.locator('.dark').isVisible()), 'theme: a dark system shows the dark page and the moon');
		check((await btn.getAttribute('title')) === 'Switch to light theme', 'theme: the button says what it does');
		await page.emulateMedia({ colorScheme: 'light' });
		await page.waitForTimeout(100);
		check((await theme()) === 'light' && (await btn.locator('.light').isVisible()), 'theme: with nothing chosen it follows the system when that changes');
		await btn.click();
		check((await theme()) === 'dark' && (await page.evaluate(() => localStorage.getItem('starlight-theme'))) === 'dark', 'theme: a click switches and stores the choice');
		await page.emulateMedia({ colorScheme: 'light' });
		await page.reload();
		check((await theme()) === 'dark' && (await btn.locator('.dark').isVisible()), 'theme: the choice outlives a reload and the system');
		await btn.click();
		check((await theme()) === 'light' && (await btn.getAttribute('aria-label')) === 'Switch to dark theme', 'theme: a second click goes back to light');
		await ctx.close();
	}

	// ---- the app's video (AppVideo.astro) ----
	// Fetched only once half in view, then played; the theme and the width pick the file.
	const videoRun = async (label, options, theme) => {
		const ctx = await browser.newContext(options);
		const page = await ctx.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		const fetched = [];
		page.on('request', (r) => { if (/\.(webm|mp4)$/.test(new URL(r.url()).pathname)) fetched.push(new URL(r.url()).pathname); });
		if (theme) {
			await page.goto(base);
			await page.evaluate((t) => localStorage.setItem('starlight-theme', t), theme);
		}
		await page.goto(base);
		await page.waitForTimeout(800);
		check(fetched.length === 0, `${label}: no video is fetched before the figure is in view`);
		const stage = page.locator(`[data-flint-video="${theme ?? 'dark'}"]`);
		await stage.scrollIntoViewIfNeeded();
		return { ctx, page, stage, fetched, errors };
	};
	{
		const { ctx, page, stage, fetched, errors } = await videoRun('video desktop', { viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
		await page.locator('[data-flint-video="dark"].playing').waitFor({ timeout: 10000 });
		const src = await stage.locator('video').evaluate((v) => v.currentSrc);
		check(/app-dark-desktop\.[^/]+\.webm$/.test(src), `video desktop: plays the dark desktop WebM (${src.split('/').pop()})`);
		check(fetched.every((f) => f.includes('app-dark-desktop')), 'video desktop: fetches only that file');
		await page.locator('.flint-video-keys kbd', { hasText: '⌘K' }).waitFor({ timeout: 6000 });
		check(true, 'video desktop: the ⌘K keycap shows when it is pressed');
		await stage.locator('.flint-video-toggle').click();
		check(await stage.locator('video').evaluate((v) => v.paused), 'video desktop: the button pauses it');
		// Resumed while scrolled away (a click() would scroll the button back into view).
		await page.evaluate(() => scrollTo(0, 0));
		await stage.locator('.flint-video-toggle').evaluate((b) => b.click());
		await page.waitForTimeout(400);
		check(await stage.locator('video').evaluate((v) => v.paused), 'video desktop: out of view it stays paused');
		check(errors.length === 0, `video desktop: no page errors ${errors.join('; ')}`);
		if (shots) await page.screenshot({ path: join(shots, 'video-desktop.png') });
		await ctx.close();
	}
	{
		const { ctx, page, stage, fetched } = await videoRun('video light', { viewport: { width: 1280, height: 800 }, colorScheme: 'light' }, 'light');
		await page.locator('[data-flint-video="light"].playing').waitFor({ timeout: 10000 });
		check(fetched.length > 0 && fetched.every((f) => f.includes('app-light-desktop')), 'video light: plays the light desktop file only');
		check(await page.locator('[data-flint-video="dark"] video').evaluate((v) => v.paused && v.readyState === 0), 'video light: the dark one is never loaded');
		await ctx.close();
		void stage;
	}
	{
		const { ctx, page, stage, fetched } = await videoRun('video phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
		await page.locator('[data-flint-video="dark"].playing').waitFor({ timeout: 10000 });
		check(fetched.length > 0 && fetched.every((f) => f.includes('app-dark-mobile')), 'video phone: plays the narrow cut');
		const box = await stage.boundingBox();
		check(box && Math.abs(box.width / box.height - 680 / 900) < 0.02, 'video phone: the figure takes the narrow cut\'s shape');
		check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'video phone: no horizontal page scroll');
		if (shots) await page.screenshot({ path: join(shots, 'video-phone.png') });
		await ctx.close();
	}
	{
		const { ctx, page, stage, fetched } = await videoRun('video reduced motion', { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', colorScheme: 'dark' });
		await page.waitForTimeout(1500);
		check(fetched.length === 0 && (await stage.locator('img').isVisible()), 'video reduced motion: the poster stays, nothing plays');
		await ctx.close();
	}

	// ---- without JavaScript: the static hero only ----
	{
		const ctx = await browser.newContext({ javaScriptEnabled: false });
		const page = await ctx.newPage();
		await page.goto(base);
		check(!(await page.getByRole('link', { name: 'Try the CLI' }).isVisible()), 'no JS: the button is hidden');
		check(await page.locator('.hero .flint-term').isVisible(), 'no JS: the static hero terminal stays');
		check(await page.locator('[data-flint-video="dark"] img').isVisible(), 'no JS: the app video\'s poster shows');
		await ctx.close();
	}
} finally {
	await browser.close();
	server.close();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
