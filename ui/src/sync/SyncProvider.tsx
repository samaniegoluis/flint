// The open vault's sync, as the page sees it (milestone 44, design 23c-23f): its
// server and state, read from the core (`vault_remote_status`) and kept current by
// every `vault:sync` the app's loop or a Sync now emits. The status bar, Settings and
// the palette read it here; the merge's details (23e2) and the new-password modal
// (23f) live here so any of them can open them.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, on, toFlintError } from '../api/backend';
import type { MergeReport, RemoteStatus, SyncEvent } from '../api/types';
import { useApp } from '../state/app';
import { hasChanges, mergeSummary, NO_LIVE, syncState, type SyncLive, type SyncState } from '../lib/sync';
import { ACTION_DURATION_MS } from '../lib/toasts';
import { MergeDetails } from './MergeDetails';
import { NewPasswordModal } from './NewPasswordModal';
import { t } from '../i18n';

/** A sync that ends sooner than this never shows "Syncing…" (a quiet 304 every minute). */
const SYNCING_SHOWS_AFTER_MS = 400;

interface SyncApi {
  /** The open vault's server, or null when it is not connected. */
  status: RemoteStatus | null;
  state: SyncState | null;
  /** The last merge that brought changes in this run, for Show last merge. */
  lastMerge: MergeReport | null;
  /** The core's message for the last failure, for the popover. */
  lastError: string;
  now: number;
  refresh: () => Promise<void>;
  /** Sync now; resolves when it ends (a failure shows in the state, never thrown). */
  syncNow: () => Promise<void>;
  showDetails: () => void;
  askPassword: () => void;
  openServerSettings: () => void;
}

const Ctx = createContext<SyncApi | null>(null);

export function useSync(): SyncApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync outside SyncProvider');
  return v;
}

/** Outside the shell (the palette's tests, a screen with no vault): no sync. */
export function useSyncMaybe(): SyncApi | null {
  return useContext(Ctx);
}

export function SyncProvider({ children, onOpenServerSettings }: { children: ReactNode; onOpenServerSettings: () => void }) {
  const { vault, notify } = useApp();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [live, setLive] = useState<SyncLive>(NO_LIVE);
  const [lastError, setLastError] = useState('');
  const [lastMerge, setLastMerge] = useState<MergeReport | null>(null);
  const [details, setDetails] = useState<MergeReport | null>(null);
  const [asking, setAsking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const syncingTimer = useRef(0);
  // 23f opens on its own once per vault; after Later only the status bar asks.
  const askedFor = useRef('');
  const path = vault?.path ?? '';

  const refresh = useCallback(async () => {
    if (!path) { setStatus(null); return; }
    try {
      const s = await api.remoteStatus(path);
      setStatus(s.connected ? s : null);
    } catch {
      setStatus(null);
    }
  }, [path]);

  useEffect(() => {
    setLive(NO_LIVE);
    setLastError('');
    setLastMerge(null);
    refresh().catch(() => {});
  }, [refresh]);

  // "2 min ago" moves on, and Merged fades back to In step.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  // A change made here (the app or the CLI) leaves the vault waiting for its upload.
  useEffect(() => on<{ path: string }>('vault:changed', (e) => {
    if (e.path === path) refresh().catch(() => {});
  }), [path, refresh]);

  useEffect(() => on<SyncEvent>('vault:sync', (e) => {
    if (e.path !== path) return;
    if (e.state === 'syncing') {
      window.clearTimeout(syncingTimer.current);
      syncingTimer.current = window.setTimeout(() => setLive((l) => ({ ...l, syncing: true })), SYNCING_SHOWS_AFTER_MS);
      return;
    }
    window.clearTimeout(syncingTimer.current);
    setNow(Date.now());
    if (e.state === 'error') {
      setLive((l) => ({ ...l, syncing: false, errorCode: e.code || 'internal' }));
      setLastError(e.message);
    } else {
      const merged = e.state === 'merged' && hasChanges(e.report);
      setLive((l) => ({ syncing: false, errorCode: '', mergedAt: merged ? Date.now() : l.mergedAt }));
      setLastError('');
      if (merged) {
        setLastMerge(e.report);
        notify({ text: t('sync_provider.changes_from_another_machine_mergesummary', { mergeSummary: mergeSummary(e.report) }), kind: 'info', key: 'sync-merge', duration: ACTION_DURATION_MS, actions: [{ label: t('sync_provider.details'), run: () => setDetails(e.report) }] });
      }
    }
    refresh().catch(() => {});
  }), [path, refresh, notify]);

  const state = status ? syncState(status, live, now) : null;

  useEffect(() => {
    if (state === 'password' && askedFor.current !== path) {
      askedFor.current = path;
      setAsking(true);
    }
  }, [state, path]);

  const syncNow = useCallback(async () => {
    try {
      await api.syncNow();
    } catch (err) {
      // The event already set the state; a refusal before the sync started (locked)
      // has no event, so it is said here.
      const e = toFlintError(err);
      if (e.code === 'locked') notify(e.message, 'error');
    }
  }, [notify]);

  const value = useMemo<SyncApi>(() => ({
    status, state, lastMerge, lastError, now, refresh, syncNow,
    showDetails: () => { if (lastMerge) setDetails(lastMerge); },
    askPassword: () => setAsking(true),
    openServerSettings: onOpenServerSettings,
  }), [status, state, lastMerge, lastError, now, refresh, syncNow, onOpenServerSettings]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {details && <MergeDetails report={details} onClose={() => setDetails(null)} />}
      {asking && vault && <NewPasswordModal vaultName={vault.name} onClose={() => setAsking(false)} />}
    </Ctx.Provider>
  );
}
