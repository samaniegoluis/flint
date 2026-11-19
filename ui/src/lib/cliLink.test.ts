import { describe, expect, it } from 'vitest';
import type { CliLinkSpot, CliLinkStatus } from '../api/types';
import { cliInstalledText, cliOffer, cliSpotAction, cliSpotText } from './cliLink';

const usr: CliLinkSpot = { path: '/usr/local/bin/flint', state: 'missing', target: '', admin: true };
const local: CliLinkSpot = { path: '/Users/me/.local/bin/flint', state: 'missing', target: '', admin: false };
const status = (offer: CliLinkStatus['offer'], spots: CliLinkSpot[], available = true): CliLinkStatus =>
  ({ available, cli: '/Applications/Flint.app/Contents/Helpers/flint', spots, offer });

describe('the flint command', () => {
  it('offers to install in the first missing place', () => {
    expect(cliOffer(status('install', [usr, local]))).toEqual({ text: 'Use Flint from a terminal: install the flint command', label: 'Install', path: '/usr/local/bin/flint' });
    expect(cliOffer(status('install', [usr, local], false))).toBeNull();
    expect(cliOffer(status('', [usr, local]))).toBeNull();
  });

  it('offers to fix a link to a moved or another copy', () => {
    const moved = { ...local, state: 'broken' as const, target: '/Volumes/Old/Flint.app/Contents/Helpers/flint' };
    expect(cliOffer(status('fix', [usr, moved]))).toEqual({ text: 'The flint command in ~/.local/bin/flint runs a copy of Flint that was moved or deleted', label: 'Use this copy', path: moved.path });
    const other = { ...usr, state: 'other-copy' as const, target: '/Users/me/Downloads/Flint.app/Contents/Helpers/flint' };
    expect(cliOffer(status('fix', [other, local]))?.text).toBe('The flint command in /usr/local/bin/flint runs another copy of Flint');
    expect(cliSpotText(other)).toBe('Runs another copy: ~/Downloads/Flint.app/Contents/Helpers/flint');
  });

  it('says where it went and what each place needs', () => {
    expect(cliInstalledText('/usr/local/bin/flint')).toBe('Installed /usr/local/bin/flint: open a new terminal and run flint');
    expect(cliInstalledText('/Users/me/.local/bin/flint')).toBe('Installed ~/.local/bin/flint. Make sure ~/.local/bin is on your PATH');
    expect(cliSpotText(usr)).toBe('Not installed · asks for an administrator password');
    expect(cliSpotAction(usr)).toBe('install');
    expect(cliSpotAction({ ...usr, state: 'installed' })).toBe('remove');
    expect(cliSpotAction({ ...usr, state: 'foreign' })).toBeNull();
  });
});
