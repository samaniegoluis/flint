// Keyboard and pointer input of an RDP tab (milestone 30), kept apart from the view
// so it can be tested. Keys go to the remote by physical position (KeyboardEvent.code);
// the remote reads them with this machine's layout, which the core hands to the
// server at connect time.
//
// In an RDP tab almost every key belongs to the remote desktop. On macOS the modifier
// keys follow Settings → Remote desktop (milestone 31, D-074): by default ⌘ is sent as
// Ctrl, as Windows App does, so ⌘C, ⌘V, ⌘Z and ⌘W act on the remote. Flint keeps only
// the palette and the tab switches (and ⌘Q, which the OS takes first), on ⌘ whatever
// the preset; every other Flint action is in the palette and the toolbar.

import { actionFor, type Action, type KeyLike, type Os } from './keymap';

/** The core's connect timeout (application/rdp.cf, RDP_CONNECT_TIMEOUT_MS), as the tab says it. */
export const RDP_CONNECT_TIMEOUT_S = 30;

export const RDP_KEPT_ACTIONS: Action[] = ['palette', 'quit', 'fullscreen', 'tab1', 'tab2', 'tab3', 'tab4', 'tab5', 'tab6', 'tab7', 'tab8', 'tab9'];

/** The Flint action a key press keeps in an RDP tab, or null when it goes to the remote. */
export function rdpKeptAction(e: KeyLike, os: Os): Action | null {
  const a = actionFor(e, os);
  return a && RDP_KEPT_ACTIONS.includes(a) ? a : null;
}

/** A Mac keyboard's modifier keys, by their physical `code` (Settings → Remote desktop). */
export const MAC_MOD_KEYS = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'] as const;
export type MacModKey = (typeof MAC_MOD_KEYS)[number];
/** What a modifier key sends: a PC keyboard's Ctrl, Alt, AltGr (right Alt), Windows key, or nothing. */
export type ModTarget = 'ctrl' | 'alt' | 'altgr' | 'win' | 'off';
export const MOD_TARGETS: ModTarget[] = ['ctrl', 'alt', 'altgr', 'win', 'off'];
export type ModMap = Record<MacModKey, ModTarget>;

/**
 * The presets (D-074). **Mac**, the default, as Windows App: ⌘ is Ctrl so ⌘C/⌘V copy
 * and paste, ⌃ is the Windows key, left ⌥ is Alt and right ⌥ AltGr. **Windows** by
 * position, as a PC keyboard: ⌃ Ctrl, left ⌥ Win, left ⌘ Alt, right ⌘ AltGr, right ⌥ Win.
 */
export const MOD_PRESETS: Record<'mac' | 'windows', ModMap> = {
  mac: { ControlLeft: 'win', ControlRight: 'win', AltLeft: 'alt', AltRight: 'altgr', MetaLeft: 'ctrl', MetaRight: 'ctrl' },
  windows: { ControlLeft: 'ctrl', ControlRight: 'ctrl', AltLeft: 'win', AltRight: 'win', MetaLeft: 'alt', MetaRight: 'altgr' },
};

/** The map a setting gives: a preset, or the custom table over the Mac preset. */
export function modMapOf(preset: 'mac' | 'windows' | 'custom', custom: string): ModMap {
  if (preset !== 'custom') return MOD_PRESETS[preset];
  const m: ModMap = { ...MOD_PRESETS.mac };
  for (const pair of custom.split(',')) {
    const [k, v] = pair.split('=');
    if ((MAC_MOD_KEYS as readonly string[]).includes(k) && (MOD_TARGETS as string[]).includes(v)) m[k as MacModKey] = v as ModTarget;
  }
  return m;
}

/** The custom table as the setting keeps it. */
export function modMapText(m: ModMap): string {
  return MAC_MOD_KEYS.map((k) => `${k}=${m[k]}`).join(',');
}

function targetCode(t: ModTarget, right: boolean): string | null {
  switch (t) {
    case 'ctrl': return right ? 'ControlRight' : 'ControlLeft';
    case 'alt': return 'AltLeft';
    case 'altgr': return 'AltRight';
    case 'win': return right ? 'MetaRight' : 'MetaLeft';
    default: return null;
  }
}

/**
 * The key sent for a physical key, null for none. On macOS the modifier keys follow
 * `map` (the Mac preset when none is given); a PC keyboard sends every key as it is.
 */
export function rdpCode(code: string, os: Os, map: ModMap = MOD_PRESETS.mac): string | null {
  if (os !== 'mac' || !(MAC_MOD_KEYS as readonly string[]).includes(code)) return code;
  return targetCode(map[code as MacModKey], code.endsWith('Right'));
}

/**
 * The keys held down on the remote, so none stays stuck: macOS sends no keyup for a
 * key pressed while ⌘ is held, and a tab that loses the focus (the palette, another
 * window) must let go of everything. Keys are tracked by what was sent.
 */
export class HeldKeys {
  private held = new Set<string>();

  constructor(private send: (code: string, down: boolean) => void, private os: Os, private map: ModMap = MOD_PRESETS.mac) {}

  down(code: string) {
    const c = rdpCode(code, this.os, this.map);
    if (!c) return;
    // The lock keys are never sent as presses (milestone 58): a press toggles the
    // remote's state, which may not be this machine's. LockSync sends the state.
    if (LOCK_KEYS.includes(code)) return;
    this.held.add(c);
    this.send(c, true);
  }

  up(code: string) {
    const c = rdpCode(code, this.os, this.map);
    if (LOCK_KEYS.includes(code)) return;
    if (this.os === 'mac' && (code === 'MetaLeft' || code === 'MetaRight')) {
      // The keys pressed with ⌘ never reported their release.
      for (const k of [...this.held]) if (k !== c && !isModifierSent(k)) { this.held.delete(k); this.send(k, false); }
    }
    if (!c || !this.held.has(c)) return;
    this.held.delete(c);
    this.send(c, false);
  }

  releaseAll() {
    for (const k of [...this.held]) this.send(k, false);
    this.held.clear();
  }

  get size(): number {
    return this.held.size;
  }
}

function isModifierSent(code: string): boolean {
  return code.startsWith('Control') || code.startsWith('Alt') || code.startsWith('Meta') || code.startsWith('Shift');
}

/** The RDP button of a DOM mouse button (0 main, 1 middle, 2 secondary), or -1. */
export function rdpButton(domButton: number): number {
  return domButton >= 0 && domButton <= 2 ? domButton : -1;
}

/**
 * Turns wheel deltas into RDP notches of 120: 40 CSS pixels (or one line) is one
 * notch, so a trackpad scrolls smoothly and a mouse wheel one notch per click.
 */
export class WheelAccumulator {
  private acc = 0;

  /** The notches to send, each +120 (up or right) or -120. */
  push(delta: number, deltaMode: number): number[] {
    this.acc += -delta * (deltaMode === 1 ? 40 : deltaMode === 2 ? 400 : 1);
    const out: number[] = [];
    while (Math.abs(this.acc) >= 40 && out.length < 10) {
      const sign = this.acc > 0 ? 1 : -1;
      out.push(120 * sign);
      this.acc -= 40 * sign;
    }
    if (out.length === 10) this.acc = 0;
    return out;
  }
}

/** Where a point of the shown canvas falls on the desktop. */
export function toDesktop(x: number, y: number, shownW: number, shownH: number, deskW: number, deskH: number): { x: number; y: number } {
  const dx = Math.floor((x / Math.max(1, shownW)) * deskW);
  const dy = Math.floor((y / Math.max(1, shownH)) * deskH);
  return { x: Math.min(Math.max(0, dx), deskW - 1), y: Math.min(Math.max(0, dy), deskH - 1) };
}

/** The scale that fits a desktop into an area without stretching it. */
export function fitScale(areaW: number, areaH: number, deskW: number, deskH: number): number {
  if (deskW <= 0 || deskH <= 0) return 1;
  return Math.min(areaW / deskW, areaH / deskH);
}

/** A frame from the channel: its 16-byte header (D-071) and RGBA rows. */
export interface FrameHeader {
  seq: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fullW: number;
  fullH: number;
}

export function parseFrameHeader(buf: ArrayBuffer): FrameHeader | null {
  if (buf.byteLength < 16) return null;
  const dv = new DataView(buf, 0, 16);
  const h = { seq: dv.getUint32(0, true), x: dv.getUint16(4, true), y: dv.getUint16(6, true), w: dv.getUint16(8, true), h: dv.getUint16(10, true), fullW: dv.getUint16(12, true), fullH: dv.getUint16(14, true) };
  if (buf.byteLength !== 16 + h.w * h.h * 4) return null;
  return h;
}

// ---- Lock keys and typed text (milestone 58) ---------------------------------------

/** The lock keys, whose state goes to the remote with a synchronize event instead. */
export const LOCK_KEYS = ['CapsLock', 'NumLock', 'ScrollLock'];

/** RDP's synchronize flags (KBD_SYNC_*), as the core's RDP_LOCK_*. */
export const LOCK_SCROLL = 1;
export const LOCK_NUM = 2;
export const LOCK_CAPS = 4;

export interface ModifierStateLike {
  getModifierState(key: string): boolean;
}

/**
 * This machine's lock keys as the remote should have them. A Mac has no Num Lock and
 * its keypad always types digits, so the remote's Num Lock is on, as Windows App sets it.
 */
export function lockFlags(e: ModifierStateLike, os: Os): number {
  let f = 0;
  if (e.getModifierState('CapsLock')) f |= LOCK_CAPS;
  if (os === 'mac' || e.getModifierState('NumLock')) f |= LOCK_NUM;
  if (e.getModifierState('ScrollLock')) f |= LOCK_SCROLL;
  return f;
}

/**
 * Keeps the remote's lock keys in step: each key or pointer event carries this
 * machine's state, and a change from what was last sent is sent. A new connection (or
 * the focus coming back) starts over with `reset`, so the next event sends it again.
 */
export class LockSync {
  private last = -1;
  constructor(private send: (flags: number) => void, private os: Os) {}
  seen(e: ModifierStateLike) {
    const f = lockFlags(e, this.os);
    if (f === this.last) return;
    this.last = f;
    this.send(f);
  }
  reset() { this.last = -1; }
}

export interface TextKeyLike extends KeyLike {
  key: string;
}

/**
 * The text a key event types when it comes from no key of the keyboard, else null.
 * A Stream Deck's *Text* action (and other macro tools) post events that carry the
 * character but name no real key, or the key in the first position (KeyA, macOS'
 * virtual key 0) whatever the character: sent by position, the remote would get the
 * wrong letter. Such a character goes as Unicode. With Ctrl, ⌘ or ⌥ held it is a
 * shortcut, sent by position as always.
 */
export function unicodeText(e: TextKeyLike): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const chars = [...e.key];
  if (chars.length !== 1) return null;
  const ch = chars[0];
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x20 || cp === 0x7f) return null;
  if (e.code === '' || e.code === 'Unidentified') return ch;
  if (e.code === 'KeyA' && ch.toLowerCase() !== 'a' && ch.toLowerCase() !== 'q') return ch;
  return null;
}

// ---- The remote pointer (milestone 58) ---------------------------------------------

/** An "rdp:cursor" event (the core's RdpCursor). */
export interface RdpCursorEvent {
  tab: string;
  action: 'image' | 'set' | 'hidden' | 'default';
  id: number;
  width: number;
  height: number;
  hot_x: number;
  hot_y: number;
  rgba: string;
}

export interface CursorImage { width: number; height: number; hotX: number; hotY: number; rgba: string }

/** What the canvas shows: an image of the cache, none, or the system's arrow. */
export type CursorShown = { kind: 'image'; id: number } | { kind: 'hidden' } | { kind: 'default' };

/** Images kept per tab: the server reuses a few dozen; older ones go first. */
export const CURSOR_CACHE_MAX = 64;

/** The remote pointer's images by id, and the one shown. */
export class CursorCache {
  private images = new Map<number, CursorImage>();
  shown: CursorShown = { kind: 'default' };

  /** Takes an event; true when what is shown changed. */
  apply(e: RdpCursorEvent): boolean {
    if (e.action === 'image') {
      this.images.delete(e.id);
      this.images.set(e.id, { width: e.width, height: e.height, hotX: e.hot_x, hotY: e.hot_y, rgba: e.rgba });
      while (this.images.size > CURSOR_CACHE_MAX) this.images.delete(this.images.keys().next().value as number);
      return false;
    }
    if (e.action === 'set') {
      this.shown = this.images.has(e.id) ? { kind: 'image', id: e.id } : { kind: 'default' };
      return true;
    }
    this.shown = { kind: e.action === 'hidden' ? 'hidden' : 'default' };
    return true;
  }

  image(id: number): CursorImage | undefined { return this.images.get(id); }
  get size(): number { return this.images.size; }
}
