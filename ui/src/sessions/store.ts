// Open tabs, their panes and each pane's SSH session (milestone 20: "a pane is a
// session, a tab is a layout"). A pane keeps its terminal (and scrollback) across
// reconnects; each connection attempt is a new session id, minted here before
// session_open so the event listeners are already in place (spec: "the caller mints
// the session id and subscribes before starting"). A tab holds one to four panes,
// their layout and which one has the focus; closing it hangs up each of them.
//
// Terminal bytes bypass React: they go straight to the pane's xterm writer, or wait
// in a buffer until the terminal mounts.

import { useSyncExternalStore } from 'react';
import { api, on } from '../api/backend';
import { InputQueue } from '../lib/inputQueue';
import { defaultTracks, layoutAfterClose, layoutForSplit, MAX_PANES, type Layout, type SplitDir } from '../lib/layout';
import type { HostKeyPayload, SessionPromptEvent, SessionStateEvent } from '../api/types';

export type PaneStatus = 'connecting' | 'prompt' | 'ready' | 'ended';

export interface SessionEnd {
  code: string;
  message: string;
  exit_code: number;
}

/** One terminal and its SSH session. */
export interface Pane {
  id: string;
  /** The tab it belongs to. */
  tab: string;
  alias: string;
  session: string;
  status: PaneStatus;
  prompt: SessionPromptEvent | null;
  changedKey: HostKeyPayload | null;
  end: SessionEnd | null;
  connectedAt: number;
  /** Opened without the host's initial command; a reconnect keeps it that way. */
  noCommand: boolean;
  /** The shell's folder from OSC 7 (milestone 17), "" until it reports one. */
  cwd: string;
}

/** A tab: one to four panes in a layout. */
export interface Tab {
  id: string;
  panes: string[];
  layout: Layout;
  /** The focused pane: the toolbar, the Files view and the title follow it. */
  focus: string;
  /** Grid track sizes (lib/layout.ts). */
  cols: number[];
  rows: number[];
}

interface Snapshot {
  tabs: Tab[];
  panes: Pane[];
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
  private snap: Snapshot = { tabs: [], panes: [], active: null };
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

  private patch(paneId: string, p: Partial<Pane>) {
    this.set({ panes: this.snap.panes.map((t) => (t.id === paneId ? { ...t, ...p } : t)) });
  }

  private patchTab(tabId: string, p: Partial<Tab>) {
    this.set({ tabs: this.snap.tabs.map((t) => (t.id === tabId ? { ...t, ...p } : t)) });
  }

  pane(paneId: string | null): Pane | undefined {
    return this.snap.panes.find((t) => t.id === paneId);
  }

  tab(tabId: string | null): Tab | undefined {
    return this.snap.tabs.find((t) => t.id === tabId);
  }

  /** The active tab's focused pane. */
  focused(): Pane | undefined {
    return this.pane(this.tab(this.snap.active)?.focus ?? null);
  }

  // Installs the event listeners once.
  start() {
    if (this.started) return;
    this.started = true;
    on<{ session: string; data: string }>('terminal:output', (ev) => {
      const paneId = this.bySession.get(ev.session);
      if (!paneId) return;
      const bytes = b64ToBytes(ev.data);
      const w = this.writers.get(paneId);
      if (w) w(bytes);
      else {
        const q = this.pending.get(paneId) ?? [];
        q.push(bytes);
        this.pending.set(paneId, q);
      }
    });
    on<SessionStateEvent>('session:state', (ev) => {
      const paneId = this.bySession.get(ev.session);
      const t = this.pane(paneId ?? null);
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
      const paneId = this.bySession.get(ev.session);
      const t = this.pane(paneId ?? null);
      if (!t || t.session !== ev.session) return;
      if (ev.kind === 'host_key_changed') this.patch(t.id, { changedKey: ev.host_key });
      else this.patch(t.id, { status: 'prompt', prompt: ev });
    });
  }

  private connect(paneId: string) {
    const t = this.pane(paneId);
    if (!t) return;
    const session = mint('s');
    this.bySession.set(session, paneId);
    this.patch(paneId, { session, status: 'connecting', prompt: null, changedKey: null, end: null, cwd: '' });
    const size = this.sizes.get(paneId) ?? { cols: 100, rows: 30 };
    api.sessionOpen(session, t.alias, size.cols, size.rows, t.noCommand).catch((err) => {
      this.bySession.delete(session);
      const e = err as { code?: string; message?: string };
      this.patch(paneId, { status: 'ended', end: { code: e.code ?? 'internal', message: e.message ?? String(err), exit_code: -1 } });
    });
  }

  private newPane(tabId: string, alias: string, noCommand: boolean): Pane {
    return { id: mint('p'), tab: tabId, alias, session: '', status: 'connecting', prompt: null, changedKey: null, end: null, connectedAt: 0, noCommand, cwd: '' };
  }

  /** Opens `alias` in a new tab; returns the new pane's id. */
  open(alias: string, noCommand = false): string {
    const id = mint('t');
    const pane = this.newPane(id, alias, noCommand);
    const tab: Tab = { id, panes: [pane.id], layout: 'cols', focus: pane.id, ...defaultTracks('cols', 1) };
    this.set({ tabs: [...this.snap.tabs, tab], panes: [...this.snap.panes, pane], active: id });
    this.connect(pane.id);
    return pane.id;
  }

  /**
   * Splits the active tab: a new pane on `alias` (by default the focused pane's host)
   * right after the focused one, which takes the focus. Returns its id, or null when
   * there is no tab or it already holds MAX_PANES.
   */
  split(dir: SplitDir, alias?: string, noCommand = false): string | null {
    const tab = this.tab(this.snap.active);
    if (!tab || tab.panes.length >= MAX_PANES) return null;
    const from = this.pane(tab.focus);
    const host = alias ?? from?.alias;
    if (!host) return null;
    const pane = this.newPane(tab.id, host, alias ? noCommand : (from?.noCommand ?? false));
    const at = Math.max(0, tab.panes.indexOf(tab.focus)) + 1;
    const panes = [...tab.panes.slice(0, at), pane.id, ...tab.panes.slice(at)];
    const layout = layoutForSplit(panes.length, dir);
    // The new pane starts at its neighbour's size, so its first prompt fits.
    const size = from ? this.sizes.get(from.id) : undefined;
    if (size) this.sizes.set(pane.id, size);
    this.set({
      panes: [...this.snap.panes, pane],
      tabs: this.snap.tabs.map((t) => (t.id === tab.id ? { ...t, panes, layout, focus: pane.id, ...defaultTracks(layout, panes.length) } : t)),
    });
    this.connect(pane.id);
    return pane.id;
  }

  setLayout(layout: Layout) {
    const tab = this.tab(this.snap.active);
    if (!tab || tab.panes.length < 2) return;
    this.patchTab(tab.id, { layout, ...defaultTracks(layout, tab.panes.length) });
  }

  /** A divider was dragged (or reset). */
  setTracks(tabId: string, axis: 'cols' | 'rows', tracks: number[]) {
    this.patchTab(tabId, { [axis]: tracks });
  }

  focusPane(paneId: string) {
    const p = this.pane(paneId);
    if (!p) return;
    const tab = this.tab(p.tab);
    if (tab && tab.focus !== paneId) this.patchTab(p.tab, { focus: paneId });
    if (this.snap.active !== p.tab) this.set({ active: p.tab });
  }

  /** Moves the focus to the next (1) or previous (-1) pane of the active tab. */
  cycleFocus(dir: 1 | -1) {
    const tab = this.tab(this.snap.active);
    if (!tab || tab.panes.length < 2) return;
    const i = tab.panes.indexOf(tab.focus);
    this.patchTab(tab.id, { focus: tab.panes[(i + dir + tab.panes.length) % tab.panes.length] });
  }

  reconnect(paneId: string) {
    const t = this.pane(paneId);
    if (!t) return;
    if (t.status !== 'ended' && t.session) api.sessionClose(t.session).catch(() => {});
    if (t.session) this.bySession.delete(t.session);
    this.writers.get(paneId)?.(new TextEncoder().encode('\r\n'));
    this.connect(paneId);
  }

  private hangUp(t: Pane) {
    if (t.session && t.status !== 'ended') api.sessionClose(t.session).catch(() => {});
    this.bySession.delete(t.session);
    this.pending.delete(t.id);
    this.sizes.delete(t.id);
  }

  /** Closes one pane and hangs up its session; the last pane closes its tab. */
  close(paneId: string) {
    const t = this.pane(paneId);
    if (!t) return;
    const tab = this.tab(t.tab);
    if (!tab || tab.panes.length <= 1) { this.closeTab(t.tab); return; }
    this.hangUp(t);
    const i = tab.panes.indexOf(paneId);
    const panes = tab.panes.filter((id) => id !== paneId);
    const focus = tab.focus === paneId ? panes[Math.min(Math.max(0, i - 1), panes.length - 1)] : tab.focus;
    const layout = layoutAfterClose(panes.length, tab.layout);
    this.set({
      panes: this.snap.panes.filter((x) => x.id !== paneId),
      tabs: this.snap.tabs.map((x) => (x.id === tab.id ? { ...x, panes, focus, layout, ...defaultTracks(layout, panes.length) } : x)),
    });
  }

  /** Closes a tab and hangs up each of its panes. */
  closeTab(tabId: string) {
    const tab = this.tab(tabId);
    if (!tab) return;
    for (const id of tab.panes) { const p = this.pane(id); if (p) this.hangUp(p); }
    const idx = this.snap.tabs.findIndex((x) => x.id === tabId);
    const tabs = this.snap.tabs.filter((x) => x.id !== tabId);
    let active = this.snap.active;
    if (active === tabId) active = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
    this.set({ tabs, panes: this.snap.panes.filter((p) => p.tab !== tabId), active });
  }

  // The vault closed: the backend already ended every session.
  closeAll() {
    this.bySession.clear();
    this.pending.clear();
    this.sizes.clear();
    this.set({ tabs: [], panes: [], active: null });
  }

  activate(tabId: string | null) {
    this.set({ active: tabId });
  }

  answer(paneId: string, ok: boolean, value: string) {
    const t = this.pane(paneId);
    if (!t?.prompt) return;
    const prompt = t.prompt.prompt;
    this.patch(paneId, { prompt: null, status: 'connecting' });
    api.sessionAnswer(t.session, prompt, ok, value).catch(() => {});
  }

  /** The shell said where it is (OSC 7). */
  setCwd(paneId: string, cwd: string) {
    const t = this.pane(paneId);
    if (t && t.cwd !== cwd) this.patch(paneId, { cwd });
  }

  input(paneId: string, data: string) {
    const t = this.pane(paneId);
    if (t && t.status === 'ready') this.inputs.push(t.session, data);
  }

  resize(paneId: string, cols: number, rows: number) {
    const prev = this.sizes.get(paneId);
    if (prev && prev.cols === cols && prev.rows === rows) return;
    this.sizes.set(paneId, { cols, rows });
    const t = this.pane(paneId);
    if (t && t.session && t.status !== 'ended') api.sessionResize(t.session, cols, rows).catch(() => {});
  }

  attach(paneId: string, writer: Writer) {
    this.writers.set(paneId, writer);
    for (const chunk of this.pending.get(paneId) ?? []) writer(chunk);
    this.pending.delete(paneId);
  }

  detach(paneId: string) {
    this.writers.delete(paneId);
  }
}

export const sessions = new SessionStore();

export function useSessions(): Snapshot {
  return useSyncExternalStore(sessions.subscribe, sessions.get);
}

export function statusLabel(t: Pane): { dot: string; meta: string; metaClass: string } {
  if (t.status === 'ready') return { dot: 'st-on', meta: '', metaClass: '' };
  if (t.status === 'prompt') {
    return { dot: 'st-wait', meta: t.prompt?.kind === 'host_key' ? 'verify host' : 'needs input', metaClass: 'accent-t' };
  }
  if (t.status === 'connecting') return { dot: 'st-wait', meta: 'connecting…', metaClass: 'faint' };
  if (t.end?.code === 'host_key' && t.changedKey) return { dot: 'st-fail', meta: 'host key changed', metaClass: 'danger-t' };
  if (t.end?.code) return { dot: 'st-fail', meta: t.end.code === 'auth' ? 'auth failed' : 'disconnected', metaClass: 'danger-t' };
  return { dot: 'st-off', meta: 'closed', metaClass: 'faint' };
}
