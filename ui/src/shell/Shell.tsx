// The main window once a vault is unlocked (design screen 04): title bar, activity
// bar, the Hosts sidebar, the main area (sessions, or a full-page view) and the
// status bar, plus every overlay. App shortcuts are handled here.

import { keyTab, pairs } from '../files/pair';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, on } from '../api/backend';
import { useApp } from '../state/app';
import { actionFor, chordLabel, type Action } from '../lib/keymap';
import { Icon, Logo } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { ConfirmDialog, TextDialog, type TextAsk } from '../ui/Dialogs';
import { HostTree } from './HostTree';
import { ManageVaults, VaultMenu } from './VaultSwitcher';
import { setActionHandler } from './actions';
import { SessionArea } from '../sessions/SessionArea';
import { clampFiles, clampSidebar, FILES_DEFAULT, FILES_MAX, FILES_MIN, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, useUiState } from '../state/uiState';
import { FilesView } from '../files/FilesView';
import { files as filesStore } from '../files/store';
import { sessions, useSessions } from '../sessions/store';
import { LAYOUTS, MAX_PANES, type SplitDir } from '../lib/layout';
import { focusTerminal } from '../sessions/TerminalView';
import { HostEditor } from '../editors/HostEditor';
import { HostTypeStep } from '../editors/HostTypeStep';
import type { HostType } from '../api/types';
import { KeysPage, type Confirm } from '../pages/KeysPage';
import { CredentialsPage } from '../pages/CredentialsPage';
import { SettingsPage, type SettingsSection } from '../pages/SettingsPage';
import { CommandPalette } from '../palette/CommandPalette';
import { ApprovalDialog, useAccessState } from '../access/ApprovalDialog';
import { TunnelsView } from '../tunnels/TunnelsView';
import { tunnels, upOn, useTunnels } from '../tunnels/store';

type View = 'hosts' | 'files' | 'tunnels' | 'keys' | 'credentials' | 'settings';
// The views that keep the sessions on screen beside a sidebar.
const SIDE_VIEWS: View[] = ['hosts', 'files', 'tunnels'];
const NARROW = 1040;

export function Shell() {
  const app = useApp();
  const { os, vault, catalog, settings, notify, fail, refreshCatalog, openVaultFile, go, phase } = app;
  const { tabs, panes, active } = useSessions();
  const [view, setView] = useState<View>('hosts');
  const [narrow, setNarrow] = useState(window.innerWidth < NARROW);
  const [collapsed, setCollapsed] = useState(window.innerWidth < NARROW);
  const [selected, setSelected] = useState<string | null>(null);
  const [palette, setPalette] = useState<{ hostsOnly: boolean; newSession?: boolean; editHost?: boolean } | null>(null);
  const [switcher, setSwitcher] = useState(false);
  const [manage, setManage] = useState(false);
  // A new host without a type opens the type step first (design 21a).
  const [editor, setEditor] = useState<{ alias: string | null; group: string; tunnels?: boolean; type?: HostType } | null>(null);
  const [addingKey, setAddingKey] = useState(false);
  const [credEditing, setCredEditing] = useState<string | null | undefined>(undefined);
  const [section, setSection] = useState<SettingsSection>('appearance');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [ask, setAsk] = useState<TextAsk | null>(null);
  const [zoom, setZoom] = useState(0);
  const filterRef = useRef<HTMLInputElement>(null);
  // Panes whose host's tunnels start once the pane is connected; `all`: every one.
  const startOnConnect = useRef(new Map<string, { alias: string; all: boolean }>());
  const withTunnels = useRef(false);
  // The hosts with an open pane, to tell when a host's last tab closed (design 20d2).
  const openHosts = useRef(new Set<string>());
  const prevStatus = useRef(new Map<string, string>());
  const { ui, update: updateUi } = useUiState(vault?.path ?? '');
  const access = useAccessState(phase === 'main');
  const tun = useTunnels();
  const tunnelsUp = tun.list.filter((v) => v.state === 'listening').length;
  // Tunnels follow the open vault: listed once it opens, forgotten when another opens.
  useEffect(() => {
    tunnels.start();
    tunnels.reset();
    if (vault?.path) void tunnels.refresh();
  }, [vault?.path]);
  useEffect(() => { if (phase === 'main') void tunnels.refresh(); }, [phase, catalog]);
  const approval = access.state?.pending[0] ?? null;
  const grantCount = access.state?.grants.length ?? 0;
  const waiting = access.state?.pending.length ?? 0;
  // A request waits behind another app: the status bar says so until Flint is in front.
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => { window.removeEventListener('focus', on); window.removeEventListener('blur', off); };
  }, []);
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;

  // The remembered sidebar state applies once loaded, unless the window is too narrow
  // to dock it. Only what the person chooses in a wide window is remembered.
  const uiLoaded = ui !== null;
  useEffect(() => {
    if (ui && !narrowRef.current) setCollapsed(!ui.sidebar_open);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiLoaded, vault?.path]);
  const setSidebarCollapsed = useCallback((c: boolean | ((was: boolean) => boolean)) => {
    setCollapsed((was) => {
      const next = typeof c === 'function' ? c(was) : c;
      if (!narrowRef.current && next !== was) updateUi({ sidebar_open: !next });
      return next;
    });
  }, [updateUi]);

  const sidebarWidth = ui?.sidebar_width ?? SIDEBAR_DEFAULT;
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', sidebarWidth + 'px');
    return () => { document.documentElement.style.removeProperty('--sidebar-w'); };
  }, [sidebarWidth]);
  const filesWidth = ui?.files_width || FILES_DEFAULT;
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-files-w', filesWidth + 'px');
    return () => { document.documentElement.style.removeProperty('--sidebar-files-w'); };
  }, [filesWidth]);
  // Transfers queued while the window was locked start once it opens again.
  useEffect(() => { if (phase === 'main') filesStore.resume(); }, [phase]);
  // A closed pane's folder and finished transfers go with it.
  useEffect(() => {
    const open = new Set(panes.map((t) => t.id));
    for (const id of Object.keys(filesStore.get().folders)) if (!open.has(keyTab(id))) filesStore.forget(id);
    pairs.keepOnly(open);
  }, [panes]);
  const collapsedGroups = new Set(ui?.collapsed ?? []);
  const setCollapsedGroups = useCallback((next: Set<string>) => updateUi({ collapsed: [...next] }), [updateUi]);

  const fontSize = Math.max(8, Math.min(32, settings.term_font_size + zoom));
  // The active tab's focused pane: the Files view, the title and the status bar follow it.
  const tab = panes.find((p) => p.id === tabs.find((t) => t.id === active)?.focus);
  const sideView = SIDE_VIEWS.includes(view);
  const showSidebar = sideView && !collapsed;

  // The design's layout rules key off the root's data-view and data-collapsed: the
  // main area starts after the rail, plus the sidebar when it is docked.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.app');
    if (!root) return;
    root.dataset.view = view;
    root.dataset.collapsed = String(SIDE_VIEWS.includes(view) && (collapsed || narrow));
    // A narrow window lays the sidebar over the terminal instead of beside it.
    root.dataset.narrow = String(narrow);
    return () => { delete root.dataset.view; delete root.dataset.collapsed; delete root.dataset.narrow; };
  }, [view, collapsed, narrow]);

  useEffect(() => {
    const onResize = () => {
      const n = window.innerWidth < NARROW;
      setNarrow((was) => {
        if (n && !was) setCollapsed(true);
        return n;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A prompt that opens in a background tab gets a toast naming the tab's shortcut;
  // one in another pane of this tab names the pane.
  useEffect(() => {
    for (const p of panes) {
      const before = prevStatus.current.get(p.id);
      prevStatus.current.set(p.id, p.status);
      if (p.status !== 'prompt' || before === 'prompt') continue;
      const i = tabs.findIndex((t) => t.id === p.tab);
      const t = tabs[i];
      if (!t || (t.id === active && t.focus === p.id)) continue;
      if (t.id === active) notify(`${p.alias} needs your input in pane ${t.panes.indexOf(p.id) + 1}`, 'info');
      else notify(`${p.alias} needs your input${i < 9 ? ' ' + chordLabel(('tab' + (i + 1)) as Action, os) : ''}`, 'info');
    }
  }, [panes, tabs, active, os, notify]);

  // A pane that connected starts its host's tunnels; one that ended first starts none.
  useEffect(() => {
    for (const [id, want] of startOnConnect.current) {
      const p = panes.find((x) => x.id === id);
      if (!p || p.status === 'ended') { startOnConnect.current.delete(id); continue; }
      if (p.status !== 'ready') continue;
      startOnConnect.current.delete(id);
      // Only when one of them is down: no login for tunnels that already run.
      const own = tunnels.get().list.filter((v) => v.host === want.alias && v.state !== 'listening' && (want.all || v.open_on_connect));
      if (own.length > 0) tunnels.startTunnels(want.alias, own.map((v) => v.name));
    }
    // The last pane of a host closed while its tunnels run: they stay up (design 20d2).
    const now = new Set(panes.filter((p) => p.status !== 'ended').map((p) => p.alias));
    for (const alias of openHosts.current) {
      if (now.has(alias) || panes.some((p) => p.alias === alias)) continue;
      const up = upOn(tunnels.get().list, alias);
      if (up.length === 0) continue;
      const names = up.map((v) => v.name);
      const list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
      notify(`Tab closed. ${list} ${names.length === 1 ? 'is' : 'are'} still up on ${alias}.`, 'info', { label: names.length === 1 ? 'Stop it' : 'Stop them', run: () => { void tunnels.stopHost(alias); } });
    }
    openHosts.current = now;
  }, [panes, notify]);

  const isRdp = useCallback((alias: string) => catalog.hosts.find((h) => h.alias === alias)?.type === 'rdp', [catalog.hosts]);

  // `noCommand` (the palette's "without …" row) always opens its own tab. An RDP
  // host opens a remote desktop tab (milestone 30), one per host unless asked again.
  const connect = useCallback((alias: string, newTab: boolean, noCommand = false) => {
    setView((v) => (SIDE_VIEWS.includes(v) ? v : 'hosts'));
    if (narrow) setCollapsed(true);
    const open = sessions.get().panes.find((t) => t.alias === alias && t.status !== 'ended' && !t.noCommand);
    if (open && !newTab && !noCommand) { sessions.focusPane(open.id); return; }
    if (isRdp(alias)) { sessions.open(alias, false, 'rdp'); return; }
    sessions.open(alias, noCommand);
    // Connecting starts the host's Open when I connect tunnels once its terminal is in
    // (D-064): on their own session, so a reconnect or closing the tab leaves them up.
    const pane = sessions.get().panes.find((p) => p.id === sessions.tab(sessions.get().active)?.focus);
    if (pane && pane.alias === alias) startOnConnect.current.set(pane.id, { alias, all: withTunnels.current });
    withTunnels.current = false;
  }, [narrow, isRdp]);

  // `flint connect <rdp-host>` (milestone 30): the CLI never shows a desktop, so the
  // app opens the host's tab, as a double-click in the tree does.
  useEffect(() => on<{ alias: string }>('rdp:open-request', (e) => connect(e.alias, false)), [connect]);

  // A new pane in the active tab (⌘D, ⇧⌘D, the Split menu, the palette's ⇧⌘↵).
  const split = useCallback((dir: SplitDir, alias?: string, noCommand = false) => {
    // A remote desktop opens in a tab of its own, and its tab takes no other pane.
    if (alias && isRdp(alias)) { connect(alias, true); return; }
    setView((v) => (SIDE_VIEWS.includes(v) ? v : 'hosts'));
    const t = sessions.tab(sessions.get().active);
    if (!t) { if (alias) sessions.open(alias, noCommand); return; }
    if (sessions.pane(t.focus)?.kind === 'rdp') { notify('A remote desktop tab has no split panes', 'info'); return; }
    if (t.panes.length >= MAX_PANES) { notify(`A tab holds up to ${MAX_PANES} panes`, 'info'); return; }
    sessions.split(dir, alias, noCommand);
  }, [notify, isRdp, connect]);

  // The key leaves memory; open sessions keep running under the lock screen (D-042).
  const lock = app.lock;

  const deleteHost = useCallback((alias: string) => setConfirm({
    title: `Delete host ${alias}?`,
    body: 'The host and its saved password are removed from the vault. Open sessions keep running.',
    action: 'Delete host',
    run: async () => { await api.hostRm(alias); await refreshCatalog(); setEditor(null); notify(`Deleted ${alias}`); },
  }), [refreshCatalog, notify]);

  const newGroup = useCallback((parent: string) => setAsk({
    title: parent ? `New group in ${parent}` : 'New group', label: 'Name', value: '', action: 'Create group',
    hint: 'Use / to nest, e.g. homelab/proxmox.',
    run: async (v) => { await api.groupAdd(parent ? parent + '/' + v : v); await refreshCatalog(); },
  }), [refreshCatalog]);

  const showView = useCallback((v: View) => {
    if (SIDE_VIEWS.includes(v) && view === v) { setSidebarCollapsed((c) => !c); return; }
    // Files is asked for explicitly, and Hosts ↔ Files swaps what the sidebar shows:
    // both open it. Coming back to Hosts from another view keeps it as it was left.
    if (v === 'files' || (SIDE_VIEWS.includes(v) && SIDE_VIEWS.includes(view))) setSidebarCollapsed(false);
    // Coming back to Hosts from another view keeps the sidebar as it was left.
    setView(v);
  }, [view, setSidebarCollapsed]);

  const cycleRegion = (dir: 1 | -1) => {
    const regions = ['.palette-btn', '.rail', '.sidebar', '.tabbar', '.toolbar', '.pane', '.statusbar']
      .map((s) => document.querySelector<HTMLElement>(s)).filter((el): el is HTMLElement => !!el && el.offsetParent !== null);
    const cur = regions.findIndex((r) => r.contains(document.activeElement));
    const next = regions[(cur + dir + regions.length) % regions.length];
    if (!next) return;
    if (next.classList.contains('pane')) { focusTerminal(tab?.id ?? null); return; }
    (next.matches('button') ? next : next.querySelector<HTMLElement>('[tabindex="0"], button:not([disabled]), input'))?.focus();
  };

  const run = useCallback((a: Action) => {
    const tabIdx = a.startsWith('tab') ? Number(a.slice(3)) - 1 : -1;
    if (tabIdx >= 0) {
      const t = sessions.get().tabs[tabIdx];
      if (t) { setView((v) => (SIDE_VIEWS.includes(v) ? v : 'hosts')); sessions.activate(t.id); }
      return;
    }
    switch (a) {
      case 'palette': setPalette({ hostsOnly: false }); break;
      case 'gotoHost': setPalette({ hostsOnly: true }); break;
      case 'newSession': setPalette({ hostsOnly: true, newSession: true }); break;
      case 'switchVault': setView('hosts'); setSidebarCollapsed(false); setSwitcher(true); break;
      case 'openVault': openVaultFile().catch(fail); break;
      case 'createVault': go('create'); break;
      // ⌘W closes the focused pane; the last one closes its tab.
      case 'closeTab': if (tab) sessions.close(tab.id); break;
      case 'reconnect': if (tab) sessions.reconnect(tab.id); break;
      case 'duplicate': if (tab) connect(tab.alias, true); break;
      case 'splitRight': split('right'); break;
      case 'splitDown': split('down'); break;
      case 'focusNextPane': sessions.cycleFocus(1); break;
      case 'focusPrevPane': sessions.cycleFocus(-1); break;
      case 'layout1': case 'layout2': case 'layout3': case 'layout4': sessions.setLayout(LAYOUTS[Number(a.slice(6)) - 1]); break;
      case 'toggleSidebar': if (SIDE_VIEWS.includes(view)) setSidebarCollapsed((c) => !c); else { setView('hosts'); setSidebarCollapsed(false); } break;
      // The Files view follows the active tab (⌘E, the toolbar's Files button).
      case 'viewFiles':
        if (view === 'files' && !collapsed) setSidebarCollapsed(true);
        else { setView('files'); setSidebarCollapsed(false); setTimeout(() => document.querySelector<HTMLElement>('[data-files-list]')?.focus(), 0); }
        break;
      // Like the rail button: the sidebar stays as it was left (⌘B shows or hides it).
      case 'viewHosts': setView('hosts'); if (!collapsed) setTimeout(() => filterRef.current?.focus(), 0); break;
      case 'viewTunnels':
        if (view === 'tunnels' && !collapsed) setSidebarCollapsed(true);
        else { setView('tunnels'); setSidebarCollapsed(false); setTimeout(() => document.querySelector<HTMLElement>('[data-tunnels-filter]')?.focus(), 0); }
        break;
      case 'collapseAll': setView('hosts'); setSidebarCollapsed(false); setCollapsedGroups(new Set(catalog.groups.map((g) => g.path))); break;
      case 'expandAll': setView('hosts'); setSidebarCollapsed(false); setCollapsedGroups(new Set()); break;
      case 'viewKeys': setView('keys'); break;
      case 'viewCredentials': setView('credentials'); break;
      case 'settings': setView('settings'); break;
      case 'newHost':
        if (view === 'keys') setAddingKey(true);
        else if (view === 'credentials') setCredEditing(null);
        else setEditor({ alias: null, group: catalog.hosts.find((h) => h.alias === selected)?.group ?? '' });
        break;
      case 'newSshHost': case 'newRdpHost':
        setView((v) => (SIDE_VIEWS.includes(v) ? v : 'hosts'));
        setEditor({ alias: null, group: catalog.hosts.find((h) => h.alias === selected)?.group ?? '', type: a === 'newRdpHost' ? 'rdp' : 'ssh' });
        break;
      case 'editHost': {
        const alias = view === 'hosts' && tab && document.activeElement?.closest('.pane') ? tab.alias : selected ?? tab?.alias;
        if (alias) setEditor({ alias, group: '' });
        break;
      }
      case 'lock': lock().catch(fail); break;
      case 'quit': api.quit().catch(fail); break;
      case 'fontBigger': setZoom((z) => z + 1); break;
      case 'fontSmaller': setZoom((z) => z - 1); break;
      case 'fontReset': setZoom(0); break;
      case 'nextRegion': cycleRegion(1); break;
      case 'prevRegion': cycleRegion(-1); break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tab, view, collapsed, selected, catalog.hosts, catalog.groups, connect, split, lock, openVaultFile, fail, go, setSidebarCollapsed, setCollapsedGroups]);

  useEffect(() => {
    setActionHandler(run);
    const onKey = (e: KeyboardEvent) => {
      // Under the lock screen the window takes no shortcut.
      if (e.defaultPrevented || phase !== 'main') return;
      const a = actionFor(e, os);
      if (!a) return;
      // While a dialog is open only its own keys apply, plus the palette toggle.
      const modal = document.querySelector('.modal, .drawer');
      if (modal && a !== 'palette') return;
      e.preventDefault();
      run(a);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); setActionHandler(null); };
  }, [run, os, phase]);

  const anyOverlay = palette || editor || confirm || ask || manage;
  const sessionsOpen = panes.filter((t) => t.status !== 'ended').length;
  const crumb = tab ? <><span>{vault?.name}</span><span className="faint">/</span><span className="mono muted">{tab.alias}</span></> : <span>{vault?.name}</span>;
  const railBtn = (v: View, icon: 'hosts' | 'files' | 'tunnel' | 'key' | 'cred' | 'settings', label: string, action: Action, badge?: React.ReactNode) => (
    <button className={'rail-btn' + (view === v ? (SIDE_VIEWS.includes(v) && collapsed ? ' is-collapsed is-on' : ' is-on') : '')} data-item={v}
      aria-pressed={view === v} title={`${label} (${chordLabel(action, os)})`} onClick={() => showView(v)}>
      <Icon name={icon} />{label}{badge}
    </button>
  );

  return (
    <div className="chrome" style={{ position: 'absolute', inset: 0 }}>
      <header className="titlebar">
        <div className="tb-brand"><Logo />Flint</div>
        <div className="tb-title">{crumb}</div>
        <button className="palette-btn" aria-label={`Command palette (${chordLabel('palette', os)})`} onClick={() => setPalette({ hostsOnly: false })}>
          <Icon name="search" size="sm" /><span className="grow" style={{ textAlign: 'left' }}>Hosts, actions, vaults…</span><Kbd action="palette" />
        </button>
      </header>

      <nav className="rail" aria-label="Activity bar" onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const btns = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.rail-btn')];
        const i = btns.indexOf(document.activeElement as HTMLElement);
        btns[(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]?.focus();
      }}>
        {railBtn('hosts', 'hosts', 'Hosts', 'viewHosts')}
        {railBtn('files', 'files', 'Files', 'viewFiles')}
        {railBtn('tunnels', 'tunnel', 'Tunnels', 'viewTunnels', tunnelsUp > 0
          ? <span className="rail-badge tun-count" aria-label={`${tunnelsUp} tunnel${tunnelsUp === 1 ? '' : 's'} running`} data-tunnels-badge>{tunnelsUp}</span> : null)}
        <span className="rail-sep" role="separator" />
        {railBtn('keys', 'key', 'Keys', 'viewKeys')}
        {railBtn('credentials', 'cred', 'Credentials', 'viewCredentials')}
        <span className="rail-spacer" />
        {railBtn('settings', 'settings', 'Settings', 'settings')}
      </nav>

      {showSidebar && narrow && <div style={{ position: 'absolute', inset: 'var(--titlebar-h) 0 var(--statusbar-h) var(--rail-w)', zIndex: 4 }} onMouseDown={() => setCollapsed(true)} />}
      {showSidebar && view === 'files' && (
        <div onKeyDown={(e) => { if (narrow && e.key === 'Escape') setCollapsed(true); }}>
          <FilesView tab={tab} onReconnect={(id) => sessions.reconnect(id)} onGoToHost={() => setPalette({ hostsOnly: true })} onConfirm={setConfirm} onAsk={setAsk}
            onEditHost={(alias) => setEditor({ alias, group: '' })}
            resizer={narrow ? null : <SidebarResizer width={filesWidth} min={FILES_MIN} max={FILES_MAX} reset={FILES_DEFAULT} clamp={clampFiles} label="Resize the Files sidebar"
              onLive={(w) => document.documentElement.style.setProperty('--sidebar-files-w', w + 'px')} onDone={(w) => updateUi({ files_width: w })} />} />
        </div>
      )}
      {showSidebar && view === 'tunnels' && (
        <div onKeyDown={(e) => { if (narrow && e.key === 'Escape') setCollapsed(true); }}>
          <TunnelsView onEditHost={(alias) => setEditor({ alias, group: '', tunnels: true })} onConnect={(alias) => connect(alias, true)}
            onPickHost={() => setPalette({ hostsOnly: true, editHost: true })}
            resizer={narrow ? null : <SidebarResizer width={sidebarWidth} min={SIDEBAR_MIN} max={SIDEBAR_MAX} reset={SIDEBAR_DEFAULT} clamp={clampSidebar} label="Resize the Tunnels sidebar" onLive={(w) => document.documentElement.style.setProperty('--sidebar-w', w + 'px')} onDone={(w) => updateUi({ sidebar_width: w })} />} />
        </div>
      )}
      {showSidebar && view === 'hosts' && (
        <div onKeyDown={(e) => { if (narrow && e.key === 'Escape') setCollapsed(true); }}>
          <HostTree selected={selected} filterRef={filterRef} collapsed={collapsedGroups} setCollapsed={setCollapsedGroups}
            resizer={narrow ? null : <SidebarResizer width={sidebarWidth} min={SIDEBAR_MIN} max={SIDEBAR_MAX} reset={SIDEBAR_DEFAULT} clamp={clampSidebar} label="Resize the sidebar" onLive={(w) => document.documentElement.style.setProperty('--sidebar-w', w + 'px')} onDone={(w) => updateUi({ sidebar_width: w })} />}
            h={{
            connect, select: setSelected,
            editHost: (alias) => setEditor({ alias, group: '' }),
            newHost: (group) => setEditor({ alias: null, group }),
            deleteHost,
            newGroup,
            renameGroup: (path) => setAsk({
              title: `Rename ${path}`, label: 'New name', value: path.split('/').pop() ?? '', action: 'Rename',
              run: async (v) => {
                const g = await api.groupRename(path, v);
                // Keep the renamed group, and the groups under it, collapsed.
                if ([...collapsedGroups].some((c) => c === path || c.startsWith(path + '/'))) {
                  setCollapsedGroups(new Set([...collapsedGroups].map((c) => (c === path ? g.path : c.startsWith(path + '/') ? g.path + c.slice(path.length) : c))));
                }
                await refreshCatalog();
              },
            }),
            deleteGroup: (path) => setConfirm({
              title: `Delete group ${path}?`, body: 'Only an empty group can be deleted; move or delete its hosts first.', action: 'Delete group',
              run: async () => { await api.groupRm(path); await refreshCatalog(); },
            }),
            openSwitcher: () => setSwitcher(true),
          }} />
          {switcher && <VaultMenu onClose={() => setSwitcher(false)} onManage={() => setManage(true)} style={{ left: 'calc(var(--rail-w) + 8px)', top: 'calc(var(--titlebar-h) + 56px)' }} />}
        </div>
      )}

      <SessionArea shown={sideView} filesOn={view === 'files' && !collapsed} onFiles={() => run('viewFiles')} fontSize={fontSize} onPalette={(h) => setPalette(h ? { hostsOnly: true, newSession: true } : { hostsOnly: false })} onEditHost={(alias) => setEditor({ alias, group: '' })} onManageTunnels={(alias) => setEditor({ alias, group: '', tunnels: true })} onConnect={connect} onKnownHosts={() => { setSection('vault'); setView('settings'); }} />
      {view === 'keys' && <KeysPage adding={addingKey} setAdding={setAddingKey} onConfirm={setConfirm} />}
      {view === 'credentials' && <CredentialsPage editing={credEditing} setEditing={setCredEditing} onConfirm={setConfirm} />}
      {view === 'settings' && <SettingsPage section={section} setSection={setSection} onLock={() => lock().catch(fail)} onConfirm={setConfirm} />}

      <footer className="statusbar">
        <span className="sb-item"><Icon name="unlock" />Unlocked{vault?.cached ? (os === 'mac' ? ' · Keychain' : ' · Keyring') : ''}</span>
        <button className="sb-btn" onClick={() => lock().catch(fail)}>Lock<Kbd action="lock" /></button>
        <span className="sb-item">{sessionsOpen === 0 ? 'No sessions' : `${sessionsOpen} session${sessionsOpen === 1 ? '' : 's'}`}</span>
        {tab && <span className="sb-item mono">{tab.alias}</span>}
        {tunnelsUp > 0 && (
          <button className="sb-btn" data-tunnels-status onClick={() => run('viewTunnels')}>
            <Icon name="tunnel" />{tunnelsUp} tunnel{tunnelsUp === 1 ? '' : 's'} up
          </button>
        )}
        {(grantCount > 0 || (waiting > 0 && !focused)) && (
          <button className="sb-btn sb-agents" data-grants onClick={() => { setSection('access'); setView('settings'); }}
            aria-label={`Agents: ${grantCount} active grant${grantCount === 1 ? '' : 's'}${waiting > 0 && !focused ? `, ${waiting} waiting` : ''}. Open Settings, Access`}>
            <Icon name="agent" />Agents: {grantCount}
            {waiting > 0 && !focused && <span className="sb-pending" data-agents-waiting>{waiting} waiting</span>}
          </button>
        )}
        <span className="grow" />
        {zoom !== 0 && <button className="sb-btn" onClick={() => setZoom(0)} title="Reset terminal font size">{fontSize} px</button>}
        <span className="sb-item"><Kbd action="palette" />Commands</span>
      </footer>

      {palette && (
        <CommandPalette hostsOnly={palette.hostsOnly} newSession={!!palette.newSession} pickToEdit={!!palette.editHost} onClose={() => setPalette(null)} onConnect={connect}
          onConnectWithTunnels={(alias) => { withTunnels.current = true; connect(alias, true); }}
          onManageTunnels={(alias) => setEditor({ alias, group: '', tunnels: true })}
          onSplit={(alias, noCommand) => split('right', alias, noCommand)}
          onEdit={(alias) => setEditor({ alias, group: '' })} onAction={(a) => setTimeout(() => run(a), 0)} />
      )}
      {editor && editor.alias === null && !editor.type && (
        <HostTypeStep group={editor.group} onClose={() => setEditor(null)} onPick={(type) => setEditor({ ...editor, type })} />
      )}
      {editor && (editor.alias !== null || editor.type) && (
        <HostEditor alias={editor.alias} group={editor.group} type={editor.type} showTunnels={!!editor.tunnels} onClose={() => setEditor(null)} onDelete={deleteHost}
          onNewCredential={() => { setEditor(null); setView('credentials'); setCredEditing(null); }} />
      )}
      {manage && <ManageVaults onClose={() => setManage(false)} />}
      {approval && access.state && (
        <ApprovalDialog key={approval.id} ap={approval} queue={access.state.pending} presence={access.state.presence} catalog={catalog} skew={access.skew}
          onDone={(s) => (s ? access.setState(s) : access.refresh())} />
      )}
      {confirm && <ConfirmDialog c={confirm} onClose={() => setConfirm(null)} />}
      {ask && <TextDialog ask={ask} onClose={() => setAsk(null)} />}
      {!anyOverlay && catalog.hosts.length === 0 && view === 'hosts' && tabs.length === 0 && (
        <EmptyVault onNewHost={() => setEditor({ alias: null, group: '' })} onAddKey={() => { setView('keys'); setAddingKey(true); }} onCreds={() => setView('credentials')} />
      )}
    </div>
  );
}

// The sidebar's right edge: drag to resize (Hosts 200-400 px, Files 200-480 px),
// double-click for the default width, or focus it and use ← →. The width applies
// live; it is stored when the drag ends.
function SidebarResizer({ width, min, max, reset, clamp, label, onLive, onDone }: {
  width: number; min: number; max: number; reset: number; clamp: (w: number) => number; label: string;
  onLive: (w: number) => void; onDone: (w: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className={'sidebar-resize' + (dragging ? ' is-hover' : '')} role="separator" aria-orientation="vertical" aria-label={label}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} tabIndex={0} title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        setDragging(true);
        const left = (el.parentElement?.getBoundingClientRect().left ?? 0);
        let last = width;
        const move = (ev: PointerEvent) => { last = clamp(ev.clientX - left); onLive(last); };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          setDragging(false);
          if (last !== width) onDone(last);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
      onDoubleClick={() => { onLive(reset); onDone(reset); }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const w = clamp(width + (e.key === 'ArrowRight' ? 16 : -16));
        onLive(w);
        onDone(w);
      }} />
  );
}

function EmptyVault({ onNewHost, onAddKey, onCreds }: { onNewHost: () => void; onAddKey: () => void; onCreds: () => void }) {
  return (
    <section className="main page" aria-label="Get started" style={{ alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
      <div className="empty" style={{ width: 480, gap: 'var(--sp-4)' }}>
        <span className="empty-ic"><Icon name="hosts" size="lg" /></span>
        <h2>Add your first host</h2>
        <p style={{ fontSize: 'var(--fs-md)', lineHeight: 1.6 }}>Group hosts in folders. Connect with a saved credential, a key from this vault, a password, or your SSH agent.</p>
        <div className="row" style={{ gap: 'var(--sp-2)', paddingTop: 'var(--sp-2)' }}>
          <button className="btn btn-primary btn-lg" onClick={onNewHost} autoFocus><Icon name="plus" size="sm" />New host<Kbd action="newHost" inline /></button>
          <button className="btn btn-secondary btn-lg" onClick={onAddKey}><Icon name="key" size="sm" />Add an SSH key<Kbd action="viewKeys" inline /></button>
        </div>
        <div className="panel col" style={{ width: '100%', marginTop: 'var(--sp-6)', padding: 'var(--sp-3) var(--sp-4)', gap: 'var(--sp-2)', textAlign: 'left' }}>
          <span className="label">Tips</span>
          <button className="row" style={{ fontSize: 'var(--fs-sm)', gap: 'var(--sp-2)' }} onClick={onCreds}><Icon name="cred" size="sm" /><span className="grow">Create a credential once, reuse it on every host</span><Kbd action="viewCredentials" /></button>
          <span className="row" style={{ fontSize: 'var(--fs-sm)', gap: 'var(--sp-2)' }}><Icon name="term" size="sm" /><span className="grow">From the CLI: <span className="mono muted">flint host add web --hostname 10.0.4.21</span></span></span>
        </div>
      </div>
    </section>
  );
}
