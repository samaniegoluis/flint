// Open tabs and their SSH sessions. A tab keeps its terminal (and scrollback) across
// reconnects; each connection attempt is a new session id, minted here before
// session_open so the event listeners are already in place (spec: "the caller mints
// the session id and subscribes before starting").
//
// Terminal bytes bypass React: they go straight to the tab's xterm writer, or wait
// in a buffer until the terminal mounts.

import { useSyncExternalStore } from 'react';
import { api, on } from '../api/backend';
import { InputQueue } from '../lib/inputQueue';
import type { HostKeyPayload, SessionPromptEvent, SessionStateEvent } from '../api/types';

export type TabStatus = 'connecting' | 'prompt' | 'ready' | 'ended';

export interface SessionEnd {
  code: string;
  message: string;
  exit_code: number;
}

export interface Tab {
  id: string;
  alias: string;
  session: string;
  status: TabStatus;
  prompt: SessionPromptEvent | null;
  changedKey: HostKeyPayload | null;
  end: SessionEnd | null;
  connectedAt: number;
  /** Opened without the host's initial command; a reconnect keeps it that way. */
  noCommand: boolean;
  /** The shell's folder from OSC 7 (milestone 17), "" until it reports one. */
  cwd: string;
}

interface Snapshot {
  tabs: Tab[];
  active: string | null;
}

type Writer = (bytes: Uint8Array) => void;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let seq = 0;
const mint = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;

class SessionStore {
  private snap: Snapshot = { tabs: [], active: null };
  private listeners = new Set<() => void>();
  private writers = new Map<string, Writer>();
  private pending = new Map<string, Uint8Array[]>();
  private sizes = new Map<string, { cols: number; rows: number }>();
  private bySession = new Map<string, string>();
  private started = false;
  private inputs = new InputQueue((session, data) => api.sessionInput(session, data));

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = () => this.snap;

  private set(next: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...next };
    for (const fn of this.listeners) fn();
  }

  private patch(tabId: string, p: Partial<Tab>) {
    this.set({ tabs: this.snap.tabs.map((t) => (t.id === tabId ? { ...t, ...p } : t)) });
  }

  tab(tabId: string | null): Tab | undefined {
    return this.snap.tabs.find((t) => t.id === tabId);
  }

  // Installs the event listeners once.
  start() {
    if (this.started) return;
    this.started = true;
    on<{ session: string; data: string }>('terminal:output', (ev) => {
      const tabId = this.bySession.get(ev.session);
      if (!tabId) return;
      const bytes = b64ToBytes(ev.data);
      const w = this.writers.get(tabId);
      if (w) w(bytes);
      else {
        const q = this.pending.get(tabId) ?? [];
        q.push(bytes);
        this.pending.set(tabId, q);
      }
    });
    on<SessionStateEvent>('session:state', (ev) => {
      const tabId = this.bySession.get(ev.session);
      const t = this.tab(tabId ?? null);
      if (!t || t.session !== ev.session) return;
      if (ev.state === 'connecting') this.patch(t.id, { status: 'connecting', end: null, prompt: null });
      else if (ev.state === 'ready') this.patch(t.id, { status: 'ready', prompt: null, connectedAt: Date.now() });
      else {
        this.patch(t.id, { status: 'ended', prompt: null, end: { code: ev.code, message: ev.message, exit_code: ev.exit_code } });
        this.bySession.delete(ev.session);
        this.inputs.drop(ev.session);
      }
    });
    on<SessionPromptEvent>('session:prompt', (ev) => {
      const tabId = this.bySession.get(ev.session);
      const t = this.tab(tabId ?? null);
      if (!t || t.session !== ev.session) return;
      if (ev.kind === 'host_key_changed') this.patch(t.id, { changedKey: ev.host_key });
      else this.patch(t.id, { status: 'prompt', prompt: ev });
    });
  }

  private connect(tabId: string) {
    const t = this.tab(tabId);
    if (!t) return;
    const session = mint('s');
    this.bySession.set(session, tabId);
    this.patch(tabId, { session, status: 'connecting', prompt: null, changedKey: null, end: null, cwd: '' });
    const size = this.sizes.get(tabId) ?? { cols: 100, rows: 30 };
    api.sessionOpen(session, t.alias, size.cols, size.rows, t.noCommand).catch((err) => {
      this.bySession.delete(session);
      const e = err as { code?: string; message?: string };
      this.patch(tabId, { status: 'ended', end: { code: e.code ?? 'internal', message: e.message ?? String(err), exit_code: -1 } });
    });
  }

  open(alias: string, noCommand = false): string {
    const id = mint('t');
    const tab: Tab = { id, alias, session: '', status: 'connecting', prompt: null, changedKey: null, end: null, connectedAt: 0, noCommand, cwd: '' };
    this.set({ tabs: [...this.snap.tabs, tab], active: id });
    this.connect(id);
    return id;
  }

  reconnect(tabId: string) {
    const t = this.tab(tabId);
    if (!t) return;
    if (t.status !== 'ended' && t.session) api.sessionClose(t.session).catch(() => {});
    if (t.session) this.bySession.delete(t.session);
    this.writers.get(tabId)?.(new TextEncoder().encode('\r\n'));
    this.connect(tabId);
  }

  close(tabId: string) {
    const t = this.tab(tabId);
    if (!t) return;
    if (t.session && t.status !== 'ended') api.sessionClose(t.session).catch(() => {});
    this.bySession.delete(t.session);
    this.pending.delete(tabId);
    const idx = this.snap.tabs.findIndex((x) => x.id === tabId);
    const tabs = this.snap.tabs.filter((x) => x.id !== tabId);
    let active = this.snap.active;
    if (active === tabId) active = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
    this.set({ tabs, active });
  }

  // The vault closed: the backend already ended every session.
  closeAll() {
    this.bySession.clear();
    this.pending.clear();
    this.set({ tabs: [], active: null });
  }

  activate(tabId: string | null) {
    this.set({ active: tabId });
  }

  answer(tabId: string, ok: boolean, value: string) {
    const t = this.tab(tabId);
    if (!t?.prompt) return;
    const prompt = t.prompt.prompt;
    this.patch(tabId, { prompt: null, status: 'connecting' });
    api.sessionAnswer(t.session, prompt, ok, value).catch(() => {});
  }

  /** The shell said where it is (OSC 7). */
  setCwd(tabId: string, cwd: string) {
    const t = this.tab(tabId);
    if (t && t.cwd !== cwd) this.patch(tabId, { cwd });
  }

  input(tabId: string, data: string) {
    const t = this.tab(tabId);
    if (t && t.status === 'ready') this.inputs.push(t.session, data);
  }

  resize(tabId: string, cols: number, rows: number) {
    const prev = this.sizes.get(tabId);
    if (prev && prev.cols === cols && prev.rows === rows) return;
    this.sizes.set(tabId, { cols, rows });
    const t = this.tab(tabId);
    if (t && t.session && t.status !== 'ended') api.sessionResize(t.session, cols, rows).catch(() => {});
  }

  attach(tabId: string, writer: Writer) {
    this.writers.set(tabId, writer);
    for (const chunk of this.pending.get(tabId) ?? []) writer(chunk);
    this.pending.delete(tabId);
  }

  detach(tabId: string) {
    this.writers.delete(tabId);
  }
}

export const sessions = new SessionStore();

export function useSessions(): Snapshot {
  return useSyncExternalStore(sessions.subscribe, sessions.get);
}

export function statusLabel(t: Tab): { dot: string; meta: string; metaClass: string } {
  if (t.status === 'ready') return { dot: 'st-on', meta: '', metaClass: '' };
  if (t.status === 'prompt') {
    return { dot: 'st-wait', meta: t.prompt?.kind === 'host_key' ? 'verify host' : 'needs input', metaClass: 'accent-t' };
  }
  if (t.status === 'connecting') return { dot: 'st-wait', meta: 'connecting…', metaClass: 'faint' };
  if (t.end?.code === 'host_key' && t.changedKey) return { dot: 'st-fail', meta: 'host key changed', metaClass: 'danger-t' };
  if (t.end?.code) return { dot: 'st-fail', meta: t.end.code === 'auth' ? 'auth failed' : 'disconnected', metaClass: 'danger-t' };
  return { dot: 'st-off', meta: 'closed', metaClass: 'faint' };
}
