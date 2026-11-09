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

  it('on Windows leaves an AltGr character to the terminal (AltGr is Ctrl+Alt there)', () => {
    const typed = (code: string, k: string, mods: Parameters<typeof key>[1]) => ({ ...key(code, mods), key: k });
    // US-International: AltGr+1 is ¡, AltGr+D is ð, AltGr+Shift+N is Ñ, AltGr+Shift+O is Ó.
    expect(actionFor(typed('Digit1', '¡', { ctrl: true, alt: true }), 'windows')).toBeNull();
    expect(actionFor(typed('KeyD', 'ð', { ctrl: true, alt: true }), 'windows')).toBeNull();
    expect(actionFor(typed('KeyN', 'Ñ', { ctrl: true, alt: true, shift: true }), 'windows')).toBeNull();
    expect(actionFor(typed('KeyO', 'Ó', { ctrl: true, alt: true, shift: true }), 'windows')).toBeNull();
    // Spanish: AltGr+2 is @. A dead key is text too.
    expect(actionFor(typed('Digit2', '@', { ctrl: true, alt: true }), 'windows')).toBeNull();
    expect(actionFor(typed('Digit3', 'Dead', { ctrl: true, alt: true }), 'windows')).toBeNull();
    // A key with no AltGr character on the layout keeps its shortcut.
    expect(actionFor(typed('Digit1', '1', { ctrl: true, alt: true }), 'windows')).toBe('layout1');
    expect(actionFor(typed('KeyD', 'd', { ctrl: true, alt: true }), 'windows')).toBe('duplicate');
    expect(actionFor(typed('KeyO', 'O', { ctrl: true, alt: true, shift: true }), 'windows')).toBe('switchVault');
    // Ctrl+Shift chords are not AltGr; Linux keeps its rule (AltGr is not Ctrl+Alt there).
    expect(actionFor(typed('KeyD', 'D', { ctrl: true, shift: true }), 'windows')).toBe('splitRight');
    expect(actionFor(typed('Digit1', '¡', { ctrl: true, alt: true }), 'linux')).toBe('layout1');
  });

  it('moves between panes with ⌘] and ⌘[', () => {
    expect(actionFor(key('BracketRight', { meta: true }), 'mac')).toBe('focusNextPane');
    expect(actionFor(key('BracketLeft', { ctrl: true, shift: true }), 'linux')).toBe('focusPrevPane');
    expect(chordLabel('focusNextPane', 'linux')).toBe('Ctrl+Shift+]');
  });
});
