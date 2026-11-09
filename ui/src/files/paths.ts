// Pure helpers for the Files view (milestone 17): OSC 7, remote paths, and how sizes
// and times read in the list.

import type { FileEntry } from '../api/types';

/**
 * The folder an OSC 7 report names: `file://host/path`, percent-encoded. Hosts are
 * not checked against the session's (a shell may report its own hostname, or none).
 * Returns null for anything that is not a file URL with an absolute path.
 */
export function parseOsc7(payload: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(payload.trim());
  if (!m) return null;
  try {
    const path = decodeURIComponent(m[1]);
    return path.includes('\0') ? null : path;
  } catch {
    return null;
  }
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : dir + '/' + name;
}

/** The folder above `path` ("/" stays "/"). */
export function parentPath(path: string): string {
  const p = path.replace(/\/+$/, '') || '/';
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export function baseName(path: string): string {
  const p = path.replace(/\/+$/, '');
  return p.slice(p.lastIndexOf('/') + 1) || '/';
}

/** The breadcrumb of an absolute path: "/", then each folder with its own path. */
export function crumbs(path: string): { name: string; path: string }[] {
  const out = [{ name: '/', path: '/' }];
  let acc = '';
  for (const part of path.split('/').filter(Boolean)) {
    acc += '/' + part;
    out.push({ name: part, path: acc });
  }
  return out;
}

/** A name a file can have: not empty, no slash, not "." or "..". */
export function validName(name: string): boolean {
  return name.length > 0 && !name.includes('/') && name !== '.' && name !== '..' && !name.includes('\0');
}

/** Folders first, then files, each by name as people sort them. */
export function sortEntries(entries: FileEntry[]): FileEntry[] {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...entries].sort((a, b) => {
    const da = a.kind === 'dir' ? 0 : 1;
    const db = b.kind === 'dir' ? 0 : 1;
    return da - db || coll.compare(a.name, b.name);
  });
}

/** "412 B", "2.1 KB", "48.2 MB" (powers of 1024, as the CLI prints them). */
export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * When a file changed, as the design shows it: "21:40" today, "2 h ago" in the
 * last hours, "12 Oct" this year, "12 Oct 2024" before.
 */
export function humanTime(mtimeSecs: number, nowMs = Date.now()): string {
  const t = new Date(mtimeSecs * 1000);
  const now = new Date(nowMs);
  const ageMin = (nowMs - t.getTime()) / 60000;
  if (ageMin >= 0 && ageMin < 1) return 'just now';
  if (ageMin >= 0 && ageMin < 60) return `${Math.floor(ageMin)} min ago`;
  if (ageMin >= 0 && ageMin < 6 * 60) return `${Math.floor(ageMin / 60)} h ago`;
  const sameDay = t.toDateString() === now.toDateString();
  if (sameDay) return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  const day = `${t.getDate()} ${MONTHS[t.getMonth()]}`;
  return t.getFullYear() === now.getFullYear() ? day : `${day} ${t.getFullYear()}`;
}
