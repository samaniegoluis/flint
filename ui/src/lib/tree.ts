// Builds the rows of the sidebar's host tree from the catalog: nested groups (paths
// joined with "/"), then the hosts inside them, sorted by name. A filter keeps the
// hosts that match and the groups on their path.

import type { GroupView, HostView } from '../api/types';

export type TreeRow =
  | { kind: 'group'; key: string; path: string; name: string; depth: number; count: number; expanded: boolean }
  | { kind: 'host'; key: string; alias: string; depth: number; host: HostView };

interface Node {
  path: string;
  name: string;
  children: Map<string, Node>;
  hosts: HostView[];
}

function newNode(path: string, name: string): Node {
  return { path, name, children: new Map(), hosts: [] };
}

function nodeFor(root: Node, path: string): Node {
  let cur = root;
  if (!path) return cur;
  let acc = '';
  for (const part of path.split('/')) {
    acc = acc ? acc + '/' + part : part;
    let next = cur.children.get(part);
    if (!next) {
      next = newNode(acc, part);
      cur.children.set(part, next);
    }
    cur = next;
  }
  return cur;
}

export function hostMatches(h: HostView, q: string): boolean {
  const s = q.toLowerCase();
  return (
    h.alias.toLowerCase().includes(s) ||
    h.label.toLowerCase().includes(s) ||
    h.hostname.toLowerCase().includes(s) ||
    h.tags.some((t) => t.toLowerCase().includes(s))
  );
}

function countHosts(n: Node): number {
  let c = n.hosts.length;
  for (const child of n.children.values()) c += countHosts(child);
  return c;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

export function buildTree(groups: GroupView[], hosts: HostView[], collapsed: Set<string>, filter: string): TreeRow[] {
  const q = filter.trim();
  const root = newNode('', '');
  for (const g of groups) nodeFor(root, g.path);
  for (const h of hosts) {
    if (q && !hostMatches(h, q)) continue;
    nodeFor(root, h.group).hosts.push(h);
  }
  const rows: TreeRow[] = [];
  const walk = (n: Node, depth: number) => {
    const kids = [...n.children.values()].sort((a, b) => byName(a.name, b.name));
    for (const child of kids) {
      const count = countHosts(child);
      if (q && count === 0) continue;
      const expanded = q ? true : !collapsed.has(child.path);
      rows.push({ kind: 'group', key: 'g:' + child.path, path: child.path, name: child.name, depth, count, expanded });
      if (expanded) walk(child, depth + 1);
    }
    for (const h of [...n.hosts].sort((a, b) => byName(a.alias, b.alias))) {
      rows.push({ kind: 'host', key: 'h:' + h.alias, alias: h.alias, depth, host: h });
    }
  };
  walk(root, 0);
  return rows;
}

// Every group path, sorted, for pickers.
export function groupPaths(groups: GroupView[]): string[] {
  return groups.map((g) => g.path).sort(byName);
}
