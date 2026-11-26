// Links that leave the site open in a new tab, with no opener and no referrer, so a
// visitor reading the docs keeps their place. Links within the site, anchors and
// downloads stay in the tab. Run over every built page (the `external-links`
// integration in astro.config.mjs), so Markdown, MDX and .astro pages all get it with no
// Markdown plugin to install.

/** Whether `href` points off the site (an absolute http or https URL). */
export function isExternal(href) {
	return /^https?:\/\//i.test(href);
}

/** `html` with target="_blank" rel="noopener noreferrer" on each off-site <a> that sets no target. */
export function externalLinks(html) {
	return html.replace(/<a\b([^>]*)>/gi, (tag, attrs) => {
		const href = /\shref\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? '';
		if (!isExternal(href) || /\starget\s*=/i.test(attrs) || /\sdownload\b/i.test(attrs)) return tag;
		const rel = /\srel\s*=\s*"([^"]*)"/i.exec(attrs);
		const words = new Set([...(rel?.[1].split(/\s+/).filter(Boolean) ?? []), 'noopener', 'noreferrer']);
		const rest = rel ? attrs.replace(rel[0], '') : attrs;
		return `<a${rest} target="_blank" rel="${[...words].join(' ')}">`;
	});
}

/** The integration: rewrites every .html file of the build. */
export default function externalLinksIntegration() {
	return {
		name: 'external-links',
		hooks: {
			'astro:build:done': async ({ dir }) => {
				const { readdir, readFile, writeFile } = await import('node:fs/promises');
				const { join } = await import('node:path');
				const { fileURLToPath } = await import('node:url');
				const walk = async (d) => {
					for (const e of await readdir(d, { withFileTypes: true })) {
						const p = join(d, e.name);
						if (e.isDirectory()) await walk(p);
						else if (e.name.endsWith('.html')) {
							const html = await readFile(p, 'utf8');
							const out = externalLinks(html);
							if (out !== html) await writeFile(p, out);
						}
					}
				};
				await walk(fileURLToPath(dir));
			},
		},
	};
}
