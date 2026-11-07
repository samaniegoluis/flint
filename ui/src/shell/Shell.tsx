// The main window once a vault is unlocked (design screen 04): title bar, activity
// bar, the Hosts sidebar, the main area (sessions, or a full-page view) and the
// status bar, plus every overlay. App shortcuts are handled here.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/backend';
import { useApp } from '../state/app';
import { actionFor, chordLabel, type Action } from '../lib/keymap';
import { Icon, Logo } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { ConfirmDialog, TextDialog, type TextAsk } from '../ui/Dialogs';
import { HostTree } from './HostTree';
import { ManageVaults, VaultMenu } from './VaultSwitcher';
import { setActionHandler } from './actions';
import { SessionArea } from '../sessions/SessionArea';
import { clampSidebar, SIDEBAR_DEFAULT, useUiState } from '../state/uiState';
import { sessions, useSessions } from '../sessions/store';
import { focusTerminal } from '../sessions/TerminalView';
import { HostEditor } from '../editors/HostEditor';
import { KeysPage, type Confirm } from '../pages/KeysPage';
import { CredentialsPage } from '../pages/CredentialsPage';
import { SettingsPage, type SettingsSection } from '../pages/SettingsPage';
import { CommandPalette } from '../palette/CommandPalette';
import { ApprovalDialog, useAccessState } from '../access/ApprovalDialog';

type View = 'hosts' | 'keys' | 'credentials' | 'settings';
const NARROW = 1040;

export function Shell() {
  const app = useApp();
  const { os, vault, catalog, settings, notify, fail, refreshCatalog, openVaultFile, go, phase } = app;
  const { tabs, active } = useSessions();
  const [view, setView] = useState<View>('hosts');
  const [narrow, setNarrow] = useState(window.innerWidth < NARROW);
  const [collapsed, setCollapsed] = useState(window.innerWidth < NARROW);
  const [selected, setSelected] = useState<string | null>(null);
  const [palette, setPalette] = useState<{ hostsOnly: boolean; newSession?: boolean } | null>(null);
  const [switcher, setSwitcher] = useState(false);
  const [manage, setManage] = useState(false);
  const [editor, setEditor] = useState<{ alias: string | null; group: string } | null>(null);
  const [addingKey, setAddingKey] = useState(false);
  const [credEditing, setCredEditing] = useState<string | null | undefined>(undefined);
  const [section, setSection] = useState<SettingsSection>('appearance');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [ask, setAsk] = useState<TextAsk | null>(null);
  const [zoom, setZoom] = useState(0);
  const filterRef = useRef<HTMLInputElement>(null);
  const prevStatus = useRef(new Map<string, string>());
  const { ui, update: updateUi } = useUiState(vault?.path ?? '');
  const access = useAccessState(phase === 'main');
  const approval = access.state?.pending[0] ?? null;
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
  const collapsedGroups = new Set(ui?.collapsed ?? []);
  const setCollapsedGroups = useCallback((next: Set<string>) => updateUi({ collapsed: [...next] }), [updateUi]);

  const fontSize = Math.max(8, Math.min(32, settings.term_font_size + zoom));
  const tab = tabs.find((t) => t.id === active);
  const showSidebar = view === 'hosts' && !collapsed;

  // The design's layout rules key off the root's data-view and data-collapsed: the
  // main area starts after the rail, plus the sidebar when it is docked.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.app');
    if (!root) return;
    root.dataset.view = view;
    root.dataset.collapsed = String(view === 'hosts' && (collapsed || narrow));
    return () => { delete root.dataset.view; delete root.dataset.collapsed; };
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

  // A prompt that opens in a background tab gets a toast naming the tab's shortcut.
  useEffect(() => {
    tabs.forEach((t, i) => {
      const before = prevStatus.current.get(t.id);
      if (t.status === 'prompt' && before !== 'prompt' && t.id !== active) {
        const chord = i < 9 ? ' ' + chordLabel(('tab' + (i + 1)) as Action, os) : '';
        notify(`${t.alias} needs your input${chord}`, 'info');
      }
      prevStatus.current.set(t.id, t.status);
    });
  }, [tabs, active, os, notify]);

  // `noCommand` (the palette's "without …" row) always opens its own tab.
  const connect = useCallback((alias: string, newTab: boolean, noCommand = false) => {
    setView('hosts');
    if (narrow) setCollapsed(true);
    const open = sessions.get().tabs.find((t) => t.alias === alias && t.status !== 'ended' && !t.noCommand);
    if (open && !newTab && !noCommand) sessions.activate(open.id);
    else sessions.open(alias, noCommand);
  }, [narrow]);

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
    if (v === 'hosts' && view === 'hosts') { setSidebarCollapsed((c) => !c); return; }
    // Coming back to Hosts from another view keeps the sidebar as it was left.
    setView(v);
  }, [view, setSidebarCollapsed]);

  const cycleRegion = (dir: 1 | -1) => {
    const regions = ['.palette-btn', '.rail', '.sidebar', '.tabbar', '.toolbar', '.pane', '.statusbar']
      .map((s) => document.querySelector<HTMLElement>(s)).filter((el): el is HTMLElement => !!el && el.offsetParent !== null);
    const cur = regions.findIndex((r) => r.contains(document.activeElement));
    const next = regions[(cur + dir + regions.length) % regions.length];
    if (!next) return;
    if (next.classList.contains('pane')) { focusTerminal(active); return; }
    (next.matches('button') ? next : next.querySelector<HTMLElement>('[tabindex="0"], button:not([disabled]), input'))?.focus();
  };

  const run = useCallback((a: Action) => {
    const tabIdx = a.startsWith('tab') ? Number(a.slice(3)) - 1 : -1;
    if (tabIdx >= 0) {
      const t = sessions.get().tabs[tabIdx];
      if (t) { setView('hosts'); sessions.activate(t.id); }
      return;
    }
    switch (a) {
      case 'palette': setPalette({ hostsOnly: false }); break;
      case 'gotoHost': setPalette({ hostsOnly: true }); break;
      case 'newSession': setPalette({ hostsOnly: true, newSession: true }); break;
      case 'switchVault': setView('hosts'); setSidebarCollapsed(false); setSwitcher(true); break;
      case 'openVault': openVaultFile().catch(fail); break;
      case 'createVault': go('create'); break;
      case 'closeTab': if (active) sessions.close(active); break;
      case 'reconnect': if (active) sessions.reconnect(active); break;
      case 'duplicate': if (tab) connect(tab.alias, true); break;
      case 'toggleSidebar': if (view === 'hosts') setSidebarCollapsed((c) => !c); else { setView('hosts'); setSidebarCollapsed(false); } break;
      // Like the rail button: the sidebar stays as it was left (⌘B shows or hides it).
      case 'viewHosts': setView('hosts'); if (!collapsed) setTimeout(() => filterRef.current?.focus(), 0); break;
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
      case 'editHost': {
        const alias = view === 'hosts' && tab && document.activeElement?.closest('.pane') ? tab.alias : selected ?? tab?.alias;
        if (alias) setEditor({ alias, group: '' });
        break;
      }
      case 'lock': lock().catch(fail); break;
      case 'fontBigger': setZoom((z) => z + 1); break;
      case 'fontSmaller': setZoom((z) => z - 1); break;
      case 'fontReset': setZoom(0); break;
      case 'nextRegion': cycleRegion(1); break;
      case 'prevRegion': cycleRegion(-1); break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tab, view, collapsed, selected, catalog.hosts, catalog.groups, connect, lock, openVaultFile, fail, go, setSidebarCollapsed, setCollapsedGroups]);

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
  const sessionsOpen = tabs.filter((t) => t.status !== 'ended').length;
  const crumb = tab ? <><span>{vault?.name}</span><span className="faint">/</span><span className="mono muted">{tab.alias}</span></> : <span>{vault?.name}</span>;
  const railBtn = (v: View, icon: 'hosts' | 'key' | 'cred' | 'settings', label: string, action: Action) => (
    <button className={'rail-btn' + (view === v ? (v === 'hosts' && collapsed ? ' is-collapsed is-on' : ' is-on') : '')} data-item={v}
      aria-pressed={view === v} title={`${label} (${chordLabel(action, os)})`} onClick={() => showView(v)}>
      <Icon name={icon} />{label}
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
        <button className="rail-btn is-disabled" aria-disabled="true" title="Files (SFTP) — coming soon" style={{ opacity: 0.45, cursor: 'not-allowed' }}><Icon name="files" />Files</button>
        <span className="rail-sep" role="separator" />
        {railBtn('keys', 'key', 'Keys', 'viewKeys')}
        {railBtn('credentials', 'cred', 'Credentials', 'viewCredentials')}
        <span className="rail-spacer" />
        {railBtn('settings', 'settings', 'Settings', 'settings')}
      </nav>

      {showSidebar && narrow && <div style={{ position: 'absolute', inset: 'var(--titlebar-h) 0 var(--statusbar-h) var(--rail-w)', zIndex: 4 }} onMouseDown={() => setCollapsed(true)} />}
      {showSidebar && (
        <div style={narrow ? { position: 'relative', zIndex: 5 } : undefined} onKeyDown={(e) => { if (narrow && e.key === 'Escape') setCollapsed(true); }}>
          <HostTree selected={selected} filterRef={filterRef} collapsed={collapsedGroups} setCollapsed={setCollapsedGroups}
            resizer={narrow ? null : <SidebarResizer width={sidebarWidth} onLive={(w) => document.documentElement.style.setProperty('--sidebar-w', w + 'px')} onDone={(w) => updateUi({ sidebar_width: w })} />}
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

      <SessionArea shown={view === 'hosts'} fontSize={fontSize} onPalette={(h) => setPalette(h ? { hostsOnly: true, newSession: true } : { hostsOnly: false })} onEditHost={(alias) => setEditor({ alias, group: '' })} onConnect={connect} />
      {view === 'keys' && <KeysPage adding={addingKey} setAdding={setAddingKey} onConfirm={setConfirm} />}
      {view === 'credentials' && <CredentialsPage editing={credEditing} setEditing={setCredEditing} onConfirm={setConfirm} />}
      {view === 'settings' && <SettingsPage section={section} setSection={setSection} onLock={() => lock().catch(fail)} onConfirm={setConfirm} />}

      <footer className="statusbar">
        <span className="sb-item"><Icon name="unlock" />Unlocked{vault?.cached ? (os === 'mac' ? ' · Keychain' : ' · Keyring') : ''}</span>
        <button className="sb-btn" onClick={() => lock().catch(fail)}>Lock<Kbd action="lock" /></button>
        <span className="sb-item">{sessionsOpen === 0 ? 'No sessions' : `${sessionsOpen} session${sessionsOpen === 1 ? '' : 's'}`}</span>
        {tab && <span className="sb-item mono">{tab.alias}</span>}
        {(access.state?.grants.length ?? 0) > 0 && (
          <button className="sb-btn" data-grants onClick={() => { setSection('access'); setView('settings'); }}>
            Agents: {access.state?.grants.length}
          </button>
        )}
        <span className="grow" />
        {zoom !== 0 && <button className="sb-btn" onClick={() => setZoom(0)} title="Reset terminal font size">{fontSize} px</button>}
        <span className="sb-item"><Kbd action="palette" />Commands</span>
      </footer>

      {palette && (
        <CommandPalette hostsOnly={palette.hostsOnly} newSession={!!palette.newSession} onClose={() => setPalette(null)} onConnect={connect}
          onEdit={(alias) => setEditor({ alias, group: '' })} onAction={(a) => setTimeout(() => run(a), 0)} />
      )}
      {editor && (
        <HostEditor alias={editor.alias} group={editor.group} onClose={() => setEditor(null)} onDelete={deleteHost}
          onNewCredential={() => { setEditor(null); setView('credentials'); setCredEditing(null); }} />
      )}
      {manage && <ManageVaults onClose={() => setManage(false)} />}
      {approval && access.state && (
        <ApprovalDialog key={approval.id} ap={approval} presence={access.state.presence} catalog={catalog}
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

// The sidebar's right edge: drag to resize (200-400 px), double-click for the default
// width, or focus it and use ← →. The width applies live; it is stored when the drag ends.
function SidebarResizer({ width, onLive, onDone }: { width: number; onLive: (w: number) => void; onDone: (w: number) => void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className={'sidebar-resize' + (dragging ? ' is-hover' : '')} role="separator" aria-orientation="vertical" aria-label="Resize the sidebar"
      aria-valuemin={200} aria-valuemax={400} aria-valuenow={width} tabIndex={0} title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        setDragging(true);
        const left = (el.parentElement?.getBoundingClientRect().left ?? 0);
        let last = width;
        const move = (ev: PointerEvent) => { last = clampSidebar(ev.clientX - left); onLive(last); };
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
      onDoubleClick={() => { onLive(SIDEBAR_DEFAULT); onDone(SIDEBAR_DEFAULT); }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const w = clampSidebar(width + (e.key === 'ArrowRight' ? 16 : -16));
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
