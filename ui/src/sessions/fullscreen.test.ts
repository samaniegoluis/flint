import { describe, expect, it } from 'vitest';
import { FullScreenStore } from './fullscreen';

function store(fail = false) {
  const calls: boolean[] = [];
  const s = new FullScreenStore({ set: (on) => { calls.push(on); return fail ? Promise.reject(new Error('no')) : Promise.resolve({ on }); } });
  return { s, calls };
}

describe('full screen (milestone 37)', () => {
  it('goes immersive at once and asks the window to follow', () => {
    const { s, calls } = store();
    s.enter('t1');
    expect(s.get().tab).toBe('t1');
    expect(calls).toEqual([true]);
    s.heard(true, 't1', 52);
    expect(s.get()).toEqual({ window: true, tab: 't1', top: 52 });
  });

  it('leaves when the OS says the window left full screen', () => {
    const { s } = store();
    s.enter('t1');
    s.heard(true, 't1');
    s.heard(false, 't1');
    expect(s.get()).toEqual({ window: false, tab: null, top: 0 });
  });

  it('makes the shown RDP tab immersive when the OS enters full screen by itself', () => {
    const { s, calls } = store();
    s.heard(true, 't2');
    expect(s.get().tab).toBe('t2');
    expect(calls).toEqual([]);
    // An SSH tab shown: the window is full screen, the page keeps its chrome.
    const o = store();
    o.s.heard(true, null);
    expect(o.s.get()).toEqual({ window: true, tab: null, top: 0 });
  });

  it('leaves when another tab, an SSH tab or no tab is shown', () => {
    const { s, calls } = store();
    s.enter('t1');
    s.shown('t1');
    expect(s.get().tab).toBe('t1');
    s.shown('t2');
    expect(s.get().tab).toBeNull();
    expect(calls).toEqual([true, false]);
    s.enter('t1');
    s.shown(null);
    expect(s.get().tab).toBeNull();
  });

  it('toggles, and leaves again when the window refuses', async () => {
    const { s, calls } = store();
    s.toggle('t1');
    s.toggle('t1');
    expect(calls).toEqual([true, false]);
    s.toggle(null);
    expect(calls).toEqual([true, false]);
    const f = store(true);
    f.s.enter('t1');
    await Promise.resolve(); await Promise.resolve();
    expect(f.s.get().tab).toBeNull();
  });

  it('keeps a new request when the end of an earlier move is heard (macOS animates)', () => {
    const { s, calls } = store();
    s.enter('t1');
    s.heard(true, 't1');
    s.leave();
    s.enter('t1');
    // The exit asked first ends now; the window enters again after it.
    s.heard(false, 't1');
    expect(s.get().tab).toBe('t1');
    s.heard(true, 't1');
    expect(s.get()).toMatchObject({ window: true, tab: 't1' });
    expect(calls).toEqual([true, false, true]);
    // With nothing asked, the OS leaving still ends it.
    s.heard(false, 't1');
    expect(s.get().tab).toBeNull();
  });
});
