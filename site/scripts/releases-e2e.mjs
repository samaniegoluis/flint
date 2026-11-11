// Headless check of the Releases page (milestone 33, D-078), against the built site in
// dist/: the versions from CHANGELOG.md, the list to jump to, folded long lists, the
// header link, both themes, and no horizontal scroll at phone width.
//
//   npm run build && npm run test:releases
//
// Chromium as in demo-e2e.mjs (scripts/chromium.mjs). Screenshots go to $RELEASES_SHOTS
// when it is set.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findChromium } from './chromium.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const changelog = readFileSync(fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url)), 'utf8');
const versions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+\S*) — /gm)].map((m) => m[1]);
const shots = process.env.RELEASES_SHOTS;
let failures = 0;
let checks = 0;

function check(ok, what) {
	checks++;
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp' };
const server = createServer((req, res) => {
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
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

async function open(viewport, theme) {
	const ctx = await browser.newContext({ viewport, colorScheme: theme });
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	return { ctx, page, errors };
}

try {
	check(versions.length > 0, `CHANGELOG.md has versions (${versions.join(', ')})`);

	for (const theme of ['dark', 'light']) {
		// ---- desktop ----
		const { ctx, page, errors } = await open({ width: 1280, height: 900 }, theme);
		await page.goto(base);
		const link = page.locator('header a.flint-header-link');
		check(await link.isVisible(), `${theme} desktop: the header shows "Releases" on the landing`);
		await link.click();
		await page.waitForURL(/\/releases\/$/);
		check(true, `${theme} desktop: the header link opens /releases/`);
		check((await link.getAttribute('aria-current')) === 'page', `${theme} desktop: the link is current on the page`);
		check((await page.locator('html').getAttribute('data-theme')) === theme, `${theme} desktop: the page follows the system theme`);

		const titles = await page.locator('.flint-release h2').allInnerTexts();
		check(JSON.stringify(titles) === JSON.stringify(versions), `${theme} desktop: every version, newest first, in CHANGELOG.md's order`);
		const navItems = await page.locator('.flint-releases__nav .v').allInnerTexts();
		check(JSON.stringify(navItems) === JSON.stringify(versions), `${theme} desktop: the list to jump to names every version`);
		check((await page.locator('.flint-release').first().locator('.flint-releases__latest').count()) === 1, `${theme} desktop: the newest is marked Latest`);
		check(await page.locator('.flint-releases__get a[href="/start/build-from-source/"]').isVisible(), `${theme} desktop: Build from source is offered`);
		check(/downloads coming soon/i.test(await page.locator('.flint-releases__get').innerText()), `${theme} desktop: downloads are announced as coming soon`);
		const summary = await page.locator('.flint-release__summary').first().innerText();
		check(summary.length > 40, `${theme} desktop: the newest release shows its summary`);
		check(/^added/i.test(await page.locator('.flint-release__group h3').first().innerText()), `${theme} desktop: its lists start with Added`);
		check(!/\*\*|`/.test(await page.locator('.flint-releases__list').innerText()), `${theme} desktop: no raw Markdown on the page`);
		const navPos = await page.locator('.flint-releases__nav').evaluate((n) => getComputedStyle(n).position);
		check((await page.locator('.pagination-links a').count()) === 0, `${theme} desktop: no previous/next page links under the releases`);
		check(navPos === 'sticky', `${theme} desktop: the list to jump to stays beside the releases`);

		// Long lists fold; "Show N more" opens them.
		const details = page.locator('.flint-release details').first();
		if ((await details.count()) > 0) {
			const hidden = await details.locator('li').first().isVisible();
			check(!hidden, `${theme} desktop: a long list is folded after its first items`);
			await details.locator('summary').click();
			check(await details.locator('li').first().isVisible(), `${theme} desktop: "Show more" unfolds it`);
			check((await details.locator('summary').innerText()).includes('Show fewer'), `${theme} desktop: and offers "Show fewer"`);
		} else {
			check(true, `${theme} desktop: no list long enough to fold`);
		}

		// Jumping to the oldest version.
		const last = versions[versions.length - 1];
		await page.locator(`.flint-releases__nav a`).last().click();
		await page.waitForFunction((id) => location.hash === `#${id}`, `v${last.replace(/[^0-9A-Za-z]+/g, '-')}`);
		const top = await page.locator('.flint-release').last().evaluate((el) => el.getBoundingClientRect().top);
		check(top >= 0 && top < 300, `${theme} desktop: jumping to ${last} brings it to the top (top=${Math.round(top)})`);
		if (shots) {
			await page.goto(base + 'releases/');
			await page.screenshot({ path: join(shots, `releases-desktop-${theme}.png`) });
			await page.screenshot({ path: join(shots, `releases-desktop-${theme}-full.png`), fullPage: true });
		}
		check(errors.length === 0, `${theme} desktop: no script errors${errors.length ? ': ' + errors.join('; ') : ''}`);
		await ctx.close();

		// ---- phone ----
		{
			const { ctx, page, errors } = await open({ width: 375, height: 812 }, theme);
			await page.goto(base);
			check(await page.locator('header a.flint-header-link').isVisible(), `${theme} phone: the header shows "Releases"`);
			await page.goto(base + 'releases/');
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
			check(overflow <= 0, `${theme} phone: no horizontal scroll (overflow ${overflow}px)`);
			const navPos = await page.locator('.flint-releases__nav').evaluate((n) => getComputedStyle(n).position);
			check(navPos === 'static', `${theme} phone: the versions become a row above the list`);
			await page.locator('.flint-release details summary').first().click().catch(() => {});
			const overflowOpen = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
			check(overflowOpen <= 0, `${theme} phone: no horizontal scroll with a list unfolded`);
			if (shots) {
				await page.goto(base + 'releases/');
				await page.screenshot({ path: join(shots, `releases-phone-${theme}.png`) });
			}
			check(errors.length === 0, `${theme} phone: no script errors${errors.length ? ': ' + errors.join('; ') : ''}`);
			await ctx.close();
		}
	}

	// The sidebar's Reference → Releases entry leads to the page.
	{
		const { ctx, page } = await open({ width: 1280, height: 900 }, 'dark');
		await page.goto(base + 'reference/cli/');
		const entry = page.locator('.sidebar-content a[href="/releases/"]');
		check((await entry.count()) === 1, 'the docs sidebar links Releases');
		const old = await page.goto(base + 'reference/changelog/');
		check(old.status() === 404, 'the copied Changelog page is gone');
		await ctx.close();
	}
} finally {
	await browser.close();
	server.close();
}

console.log(`releases-e2e: ${checks - failures}/${checks}`);
process.exit(failures === 0 ? 0 : 1);
