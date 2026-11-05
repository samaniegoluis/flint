// Headless check of the landing's CLI demo (D-026), against the built site in dist/.
//
//   npm run build && npm run test:e2e
//
// Uses playwright-core with a Chromium already on the machine: $FLINT_CHROMIUM, the
// one matching playwright-core, or the newest one in the Playwright cache
// (`npx playwright install chromium-headless-shell` puts one there).
// Screenshots go to $DEMO_SHOTS when it is set.
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const shots = process.env.DEMO_SHOTS;
let failures = 0;
let checks = 0;

function check(ok, what) {
	checks++;
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

function findChromium() {
	if (process.env.FLINT_CHROMIUM) return process.env.FLINT_CHROMIUM;
	if (existsSync(chromium.executablePath())) return undefined;
	const roots = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')];
	const found = [];
	const walk = (dir, depth) => {
		if (depth > 4 || !existsSync(dir)) return;
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (name === 'chrome-headless-shell' || name === 'chrome') {
				if (statSync(p).isFile()) found.push(p);
			} else if (!name.endsWith('.app') && statSync(p).isDirectory()) {
				walk(p, depth + 1);
			}
		}
	};
	roots.forEach((r) => walk(r, 0));
	found.sort();
	if (found.length === 0) throw new Error('no Chromium found; set FLINT_CHROMIUM');
	return found[found.length - 1];
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
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
		check((await page.locator('[data-step]').innerText()) === 'Step 1 of 8', 'desktop: the bar shows the tour step');
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
		await type(page, 'flint connect db');
		await type(page, 'yes');
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
		await type(page, 'flint host list --json');
		const all = await logText(page);
		check(all.includes("That's the tour"), 'desktop: the tour reaches its end');
		check(all.includes('Welcome to Ubuntu'), 'desktop: the remote shell greeted');
		check(!(await page.content()).includes('secret-typed-in-e2e'), 'desktop: the typed password is nowhere in the page');
		check(all.includes('"alias":"my-server"'), 'desktop: the added host is in --json');
		await page.keyboard.press('ArrowUp');
		check((await page.locator('#cli-demo-input').inputValue()) === 'flint host list --json', 'desktop: ↑ recalls the last command');
		if (shots) await page.screenshot({ path: join(shots, 'demo-desktop.png') });
		await page.keyboard.press('Escape');
		check(!(await dialog.isVisible()), 'desktop: Esc closes the demo');
		check(await page.evaluate(() => document.activeElement?.textContent?.includes('Try the CLI')), 'desktop: focus returns to the button');
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

	// ---- without JavaScript: the static hero only ----
	{
		const ctx = await browser.newContext({ javaScriptEnabled: false });
		const page = await ctx.newPage();
		await page.goto(base);
		check(!(await page.getByRole('link', { name: 'Try the CLI' }).isVisible()), 'no JS: the button is hidden');
		check(await page.locator('.hero .flint-term').isVisible(), 'no JS: the static hero terminal stays');
		await ctx.close();
	}
} finally {
	await browser.close();
	server.close();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
