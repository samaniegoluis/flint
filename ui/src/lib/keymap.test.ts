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

  it('opens the Tunnels view with ⇧⌘T, apart from New session', () => {
    expect(actionFor(key('KeyT', { meta: true, shift: true }), 'mac')).toBe('viewTunnels');
    expect(actionFor(key('KeyT', { meta: true }), 'mac')).toBe('newSession');
    expect(chordLabel('viewTunnels', 'linux')).toBe('Ctrl+Alt+Shift+T');
  });

  it('formats labels per platform', () => {
    expect(chordLabel('switchVault', 'mac')).toBe('⇧⌘O');
    expect(chordLabel('switchVault', 'linux')).toBe('Ctrl+Alt+Shift+O');
    expect(chordLabel('palette', 'linux')).toBe('Ctrl+Shift+K');
  });
  it('splits with ⌘D and ⇧⌘D, and moves Duplicate to ⌥⌘D', () => {
    expect(actionFor(key('KeyD', { meta: true }), 'mac')).toBe('splitRight');
    expect(actionFor(key('KeyD', { meta: true, shift: true }), 'mac')).toBe('splitDown');
    expect(actionFor(key('KeyD', { meta: true, alt: true }), 'mac')).toBe('duplicate');
    expect(actionFor(key('KeyD', { ctrl: true, shift: true }), 'linux')).toBe('splitRight');
    expect(actionFor(key('KeyD', { ctrl: true, shift: true, alt: true }), 'linux')).toBe('splitDown');
    expect(actionFor(key('KeyD', { ctrl: true, alt: true }), 'linux')).toBe('duplicate');
    expect(chordLabel('duplicate', 'mac')).toBe('⌥⌘D');
    expect(chordLabel('duplicate', 'linux')).toBe('Ctrl+Alt+D');
  });

  it('takes ⌥⌘1-4 for layouts, apart from ⌘1-9 for tabs', () => {
    expect(actionFor(key('Digit3', { meta: true, alt: true }), 'mac')).toBe('layout3');
    expect(actionFor(key('Digit3', { meta: true }), 'mac')).toBe('tab3');
    expect(actionFor(key('Digit1', { ctrl: true, alt: true }), 'linux')).toBe('layout1');
    expect(actionFor(key('Digit1', { ctrl: true, shift: true }), 'linux')).toBe('tab1');
    expect(actionFor(key('Digit5', { meta: true, alt: true }), 'mac')).toBeNull();
    expect(chordLabel('layout4', 'linux')).toBe('Ctrl+Alt+4');
  });

  it('moves between panes with ⌘] and ⌘[', () => {
    expect(actionFor(key('BracketRight', { meta: true }), 'mac')).toBe('focusNextPane');
    expect(actionFor(key('BracketLeft', { ctrl: true, shift: true }), 'linux')).toBe('focusPrevPane');
    expect(chordLabel('focusNextPane', 'linux')).toBe('Ctrl+Shift+]');
  });
});
