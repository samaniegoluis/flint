import { describe, expect, it } from 'vitest';
import { keyTab, livePair, paneKey, type Pair } from './pair';
import { folderLabel } from './FileList';
import type { Pane } from '../sessions/store';

const tab = (id: string, p: Partial<Pane>): Pane => ({
  id, tab: 't-' + id, alias: 'db', session: 's-' + id, status: 'ready', prompt: null, changedKey: null, end: null, connectedAt: 1, noCommand: false, cwd: '', ...p,
});
const pair = (p: Partial<Pair>): Pair => ({
  tabId: 't1', alias: 'db', session: 's-old', own: false, otherTab: 't2', status: 'ready', prompt: null, changedKey: null, end: null, hidden: false, ...p,
});

describe('the second Files pane', () => {
  it('keys its folder under its tab, and finds the tab back', () => {
    expect(paneKey('t-1')).toBe('t-1~2');
    expect(keyTab(paneKey('t-1'))).toBe('t-1');
    expect(keyTab('t-1')).toBe('t-1');
  });

  it('follows the tab it borrows: its new session after a reconnect', () => {
    const p = livePair(pair({}), [tab('t2', { session: 's-new' })]);
    expect(p.status).toBe('ready');
    expect(p.session).toBe('s-new');
  });

  it('ends when the tab it borrows closes or drops', () => {
    expect(livePair(pair({}), []).status).toBe('ended');
    const dropped = livePair(pair({}), [tab('t2', { status: 'ended' })]);
    expect(dropped.status).toBe('ended');
    expect(dropped.end?.message).toContain('not connected');
  });

  it('keeps its own session as it is', () => {
    const own = pair({ own: true, otherTab: '', session: 's-own', status: 'prompt' });
    expect(livePair(own, [])).toBe(own);
  });

  it('names the drop folder as the drag label does', () => {
    expect(folderLabel('/var/lib/postgresql/scripts')).toBe('scripts/');
    expect(folderLabel('/')).toBe('/');
  });
});
