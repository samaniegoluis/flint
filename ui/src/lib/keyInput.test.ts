import { describe, expect, it } from 'vitest';
import { keyInput, type KeyLike } from './keyInput';

// Replays a sequence the way TerminalView does: compositionend records what it
// committed, the next keydown reads and clears it. Returns what reaches the remote,
// with `xterm` standing in for what xterm.js sends for the events it keeps.
type Ev = { commit: string } | ({ down: true } & KeyLike);
function replay(events: Ev[]): string {
  let committed = '';
  let out = '';
  for (const ev of events) {
    if ('commit' in ev) {
      committed = ev.commit;
      out += ev.commit; // xterm's CompositionHelper sends the committed text
      continue;
    }
    const last = committed;
    committed = '';
    const r = keyInput(ev, last);
    if (r.kind === 'paste') out += r.text;
    // xterm sends a plain key, and nothing for a key inside a composition.
    else if (ev.key.length === 1 && !ev.isComposing && ev.keyCode !== 229) out += ev.key;
  }
  return out;
}

const down = (key: string, code: string, extra: Partial<KeyLike> = {}): Ev => ({ down: true, key, code, ...extra });

describe('keyInput', () => {
  it("types it's on US International (a dead ' that does not combine)", () => {
    expect(replay([
      down('i', 'KeyI'), down('t', 'KeyT'),
      down('Dead', 'Quote', { keyCode: 222 }),
      { commit: "'" },
      down("'s", 'KeyS', { keyCode: 222 }),
    ])).toBe("it's");
  });

  it('types é from a dead acute and e (the composition commits one character)', () => {
    expect(replay([
      down('Dead', 'Quote', { keyCode: 222 }),
      down('e', 'KeyE', { keyCode: 229, isComposing: true }),
      { commit: 'é' },
      down('l', 'KeyL'),
    ])).toBe('él');
  });

  it("types ' followed by space as a lone apostrophe", () => {
    expect(replay([
      down('Dead', 'Quote'), { commit: "'" }, down(' ', 'Space'),
    ])).toBe("' ");
  });

  it('leaves an IME composition (Japanese) to xterm', () => {
    expect(keyInput({ key: 'Process', code: 'KeyN', keyCode: 229, isComposing: true }, '')).toEqual({ kind: 'pass' });
    expect(keyInput({ key: 'に', code: 'KeyN', keyCode: 229, isComposing: true }, '')).toEqual({ kind: 'pass' });
    expect(replay([
      down('Process', 'KeyN', { keyCode: 229, isComposing: true }),
      down('Process', 'KeyI', { keyCode: 229, isComposing: true }),
      { commit: 'に' },
      down('Enter', 'Enter', { keyCode: 13 }),
    ])).toBe('に');
  });

  it('pastes a dictated phrase that arrives as one keydown', () => {
    expect(keyInput({ key: 'hello world', code: 'KeyH' }, '')).toEqual({ kind: 'paste', text: 'hello world' });
  });

  it('passes named keys and dead-key sentinels through', () => {
    for (const k of [['Enter', 'Enter'], ['ArrowUp', 'ArrowUp'], ['Dead', 'Quote'], ['Unidentified', 'KeyA'], ['AltGraph', 'AltRight']]) {
      expect(keyInput({ key: k[0], code: k[1] }, '')).toEqual({ kind: 'pass' });
    }
    expect(keyInput({ key: 'a', code: 'KeyA' }, '')).toEqual({ kind: 'pass' });
  });
});
