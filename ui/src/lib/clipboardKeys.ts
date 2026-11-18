// Which key presses copy from or paste into the terminal, before xterm.js sees them.
//
// macOS: ⌘C/⌘V arrive as native copy and paste events; nothing here.
// Linux: Ctrl+Shift+C copies, Ctrl+Shift+V pastes, so plain Ctrl chords reach the
// remote (Ctrl+C, Ctrl+V in vim).
// Windows (windows-port): as Windows Terminal. Ctrl+Shift+C and Ctrl+Insert copy,
// and so does Ctrl+C while text is selected (with nothing selected it reaches the
// remote as an interrupt); Ctrl+Shift+V, Ctrl+V and Shift+Insert paste. Without this,
// Shift+Insert went to the remote as a key and the shell printed "2~".
//
// `nativePaste` leaves the key to the webview, whose paste event xterm.js reads
// (bracketed paste included): no clipboard permission is needed.

import type { Os } from './keymap';

export interface ClipboardKeyLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type ClipboardKey = 'copy' | 'nativePaste' | 'pass';

export function clipboardKey(e: ClipboardKeyLike, os: Os, hasSelection: boolean): ClipboardKey {
  if (os === 'mac' || e.altKey || e.metaKey) return 'pass';
  const ctrlShift = e.ctrlKey && e.shiftKey;
  if (ctrlShift && e.code === 'KeyC') return 'copy';
  if (ctrlShift && e.code === 'KeyV') return 'nativePaste';
  if (os !== 'windows') return 'pass';
  const ctrlOnly = e.ctrlKey && !e.shiftKey;
  const shiftOnly = e.shiftKey && !e.ctrlKey;
  if (ctrlOnly && e.code === 'Insert') return 'copy';
  if (ctrlOnly && e.code === 'KeyC') return hasSelection ? 'copy' : 'pass';
  if (ctrlOnly && e.code === 'KeyV') return 'nativePaste';
  if (shiftOnly && e.code === 'Insert') return 'nativePaste';
  return 'pass';
}
