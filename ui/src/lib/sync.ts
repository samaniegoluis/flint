// The sync's state as the page shows it (milestone 44, design 23c): one word for the
// status bar, from what this machine remembers of its server (RemoteStatus) and what
// the last `vault:sync` said. Pure, so it is tested on its own (sync.test.ts).

import type { MergeChange, MergeReport, RemoteStatus } from '../api/types';
import { fmtNumber, t } from '../i18n';

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

/** The state's word for the status bar. */
export function syncLabel(state: SyncState): string {
  return t(`sync.state.${state}`);
}

/** The popover's sentence under the state. */
export function syncDetail(state: SyncState): string {
  return t(`sync.detail.${state}`);
}

/** "just now", "2 min ago", "3 h ago", "4 days ago", or "never". */
export function agoLabel(ms: number, now: number): string {
  if (ms <= 0) return t('sync.ago.never');
  const secs = Math.max(0, Math.floor((now - ms) / 1000));
  if (secs < 60) return t('sync.ago.just_now');
  if (secs < 3600) return t('sync.ago.min', { min: Math.floor(secs / 60) });
  if (secs < 172800) return t('sync.ago.hours', { h: Math.floor(secs / 3600) });
  return t('sync.ago.days', { days: Math.floor(secs / 86400) });
}

/** The kinds of things a merge reports, each with its catalog entries. */
const KINDS = new Set(['host', 'credential', 'key', 'tunnel', 'token', 'group', 'known_host']);

/** The details dialog's order of kinds (design 23e2). */
export const KIND_ORDER = ['host', 'group', 'credential', 'key', 'tunnel', 'token', 'known_host'];

/** "host" or "hosts" for `n` of them. */
export function kindLabel(kind: string, n: number): string {
  return KINDS.has(kind) ? t(`sync.kind.${kind}`, { count: n }) : kind;
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
  // One sentence per verb, with the kind when it is the first part and every change
  // was of one kind: "2 hosts added", else "1 updated".
  const say = (n: number, verb: 'added' | 'updated' | 'removed', first: boolean) => {
    if (n === 0) return;
    const p = { count: n, n: fmtNumber(n) };
    parts.push(first && KINDS.has(one) ? t(`sync.merge.${verb}.${one}`, p) : t(`sync.merge.${verb}`, p));
  };
  say(r.added, 'added', true);
  say(r.updated, 'updated', parts.length === 0);
  say(r.removed, 'removed', parts.length === 0);
  if (parts.length === 0) return t('sync.merge.notes', { count: r.notes.length, n: fmtNumber(r.notes.length) });
  return parts.join(t('sync.merge.separator'));
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
  // `detail` is the core's English text (its own message ids come with milestone 69).
  const what = kindLabel(n.kind, 1);
  const p = { name: n.name, what, detail: n.detail };
  if (n.change === 'renamed') return t('sync.note.renamed', { ...p, was: n.detail.replace(/^was /, '') });
  if (n.change === 'unlinked') return t('sync.note.unlinked', p);
  if (n.change === 'cut') return t('sync.note.cut', p);
  if (n.change === 'dropped') return t('sync.note.dropped', p);
  return n.detail ? t('sync.note.other_detail', { ...p, change: n.change }) : t('sync.note.other', { ...p, change: n.change });
}

/** "61 KB", "1.2 MB". */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return t('sync.size.b', { n: fmtNumber(bytes) });
  if (bytes < 1024 * 1024) return t('sync.size.kb', { n: fmtNumber(Math.round(bytes / 1024)) });
  return t('sync.size.mb', { n: fmtNumber(bytes / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}

/** The host of a server URL, for short labels. */
export function urlHost(url: string): string {
  return url.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
}

/** A file name for the local copy: the vault's label when it has one. */
export function copyName(v: { label: string } | undefined): string {
  const base = (v?.label ?? '').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '').trim();
  return (base || 'vault') + '.flint';
}
