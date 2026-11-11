// Keyboard and pointer input of an RDP tab (milestone 30), kept apart from the view
// so it can be tested. Keys go to the remote by physical position (KeyboardEvent.code);
// the remote reads them with this machine's layout, which the core hands to the
// server at connect time.
//
// In an RDP tab almost every key belongs to the remote desktop: on macOS ⌘ is sent as
// Ctrl, as Windows App does, so ⌘C, ⌘V, ⌘Z and ⌘W act on the remote. Flint keeps
// only the palette and the tab switches (and ⌘Q, which the OS takes first); every
// other Flint action is in the palette and the toolbar.

import { actionFor, type Action, type KeyLike, type Os } from './keymap';

/** The core's connect timeout (application/rdp.cf, RDP_CONNECT_TIMEOUT_MS), as the tab says it. */
export const RDP_CONNECT_TIMEOUT_S = 30;

export const RDP_KEPT_ACTIONS: Action[] = ['palette', 'quit', 'tab1', 'tab2', 'tab3', 'tab4', 'tab5', 'tab6', 'tab7', 'tab8', 'tab9'];

/** The Flint action a key press keeps in an RDP tab, or null when it goes to the remote. */
export function rdpKeptAction(e: KeyLike, os: Os): Action | null {
  const a = actionFor(e, os);
  return a && RDP_KEPT_ACTIONS.includes(a) ? a : null;
}

/** The key sent for a physical key: on macOS ⌘ is Ctrl. */
export function rdpCode(code: string, os: Os): string {
  if (os === 'mac' && code === 'MetaLeft') return 'ControlLeft';
  if (os === 'mac' && code === 'MetaRight') return 'ControlRight';
  return code;
}

/**
 * The keys held down on the remote, so none stays stuck: macOS sends no keyup for a
 * key pressed while ⌘ is held, and a tab that loses the focus (the palette, another
 * window) must let go of everything.
 */
export class HeldKeys {
  private held = new Set<string>();

  constructor(private send: (code: string, down: boolean) => void, private os: Os) {}

  down(code: string) {
    const c = rdpCode(code, this.os);
    // Caps Lock on macOS reports a keydown when it turns on and a keyup when it
    // turns off: each is one press.
    if (code === 'CapsLock') { this.send(c, true); this.send(c, false); return; }
    this.held.add(c);
    this.send(c, true);
  }

  up(code: string) {
    const c = rdpCode(code, this.os);
    if (code === 'CapsLock') { this.send(c, true); this.send(c, false); return; }
    if (this.os === 'mac' && (code === 'MetaLeft' || code === 'MetaRight')) {
      // The keys pressed with ⌘ never reported their release.
      for (const k of [...this.held]) if (k !== c) { this.held.delete(k); this.send(k, false); }
    }
    if (!this.held.has(c)) return;
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
