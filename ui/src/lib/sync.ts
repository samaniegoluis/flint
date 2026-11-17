// The sync's state as the page shows it (milestone 44, design 23c): one word for the
// status bar, from what this machine remembers of its server (RemoteStatus) and what
// the last `vault:sync` said. Pure, so it is tested on its own (sync.test.ts).

import type { MergeChange, MergeReport, RemoteStatus } from '../api/types';

export type SyncState = 'syncing' | 'merged' | 'password' | 'attention' | 'offline' | 'waiting' | 'in_step';

/** How long "Merged" stays in the status bar after a merge brought changes. */
export const MERGED_FOR_MS = 60_000;

/** What the page heard last, beyond the status the core keeps. */
export interface SyncLive {
  syncing: boolean;
  /** The last failed sync's code ('' after a sync that worked). */
  errorCode: string;
  /** When a merge that brought changes ended (0 for none). */
  mergedAt: number;
}

export const NO_LIVE: SyncLive = { syncing: false, errorCode: '', mergedAt: 0 };

/** The code at the head of a core error's "code: message" text. */
export function errorCodeOf(text: string): string {
  const m = /^([a-z_]+): /.exec(text);
  return m ? m[1] : text ? 'internal' : '';
}

/** What a failed sync means to the person: a password to type, something to look
 *  at, or a server out of reach (calm: offline is normal). */
export function failureState(code: string): SyncState | null {
  if (!code) return null;
  if (code === 'wrong_password') return 'password';
  if (code === 'network' || code === 'timeout' || code === 'refused') return 'offline';
  return 'attention';
}

export function syncState(st: RemoteStatus, live: SyncLive, now: number): SyncState {
  if (live.syncing) return 'syncing';
  const failed = failureState(live.errorCode || (st.last_attempt > st.last_sync ? errorCodeOf(st.last_error) : ''));
  if (failed) return failed;
  if (live.mergedAt > 0 && now - live.mergedAt < MERGED_FOR_MS) return 'merged';
  if (st.pending) return 'waiting';
  return 'in_step';
}

export const SYNC_LABEL: Record<SyncState, string> = {
  syncing: 'Syncing…',
  merged: 'Merged',
  password: 'Needs the new password',
  attention: 'Needs attention',
  offline: 'Offline',
  waiting: 'Waiting',
  in_step: 'In step',
};

/** The popover's sentence under the state. */
export const SYNC_DETAIL: Record<SyncState, string> = {
  syncing: 'Talking to the server.',
  merged: 'Changes from another machine came in and were merged.',
  password: 'The master password was changed on another machine. Type the new one to keep syncing.',
  attention: 'The server refused this machine. Check the token or the server in Settings.',
  offline: 'The server cannot be reached. Changes wait here and sync when it is back.',
  waiting: 'Changes on this machine wait to be uploaded.',
  in_step: 'This machine and the server hold the same version.',
};

/** "just now", "2 min ago", "3 h ago", "4 days ago", or "never". */
export function agoLabel(ms: number, now: number): string {
  if (ms <= 0) return 'never';
  const secs = Math.max(0, Math.floor((now - ms) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 172800) return `${Math.floor(secs / 3600)} h ago`;
  return `${Math.floor(secs / 86400)} days ago`;
}

const KIND_PLURAL: Record<string, [string, string]> = {
  host: ['host', 'hosts'],
  credential: ['credential', 'credentials'],
  key: ['SSH key', 'SSH keys'],
  tunnel: ['tunnel', 'tunnels'],
  token: ['token', 'tokens'],
  group: ['group', 'groups'],
  known_host: ['known host', 'known hosts'],
};

/** The details dialog's order of kinds (design 23e2). */
export const KIND_ORDER = ['host', 'group', 'credential', 'key', 'tunnel', 'token', 'known_host'];

export function kindLabel(kind: string, n: number): string {
  const p = KIND_PLURAL[kind] ?? [kind, kind + 's'];
  return n === 1 ? p[0] : p[1];
}

export function hasChanges(r: MergeReport): boolean {
  return r.added + r.updated + r.removed > 0 || r.notes.length > 0;
}

/** The toast's line: "2 hosts added, 1 updated". Counts per kind for the commonest
 *  kind of change, the rest as totals. */
export function mergeSummary(r: MergeReport): string {
  const parts: string[] = [];
  const kinds = new Set(r.changes.map((c) => c.kind));
  const one = kinds.size === 1 ? [...kinds][0] : '';
  const say = (n: number, verb: string, first: boolean) => {
    if (n === 0) return;
    parts.push(first && one ? `${n} ${kindLabel(one, n)} ${verb}` : `${n} ${verb}`);
  };
  say(r.added, 'added', true);
  say(r.updated, 'updated', parts.length === 0);
  say(r.removed, 'removed', parts.length === 0);
  if (parts.length === 0) return r.notes.length === 1 ? '1 note from the merge' : `${r.notes.length} notes from the merge`;
  return parts.join(', ');
}

/** The details dialog's groups: one per kind, in KIND_ORDER. */
export function groupChanges(changes: MergeChange[]): { kind: string; items: MergeChange[] }[] {
  const by = new Map<string, MergeChange[]>();
  for (const c of changes) by.set(c.kind, [...(by.get(c.kind) ?? []), c]);
  const rank = (k: string) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
  const kinds = [...by.keys()].sort((a, b) => rank(a) - rank(b));
  return kinds.map((kind) => ({ kind, items: by.get(kind)! }));
}

/** A merge note in plain words (design 23e2): "web-01 existed on both machines: this
 *  one is now web-01-2". */
export function noteText(n: MergeChange): string {
  const what = kindLabel(n.kind, 1);
  if (n.change === 'renamed') {
    const was = n.detail.replace(/^was /, '');
    return `${was} existed on both machines: this ${what} is now ${n.name}`;
  }
  if (n.change === 'unlinked') return `${n.name} (${what}): ${n.detail}, so it was unlinked`;
  if (n.change === 'cut') return `${n.name} (${what}): ${n.detail}`;
  if (n.change === 'dropped') return `${n.name} (${what}) was removed too: ${n.detail}`;
  return `${n.name} (${what}): ${n.change}${n.detail ? ', ' + n.detail : ''}`;
}

/** "61 KB", "1.2 MB". */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The host of a server URL, for short labels. */
export function urlHost(url: string): string {
  return url.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
}
