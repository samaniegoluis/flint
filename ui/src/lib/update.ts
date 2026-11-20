// The words of the update notice (milestone 52, designs 24c, 24e, 24f, 24i, D-116):
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

/** The action's label: Download for a copy that can be replaced, How to update otherwise. */
export function updateActionLabel(st: UpdateStatus): string {
  return st.action === 'download' ? 'Download' : 'How to update';
}

/** 24c1 / 24c5. */
export function updateToastText(st: UpdateStatus): string {
  return `Flint ${st.version} is available`;
}

/** The text beside the version in the status bar (the owner's change to 24f, D-116). */
export function updateBarLabel(st: UpdateStatus | null): string {
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
    case 'error': return `couldn't check${when}`;
    default: return '';
  }
}

/** The popover's line under the title (24f2). */
export function updatePopoverDetail(st: UpdateStatus): string {
  if (st.state !== 'available') return `You have ${st.current}.`;
  if (st.action === 'download') return `You have ${st.current}. Download it from the release page; nothing changes until you install it.`;
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
