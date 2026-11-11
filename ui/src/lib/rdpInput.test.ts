import { describe, expect, it } from 'vitest';
import { fitScale, HeldKeys, MOD_PRESETS, modMapOf, modMapText, parseFrameHeader, rdpCode, rdpKeptAction, toDesktop, WheelAccumulator } from './rdpInput';

const key = (code: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) => ({
  code, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift,
});

describe('RDP input', () => {
  it('keeps only the palette and tab switches; every other chord goes to the remote', () => {
    expect(rdpKeptAction(key('KeyK', { meta: true }), 'mac')).toBe('palette');
    expect(rdpKeptAction(key('Digit2', { meta: true }), 'mac')).toBe('tab2');
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
    k.down('CapsLock');
    expect(sent).toEqual(['CapsLock down', 'CapsLock up']);
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
