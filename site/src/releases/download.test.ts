// Tests of the Releases page's Download buttons (milestone 51). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNING, detectSystem, downloadsFor, othersFor, versionOf, type Release } from './download.ts';

const GH = 'https://github.com/samaniegoluis/flint/releases/download/v0.16.0/';
const release = (names: string[], extra: Partial<Release> = {}): Release => ({
	tag_name: 'v0.16.0',
	html_url: 'https://github.com/samaniegoluis/flint/releases/tag/v0.16.0',
	assets: names.map((name) => ({ name, browser_download_url: GH + name })),
	...extra,
});
const ALL = [
	'Flint-0.16.0-macos-arm64.zip',
	'Flint-0.16.0-windows-x86_64.zip',
	'flint_0.16.0_amd64.deb',
	'flint-0.16.0.x86_64.rpm',
	'SHA256SUMS',
	'manifest.json',
];

test('the system from the browser', () => {
	assert.equal(detectSystem('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel'), 'macos');
	assert.equal(detectSystem('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32'), 'windows');
	assert.equal(detectSystem('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64'), 'linux');
	assert.equal(detectSystem('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone'), null);
	assert.equal(detectSystem('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Linux armv8l'), null);
	assert.equal(detectSystem('Mozilla/5.0 (X11; CrOS x86_64 16000.0.0)', 'Linux x86_64'), null);
	assert.equal(detectSystem('', ''), null);
});

test('each system gets its own packages', () => {
	const r = release(ALL);
	assert.deepEqual(downloadsFor(r, 'macos').map((d) => d.name), ['Flint-0.16.0-macos-arm64.zip']);
	assert.deepEqual(downloadsFor(r, 'windows').map((d) => d.name), ['Flint-0.16.0-windows-x86_64.zip']);
	assert.deepEqual(downloadsFor(r, 'linux').map((d) => d.name), ['flint_0.16.0_amd64.deb', 'flint-0.16.0.x86_64.rpm']);
	assert.equal(downloadsFor(r, 'macos')[0].url, GH + 'Flint-0.16.0-macos-arm64.zip');
	assert.equal(downloadsFor(r, 'macos')[0].label, 'Download for macOS');
});

test('a system with no package in the release gets nothing', () => {
	const r = release(['Flint-0.16.0-macos-arm64.zip', 'SHA256SUMS']);
	assert.deepEqual(downloadsFor(r, 'windows'), []);
	assert.deepEqual(downloadsFor(r, 'linux'), []);
});

test('a draft or a pre-release is never offered', () => {
	assert.deepEqual(downloadsFor(release(ALL, { draft: true }), 'macos'), []);
	assert.deepEqual(downloadsFor(release(ALL, { prerelease: true }), 'macos'), []);
});

test('only links into GitHub', () => {
	const r = release([]);
	r.assets.push({ name: 'Flint-0.16.0-macos-arm64.zip', browser_download_url: 'https://evil.example/Flint.zip' });
	assert.deepEqual(downloadsFor(r, 'macos'), []);
});

test('the version from the tag', () => {
	assert.equal(versionOf('v0.16.0'), '0.16.0');
});

test('the other systems that have a package, in a fixed order', () => {
	const names = (o: ReturnType<typeof othersFor>) => o.map((x) => `${x.system}:${x.downloads.map((d) => d.short).join(',')}`);
	assert.deepEqual(names(othersFor(release(ALL), 'macos')), ['windows:zip', 'linux:.deb,.rpm']);
	assert.deepEqual(names(othersFor(release(ALL), 'linux')), ['macos:zip', 'windows:zip']);
	assert.deepEqual(names(othersFor(release(ALL), null)), ['macos:zip', 'windows:zip', 'linux:.deb,.rpm']);
	assert.deepEqual(names(othersFor(release(['Flint-0.16.0-macos-arm64.zip']), 'macos')), []);
	assert.deepEqual(othersFor(release(ALL, { prerelease: true }), 'macos'), []);
});

test('the unsigned note fits each system', () => {
	assert.match(SIGNING.macos.text + ' ' + SIGNING.macos.link, /extra step/);
	assert.match(SIGNING.windows.text + ' ' + SIGNING.windows.link, /SmartScreen.*Run anyway/);
	assert.doesNotMatch(SIGNING.linux.text + ' ' + SIGNING.linux.link, /extra step|code-signed/);
	assert.match(SIGNING.linux.text, /apt or dnf/);
});
