// One tab's panes (milestone 20, design 18*): a CSS grid of one to four panes, each
// with its own terminal, session cards and, once split, a header (number, host,
// status, close). Dividers sit in the grid's gaps; drag one to resize, double-click
// it to even the panes out, or focus it and use the arrow keys.
//
// Every pane stays a child of the same grid element, keyed by its id, so splitting or
// closing a neighbour never remounts a terminal (its scrollback survives).

import { useRef, useState } from 'react';
import { useApp } from '../state/app';
import { chordLabel } from '../lib/keymap';
import { colorStyle } from '../lib/colors';
import { dividers, edges, moveDivider, placement, template, type Divider } from '../lib/layout';
import { Icon } from '../ui/Icon';
import { sessions, statusLabel, type Pane, type Tab } from './store';
import { focusTerminal, TerminalView } from './TerminalView';
import { SessionCard } from './SessionCards';
import { EmptyPane } from './EmptyPane';
import { t } from '../i18n';

const GAP = 4;

// Where a divider sits along its axis: in the gap after track `index`. `k` tracks,
// `at` the fraction of the axis before that gap (edges()[index + 1]).
function offset(at: number, k: number, index: number): string {
  return `calc(${GAP}px + (100% - ${2 * GAP + (k - 1) * GAP}px) * ${at.toFixed(4)} + ${index * GAP}px)`;
}

export function SplitView({ tab, panes, shown, active, fontSize, onEditHost, choosing = false, onChosen }: {
  tab: Tab;
  /** Choose panes (the broadcast bar): the header toggles stand out until one is used. */
  choosing?: boolean;
  onChosen?: () => void;
  panes: Pane[];
  /** The sessions area is on screen (not Keys, Credentials or Settings). */
  shown: boolean;
  /** This is the active tab. */
  active: boolean;
  fontSize: number;
  onEditHost: (alias: string) => void;
}) {
  const { os, catalog } = useApp();
  const grid = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const n = tab.panes.length;
  const multi = n > 1;
  const byId = new Map(panes.map((p) => [p.id, p]));
  const fi = tab.panes.indexOf(tab.focus);

  const startDrag = (d: Divider, e: React.PointerEvent<HTMLDivElement>) => {
    const el = grid.current;
    if (!el) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const key = d.axis + d.index;
    setDragging(key);
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const at = d.axis === 'cols' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
      const cur = sessions.tab(tab.id);
      if (cur) sessions.setTracks(tab.id, d.axis, moveDivider(cur[d.axis], d.index, at));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDragging(null);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div ref={grid} className={'splits' + (multi ? ' multi' : '') + (choosing ? ' bc-choosing' : '')}
      style={{ gridTemplateColumns: template(tab.cols), gridTemplateRows: template(tab.rows) }}>
      {tab.panes.map((id, i) => {
        const p = byId.get(id);
        if (!p) return null;
        const focused = id === tab.focus;
        const host = catalog.hosts.find((h) => h.alias === p.alias);
        const c = colorStyle(host?.color ?? '');
        const st = statusLabel(p);
        const empty = p.status === 'empty';
        // Broadcast (milestone 73, 28b1): in the set, or dropped out of it (28b3).
        const bc = tab.broadcast.includes(id);
        const canBc = p.kind === 'ssh' && p.status === 'ready';
        // The way here from the focused pane: ⌘] to the next, ⌘[ to the previous.
        const step = (i - fi + n) % n;
        const go = !focused && !empty && multi ? (step === 1 ? 'focusNextPane' : step === n - 1 ? 'focusPrevPane' : null) : null;
        const fromNo = empty && p.from ? tab.panes.indexOf(p.from) + 1 : 0;
        const label = empty
          ? t(focused && multi ? 'split_view.pane_empty_focused' : 'split_view.pane_empty', { n: i + 1 })
          : multi ? t(focused ? (bc ? 'split_view.pane_focused_receiving' : 'split_view.pane_focused') : (bc ? 'split_view.pane_receiving' : 'split_view.pane'), { n: i + 1, alias: p.alias }) : t('split_view.terminal_alias', { alias: p.alias });
        return (
          <section key={id} className={'spane' + (multi && focused ? ' focus' : '') + (empty ? ' is-empty' : '') + (bc ? ' bc' : '')} style={placement(tab.layout, n, i)}
            role="region" aria-label={label}
            data-pane={id} data-status={p.status} onMouseDownCapture={() => { if (!focused) sessions.focusPane(id); }}>
            {multi && (
              <div className="sp-h">
                <span className="sp-num">{i + 1}</span>
                {empty ? <span className="grow sp-empty">{t('split_view.empty_pane')}</span> : <>
                  <span className={'sp-dot ' + c.className} style={c.style} />
                  <span className="mono grow trunc" style={{ color: 'inherit' }}>{p.alias}</span>
                  {bc && <span className="bc-tag" data-bc-tag><Icon name="broadcast" />{t('split_view.receiving')}</span>}
                  {!bc && p.leftBroadcast && <span className="bc-tag left" data-bc-left><Icon name="broadcast" />{t('split_view.left_broadcast')}</span>}
                  {st.meta && <span className={st.metaClass} style={{ fontSize: 'var(--fs-2xs)' }}>{st.meta}</span>}
                  {go && <span className="kbd sp-go" title={t('split_view.go_here', { chord: chordLabel(go, os) })}>{chordLabel(go, os)}</span>}
                  {(canBc || bc) && (
                    <button className="bc-tog" data-bc-toggle aria-pressed={bc} aria-label={t('split_view.pane_receives_broadcast', { n: i + 1 })}
                      title={bc ? t('split_view.stop_receiving') : t('split_view.receive_typed_input')}
                      onMouseDown={(e) => e.stopPropagation()} onClick={() => {
                        sessions.toggleBroadcast(id);
                        onChosen?.();
                        // The keys go back to the focused terminal, not to the toggle.
                        setTimeout(() => focusTerminal(sessions.tab(tab.id)?.focus ?? null), 0);
                      }}><Icon name="broadcast" /></button>
                  )}
                  <span className={'st ' + st.dot} role="img" aria-label={p.status} />
                </>}
                <button className="sp-x" aria-label={focused ? t('split_view.close_pane_chord', { n: i + 1, chord: chordLabel('closeTab', os) }) : t('split_view.close_pane', { n: i + 1 })}
                  onMouseDown={(e) => e.stopPropagation()} onClick={() => sessions.close(id)}><Icon name="x" size="xs" /></button>
              </div>
            )}
            <div className="sp-body">
              {empty
                ? <EmptyPane pane={p} focused={focused || !multi} live={shown && active} fromNo={fromNo} />
                : <>
                  <TerminalView tabId={id} active={shown && active} focus={shown && active && focused && p.status === 'ready'} fontSize={fontSize} />
                  <SessionCard tab={p} active={active && focused} split={multi} onEditHost={onEditHost} />
                </>}
            </div>
          </section>
        );
      })}
      {multi && dividers(tab.layout, n, tab.cols, tab.rows).map((d) => {
        const tracks = tab[d.axis];
        const k = tracks.length;
        const at = edges(tracks)[d.index + 1];
        const other = d.axis === 'cols' ? tab.rows : tab.cols;
        const ko = other.length;
        // Along the other axis: from the start of the pane span to its end.
        const start = d.from > 0 ? offset(d.from, ko, 0) + ` + ${GAP}px` : `${GAP}px`;
        const end = d.to < 1 ? offset(d.to, ko, 0) : `calc(100% - ${GAP}px)`;
        const key = d.axis + d.index;
        const style: React.CSSProperties = d.axis === 'cols'
          ? { left: offset(at, k, d.index), width: GAP, top: `calc(${start})`, height: `calc(${end} - (${start}))` }
          : { top: offset(at, k, d.index), height: GAP, left: `calc(${start})`, width: `calc(${end} - (${start}))` };
        const even = () => sessions.setTracks(tab.id, d.axis, Array(k).fill(1));
        return (
          <div key={key} className={'sp-div ' + d.axis + (dragging === key ? ' drag' : '')} style={style}
            role="separator" aria-orientation={d.axis === 'cols' ? 'vertical' : 'horizontal'} tabIndex={0}
            aria-label={d.axis === 'cols' ? t('split_view.resize_the_panes_beside_this') : t('split_view.resize_the_panes_above_and')}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(at * 100)}
            title={t('split_view.drag_to_resize_double_click')}
            onPointerDown={(e) => startDrag(d, e)} onDoubleClick={even}
            onKeyDown={(e) => {
              const back = d.axis === 'cols' ? 'ArrowLeft' : 'ArrowUp';
              const fwd = d.axis === 'cols' ? 'ArrowRight' : 'ArrowDown';
              if (e.key !== back && e.key !== fwd) return;
              e.preventDefault();
              sessions.setTracks(tab.id, d.axis, moveDivider(tracks, d.index, at + (e.key === fwd ? 0.05 : -0.05)));
            }} />
        );
      })}
    </div>
  );
}
