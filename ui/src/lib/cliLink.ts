// The words of the `flint` command's offer and of About's Command line row
// (milestone 48, D-111 (2)). Kept apart from the views so the wording is tested
// without React.

import type { CliLinkSpot, CliLinkStatus } from '../api/types';

const tilde = (path: string) => path.replace(/^\/(Users|home)\/[^/]+\//, '~/');

/** The toast's key: an offer and its result replace each other in place. */
export const CLI_TOAST_KEY = 'cli-link';

/** What the first launch's toast says and where its button links the command, or null. */
export function cliOffer(st: CliLinkStatus): { text: string; label: string; path: string } | null {
  if (!st.available) return null;
  if (st.offer === 'install') {
    const spot = st.spots.find((s) => s.state === 'missing');
    if (!spot) return null;
    return { text: 'Use Flint from a terminal: install the flint command', label: 'Install', path: spot.path };
  }
  if (st.offer === 'fix') {
    const spot = st.spots.find((s) => s.state === 'other-copy' || s.state === 'broken');
    if (!spot) return null;
    const why = spot.state === 'broken' ? 'a copy of Flint that was moved or deleted' : 'another copy of Flint';
    return { text: `The flint command in ${tilde(spot.path)} runs ${why}`, label: 'Use this copy', path: spot.path };
  }
  return null;
}

/** The toast after linking: ~/.local/bin works only when the person put it on the PATH. */
export function cliInstalledText(path: string): string {
  const where = tilde(path);
  if (where.startsWith('~/')) return `Installed ${where}. Make sure ${where.slice(0, -'/flint'.length)} is on your PATH`;
  return `Installed ${where}: open a new terminal and run flint`;
}

/** About's line for one place. */
export function cliSpotText(spot: CliLinkSpot): string {
  switch (spot.state) {
    case 'installed': return 'Runs this copy of Flint';
    case 'missing': return spot.admin ? 'Not installed · asks for an administrator password' : 'Not installed';
    case 'other-copy': return `Runs another copy: ${tilde(spot.target)}`;
    case 'broken': return 'Runs a copy that was moved or deleted';
    case 'foreign': return 'Another flint is here; Flint leaves it as it is';
  }
}

/** About's button for one place, or null when there is nothing to do. */
export function cliSpotAction(spot: CliLinkSpot): 'install' | 'repoint' | 'remove' | null {
  switch (spot.state) {
    case 'missing': return 'install';
    case 'other-copy':
    case 'broken': return 'repoint';
    case 'installed': return 'remove';
    case 'foreign': return null;
  }
}
