// Tunnels in the app (milestone 23, design 20): every saved tunnel with its live
// state, and the starts in flight. A host's tunnels run on a session of their own
// with no terminal (D-062), so nothing here belongs to a tab: closing one, or its
// terminal reconnecting, leaves them up.
//
// The core says what runs (`tunnels_list`, refreshed on every "tunnels:changed"); this
// store adds what only the page knows: a start still logging in (with its prompt), and
// why the last start of a tunnel failed (a port in use, a login that failed). Nothing
// retries on its own (D-063): a switch flipped again starts again.

import { useSyncExternalStore } from 'react';
import { api, on } from '../api/backend';
import type { SessionPromptEvent, TunnelStartedEvent, TunnelView } from '../api/types';

/** A start from the app, logging in for `host`. */
export interface Start {
  session: string;
  host: string;
  /** The tunnels it opens; [] while the core picks them (Open when I connect). */
  names: string[];
  /** With no names: every tunnel of the host, not only its Open when I connect ones. */
  all: boolean;
  status: 'connecting' | 'prompt';
  prompt: SessionPromptEvent | null;
}

export interface Failure {
  code: string;
  message: string;
}

interface Snapshot {
  list: TunnelView[];
  loaded: boolean;
  starts: Record<string, Start>;
  /** Why a tunnel's last start failed, by `key(host, name)`. */
  failed: Record<string, Failure>;
  /** A login that failed for a host (design 20b4), until retried or dismissed. */
  loginFailed: Record<string, Failure>;
}

export const key = (host: string, name: string) => host + '\u0000' + name;

let seq = 0;
const mint = () => `tun-${Date.now().toString(36)}-${++seq}`;

export type StateKind = 'ok' | 'idle' | 'wait' | 'warn' | 'danger';

/** A tunnel's state line (design 20a): what the view, the menu and the editor show. */
export function stateLine(v: TunnelView, s: Pick<Snapshot, 'list' | 'starts' | 'failed'>): { kind: StateKind; text: string } {
  if (v.state === 'listening') {
    const n = v.connections;
    return { kind: 'ok', text: `listening · ${n === 0 ? 'no connections' : n === 1 ? '1 connection' : n + ' connections'}` };
  }
  const st = s.starts[v.host];
  if (st && inStart(st, v)) return { kind: 'wait', text: st.status === 'prompt' ? 'waiting for you…' : 'starting…' };
  if (v.state === 'connection lost') return { kind: 'danger', text: 'connection lost' + (v.error ? ' · ' + v.error : '') };
  const f = s.failed[key(v.host, v.name)];
  if (f?.code === 'port_in_use') {
    const holder = s.list.find((o) => o.local_port === v.local_port && o.state === 'listening' && key(o.host, o.name) !== key(v.host, v.name));
    return { kind: 'warn', text: `port ${v.local_port} in use · ` + (holder ? `used by ${holder.name} on ${holder.host}` : 'by another program') };
  }
  if (f) return { kind: 'danger', text: 'not started · ' + (f.code === 'auth' ? 'login failed' : f.message) };
  return { kind: 'idle', text: 'stopped' };
}

/** Whether a start under way opens this tunnel. */
function inStart(st: Start, v: TunnelView): boolean {
  if (st.names.length === 0) return st.all || v.open_on_connect;
  return st.names.some((n) => n.toLowerCase() === v.name.toLowerCase());
}

/** Whether the tunnel's switch is on: it listens, or a start for it is under way. */
export function switchedOn(v: TunnelView, s: Pick<Snapshot, 'starts'>): boolean {
  if (v.state === 'listening') return true;
  const st = s.starts[v.host];
  return !!st && inStart(st, v);
}

/** How to fix a port in use (design 20c2), or ''. */
export function portAdvice(v: TunnelView, s: Pick<Snapshot, 'list' | 'failed'>): string {
  if (s.failed[key(v.host, v.name)]?.code !== 'port_in_use') return '';
  const holder = s.list.find((o) => o.local_port === v.local_port && o.state === 'listening' && key(o.host, o.name) !== key(v.host, v.name));
  if (holder) return `Stop ${holder.name} on ${holder.host} first, or give ${v.name} another local port.`;
  return `Close what uses port ${v.local_port} on this machine, or give ${v.name} another local port.`;
}

/** The running tunnels of a host. */
export const upOn = (list: TunnelView[], host: string) => list.filter((v) => v.host === host && v.state === 'listening');

class TunnelStore {
  private snap: Snapshot = { list: [], loaded: false, starts: {}, failed: {}, loginFailed: {} };
  private listeners = new Set<() => void>();
  private started = false;
  private loading: Promise<void> | null = null;
  private again = false;
  /** Tunnels asked for while their host was logging in: started once it ends. */
  private queued: Record<string, string[]> = {};

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = () => this.snap;

  private set(p: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...p };
    for (const fn of this.listeners) fn();
  }

  start() {
    if (this.started) return;
    this.started = true;
    on('tunnels:changed', () => { void this.refresh(); });
    on<TunnelStartedEvent>('tunnel:started', (ev) => this.onStarted(ev));
    on<SessionPromptEvent>('session:prompt', (ev) => {
      const st = Object.values(this.snap.starts).find((s) => s.session === ev.session);
      if (!st || ev.kind === 'host_key_changed') return;
      this.set({ starts: { ...this.snap.starts, [st.host]: { ...st, status: 'prompt', prompt: ev } } });
    });
  }

  /** Lists the tunnels again; calls that arrive meanwhile run once more after it. */
  refresh(): Promise<void> {
    if (this.loading) { this.again = true; return this.loading; }
    this.loading = (async () => {
      try {
        const list = await api.tunnelsList();
        // A tunnel that listens has nothing left to explain.
        const failed = { ...this.snap.failed };
        for (const v of list) if (v.state === 'listening') delete failed[key(v.host, v.name)];
        this.set({ list, loaded: true, failed });
      } catch {
        // Locked, or no vault: keep what was shown.
      } finally {
        this.loading = null;
        if (this.again) { this.again = false; void this.refresh(); }
      }
    })();
    return this.loading;
  }

  /** Forgets everything (another vault, or none). */
  reset() {
    this.queued = {};
    this.set({ list: [], loaded: false, starts: {}, failed: {}, loginFailed: {} });
  }

  /**
   * Starts tunnels of `host`: `names`, or with none the host's Open when I connect
   * ones (`all`: every one). A host logs in once at a time; a second start while one
   * is under way waits for it.
   */
  startTunnels(host: string, names: string[] = [], all = false) {
    this.start();
    const cur = this.snap.starts[host];
    if (cur) {
      // Already logging in: these wait for it, then ride its session (no second prompt).
      const extra = names.filter((n) => !cur.names.includes(n));
      if (extra.length === 0) return;
      this.queued[host] = [...(this.queued[host] ?? []), ...extra];
      this.set({ starts: { ...this.snap.starts, [host]: { ...cur, names: [...cur.names, ...extra] } } });
      return;
    }
    const session = mint();
    const failed = { ...this.snap.failed };
    for (const n of names) delete failed[key(host, n)];
    const loginFailed = { ...this.snap.loginFailed };
    delete loginFailed[host];
    this.set({ starts: { ...this.snap.starts, [host]: { session, host, names, all, status: 'connecting', prompt: null } }, failed, loginFailed });
    void this.launch(host, names, all, session);
  }

  private async launch(host: string, names: string[], all: boolean, session: string) {
    try {
      await api.tunnelStart(session, host, names, all);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      this.onStarted({ session, host, results: [], code: e.code ?? 'internal', message: e.message ?? String(err) });
    }
  }

  private onStarted(ev: TunnelStartedEvent) {
    const failed = { ...this.snap.failed };
    for (const r of ev.results) {
      if (r.code) failed[key(ev.host, r.name)] = { code: r.code, message: r.message };
      else delete failed[key(ev.host, r.name)];
    }
    const loginFailed = { ...this.snap.loginFailed };
    if (ev.code) {
      loginFailed[ev.host] = { code: ev.code, message: ev.message };
      // Every tunnel the start was for stayed down with it (design 20b4).
      const st = this.snap.starts[ev.host];
      const names = st?.session === ev.session && st.names.length ? st.names
        : this.snap.list.filter((v) => v.host === ev.host && v.state !== 'listening' && (st?.all || v.open_on_connect)).map((v) => v.name);
      for (const n of [...names, ...(this.queued[ev.host] ?? [])]) failed[key(ev.host, n)] = { code: ev.code, message: ev.message };
    }
    const starts = { ...this.snap.starts };
    if (starts[ev.host]?.session === ev.session) delete starts[ev.host];
    this.set({ starts, failed, loginFailed });
    void this.refresh();
    const next = this.queued[ev.host];
    delete this.queued[ev.host];
    // After a failed login the queued ones stay down too: the switch tries again.
    if (next?.length && !ev.code) this.startTunnels(ev.host, next);
  }

  /** Answers the start's prompt: a password, or trusting a host key (`ok`). */
  answer(host: string, ok: boolean, value: string) {
    const st = this.snap.starts[host];
    if (!st?.prompt) return;
    const prompt = st.prompt.prompt;
    this.set({ starts: { ...this.snap.starts, [host]: { ...st, status: 'connecting', prompt: null } } });
    api.sessionAnswer(st.session, prompt, ok, value).catch(() => {});
  }

  /** Gives up a start still logging in. */
  cancel(host: string) {
    const st = this.snap.starts[host];
    if (st) api.sessionClose(st.session).catch(() => {});
  }

  dismissLogin(host: string) {
    const loginFailed = { ...this.snap.loginFailed };
    delete loginFailed[host];
    this.set({ loginFailed });
  }

  async stop(host: string, name: string) {
    const failed = { ...this.snap.failed };
    delete failed[key(host, name)];
    this.set({ failed });
    await api.tunnelStop(host, name);
    await this.refresh();
  }

  /** Stops every running tunnel of a host (design 20d2's "Stop them"). */
  async stopHost(host: string) {
    for (const v of upOn(this.snap.list, host)) await api.tunnelStop(v.host, v.name).catch(() => {});
    await this.refresh();
  }

  /** The switch: starts a stopped tunnel, stops a running one. */
  toggle(v: TunnelView) {
    if (switchedOn(v, this.snap)) {
      if (v.state === 'listening') return this.stop(v.host, v.name);
      return Promise.resolve();
    }
    this.startTunnels(v.host, [v.name]);
    return Promise.resolve();
  }
}

export const tunnels = new TunnelStore();

export function useTunnels(): Snapshot {
  return useSyncExternalStore(tunnels.subscribe, tunnels.get);
}
