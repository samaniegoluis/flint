import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '../api/types';
import { shortDate, updateActionLabel, updateBarLabel, updateHowText, updatePaletteHint, updatePopoverDetail, updateStateLine, updateToastText } from './update';

const base: UpdateStatus = {
  state: 'idle', current: '0.16.0', checked_at: 0, auto: true, version: '', date: '', summary: '', page: '',
  action: '', how: '', asset_url: '', asset_size: 0, toast: false, code: '', message: '',
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
    expect(updatePopoverDetail(available)).toBe('You have 0.16.0. Download it from the release page; nothing changes until you install it.');
    expect(updatePopoverDetail({ ...base, state: 'up_to_date' })).toBe('You have 0.16.0.');
  });

  it('writes dates short', () => {
    expect(shortDate('2026-11-18')).toBe('18 Nov');
    expect(shortDate('soon')).toBe('soon');
  });
});
