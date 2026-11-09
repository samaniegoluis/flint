// The Files view's state (milestone 17): for each tab, the folder it shows; for the
// whole window, the transfer queue. Everything rides the tab's own session (D-053),
// so a folder is reloaded when its tab reconnects, and a transfer belongs to the
// session it started on.
//
// A copy between two servers (milestone 19, D-059) is a `relay` transfer: it reads
// `remote` on its session and writes `local` on `toSession`, and belongs to the
// first pane's tab, whose queue shows it. A folder key is a tab's id, or `<tab>~2`
// for that tab's second pane (pair.ts).
//
// Transfers run one at a time per session, in the order they were queued. A drop
// from the OS is first staged on this machine (the webview hands the page bytes,
// not paths: CF-004), then uploaded like any other file.

import { useSyncExternalStore } from 'react';
import { api, on, toFlintError, type FlintError } from '../api/backend';
import type { FileEntry, TransferEvent } from '../api/types';
import { baseName, joinPath, parentPath, sortEntries } from './paths';

export interface FolderState {
  /** The session this listing came from: a reconnect lists again. */
  session: string;
  path: string;
  entries: FileEntry[];
  loading: boolean;
  error: FlintError | null;
  selected: string | null;
  scroll: number;
}

export type TransferState = 'staging' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'conflict';

export interface Transfer {
  id: string;
  tabId: string;
  session: string;
  alias: string;
  direction: 'upload' | 'download' | 'relay';
  /** A relay's destination session and host. */
  toSession: string;
  toAlias: string;
  /** The folder key whose listing `folder` is (default: the tab's own). */
  view: string;
  /** What the row shows: the file or folder's name. */
  name: string;
  local: string;
  remote: string;
  recursive: boolean;
  force: boolean;
  state: TransferState;
  /** Bytes copied (or staged) so far, and the total when known (0: unknown). */
  bytes: number;
  total: number;
  /** The file being copied now, for a folder. */
  file: string;
  filesDone: number;
  startedAt: number;
  /** Bytes per second over the last second or so. */
  rate: number;
  error: FlintError | null;
  /** The remote folder to list again when it ends. */
  folder: string;
  /** The staged drop it uploads from, discarded once it ends. */
  drop: string;
}

interface Snapshot {
  folders: Record<string, FolderState>;
  transfers: Transfer[];
}

/** Bytes per staged chunk: one RPC each, base64 on the way. */
const STAGE_CHUNK = 1 << 20;

let seq = 0;
const mint = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;

/** The next transfer to start on `session`, or none while one runs there. */
export function nextToStart(transfers: Transfer[], session: string): Transfer | undefined {
  if (transfers.some((t) => t.session === session && t.state === 'running')) return undefined;
  return transfers.find((t) => t.session === session && t.state === 'queued');
}

/** Clear done: finished and cancelled rows go; failed ones stay until dismissed or retried. */
export function clearDone(transfers: Transfer[], tabId: string): Transfer[] {
  return transfers.filter((t) => t.tabId !== tabId || !(t.state === 'done' || t.state === 'cancelled'));
}

/** What a progress event changes in a transfer, with its rate smoothed. */
export function applyProgress(t: Transfer, ev: TransferEvent, now: number, lastAt: number): Transfer {
  // The first report only marks the start: one chunk over a few milliseconds says
  // nothing about the link. The rate comes from the second on, smoothed.
  const dt = Math.max(1, now - lastAt) / 1000;
  const instant = Math.max(0, ev.bytes_done - t.bytes) / dt;
  const first = t.bytes === 0 && t.rate === 0 && t.file === '';
  const rate = first ? 0 : t.rate === 0 ? instant : t.rate * 0.7 + instant * 0.3;
  // A single file's size comes with its first event; a folder's total stays unknown.
  const total = t.total > 0 ? t.total : t.recursive ? 0 : ev.file_size;
  return { ...t, bytes: ev.bytes_done, file: ev.file, filesDone: ev.files_done, rate, total };
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

/** A file dropped from the OS, with its path inside the drop ("site/css/app.css"). */
export interface DroppedFile {
  rel: string;
  file: File;
}

class FilesStore {
  private snap: Snapshot = { folders: {}, transfers: [] };
  private listeners = new Set<() => void>();
  private started = false;
  private lastEvent = new Map<string, number>();
  /** Called when a transfer fails or a request is refused, for a toast. */
  onError: (msg: string) => void = () => {};

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = () => this.snap;

  private set(next: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...next };
    for (const fn of this.listeners) fn();
  }

  private patchFolder(tabId: string, p: Partial<FolderState>) {
    const f = this.snap.folders[tabId];
    if (!f) return;
    this.set({ folders: { ...this.snap.folders, [tabId]: { ...f, ...p } } });
  }

  private patchTransfer(id: string, p: Partial<Transfer> | ((t: Transfer) => Partial<Transfer>)) {
    this.set({ transfers: this.snap.transfers.map((t) => (t.id === id ? { ...t, ...(typeof p === 'function' ? p(t) : p) } : t)) });
  }

  transfer(id: string): Transfer | undefined {
    return this.snap.transfers.find((t) => t.id === id);
  }

  start() {
    if (this.started) return;
    this.started = true;
    on<TransferEvent>('files:transfer', (ev) => {
      const t = this.transfer(ev.id);
      if (!t || t.state !== 'running') return;
      const now = Date.now();
      const last = this.lastEvent.get(ev.id) ?? t.startedAt;
      this.lastEvent.set(ev.id, now);
      this.patchTransfer(ev.id, (cur) => applyProgress(cur, ev, now, last));
    });
  }

  // ---- Browsing ----------------------------------------------------------------

  /**
   * Lists the tab's folder when it is not listed yet, or was listed on another
   * session. `start` is where a first listing opens (the terminal's folder, OSC 7).
   */
  ensure(tabId: string, session: string, start = '') {
    const f = this.snap.folders[tabId];
    if (f && f.session === session && (f.entries.length > 0 || f.loading || f.error)) return;
    this.load(tabId, session, start || f?.path || '');
  }

  /** The folder a key shows, or undefined. */
  folder(key: string): FolderState | undefined {
    return this.snap.folders[key];
  }

  private async load(tabId: string, session: string, path: string, keepSelection = false) {
    const prev = this.snap.folders[tabId];
    this.set({ folders: { ...this.snap.folders, [tabId]: {
      session, path: path || prev?.path || '', entries: prev?.session === session && prev.path === path ? prev.entries : [],
      loading: true, error: null, selected: keepSelection ? prev?.selected ?? null : null, scroll: prev?.path === path ? prev.scroll : 0,
    } } });
    try {
      let target = path;
      if (!target) target = (await api.filesHome(session)).path;
      let res;
      try {
        res = await api.filesList(session, target);
      } catch (err) {
        // The folder went away (or this session cannot see it): back to the login folder.
        const e = toFlintError(err);
        if (path && (e.code === 'not_found' || e.code === 'not_a_directory' || e.code === 'permission_denied')) {
          this.onError(e.message);
          target = (await api.filesHome(session)).path;
          res = await api.filesList(session, target);
        } else throw e;
      }
      const cur = this.snap.folders[tabId];
      if (!cur || cur.session !== session) return;
      this.patchFolder(tabId, { path: res.path, entries: sortEntries(res.entries), loading: false, error: null });
    } catch (err) {
      const cur = this.snap.folders[tabId];
      if (!cur || cur.session !== session) return;
      this.patchFolder(tabId, { loading: false, error: toFlintError(err) });
    }
  }

  go(tabId: string, path: string) {
    const f = this.snap.folders[tabId];
    if (f) this.load(tabId, f.session, path);
  }

  up(tabId: string) {
    const f = this.snap.folders[tabId];
    if (f && f.path && f.path !== '/') {
      const from = f.path;
      this.load(tabId, f.session, parentPath(f.path)).then(() => this.patchFolder(tabId, { selected: joinPath(parentPath(from), baseName(from)) }));
    }
  }

  refresh(tabId: string) {
    const f = this.snap.folders[tabId];
    if (f) this.load(tabId, f.session, f.path, true);
  }

  select(tabId: string, path: string | null) {
    this.patchFolder(tabId, { selected: path });
  }

  setScroll(tabId: string, scroll: number) {
    const f = this.snap.folders[tabId];
    if (f) f.scroll = scroll; // no re-render: only read when the list mounts
  }

  /** The tab closed: its folder goes; its finished transfers too. */
  forget(tabId: string) {
    const { [tabId]: _, ...rest } = this.snap.folders;
    this.set({ folders: rest, transfers: this.snap.transfers.filter((t) => t.tabId !== tabId || t.state === 'running') });
  }

  async mkdir(tabId: string, name: string) {
    const f = this.snap.folders[tabId];
    if (!f) return;
    const path = joinPath(f.path, name);
    await api.filesMkdir(f.session, path);
    await this.load(tabId, f.session, f.path);
    this.patchFolder(tabId, { selected: path });
  }

  async rename(tabId: string, entry: FileEntry, name: string) {
    const f = this.snap.folders[tabId];
    if (!f) return;
    const to = joinPath(parentPath(entry.path), name);
    await api.filesRename(f.session, entry.path, to);
    await this.load(tabId, f.session, f.path);
    this.patchFolder(tabId, { selected: to });
  }

  async remove(tabId: string, entry: FileEntry) {
    const f = this.snap.folders[tabId];
    if (!f) return;
    await api.filesRemove(f.session, entry.path);
    await this.load(tabId, f.session, f.path);
  }

  // ---- Transfers -----------------------------------------------------------------

  private queue(t: Omit<Transfer, 'id' | 'state' | 'bytes' | 'file' | 'filesDone' | 'startedAt' | 'rate' | 'error' | 'toSession' | 'toAlias' | 'view'> & { state?: TransferState; toSession?: string; toAlias?: string; view?: string }): string {
    const id = mint('x');
    const full: Transfer = { id, state: 'queued', bytes: 0, file: '', filesDone: 0, startedAt: 0, rate: 0, error: null, toSession: '', toAlias: '', view: t.tabId, ...t };
    this.set({ transfers: [...this.snap.transfers, full] });
    if (full.state === 'queued') this.pump(full.session);
    return id;
  }

  /** Downloads `entry` to `local`, a path the save dialog chose (it already asked to replace). */
  download(tabId: string, session: string, alias: string, entry: FileEntry, local: string) {
    this.queue({
      tabId, session, alias, direction: 'download', name: entry.name, local, remote: entry.path,
      recursive: entry.kind === 'dir', force: true, total: entry.kind === 'dir' ? 0 : entry.size, folder: '', drop: '',
    });
  }

  /** Uploads files on this machine (from the open dialog) into `folder` on the host. */
  upload(tabId: string, session: string, alias: string, locals: string[], folder: string) {
    for (const local of locals) {
      this.queue({
        tabId, session, alias, direction: 'upload', name: baseName(local), local, remote: folder + (folder.endsWith('/') ? '' : '/'),
        recursive: false, force: false, total: 0, folder, drop: '',
      });
    }
  }

  /**
   * Copies `entry` from one pane's host to the other's, into `folder` there
   * (milestone 19): the bytes go host → Flint → host. The row is `tabId`'s, the
   * first pane's; `view` is the destination pane's folder key, listed again after.
   */
  relay(tabId: string, from: { session: string; alias: string }, entry: FileEntry, to: { key: string; session: string; alias: string; folder: string }) {
    this.queue({
      tabId, session: from.session, alias: from.alias, direction: 'relay', name: entry.name,
      local: to.folder + (to.folder.endsWith('/') ? '' : '/'), remote: entry.path,
      recursive: entry.kind === 'dir', force: false, total: entry.kind === 'dir' ? 0 : entry.size,
      folder: to.folder, drop: '', toSession: to.session, toAlias: to.alias, view: to.key,
    });
  }

  /** Files dragged in from the OS: each top-level file or folder is staged, then uploaded. */
  async uploadDropped(tabId: string, session: string, alias: string, files: DroppedFile[], folder: string) {
    const groups = new Map<string, DroppedFile[]>();
    for (const f of files) {
      const top = f.rel.split('/')[0];
      groups.set(top, [...(groups.get(top) ?? []), f]);
    }
    const jobs = [...groups.entries()].map(([top, list]) => {
      const drop = mint('d');
      const total = list.reduce((n, f) => n + f.file.size, 0);
      const id = this.queue({
        tabId, session, alias, direction: 'upload', name: top, local: '', remote: folder + (folder.endsWith('/') ? '' : '/'),
        recursive: list.length > 1 || list[0].rel.includes('/'), force: false, total, folder, drop, state: 'staging',
      });
      return { id, drop, list };
    });
    for (const { id, drop, list } of jobs) {
      let local = '';
      try {
        for (const f of list) {
          if (this.transfer(id)?.state !== 'staging') throw new Error('cancelled');
          // An empty file still needs to exist.
          if (f.file.size === 0) local = (await api.filesStage(drop, f.rel, '')).path;
          for (let off = 0; off < f.file.size; off += STAGE_CHUNK) {
            if (this.transfer(id)?.state !== 'staging') throw new Error('cancelled');
            const buf = new Uint8Array(await f.file.slice(off, off + STAGE_CHUNK).arrayBuffer());
            local = (await api.filesStage(drop, f.rel, bytesToB64(buf))).path;
            this.patchTransfer(id, { file: f.rel });
          }
        }
        this.patchTransfer(id, { state: 'queued', local, file: '' });
        this.pump(session);
      } catch (err) {
        api.filesStageDiscard(drop).catch(() => {});
        if (this.transfer(id)?.state === 'staging') {
          const e = toFlintError(err);
          this.patchTransfer(id, { state: 'failed', error: e });
          this.onError(`${list[0].rel.split('/')[0]}: ${e.message}`);
        }
      }
    }
  }

  /** Set while queued transfers wait for the window to be opened again. */
  private waiting = false;

  /** The window opened again: transfers that waited for it start. */
  resume() {
    if (!this.waiting) return;
    this.waiting = false;
    for (const s of new Set(this.snap.transfers.filter((t) => t.state === 'queued').map((t) => t.session))) this.pump(s);
  }

  private pump(session: string) {
    if (this.waiting) return;
    const next = nextToStart(this.snap.transfers, session);
    if (next) this.run(next.id);
  }

  private async run(id: string) {
    const t = this.transfer(id);
    if (!t) return;
    const startedAt = Date.now();
    this.lastEvent.set(id, startedAt);
    this.patchTransfer(id, { state: 'running', startedAt, bytes: 0, rate: 0, error: null });
    try {
      const res = t.direction === 'relay'
        ? await api.filesRelay({ session: t.session, to_session: t.toSession, id, alias: t.alias, to_alias: t.toAlias, path: t.remote, to_path: t.local, recursive: t.recursive, force: t.force })
        : await api.filesTransfer({ session: t.session, id, direction: t.direction, local: t.local, remote: t.remote, recursive: t.recursive, force: t.force });
      this.patchTransfer(id, { state: 'done', bytes: res.bytes, total: res.bytes, filesDone: res.files.length, rate: 0 });
      if (t.drop) api.filesStageDiscard(t.drop).catch(() => {});
      this.refreshIfShowing(t.view, t.folder);
    } catch (err) {
      const e = toFlintError(err);
      const cur = this.transfer(id);
      if (cur?.state === 'cancelled') {
        if (t.drop) api.filesStageDiscard(t.drop).catch(() => {});
      } else if (e.code === 'locked') {
        // The window locked before it started: it waits for the window to open (resume).
        this.patchTransfer(id, { state: 'queued', error: null, rate: 0 });
        this.waiting = true;
        return;
      } else if (e.code === 'exists' && !t.force) {
        // Existing files ask before they're replaced (design 14b): the row asks.
        this.patchTransfer(id, { state: 'conflict', error: e, rate: 0 });
      } else {
        this.patchTransfer(id, { state: 'failed', error: e, rate: 0 });
        this.onError(`${t.name}: ${e.message}`);
      }
      this.refreshIfShowing(t.view, t.folder);
    } finally {
      this.lastEvent.delete(id);
      if (!this.waiting) this.pump(t.session);
    }
  }

  private refreshIfShowing(key: string, folder: string) {
    const f = this.snap.folders[key];
    if (folder && f && f.path === folder) this.load(key, f.session, f.path, true);
  }

  cancel(id: string) {
    const t = this.transfer(id);
    if (!t) return;
    if (t.state === 'running') {
      this.patchTransfer(id, { state: 'cancelled', rate: 0 });
      api.filesCancel(id).catch(() => {});
    } else if (t.state === 'queued' || t.state === 'staging' || t.state === 'conflict') {
      this.patchTransfer(id, { state: 'cancelled' });
      if (t.drop && t.state !== 'staging') api.filesStageDiscard(t.drop).catch(() => {});
    }
  }

  /** A failed transfer goes back in the queue. */
  retry(id: string, force = false) {
    const t = this.transfer(id);
    if (!t || (t.state !== 'failed' && t.state !== 'conflict')) return;
    if (!t.local) { this.onError(`${t.name}: drop it again to retry`); return; }
    this.patchTransfer(id, { state: 'queued', error: null, force: force || t.force, bytes: 0 });
    this.pump(t.session);
  }

  /** Answers every conflict in `tabId`'s queue at once (14d4: "Do this for the other N conflicts"). */
  resolveAll(tabId: string, replace: boolean) {
    for (const t of this.snap.transfers.filter((x) => x.tabId === tabId && x.state === 'conflict')) {
      if (replace) this.retry(t.id, true);
      else this.cancel(t.id);
    }
  }

  dismiss(id: string) {
    const t = this.transfer(id);
    if (t?.drop && t.state !== 'running') api.filesStageDiscard(t.drop).catch(() => {});
    this.set({ transfers: this.snap.transfers.filter((x) => x.id !== id) });
  }

  clearDone(tabId: string) {
    this.set({ transfers: clearDone(this.snap.transfers, tabId) });
  }
}

export const files = new FilesStore();

export function useFiles(): Snapshot {
  return useSyncExternalStore(files.subscribe, files.get);
}
