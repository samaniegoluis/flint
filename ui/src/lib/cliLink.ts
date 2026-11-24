// The words of the `flint` command's offer and of About's Command line row
// (milestone 48, D-111 (2)). Kept apart from the views so the wording is tested
// without React.

import type { CliLinkSpot, CliLinkStatus } from '../api/types';
import { t } from '../i18n';

const tilde = (path: string) => path.replace(/^\/(Users|home)\/[^/]+\//, '~/');
/** A Windows folder as Windows writes it. */
export const winPath = (path: string) => path.replace(/\//g, '\\');

/** The toast's key: an offer and its result replace each other in place. */
export const CLI_TOAST_KEY = 'cli-link';

/** What the first launch's toast says and where its button links the command, or null. */
export function cliOffer(st: CliLinkStatus): { text: string; label: string; path: string } | null {
  if (!st.available) return null;
  if (st.kind === 'path') {
    // Windows (milestone 50): one spot, the package's bin folder.
    const spot = st.spots[0];
    if (!spot) return null;
    if (st.offer === 'install' && spot.state === 'missing') return { text: t('cli.offer.add_to_path'), label: t('cli.add_to_path'), path: spot.path };
    if (st.offer === 'fix' && (spot.state === 'broken' || spot.state === 'other-copy')) {
      return { text: spot.state === 'broken' ? t('cli.offer.path_runs_moved') : t('cli.offer.path_runs_other'), label: t('cli.use_this_copy'), path: spot.path };
    }
    return null;
  }
  if (st.offer === 'install') {
    const spot = st.spots.find((s) => s.state === 'missing');
    if (!spot) return null;
    return { text: t('cli.offer.install'), label: t('cli.install'), path: spot.path };
  }
  if (st.offer === 'fix') {
    const spot = st.spots.find((s) => s.state === 'other-copy' || s.state === 'broken');
    if (!spot) return null;
    const where = tilde(spot.path);
    return { text: spot.state === 'broken' ? t('cli.offer.command_runs_moved', { where }) : t('cli.offer.command_runs_other', { where }), label: t('cli.use_this_copy'), path: spot.path };
  }
  return null;
}

/** The toast after linking: ~/.local/bin works only when the person put it on the PATH. */
export function cliInstalledText(path: string, kind: CliLinkStatus['kind'] = 'link'): string {
  if (kind === 'path') return t('cli.installed.path', { path: winPath(path) });
  const where = tilde(path);
  if (where.startsWith('~/')) return t('cli.installed.check_path', { where, dir: where.slice(0, -'/flint'.length) });
  return t('cli.installed.link', { where });
}

/** About's line for one place. */
export function cliSpotText(spot: CliLinkSpot, kind: CliLinkStatus['kind'] = 'link'): string {
  if (kind === 'path') {
    switch (spot.state) {
      case 'installed': return t('cli.spot.path.installed');
      case 'missing': return t('cli.spot.path.missing');
      case 'other-copy': return t('cli.spot.path.other_copy', { target: winPath(spot.target) });
      case 'broken': return t('cli.spot.path.broken', { target: winPath(spot.target) });
      case 'foreign': return t('cli.spot.path.foreign');
    }
  }
  switch (spot.state) {
    case 'installed': return t('cli.spot.installed');
    case 'missing': return spot.admin ? t('cli.spot.missing_admin') : t('cli.spot.missing');
    case 'other-copy': return t('cli.spot.other_copy', { target: tilde(spot.target) });
    case 'broken': return t('cli.spot.broken');
    case 'foreign': return t('cli.spot.foreign');
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

/** About's button label for an action. */
export function cliActionLabel(a: 'install' | 'repoint' | 'remove', kind: CliLinkStatus['kind'] = 'link'): string {
  if (a === 'repoint') return t('cli.use_this_copy');
  if (kind === 'path') return a === 'install' ? t('cli.add_to_path') : t('cli.remove_from_path');
  return a === 'install' ? t('cli.install') : t('cli.remove');
}
