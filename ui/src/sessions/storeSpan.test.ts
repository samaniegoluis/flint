// An RDP tab's size that settles while it spans monitors (milestone 38, fixed in 60):
// the window going full screen changes its area just before the span begins, and the
// resize that change scheduled must go into the layout, never take the desktop back
// to one monitor (gui-e2e's multimon run, "each window draws its part").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (ev: unknown) => void>();
const resizes: [string, number, number][] = [];
const opens: string[] = [];
vi.mock('../api/backend', () => ({
  on: (name: string, fn: (ev: unknown) => void) => { handlers.set(name, fn); return () => {}; },
  api: {
    rdpOpen: (session: string) => { opens.push(session); return Promise.resolve(); },
    rdpResize: (session: string, w: number, h: number) => { resizes.push([session, w, h]); return Promise.resolve(); },
    rdpClose: () => Promise.resolve(),
    sessionClose: () => Promise.resolve(),
  },
}));

let span = false;
const mainAreas: [string, number, number][] = [];
vi.mock('./monitors', () => ({
  monitors: {
    spanning: () => span,
    mainArea: (pane: string, w: number, h: number) => { mainAreas.push([pane, w, h]); },
    desktopReady: () => {},
    lost: () => {},
  },
}));

const { sessions } = await import('./store');
sessions.start();

describe('an RDP tab spanning monitors', () => {
  beforeEach(() => { vi.useFakeTimers(); span = false; resizes.length = 0; mainAreas.length = 0; opens.length = 0; });
  afterEach(() => { sessions.closeAll(); vi.useRealTimers(); });

  const ready = () => {
    const pane = sessions.open('win', false, 'rdp');
    sessions.desktopArea(pane, 948, 666);
    const session = opens[opens.length - 1];
    handlers.get('rdp:ready')!({ tab: session, width: 948, height: 666, frame_port: 1, frame_token: 't', graphics: 'compatible', rtt_ms: 1 });
    return { pane, session };
  };

  it('a size that settles after the span began goes into the layout, not a resize', () => {
    const { pane } = ready();
    sessions.desktopArea(pane, 1280, 800);
    span = true;
    vi.advanceTimersByTime(1000);
    expect(resizes).toEqual([]);
    expect(mainAreas).toEqual([[pane, 1280, 800]]);
  });

  it('on one monitor the settled size resizes the desktop', () => {
    const { pane, session } = ready();
    sessions.desktopArea(pane, 1280, 800);
    vi.advanceTimersByTime(1000);
    expect(resizes).toEqual([[session, 1280, 800]]);
    expect(mainAreas).toEqual([]);
  });
});
