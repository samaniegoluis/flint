import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '../api/types';
import { relaunchClosesText, updateDownloadFailure, updatePercent, shortDate, updateActionLabel, updateBarLabel, updateHowText, updatePaletteHint, updatePopoverDetail, updateStateLine, updateToastText, updateIsPackage, updateReadyHint, updateRelaunchFailure } from './update';

const base: UpdateStatus = {
  state: 'idle', current: '0.16.0', checked_at: 0, auto: true, version: '', date: '', summary: '', page: '',
  action: '', how: '', command: '', asset_url: '', asset_size: 0, asset_sha256: '', received: 0, toast: false, outcome: '', code: '', message: '',
};
const NOW = 1_800_000_000_000;
const available: UpdateStatus = { ...base, state: 'available', version: '0.17.0', date: '2026-11-18', action: 'download', checked_at: NOW - 600_000, page: 'https://github.com/samaniegoluis/flint/releases/tag/v0.17.0' };

describe('the update notice', () => {
  it('says a newer version is there, with Download or How to update', () => {
    expect(updateToastText(available)).toBe('Flint 0.17.0 is available');
    expect(updateActionLabel(available)).toBe('Download');
    expect(updateActionLabel({ ...available, action: 'how', how: 'package' })).toBe('How to update');
    expect(updateBarLabel(available)).toBe('Update');
    expect(updateBarLabel({ ...base, state: 'up_to_date' })).toBe('');
    expect(updateBarLabel(null)).toBe('');
  });

  it('gives each state its line', () => {
    expect(updateStateLine({ ...base, state: 'up_to_date', checked_at: NOW - 600_000 }, NOW)).toBe('Up to date · last checked 10 min ago');
    expect(updateStateLine(available, NOW)).toBe('Flint 0.17.0 is available · released 18 Nov');
    expect(updateStateLine({ ...base, state: 'checking' }, NOW)).toBe('Checking for updates…');
    expect(updateStateLine({ ...base, state: 'error', code: 'network', checked_at: NOW - 60_000 }, NOW)).toBe("Couldn't check · no connection · last checked 1 min ago");
    expect(updateStateLine({ ...base, state: 'error', code: 'invalid' }, NOW)).toBe("Couldn't check · the update information didn't pass verification");
    expect(updateStateLine(base, NOW)).toBe('Not checked yet');
    expect(updateStateLine({ ...base, auto: false }, NOW)).toBe('Automatic check is off');
    expect(updatePaletteHint({ ...base, state: 'up_to_date', checked_at: NOW - 600_000 }, NOW)).toBe('up to date · checked 10 min ago');
    expect(updatePaletteHint(available, NOW)).toBe('0.17.0 is available');
  });

  it('explains How to update for each reason', () => {
    expect(updateHowText({ ...available, action: 'how', how: 'package' })).toContain('.deb or .rpm');
    expect(updateHowText({ ...available, action: 'how', how: 'source' })).toContain('built from source');
    expect(updateHowText({ ...available, action: 'how', how: 'readonly' })).toContain("can't replace this copy");
    expect(updateHowText({ ...available, action: 'how', how: 'no_asset' })).toContain('no package for your system');
    expect(updatePopoverDetail(available)).toBe('You have 0.16.0. Download it here; nothing changes until you relaunch.');
    expect(updatePopoverDetail({ ...base, state: 'up_to_date' })).toBe('You have 0.16.0.');
  });

  it('writes dates short', () => {
    expect(shortDate('2026-11-18')).toBe('18 Nov');
    expect(shortDate('soon')).toBe('soon');
  });

  it('downloads, then offers Relaunch (milestone 53)', () => {
    const down: UpdateStatus = { ...available, state: 'downloading', asset_size: 1000 };
    const ready: UpdateStatus = { ...available, state: 'ready' };
    expect(updatePercent(0, 1000)).toBe(0);
    expect(updatePercent(70, 1000)).toBe(7);
    expect(updatePercent(999, 1000)).toBe(99);
    expect(updatePercent(1000, 1000)).toBe(100);
    expect(updatePercent(5, 0)).toBe(0);
    expect(updateBarLabel(down, 420)).toBe('42%');
    expect(updateBarLabel(ready)).toBe('Relaunch');
    expect(updateActionLabel(ready)).toBe('Relaunch');
    expect(updateStateLine(ready, NOW)).toBe('Flint 0.17.0 is ready · verified');
    expect(updateStateLine(down, NOW)).toBe('Downloading Flint 0.17.0');
    expect(updatePopoverDetail(ready)).toBe('Downloaded and verified. Relaunch when it suits you; nothing changes until then.');
  });

  it('says why a download failed, and offers Retry only where it can help (24c4)', () => {
    expect(updateDownloadFailure({ ...available, code: 'invalid' })).toEqual({ text: "Flint 0.17.0 didn't pass verification and was discarded", retry: false });
    expect(updateDownloadFailure({ ...available, code: 'network' })).toEqual({ text: "Couldn't download Flint 0.17.0 · no connection", retry: true });
    expect(updateDownloadFailure({ ...available, code: 'timeout' }).text).toBe("Couldn't download Flint 0.17.0 · the download stalled");
  });

  it('names what Relaunch closes (24d1)', () => {
    expect(relaunchClosesText(3, 2)).toBe('3 sessions and 2 tunnels will close.');
    expect(relaunchClosesText(1, 0)).toBe('1 session will close.');
    expect(relaunchClosesText(0, 1)).toBe('1 tunnel will close.');
    expect(relaunchClosesText(0, 0, 1)).toBe('1 running flint command will stop.');
    expect(relaunchClosesText(2, 0, 3)).toBe('2 sessions will close. 3 running flint commands will stop.');
    expect(relaunchClosesText(0, 0, 0)).toBe('');
    expect(relaunchClosesText(0, 0)).toBe('');
  });
});

describe('milestone 54: a Linux package update', () => {
  const pkg = { ...base, state: 'ready' as const, version: '0.21.0', action: 'download' as const, asset_url: 'https://github.com/samaniegoluis/flint/releases/download/v0.21.0/flint_0.21.0_amd64.deb' };
  it('says Relaunch asks for the system password', () => {
    expect(updateIsPackage(pkg)).toBe(true);
    expect(updateReadyHint(pkg)).toContain('system password');
    expect(updateIsPackage({ ...pkg, asset_url: 'https://x/Flint-0.21.0-macos-arm64.zip' })).toBe(false);
    expect(updateReadyHint({ ...pkg, asset_url: 'https://x/Flint-0.21.0-macos-arm64.zip' })).not.toContain('password');
  });
  it('says why a Relaunch installed nothing', () => {
    const denied = updateRelaunchFailure({ ...pkg, code: 'denied', message: 'Nothing was installed: the system password was not given' });
    expect(denied.kept).toBe(true);
    expect(denied.text).toContain("password wasn't given");
    const busy = updateRelaunchFailure({ ...pkg, code: 'io', message: 'apt-get could not install it: dpkg is locked' });
    expect(busy.kept).toBe(true);
    expect(busy.text).toContain('dpkg is locked');
    const refused = updateRelaunchFailure({ ...pkg, state: 'available', code: 'invalid', message: 'the package did not match' });
    expect(refused.kept).toBe(false);
    expect(refused.text).toContain('discarded');
  });
  it('names the system updater for a package from a repository', () => {
    expect(updateHowText({ ...pkg, state: 'available', action: 'how', how: 'repository' })).toContain("system's updater");
  });
});
