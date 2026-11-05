// The command palette (⌘K; ⌘P and ⌘T limit it to hosts). Hosts first, then actions,
// then vaults. ↵ opens (with ⌘P a host with an open tab switches to it; with ⌘T,
// "New session", it always opens a new tab), ⌘↵ opens a host in a new tab, ⌘I edits
// it, Tab moves between result groups.

import { useMemo, useRef, useState } from 'react';
import { useApp, vaultInitial, vaultMarkClass, shortPath } from '../state/app';
import { fuzzy, highlight } from '../lib/fuzzy';
import { ACTION_TITLES, chordLabel, type Action } from '../lib/keymap';
import { colorStyle } from '../lib/colors';
import { Icon, type IconName } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { useSessions } from '../sessions/store';

type Group = 'all' | 'hosts' | 'actions' | 'vaults';

interface Item {
  group: Exclude<Group, 'all'>;
  key: string;
  score: number;
  render: () => React.ReactNode;
  run: (newTab: boolean) => void;
  edit?: () => void;
}

const PALETTE_ACTIONS: { action: Action; icon: IconName }[] = [
  { action: 'newHost', icon: 'plus' },
  { action: 'reconnect', icon: 'reconnect' },
  { action: 'duplicate', icon: 'dup' },
  { action: 'closeTab', icon: 'x' },
  { action: 'viewHosts', icon: 'hosts' },
  { action: 'viewKeys', icon: 'key' },
  { action: 'viewCredentials', icon: 'cred' },
  { action: 'settings', icon: 'settings' },
  { action: 'toggleSidebar', icon: 'sidebar' },
  { action: 'switchVault', icon: 'updown' },
  { action: 'openVault', icon: 'folder' },
  { action: 'createVault', icon: 'plus' },
  { action: 'lock', icon: 'lock' },
];

function Hl({ text, positions }: { text: string; positions: number[] }) {
  return <>{highlight(text, positions).map((r, i) => (r.match ? <span key={i} className="match">{r.text}</span> : <span key={i}>{r.text}</span>))}</>;
}

export function CommandPalette({ hostsOnly, newSession = false, onClose, onConnect, onEdit, onAction }: {
  hostsOnly: boolean;
  newSession?: boolean;
  onClose: () => void;
  onConnect: (alias: string, newTab: boolean) => void;
  onEdit: (alias: string) => void;
  onAction: (a: Action) => void;
}) {
  const { catalog, recents, vault, os, switchTo, fail } = useApp();
  const { tabs } = useSessions();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>(hostsOnly ? 'hosts' : 'all');
  const [hot, setHot] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const h of catalog.hosts) {
      const name = fuzzy(q, h.alias);
      const where = h.group ? h.group.split('/').join(' / ') : h.hostname;
      const alt = q ? fuzzy(q, `${h.label} ${h.hostname} ${h.tags.join(' ')} ${h.group}`) : null;
      if (q && !name && !alt) continue;
      const tabIdx = tabs.findIndex((t) => t.alias === h.alias && t.status !== 'ended');
      const c = colorStyle(h.color);
      out.push({
        group: 'hosts', key: 'h:' + h.alias, score: (name?.score ?? 0) + (alt ? alt.score / 4 : 0) + 2000,
        render: () => (
          <>
            <span className={'hmark ' + c.className} style={c.style} />
            <span className="mono" style={{ width: 160, flex: 'none' }}><Hl text={h.alias} positions={name?.positions ?? []} /></span>
            <span className="grow faint trunc" style={{ fontSize: 'var(--fs-xs)' }}>{where}{tabIdx >= 0 ? ` · open in tab ${tabIdx + 1}` : ''}</span>
            <span className="hint">{newSession ? 'New tab' : tabIdx >= 0 ? 'Switch to tab' : 'Connect'}</span>
          </>
        ),
        run: (newTab) => onConnect(h.alias, newTab || newSession),
        edit: () => onEdit(h.alias),
      });
    }
    if (!hostsOnly) {
      for (const a of PALETTE_ACTIONS) {
        const title = ACTION_TITLES[a.action];
        const m = fuzzy(q, title);
        if (q && !m) continue;
        out.push({
          group: 'actions', key: 'a:' + a.action, score: (m?.score ?? 0) + 1000,
          render: () => (<><Icon name={a.icon} size="sm" /><span className="grow"><Hl text={title} positions={m?.positions ?? []} /></span><span className="kbd">{chordLabel(a.action, os)}</span></>),
          run: () => onAction(a.action),
        });
      }
      for (const r of recents) {
        if (r.path === vault?.path) continue;
        const m = fuzzy(q, r.name);
        if (q && !m) continue;
        out.push({
          group: 'vaults', key: 'v:' + r.path, score: m?.score ?? 0,
          render: () => (
            <>
              <span className={'vault-mark ' + vaultMarkClass(r.path)} style={{ width: 18, height: 18, fontSize: 'var(--fs-2xs)' }}>{vaultInitial(r.name)}</span>
              <span className="grow trunc"><Hl text={r.name} positions={m?.positions ?? []} /> <span className="mono faint" style={{ fontSize: 'var(--fs-xs)' }}>{shortPath(r.path)}</span></span>
              <span className="hint">Switch vault</span>
            </>
          ),
          run: () => switchTo(r).catch(fail),
        });
      }
    }
    return out;
  }, [catalog.hosts, tabs, q, hostsOnly, newSession, os, recents, vault, onConnect, onEdit, onAction, switchTo, fail]);

  const counts = { hosts: 0, actions: 0, vaults: 0 };
  for (const it of items) counts[it.group]++;
  const order: Exclude<Group, 'all'>[] = ['hosts', 'actions', 'vaults'];
  const shown = items
    .filter((it) => group === 'all' || it.group === group)
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.score - a.score)
    .slice(0, 60);
  const current = shown[Math.min(hot, shown.length - 1)];

  const finish = (fn: () => void) => { onClose(); fn(); };
  const onKey = (e: React.KeyboardEvent) => {
    const mod = os === 'mac' ? e.metaKey : e.ctrlKey;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHot(Math.min(shown.length - 1, hot + 1)); scrollHot(hot + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHot(Math.max(0, hot - 1)); scrollHot(hot - 1); }
    else if (e.key === 'Enter' && current) { e.preventDefault(); finish(() => current.run(mod)); }
    else if (e.key === 'Tab' && !hostsOnly) {
      e.preventDefault();
      const groups: Group[] = ['all', 'hosts', 'actions', 'vaults'];
      setGroup(groups[(groups.indexOf(group) + (e.shiftKey ? 3 : 1)) % 4]);
      setHot(0);
    } else if ((e.key === 'i' || e.key === 'I') && mod && current?.edit) { e.preventDefault(); finish(current.edit); }
  };
  const scrollHot = (i: number) => {
    requestAnimationFrame(() => list.current?.querySelectorAll('[role="option"]')[Math.max(0, i)]?.scrollIntoView({ block: 'nearest' }));
  };

  let lastGroup = '';
  return (
    <Modal label="Command palette" onClose={onClose} width={640} top={84} className="palette">
      <div onKeyDown={onKey} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <label className="row" style={{ height: 52, padding: '0 var(--sp-4)', gap: 'var(--sp-3)', borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name="search" className="faint" />
          <input aria-label={newSession ? 'New session on' : hostsOnly ? 'Go to host' : 'Search hosts, actions and vaults'} placeholder={newSession ? 'New session on…' : hostsOnly ? 'Go to host…' : 'Hosts, actions, vaults…'}
            value={q} onChange={(e) => { setQ(e.target.value); setHot(0); }} className="grow" data-autofocus autoFocus
            role="combobox" aria-expanded="true" aria-controls="palette-results" aria-activedescendant={current ? 'pi-' + current.key : undefined}
            style={{ background: 'none', border: 0, outline: 'none', fontSize: 'var(--fs-lg)', color: 'var(--text-primary)' }} />
          <Key>esc</Key>
        </label>
        {!hostsOnly && (
          <div className="row" role="tablist" aria-label="Result groups" style={{ gap: 'var(--sp-1)', padding: 'var(--sp-2) var(--sp-3)', borderBottom: '1px solid var(--border-subtle)' }}>
            {(['all', 'hosts', 'actions', 'vaults'] as Group[]).map((g) => (
              <button key={g} className={'btn btn-sm ' + (group === g ? 'btn-secondary' : 'btn-ghost')} role="tab" aria-selected={group === g} tabIndex={-1} onClick={() => { setGroup(g); setHot(0); }}>
                {g[0].toUpperCase() + g.slice(1)} <span className="faint">{g === 'all' ? items.length : counts[g]}</span>
              </button>
            ))}
            <span className="grow" /><span className="hint row" style={{ gap: 6 }}><Key>tab</Key>next group</span>
          </div>
        )}
        <div ref={list} id="palette-results" className="col scroll" role="listbox" aria-label="Results" style={{ padding: 'var(--sp-1) var(--sp-2) var(--sp-2)', gap: 1, maxHeight: 420 }}>
          {shown.length === 0 && <span className="faint" style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>{catalog.hosts.length === 0 && hostsOnly ? 'This vault has no hosts yet.' : 'No results.'}</span>}
          {shown.map((it, i) => {
            const header = it.group !== lastGroup;
            lastGroup = it.group;
            return (
              <div key={it.key} style={{ display: 'contents' }}>
                {header && <div className="menu-label"><span className="label">{it.group[0].toUpperCase() + it.group.slice(1)}</span></div>}
                <button id={'pi-' + it.key} className={'mi' + (it === current ? ' hot' : '')} role="option" aria-selected={it === current} tabIndex={-1}
                  style={{ minHeight: 38 }} onMouseMove={() => setHot(i)} onClick={(e) => finish(() => it.run(os === 'mac' ? e.metaKey : e.ctrlKey))}>
                  {it.render()}
                  {it === current && <Key>↵</Key>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="row faint" data-palette-hints style={{ height: 36, padding: '0 var(--sp-4)', gap: 'var(--sp-4)', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-raised)', fontSize: 'var(--fs-xs)', flex: 'none' }}>
          <span className="row" style={{ gap: 6 }}><Key>↑↓</Key>move</span>
          <span className="row" style={{ gap: 6 }}><Key>↵</Key>{newSession ? 'open in new tab' : 'open'}</span>
          {/* ⌘↵ and ⌘I only act on a host, so they are offered only while one is hot. */}
          {current?.group === 'hosts' && <>
            {!newSession && <span className="row" style={{ gap: 6 }}><Key>{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</Key>open in new tab</span>}
            <span className="row" style={{ gap: 6 }}><Key>{os === 'mac' ? '⌘I' : 'Ctrl+I'}</Key>edit host</span>
          </>}
        </div>
      </div>
    </Modal>
  );
}
