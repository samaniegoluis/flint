// Tests of the Releases page's changelog reader (milestone 33). Run with `npm test`.
// The last test reads the real CHANGELOG.md, so a change to cliff.toml's format that the
// page cannot read fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { anchor, inline, parseChangelog } from './changelog.ts';

const SAMPLE = `# Changelog

What changed in each version of Flint, newest first.

## Unreleased

### Added

- Something not released yet

## 0.2.0 — 2026-12-01

A faster desktop: the graphics pipeline,
drawn with WebGL.

### Added

- **rdp:** The graphics pipeline

### Faster

- **rdp:** Draw with WebGL

## 0.1.1 — 2026-11-20

### Fixed

- A fix with no summary above it

### Added

## 0.1.0 — 2026-11-11

The first one.

### Added

- One
- Two
`;

test('versions newest first, Unreleased skipped', () => {
	const r = parseChangelog(SAMPLE);
	assert.deepEqual(
		r.map((x) => [x.version, x.date, x.id]),
		[
			['0.2.0', '2026-12-01', 'v0-2-0'],
			['0.1.1', '2026-11-20', 'v0-1-1'],
			['0.1.0', '2026-11-11', 'v0-1-0'],
		],
	);
	assert.ok(!JSON.stringify(r).includes('not released'));
});

test('a summary over several lines is one paragraph', () => {
	assert.equal(parseChangelog(SAMPLE)[0].summary, 'A faster desktop: the graphics pipeline, drawn with WebGL.');
});

test('groups keep their order and items; empty groups are dropped', () => {
	const [v020, v011, v010] = parseChangelog(SAMPLE);
	assert.deepEqual(v020.groups, [
		{ title: 'Added', items: ['**rdp:** The graphics pipeline'] },
		{ title: 'Faster', items: ['**rdp:** Draw with WebGL'] },
	]);
	assert.equal(v011.summary, '');
	assert.deepEqual(v011.groups, [{ title: 'Fixed', items: ['A fix with no summary above it'] }]);
	assert.deepEqual(v010.groups[0].items, ['One', 'Two']);
});

test('anchors are safe ids', () => {
	assert.equal(anchor('1.0.0-rc.1'), 'v1-0-0-rc-1');
});

test('inline Markdown: code, bold and links; the rest escaped', () => {
	assert.equal(inline('**gui:** `flint --version` & <b>'), '<strong>gui:</strong> <code>flint --version</code> &amp; &lt;b&gt;');
	assert.equal(inline('see [SemVer](https://semver.org)'), 'see <a href="https://semver.org">SemVer</a>');
	assert.equal(inline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
});

test('the real CHANGELOG.md reads: at least v0.1.0, every release with a list', () => {
	const text = readFileSync(fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url)), 'utf8');
	const r = parseChangelog(text);
	assert.ok(r.some((x) => x.version === '0.1.0'), 'no 0.1.0 in CHANGELOG.md');
	for (const x of r) assert.ok(x.groups.length > 0, `${x.version} has no list`);
	assert.ok(!text.includes('**site:**'), 'site commits are left out of the changelog (D-078)');
});
