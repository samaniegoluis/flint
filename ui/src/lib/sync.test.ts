import { describe, expect, it } from 'vitest';
import type { MergeReport, RemoteStatus } from '../api/types';
import { agoLabel, errorCodeOf, groupChanges, mergeSummary, MERGED_FOR_MS, NO_LIVE, noteText, sizeLabel, syncState, urlHost } from './sync';

const st = (o: Partial<RemoteStatus> = {}): RemoteStatus => ({
  connected: true, url: 'https://vault.example.com', version: 3, last_sync: 1000, last_attempt: 1000, last_error: '', pending: false, ...o,
});
const report = (o: Partial<MergeReport> = {}): MergeReport => ({ added: 0, updated: 0, removed: 0, changes: [], notes: [], ...o });

describe('syncState', () => {
  it('is in step, or waiting while changes wait', () => {
    expect(syncState(st(), NO_LIVE, 2000)).toBe('in_step');
    expect(syncState(st({ pending: true }), NO_LIVE, 2000)).toBe('waiting');
  });
  it('shows syncing over everything else', () => {
    expect(syncState(st({ pending: true }), { ...NO_LIVE, syncing: true, errorCode: 'network' }, 2000)).toBe('syncing');
  });
  it('reads a failure from the last event, or from a failed attempt after the last sync', () => {
    expect(syncState(st(), { ...NO_LIVE, errorCode: 'network' }, 2000)).toBe('offline');
    expect(syncState(st(), { ...NO_LIVE, errorCode: 'timeout' }, 2000)).toBe('offline');
    expect(syncState(st(), { ...NO_LIVE, errorCode: 'wrong_password' }, 2000)).toBe('password');
    expect(syncState(st(), { ...NO_LIVE, errorCode: 'auth' }, 2000)).toBe('attention');
    expect(syncState(st(), { ...NO_LIVE, errorCode: 'conflict' }, 2000)).toBe('attention');
    expect(syncState(st({ last_attempt: 1500, last_error: 'network: cannot reach' }), NO_LIVE, 2000)).toBe('offline');
    expect(syncState(st({ last_attempt: 900, last_error: 'network: cannot reach' }), NO_LIVE, 2000)).toBe('in_step');
  });
  it('says merged for a while after a merge that brought changes', () => {
    expect(syncState(st(), { ...NO_LIVE, mergedAt: 2000 }, 2000 + MERGED_FOR_MS - 1)).toBe('merged');
    expect(syncState(st(), { ...NO_LIVE, mergedAt: 2000 }, 2000 + MERGED_FOR_MS)).toBe('in_step');
  });
});

describe('labels', () => {
  it('reads the code of a core error', () => {
    expect(errorCodeOf('auth: the server refused the token')).toBe('auth');
    expect(errorCodeOf('')).toBe('');
  });
  it('says how long ago', () => {
    expect(agoLabel(0, 5000)).toBe('never');
    expect(agoLabel(1000, 30_000)).toBe('just now');
    expect(agoLabel(0 + 1, 2 * 60_000 + 1)).toBe('2 min ago');
    expect(agoLabel(1, 3 * 3_600_000 + 1)).toBe('3 h ago');
  });
  it('sizes and hosts', () => {
    expect(sizeLabel(62_000)).toBe('61 KB');
    expect(sizeLabel(1_300_000)).toBe('1.2 MB');
    expect(urlHost('https://vault.lab.example/flint')).toBe('vault.lab.example');
  });
});

describe('merge reports', () => {
  it('sums up a merge in the toast', () => {
    const hosts = report({ added: 2, updated: 1, changes: [
      { kind: 'host', name: 'a', change: 'added', detail: '' }, { kind: 'host', name: 'b', change: 'added', detail: '' }, { kind: 'host', name: 'c', change: 'updated', detail: '' },
    ] });
    expect(mergeSummary(hosts)).toBe('2 hosts added, 1 updated');
    const mixed = report({ updated: 2, changes: [
      { kind: 'host', name: 'a', change: 'updated', detail: '' }, { kind: 'key', name: 'k', change: 'updated', detail: '' },
    ] });
    expect(mergeSummary(mixed)).toBe('2 updated');
    expect(mergeSummary(report({ notes: [{ kind: 'host', name: 'web-2', change: 'renamed', detail: 'was web' }] }))).toBe('1 note from the merge');
  });
  it('groups changes by kind in a fixed order', () => {
    const g = groupChanges([
      { kind: 'token', name: 't', change: 'added', detail: '' },
      { kind: 'host', name: 'a', change: 'added', detail: '' },
      { kind: 'host', name: 'b', change: 'removed', detail: '' },
    ]);
    expect(g.map((x) => x.kind)).toEqual(['host', 'token']);
    expect(g[0].items.length).toBe(2);
  });
  it('says the merge notes in plain words', () => {
    expect(noteText({ kind: 'host', name: 'web-01-2', change: 'renamed', detail: 'was web-01' })).toBe('web-01 existed on both machines: this host is now web-01-2');
    expect(noteText({ kind: 'tunnel', name: 'db:pg', change: 'dropped', detail: 'its host was removed' })).toBe('db:pg (tunnel) was removed too: its host was removed');
  });
});
