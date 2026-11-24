// The words of the update notice (milestone 52, designs 24c, 24e, 24f, 24i, D-116) and
// of the self-update (milestone 53: 24c2-24c4, 24d1, 24e3, 24e4, 24f3, D-111):
// the toast, the status bar's version item and its popover, About's Updates block
// and the palette. Kept apart from the views so the wording is tested without React.

import type { UpdateStatus } from '../api/types';
import { agoLabel } from './sync';
import { language, t } from '../i18n';

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
  return t('update.downloading', { version: st.version });
}

/** 24c3. */
export function updateReadyText(st: UpdateStatus): string {
  return t('update.ready', { version: st.version });
}

/**
 * Milestone 54 (D-124): a Linux package (.deb, .rpm) is installed by the package manager
 * as root, so Relaunch asks for the system password first.
 */
export function updateIsPackage(st: UpdateStatus | null): boolean {
  return !!st && /\.(deb|rpm)$/.test(st.asset_url);
}

/** The Ready line's hint (24e3): what Relaunch does. */
export function updateReadyHint(st: UpdateStatus): string {
  if (updateIsPackage(st)) {
    return t('update.ready_hint_package');
  }
  return t('update.ready_hint');
}

/** A Relaunch that installed nothing (milestone 54): its words, and whether the package was kept for another try. */
export function updateRelaunchFailure(st: UpdateStatus): { text: string; kept: boolean } {
  const kept = st.state === 'ready';
  const version = st.version;
  if (st.code === 'denied') return { text: t('update.not_installed_denied', { version }), kept };
  if (!kept) return { text: t('update.discarded', { version }), kept };
  return { text: st.message ? t('update.install_failed_why', { version, why: st.message }) : t('update.install_failed', { version }), kept };
}

/** A download that failed (24c4a, 24c4b): its toast's words, and whether Retry makes sense. */
export function updateDownloadFailure(st: UpdateStatus): { text: string; retry: boolean } {
  switch (st.code) {
    case 'invalid': return { text: t('update.discarded', { version: st.version }), retry: false };
    case 'network': return { text: t('update.download_failed_network', { version: st.version }), retry: true };
    case 'timeout': return { text: t('update.download_failed_stalled', { version: st.version }), retry: true };
    case 'io': return { text: t('update.download_failed_why', { version: st.version, why: st.message }), retry: true };
    default: return { text: st.message ? t('update.download_failed_why', { version: st.version, why: st.message }) : t('update.download_failed', { version: st.version }), retry: true };
  }
}

/** 24d1: what closes when Flint relaunches; "" when nothing does (Relaunch goes straight through). */
export function relaunchClosesText(sessions: number, tunnels: number, commands = 0): string {
  const s = t('update.n_sessions', { count: sessions }), tn = t('update.n_tunnels', { count: tunnels });
  const closes = sessions > 0 && tunnels > 0 ? t('update.will_close_both', { sessions: s, tunnels: tn })
    : sessions > 0 ? t('update.will_close', { what: s }) : tunnels > 0 ? t('update.will_close', { what: tn }) : '';
  // Milestone 50: a `flint exec` or `connect` running through Flint is cut when it quits.
  const stops = commands > 0 ? t('update.commands_will_stop', { count: commands }) : '';
  return [closes, stops].filter(Boolean).join(' ');
}

/** The action's label: Download for a copy that can be replaced, How to update otherwise; Relaunch once it is ready. */
export function updateActionLabel(st: UpdateStatus): string {
  if (st.state === 'ready') return t('update.relaunch');
  return st.action === 'download' ? t('update.download') : t('update.how_to_update');
}

/** 24c1 / 24c5. */
export function updateToastText(st: UpdateStatus): string {
  return t('update.available', { version: st.version });
}

/** The text beside the version in the status bar (the owner's change to 24f, D-116). */
export function updateBarLabel(st: UpdateStatus | null, received = 0): string {
  if (updateReady(st)) return t('update.relaunch');
  if (st && updateDownloading(st)) return `${updatePercent(received, st.asset_size)}%`;
  return updateAvailable(st) ? t('update.update') : '';
}

/** The release dates' locale: English keeps the day first ("18 Nov"), as before 67. */
function dateLocale(): string {
  const l = language();
  return l === 'en' ? 'en-GB' : l;
}

/** "18 Nov" from "2026-11-18"; the text as given when it is not a date. */
export function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
}

/** "18 Nov 2026". */
export function longDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Why the last check failed, in a few words. */
export function updateErrorText(st: UpdateStatus): string {
  switch (st.code) {
    case 'network': return t('update.check_failed_network');
    case 'timeout': return t('update.check_failed_timeout');
    case 'not_found': return t('update.check_failed_not_found');
    case 'invalid': return t('update.check_failed_invalid');
    default: return t('update.check_failed');
  }
}

/** The state line: About's Updates block (24e), the popover (24f) and the palette (24i). */
export function updateStateLine(st: UpdateStatus | null, now: number): string {
  if (!st) return '';
  const checked = st.checked_at > 0 ? t('update.last_checked', { ago: agoLabel(st.checked_at, now) }) : '';
  switch (st.state) {
    case 'checking': return t('update.checking');
    case 'up_to_date': return t('update.up_to_date') + checked;
    case 'available': return st.date ? t('update.available_released', { version: st.version, date: shortDate(st.date) }) : t('update.available', { version: st.version });
    case 'downloading': return t('update.downloading', { version: st.version });
    case 'ready': return t('update.ready_verified', { version: st.version });
    case 'error': return updateErrorText(st) + checked;
    default: return st.auto ? t('update.not_checked_yet') : t('update.auto_check_off');
  }
}

/** The palette's line under "Check for updates" (24i): "up to date · checked 10 min ago". */
export function updatePaletteHint(st: UpdateStatus | null, now: number): string {
  if (!st) return '';
  const when = st.checked_at > 0 ? t('update.hint.checked', { ago: agoLabel(st.checked_at, now) }) : '';
  switch (st.state) {
    case 'checking': return t('update.hint.checking');
    case 'up_to_date': return t('update.hint.up_to_date') + when;
    case 'available': return t('update.hint.available', { version: st.version });
    case 'downloading': return t('update.hint.downloading', { version: st.version });
    case 'ready': return t('update.hint.ready', { version: st.version });
    case 'error': return t('update.hint.check_failed') + when;
    default: return '';
  }
}

/** The popover's line under the title (24f2). */
export function updatePopoverDetail(st: UpdateStatus): string {
  if (st.state === 'ready') return t('update.popover.ready');
  if (st.state === 'downloading') return t('update.popover.downloading', { current: st.current });
  if (st.state !== 'available') return t('update.popover.current', { current: st.current });
  if (st.action === 'download') return t('update.popover.download', { current: st.current });
  return t('update.popover.how', { current: st.current, how: updateHowText(st) });
}

/** How to update (24c5, 24e5): why this copy is not replaced from here, and what to do. */
export function updateHowText(st: UpdateStatus): string {
  switch (st.how) {
    case 'package': return t('update.how.package');
    case 'repository': return t('update.how.repository');
    case 'source': return t('update.how.source');
    case 'readonly': return t('update.how.readonly');
    case 'no_asset': return t('update.how.no_asset');
    default: return '';
  }
}
