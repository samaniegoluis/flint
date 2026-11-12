// A desktop across monitors in the page (milestone 38, designs 22f1 and 22f2): the
// Full screen menu with its "on all monitors" item, and the connection bar's Monitors
// popover with a to-scale map of this computer's monitors.

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { chordLabel } from '../lib/keymap';
import { Icon } from '../ui/Icon';
import { monitorMap, monitors, useMonitors } from './monitors';
import type { MonitorsView } from '../api/types';

/** Why "Full screen on all monitors" is greyed, '' when it is offered. */
export function allMonitorsReason(view: MonitorsView | null): string {
  if (!view) return 'Only one monitor connected';
  if (view.reason) return view.reason;
  if (view.monitors.length < 2 || view.picks.length < 2) return 'Only one monitor connected';
  return '';
}

/** The RDP toolbar's Full screen, a split button whose menu offers all monitors (22f1a, 22f1c). */
export function FullScreenSplit({ onFullScreen, onAllMonitors }: { onFullScreen: () => void; onAllMonitors: () => void }) {
  const { os } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const { view } = useMonitors();
  useEffect(() => {
    if (!open) return;
    void monitors.refresh();
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <span className="mon-anchor" ref={ref}>
      <button className="tbtn" data-rdp-fullscreen title={`Full screen (${chordLabel('fullscreen', os)})`} onClick={onFullScreen}>
        <Icon name="expand" size="sm" /><span className="tb-l">Full screen</span><span className="kbd">{chordLabel('fullscreen', os)}</span>
      </button>
      <button className={'tbtn' + (open ? ' on' : '')} data-rdp-fullscreen-menu aria-haspopup="menu" aria-expanded={open} aria-label="More full screen options"
        onClick={() => setOpen((o) => !o)}><Icon name="chev" size="xs" /></button>
      {open && (
        <FullScreenMenu style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', width: 300, zIndex: 30 }}
          view={view} onClose={() => setOpen(false)} onFullScreen={onFullScreen} onAllMonitors={onAllMonitors} />
      )}
    </span>
  );
}

export function FullScreenMenu({ view, style, onClose, onFullScreen, onAllMonitors }: {
  view: MonitorsView | null;
  style: React.CSSProperties;
  onClose: () => void;
  onFullScreen: () => void;
  onAllMonitors: () => void;
}) {
  const { os } = useApp();
  const reason = allMonitorsReason(view);
  return (
    <div className="menu" role="menu" aria-label="Full screen" style={style} data-fullscreen-menu
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <button className="mi" role="menuitem" data-fullscreen-one onClick={() => { onClose(); onFullScreen(); }}>
        <Icon name="expand" size="sm" /><span className="grow">Full screen</span><span className="kbd">{chordLabel('fullscreen', os)}</span>
      </button>
      {reason ? (
        <button className="mi is-disabled" role="menuitem" aria-disabled="true" data-fullscreen-all data-reason={reason}
          style={{ color: 'var(--text-disabled)', minHeight: 44, alignItems: 'flex-start', paddingTop: 6 }}>
          <Icon name="monitors" size="sm" />
          <span className="col grow" style={{ gap: 2 }}>
            <span>Full screen on all monitors</span>
            <span className="hint" style={{ color: 'var(--text-tertiary)', whiteSpace: 'normal', lineHeight: 1.4 }}>{reason}</span>
          </span>
        </button>
      ) : (
        <button className="mi" role="menuitem" data-fullscreen-all onClick={() => { onClose(); onAllMonitors(); }}>
          <Icon name="monitors" size="sm" /><span className="grow">Full screen on all monitors</span>
          <span className="hint">{view!.picks.length} monitors</span>
        </button>
      )}
    </div>
  );
}

/** The connection bar's Monitors button and its popover (22f2a, 22f2b). */
export function MonitorsButton({ onOpenChange, onSpan }: { onOpenChange: (open: boolean) => void; onSpan: (picks: string[]) => void }) {
  const mon = useMonitors();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const set = (o: boolean) => { setOpen(o); onOpenChange(o); };
  useEffect(() => {
    if (!open) return;
    void monitors.refresh();
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) set(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const view = mon.view;
  if (!view || view.reason || view.monitors.length < 2) return null;
  const count = mon.phase === 'off' ? 1 : mon.picks.length;
  return (
    <span className="mon-anchor" ref={ref}>
      <button className={'btn btn-ghost btn-sm' + (open ? ' is-active' : '')} aria-haspopup="dialog" aria-expanded={open} data-fs-monitors
        style={open ? { background: 'var(--surface-active)' } : undefined} onClick={() => set(!open)}>
        <Icon name="monitors" size="sm" />Monitors<span className="tcount" style={{ background: 'var(--text-tertiary)' }}>{count}</span>
      </button>
      {open && <MonitorsPopover view={view} picks={mon.phase === 'off' ? [view.main] : mon.picks} busy={mon.phase === 'opening' || mon.phase === 'arranging'}
        onChoose={(next) => { if (mon.phase === 'off') { if (next.length > 1) onSpan(next); } else monitors.choose(next); }} />}
    </span>
  );
}

function MonitorsPopover({ view, picks, busy, onChoose }: { view: MonitorsView; picks: string[]; busy: boolean; onChoose: (picks: string[]) => void }) {
  const { tiles, width, height } = monitorMap(view.monitors, 356, 170);
  const full = picks.length >= view.max;
  const toggle = (id: string) => {
    if (id === view.main) return;
    const next = picks.includes(id) ? picks.filter((p) => p !== id) : [...picks, id];
    onChoose(next);
  };
  return (
    <div className="mon-pop" role="dialog" aria-label="Monitors" aria-busy={busy || undefined} data-monitors-popover
      style={{ left: '50%', top: 'calc(100% + 8px)', transform: 'translateX(-50%)' }}>
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <span className="strong grow">Monitors in this session</span>
        <span className="hint">{picks.length} of {view.max}</span>
      </div>
      <div className="mon-map" style={{ width, height }}>
        {tiles.map((t) => {
          const m = t.monitor;
          const on = picks.includes(m.id);
          const main = m.id === view.main;
          const cap = !on && full;
          return (
            <button key={m.id} className={'mon' + (on ? ' on' : '') + (main ? ' main' : '') + (cap ? ' cap' : '')}
              role="checkbox" aria-checked={on} aria-disabled={main || cap || undefined} data-monitor={m.id}
              title={cap ? `Up to ${view.max} monitors · uncheck one first` : undefined}
              style={{ left: t.left, top: t.top, width: t.width, height: t.height }}
              onClick={() => { if (!main && !cap) toggle(m.id); }}>
              <span className="mon-chk">{on && <Icon name="check" />}</span>
              <span className="mon-n">{m.name}</span>
              <span className="mon-s mono">{m.width}×{m.height}</span>
              {main && <span className="mon-tag">Main · taskbar</span>}
            </button>
          );
        })}
      </div>
      <div className="row hint" style={{ gap: 6 }}>
        <Icon name="info" size="sm" />
        <span>Up to {view.max} monitors. The main one, with the taskbar, is where Flint's window is. Changes apply at once.</span>
      </div>
    </div>
  );
}
