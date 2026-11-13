// An immersive full-screen RDP tab (milestone 37, designs 22b1–22b4). The window's
// own full screen is the OS's (macOS: its own Space, as Windows App; Linux and
// Windows: the whole monitor), asked for through `window_fullscreen` and heard back
// as `window:fullscreen`, so the green button and the system's own keys count too.
// The page is immersive (no rail, sidebar, tabs, toolbar or status bar) while the
// window is full screen and an RDP tab is the one shown.

import { useSyncExternalStore } from 'react';
import { api } from '../api/backend';

export interface FullScreenSnapshot {
  /** The window is full screen, as last heard from the OS. */
  window: boolean;
  /** The RDP tab shown immersive, or null. */
  tab: string | null;
  /** macOS: the menu bar and title bar the top edge reveals over the window, in px. */
  top: number;
}

export interface FullScreenBackend {
  set(on: boolean): Promise<unknown>;
}

export class FullScreenStore {
  private snap: FullScreenSnapshot = { window: false, tab: null, top: 0 };
  private listeners = new Set<() => void>();
  /** A request on its way to the window: an older change heard meanwhile is stale. */
  private wanted: boolean | null = null;

  constructor(private backend: FullScreenBackend) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = () => this.snap;

  private set(next: Partial<FullScreenSnapshot>) {
    const s = { ...this.snap, ...next };
    if (s.window === this.snap.window && s.tab === this.snap.tab && s.top === this.snap.top) return;
    this.snap = s;
    for (const fn of this.listeners) fn();
  }

  /** Full screen for RDP tab `tab`: the page goes immersive at once, the window follows. */
  enter(tab: string) {
    this.wanted = true;
    this.set({ tab });
    this.backend.set(true).catch(() => { this.wanted = null; this.set({ tab: null }); });
  }

  /** Leaves full screen: the window and the immersive page. */
  leave() {
    this.wanted = false;
    this.set({ tab: null });
    this.backend.set(false).catch(() => {});
  }

  toggle(tab: string | null) {
    if (this.snap.tab) this.leave();
    else if (tab) this.enter(tab);
  }

  /**
   * The OS says the window entered or left full screen. Leaving ends the immersive
   * page; entering by the OS's own means (the green button) makes `rdpTab`, the RDP
   * tab shown, immersive, as Windows App does.
   */
  heard(on: boolean, rdpTab: string | null, top = 0) {
    if (this.wanted !== null) {
      // The end of an earlier move (macOS animates): the window follows the request
      // once it settles, so only the answer to the request counts.
      if (on !== this.wanted) { this.set({ window: on }); return; }
      this.wanted = null;
    }
    if (!on) this.set({ window: false, tab: null });
    else this.set({ window: true, tab: this.snap.tab ?? rdpTab, top });
  }

  /**
   * The tab shown changed (another tab, the tab closed, an SSH tab). Full screen
   * belongs to one RDP tab: anything else leaves it.
   */
  shown(rdpTab: string | null) {
    if (this.snap.tab && this.snap.tab !== rdpTab) this.leave();
  }
}

export const fullScreen = new FullScreenStore({ set: (on) => api.windowFullscreen(on) });

export function useFullScreen(store: FullScreenStore = fullScreen): FullScreenSnapshot {
  return useSyncExternalStore(store.subscribe, store.get);
}
