import { describe, expect, it } from 'vitest';
import { ServerStatsStore } from './serverStats';
import { sample } from '../lib/serverStats.fixture';

function fake() {
  const calls: string[] = [];
  const backend = {
    start: async (s: string, w: string) => { calls.push(`start ${s} ${w.startsWith('stats-')}`); },
    stop: async (s: string) => { calls.push(`stop ${s}`); },
  };
  return { calls, store: new ServerStatsStore(backend, () => 1000) };
}

describe('server resources watches (milestone 55)', () => {
  it('watches each open shell once, waiting for its first sample', () => {
    const { calls, store } = fake();
    store.sync(['a', 'b'], true);
    store.sync(['a', 'b'], true);
    expect(calls).toEqual(['start a true', 'start b true']);
    expect(store.view('a')).toEqual({ state: 'waiting' });
  });
  it('shows the latest sample, and nothing for a host that shows none', () => {
    const { store } = fake();
    store.sync(['a', 'b'], true);
    store.sample(sample({ session: 'a' }));
    store.sample(sample({ session: 'b', has_cpu: false, has_mem: false, has_net: false, has_disk: false, has_uptime: false, has_load: false }));
    expect(store.view('a')?.state).toBe('live');
    expect(store.view('b')).toEqual({ state: 'none' });
  });
  it('drops a sample for a session it does not watch', () => {
    const { store } = fake();
    store.sample(sample({ session: 'x' }));
    expect(store.view('x')).toBeNull();
  });
  it('an ended session is forgotten without a stop; the setting off stops every watch', () => {
    const { calls, store } = fake();
    store.sync(['a', 'b'], true);
    store.sync(['b'], true);
    expect(store.view('a')).toBeNull();
    expect(calls).not.toContain('stop a');
    store.sync(['b'], false);
    expect(calls).toContain('stop b');
    expect(store.view('b')).toBeNull();
  });
  it('a watch the core refused shows nothing', async () => {
    const store = new ServerStatsStore({ start: async () => { throw new Error('locked'); }, stop: async () => {} });
    store.sync(['a'], true);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.view('a')).toEqual({ state: 'none' });
  });
});
