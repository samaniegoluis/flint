// App actions can start from a key press anywhere, including inside the terminal,
// which handles its own keys. The shell registers the one handler.
import type { Action } from '../lib/keymap';

let handler: ((a: Action) => void) | null = null;

export function setActionHandler(fn: ((a: Action) => void) | null) {
  handler = fn;
}

export function runAction(a: Action) {
  handler?.(a);
}
