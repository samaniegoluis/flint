import { describe, expect, it } from 'vitest';
import { isBrowserKey, type BrowserKeyLike } from './browserKeys';

const key = (code: string, o: Partial<BrowserKeyLike> = {}): BrowserKeyLike =>
  ({ code, key: '', ctrlKey: false, metaKey: false, ...o });

describe('isBrowserKey', () => {
  it('cancels reload, print, save and view source on Windows and Linux', () => {
    for (const os of ['windows', 'linux'] as const) {
      expect(isBrowserKey(key('F5'), os)).toBe(true);
      expect(isBrowserKey(key('F5', { ctrlKey: true }), os)).toBe(true);
      for (const code of ['KeyR', 'KeyP', 'KeyS', 'KeyU']) {
        expect(isBrowserKey(key(code, { ctrlKey: true }), os)).toBe(true);
      }
      expect(isBrowserKey(key('KeyR', { ctrlKey: true }), os)).toBe(true);
    }
  });
  it('uses ⌘ on macOS, where Ctrl+R belongs to the page', () => {
    expect(isBrowserKey(key('KeyR', { metaKey: true }), 'mac')).toBe(true);
    expect(isBrowserKey(key('KeyR', { ctrlKey: true }), 'mac')).toBe(false);
  });
  it('leaves copy, paste, plain letters and the palette alone', () => {
    expect(isBrowserKey(key('KeyC', { ctrlKey: true }), 'windows')).toBe(false);
    expect(isBrowserKey(key('KeyV', { ctrlKey: true }), 'windows')).toBe(false);
    expect(isBrowserKey(key('KeyK', { metaKey: true }), 'mac')).toBe(false);
    expect(isBrowserKey(key('KeyR'), 'windows')).toBe(false);
    expect(isBrowserKey(key('F6'), 'windows')).toBe(false);
  });
  it('knows the browser refresh key', () => {
    expect(isBrowserKey(key('', { key: 'BrowserRefresh' }), 'windows')).toBe(true);
  });
});
