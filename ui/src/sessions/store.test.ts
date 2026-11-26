import { beforeEach, describe, expect, it, vi } from 'vitest';

const opened: string[] = [];
const closed: string[] = [];
vi.mock('../api/backend', () => ({
  on: () => () => {},
  api: {
    sessionOpen: (session: string) => { opened.push(session); return Promise.resolve(); },
    sessionClose: (session: string) => { closed.push(session); return Promise.resolve(); },
    sessionInput: () => Promise.resolve(),
    sessionResize: () => Promise.resolve(),
    sessionAnswer: () => Promise.resolve(),
  },
}));

const { sessions, rdpEndKind } = await import('./store');

const tab = () => sessions.tab(sessions.get().active)!;

describe('tabs of panes', () => {
  beforeEach(() => { sessions.closeAll(); opened.length = 0; closed.length = 0; });

  it('opens a tab with one pane and its own session', () => {
    const p = sessions.open('web');
    expect(tab().panes).toEqual([p]);
    expect(tab().focus).toBe(p);
    expect(sessions.pane(p)?.tab).toBe(tab().id);
    expect(opened).toHaveLength(1);
  });

  it('splits after the focused pane, empty or on a host named, up to four', () => {
    const a = sessions.open('web');
    const b = sessions.split('right')!;
    expect(tab().panes).toEqual([a, b]);
    expect(tab().layout).toBe('cols');
    expect(tab().focus).toBe(b);
    // Milestone 72: a split opens an empty pane that suggests the focused pane's host.
    expect(sessions.pane(b)).toMatchObject({ status: 'empty', alias: '', session: '', suggest: 'web', from: a });
    expect(opened).toHaveLength(1);
    sessions.focusPane(a);
    const c = sessions.split('down', 'db')!;
    expect(tab().panes).toEqual([a, c, b]);
    expect(tab().layout).toBe('large');
    expect(sessions.pane(c)).toMatchObject({ alias: 'db', status: 'connecting' });
    expect(opened).toHaveLength(2);
    sessions.split('down');
    expect(tab().layout).toBe('grid');
    expect(sessions.split('right')).toBeNull();
    expect(tab().panes).toHaveLength(4);
  });

  it('an empty pane opens no session until a host is picked, then becomes its session', () => {
    sessions.open('web', true);
    const b = sessions.split('right')!;
    expect(opened).toHaveLength(1);
    sessions.reconnect(b);
    expect(opened).toHaveLength(1);
    sessions.fill(b, 'web');
    expect(opened).toHaveLength(2);
    // The suggested host keeps the no-command choice of the pane it came from.
    expect(sessions.pane(b)).toMatchObject({ alias: 'web', status: 'connecting', noCommand: true, suggest: '' });
    expect(sessions.pane(b)!.session).toBe(opened[1]);
    const c = sessions.split('down')!;
    sessions.fill(c, 'db');
    expect(sessions.pane(c)).toMatchObject({ alias: 'db', noCommand: false });
    // Filling a pane that is not empty does nothing.
    sessions.fill(c, 'other');
    expect(sessions.pane(c)!.alias).toBe('db');
    expect(opened).toHaveLength(3);
  });

  it('a split from an empty pane suggests the host that pane suggested', () => {
    const a = sessions.open('web');
    sessions.split('right');
    const c = sessions.split('down')!;
    expect(sessions.pane(c)).toMatchObject({ suggest: 'web', from: a });
  });

  it('a layout with more places than panes adds empty ones and focuses the first', () => {
    const a = sessions.open('web');
    sessions.setLayout('grid');
    const t = tab();
    expect(t.layout).toBe('grid');
    expect(t.panes).toHaveLength(4);
    expect(t.panes[0]).toBe(a);
    expect(t.focus).toBe(t.panes[1]);
    expect(t.panes.slice(1).map((id) => sessions.pane(id)!.status)).toEqual(['empty', 'empty', 'empty']);
    expect(opened).toHaveLength(1);
    expect(t).toMatchObject({ cols: [1, 1], rows: [1, 1] });
    // Fewer places than panes only lays them out again.
    sessions.setLayout('cols');
    expect(tab().panes).toHaveLength(4);
    expect(tab().layout).toBe('cols');
  });

  it('closing an empty pane leaves the others and opens or closes no session', () => {
    const a = sessions.open('web');
    const b = sessions.split('right')!;
    const c = sessions.split('right', 'db')!;
    closed.length = 0;
    sessions.close(b);
    expect(closed).toEqual([]);
    expect(tab().panes).toEqual([a, c]);
    expect(sessions.pane(a)!.status).toBe('connecting');
    expect(sessions.pane(c)!.status).toBe('connecting');
  });

  it('remembers the hosts connected in this run, newest first', () => {
    sessions.open('web');
    sessions.open('db');
    sessions.open('web');
    expect(sessions.recentHosts().slice(0, 2)).toEqual(['web', 'db']);
  });

  it('closes one pane and hangs up only its session', () => {
    const a = sessions.open('web');
    const b = sessions.split('down', 'web')!;
    const sb = sessions.pane(b)!.session;
    sessions.close(b);
    expect(closed).toEqual([sb]);
    expect(tab().panes).toEqual([a]);
    expect(tab().focus).toBe(a);
    expect(sessions.get().panes.map((p) => p.id)).toEqual([a]);
  });

  it('keeps no hole when a grid loses panes', () => {
    sessions.open('web');
    sessions.split('right');
    const c = sessions.split('right')!;
    const d = sessions.split('right')!;
    expect(tab().layout).toBe('grid');
    sessions.close(d);
    expect(tab().layout).toBe('grid');
    sessions.close(c);
    expect(tab().layout).toBe('cols');
  });

  it('closing the last pane closes the tab, and closing a tab hangs up every pane', () => {
    const a = sessions.open('web');
    sessions.close(a);
    expect(sessions.get().tabs).toHaveLength(0);
    sessions.open('web');
    sessions.split('right', 'web');
    sessions.split('right', 'db');
    const ids = sessions.get().panes.map((p) => p.session);
    closed.length = 0;
    sessions.closeTab(tab().id);
    expect(closed.sort()).toEqual(ids.sort());
    expect(sessions.get().panes).toHaveLength(0);
    expect(sessions.get().active).toBeNull();
  });

  it('moves the focus between panes and to another tab', () => {
    const a = sessions.open('web');
    const b = sessions.split('right')!;
    sessions.cycleFocus(1);
    expect(tab().focus).toBe(a);
    sessions.cycleFocus(-1);
    expect(tab().focus).toBe(b);
    const other = sessions.open('db');
    expect(sessions.focused()?.id).toBe(other);
    sessions.focusPane(a);
    expect(sessions.focused()?.id).toBe(a);
  });

  it('changes the layout, resetting the tracks', () => {
    sessions.open('web');
    sessions.split('right');
    sessions.setTracks(tab().id, 'cols', [0.7, 0.3]);
    sessions.setLayout('rows');
    expect(tab()).toMatchObject({ layout: 'rows', cols: [1], rows: [1, 1] });
  });
});

describe('why a remote desktop ended', () => {
  const ended = (code: string, message: string, connectedAt = 0) =>
    ({ end: { code, message }, connectedAt } as unknown as Parameters<typeof rdpEndKind>[0]);

  it('tells a server with only Standard RDP Security from other refusals (milestone 36)', () => {
    expect(rdpEndKind(ended('refused', 'refused: the server offers only Standard RDP Security, where no certificate protects the password; Flint refuses it'))).toBe('legacy-security');
    expect(rdpEndKind(ended('refused', 'refused: nothing answers on the Remote Desktop port: Remote Desktop may be off'))).toBe('rdp-off');
    expect(rdpEndKind(ended('refused', 'refused: the server ended the session'))).toBe('refused');
    expect(rdpEndKind(ended('network', 'network: lost', 5))).toBe('lost');
  });

  it('tells a server that closed during setup from no route at all (milestone 59)', () => {
    expect(rdpEndKind(ended('refused', 'the server closed the connection during setup (CONNECTION_STATE_CAPABILITIES_EXCHANGE_MONITOR_LAYOUT)'))).toBe('setup-closed');
    expect(rdpEndKind(ended('network', 'could not reach the server (ERRCONNECT_CONNECT_TRANSPORT_FAILED)'))).toBe('unreachable');
  });
});
