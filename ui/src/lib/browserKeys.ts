// The engine's own keys (milestone 64, Principle 20): reload, print, save and view
// source. WebView2 acts on F5, Ctrl+R, Ctrl+P, Ctrl+S and Ctrl+U as a browser does,
// and a reload restarts the page over open sessions. The page cancels them everywhere;
// Flint's own chords on the same keys (⌘R Reconnect, ⌘P Go to host; Ctrl+Shift+R and
// Ctrl+Shift+P elsewhere) still run: the shell takes an event this guard cancelled.
import type { Os } from './keymap';

export interface BrowserKeyLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}

const CHORD_CODES = new Set(['KeyR', 'KeyP', 'KeyS', 'KeyU']);

export function isBrowserKey(e: BrowserKeyLike, os: Os): boolean {
  if (e.code === 'F5' || e.key === 'BrowserRefresh') return true;
  const mod = os === 'mac' ? e.metaKey : e.ctrlKey;
  return mod && CHORD_CODES.has(e.code);
}

// The events this guard cancelled, so the shell's shortcut handler still takes them.
const guarded = new WeakSet<Event>();

export function guardBrowserKey(e: KeyboardEvent, os: Os): void {
  if (!isBrowserKey(e, os)) return;
  e.preventDefault();
  guarded.add(e);
}

export function cancelledByGuard(e: Event): boolean {
  return guarded.has(e);
}
