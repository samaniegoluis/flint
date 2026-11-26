// The main area while the Hosts view is on: tabs, the session toolbar and each tab's
// panes (one to four terminals, milestone 20). The toolbar, the tab's title and the
// Files view follow the focused pane. With no tab open it shows the "No open
// sessions" start page.

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { FullScreenSplit } from './MonitorsUi';
import { FullScreenBar } from './FullScreenBar';
import { TabMenu } from './TabMenu';
import { listenTyped, TypeMenuButton } from './RdpTypeMenu';
import { t } from '../i18n';
import { tr } from '../i18n/react';

// Stays mounted while another view (Keys, Credentials, Settings) is shown, with
// `shown` false: unmounting it disposed every xterm.js terminal and its scrollback.
export function SessionArea({ shown, fontSize, onPalette, onEditHost, onManageTunnels, onConnect, onFiles, filesOn, onKnownHosts, fullScreenNoteSeen, onFullScreenNoteSeen, monitorsNoteSeen, onMonitorsNoteSeen }: {
  monitorsNoteSeen: boolean;
  onMonitorsNoteSeen: () => void;
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
  const { os, catalog, notify } = useApp();
  const { tabs, panes, active } = useSessions();
  // A Type's outcome (milestone 58, design 25c3), whichever tab it went to.
  useEffect(() => listenTyped((text, kind) => { notify(text, kind); }), [notify]);
  const tablist = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  // Choose panes (the broadcast bar, milestone 73): the header toggles stand out.
  const [choosing, setChoosing] = useState(false);
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
      <section className="main" aria-label={t('session_area.no_open_sessions')} hidden={!shown} style={{ alignItems: 'center', justifyContent: 'center', background: 'var(--surface-base)' }}>
        <div className="col" style={{ width: 520, gap: 'var(--sp-5)' }}>
          <div className="col" style={{ alignItems: 'center', gap: 'var(--sp-3)', textAlign: 'center' }}>
            <Logo size={64} />
            <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)' }}>{t('session_area.no_open_sessions')}</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('session_area.pick_a_host_from_the')}</p>
          </div>
          <button className="row" aria-label={t('session_area.open_command_palette_chordlabel', { chordLabel: chordLabel('palette', os) })} onClick={() => onPalette(false)}
            style={{ height: 48, padding: '0 var(--sp-3) 0 var(--sp-4)', gap: 'var(--sp-3)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)', color: 'var(--text-tertiary)', fontSize: 'var(--fs-lg)' }}>
            <Icon name="search" /><span className="grow">{t('session_area.search_hosts_actions_vaults')}</span><Kbd action="palette" />
          </button>
          {firstHosts.length > 0 && (
            <div className="col" style={{ gap: 2 }}>
              <div className="menu-label"><span className="label">{t('session_area.hosts')}</span><span className="hint">{t('session_area.click_to_connect')}</span></div>
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
            <span className="row" style={{ gap: 6 }}><Kbd action="gotoHost" />{t('session_area.go_to_host')}</span>
            <span className="row" style={{ gap: 6 }}><Kbd action="newHost" />{t('session_area.new_host')}</span>
            <span className="row" style={{ gap: 6 }}><Kbd action="switchVault" />{t('session_area.switch_vault')}</span>
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
    <section className="main" aria-label={t('session_area.sessions')} hidden={!shown}>
      <div className="tabbar" role="tablist" aria-label={t('session_area.open_sessions')} ref={tablist} onKeyDown={onTabKey}>
        {tabs.map((tabItem, i) => {
          // A tab is titled by its focused pane; a prompt in another pane shows too.
          const focusedPane = panes.find((p) => p.id === tabItem.focus);
          if (!focusedPane) return null;
          // An empty pane names no host: the tab keeps its first connected pane's (28a1).
          const fp = focusedPane.status === 'empty' ? (panes.find((p) => p.tab === tabItem.id && p.status !== 'empty') ?? focusedPane) : focusedPane;
          const waiting = panes.find((p) => p.tab === tabItem.id && p.id !== tabItem.focus && p.status === 'prompt');
          const st = waiting && fp.status === 'ready' ? statusLabel(waiting) : statusLabel(fp);
          const on = tabItem.id === active;
          const n = tabItem.panes.length;
          return (
            <button key={tabItem.id} className={'tab' + (on ? ' on' : '')} role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
              aria-label={n > 1 ? t('session_area.alias_n_panes', { alias: fp.alias, n }) : undefined}
              onClick={() => sessions.activate(tabItem.id)}
              onContextMenu={(e) => { e.preventDefault(); sessions.activate(tabItem.id); setTabMenu({ tab: tabItem.id, x: e.clientX, y: e.clientY }); }}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); sessions.closeTab(tabItem.id); } }}>
              <span className={'st ' + st.dot} role="img" aria-label={t(`sessions.status_aria.${fp.status}`)} data-status={fp.status} />
              <HostTypeIcon type={fp.kind} />
              {fp.alias || t('split_view.empty_pane')}
              {fp.alias && <TunnelMark host={fp.alias} />}
              {tabItem.broadcast.length > 0 && <span className="tab-bc" data-tab-bc title={t('session_area.broadcast_is_on')}><Icon name="broadcast" /></span>}
              {n > 1 && <span className="tab-split" title={`${n} panes`}><LayoutIcon layout={tabItem.layout} small />{n}</span>}
              {st.meta && <span className={'tab-meta ' + st.metaClass}>{st.meta}</span>}
              {on ? (
                <span className="tx" role="button" aria-label={n > 1 ? t('session_area.close_tab_and_its_panes') : t('session_area.close_tab_chordlabel', { chordLabel: chordLabel('closeTab', os) })} onClick={(e) => { e.stopPropagation(); sessions.closeTab(tabItem.id); }}><Icon name="x" size="xs" /></span>
              ) : (i < 9 && <span className="kbd">{chordLabel(('tab' + (i + 1)) as 'tab1', os)}</span>)}
            </button>
          );
        })}
        <button className="tab-add" aria-label={t('session_area.new_session_chordlabel', { chordLabel: chordLabel('newSession', os) })} onClick={() => onPalette(true)}><Icon name="plus" size="sm" /><Kbd action="newSession" /></button>
      </div>
      {tab && s && activeTab && tab.kind === 'rdp' && (
        <div className="toolbar" data-rdp-toolbar>
          <span className={'st ' + s.dot} role="img" aria-label={t(`sessions.status_aria.${tab.status}`)} data-status={tab.status} />
          <span className="mono strong">{tab.alias}</span>
          {host?.user && <><span className="dotsep">·</span><span className="mono">{host.domain && !host.user.includes('\\') && !host.user.includes('@') ? `${host.domain}\\${host.user}` : host.user}</span></>}
          <span className="dotsep">·</span>
          {ready && tab.desktop
            ? <span className="mono" data-rdp-size>{tab.desktop.width} × {tab.desktop.height}</span>
            : <span className={s.metaClass || 'faint'}>{s.meta || t('session_area.not_connected')}</span>}
          {ready && (() => {
            const r = paneArea.current?.getBoundingClientRect();
            const label = r ? desktopScaleLabel(tab, r.width, r.height) : '';
            return label ? <><span className="dotsep">·</span><span className="faint">{label}</span></> : null;
          })()}
          {host && <span className="mono faint trunc tb-host" style={{ marginLeft: 'var(--sp-2)' }}>{host.hostname}:{host.port}</span>}
          <span className="grow" />
          {ready && (
            <div className="seg sm" role="radiogroup" aria-label={t('session_area.graphics_for_this_tab')} data-rdp-tab-graphics
              title={tab.graphicsNote || [graphicsChoiceLabel(tab.graphics, tab.desktop?.engine ?? '', tab.desktop?.rttMs ?? -1), t('session_area.switching_reconnects')].filter(Boolean).join(t('session_area.sentence_join'))}>
              {GRAPHICS_MODES.map((g) => (
                <button key={g.id} type="button" role="radio" aria-checked={tab.graphics === g.id} aria-pressed={tab.graphics === g.id} data-graphics={g.id}
                  disabled={tab.graphicsSwitching} onClick={() => sessions.setGraphics(tab.id, g.id)}>
                  {t(g.label)}
                </button>
              ))}
            </div>
          )}
          {ready && tab.graphicsSwitching && <span className="faint" data-rdp-graphics-busy>{t('session_area.reconnecting')}</span>}
          {ready && !tab.graphicsSwitching && tab.graphicsNote && <span className="warn-t trunc" data-rdp-graphics-note title={tab.graphicsNote}>{t('session_area.mode_not_changed')}</span>}
          {ready && <button className="tbtn" data-rdp-stats-toggle aria-pressed={stats} title={t('session_area.show_what_the_desktop_costs')}
            onClick={() => setStats((v) => !v)}><Icon name="info" size="sm" /><span className="tb-l">{t('session_area.stats')}</span></button>}
          {ready && tab.session && <TypeMenuButton session={tab.session} alias={tab.alias} />}
          {ready && <FullScreenSplit onFullScreen={() => fullScreen.enter(activeTab.id)}
            onAllMonitors={() => sessions.enterAllMonitors(activeTab.id, (t) => fullScreen.enter(t))} />}
          {ready
            ? <button className="tbtn" data-rdp-disconnect title={t('common.disconnect')} onClick={() => sessions.disconnect(tab.id)}><Icon name="x" size="sm" /><span className="tb-l">{t('common.disconnect')}</span></button>
            : <button className="tbtn" title={t('session_area.close_tab')} onClick={() => sessions.closeTab(activeTab.id)}><Icon name="x" size="sm" /><span className="tb-l">{t('session_area.close_tab')}</span></button>}
        </div>
      )}
      {tab && activeTab && tab.status === 'empty' && (
        <div className="toolbar" data-empty-toolbar>
          <span className="st st-off" role="img" aria-label={t('sessions.status_aria.empty')} data-status="empty" />
          <span className="faint">{t('session_area.pane_no_host_yet', { n: paneNo })}</span>
          {paneCount > 1 && <span className="badge accent" data-pane-badge style={{ marginLeft: 'var(--sp-2)' }}>{tr('session_area.pane_paneno_of_panecount', { paneNo, paneCount })}</span>}
          <span className="grow" />
          <span className="sep" />
          <span style={{ position: 'relative', display: 'flex' }}>
            <button className={'tbtn' + (menu ? ' on' : '')} data-split-button aria-haspopup="menu" aria-expanded={menu}
              title={paneCount >= MAX_PANES ? t('session_area.split_this_tab_has_max', { MAX_PANES }) : t('session_area.split_chordlabel', { chordLabel: chordLabel('splitRight', os) })}
              onClick={() => setMenu((m) => !m)}><Icon name="split" size="sm" /><span className="tb-l">{t('session_area.split')}</span></button>
            {menu && <SplitMenu tab={activeTab} onClose={() => setMenu(false)} />}
          </span>
        </div>
      )}
      {tab && s && activeTab && tab.kind !== 'rdp' && tab.status !== 'empty' && (
        <div className="toolbar">
          <span className={'st ' + s.dot} role="img" aria-label={t(`sessions.status_aria.${tab.status}`)} data-status={tab.status} />
          <span className="mono strong">{tab.alias}</span>
          {host?.user && <><span className="dotsep">·</span><span className="mono">{host.user}</span></>}
          {!ready && s.meta && <><span className="dotsep">·</span><span className={s.metaClass}>{s.meta}</span></>}
          {paneCount > 1 && <span className="badge accent" data-pane-badge style={{ marginLeft: 'var(--sp-2)' }}>{tr('session_area.pane_paneno_of_panecount', { paneNo, paneCount })}</span>}
          {host && <span className="mono faint trunc tb-host" style={{ marginLeft: 'var(--sp-2)' }}>{host.hostname}:{host.port}{host.jump ? ` via ${host.jump}` : ''}</span>}
          <span className="grow" />
          <button className="tbtn" title={t('session_area.reconnect_chordlabel', { chordLabel: chordLabel('reconnect', os) })} onClick={() => sessions.reconnect(tab.id)}><Icon name="reconnect" size="sm" /><span className="tb-l">{t('session_area.reconnect')}</span><Kbd action="reconnect" /></button>
          <button className="tbtn" title={t('session_area.duplicate_chordlabel', { chordLabel: chordLabel('duplicate', os) })} onClick={() => onConnect(tab.alias, true)}><Icon name="dup" size="sm" /><span className="tb-l">{t('session_area.duplicate')}</span><Kbd action="duplicate" /></button>
          <span className="sep" />
          <button className={'tbtn' + (filesOn ? ' on' : '')} aria-pressed={filesOn} data-toolbar-files onClick={onFiles} title={t('session_area.files_chordlabel', { chordLabel: chordLabel('viewFiles', os) })}><Icon name="files" size="sm" /><span className="tb-l">{t('session_area.files')}</span><Kbd action="viewFiles" /></button>
          <TunnelsButton host={tab.alias} onManage={onManageTunnels} />
          <span style={{ position: 'relative', display: 'flex' }}>
            <button className={'tbtn' + (menu ? ' on' : '')} data-split-button aria-haspopup="menu" aria-expanded={menu}
              title={paneCount >= MAX_PANES ? t('session_area.split_this_tab_has_max', { MAX_PANES }) : t('session_area.split_chordlabel', { chordLabel: chordLabel('splitRight', os) })}
              onClick={() => setMenu((m) => !m)}><Icon name="split" size="sm" /><span className="tb-l">{t('session_area.split')}</span></button>
            {menu && <SplitMenu tab={activeTab} onClose={() => setMenu(false)} />}
          </span>
        </div>
      )}
      {activeTab && activeTab.broadcast.length > 0 && (() => {
        // Typing into N panes (28b1), and the panes that dropped out of it (28b3).
        const into = activeTab.broadcast.map((id) => panes.find((p) => p.id === id)).filter((p) => !!p);
        const left = panes.filter((p) => p.tab === activeTab.id && p.leftBroadcast);
        // One pane chosen types into no other yet: the bar asks for the rest (owner, M73 check).
        const lone = into.length < 2;
        const picking = choosing || lone;
        return (
          <div className="bc-bar" role="status" aria-live="polite" data-bc-bar>
            <Icon name="broadcast" />
            <span className="strong" data-bc-count>{lone ? t('session_area.choose_the_panes') : t('session_area.typing_into_n_panes', { count: into.length })}</span>
            <span className="bc-hosts trunc">{into.map((p) => p.alias).join(' · ')}</span>
            {picking && <span className="hint" data-bc-choose-hint>{t('session_area.click_toggle_on_each_pane')}</span>}
            {left.map((p) => <span key={p.id} className="hint" data-bc-left-note>{t(p.status === 'ended' ? 'session_area.alias_left_broadcast' : 'session_area.alias_left', { alias: p.alias })}</span>)}
            <span className="grow" />
            {!lone && <button className="btn btn-ghost btn-sm" data-bc-choose aria-pressed={choosing} onClick={() => setChoosing((c) => !c)}>{choosing ? t('session_area.done') : t('session_area.choose_panes')}</button>}
            <button className="btn btn-bc btn-sm" data-bc-stop onClick={() => { setChoosing(false); sessions.stopBroadcast(activeTab.id); }}><Icon name="x" size="sm" />{t('session_area.stop')}</button>
          </div>
        );
      })()}
      <div className="pane" ref={paneArea}>
        {tabs.map((t) => {
          const own = panes.filter((p) => p.tab === t.id);
          const rdp = own.length === 1 && own[0].kind === 'rdp' ? own[0] : null;
          return (
            <div key={t.id} style={{ position: 'absolute', inset: 0, display: t.id === active ? 'block' : 'none' }}>
              {rdp
                ? <RdpView pane={rdp} active={shown && t.id === active} showStats={stats} onEditHost={onEditHost} onKnownHosts={onKnownHosts} />
                : <SplitView tab={t} panes={own} shown={shown} active={t.id === active} fontSize={fontSize} onEditHost={onEditHost}
                  choosing={t.id === active && t.broadcast.length > 0 && (choosing || t.broadcast.length < 2)} />}
            </div>
          );
        })}
        {fs.tab && fs.tab === active && tab?.kind === 'rdp' && (
          <FullScreenBar key={fs.tab} pane={tab} top={fs.top} noteSeen={fullScreenNoteSeen} onNoteSeen={onFullScreenNoteSeen}
            monitorsNoteSeen={monitorsNoteSeen} onMonitorsNoteSeen={onMonitorsNoteSeen}
            onSpan={(picks) => sessions.enterAllMonitors(fs.tab!, () => {}, picks)}
            onExit={() => fullScreen.leave()} onDisconnect={() => sessions.disconnect(tab.id)} />
        )}
      </div>
      {tabMenu && (() => {
        const t = tabs.find((x) => x.id === tabMenu.tab);
        const focusedPane = t && panes.find((p) => p.id === t.focus);
        const fp = focusedPane?.status === 'empty' ? (panes.find((p) => p.tab === t!.id && p.status !== 'empty') ?? focusedPane) : focusedPane;
        if (!t || !fp) return null;
        return <TabMenu tab={t} pane={fp} x={tabMenu.x} y={tabMenu.y} onClose={() => setTabMenu(null)}
          onEditHost={() => onEditHost(fp.alias)} onFullScreen={() => fullScreen.enter(t.id)}
          onAllMonitors={() => sessions.enterAllMonitors(t.id, (id) => fullScreen.enter(id))} />;
      })()}
    </section>
  );
}
