// A tab's context menu (milestone 37, design 22b4a): Full screen for an RDP tab, then
// what the toolbar already offers. Opened by a right click on the tab.

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { chordLabel, type Action } from '../lib/keymap';
import { sessions, type Pane, type Tab } from './store';

interface Item {
  key: string;
  label: string;
  chord?: Action;
  sep?: boolean;
  run: () => void;
}

export function TabMenu({ tab, pane, x, y, onClose, onEditHost, onFullScreen }: {
  tab: Tab;
  pane: Pane;
  x: number;
  y: number;
  onClose: () => void;
  onEditHost: () => void;
  onFullScreen: () => void;
}) {
  const { os } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const rdp = pane.kind === 'rdp';
  const ready = pane.status === 'ready';
  const items: Item[] = [
    ...(rdp && ready ? [{ key: 'fullscreen', label: 'Full screen', chord: 'fullscreen' as Action, run: onFullScreen }] : []),
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
          <button className={'mi' + (i === hot ? ' hot' : '')} role="menuitem" tabIndex={i === hot ? 0 : -1} data-tab-menu-item={it.key}
            onMouseEnter={() => setHot(i)} onClick={() => { onClose(); it.run(); }}>
            <span className="grow">{it.label}</span>
            {it.chord && <span className="kbd">{chordLabel(it.chord, os)}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
