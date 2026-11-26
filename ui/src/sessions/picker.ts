// What an empty pane's host picker lists (milestone 72, design 28a*): with nothing
// typed, the host the pane was split from first ("same as pane N"), then the hosts
// connected in this run, newest first, then the rest by name; while typing, the
// palette's matching (lib/search.ts) over every SSH host. A remote desktop is never
// listed: it lives alone in its own tab (spec v8, D-151), so the picker only says where
// it opens when what is typed matches nothing else.

import { hostFields, search, type SearchMatch } from '../lib/search';
import type { HostView } from '../api/types';

export interface PickerRow {
  host: HostView;
  /** `same`: the pane's suggested host; `recent`: connected in this run; `host`: the rest. */
  kind: 'same' | 'recent' | 'host';
  /** The match while typing, for highlighting; null with nothing typed. */
  match: SearchMatch | null;
}

export interface PickerList {
  rows: PickerRow[];
  /** While typing, a remote desktop that matched when no SSH host did; '' otherwise. */
  rdp: string;
}

export function pickerRows(hosts: HostView[], suggest: string, recent: string[], query: string, max: number): PickerList {
  const ssh = hosts.filter((h) => h.type !== 'rdp');
  const byAlias = new Map(ssh.map((h) => [h.alias, h]));
  if (query.trim()) {
    const found: { host: HostView; match: SearchMatch }[] = [];
    for (const h of ssh) {
      const m = search(query, hostFields(h));
      if (m) found.push({ host: h, match: m });
    }
    found.sort((a, b) => b.match.score - a.match.score || a.host.alias.localeCompare(b.host.alias));
    const rows = found.slice(0, max).map((f): PickerRow => ({ host: f.host, kind: f.host.alias === suggest ? 'same' : 'host', match: f.match }));
    let rdp = '';
    if (rows.length === 0) {
      const desk = hosts.filter((h) => h.type === 'rdp').map((h) => ({ h, m: search(query, hostFields(h)) })).filter((x) => x.m)
        .sort((a, b) => b.m!.score - a.m!.score || a.h.alias.localeCompare(b.h.alias));
      rdp = desk[0]?.h.alias ?? '';
    }
    return { rows, rdp };
  }
  const rows: PickerRow[] = [];
  const seen = new Set<string>();
  const add = (h: HostView | undefined, kind: PickerRow['kind']) => {
    if (!h || seen.has(h.alias) || rows.length >= max) return;
    seen.add(h.alias);
    rows.push({ host: h, kind, match: null });
  };
  add(byAlias.get(suggest), 'same');
  for (const a of recent) add(byAlias.get(a), 'recent');
  for (const h of [...ssh].sort((a, b) => a.alias.localeCompare(b.alias))) add(h, 'host');
  return { rows, rdp: '' };
}
