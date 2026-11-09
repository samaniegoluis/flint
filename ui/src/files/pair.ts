// The Files view's second pane (milestone 19, design 14d, D-059): for a tab, the
// other server its files can be copied to. The pane browses that host's session:
// its open tab's when it has a connected one, otherwise a session with no
// terminal that Flint opens for the pane (`files_only`, D-056) and hangs up when
// the pane closes.
//
// Two-pane mode lives here, not in the view: hiding the pane (Esc, a click in the
// terminal, its collapse button, or closing the Files view) keeps the mode, its
// session and every transfer. Only One pane, closing the tab or locking the vault
// ends it.

import { useSyncExternalStore } from 'react';
import { api, on } from '../api/backend';
import type { HostKeyPayload, SessionPromptEvent, SessionStateEvent } from '../api/types';
import type { SessionEnd, Pane, PaneStatus } from '../sessions/store';
import { files } from './store';

export interface Pair {
  /** The tab whose Files view this pane belongs to (pane 1). */
  tabId: string;
  alias: string;
  /** The session the pane browses. */
  session: string;
  /** A session with no terminal that Flint opened for the pane; else `otherTab`'s. */
  own: boolean;
  otherTab: string;
  status: PaneStatus;
  prompt: SessionPromptEvent | null;
  changedKey: HostKeyPayload | null;
  end: SessionEnd | null;
  hidden: boolean;
}

/** The second pane's folder key in the Files store: its tab's id, then `~2`. */
export const paneKey = (tabId: string) => tabId + '~2';
/** The tab a folder key belongs to. */
export const keyTab = (key: string) => key.split('~')[0];

let seq = 0;
const mint = () => `f-${Date.now().toString(36)}-${++seq}`;

/**
 * The pane as it is now. A pane over another tab's session follows that tab: a tab
 * that reconnected lends its new session, one that closed or dropped ends the pane.
 */
export function livePair(p: Pair, tabs: Pane[]): Pair {
  if (p.own) return p;
  const t = tabs.find((x) => x.id === p.otherTab);
  if (!t) return { ...p, status: 'ended', end: { code: 'network', message: `The tab for ${p.alias} was closed.`, exit_code: -1 } };
  if (t.status !== 'ready') return { ...p, status: 'ended', end: { code: 'network', message: `The tab for ${p.alias} is not connected.`, exit_code: -1 } };
  return { ...p, session: t.session, status: 'ready', end: null };
}

class PairStore {
  private pairs: Record<string, Pair> = {};
  private listeners = new Set<() => void>();
  private started = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = () => this.pairs;

  private set(next: Record<string, Pair>) {
    this.pairs = next;
    for (const fn of this.listeners) fn();
  }

  private patch(tabId: string, p: Partial<Pair>) {
    const cur = this.pairs[tabId];
    if (cur) this.set({ ...this.pairs, [tabId]: { ...cur, ...p } });
  }

  private bySession(session: string): Pair | undefined {
    return Object.values(this.pairs).find((p) => p.own && p.session === session);
  }

  start() {
    if (this.started) return;
    this.started = true;
    on<SessionStateEvent>('session:state', (ev) => {
      const p = this.bySession(ev.session);
      if (!p) return;
      if (ev.state === 'connecting') this.patch(p.tabId, { status: 'connecting', end: null, prompt: null });
      else if (ev.state === 'ready') this.patch(p.tabId, { status: 'ready', prompt: null });
      else this.patch(p.tabId, { status: 'ended', prompt: null, end: { code: ev.code, message: ev.message, exit_code: ev.exit_code } });
    });
    on<SessionPromptEvent>('session:prompt', (ev) => {
      const p = this.bySession(ev.session);
      if (!p) return;
      if (ev.kind === 'host_key_changed') this.patch(p.tabId, { changedKey: ev.host_key });
      else this.patch(p.tabId, { status: 'prompt', prompt: ev });
    });
  }

  /**
   * Opens the second pane of `tabId` on `alias`: over that host's connected tab when
   * it has one, otherwise on a session of its own with no terminal.
   */
  open(tabId: string, alias: string, tabs: Pane[]) {
    this.start();
    this.close(tabId);
    const other = tabs.find((t) => t.alias === alias && t.status === 'ready' && t.id !== tabId);
    if (other) {
      this.set({ ...this.pairs, [tabId]: { tabId, alias, session: other.session, own: false, otherTab: other.id, status: 'ready', prompt: null, changedKey: null, end: null, hidden: false } });
      return;
    }
    this.set({ ...this.pairs, [tabId]: { tabId, alias, session: '', own: true, otherTab: '', status: 'connecting', prompt: null, changedKey: null, end: null, hidden: false } });
    this.connect(tabId);
  }

  private connect(tabId: string) {
    const p = this.pairs[tabId];
    if (!p) return;
    const session = mint();
    this.patch(tabId, { session, own: true, otherTab: '', status: 'connecting', prompt: null, changedKey: null, end: null });
    api.sessionOpen(session, p.alias, 80, 24, false, true).catch((err) => {
      const e = err as { code?: string; message?: string };
      const cur = this.pairs[tabId];
      if (cur?.session === session) this.patch(tabId, { status: 'ended', end: { code: e.code ?? 'internal', message: e.message ?? String(err), exit_code: -1 } });
    });
  }

  /** Logs in again, on a session of the pane's own. */
  retry(tabId: string) {
    const p = this.pairs[tabId];
    if (!p) return;
    if (p.own && p.session && p.status !== 'ended') api.sessionClose(p.session).catch(() => {});
    this.connect(tabId);
  }

  answer(tabId: string, ok: boolean, value: string) {
    const p = this.pairs[tabId];
    if (!p?.prompt) return;
    const prompt = p.prompt.prompt;
    this.patch(tabId, { prompt: null, status: 'connecting' });
    api.sessionAnswer(p.session, prompt, ok, value).catch(() => {});
  }

  setHidden(tabId: string, hidden: boolean) {
    const p = this.pairs[tabId];
    if (p && p.hidden !== hidden) this.patch(tabId, { hidden });
  }

  /** One pane: the mode ends, and the pane's own session is hung up. */
  close(tabId: string) {
    const p = this.pairs[tabId];
    if (!p) return;
    if (p.own && p.session && p.status !== 'ended') api.sessionClose(p.session).catch(() => {});
    // The next pane, on whatever host, starts at that host's login folder.
    files.forget(paneKey(tabId));
    const { [tabId]: _, ...rest } = this.pairs;
    this.set(rest);
  }

  /** Tabs that closed take their second pane with them. */
  keepOnly(open: Set<string>) {
    for (const id of Object.keys(this.pairs)) if (!open.has(id)) this.close(id);
  }

  /** The vault locked or closed: the core already ended every session. */
  closeAll() {
    for (const id of Object.keys(this.pairs)) files.forget(paneKey(id));
    this.set({});
  }
}

export const pairs = new PairStore();

export function usePairs(): Record<string, Pair> {
  return useSyncExternalStore(pairs.subscribe, pairs.get);
}
