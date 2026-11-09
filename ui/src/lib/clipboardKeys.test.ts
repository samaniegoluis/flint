import { describe, expect, it } from 'vitest';
import { clipboardKey, type ClipboardKeyLike } from './clipboardKeys';

const key = (code: string, mods: Partial<ClipboardKeyLike> = {}): ClipboardKeyLike =>
  ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });

describe('clipboardKey', () => {
  it('leaves macOS to its native copy and paste events', () => {
    expect(clipboardKey(key('KeyC', { ctrlKey: true, shiftKey: true }), 'mac', true)).toBe('pass');
    expect(clipboardKey(key('Insert', { shiftKey: true }), 'mac', false)).toBe('pass');
  });

  it('copies with Ctrl+Shift+C and pastes with Ctrl+Shift+V on Linux and Windows', () => {
    for (const os of ['linux', 'windows'] as const) {
      expect(clipboardKey(key('KeyC', { ctrlKey: true, shiftKey: true }), os, true)).toBe('copy');
      expect(clipboardKey(key('KeyV', { ctrlKey: true, shiftKey: true }), os, false)).toBe('nativePaste');
    }
  });

  it('keeps plain Ctrl+C, Ctrl+V and Insert chords for the remote on Linux', () => {
    expect(clipboardKey(key('KeyC', { ctrlKey: true }), 'linux', true)).toBe('pass');
    expect(clipboardKey(key('KeyV', { ctrlKey: true }), 'linux', false)).toBe('pass');
    expect(clipboardKey(key('Insert', { shiftKey: true }), 'linux', false)).toBe('pass');
    expect(clipboardKey(key('Insert', { ctrlKey: true }), 'linux', true)).toBe('pass');
  });

  it('pastes with Shift+Insert and Ctrl+V on Windows, as Windows Terminal does', () => {
    expect(clipboardKey(key('Insert', { shiftKey: true }), 'windows', false)).toBe('nativePaste');
    expect(clipboardKey(key('KeyV', { ctrlKey: true }), 'windows', false)).toBe('nativePaste');
  });

  it('copies with Ctrl+Insert on Windows, and with Ctrl+C only while text is selected', () => {
    expect(clipboardKey(key('Insert', { ctrlKey: true }), 'windows', true)).toBe('copy');
    expect(clipboardKey(key('KeyC', { ctrlKey: true }), 'windows', true)).toBe('copy');
    expect(clipboardKey(key('KeyC', { ctrlKey: true }), 'windows', false)).toBe('pass');
  });

  it('leaves Alt chords and bare keys alone', () => {
    expect(clipboardKey(key('KeyV', { ctrlKey: true, altKey: true }), 'windows', false)).toBe('pass');
    expect(clipboardKey(key('Insert'), 'windows', false)).toBe('pass');
    expect(clipboardKey(key('KeyV'), 'windows', false)).toBe('pass');
  });
});
