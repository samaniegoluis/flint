// The Chromium the site's headless scripts run: $FLINT_CHROMIUM, the one matching
// playwright-core, or the newest one in the Playwright cache
// (`npx playwright install chromium-headless-shell` puts one there).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

export function findChromium() {
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
