// The Releases page's Download buttons (milestone 51): which system the visitor is on, and
// which files of the latest published release are for it. The page asks GitHub for the
// latest release from the visitor's browser (a draft or a pre-release is never "latest"),
// so a release published after the site was built is offered at once. With no release,
// no package for the system or no script, the page keeps offering Build from source.

export type System = 'macos' | 'windows' | 'linux';

export interface Asset {
	name: string;
	browser_download_url: string;
	size?: number;
}

export interface Release {
	tag_name: string;
	html_url: string;
	draft?: boolean;
	prerelease?: boolean;
	assets: Asset[];
}

export interface Download {
	label: string;
	url: string;
	name: string;
}

/** Each system's packages, named as scripts/package.sh names them (D-111). */
const PACKAGES: Record<System, { test: RegExp; label: string }[]> = {
	macos: [{ test: /^Flint-.+-macos-arm64\.zip$/, label: 'Download for macOS' }],
	windows: [{ test: /^Flint-.+-windows-x86_64\.zip$/, label: 'Download for Windows' }],
	linux: [
		{ test: /^flint_.+_amd64\.deb$/, label: 'Download .deb' },
		{ test: /^flint-.+\.x86_64\.rpm$/, label: 'Download .rpm' },
	],
};

export const SYSTEM_NAME: Record<System, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

export const NEEDS: Record<System, string> = {
	macos: 'For Macs with Apple silicon and macOS 13.3 or later, the flint command inside.',
	windows: 'For 64-bit Windows 10 and 11, the flint command inside.',
	linux: 'For 64-bit Linux: Debian and Ubuntu (.deb), Fedora (.rpm).',
};

/** The visitor's system from the browser, or null for one Flint has no package for (a phone). */
export function detectSystem(userAgent: string, platform = ''): System | null {
	const s = `${platform} ${userAgent}`;
	if (/iPhone|iPad|iPod|Android/i.test(s)) return null;
	if (/Mac/i.test(s)) return 'macos';
	if (/Win/i.test(s)) return 'windows';
	if (/Linux|X11|CrOS/i.test(s)) return /CrOS/i.test(s) ? null : 'linux';
	return null;
}

/** The release's downloads for one system, in the order of PACKAGES; empty when none. */
export function downloadsFor(release: Release, system: System): Download[] {
	if (release.draft || release.prerelease) return [];
	const out: Download[] = [];
	for (const p of PACKAGES[system]) {
		const a = release.assets.find((x) => p.test.test(x.name));
		// Only links into GitHub's own release downloads.
		if (a && a.browser_download_url.startsWith('https://github.com/')) {
			out.push({ label: p.label, url: a.browser_download_url, name: a.name });
		}
	}
	return out;
}

/** "v0.16.0" → "0.16.0". */
export const versionOf = (tag: string) => tag.replace(/^v/, '');
