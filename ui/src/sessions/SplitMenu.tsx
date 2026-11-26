// The session toolbar's Split menu (design 18a1): split right or down, the four
// layouts, focus next pane and close pane. A split or a layout's new places open
// empty panes, each asking for its host (milestone 72). Arrow keys move, ↵ runs, esc closes.

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { chordLabel, type Action } from '../lib/keymap';
import { LAYOUTS, LAYOUT_TITLES, MAX_PANES, type Layout } from '../lib/layout';
import { runAction } from '../shell/actions';
import { sessions, type Tab } from './store';
import { Icon, type IconName } from '../ui/Icon';
import { t } from '../i18n';

// The layout's picture: the same grid, drawn small.
export function LayoutIcon({ layout, small }: { layout: Layout; small?: boolean }) {
  const size = small ? { width: 16, height: 11 } : {};
  switch (layout) {
    case 'cols': return <span className="layout-ic" style={{ gridTemplateColumns: '1fr 1fr', ...size }}><i /><i /></span>;
    case 'rows': return <span className="layout-ic" style={{ gridTemplateRows: '1fr 1fr', ...size }}><i /><i /></span>;
    case 'grid': return <span className="layout-ic" style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', ...size }}><i /><i /><i /><i /></span>;
    case 'large': return <span className="layout-ic" style={{ gridTemplateColumns: '2fr 1fr', gridTemplateRows: '1fr 1fr', ...size }}><i style={{ gridRow: 'span 2' }} /><i /><i /></span>;
  }
}

interface Item {
  key: string;
  label: string;
  action: Action;
  disabled?: string;
  layout?: Layout;
  icon?: IconName;
  sep?: boolean;
  heading?: string;
}

export function SplitMenu({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const { os } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const n = tab.panes.length;
  const full = n >= MAX_PANES ? t('split_menu.tab_holds_up_to', { max: MAX_PANES }) : undefined;
  const single = n < 2 ? t('split_menu.split_first') : undefined;
  // Milestone 73 (28b2): broadcast to every connected pane, or stop it.
  const up = tab.panes.filter((id) => sessions.canBroadcast(id)).length;
  const on = tab.broadcast.length > 0;
  const items: Item[] = [
    { key: 'right', label: t('split_menu.split_right'), action: 'splitRight', disabled: full, heading: t('split_menu.new_panes_pick_a_host') },
    { key: 'down', label: t('split_menu.split_down'), action: 'splitDown', disabled: full },
    // A layout with more places than the tab has panes adds empty ones (milestone 72).
    ...LAYOUTS.map((l, i): Item => ({ key: l, label: t(LAYOUT_TITLES[l]), action: ('layout' + (i + 1)) as Action, layout: l, sep: i === 0, heading: i === 0 ? t('split_menu.layouts_up_to_max_panes', { MAX_PANES }) : undefined })),
    { key: 'bc', label: t('split_menu.broadcast_to_all_panes'), action: 'broadcastAll', icon: 'broadcast', disabled: up < 2 ? t('split_menu.broadcast_needs_two') : undefined, sep: true },
    { key: 'bcstop', label: t('split_menu.stop_broadcast'), action: 'stopBroadcast', icon: 'x', disabled: on ? undefined : t('split_menu.broadcast_is_off') },
    { key: 'next', label: t('split_menu.focus_next_pane'), action: 'focusNextPane', disabled: single, sep: true },
    { key: 'close', label: n > 1 ? t('split_menu.close_pane') : t('split_menu.close_tab'), action: 'closeTab' },
  ];
  const [hot, setHot] = useState(0);
  useEffect(() => { ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]')[hot]?.focus(); }, [hot]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.('[data-split-button]')) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const run = (it: Item) => {
    if (it.disabled) return;
    onClose();
    runAction(it.action);
  };
  return (
    <div ref={ref} className="menu" role="menu" aria-label={t('split_menu.split')} data-split-menu
      style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 290, zIndex: 20 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); document.querySelector<HTMLElement>('[data-split-button]')?.focus(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); setHot((hot + 1) % items.length); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setHot((hot - 1 + items.length) % items.length); }
      }}>
      {items.map((it, i) => (
        <div key={it.key} style={{ display: 'contents' }}>
          {it.sep && <div className="menu-sep" />}
          {it.heading && <div className="menu-label"><span className="label">{it.heading}</span></div>}
          <button className={'mi' + (i === hot ? ' hot' : '')} tabIndex={i === hot ? 0 : -1}
            role={it.layout ? 'menuitemradio' : 'menuitem'} aria-checked={it.layout ? n > 1 && tab.layout === it.layout : undefined}
            aria-disabled={it.disabled ? true : undefined} title={it.disabled}
            onMouseEnter={() => setHot(i)} onClick={() => run(it)}>
            {it.layout && <LayoutIcon layout={it.layout} />}
            {it.icon && <Icon name={it.icon} size="sm" />}
            <span className="grow">{it.label}</span>
            <span className="kbd">{chordLabel(it.action, os)}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
