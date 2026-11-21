// Live server resources (milestone 55): one watch per terminal pane whose shell is
// open, while Settings → Terminal's *Show server resources* is on. The core runs each
// watch on the pane's own SSH session and ends it with the session; the page stops
// them all when the setting turns off. The status bar shows the focused pane's.

import { api, on } from '../api/backend';
import type { ServerSample } from '../api/types';
import { hasFields } from '../lib/serverStats';

/** `waiting` before the first sample (the skeleton, 25a7), `none` when the host
 * shows nothing (25a6), `live` with the latest sample. */
export type StatsView =
  | { state: 'waiting' }
  | { state: 'none' }
  | { state: 'live'; sample: ServerSample; at: number };

export interface StatsBackend {
  start(session: string, watch: string): Promise<unknown>;
  stop(session: string, watch: string): Promise<unknown>;
}

let seq = 0;
function watchId(): string {
  seq += 1;
  return `stats-${Date.now().toString(36)}-${seq}`;
}

export class ServerStatsStore {
  private views = new Map<string, StatsView>();
  private watches = new Map<string, string>();
  private listeners = new Set<() => void>();
  private snapshot = new Map<string, StatsView>();

  constructor(private backend: StatsBackend, private now: () => number = Date.now) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  get = () => this.snapshot;

  view(session: string | undefined): StatsView | null {
    return session ? this.snapshot.get(session) ?? null : null;
  }

  private changed() {
    this.snapshot = new Map(this.views);
    for (const fn of this.listeners) fn();
  }

  /** Watches exactly `sessions` (open terminal shells) when `on`, none otherwise. */
  sync(sessions: string[], on: boolean) {
    const want = new Set(on ? sessions : []);
    let dirty = false;
    for (const [session, watch] of [...this.watches]) {
      if (want.has(session)) continue;
      this.watches.delete(session);
      this.views.delete(session);
      dirty = true;
      // A session that ended took its watch with it; one still open (the setting
      // turned off) is asked to stop.
      if (!on || sessions.includes(session)) this.backend.stop(session, watch).catch(() => {});
    }
    for (const session of want) {
      if (this.watches.has(session)) continue;
      const watch = watchId();
      this.watches.set(session, watch);
      this.views.set(session, { state: 'waiting' });
      dirty = true;
      this.backend.start(session, watch).catch(() => {
        if (this.watches.get(session) !== watch) return;
        this.views.set(session, { state: 'none' });
        this.changed();
      });
    }
    if (dirty) this.changed();
  }

  /** A `stats:sample` from the core. One for a session no longer watched is dropped. */
  sample(s: ServerSample) {
    if (!this.watches.has(s.session)) return;
    this.views.set(s.session, hasFields(s) ? { state: 'live', sample: s, at: this.now() } : { state: 'none' });
    this.changed();
  }

  /** The vault locked or closed: every session goes, and so does what they showed. */
  clear() {
    this.watches.clear();
    this.views.clear();
    this.changed();
  }
}

let shared: ServerStatsStore | null = null;

/** The app's one store, listening to `stats:sample` from its first use. */
export function serverStats(): ServerStatsStore {
  if (!shared) {
    const store = new ServerStatsStore({ start: api.statsWatch, stop: api.statsStop });
    on<ServerSample>('stats:sample', (s) => store.sample(s));
    shared = store;
  }
  return shared;
}
