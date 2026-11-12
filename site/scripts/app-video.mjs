// A short video of the desktop app for the landing, recorded from the real UI build.
//
//   (cd ../ui && npm run build) && npm run shots:video [-- --out <dir>]
//
// Serves ../ui/dist with the RPC bridge stubbed (app-stub.mjs), plays a script (open a
// host from the palette, type a command, split the tab, exit, lock and unlock the vault)
// and records it through Chromium's screencast, one lossless frame per repaint. ffmpeg
// turns the frames into WebM (VP9) and MP4 (H.264) for each theme and two cuts: `desktop`
// (1280×720) and `mobile` (680×900 with a larger terminal font: the narrowest window the
// palette fits). Each also gets a poster (its first frame) and a timeline of the shortcuts
// pressed, which the page shows as keycaps under the video. The video loops: it starts
// and ends on the same screen, db open as in the landing's screenshots.
// Writes src/assets/video/app-<theme>-<cut>.{webm,mp4,png,json}.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findChromium } from './chromium.mjs';
import { base, server, catalog, recents, listing, homes, tunnelList, stub, screens, prompt } from './app-stub.mjs';

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const outDir = outArg >= 0 ? resolve(args[outArg + 1]) : fileURLToPath(new URL('../src/assets/video/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const cuts = [
	{ name: 'desktop', width: 1280, height: 720, termFontSize: 13, scale: 1600 },
	{ name: 'mobile', width: 680, height: 900, termFontSize: 17, scale: 1020 },
];

const videoScreens = {
	db: screens.db,
	'web-01': ['Linux web-01 6.8.0-45-generic x86_64', 'Last login: Thu Nov  5 10:41:12 2026 from 10.0.0.2', '', prompt('deploy', 'web-01')],
};
const prompts = { 'web-01': prompt('deploy', 'web-01'), db: prompt('admin', 'db') };

// Typing that reads as a person's: a fixed, uneven rhythm, the same on every run.
const rhythm = [92, 71, 118, 64, 85, 103, 77, 69, 124, 88, 59, 97];
let beat = 0;
async function type(page, text, scale = 1) {
	for (const ch of text) {
		await page.keyboard.type(ch);
		await page.waitForTimeout(rhythm[beat++ % rhythm.length] * scale);
	}
}

async function record(cut, theme) {
	const browser = await chromium.launch({ executablePath: findChromium() });
	const page = await browser.newPage({ viewport: { width: cut.width, height: cut.height }, deviceScaleFactor: 2, colorScheme: theme });
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.addInitScript(stub, {
		catalog, recents, screens: videoScreens, theme, listing, homes, tunnelList,
		video: { connectMs: 650, prompts, termFontSize: cut.termFontSize },
	});
	await page.goto(base);
	// The first screen: db open, as in the landing's screenshot. Opened from the palette,
	// since a narrow window hides the host tree.
	await page.getByText('No open sessions').waitFor();
	await page.keyboard.press('Meta+k');
	await page.keyboard.type('db');
	await page.keyboard.press('Enter');
	await page.waitForTimeout(1500);
	await page.mouse.move(0, 0);

	const cdp = await page.context().newCDPSession(page);
	const frames = [];
	cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
		frames.push({ t: metadata.timestamp, data });
		cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
	});
	const keys = [];
	const press = async (combo, label) => {
		keys.push({ t: Date.now() / 1000, key: label });
		await page.keyboard.press(combo);
	};
	await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
	const start = Date.now() / 1000;
	const hold = (ms) => page.waitForTimeout(ms);

	await hold(1400);
	await press('Meta+k', '⌘K');
	await hold(350);
	await type(page, 'web', 1.4);
	await hold(500);
	await press('Enter', '↵');
	await hold(1300);
	await type(page, 'echo "Welcome to Flint"');
	await hold(250);
	await press('Enter', '↵');
	await hold(1500);
	// Split the tab: a second pane on web-01, then close both.
	await press('Meta+d', '⌘D');
	await hold(1300);
	await type(page, 'uptime');
	await hold(250);
	await press('Enter', '↵');
	await hold(1500);
	await type(page, 'exit');
	await press('Enter', '↵');
	await hold(900);
	await press('Meta+w', '⌘W');
	await hold(700);
	await type(page, 'exit');
	await press('Enter', '↵');
	await hold(1000);
	await press('Meta+w', '⌘W');
	await hold(900);
	await press('Meta+l', '⌘L');
	await hold(900);
	await type(page, 'correct horse', 0.8);
	await hold(300);
	await press('Enter', '↵');
	await hold(1600);

	const end = Date.now() / 1000;
	await cdp.send('Page.stopScreencast');
	await browser.close();
	if (errors.length) throw new Error(`page errors (${theme} ${cut.name}): ${errors.join('; ')}`);
	return { frames, keys: keys.map((k) => ({ t: +(k.t - start).toFixed(3), key: k.key })), start, end };
}

function encode(cut, theme, { frames, keys, start, end }) {
	const name = `app-${theme}-${cut.name}`;
	const work = join(outDir, `.frames-${name}`);
	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });
	// Each frame lasts until the next repaint; the first is held from the start.
	const list = [];
	const shown = frames.filter((f) => f.t >= start - 0.05);
	shown.forEach((f, i) => {
		const file = join(work, `${String(i).padStart(5, '0')}.png`);
		writeFileSync(file, Buffer.from(f.data, 'base64'));
		const from = i === 0 ? start : f.t;
		const to = i + 1 < shown.length ? shown[i + 1].t : end;
		list.push(`file '${file}'`, `duration ${Math.max(to - from, 0.001).toFixed(4)}`);
	});
	list.push(`file '${join(work, `${String(shown.length - 1).padStart(5, '0')}.png`)}'`);
	writeFileSync(join(work, 'list.txt'), list.join('\n') + '\n');
	const vf = `fps=30,scale=${cut.scale}:-2:flags=lanczos,format=yuv420p`;
	const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), ...a], { stdio: 'inherit' });
	ff('-vf', vf, '-c:v', 'libvpx-vp9', '-crf', '38', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', join(outDir, `${name}.webm`));
	ff('-vf', vf, '-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-tune', 'stillimage', '-movflags', '+faststart', '-an', join(outDir, `${name}.mp4`));
	execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(work, '00000.png'), '-vf', `scale=${cut.scale}:-2:flags=lanczos`, join(outDir, `${name}.png`)]);
	writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ duration: +(end - start).toFixed(3), keys }, null, '\t') + '\n');
	rmSync(work, { recursive: true, force: true });
	const kb = (f) => Math.round(statSync(join(outDir, f)).size / 1024);
	console.log(`${name}: ${(end - start).toFixed(1)} s, ${shown.length} frames; webm ${kb(`${name}.webm`)} KB, mp4 ${kb(`${name}.mp4`)} KB, poster ${kb(`${name}.png`)} KB`);
}

try {
	for (const theme of ['dark', 'light']) for (const cut of cuts) encode(cut, theme, await record(cut, theme));
} finally {
	server.close();
}
