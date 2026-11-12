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

  it('splits after the focused pane, on its host, up to four', () => {
    const a = sessions.open('web');
    const b = sessions.split('right')!;
    expect(tab().panes).toEqual([a, b]);
    expect(tab().layout).toBe('cols');
    expect(tab().focus).toBe(b);
    expect(sessions.pane(b)?.alias).toBe('web');
    expect(opened).toHaveLength(2);
    expect(new Set(opened).size).toBe(2);
    sessions.focusPane(a);
    const c = sessions.split('down', 'db')!;
    expect(tab().panes).toEqual([a, c, b]);
    expect(tab().layout).toBe('large');
    expect(sessions.pane(c)?.alias).toBe('db');
    sessions.split('down');
    expect(tab().layout).toBe('grid');
    expect(sessions.split('right')).toBeNull();
    expect(tab().panes).toHaveLength(4);
  });

  it('closes one pane and hangs up only its session', () => {
    const a = sessions.open('web');
    const b = sessions.split('down')!;
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
    sessions.split('right');
    sessions.split('right');
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

  it('changes the layout only with two panes or more, resetting the tracks', () => {
    sessions.open('web');
    sessions.setLayout('rows');
    expect(tab().layout).toBe('cols');
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
});
