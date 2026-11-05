import { describe, expect, it } from 'vitest';
import { actionFor, chordLabel } from './keymap';

const key = (code: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) => ({
  code, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift,
});

describe('keymap', () => {
  it('maps ⌘ to Ctrl+Shift and ⇧⌘ to Ctrl+Alt+Shift', () => {
    expect(actionFor(key('KeyK', { meta: true }), 'mac')).toBe('palette');
    expect(actionFor(key('KeyK', { meta: true, shift: true }), 'mac')).toBe('viewKeys');
    expect(actionFor(key('KeyK', { ctrl: true, shift: true }), 'linux')).toBe('palette');
    expect(actionFor(key('KeyK', { ctrl: true, shift: true, alt: true }), 'linux')).toBe('viewKeys');
  });

  it('leaves plain Ctrl chords to the terminal', () => {
    expect(actionFor(key('KeyC', { ctrl: true }), 'linux')).toBeNull();
    expect(actionFor(key('KeyR', { ctrl: true }), 'mac')).toBeNull();
    expect(actionFor(key('KeyK'), 'mac')).toBeNull();
  });

  it('keeps Copy apart from Credentials on Linux', () => {
    expect(actionFor(key('KeyC', { ctrl: true, shift: true }), 'linux')).toBeNull();
    expect(actionFor(key('KeyC', { ctrl: true, shift: true, alt: true }), 'linux')).toBe('viewCredentials');
  });

  it('handles F6 and tab numbers', () => {
    expect(actionFor(key('F6'), 'linux')).toBe('nextRegion');
    expect(actionFor(key('F6', { shift: true }), 'mac')).toBe('prevRegion');
    expect(actionFor(key('Digit3', { meta: true }), 'mac')).toBe('tab3');
  });

  it('formats labels per platform', () => {
    expect(chordLabel('switchVault', 'mac')).toBe('⇧⌘O');
    expect(chordLabel('switchVault', 'linux')).toBe('Ctrl+Alt+Shift+O');
    expect(chordLabel('palette', 'linux')).toBe('Ctrl+Shift+K');
  });
});
