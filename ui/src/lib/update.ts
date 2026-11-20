// The words of the update notice (milestone 52, designs 24c, 24e, 24f, 24i, D-116) and
// of the self-update (milestone 53: 24c2-24c4, 24d1, 24e3, 24e4, 24f3, D-111):
// the toast, the status bar's version item and its popover, About's Updates block
// and the palette. Kept apart from the views so the wording is tested without React.

import type { UpdateStatus } from '../api/types';
import { agoLabel } from './sync';

/** The toast's key: the update's toasts replace each other in place (24c). */
export const UPDATE_TOAST_KEY = 'update';

/** The docs page on updates, for How to update. */
export const UPDATES_DOCS_URL = 'https://flint-2xk.pages.dev/guides/updates/';
export const CHANGELOG_URL = 'https://github.com/samaniegoluis/flint/blob/main/CHANGELOG.md';

export function updateAvailable(st: UpdateStatus | null): st is UpdateStatus {
  return !!st && st.state === 'available';
}

/** Milestone 53: the package is downloading, or downloaded, verified and unpacked. */
export function updateDownloading(st: UpdateStatus | null): boolean {
  return !!st && st.state === 'downloading';
}

export function updateReady(st: UpdateStatus | null): boolean {
  return !!st && st.state === 'ready';
}

/** Something to do about a newer version: shown beside the version in the status bar. */
export function updatePending(st: UpdateStatus | null): boolean {
  return updateAvailable(st) || updateDownloading(st) || updateReady(st);
}

/** The download's percentage, 0-100 (whole numbers; 99 until the last byte). */
export function updatePercent(received: number, total: number): number {
  if (total <= 0 || received <= 0) return 0;
  if (received >= total) return 100;
  return Math.min(99, Math.floor((received * 100) / total));
}

/** 24c2. */
export function updateDownloadingText(st: UpdateStatus): string {
  return `Downloading Flint ${st.version}`;
}

/** 24c3. */
export function updateReadyText(st: UpdateStatus): string {
  return `Flint ${st.version} is ready`;
}

/** A download that failed (24c4a, 24c4b): its toast's words, and whether Retry makes sense. */
export function updateDownloadFailure(st: UpdateStatus): { text: string; retry: boolean } {
  switch (st.code) {
    case 'invalid': return { text: `Flint ${st.version} didn't pass verification and was discarded`, retry: false };
    case 'network': return { text: `Couldn't download Flint ${st.version} · no connection`, retry: true };
    case 'timeout': return { text: `Couldn't download Flint ${st.version} · the download stalled`, retry: true };
    case 'io': return { text: `Couldn't download Flint ${st.version} · ${st.message}`, retry: true };
    default: return { text: `Couldn't download Flint ${st.version}${st.message ? ` · ${st.message}` : ''}`, retry: true };
  }
}

/** 24d1: what closes when Flint relaunches; "" when nothing does (Relaunch goes straight through). */
export function relaunchClosesText(sessions: number, tunnels: number): string {
  const parts: string[] = [];
  if (sessions > 0) parts.push(`${sessions} session${sessions === 1 ? '' : 's'}`);
  if (tunnels > 0) parts.push(`${tunnels} tunnel${tunnels === 1 ? '' : 's'}`);
  if (parts.length === 0) return '';
  return `${parts.join(' and ')} will close.`;
}

/** The action's label: Download for a copy that can be replaced, How to update otherwise; Relaunch once it is ready. */
export function updateActionLabel(st: UpdateStatus): string {
  if (st.state === 'ready') return 'Relaunch';
  return st.action === 'download' ? 'Download' : 'How to update';
}

/** 24c1 / 24c5. */
export function updateToastText(st: UpdateStatus): string {
  return `Flint ${st.version} is available`;
}

/** The text beside the version in the status bar (the owner's change to 24f, D-116). */
export function updateBarLabel(st: UpdateStatus | null, received = 0): string {
  if (updateReady(st)) return 'Relaunch';
  if (st && updateDownloading(st)) return `${updatePercent(received, st.asset_size)}%`;
  return updateAvailable(st) ? 'Update' : '';
}

/** "18 Nov" from "2026-11-18"; the text as given when it is not a date. */
export function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "18 Nov 2026". */
export function longDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Why the last check failed, in a few words. */
export function updateErrorText(st: UpdateStatus): string {
  switch (st.code) {
    case 'network': return "Couldn't check · no connection";
    case 'timeout': return "Couldn't check · the server didn't answer";
    case 'not_found': return "Couldn't check · no release has update information yet";
    case 'invalid': return "Couldn't check · the update information didn't pass verification";
    default: return "Couldn't check for updates";
  }
}

/** The state line: About's Updates block (24e), the popover (24f) and the palette (24i). */
export function updateStateLine(st: UpdateStatus | null, now: number): string {
  if (!st) return '';
  const checked = st.checked_at > 0 ? ` · last checked ${agoLabel(st.checked_at, now)}` : '';
  switch (st.state) {
    case 'checking': return 'Checking for updates…';
    case 'up_to_date': return `Up to date${checked}`;
    case 'available': return `Flint ${st.version} is available${st.date ? ` · released ${shortDate(st.date)}` : ''}`;
    case 'downloading': return `Downloading Flint ${st.version}`;
    case 'ready': return `Flint ${st.version} is ready · verified`;
    case 'error': return updateErrorText(st) + checked;
    default: return st.auto ? 'Not checked yet' : 'Automatic check is off';
  }
}

/** The palette's line under "Check for updates" (24i): "up to date · checked 10 min ago". */
export function updatePaletteHint(st: UpdateStatus | null, now: number): string {
  if (!st) return '';
  const when = st.checked_at > 0 ? ` · checked ${agoLabel(st.checked_at, now)}` : '';
  switch (st.state) {
    case 'checking': return 'checking…';
    case 'up_to_date': return `up to date${when}`;
    case 'available': return `${st.version} is available`;
    case 'downloading': return `downloading ${st.version}…`;
    case 'ready': return `${st.version} is ready: relaunch to update`;
    case 'error': return `couldn't check${when}`;
    default: return '';
  }
}

/** The popover's line under the title (24f2). */
export function updatePopoverDetail(st: UpdateStatus): string {
  if (st.state === 'ready') return 'Downloaded and verified. Relaunch when it suits you; nothing changes until then.';
  if (st.state === 'downloading') return `You have ${st.current}. Nothing changes until you relaunch.`;
  if (st.state !== 'available') return `You have ${st.current}.`;
  if (st.action === 'download') return `You have ${st.current}. Download it here; nothing changes until you relaunch.`;
  return `You have ${st.current}. ${updateHowText(st)}`;
}

/** How to update (24c5, 24e5): why this copy is not replaced from here, and what to do. */
export function updateHowText(st: UpdateStatus): string {
  switch (st.how) {
    case 'package': return 'This copy was installed from a .deb or .rpm package: download the new package from the release page and install it the same way.';
    case 'source': return 'This copy was built from source: pull the new version and build it again.';
    case 'readonly': return "Flint can't replace this copy where it is: download the new version from the release page and replace it.";
    case 'no_asset': return 'This release has no package for your system: build it from source, or download it from the release page.';
    default: return '';
  }
}
