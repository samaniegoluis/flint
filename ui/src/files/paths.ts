// Pure helpers for the Files view (milestone 17): OSC 7, remote paths, and how sizes
// and times read in the list.

import type { FileEntry } from '../api/types';
import { fmtNumber, t } from '../i18n';

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
  if (n < 1024) return t('files.size', { n: fmtNumber(n), unit: 'B' });
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return t('files.size', { n: v < 10 ? fmtNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : fmtNumber(Math.round(v)), unit: units[u] });
}


/**
 * When a file changed, as the design shows it: "21:40" today, "2 h ago" in the
 * last hours, "12 Oct" this year, "12 Oct 2024" before.
 */
export function humanTime(mtimeSecs: number, nowMs = Date.now()): string {
  const d = new Date(mtimeSecs * 1000);
  const now = new Date(nowMs);
  const ageMin = (nowMs - d.getTime()) / 60000;
  if (ageMin >= 0 && ageMin < 1) return t('files.time.just_now');
  if (ageMin >= 0 && ageMin < 60) return t('files.time.min_ago', { min: Math.floor(ageMin) });
  if (ageMin >= 0 && ageMin < 6 * 60) return t('files.time.h_ago', { h: Math.floor(ageMin / 60) });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const month = t(`files.month.${d.getMonth()}`);
  return d.getFullYear() === now.getFullYear() ? t('files.time.day_month', { day: d.getDate(), month }) : t('files.time.day_month_year', { day: d.getDate(), month, year: d.getFullYear() });
}

/**
 * The folder a typed or pasted path names, absolute and without `.`, `..` or doubled
 * slashes: `/etc/nginx`, `~` and `~/logs` (against `home`), or a name relative to
 * `from`, the folder shown. Quotes around a pasted path are dropped. Null when there
 * is nothing to go to, or `~` is typed with no home known.
 */
export function resolveTypedPath(typed: string, from: string, home: string): string | null {
  let t = typed.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) t = t.slice(1, -1).trim();
  if (!t || t.includes('\0')) return null;
  let abs: string;
  if (t === '~' || t.startsWith('~/')) {
    if (!home.startsWith('/')) return null;
    abs = home + t.slice(1);
  } else if (t.startsWith('/')) abs = t;
  else abs = (from.startsWith('/') ? from : '/') + '/' + t;
  const out: string[] = [];
  for (const part of abs.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}
