// A tab's context menu (milestone 37, design 22b4a): Full screen for an RDP tab, then
// what the toolbar already offers. Opened by a right click on the tab.

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { chordLabel, type Action } from '../lib/keymap';
import { sessions, type Pane, type Tab } from './store';
import { useMonitors } from './monitors';
import { allMonitorsReason } from './MonitorsUi';

interface Item {
  key: string;
  label: string;
  chord?: Action;
  sep?: boolean;
  /** Greyed, with why (22f1c). */
  reason?: string;
  run: () => void;
}

export function TabMenu({ tab, pane, x, y, onClose, onEditHost, onFullScreen, onAllMonitors }: {
  tab: Tab;
  pane: Pane;
  x: number;
  y: number;
  onClose: () => void;
  onEditHost: () => void;
  onFullScreen: () => void;
  /** Milestone 38 (22f1b): greyed with its reason where it cannot. */
  onAllMonitors: () => void;
}) {
  const { os } = useApp();
  const monitorsView = useMonitors().view;
  const ref = useRef<HTMLDivElement>(null);
  const rdp = pane.kind === 'rdp';
  const ready = pane.status === 'ready';
  const items: Item[] = [
    ...(rdp && ready ? [{ key: 'fullscreen', label: 'Full screen', chord: 'fullscreen' as Action, run: onFullScreen }] : []),
    ...(rdp && ready ? [{ key: 'fullscreenAll', label: 'Full screen on all monitors', reason: allMonitorsReason(monitorsView), run: onAllMonitors }] : []),
    ...(!rdp ? [{ key: 'reconnect', label: 'Reconnect', chord: 'reconnect' as Action, run: () => sessions.reconnect(pane.id) }] : []),
    { key: 'edit', label: 'Edit host…', chord: 'editHost', run: onEditHost },
    ...(rdp && ready ? [{ key: 'disconnect', label: 'Disconnect', run: () => sessions.disconnect(pane.id) }] : []),
    { key: 'close', label: 'Close tab', chord: 'closeTab', sep: true, run: () => sessions.closeTab(tab.id) },
  ];
  const [hot, setHot] = useState(0);
  useEffect(() => { ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[hot]?.focus(); }, [hot]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div ref={ref} className="menu" role="menu" aria-label={`${pane.alias} tab`} data-tab-menu
      style={{ position: 'fixed', left: x, top: y, width: 250, zIndex: 30 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); setHot((hot + 1) % items.length); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setHot((hot - 1 + items.length) % items.length); }
      }}>
      {items.map((it, i) => (
        <div key={it.key} style={{ display: 'contents' }}>
          {it.sep && <div className="menu-sep" />}
          {it.reason ? (
            <button className={'mi is-disabled' + (i === hot ? ' hot' : '')} role="menuitem" aria-disabled="true" tabIndex={i === hot ? 0 : -1} data-tab-menu-item={it.key}
              data-reason={it.reason} onMouseEnter={() => setHot(i)}
              style={{ color: 'var(--text-disabled)', minHeight: 44, alignItems: 'flex-start', paddingTop: 6 }}>
              <span className="col grow" style={{ gap: 2 }}>
                <span>{it.label}</span>
                <span className="hint" style={{ color: 'var(--text-tertiary)', whiteSpace: 'normal', lineHeight: 1.4 }}>{it.reason}</span>
              </span>
            </button>
          ) : (
            <button className={'mi' + (i === hot ? ' hot' : '')} role="menuitem" tabIndex={i === hot ? 0 : -1} data-tab-menu-item={it.key}
              onMouseEnter={() => setHot(i)} onClick={() => { onClose(); it.run(); }}>
              <span className="grow">{it.label}</span>
              {it.chord && <span className="kbd">{chordLabel(it.chord, os)}</span>}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
