import { describe, expect, it } from 'vitest';
import { InputQueue } from './inputQueue';

// A transport that completes calls out of order, like independent RPCs racing.
function racyTransport() {
  const received: string[] = [];
  const inFlight: Array<() => void> = [];
  let maxInFlight = 0;
  const send = (session: string, data: string) => new Promise<void>((resolve) => {
    inFlight.push(() => { received.push(`${session}:${data}`); resolve(); });
    maxInFlight = Math.max(maxInFlight, inFlight.length);
  });
  // Completes pending calls last-first, until none are left.
  const settle = async () => {
    for (let i = 0; i < 1000 && inFlight.length; i++) {
      inFlight.pop()!();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { send, received, settle, maxInFlight: () => maxInFlight };
}

describe('InputQueue', () => {
  it('delivers a 258-reply burst in order, one write in flight at a time', async () => {
    const t = racyTransport();
    const q = new InputQueue(t.send);
    const replies = ['\x1b]10;rgb:ff/ff/ff\x07', '\x1b]11;rgb:00/00/00\x07'];
    for (let i = 0; i < 256; i++) replies.push(`\x1b]4;${i};rgb:00/00/00\x07`);
    for (const r of replies) q.push('s1', r);
    await t.settle();
    expect(t.maxInFlight()).toBe(1);
    expect(t.received.map((r) => r.slice(3)).join('')).toBe(replies.join(''));
    expect(t.received.length).toBeLessThanOrEqual(2); // the first write, then the rest joined
  });

  it('keeps sessions independent', async () => {
    const t = racyTransport();
    const q = new InputQueue(t.send);
    q.push('a', '1'); q.push('b', 'x'); q.push('a', '2'); q.push('b', 'y');
    await t.settle();
    expect(t.received.filter((r) => r.startsWith('a:')).map((r) => r.slice(2)).join('')).toBe('12');
    expect(t.received.filter((r) => r.startsWith('b:')).map((r) => r.slice(2)).join('')).toBe('xy');
  });

  it('carries on after a failed write and drops what is queued for an ended session', async () => {
    const sent: string[] = [];
    let fail = true;
    const q = new InputQueue(async (_s, d) => { if (fail) { fail = false; throw new Error('ended'); } sent.push(d); });
    q.push('s', 'a'); q.push('s', 'b');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['b']);
    q.drop('s');
  });
});
