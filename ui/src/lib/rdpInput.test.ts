import { describe, expect, it } from 'vitest';
import { CURSOR_CACHE_MAX, CursorCache, fitScale, HeldKeys, LOCK_CAPS, LOCK_NUM, LOCK_SCROLL, LockSync, lockFlags, MOD_PRESETS, modMapOf, modMapText, parseFrameHeader, rdpCode, rdpKeptAction, toDesktop, unicodeText, WheelAccumulator } from './rdpInput';

const key = (code: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) => ({
  code, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift,
});

describe('RDP input', () => {
  it('keeps only the palette and tab switches; every other chord goes to the remote', () => {
    expect(rdpKeptAction(key('KeyK', { meta: true }), 'mac')).toBe('palette');
    expect(rdpKeptAction(key('Digit2', { meta: true }), 'mac')).toBe('tab2');
    expect(rdpKeptAction(key('KeyF', { meta: true, ctrl: true }), 'mac')).toBe('fullscreen');
    expect(rdpKeptAction(key('Enter', { ctrl: true, alt: true }), 'linux')).toBe('fullscreen');
    expect(rdpKeptAction(key('KeyW', { meta: true }), 'mac')).toBeNull();
    expect(rdpKeptAction(key('KeyC', { meta: true }), 'mac')).toBeNull();
    expect(rdpKeptAction(key('KeyT', { meta: true, shift: true }), 'mac')).toBeNull();
    expect(rdpKeptAction(key('KeyK', { ctrl: true, shift: true }), 'linux')).toBe('palette');
    expect(rdpKeptAction(key('KeyC', { ctrl: true }), 'linux')).toBeNull();
  });

  it('sends ⌘ as Ctrl on macOS only', () => {
    expect(rdpCode('MetaLeft', 'mac')).toBe('ControlLeft');
    expect(rdpCode('MetaRight', 'mac')).toBe('ControlRight');
    expect(rdpCode('MetaLeft', 'linux')).toBe('MetaLeft');
    expect(rdpCode('KeyA', 'mac')).toBe('KeyA');
  });

  it('maps a Mac keyboard\'s modifiers by preset (D-074)', () => {
    const mac = MOD_PRESETS.mac;
    expect(rdpCode('ControlLeft', 'mac', mac)).toBe('MetaLeft');
    expect(rdpCode('AltLeft', 'mac', mac)).toBe('AltLeft');
    expect(rdpCode('AltRight', 'mac', mac)).toBe('AltRight');
    const win = MOD_PRESETS.windows;
    expect(['ControlLeft', 'AltLeft', 'MetaLeft', 'MetaRight', 'AltRight'].map((c) => rdpCode(c, 'mac', win)))
      .toEqual(['ControlLeft', 'MetaLeft', 'AltLeft', 'AltRight', 'MetaRight']);
    // A PC keyboard sends its keys as they are, whatever the setting.
    expect(rdpCode('AltLeft', 'linux', win)).toBe('AltLeft');
    expect(rdpCode('KeyC', 'mac', win)).toBe('KeyC');
  });

  it('reads a custom table over the Mac preset, and an Off key sends nothing', () => {
    const m = modMapOf('custom', 'ControlLeft=off,MetaLeft=win,Bogus=ctrl,AltLeft=hyper');
    expect(m.ControlLeft).toBe('off');
    expect(m.MetaLeft).toBe('win');
    expect(m.AltLeft).toBe('alt');
    expect(m.MetaRight).toBe('ctrl');
    expect(modMapOf('windows', 'MetaLeft=off')).toEqual(MOD_PRESETS.windows);
    expect(modMapOf('custom', modMapText(MOD_PRESETS.windows))).toEqual(MOD_PRESETS.windows);
    const sent: string[] = [];
    const k = new HeldKeys((c, d) => sent.push(`${c} ${d ? 'down' : 'up'}`), 'mac', m);
    k.down('ControlLeft');
    k.up('ControlLeft');
    expect(sent).toEqual([]);
  });

  it('copies with ⌃C in the Windows preset, ⌘ held keys still released', () => {
    const sent: string[] = [];
    const k = new HeldKeys((c, d) => sent.push(`${c} ${d ? 'down' : 'up'}`), 'mac', MOD_PRESETS.windows);
    k.down('ControlLeft');
    k.down('KeyC');
    k.up('KeyC');
    k.up('ControlLeft');
    expect(sent).toEqual(['ControlLeft down', 'KeyC down', 'KeyC up', 'ControlLeft up']);
    sent.length = 0;
    k.down('MetaLeft');
    k.down('KeyS');
    k.up('MetaLeft');
    expect(sent).toEqual(['AltLeft down', 'KeyS down', 'KeyS up', 'AltLeft up']);
  });

  it('releases the keys macOS never reports up after ⌘, and everything on blur', () => {
    const sent: string[] = [];
    const k = new HeldKeys((c, d) => sent.push(`${c} ${d ? 'down' : 'up'}`), 'mac');
    k.down('MetaLeft');
    k.down('KeyC');
    k.up('MetaLeft');
    expect(sent).toEqual(['ControlLeft down', 'KeyC down', 'KeyC up', 'ControlLeft up']);
    expect(k.size).toBe(0);
    sent.length = 0;
    k.down('ShiftLeft');
    k.down('KeyA');
    k.releaseAll();
    expect(sent).toEqual(['ShiftLeft down', 'KeyA down', 'ShiftLeft up', 'KeyA up']);
    sent.length = 0;
    k.up('KeyA');
    expect(sent).toEqual([]);
    // The lock keys go as their state (LockSync), never as presses.
    k.down('CapsLock');
    k.up('CapsLock');
    k.down('NumLock');
    expect(sent).toEqual([]);
  });

  it('turns wheel deltas into notches', () => {
    const w = new WheelAccumulator();
    expect(w.push(-20, 0)).toEqual([]);
    expect(w.push(-20, 0)).toEqual([120]);
    expect(w.push(3, 1)).toEqual([-120, -120, -120]);
    expect(w.push(100000, 0).length).toBe(10);
    expect(w.push(-39, 0)).toEqual([]);
  });

  it('maps the shown canvas to desktop pixels and fits without stretching', () => {
    expect(toDesktop(50, 25, 100, 50, 1000, 500)).toEqual({ x: 500, y: 250 });
    expect(toDesktop(-5, 9999, 100, 50, 1000, 500)).toEqual({ x: 0, y: 499 });
    expect(fitScale(800, 600, 1600, 900)).toBe(0.5);
    expect(fitScale(800, 600, 0, 0)).toBe(1);
  });

  it('reads a frame header and refuses a short frame', () => {
    const buf = new ArrayBuffer(16 + 2 * 1 * 4);
    const dv = new DataView(buf);
    dv.setUint32(0, 7, true);
    dv.setUint16(4, 10, true); dv.setUint16(6, 20, true); dv.setUint16(8, 2, true); dv.setUint16(10, 1, true);
    dv.setUint16(12, 1280, true); dv.setUint16(14, 720, true);
    expect(parseFrameHeader(buf)).toEqual({ seq: 7, x: 10, y: 20, w: 2, h: 1, fullW: 1280, fullH: 720 });
    expect(parseFrameHeader(buf.slice(0, 20))).toBeNull();
  });
});

describe('lock keys (milestone 58)', () => {
  const state = (on: string[]) => ({ getModifierState: (k: string) => on.includes(k) });
  it('reads Caps, Num and Scroll Lock; a Mac always has Num Lock on', () => {
    expect(lockFlags(state([]), 'linux')).toBe(0);
    expect(lockFlags(state(['CapsLock', 'NumLock', 'ScrollLock']), 'windows')).toBe(LOCK_CAPS | LOCK_NUM | LOCK_SCROLL);
    expect(lockFlags(state([]), 'mac')).toBe(LOCK_NUM);
    expect(lockFlags(state(['CapsLock']), 'mac')).toBe(LOCK_CAPS | LOCK_NUM);
  });
  it('sends the state only when it changes, and again after a reset', () => {
    const sent: number[] = [];
    const l = new LockSync((f) => sent.push(f), 'linux');
    l.seen(state([]));
    l.seen(state([]));
    l.seen(state(['CapsLock']));
    l.seen(state(['CapsLock']));
    l.reset();
    l.seen(state(['CapsLock']));
    expect(sent).toEqual([0, LOCK_CAPS, LOCK_CAPS]);
  });
});

describe('text from no key (Stream Deck, milestone 58)', () => {
  const ev = (code: string, key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    ({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  it('a character on no key, or on macOS virtual key 0 that is not its letter, is Unicode', () => {
    expect(unicodeText(ev('', 'x'))).toBe('x');
    expect(unicodeText(ev('Unidentified', 'é'))).toBe('é');
    expect(unicodeText(ev('KeyA', 'P'))).toBe('P');
    expect(unicodeText(ev('KeyA', '😀'))).toBe('😀');
  });
  it('a real key, a shortcut or a named key goes by position', () => {
    expect(unicodeText(ev('KeyA', 'a'))).toBeNull();
    expect(unicodeText(ev('KeyA', 'A'))).toBeNull();
    // AZERTY's key in that place.
    expect(unicodeText(ev('KeyA', 'q'))).toBeNull();
    expect(unicodeText(ev('KeyS', 'z'))).toBeNull();
    expect(unicodeText(ev('', 'x', { metaKey: true }))).toBeNull();
    expect(unicodeText(ev('KeyA', 'å', { altKey: true }))).toBeNull();
    expect(unicodeText(ev('', 'Enter'))).toBeNull();
  });
});

describe('the remote pointer (milestone 58)', () => {
  const img = (id: number) => ({ tab: 't', action: 'image' as const, id, width: 2, height: 2, hot_x: 1, hot_y: 0, rgba: 'AAAA' });
  const act = (action: 'set' | 'hidden' | 'default', id = 0) => ({ tab: 't', action, id, width: 0, height: 0, hot_x: 0, hot_y: 0, rgba: '' });
  it('keeps images by id and shows the one set', () => {
    const c = new CursorCache();
    expect(c.apply(img(1))).toBe(false);
    expect(c.shown).toEqual({ kind: 'default' });
    expect(c.apply(act('set', 1))).toBe(true);
    expect(c.shown).toEqual({ kind: 'image', id: 1 });
    expect(c.image(1)?.hotX).toBe(1);
    c.apply(act('hidden'));
    expect(c.shown).toEqual({ kind: 'hidden' });
    c.apply(act('set', 9));
    expect(c.shown).toEqual({ kind: 'default' });
    c.apply(act('default'));
    expect(c.shown).toEqual({ kind: 'default' });
  });
  it('forgets the oldest images past its size', () => {
    const c = new CursorCache();
    for (let i = 1; i <= CURSOR_CACHE_MAX + 5; i++) c.apply(img(i));
    expect(c.size).toBe(CURSOR_CACHE_MAX);
    expect(c.image(1)).toBeUndefined();
    expect(c.image(CURSOR_CACHE_MAX + 5)).toBeDefined();
  });
});
