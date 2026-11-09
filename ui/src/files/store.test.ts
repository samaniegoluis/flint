import { describe, expect, it } from 'vitest';
import { applyProgress, clearDone, nextToStart, type Transfer } from './store';

const tr = (id: string, p: Partial<Transfer>): Transfer => ({
  id, tabId: 't1', session: 's1', alias: 'web', direction: 'upload', name: id, local: '/l/' + id, remote: '/r/', recursive: false, force: false,
  state: 'queued', bytes: 0, total: 0, file: '', filesDone: 0, startedAt: 0, rate: 0, error: null, folder: '/r', drop: '', ...p,
});

describe('the transfer queue', () => {
  it('runs one transfer at a time per session, in order', () => {
    const q = [tr('a', { state: 'done' }), tr('b', {}), tr('c', {}), tr('d', { session: 's2' })];
    expect(nextToStart(q, 's1')?.id).toBe('b');
    expect(nextToStart([...q.slice(0, 1), tr('b', { state: 'running' }), tr('c', {})], 's1')).toBeUndefined();
    expect(nextToStart(q, 's2')?.id).toBe('d');
  });
  it('clears finished and cancelled rows of one tab, and keeps failed ones', () => {
    const q = [tr('a', { state: 'done' }), tr('b', { state: 'failed' }), tr('c', { state: 'cancelled' }), tr('d', { state: 'done', tabId: 't2' }), tr('e', { state: 'running' })];
    expect(clearDone(q, 't1').map((t) => t.id)).toEqual(['b', 'd', 'e']);
  });
  it('takes a single file\'s size from its progress, but not a folder\'s', () => {
    const ev = { session: 's1', id: 'a', file: '/r/a', file_bytes: 512, file_size: 2048, files_done: 0, bytes_done: 512 };
    const first = applyProgress(tr('a', { state: 'running' }), ev, 1000, 0);
    expect(first).toMatchObject({ bytes: 512, total: 2048, rate: 0 });
    expect(applyProgress(first, { ...ev, file_bytes: 1536, bytes_done: 1536 }, 2000, 1000).rate).toBe(1024);
    expect(applyProgress(tr('a', { state: 'running', recursive: true }), ev, 1000, 0).total).toBe(0);
    expect(applyProgress(tr('a', { state: 'running', recursive: true, total: 9000 }), ev, 1000, 0).total).toBe(9000);
  });
});
