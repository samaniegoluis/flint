// The main area while the Hosts view is on: tabs, the session toolbar and each tab's
// panes (one to four terminals, milestone 20). The toolbar, the tab's title and the
// Files view follow the focused pane. With no tab open it shows the "No open
// sessions" start page.

import { useMemo, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { chordLabel } from '../lib/keymap';
import { colorStyle } from '../lib/colors';
import { HostTypeIcon, Icon, Logo } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { MAX_PANES } from '../lib/layout';
import { sessions, statusLabel, useSessions } from './store';
import { SplitView } from './SplitView';
import { LayoutIcon, SplitMenu } from './SplitMenu';
import { TunnelMark, TunnelsButton } from '../tunnels/TunnelsMenu';
import { desktopScaleLabel, RdpView } from './RdpView';
import { GRAPHICS_MODES, graphicsChoiceLabel } from '../lib/rdpStats';
import { fullScreen, useFullScreen } from './fullscreen';
import { FullScreenBar } from './FullScreenBar';
import { TabMenu } from './TabMenu';

// Stays mounted while another view (Keys, Credentials, Settings) is shown, with
// `shown` false: unmounting it disposed every xterm.js terminal and its scrollback.
export function SessionArea({ shown, fontSize, onPalette, onEditHost, onManageTunnels, onConnect, onFiles, filesOn, onKnownHosts, fullScreenNoteSeen, onFullScreenNoteSeen }: {
  /** The first-time note of full screen was shown (design 22b2), and its setter. */
  fullScreenNoteSeen: boolean;
  onFullScreenNoteSeen: () => void;
  /** Settings → Known hosts (a changed RDP certificate, design 22d2). */
  onKnownHosts: () => void;
  shown: boolean;
  /** The toolbar's Files button (⌘E): opens or closes the Files view. */
  onFiles: () => void;
  filesOn: boolean;
  fontSize: number;
  onPalette: (hostsOnly: boolean) => void;
  onEditHost: (alias: string) => void;
  /** The host editor at its Tunnels section (the toolbar's Manage tunnels…). */
  onManageTunnels: (alias: string) => void;
  onConnect: (alias: string, newTab: boolean) => void;
}) {
  const { os, catalog } = useApp();
  const { tabs, panes, active } = useSessions();
  const tablist = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  // The RDP statistics overlay (milestone 34), for every RDP tab while it is on.
  const [stats, setStats] = useState(false);
  // The tab's context menu (design 22b4a): the tab and where it was opened.
  const [tabMenu, setTabMenu] = useState<{ tab: string; x: number; y: number } | null>(null);
  const fs = useFullScreen();
  const paneArea = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find((t) => t.id === active);
  // The focused pane of the active tab: the toolbar speaks for it.
  const tab = panes.find((p) => p.id === activeTab?.focus);
  const host = catalog.hosts.find((h) => h.alias === tab?.alias);
  const paneCount = activeTab?.panes.length ?? 0;
  const paneNo = activeTab ? activeTab.panes.indexOf(activeTab.focus) + 1 : 0;

  const firstHosts = useMemo(() => [...catalog.hosts].sort((a, b) => a.alias.localeCompare(b.alias)).slice(0, 6), [catalog.hosts]);

  if (tabs.length === 0) {
    return (
      <section className="main" aria-label="No open sessions" hidden={!shown} style={{ alignItems: 'center', justifyContent: 'center', background: 'var(--surface-base)' }}>
        <div className="col" style={{ width: 520, gap: 'var(--sp-5)' }}>
          <div className="col" style={{ alignItems: 'center', gap: 'var(--sp-3)', textAlign: 'center' }}>
            <Logo size={64} />
            <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)' }}>No open sessions</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Pick a host from the sidebar, or jump straight to one.</p>
          </div>
          <button className="row" aria-label={`Open command palette (${chordLabel('palette', os)})`} onClick={() => onPalette(false)}
            style={{ height: 48, padding: '0 var(--sp-3) 0 var(--sp-4)', gap: 'var(--sp-3)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)', color: 'var(--text-tertiary)', fontSize: 'var(--fs-lg)' }}>
            <Icon name="search" /><span className="grow">Search hosts, actions, vaults…</span><Kbd action="palette" />
          </button>
          {firstHosts.length > 0 && (
            <div className="col" style={{ gap: 2 }}>
              <div className="menu-label"><span className="label">Hosts</span><span className="hint">click to connect</span></div>
              {firstHosts.map((h) => {
                const c = colorStyle(h.color);
                return (
                  <button key={h.alias} className="mi" style={{ minHeight: 38 }} onClick={() => onConnect(h.alias, false)}>
                    <span className={'hmark ' + c.className} style={c.style} />
                    <HostTypeIcon type={h.type} size="md" />
                    <span className="mono" style={{ width: 150 }}>{h.alias}</span>
                    <span className="grow faint trunc" style={{ fontSize: 'var(--fs-xs)' }}>{h.group ? h.group.split('/').join(' / ') : h.hostname}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="row faint" style={{ justifyContent: 'center', gap: 'var(--sp-5)', fontSize: 'var(--fs-xs)' }}>
            <span className="row" style={{ gap: 6 }}><Kbd action="gotoHost" />go to host</span>
            <span className="row" style={{ gap: 6 }}><Kbd action="newHost" />new host</span>
            <span className="row" style={{ gap: 6 }}><Kbd action="switchVault" />switch vault</span>
          </div>
        </div>
      </section>
    );
  }

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    if (next >= 0) {
      e.preventDefault();
      sessions.activate(tabs[next].id);
      tablist.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
    }
  };

  const s = tab ? statusLabel(tab) : null;
  const ready = tab?.status === 'ready';
  return (
    <section className="main" aria-label="Sessions" hidden={!shown}>
      <div className="tabbar" role="tablist" aria-label="Open sessions" ref={tablist} onKeyDown={onTabKey}>
        {tabs.map((t, i) => {
          // A tab is titled by its focused pane; a prompt in another pane shows too.
          const fp = panes.find((p) => p.id === t.focus);
          if (!fp) return null;
          const waiting = panes.find((p) => p.tab === t.id && p.id !== t.focus && p.status === 'prompt');
          const st = waiting && fp.status === 'ready' ? statusLabel(waiting) : statusLabel(fp);
          const on = t.id === active;
          const n = t.panes.length;
          return (
            <button key={t.id} className={'tab' + (on ? ' on' : '')} role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
              aria-label={n > 1 ? `${fp.alias}, ${n} panes` : undefined}
              onClick={() => sessions.activate(t.id)}
              onContextMenu={(e) => { e.preventDefault(); sessions.activate(t.id); setTabMenu({ tab: t.id, x: e.clientX, y: e.clientY }); }}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); sessions.closeTab(t.id); } }}>
              <span className={'st ' + st.dot} role="img" aria-label={fp.status} />
              <HostTypeIcon type={fp.kind} />
              {fp.alias}
              <TunnelMark host={fp.alias} />
              {n > 1 && <span className="tab-split" title={`${n} panes`}><LayoutIcon layout={t.layout} small />{n}</span>}
              {st.meta && <span className={'tab-meta ' + st.metaClass}>{st.meta}</span>}
              {on ? (
                <span className="tx" role="button" aria-label={n > 1 ? 'Close tab and its panes' : `Close tab (${chordLabel('closeTab', os)})`} onClick={(e) => { e.stopPropagation(); sessions.closeTab(t.id); }}><Icon name="x" size="xs" /></span>
              ) : (i < 9 && <span className="kbd">{chordLabel(('tab' + (i + 1)) as 'tab1', os)}</span>)}
            </button>
          );
        })}
        <button className="tab-add" aria-label={`New session (${chordLabel('newSession', os)})`} onClick={() => onPalette(true)}><Icon name="plus" size="sm" /><Kbd action="newSession" /></button>
      </div>
      {tab && s && activeTab && tab.kind === 'rdp' && (
        <div className="toolbar" data-rdp-toolbar>
          <span className={'st ' + s.dot} role="img" aria-label={tab.status} />
          <span className="mono strong">{tab.alias}</span>
          {host?.user && <><span className="dotsep">·</span><span className="mono">{host.domain && !host.user.includes('\\') && !host.user.includes('@') ? `${host.domain}\\${host.user}` : host.user}</span></>}
          <span className="dotsep">·</span>
          {ready && tab.desktop
            ? <span className="mono" data-rdp-size>{tab.desktop.width} × {tab.desktop.height}</span>
            : <span className={s.metaClass || 'faint'}>{s.meta || 'not connected'}</span>}
          {ready && (() => {
            const r = paneArea.current?.getBoundingClientRect();
            const label = r ? desktopScaleLabel(tab, r.width, r.height) : '';
            return label ? <><span className="dotsep">·</span><span className="faint">{label}</span></> : null;
          })()}
          {host && <span className="mono faint trunc tb-host" style={{ marginLeft: 'var(--sp-2)' }}>{host.hostname}:{host.port}</span>}
          <span className="grow" />
          {ready && (
            <div className="seg sm" role="radiogroup" aria-label="Graphics for this tab" data-rdp-tab-graphics
              title={tab.graphicsNote || [graphicsChoiceLabel(tab.graphics, tab.desktop?.engine ?? '', tab.desktop?.rttMs ?? -1), 'Switching reconnects the desktop; your Windows session stays'].filter(Boolean).join('. ')}>
              {GRAPHICS_MODES.map((g) => (
                <button key={g.id} type="button" role="radio" aria-checked={tab.graphics === g.id} aria-pressed={tab.graphics === g.id} data-graphics={g.id}
                  disabled={tab.graphicsSwitching} onClick={() => sessions.setGraphics(tab.id, g.id)}>
                  {g.label}
                </button>
              ))}
            </div>
          )}
          {ready && tab.graphicsSwitching && <span className="faint" data-rdp-graphics-busy>Reconnecting…</span>}
          {ready && !tab.graphicsSwitching && tab.graphicsNote && <span className="warn-t trunc" data-rdp-graphics-note title={tab.graphicsNote}>Mode not changed</span>}
          {ready && <button className="tbtn" data-rdp-stats-toggle aria-pressed={stats} title="Show what the desktop costs: frames, bandwidth, codec"
            onClick={() => setStats((v) => !v)}><Icon name="info" size="sm" /><span className="tb-l">Stats</span></button>}
          {ready && <button className="tbtn" data-rdp-fullscreen title={`Full screen (${chordLabel('fullscreen', os)})`}
            onClick={() => fullScreen.enter(activeTab.id)}><Icon name="expand" size="sm" /><span className="tb-l">Full screen</span><Kbd action="fullscreen" /></button>}
          {ready
            ? <button className="tbtn" data-rdp-disconnect title="Disconnect" onClick={() => sessions.disconnect(tab.id)}><Icon name="x" size="sm" /><span className="tb-l">Disconnect</span></button>
            : <button className="tbtn" title="Close tab" onClick={() => sessions.closeTab(activeTab.id)}><Icon name="x" size="sm" /><span className="tb-l">Close tab</span></button>}
        </div>
      )}
      {tab && s && activeTab && tab.kind !== 'rdp' && (
        <div className="toolbar">
          <span className={'st ' + s.dot} role="img" aria-label={tab.status} />
          <span className="mono strong">{tab.alias}</span>
          {host?.user && <><span className="dotsep">·</span><span className="mono">{host.user}</span></>}
          {!ready && s.meta && <><span className="dotsep">·</span><span className={s.metaClass}>{s.meta}</span></>}
          {paneCount > 1 && <span className="badge accent" data-pane-badge style={{ marginLeft: 'var(--sp-2)' }}>pane {paneNo} of {paneCount}</span>}
          {host && <span className="mono faint trunc tb-host" style={{ marginLeft: 'var(--sp-2)' }}>{host.hostname}:{host.port}{host.jump ? ` via ${host.jump}` : ''}</span>}
          <span className="grow" />
          <button className="tbtn" title={`Reconnect (${chordLabel('reconnect', os)})`} onClick={() => sessions.reconnect(tab.id)}><Icon name="reconnect" size="sm" /><span className="tb-l">Reconnect</span><Kbd action="reconnect" /></button>
          <button className="tbtn" title={`Duplicate (${chordLabel('duplicate', os)})`} onClick={() => onConnect(tab.alias, true)}><Icon name="dup" size="sm" /><span className="tb-l">Duplicate</span><Kbd action="duplicate" /></button>
          <span className="sep" />
          <button className={'tbtn' + (filesOn ? ' on' : '')} aria-pressed={filesOn} data-toolbar-files onClick={onFiles} title={`Files (${chordLabel('viewFiles', os)})`}><Icon name="files" size="sm" /><span className="tb-l">Files</span><Kbd action="viewFiles" /></button>
          <TunnelsButton host={tab.alias} onManage={onManageTunnels} />
          <span style={{ position: 'relative', display: 'flex' }}>
            <button className={'tbtn' + (menu ? ' on' : '')} data-split-button aria-haspopup="menu" aria-expanded={menu}
              title={paneCount >= MAX_PANES ? `Split · this tab has ${MAX_PANES} panes` : `Split (${chordLabel('splitRight', os)})`}
              onClick={() => setMenu((m) => !m)}><Icon name="split" size="sm" /><span className="tb-l">Split</span></button>
            {menu && <SplitMenu tab={activeTab} onClose={() => setMenu(false)} />}
          </span>
        </div>
      )}
      <div className="pane" ref={paneArea}>
        {tabs.map((t) => {
          const own = panes.filter((p) => p.tab === t.id);
          const rdp = own.length === 1 && own[0].kind === 'rdp' ? own[0] : null;
          return (
            <div key={t.id} style={{ position: 'absolute', inset: 0, display: t.id === active ? 'block' : 'none' }}>
              {rdp
                ? <RdpView pane={rdp} active={shown && t.id === active} showStats={stats} onEditHost={onEditHost} onKnownHosts={onKnownHosts} />
                : <SplitView tab={t} panes={own} shown={shown} active={t.id === active} fontSize={fontSize} onEditHost={onEditHost} />}
            </div>
          );
        })}
        {fs.tab && fs.tab === active && tab?.kind === 'rdp' && (
          <FullScreenBar key={fs.tab} pane={tab} top={fs.top} noteSeen={fullScreenNoteSeen} onNoteSeen={onFullScreenNoteSeen}
            onExit={() => fullScreen.leave()} onDisconnect={() => sessions.disconnect(tab.id)} />
        )}
      </div>
      {tabMenu && (() => {
        const t = tabs.find((x) => x.id === tabMenu.tab);
        const fp = t && panes.find((p) => p.id === t.focus);
        if (!t || !fp) return null;
        return <TabMenu tab={t} pane={fp} x={tabMenu.x} y={tabMenu.y} onClose={() => setTabMenu(null)}
          onEditHost={() => onEditHost(fp.alias)} onFullScreen={() => fullScreen.enter(t.id)} />;
      })()}
    </section>
  );
}
