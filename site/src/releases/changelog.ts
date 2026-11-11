// Reads CHANGELOG.md (written by scripts/release.sh with git-cliff, D-077) into the
// versions the Releases page shows (milestone 33, D-078). The format it expects is
// cliff.toml's body: `## X.Y.Z — YYYY-MM-DD`, an optional summary paragraph, then
// `### Added` / `### Fixed` / `### Faster` lists of `- ` items. An `## Unreleased` section
// is skipped: the page shows releases only.

export interface ReleaseGroup {
	title: string;
	items: string[];
}

export interface Release {
	version: string;
	date: string;
	/** The anchor on the page: `v0-1-0`. */
	id: string;
	summary: string;
	groups: ReleaseGroup[];
}

const VERSION = /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?) — (\d{4}-\d{2}-\d{2})\s*$/;

export function anchor(version: string): string {
	return 'v' + version.replace(/[^0-9A-Za-z]+/g, '-');
}

export function parseChangelog(text: string): Release[] {
	const releases: Release[] = [];
	let current: Release | null = null;
	let group: ReleaseGroup | null = null;
	let summary: string[] = [];
	let skipping = false;

	const finish = () => {
		if (current) {
			current.summary = summary.join(' ').replace(/\s+/g, ' ').trim();
			current.groups = current.groups.filter((g) => g.items.length > 0);
			releases.push(current);
		}
		current = null;
		group = null;
		summary = [];
	};

	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trimEnd();
		if (line.startsWith('## ')) {
			finish();
			const m = VERSION.exec(line);
			skipping = !m;
			if (m) current = { version: m[1], date: m[2], id: anchor(m[1]), summary: '', groups: [] };
			continue;
		}
		if (skipping || !current) continue;
		if (line.startsWith('### ')) {
			group = { title: line.slice(4).trim(), items: [] };
			current.groups.push(group);
		} else if (line.startsWith('- ') && group) {
			group.items.push(line.slice(2).trim());
		} else if (line.trim() !== '' && !group) {
			summary.push(line.trim());
		}
	}
	finish();
	return releases;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * The inline Markdown a changelog line uses, as HTML: `code`, **bold** and
 * [links](https://…). Everything else is escaped; a link must be http(s) or site-relative.
 */
export function inline(text: string): string {
	const out: string[] = [];
	const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
	let last = 0;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		out.push(escape(text.slice(last, m.index)));
		if (m[1] !== undefined) out.push(`<code>${escape(m[1])}</code>`);
		else if (m[2] !== undefined) out.push(`<strong>${escape(m[2])}</strong>`);
		else if (/^(https?:\/\/|\/)/.test(m[4])) out.push(`<a href="${escape(m[4])}">${escape(m[3])}</a>`);
		else out.push(escape(m[0]));
		last = re.lastIndex;
	}
	out.push(escape(text.slice(last)));
	return out.join('');
}
