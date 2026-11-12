import { describe, expect, it } from 'vitest';
import { cropPoint, monitorMap, MonitorsStore, type MonitorsBackend } from './monitors';
import type { DesktopSpan, LocalMonitor, MonitorPick, MonitorsView } from '../api/types';

const desk: LocalMonitor[] = [
  { id: '1', name: 'Studio 27', x: 0, y: 0, width: 2560, height: 1440, scale: 100, primary: true, physical: false },
  { id: '2', name: 'Portrait 24', x: -1080, y: -235, width: 1080, height: 1920, scale: 100, primary: false, physical: false },
  { id: '3', name: 'Built-in', x: 524, y: 1440, width: 1512, height: 982, scale: 200, primary: false, physical: false },
];

function fake(view: Partial<MonitorsView> = {}) {
  const calls: string[] = [];
  const sent: { id: string; data: Record<string, unknown> }[] = [];
  const spans: MonitorPick[][] = [];
  const backend: MonitorsBackend = {
    list: async () => ({ reason: '', monitors: desk, main: '1', picks: ['1', '2'], max: 2, ...view }),
    open: async (ids) => { calls.push(`open ${ids.join(',')}`); },
    close: async () => { calls.push('close'); },
    send: async (id, data) => { sent.push({ id, data: data as Record<string, unknown> }); },
    span: async (session, picks) => {
      spans.push(picks);
      calls.push(`span ${session} ${picks.map((p) => `${p.id}=${p.width}x${p.height}`).join(',')}`);
      const span: DesktopSpan = {
        monitors: [
          { local_id: '1', x: 0, y: 0, width: picks[0].width, height: picks[0].height, primary: true },
          { local_id: picks[1].id, x: -1080, y: -235, width: picks[1].width, height: picks[1].height, primary: false },
        ],
        crops: [{ x: 1080, y: 235, width: picks[0].width, height: picks[0].height }, { x: 0, y: 0, width: picks[1].width, height: picks[1].height }],
        width: 3640,
        height: 1920,
      };
      return span;
    },
    resize: async (session, w, h) => { calls.push(`resize ${session} ${w}x${h}`); },
  };
  const timers: (() => void)[] = [];
  const store = new MonitorsStore(backend, {
    setTimeout: ((fn: () => void) => { timers.push(fn); return timers.length as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout,
    clearTimeout: (() => {}) as typeof clearTimeout,
  });
  return { store, calls, sent, spans, timers };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const DESK = { port: 4100, token: 'tok' };

describe('a desktop across monitors', () => {
  it('opens the extra windows, waits for their sizes, lays out, then shows each its view', async () => {
    const { store, calls, sent } = fake();
    await store.enter('p1', 's1', { width: 2560, height: 1440 }, DESK);
    expect(store.get().phase).toBe('opening');
    expect(calls).toContain('open 2');
    // Nothing is laid out before the portrait says how large it came out.
    expect(calls.some((c) => c.startsWith('span'))).toBe(false);
    store.message('2', JSON.stringify({ type: 'ready', width: 1080, height: 1920 }));
    await tick();
    expect(calls).toContain('span s1 1=2560x1440,2=1080x1920');
    expect(store.get().phase).toBe('on');
    const show = sent.find((s) => s.data.type === 'show');
    expect(show).toMatchObject({ id: '2', data: { view: 1, port: 4100, token: 'tok', crop: { x: 0, y: 0, width: 1080, height: 1920 } } });
    // The main window's pointer lands at its crop.
    expect(store.mainOffset('p1')).toEqual({ x: 1080, y: 235 });
    expect(store.spanning('p1')).toBe(true);
  });

  it('greys the entry with the reason, and does nothing', async () => {
    const { store, calls } = fake({ reason: 'Not supported on this system yet' });
    await store.enter('p1', 's1', { width: 800, height: 600 }, DESK);
    expect(store.get().phase).toBe('off');
    expect(store.get().error).toBe('Not supported on this system yet');
    expect(calls.filter((c) => c.startsWith('open'))).toEqual([]);
  });

  it('relays an extra window\'s input to the main page, and drops it once off', async () => {
    const { store } = fake();
    const got: string[] = [];
    store.setInput('p1', {
      key: (k) => got.push(`key ${k.code} ${k.down}`),
      pointer: (p) => got.push(`ptr ${p.kind} ${p.x},${p.y}`),
      focus: () => got.push('focus'),
      blur: () => got.push('blur'),
    });
    await store.enter('p1', 's1', { width: 2560, height: 1440 }, DESK);
    store.message('2', JSON.stringify({ type: 'ready', width: 1080, height: 1920 }));
    await tick();
    store.message('2', JSON.stringify({ type: 'key', code: 'KeyA', down: true }));
    store.message('2', JSON.stringify({ type: 'pointer', kind: 'move', button: 0, x: 10.7, y: 20, delta: 0 }));
    store.message('2', JSON.stringify({ type: 'focus' }));
    store.message('3', JSON.stringify({ type: 'key', code: 'KeyB', down: true }));
    store.message('2', 'not json');
    expect(got).toEqual(['key KeyA true', 'ptr move 10,20', 'focus']);
    store.leave();
    store.message('2', JSON.stringify({ type: 'blur' }));
    expect(got).toEqual(['key KeyA true', 'ptr move 10,20', 'focus']);
  });

  it('leaves at the main window\'s size and closes the windows', async () => {
    const { store, calls } = fake();
    await store.enter('p1', 's1', { width: 2560, height: 1440 }, DESK);
    store.message('2', JSON.stringify({ type: 'ready', width: 1080, height: 1920 }));
    await tick();
    store.leave();
    expect(calls.slice(-2)).toEqual(['close', 'resize s1 2560x1440']);
    expect(store.get().phase).toBe('off');
    expect(store.spanning('p1')).toBe(false);
    expect(store.mainOffset('p1')).toEqual({ x: 0, y: 0 });
  });

  it('a window gone or a chosen monitor unplugged ends the span; another monitor does not', async () => {
    const f = fake();
    await f.store.enter('p1', 's1', { width: 2560, height: 1440 }, DESK);
    f.store.windowGone('3');
    expect(f.store.get().phase).toBe('opening');
    f.store.windowGone('2');
    expect(f.store.get().phase).toBe('off');
    const g = fake();
    await g.store.enter('p1', 's1', { width: 2560, height: 1440 }, DESK);
    let unplugged = false;
    (g.store as unknown as { backend: MonitorsBackend }).backend.list = async () => ({ reason: '', monitors: unplugged ? [desk[0], desk[2]] : desk, main: '1', picks: ['1', '3'], max: 2 });
    await g.store.screensChanged();
    expect(g.store.get().phase).toBe('opening');
    unplugged = true;
    await g.store.screensChanged();
    expect(g.store.get().phase).toBe('off');
  });

  it('a window that does not open in time ends the attempt with a reason', async () => {
    const { store, timers, calls } = fake();
    await store.enter('p1', 's1', { width: 2560, height: 1440 }, DESK);
    timers.forEach((fn) => fn());
    expect(store.get().phase).toBe('off');
    expect(store.get().error).toMatch(/in time/);
    expect(calls).toContain('close');
  });

  it('another choice rearranges, and a reconnect sends the layout again', async () => {
    const { store, calls, sent } = fake();
    await store.enter('p1', 's1', { width: 2560, height: 1440 }, DESK);
    store.message('2', JSON.stringify({ type: 'ready', width: 1080, height: 1920 }));
    await tick();
    store.choose(['1', '3']);
    expect(calls).toContain('open 3');
    expect(store.get().phase).toBe('opening');
    store.message('3', JSON.stringify({ type: 'ready', width: 1512, height: 949 }));
    await tick();
    expect(calls[calls.length - 1]).toBe('span s1 1=2560x1440,3=1512x949');
    const before = calls.length;
    store.desktopReady('p1', { port: 4200, token: 'new' });
    await tick();
    expect(calls.length).toBe(before + 1);
    expect(sent[sent.length - 1].data).toMatchObject({ type: 'show', port: 4200, token: 'new' });
    // Only the main one left checked: back to one monitor.
    store.choose(['1']);
    expect(store.get().phase).toBe('off');
  });
});

describe('the popover\'s map', () => {
  it('scales the monitors as arranged into its box', () => {
    const { tiles, width, height } = monitorMap(desk, 356, 170);
    expect(width).toBeLessThanOrEqual(356);
    expect(height).toBeLessThanOrEqual(170);
    const portrait = tiles.find((t) => t.monitor.id === '2')!;
    const main = tiles.find((t) => t.monitor.id === '1')!;
    expect(portrait.left).toBeLessThan(main.left);
    expect(portrait.height).toBeGreaterThan(portrait.width);
  });
});

describe('a pointer in an extra window', () => {
  it('lands in its crop of the surface', () => {
    expect(cropPoint(0, 0, 1080, 1920, { x: 0, y: 0, width: 1080, height: 1920 })).toEqual({ x: 0, y: 0 });
    expect(cropPoint(540, 960, 1080, 1920, { x: 2560, y: 360, width: 1080, height: 1920 })).toEqual({ x: 3100, y: 1320 });
    expect(cropPoint(5000, -3, 1080, 1920, { x: 10, y: 10, width: 1080, height: 1920 })).toEqual({ x: 1089, y: 10 });
  });
});
