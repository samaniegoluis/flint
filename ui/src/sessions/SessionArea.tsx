// The main area while the Hosts view is on: tabs, the session toolbar and one
// terminal per tab. With no tab open it shows the "No open sessions" start page.

import { useMemo, useRef } from 'react';
import { useApp } from '../state/app';
import { chordLabel } from '../lib/keymap';
import { colorStyle } from '../lib/colors';
import { Icon, Logo } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { sessions, statusLabel, useSessions } from './store';
import { TerminalView } from './TerminalView';
import { SessionCard } from './SessionCards';

export function SessionArea({ fontSize, onPalette, onEditHost, onConnect }: {
  fontSize: number;
  onPalette: (hostsOnly: boolean) => void;
  onEditHost: (alias: string) => void;
  onConnect: (alias: string, newTab: boolean) => void;
}) {
  const { os, catalog } = useApp();
  const { tabs, active } = useSessions();
  const tablist = useRef<HTMLDivElement>(null);
  const tab = tabs.find((t) => t.id === active);
  const host = catalog.hosts.find((h) => h.alias === tab?.alias);

  const firstHosts = useMemo(() => [...catalog.hosts].sort((a, b) => a.alias.localeCompare(b.alias)).slice(0, 6), [catalog.hosts]);

  if (tabs.length === 0) {
    return (
      <section className="main" aria-label="No open sessions" style={{ alignItems: 'center', justifyContent: 'center', background: 'var(--surface-base)' }}>
        <div className="col" style={{ width: 520, gap: 'var(--sp-5)' }}>
          <div className="col" style={{ alignItems: 'center', gap: 'var(--sp-2)', textAlign: 'center' }}>
            <Logo size={32} />
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
    <section className="main" aria-label="Sessions">
      <div className="tabbar" role="tablist" aria-label="Open sessions" ref={tablist} onKeyDown={onTabKey}>
        {tabs.map((t, i) => {
          const st = statusLabel(t);
          const on = t.id === active;
          return (
            <button key={t.id} className={'tab' + (on ? ' on' : '')} role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
              onClick={() => sessions.activate(t.id)}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); sessions.close(t.id); } }}>
              <span className={'st ' + st.dot} role="img" aria-label={t.status} />
              {t.alias}
              {st.meta && <span className={'tab-meta ' + st.metaClass}>{st.meta}</span>}
              {on ? (
                <span className="tx" role="button" aria-label={`Close tab (${chordLabel('closeTab', os)})`} onClick={(e) => { e.stopPropagation(); sessions.close(t.id); }}><Icon name="x" size="xs" /></span>
              ) : (i < 9 && <span className="kbd">{chordLabel(('tab' + (i + 1)) as 'tab1', os)}</span>)}
            </button>
          );
        })}
        <button className="tab-add" aria-label={`New session (${chordLabel('newSession', os)})`} onClick={() => onPalette(true)}><Icon name="plus" size="sm" /><Kbd action="newSession" /></button>
      </div>
      {tab && s && (
        <div className="toolbar">
          <span className={'st ' + s.dot} role="img" aria-label={tab.status} />
          <span className="mono strong">{tab.alias}</span>
          {host?.user && <><span className="dotsep">·</span><span className="mono">{host.user}</span></>}
          {!ready && s.meta && <><span className="dotsep">·</span><span className={s.metaClass}>{s.meta}</span></>}
          {host && <span className="mono faint trunc" style={{ marginLeft: 'var(--sp-2)' }}>{host.hostname}:{host.port}{host.jump ? ` via ${host.jump}` : ''}</span>}
          <span className="grow" />
          <button className="tbtn" onClick={() => sessions.reconnect(tab.id)}><Icon name="reconnect" size="sm" />Reconnect<Kbd action="reconnect" /></button>
          <button className="tbtn" onClick={() => onConnect(tab.alias, true)}><Icon name="dup" size="sm" />Duplicate<Kbd action="duplicate" /></button>
          <span className="sep" />
          <button className="tbtn is-disabled" aria-disabled="true" title="Files (SFTP) — coming soon"><Icon name="files" size="sm" />Files</button>
          <button className="tbtn is-disabled" aria-disabled="true" title="Split — coming soon"><Icon name="split" size="sm" />Split</button>
        </div>
      )}
      <div className="pane">
        {tabs.map((t) => (
          <div key={t.id} style={{ position: 'absolute', inset: 0, display: t.id === active ? 'block' : 'none' }} role="region" aria-label={`Terminal — ${t.alias}`}>
            <TerminalView tabId={t.id} active={t.id === active} focus={t.id === active && t.status === 'ready'} fontSize={fontSize} />
            <SessionCard tab={t} active={t.id === active} onEditHost={onEditHost} />
          </div>
        ))}
      </div>
    </section>
  );
}
