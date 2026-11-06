// The Hosts sidebar: the vault button, a filter and the host tree. The tree uses a
// roving tabindex (one Tab stop, arrow keys inside): ↑↓ move, ←→ collapse or expand,
// ↵ connects (or switches to the host's open tab), ⌘↵ opens a new tab, ⌘I edits and
// ⌫ deletes after a confirmation.

import { useEffect, useMemo, useRef, useState } from 'react';
import { shortPath, useApp, vaultInitial, vaultMarkClass } from '../state/app';
import { buildTree, type TreeRow } from '../lib/tree';
import { colorStyle } from '../lib/colors';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { useSessions } from '../sessions/store';
import { chordLabel } from '../lib/keymap';

export interface TreeHandlers {
  connect: (alias: string, newTab: boolean) => void;
  editHost: (alias: string) => void;
  newHost: (group: string) => void;
  deleteHost: (alias: string) => void;
  newGroup: (parent: string) => void;
  renameGroup: (path: string) => void;
  deleteGroup: (path: string) => void;
  openSwitcher: () => void;
  select: (alias: string | null) => void;
}

// `collapsed` holds group paths and is owned by the shell, which remembers it per
// vault on this machine (D-030).
export function HostTree({ selected, filterRef, collapsed, setCollapsed, resizer, h }: {
  selected: string | null; filterRef: React.RefObject<HTMLInputElement>;
  collapsed: Set<string>; setCollapsed: (next: Set<string>) => void; resizer: React.ReactNode; h: TreeHandlers;
}) {
  const { vault, catalog, os } = useApp();
  const { tabs } = useSessions();
  const [filter, setFilter] = useState('');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => buildTree(catalog.groups, catalog.hosts, collapsed, filter), [catalog, collapsed, filter]);
  const openCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tabs) if (t.status !== 'ended') m.set(t.alias, (m.get(t.alias) ?? 0) + 1);
    return m;
  }, [tabs]);

  const current = rows.find((r) => r.key === focusKey) ?? rows.find((r) => r.kind === 'host' && r.alias === selected) ?? rows[0];
  const idx = current ? rows.indexOf(current) : -1;

  useEffect(() => {
    if (focusKey && treeRef.current?.contains(document.activeElement)) {
      treeRef.current.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
    }
  }, [focusKey, rows]);

  const toggle = (path: string, open?: boolean) => {
    const next = new Set(collapsed);
    const isOpen = !next.has(path);
    if (open === undefined ? isOpen : !open) next.add(path);
    else next.delete(path);
    setCollapsed(next);
  };

  const move = (to: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, to))];
    if (!r) return;
    setFocusKey(r.key);
    if (r.kind === 'host') h.select(r.alias);
  };

  const parentGroup = (r: TreeRow) => (r.kind === 'group' ? r.path.split('/').slice(0, -1).join('/') : r.host.group);

  const onKey = (e: React.KeyboardEvent) => {
    if (!current) return;
    const mod = os === 'mac' ? e.metaKey : e.ctrlKey && e.shiftKey;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(rows.length - 1); }
    else if (e.key === 'ArrowRight' && current.kind === 'group') {
      e.preventDefault();
      if (!current.expanded) toggle(current.path, true); else move(idx + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (current.kind === 'group' && current.expanded) toggle(current.path, false);
      else {
        const parent = parentGroup(current);
        const pr = rows.find((r) => r.kind === 'group' && r.path === parent);
        if (pr) move(rows.indexOf(pr));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current.kind === 'host') h.connect(current.alias, mod);
      else toggle(current.path);
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && !filter) {
      e.preventDefault();
      if (current.kind === 'host') h.deleteHost(current.alias); else h.deleteGroup(current.path);
    }
  };

  const hostMenu = (alias: string, e: React.MouseEvent) => {
    e.preventDefault();
    h.select(alias);
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Connect', icon: 'term', run: () => h.connect(alias, false) },
      { label: 'Connect in new tab', icon: 'plus', run: () => h.connect(alias, true) },
      { label: 'Edit host', icon: 'edit', hint: chordLabel('editHost', os), run: () => h.editHost(alias) },
      { label: 'Delete host', icon: 'trash', danger: true, run: () => h.deleteHost(alias) },
    ] });
  };

  const groupMenu = (path: string, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'New host here', icon: 'plus', run: () => h.newHost(path) },
      { label: 'New subgroup', icon: 'folder', run: () => h.newGroup(path) },
      { label: 'Rename group', icon: 'edit', run: () => h.renameGroup(path) },
      { label: 'Delete group', icon: 'trash', danger: true, run: () => h.deleteGroup(path) },
    ] });
  };

  const pad = (depth: number) => ({ paddingLeft: 8 + depth * 20 });
  const allCollapsed = catalog.groups.length > 0 && catalog.groups.every((g) => collapsed.has(g.path));

  return (
    <aside className="sidebar" data-for="hosts" aria-label="Hosts" style={{ display: 'flex' }}>
      <button className="vault-btn" aria-label={`Switch vault — ${vault?.name} (${chordLabel('switchVault', os)})`} onClick={h.openSwitcher}>
        <span className={'vault-mark ' + vaultMarkClass(vault?.path ?? '')}>{vaultInitial(vault?.name ?? '')}</span>
        <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
          <span className="vault-name trunc">{vault?.name}</span>
          <span className="vault-path trunc">{shortPath(vault?.path ?? '')}</span>
        </span>
        <Icon name="updown" size="sm" className="faint" />
      </button>
      <label className="search side-search">
        <Icon name="search" size="sm" />
        <input ref={filterRef} aria-label="Filter hosts" placeholder="Filter hosts" value={filter} onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setFilter(''); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); move(0); treeRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus(); }
            if (e.key === 'Enter') {
              const first = rows.find((r) => r.kind === 'host');
              if (first && first.kind === 'host') h.connect(first.alias, false);
            }
          }} />
        <Kbd action="gotoHost" />
      </label>
      <div className="side-head">
        <span className="label">Hosts <span className="count-all">· {catalog.hosts.length}</span></span>
        {catalog.groups.length > 0 && (allCollapsed
          ? <button className="icon-btn" aria-label="Expand all groups" title="Expand all" onClick={() => setCollapsed(new Set())}><Icon name="chev" size="sm" /></button>
          : <button className="icon-btn" aria-label="Collapse all groups" title="Collapse all" onClick={() => setCollapsed(new Set(catalog.groups.map((g) => g.path)))}><Icon name="chev-r" size="sm" /></button>)}
        <button className="icon-btn" aria-label="New group" title="New group" onClick={() => h.newGroup('')}><Icon name="folder" size="sm" /></button>
        <button className="icon-btn" aria-label={`New host (${chordLabel('newHost', os)})`} title="New host" onClick={() => h.newHost('')}><Icon name="plus" size="sm" /></button>
      </div>
      {catalog.hosts.length === 0 && catalog.groups.length === 0 ? (
        <div className="tree-empty" style={{ display: 'flex' }}>
          <span>This vault has no hosts yet.</span>
          <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => h.newHost('')}><Icon name="plus" size="sm" />New host<Kbd action="newHost" inline /></button>
        </div>
      ) : (
        <div ref={treeRef} className="tree scroll" role="tree" aria-label={`Hosts in ${vault?.name}`} onKeyDown={onKey}>
          {rows.length === 0 && <span className="faint" style={{ padding: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>No host matches “{filter}”.</span>}
          {rows.map((r) => {
            const tab = r === current ? 0 : -1;
            if (r.kind === 'group') {
              return (
                <button key={r.key} data-key={r.key} className="ti" role="treeitem" aria-expanded={r.expanded} aria-level={r.depth + 1} tabIndex={tab} style={pad(r.depth)}
                  onClick={() => { setFocusKey(r.key); toggle(r.path); }} onContextMenu={(e) => groupMenu(r.path, e)}>
                  <Icon name="chev" className="chev" />
                  <span className="grow trunc">{r.name}</span><span className="count">{r.count}</span>
                </button>
              );
            }
            const c = colorStyle(r.host.color);
            const n = openCount.get(r.alias) ?? 0;
            return (
              <button key={r.key} data-key={r.key} className={'ti' + (r.alias === selected ? ' sel' : '')} role="treeitem" aria-selected={r.alias === selected}
                aria-level={r.depth + 1} tabIndex={tab} style={pad(r.depth)}
                title={[r.host.label, r.host.hostname].filter(Boolean).join(' · ')}
                onClick={() => { setFocusKey(r.key); h.select(r.alias); }}
                onDoubleClick={() => h.connect(r.alias, false)}
                onContextMenu={(e) => hostMenu(r.alias, e)}>
                <span className={'hmark ' + c.className} style={c.style} />
                <span className="host-name grow trunc">{r.alias}</span>
                {n > 0 && <span className="sess" aria-label={`${n} open session${n > 1 ? 's' : ''}`}><Icon name="term" />{n}</span>}
              </button>
            );
          })}
        </div>
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {resizer}
    </aside>
  );
}
