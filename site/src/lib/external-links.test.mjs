import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalLinks } from './external-links.mjs';

test('an off-site link opens in a new tab with no opener; the rest are left alone', () => {
	assert.equal(externalLinks('<a href="https://github.com/samaniegoluis/flint">GitHub</a>'),
		'<a href="https://github.com/samaniegoluis/flint" target="_blank" rel="noopener noreferrer">GitHub</a>');
	assert.equal(externalLinks('<a class="x" href="https://ntfy.sh" rel="me">ntfy</a>'),
		'<a class="x" href="https://ntfy.sh" target="_blank" rel="me noopener noreferrer">ntfy</a>');
	for (const same of ['<a href="/guides/hosts/">Hosts</a>', '<a href="#install">Install</a>', '<a href="mailto:a@example.com">mail</a>',
		'<a href="https://x.example" target="_self">x</a>', '<a href="https://x.example/flint.zip" download>zip</a>', '<abbr title="x">x</abbr>']) {
		assert.equal(externalLinks(same), same);
	}
});
