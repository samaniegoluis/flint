// A remote desktop across monitors (milestone 38, D-089, designs 22f1–22f4). Flint's
// window stays full screen on its monitor (Windows' primary, with the taskbar); each
// extra monitor gets a chrome-less full-screen window (`monitor.html`) drawing its part
// of the one surface from the frame channel. This store runs the steps:
//
//   open the extra windows → each says how large it came out ("ready") → the core
//   lays the monitors out and tells Windows through Display Control (`rdp_span`) →
//   each window is told its view of the frame channel and its crop ("show").
//
// Input in an extra window comes back here as messages and goes out through the main
// page's own key and pointer path, so the Mac's modifier keys, the chords Flint keeps
// and the held keys behave as in the main window. Leaving (Exit, the chord, another
// tab, the lock, a window or monitor gone) closes the windows and puts the desktop back
// on one monitor at the main window's size.

import { useSyncExternalStore } from 'react';
import { api } from '../api/backend';
import type { DesktopRect, DesktopSpan, LocalMonitor, MonitorPick, MonitorsView, RdpPointer } from '../api/types';

export type MonitorsPhase = 'off' | 'opening' | 'arranging' | 'on';

export interface MonitorsSnapshot {
  /** What the system offers; null until first read. */
  view: MonitorsView | null;
  phase: MonitorsPhase;
  /** The RDP pane spanning monitors, or null. */
  pane: string | null;
  /** Its session (the core's tab id). */
  session: string;
  /** The monitors chosen, the main one first. */
  picks: string[];
  /** The layout once the core sent it. */
  span: DesktopSpan | null;
  /** Why the last attempt stopped ('' when it did not). */
  error: string;
}

export interface MonitorsBackend {
  list(): Promise<MonitorsView>;
  open(ids: string[]): Promise<unknown>;
  close(): Promise<unknown>;
  send(id: string, data: unknown): Promise<unknown>;
  span(session: string, picks: MonitorPick[]): Promise<DesktopSpan>;
  resize(session: string, width: number, height: number): Promise<unknown>;
}

/** What an extra window sends back, as the main page's input path takes it. */
export interface MonitorInput {
  key(ev: { code: string; down: boolean; key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): void;
  pointer(p: RdpPointer): void;
  focus(): void;
  blur(): void;
}

/** How long the extra windows may take to open and measure themselves (Principle 8). */
export const OPEN_TIMEOUT_MS = 15000;
/** How long a new size of the main window settles before the layout follows. */
export const MAIN_SETTLE_MS = 400;

export class MonitorsStore {
  private snap: MonitorsSnapshot = { view: null, phase: 'off', pane: null, session: '', picks: [], span: null, error: '' };
  private listeners = new Set<() => void>();
  /** The size each window measured, by monitor id (the main one's from its tab area). */
  private sizes = new Map<string, { width: number; height: number }>();
  private inputs = new Map<string, MonitorInput>();
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped on every arrangement, so an answer to an older one is dropped. */
  private round = 0;

  // The page's timers, called as functions (WebKit refuses `setTimeout` called as a
  // method of another object: Illegal invocation).
  constructor(private backend: MonitorsBackend, private timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = {
    setTimeout: ((fn: () => void, ms?: number) => setTimeout(fn, ms)) as typeof setTimeout,
    clearTimeout: ((t?: ReturnType<typeof setTimeout>) => clearTimeout(t)) as typeof clearTimeout,
  }) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = () => this.snap;

  private set(next: Partial<MonitorsSnapshot>) {
    this.snap = { ...this.snap, ...next };
    for (const fn of this.listeners) fn();
  }

  /** Reads what the system offers now (the menu and the popover show it). */
  async refresh(): Promise<MonitorsView | null> {
    try {
      const view = await this.backend.list();
      this.set({ view });
      return view;
    } catch {
      return this.snap.view;
    }
  }

  /** Whether `pane` spans monitors now (its size changes go to the layout, not a resize). */
  spanning(pane: string): boolean {
    return this.snap.pane === pane && this.snap.phase !== 'off';
  }

  /** The surface's size while `pane` spans monitors, else null. */
  spanBox(pane: string): { width: number; height: number } | null {
    if (!this.spanning(pane) || !this.snap.span) return null;
    return { width: this.snap.span.width, height: this.snap.span.height };
  }

  /** Where the main window's part lies in the surface: its pointer adds this. */
  mainOffset(pane: string): { x: number; y: number } {
    if (!this.spanning(pane) || !this.snap.span) return { x: 0, y: 0 };
    const c = this.snap.span.crops[0];
    return { x: c.x, y: c.y };
  }

  setInput(pane: string, input: MonitorInput | null) {
    if (input) this.inputs.set(pane, input);
    else this.inputs.delete(pane);
  }

  /**
   * "Full screen on all monitors" for `pane`, whose main window measures `main`: the
   * default choice (remembered, else the nearest monitors), then the steps above.
   */
  async enter(pane: string, session: string, main: { width: number; height: number }, desk: { port: number; token: string }, chosen?: string[]) {
    const view = await this.refresh();
    const picks = chosen && view ? [view.main, ...chosen.filter((id) => id !== view.main)].slice(0, view.max) : view?.picks ?? [];
    if (!view || view.reason || picks.length < 2) {
      this.set({ error: view?.reason || 'Only one monitor connected' });
      return;
    }
    this.sizes.clear();
    this.desk = desk;
    this.sizes.set(view.main, { width: Math.floor(main.width), height: Math.floor(main.height) });
    this.set({ pane, session, error: '' });
    this.arrange(picks);
  }

  /** The popover's choice changed: the windows follow, then the layout. */
  choose(picks: string[]) {
    const view = this.snap.view;
    if (!view || this.snap.phase === 'off' || !picks.includes(view.main) || picks.length > view.max) return;
    if (picks.length < 2) { this.leave(); return; }
    this.arrange([view.main, ...picks.filter((id) => id !== view.main)]);
  }

  private arrange(picks: string[]) {
    const view = this.snap.view!;
    const round = ++this.round;
    const extras = picks.filter((id) => id !== view.main);
    for (const id of [...this.sizes.keys()]) if (id !== view.main && !extras.includes(id)) this.sizes.delete(id);
    this.set({ phase: 'opening', picks, error: '' });
    for (const id of extras) this.backend.send(id, { type: 'state', state: 'rearranging' }).catch(() => {});
    this.backend.open(extras).catch((err) => this.fail(round, err));
    this.timers.clearTimeout(this.openTimer);
    this.openTimer = this.timers.setTimeout(() => {
      if (round === this.round && this.snap.phase === 'opening') this.fail(round, new Error('the other monitors did not open in time'));
    }, OPEN_TIMEOUT_MS);
    this.maybeSpan(round);
  }

  private maybeSpan(round: number) {
    if (round !== this.round || this.snap.phase !== 'opening') return;
    if (!this.snap.picks.every((id) => this.sizes.has(id))) return;
    this.timers.clearTimeout(this.openTimer);
    this.span(round);
  }

  private async span(round: number) {
    const { session, picks } = this.snap;
    this.set({ phase: 'arranging' });
    let span: DesktopSpan;
    try {
      span = await this.backend.span(session, picks.map((id) => ({ id, ...this.sizes.get(id)! })));
    } catch (err) {
      this.fail(round, err);
      return;
    }
    if (round !== this.round || this.snap.phase === 'off') return;
    this.set({ phase: 'on', span });
    this.showAll();
  }

  /** Each extra window gets its view of the frame channel and its crop. */
  private showAll(desk?: { port: number; token: string }) {
    const { span } = this.snap;
    if (desk) this.desk = desk;
    if (!span || !this.desk) return;
    span.monitors.forEach((m, i) => {
      if (i === 0) return;
      this.backend.send(m.local_id, { type: 'show', port: this.desk!.port, token: this.desk!.token, view: i, crop: span.crops[i] }).catch(() => {});
    });
  }

  /** The frame channel of the desktop being spanned (it outlives a reconnect). */
  private desk: { port: number; token: string } | null = null;

  /**
   * The pane's desktop is up (first, or again after a reconnect, which comes back on
   * one monitor): the layout is sent again and the windows told where to read.
   */
  desktopReady(pane: string, desk: { port: number; token: string }) {
    if (!this.spanning(pane)) return;
    this.desk = desk;
    if (this.snap.phase === 'on') {
      const round = ++this.round;
      for (const m of this.snap.span?.monitors.slice(1) ?? []) this.backend.send(m.local_id, { type: 'state', state: 'rearranging' }).catch(() => {});
      this.span(round);
    } else {
      this.showAll(desk);
    }
  }

  /** The connection was lost: the extra windows say so (22f3b). */
  lost(pane: string) {
    if (!this.spanning(pane)) return;
    for (const id of this.snap.picks.slice(1)) this.backend.send(id, { type: 'state', state: 'lost' }).catch(() => {});
  }

  /** The main window's area changed while spanning: the layout follows once it settles. */
  mainArea(pane: string, width: number, height: number) {
    const view = this.snap.view;
    if (!view || !this.spanning(pane)) return;
    const prev = this.sizes.get(view.main);
    const next = { width: Math.floor(width), height: Math.floor(height) };
    if (prev && prev.width === next.width && prev.height === next.height) return;
    this.sizes.set(view.main, next);
    if (this.snap.phase === 'opening') { this.maybeSpan(this.round); return; }
    this.timers.clearTimeout(this.settleTimer);
    this.settleTimer = this.timers.setTimeout(() => {
      if (this.snap.phase === 'on') this.span(++this.round);
    }, MAIN_SETTLE_MS);
  }

  /** A message from an extra window's page. */
  message(id: string, data: string) {
    let m: Record<string, unknown>;
    try { m = JSON.parse(data); } catch { return; }
    if (this.snap.phase === 'off' || !this.snap.picks.includes(id)) return;
    const input = this.snap.pane ? this.inputs.get(this.snap.pane) : undefined;
    switch (m.type) {
      case 'ready': {
        const w = Number(m.width), h = Number(m.height);
        if (!(w > 0 && h > 0)) return;
        const prev = this.sizes.get(id);
        this.sizes.set(id, { width: Math.floor(w), height: Math.floor(h) });
        if (this.snap.phase === 'opening') this.maybeSpan(this.round);
        else if (this.snap.phase === 'on' && prev && (prev.width !== Math.floor(w) || prev.height !== Math.floor(h))) this.span(++this.round);
        else if (this.snap.phase === 'on') this.showAll();
        return;
      }
      case 'key':
        input?.key({ code: String(m.code ?? ''), down: !!m.down, key: String(m.key ?? ''), ctrlKey: !!m.ctrlKey, metaKey: !!m.metaKey, altKey: !!m.altKey, shiftKey: !!m.shiftKey });
        return;
      case 'pointer': {
        const p = { kind: String(m.kind ?? ''), button: Number(m.button ?? 0), x: Math.floor(Number(m.x)), y: Math.floor(Number(m.y)), delta: Number(m.delta ?? 0) };
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) input?.pointer(p as RdpPointer);
        return;
      }
      case 'focus': input?.focus(); return;
      case 'blur': input?.blur(); return;
    }
  }

  /** An extra window went away by itself (closed, out of full screen): back to one. */
  windowGone(id: string) {
    if (this.snap.phase !== 'off' && this.snap.picks.includes(id)) this.leave();
  }

  /** Monitors were connected or removed: a chosen one gone ends the span. */
  async screensChanged() {
    const view = await this.refresh();
    if (this.snap.phase === 'off' || !view) return;
    const ids = new Set(view.monitors.map((m) => m.id));
    if (!this.snap.picks.every((id) => ids.has(id))) this.leave();
  }

  private fail(round: number, err: unknown) {
    if (round !== this.round) return;
    const e = err as { message?: string };
    this.leave();
    this.set({ error: e.message ?? String(err) });
  }

  /** Back to one monitor, at the main window's size; the extra windows close. */
  leave() {
    if (this.snap.phase === 'off') return;
    const { session, view } = this.snap;
    this.round++;
    this.timers.clearTimeout(this.openTimer);
    this.timers.clearTimeout(this.settleTimer);
    const main = view ? this.sizes.get(view.main) : undefined;
    this.set({ phase: 'off', pane: null, span: null, picks: [] });
    this.desk = null;
    this.backend.close().catch(() => {});
    if (session && main) this.backend.resize(session, main.width, main.height).catch(() => {});
  }
}

export const monitors = new MonitorsStore({
  list: () => api.monitorsList(),
  open: (ids) => api.monitorsOpen(ids),
  close: () => api.monitorsClose(),
  send: (id, data) => api.monitorsSend(id, data),
  span: (session, picks) => api.rdpSpan(session, picks),
  resize: (session, w, h) => api.rdpResize(session, w, h),
});

export function useMonitors(store: MonitorsStore = monitors): MonitorsSnapshot {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** A tile of the popover's map (22f2a): the monitor scaled into the map's box. */
export interface MonitorTile {
  monitor: LocalMonitor;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The monitors as arranged, scaled to fit `boxW` x `boxH` with a gap between
 * neighbours; returns the tiles and the map's own size.
 */
export function monitorMap(ms: LocalMonitor[], boxW: number, boxH: number, gap = 4): { tiles: MonitorTile[]; width: number; height: number } {
  if (ms.length === 0) return { tiles: [], width: 0, height: 0 };
  const x1 = Math.min(...ms.map((m) => m.x));
  const y1 = Math.min(...ms.map((m) => m.y));
  const x2 = Math.max(...ms.map((m) => m.x + m.width));
  const y2 = Math.max(...ms.map((m) => m.y + m.height));
  const s = Math.min(boxW / Math.max(1, x2 - x1), boxH / Math.max(1, y2 - y1));
  const tiles = ms.map((m) => ({
    monitor: m,
    left: Math.round((m.x - x1) * s) + gap / 2,
    top: Math.round((m.y - y1) * s) + gap / 2,
    width: Math.max(8, Math.round(m.width * s) - gap),
    height: Math.max(8, Math.round(m.height * s) - gap),
  }));
  return { tiles, width: Math.round((x2 - x1) * s), height: Math.round((y2 - y1) * s) };
}

/**
 * A pointer in a window spanning monitors, in the surface's pixels: its crop's place
 * added. Not held to the crop: while a button is down the system keeps sending the
 * pointer to the window where the press began, even over the next monitor, so a drag
 * from one monitor to another (a window moved across) goes on in the surface instead of
 * sticking at the crop's edge, where Windows took it for a window pushed against the
 * screen's top. Held to the surface (`box`) when known, else to the protocol's bound;
 * the engine holds it to the desktop too.
 */
export function cropPoint(x: number, y: number, shownW: number, shownH: number, crop: DesktopRect, box?: { width: number; height: number }): { x: number; y: number } {
  const dx = Math.floor((x / Math.max(1, shownW)) * crop.width);
  const dy = Math.floor((y / Math.max(1, shownH)) * crop.height);
  const maxX = (box ? box.width : 8192) - 1;
  const maxY = (box ? box.height : 8192) - 1;
  return { x: Math.min(Math.max(0, crop.x + dx), maxX), y: Math.min(Math.max(0, crop.y + dy), maxY) };
}
