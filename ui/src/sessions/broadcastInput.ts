// Broadcast input (milestone 73, D-152): what is typed into a pane of a tab's broadcast
// reaches every other receiving pane, each encoded by that pane's own terminal.
//
// xterm.js has no API that encodes a key for a terminal (`input()` takes bytes already
// encoded), and the bytes the focused terminal sends cannot simply be copied: a pane in
// Kitty keyboard mode and a plain shell want different bytes for Shift+Enter or Ctrl+A,
// and those bytes also carry the terminal's replies to its program's queries (DA, colour
// queries), which belong to that pane alone. So:
//
// - **Keys:** each keydown and keyup the focused terminal takes is dispatched again, as
//   a copy, on each receiver's textarea, after the focused terminal has handled it. Each
//   receiver's xterm.js encodes it in its own mode (Kitty, application cursor, plain).
//   App chords never get here: the terminal's key handler runs them and keeps them.
// - **Text with no key of its own:** a key a receiver did not encode on keydown (an
//   upper-case letter in plain mode, which xterm.js takes from keypress; a third-level
//   character such as ⌥2 = @; an IME or dead-key composition) waits for the text the
//   focused terminal then sends for it, which goes to that receiver as typed text. When
//   the focused terminal encoded the key itself (Kitty mode), no text follows, and a
//   printable key goes as its character.
// - **Paste:** each receiver pastes through its own terminal (bracketed paste when its
//   program asked for it). Images and files go to the focused pane only (paste.ts).
//
// What is never forwarded: the terminal's replies (not a person's input), mouse and
// wheel reports, and anything while broadcast is off: `sessions.receivers()` is empty
// unless the pane is in its tab's broadcast (Principle 22).

import type { Terminal } from '@xterm/xterm';
import { sessions } from './store';

/** How long after a key or text event the focused terminal's text counts as typed. */
const TYPED_MS = 300;

interface Peer {
  term: Terminal;
  /** Data events this terminal has sent: a receiver's tells whether a key was encoded. */
  sent: number;
}

const peers = new Map<string, Peer>();
const copies = new WeakSet<Event>();
/** Set while a receiver handles a copied key or a paste: its data is its own, not typed. */
let driving = 0;

/** A key event this module dispatched on a receiver: Flint's key handler lets it through. */
export function isBroadcastCopy(e: Event): boolean {
  return copies.has(e);
}

function copyKey(e: KeyboardEvent): KeyboardEvent {
  const init: KeyboardEventInit = {
    key: e.key, code: e.code, location: e.location, repeat: e.repeat, isComposing: e.isComposing,
    ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
    modifierAltGraph: e.getModifierState?.('AltGraph') ?? false,
    modifierCapsLock: e.getModifierState?.('CapsLock') ?? false,
    keyCode: e.keyCode, charCode: e.charCode, which: e.which,
    bubbles: true, cancelable: true, composed: true,
  };
  const c = new KeyboardEvent(e.type, init);
  copies.add(c);
  return c;
}

// Runs `fn` with the receiver's textarea unable to take the focus: xterm.js focuses its
// terminal on keyup, and a receiver taking the focus would steal the keys (and send its
// program a focus-in report).
function withoutFocus(term: Terminal, fn: () => void) {
  const ta = term.textarea as (HTMLTextAreaElement & { focus: () => void }) | undefined;
  if (!ta) { fn(); return; }
  ta.focus = () => {};
  driving++;
  try { fn(); } finally {
    driving--;
    delete (ta as { focus?: unknown }).focus;
  }
}

// The end-to-end run reads what each copy did (scripts/gui-e2e.js, broadcast run).
function trace(line: string) {
  (window as unknown as { __flintE2E?: { bcLog?: string[] } }).__flintE2E?.bcLog?.push(line);
}

/** Dispatches a copy of `e` on `pane`'s terminal; true when it sent something. */
function dispatchKey(pane: string, e: KeyboardEvent): boolean {
  const peer = peers.get(pane);
  if (!peer?.term.textarea) return false;
  const before = peer.sent;
  withoutFocus(peer.term, () => peer.term.textarea!.dispatchEvent(copyKey(e)));
  trace(`${e.type} ${e.key} -> ${pane}: ${peer.sent !== before ? 'encoded' : 'nothing'}`);
  return peer.sent !== before;
}

/** A key that types its character: one character, no ⌘ and no Ctrl unless with Alt (AltGr). */
function printable(e: KeyboardEvent): boolean {
  return [...e.key].length === 1 && !e.metaKey && (!e.ctrlKey || e.altKey);
}

// xterm.js says whether a person's input made the data it is about to send through its
// core service's onUserInput, which fires just before onData. It is not in the public
// API (pinned 6.1.0-beta.339); without it no text is forwarded, never a reply.
type Core = { _core?: { coreService?: { onUserInput?: (fn: () => void) => { dispose(): void } } } };
function onUserInput(term: Terminal, fn: () => void): { dispose(): void } | null {
  const hook = (term as unknown as Core)._core?.coreService?.onUserInput;
  if (typeof hook !== 'function') {
    console.warn('broadcast: xterm.js has no onUserInput; typed text without a key is not forwarded');
    return null;
  }
  return hook.call((term as unknown as Core)._core!.coreService, fn);
}

// Mouse and wheel reports are sent as a person's input too; they stay with the pane.
let inMouse = false;
let mouseHooked = false;
function hookMouse() {
  if (mouseHooked) return;
  mouseHooked = true;
  const mark = () => { inMouse = true; queueMicrotask(() => { inMouse = false; }); };
  for (const type of ['mousedown', 'mouseup', 'mousemove', 'wheel', 'touchstart', 'touchmove', 'touchend', 'click', 'auxclick']) {
    window.addEventListener(type, mark, { capture: true, passive: true });
  }
}

/** One pane's side of broadcast: set up by its TerminalView. */
export class PaneRelay {
  private user = false;
  /** The key being handled by this pane's terminal, and what it sent for it. */
  private cur: { data: string } | null = null;
  /** Our own paste or an image's path: not typed, already sent where it goes. */
  private quiet = 0;
  private typedAt = 0;
  /** The receivers waiting for this key's text; null: every receiver. */
  private waiting: Set<string> | null = null;
  private down = new Set<string>();
  private dispose: () => void;

  constructor(private pane: string, private term: Terminal) {
    hookMouse();
    const peer: Peer = { term, sent: 0 };
    peers.set(pane, peer);
    const userHook = onUserInput(term, () => { this.user = true; });
    const ta = term.textarea;
    const typed = () => { this.typedAt = performance.now(); };
    const types = ['keydown', 'keypress', 'keyup', 'input', 'compositionstart', 'compositionupdate', 'compositionend'];
    for (const ty of types) ta?.addEventListener(ty, typed, true);
    this.dispose = () => {
      userHook?.dispose();
      for (const ty of types) ta?.removeEventListener(ty, typed, true);
      if (peers.get(pane) === peer) peers.delete(pane);
    };
  }

  close() { this.dispose(); }

  /**
   * Flint's key handler let `e` through to this pane's terminal. A keydown or keyup is
   * forwarded once the terminal has handled it; keypress brings text, which `data` sees.
   */
  key(e: KeyboardEvent) {
    if (copies.has(e) || driving) return;
    if (e.type === 'keypress') return;
    if (e.type === 'keyup' && !this.down.delete(e.code)) return;
    const to = sessions.receivers(this.pane);
    if (to.length === 0) return;
    if (e.type === 'keydown') this.down.add(e.code);
    const ctx = { data: '' };
    this.cur = ctx;
    queueMicrotask(() => {
      if (this.cur === ctx) this.cur = null;
      if (e.type === 'keyup') {
        for (const r of to) dispatchKey(r, e);
        this.waiting = null;
        return;
      }
      const waiting = new Set<string>();
      for (const r of to) {
        if (dispatchKey(r, e)) continue;
        // The focused terminal encoded it (Kitty mode): no text follows, so a printable
        // key goes as its character; otherwise the receiver waits for the text.
        if (ctx.data && printable(e)) { trace(`key ${e.key} as text -> ${r}`); sessions.input(r, e.key); }
        else waiting.add(r);
      }
      this.waiting = waiting;
    });
  }

  /** This pane's terminal sends `data` (its onData). */
  data(data: string) {
    const peer = peers.get(this.pane);
    if (peer) peer.sent++;
    const user = this.user;
    this.user = false;
    if (driving || this.quiet || !user) return;
    if (this.cur) { this.cur.data += data; return; }
    if (inMouse || performance.now() - this.typedAt > TYPED_MS) return;
    const to = sessions.receivers(this.pane);
    const waiting = this.waiting;
    trace(`text ${JSON.stringify(data)} -> ${to.filter((r) => !waiting || waiting.has(r)).join(',') || 'none'}`);
    for (const r of to) if (!waiting || waiting.has(r)) sessions.input(r, data);
  }

  /**
   * Pastes `text` into this pane and, under broadcast, into each receiver through its
   * own terminal (Flint's own pastes: a text paste, dictation, a dead key's flush).
   */
  paste(text: string) {
    this.quietly(() => this.term.paste(text));
    for (const r of sessions.receivers(this.pane)) {
      const peer = peers.get(r);
      if (peer) withoutFocus(peer.term, () => peer.term.paste(text));
    }
  }

  /**
   * xterm.js pastes into this pane alone (a paste of files' names): nothing it sends
   * until the event is over is typed. A microtask would end before xterm.js's own
   * listener runs, so this lasts until the next task.
   */
  quietThisEvent() {
    this.quiet++;
    setTimeout(() => { this.quiet--; }, 0);
  }

  /** Runs `fn` (a paste into this pane alone, such as an image's path) unforwarded. */
  quietly(fn: () => void) {
    this.quiet++;
    try { fn(); } finally { this.quiet--; }
  }
}
