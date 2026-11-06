// What the terminal does with a keydown before xterm.js sees it: the dead-key, IME
// and dictation rules (Tether a872c3f and 08cfdc3), kept pure so they are tested
// without a browser (keyInput.test.ts).
//
// WebKit flushes a dead key that does not combine with the next letter in two steps:
// compositionend commits the dead character (xterm sends it), then one keydown arrives
// whose `key` is the whole flush ("'s", code KeyS). Sending that `key` would double the
// apostrophe ("it''s"); only what follows the committed prefix is new.
//
// Dictation and text expanders insert a whole string through one keydown on a
// printable key. xterm.js drops a multi-character `key`, so the page pastes it.

export const PRINTABLE_KEY_CODE_RE = /^(Key[A-Z]|Digit[0-9]|Space|Backquote|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|Intl(Backslash|Ro|Yen))$/;
export const IME_SENTINEL_KEYS = new Set(['Dead', 'Unidentified', 'Process', 'AltGraph']);

export interface KeyLike {
  key: string;
  code: string;
  keyCode?: number;
  isComposing?: boolean;
}

/** `paste` sends `text` instead of the key; `pass` leaves the event to the next rule. */
export type KeyInput = { kind: 'paste'; text: string } | { kind: 'pass' };

/**
 * Decides one keydown. `lastCommit` is what the most recent compositionend committed
 * since the previous keydown ('' when none).
 */
export function keyInput(e: KeyLike, lastCommit: string): KeyInput {
  if (lastCommit && e.key.length > lastCommit.length && e.key.startsWith(lastCommit)) {
    return { kind: 'paste', text: e.key.slice(lastCommit.length) };
  }
  // Inside an IME composition xterm.js's CompositionHelper owns the input.
  if (e.isComposing || e.keyCode === 229) return { kind: 'pass' };
  if (e.key.length > 1 && PRINTABLE_KEY_CODE_RE.test(e.code) && !IME_SENTINEL_KEYS.has(e.key)) {
    return { kind: 'paste', text: e.key };
  }
  return { kind: 'pass' };
}
