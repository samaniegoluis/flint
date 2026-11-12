// The command palette (⌘K; ⌘P and ⌘T limit it to hosts). Hosts first, then actions,
// then vaults. ↵ opens (with ⌘P a host with an open tab switches to it; with ⌘T,
// "New session", it always opens a new tab), ⌘↵ opens a host in a new tab, ⇧⌘↵ in a
// new pane of the active tab (design 18e), ⌘I edits it, Tab moves between result
// groups. While searching, the best hosts are also offered as "Open <host> in a new
// pane" actions, and every tunnel as "Start tunnel <name> on <host>" or "Stop …", with
// "Connect to <host> with tunnels" and "Manage tunnels of <host>…" (design 20e).

import { useMemo, useRef, useState } from 'react';
import { useApp, vaultInitial, vaultMarkClass, shortPath } from '../state/app';
import { fuzzy, highlight } from '../lib/fuzzy';
import { ACTION_TITLES, chordLabel, type Action } from '../lib/keymap';
import { colorStyle } from '../lib/colors';
import { HostTypeIcon, Icon, type IconName } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { useSessions } from '../sessions/store';
import { MAX_PANES } from '../lib/layout';
import { tunnels, useTunnels } from '../tunnels/store';

type Group = 'all' | 'hosts' | 'actions' | 'vaults';

interface Item {
  /** Tunnel rows show under All and Actions, with a header of their own. */
  group: Exclude<Group, 'all'> | 'tunnels';
  key: string;
  score: number;
  render: () => React.ReactNode;
  /** `tab`: ⌘↵, a new tab. `pane`: ⇧⌘↵, a new pane of the active tab. */
  run: (mode: 'open' | 'tab' | 'pane') => void;
  /** Hosts only: ⇧⌘↵ applies. */
  host?: boolean;
  edit?: () => void;
  /** Shown greyed with this reason, and does nothing (design 21d2). */
  disabled?: string;
}

// What an RDP tab cannot do (design 21d2): files, tunnels and panes are SSH's.
const SSH_ONLY_ACTIONS: Action[] = ['viewFiles', 'viewTunnels', 'splitRight', 'splitDown', 'focusNextPane', 'layout1', 'layout2', 'layout3', 'layout4', 'duplicate'];

const PALETTE_ACTIONS: { action: Action; icon: IconName }[] = [
  { action: 'newHost', icon: 'plus' },
  { action: 'newSshHost', icon: 'plus' },
  { action: 'newRdpHost', icon: 'plus' },
  { action: 'reconnect', icon: 'reconnect' },
  { action: 'duplicate', icon: 'dup' },
  { action: 'splitRight', icon: 'split' },
  { action: 'splitDown', icon: 'split' },
  { action: 'focusNextPane', icon: 'split' },
  { action: 'layout1', icon: 'split' },
  { action: 'layout2', icon: 'split' },
  { action: 'layout3', icon: 'split' },
  { action: 'layout4', icon: 'split' },
  { action: 'closeTab', icon: 'x' },
  { action: 'fullscreen', icon: 'expand' },
  { action: 'viewHosts', icon: 'hosts' },
  { action: 'viewTunnels', icon: 'tunnel' },
  { action: 'viewKeys', icon: 'key' },
  { action: 'viewCredentials', icon: 'cred' },
  { action: 'settings', icon: 'settings' },
  { action: 'toggleSidebar', icon: 'sidebar' },
  { action: 'collapseAll', icon: 'folder' },
  { action: 'expandAll', icon: 'folder' },
  { action: 'switchVault', icon: 'updown' },
  { action: 'openVault', icon: 'folder' },
  { action: 'createVault', icon: 'plus' },
  { action: 'lock', icon: 'lock' },
  { action: 'quit', icon: 'x' },
];

function Hl({ text, positions }: { text: string; positions: number[] }) {
  return <>{highlight(text, positions).map((r, i) => (r.match ? <span key={i} className="match">{r.text}</span> : <span key={i}>{r.text}</span>))}</>;
}

export function CommandPalette({ hostsOnly, newSession = false, pickToEdit = false, onClose, onConnect, onConnectWithTunnels, onManageTunnels, onSplit, onEdit, onAction }: {
  hostsOnly: boolean;
  newSession?: boolean;
  /** Picks a host to add a tunnel to (the Tunnels view's empty state): ↵ opens its editor. */
  pickToEdit?: boolean;
  /** Opens a tab on the host and starts every one of its tunnels. */
  onConnectWithTunnels: (alias: string) => void;
  /** The host editor, at its Tunnels section. */
  onManageTunnels: (alias: string) => void;
  onClose: () => void;
  onConnect: (alias: string, newTab: boolean, noCommand?: boolean) => void;
  /** Opens a host in a new pane of the active tab. */
  onSplit: (alias: string, noCommand?: boolean) => void;
  onEdit: (alias: string) => void;
  onAction: (a: Action) => void;
}) {
  const { catalog, recents, vault, os, switchTo, fail } = useApp();
  const { tabs, panes, active } = useSessions();
  const tun = useTunnels();
  const activeTab = tabs.find((t) => t.id === active);
  // A new pane goes into the active tab, while it has room; a remote desktop's tab
  // takes none.
  const rdpTab = panes.find((p) => p.id === activeTab?.focus)?.kind === 'rdp';
  const canSplit = !!activeTab && activeTab.panes.length < MAX_PANES && !rdpTab;
  const paneNo = activeTab ? activeTab.panes.indexOf(activeTab.focus) + 1 : 0;
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>(hostsOnly ? 'hosts' : 'all');
  const [hot, setHot] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const h of catalog.hosts) {
      const rdp = h.type === 'rdp';
      // Adding a tunnel needs an SSH host.
      if (pickToEdit && rdp) continue;
      const name = fuzzy(q, h.alias);
      const where = h.group ? h.group.split('/').join(' / ') : h.hostname;
      const alt = q ? fuzzy(q, `${h.label} ${h.hostname} ${h.tags.join(' ')} ${h.group}`) : null;
      if (q && !name && !alt) continue;
      const tabIdx = tabs.findIndex((t) => panes.some((p) => p.tab === t.id && p.alias === h.alias && p.status !== 'ended'));
      const c = colorStyle(h.color);
      out.push({
        group: 'hosts', key: 'h:' + h.alias, score: (name?.score ?? 0) + (alt ? alt.score / 4 : 0) + 2000,
        render: () => (
          <>
            <span className={'hmark ' + c.className} style={c.style} />
            <HostTypeIcon type={h.type} size="md" />
            <span className="mono" style={{ width: 160, flex: 'none' }}><Hl text={h.alias} positions={name?.positions ?? []} /></span>
            <span className="grow faint trunc" style={{ fontSize: 'var(--fs-xs)' }}>{where}{tabIdx >= 0 ? ` · open in tab ${tabIdx + 1}` : ''}</span>
            <span className="hint">{newSession ? 'New tab' : tabIdx >= 0 ? 'Switch to tab' : 'Connect'}</span>
          </>
        ),
        run: (mode) => (pickToEdit ? onManageTunnels(h.alias) : mode === 'pane' && canSplit && !rdp ? onSplit(h.alias) : onConnect(h.alias, mode === 'tab' || newSession)),
        edit: () => onEdit(h.alias),
        host: !rdp,
      });
      // A host with an initial command can be opened without it once, like
      // `flint connect --no-command`: a way in when that program is broken. Offered
      // only while searching, so an empty palette does not list every host twice.
      if (h.command && q) {
        out.push({
          group: 'hosts', key: 'hn:' + h.alias, score: (name?.score ?? 0) + (alt ? alt.score / 4 : 0) + 1999,
          render: () => (
            <>
              <span className={'hmark ' + c.className} style={c.style} />
              <span className="mono" style={{ width: 160, flex: 'none' }}><Hl text={h.alias} positions={name?.positions ?? []} /></span>
              <span className="grow faint trunc" style={{ fontSize: 'var(--fs-xs)' }}>without <span className="mono">{h.command}</span></span>
              <span className="hint">Connect without command</span>
            </>
          ),
          run: (mode) => (mode === 'pane' && canSplit ? onSplit(h.alias, true) : onConnect(h.alias, true, true)),
          edit: () => onEdit(h.alias),
          host: true,
        });
      }
    }
    if (!hostsOnly && q) {
      // Tunnels, while searching (design 20e): by tunnel name, host or port, and by the
      // row's own words, so "stop web" finds "Stop tunnel web on <host>".
      const hostsWith = new Map<string, number>();
      for (const v of tun.list) {
        const up = v.state === 'listening';
        const byName = fuzzy(q, `${v.name} ${v.host}`);
        const byAction = byName ? null : fuzzy(q, `${up ? 'stop' : 'start'} tunnel ${v.name} on ${v.host}`);
        const m = byName ?? byAction ?? (String(v.local_port).includes(q) ? { score: 1, positions: [] } : null);
        if (!m) continue;
        hostsWith.set(v.host, Math.max(hostsWith.get(v.host) ?? 0, m.score));
        const conns = v.connections === 0 ? 'no connections' : v.connections === 1 ? '1 connection' : `${v.connections} connections`;
        out.push({
          // Asked for by its action ("start web"): above the host's Connect with tunnels.
          group: 'tunnels', key: 't:' + v.host + ':' + v.name, score: m.score + (byAction ? 1900 : 1800),
          render: () => (
            <>
              <Icon name="tunnel" size="sm" />
              <span className="grow trunc">{up ? 'Stop' : 'Start'} tunnel <span className="strong">{v.name}</span> on <span className="mono">{v.host}</span></span>
              <span className="hint mono">{up ? conns : `127.0.0.1:${v.local_port}`}</span>
            </>
          ),
          run: () => { if (up) void tunnels.stop(v.host, v.name); else tunnels.startTunnels(v.host, [v.name]); },
        });
      }
      for (const [host, score] of hostsWith) {
        const names = tun.list.filter((v) => v.host === host && v.state !== 'listening').map((v) => v.name);
        if (names.length > 0) {
          out.push({
            group: 'tunnels', key: 'tc:' + host, score: score + 1850,
            render: () => (
              <>
                <Icon name="term" size="sm" />
                <span className="grow trunc">Connect to <span className="mono">{host}</span> with tunnels</span>
                <span className="hint trunc">opens a tab · starts {names.join(', ')}</span>
              </>
            ),
            run: () => onConnectWithTunnels(host),
          });
        }
        out.push({
          group: 'tunnels', key: 'tm:' + host, score: score + 1700,
          render: () => (<><Icon name="edit" size="sm" /><span className="grow trunc">Manage tunnels of <span className="mono">{host}</span>…</span></>),
          run: () => onManageTunnels(host),
        });
      }
    }
    if (!hostsOnly && canSplit && q) {
      // The best three hosts, as "Open <host> in a new pane" (design 18e).
      const best = catalog.hosts
        .filter((h) => h.type !== 'rdp')
        .map((h) => ({ h, m: fuzzy(q, h.alias) }))
        .filter((x) => x.m)
        .sort((a, b) => b.m!.score - a.m!.score)
        .slice(0, 3);
      best.forEach(({ h, m }, i) => {
        out.push({
          group: 'actions', key: 'np:' + h.alias, score: m!.score + 1500,
          render: () => (
            <>
              <Icon name="split" size="sm" />
              <span className="grow trunc">Open <span className="mono"><Hl text={h.alias} positions={m!.positions} /></span> in a new pane</span>
              {i === 0 && <span className="hint">splits pane {paneNo} · {activeTab!.panes.length + 1} of {MAX_PANES}</span>}
            </>
          ),
          run: () => onSplit(h.alias),
        });
      });
    }
    if (!hostsOnly) {
      for (const a of PALETTE_ACTIONS) {
        const title = ACTION_TITLES[a.action];
        const m = fuzzy(q, title);
        if (q && !m) continue;
        out.push({
          group: 'actions', key: 'a:' + a.action, score: (m?.score ?? 0) + 1000,
          render: () => (<><Icon name={a.icon} size="sm" /><span className="grow"><Hl text={title} positions={m?.positions ?? []} /></span>{a.action === 'newSshHost' && <HostTypeIcon type="ssh" size="md" />}{a.action === 'newRdpHost' && <HostTypeIcon type="rdp" size="md" />}{chordLabel(a.action, os) && <span className="kbd">{chordLabel(a.action, os)}</span>}</>),
          run: () => onAction(a.action),
          disabled: rdpTab && SSH_ONLY_ACTIONS.includes(a.action) ? 'SSH hosts only' : !rdpTab && a.action === 'fullscreen' ? 'RDP tabs only' : undefined,
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
  }, [catalog.hosts, tabs, panes, tun.list, canSplit, rdpTab, paneNo, activeTab, q, hostsOnly, newSession, pickToEdit, os, recents, vault, onConnect, onConnectWithTunnels, onManageTunnels, onSplit, onEdit, onAction, switchTo, fail]);

  const counts = { hosts: 0, actions: 0, vaults: 0 };
  for (const it of items) counts[it.group === 'tunnels' ? 'actions' : it.group]++;
  // Hosts stay first, so ↵ on a host's name still connects (20e draws Tunnels first).
  const order: Item['group'][] = ['hosts', 'tunnels', 'actions', 'vaults'];
  const shown = items
    .filter((it) => group === 'all' || it.group === group || (group === 'actions' && it.group === 'tunnels'))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.score - a.score)
    .slice(0, 60);
  const current = shown[Math.min(hot, shown.length - 1)];

  const finish = (fn: () => void) => { onClose(); fn(); };
  const onKey = (e: React.KeyboardEvent) => {
    const mod = os === 'mac' ? e.metaKey : e.ctrlKey;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHot(Math.min(shown.length - 1, hot + 1)); scrollHot(hot + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHot(Math.max(0, hot - 1)); scrollHot(hot - 1); }
    else if (e.key === 'Enter' && current) { e.preventDefault(); if (current.disabled) return; finish(() => current.run(mod && e.shiftKey ? 'pane' : mod ? 'tab' : 'open')); }
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
          <input aria-label={pickToEdit ? 'Add a tunnel to' : newSession ? 'New session on' : hostsOnly ? 'Go to host' : 'Search hosts, actions and vaults'} placeholder={pickToEdit ? 'Add a tunnel to…' : newSession ? 'New session on…' : hostsOnly ? 'Go to host…' : 'Hosts, actions, vaults…'}
            value={q} onChange={(e) => { setQ(e.target.value); setHot(0); }} className="grow" data-autofocus autoFocus
            spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
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
                <button id={'pi-' + it.key} className={'mi' + (it === current ? ' hot' : '') + (it.disabled ? ' is-disabled' : '')} role="option" aria-selected={it === current} aria-disabled={!!it.disabled} tabIndex={-1}
                  title={it.disabled} data-palette-disabled={it.disabled ? '' : undefined}
                  style={{ minHeight: 38 }} onMouseMove={() => setHot(i)} onClick={(e) => { if (it.disabled) return; const m = os === 'mac' ? e.metaKey : e.ctrlKey; finish(() => it.run(m && e.shiftKey ? 'pane' : m ? 'tab' : 'open')); }}>
                  {it.render()}
                  {it.disabled && it === current && <span className="hint">{it.disabled}</span>}
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
            {canSplit && current.host && <span className="row" style={{ gap: 6 }}><Key>{os === 'mac' ? '⇧⌘↵' : 'Ctrl+Shift+↵'}</Key>open in a new pane</span>}
            <span className="row" style={{ gap: 6 }}><Key>{os === 'mac' ? '⌘I' : 'Ctrl+I'}</Key>edit host</span>
          </>}
        </div>
      </div>
    </Modal>
  );
}
