// Milestone 73: the per-tab broadcast set (Principle 22). Off on every new tab, a pane
// joins only by a person's toggle, and a pane that drops, reconnects or closes leaves it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (ev: unknown) => void;
const handlers = new Map<string, Handler>();
vi.mock('../api/backend', () => ({
  on: (name: string, fn: Handler) => { handlers.set(name, fn); return () => {}; },
  api: {
    sessionOpen: () => Promise.resolve(),
    sessionClose: () => Promise.resolve(),
    sessionInput: () => Promise.resolve(),
    sessionResize: () => Promise.resolve(),
    sessionAnswer: () => Promise.resolve(),
    rdpClose: () => Promise.resolve(),
  },
}));

const { sessions } = await import('./store');
sessions.start();

const tab = () => sessions.tab(sessions.get().active)!;
const ready = (paneId: string) => handlers.get('session:state')!({ session: sessions.pane(paneId)!.session, state: 'ready' });
const lost = (paneId: string) => handlers.get('session:state')!({ session: sessions.pane(paneId)!.session, state: 'ended', code: 'network', message: 'connection reset by peer', exit_code: -1 });

// A tab of `n` connected panes on `web`.
function connectedTab(n: number): string[] {
  const ids = [sessions.open('web')];
  for (let i = 1; i < n; i++) ids.push(sessions.split('right', 'web')!);
  ids.forEach(ready);
  return ids;
}

describe('broadcast input', () => {
  beforeEach(() => sessions.closeAll());

  it('is off on a new tab, a split, a layout and a duplicate', () => {
    const [a] = connectedTab(2);
    expect(tab().broadcast).toEqual([]);
    sessions.split('down');
    sessions.setLayout('grid');
    expect(tab().broadcast).toEqual([]);
    sessions.open('web');
    expect(tab().broadcast).toEqual([]);
    expect(sessions.receivers(a)).toEqual([]);
  });

  it('a pane joins by its toggle; only panes in the set receive, and only from a pane in it', () => {
    const [a, b, c] = connectedTab(3);
    sessions.toggleBroadcast(a);
    sessions.toggleBroadcast(c);
    expect(tab().broadcast).toEqual([a, c]);
    expect(sessions.receivers(a)).toEqual([c]);
    expect(sessions.receivers(c)).toEqual([a]);
    // Typed into a pane outside the set, keys go to it alone.
    expect(sessions.receivers(b)).toEqual([]);
    sessions.toggleBroadcast(a);
    expect(tab().broadcast).toEqual([c]);
    expect(sessions.receivers(c)).toEqual([]);
  });

  it('Broadcast to all panes takes every connected pane; Stop empties the set', () => {
    const [a, b, c] = connectedTab(3);
    const d = sessions.split('down')!; // empty: never a receiver
    expect(sessions.broadcastAll(tab().id)).toBe(3);
    expect(tab().broadcast).toEqual([a, b, c]);
    sessions.toggleBroadcast(d);
    expect(tab().broadcast).not.toContain(d);
    sessions.stopBroadcast(tab().id);
    expect(tab().broadcast).toEqual([]);
    expect(sessions.receivers(a)).toEqual([]);
  });

  it('needs two panes that are up to broadcast to all', () => {
    sessions.open('web');
    expect(sessions.broadcastAll(tab().id)).toBe(0);
    expect(tab().broadcast).toEqual([]);
  });

  it('a pane that drops leaves the set, says so, and a reconnect does not add it back', () => {
    const [a, b, c] = connectedTab(3);
    sessions.broadcastAll(tab().id);
    lost(c);
    expect(tab().broadcast).toEqual([a, b]);
    expect(sessions.pane(c)?.leftBroadcast).toBe(true);
    sessions.reconnect(c);
    ready(c);
    expect(tab().broadcast).toEqual([a, b]);
    expect(sessions.receivers(a)).toEqual([b]);
    // Added again by hand, it no longer says it left.
    sessions.toggleBroadcast(c);
    expect(sessions.pane(c)?.leftBroadcast).toBe(false);
    expect(tab().broadcast).toEqual([a, b, c]);
  });

  it('a pane reconnected while up leaves the set too', () => {
    const [a, b, c] = connectedTab(3);
    sessions.broadcastAll(tab().id);
    sessions.reconnect(b);
    expect(tab().broadcast).toEqual([a, c]);
    expect(sessions.pane(b)?.leftBroadcast).toBe(true);
  });

  it('a closed pane leaves the set; the last one out turns it off', () => {
    const [a, b] = connectedTab(2);
    sessions.broadcastAll(tab().id);
    sessions.close(b);
    expect(tab().broadcast).toEqual([a]);
    lost(a);
    expect(tab().broadcast).toEqual([]);
  });

  it('a pane that is not up neither joins nor receives', () => {
    const a = sessions.open('web');
    const b = sessions.split('right', 'web')!;
    ready(a);
    sessions.toggleBroadcast(b); // still connecting
    sessions.toggleBroadcast(a);
    expect(tab().broadcast).toEqual([a]);
    expect(sessions.receivers(a)).toEqual([]);
  });

  it('each tab has its own set', () => {
    const [a] = connectedTab(2);
    const first = tab().id;
    const [x] = connectedTab(2);
    sessions.broadcastAll(tab().id);
    expect(sessions.tab(first)?.broadcast).toEqual([]);
    expect(sessions.receivers(a)).toEqual([]);
    expect(sessions.receivers(x)).toHaveLength(1);
  });
});
