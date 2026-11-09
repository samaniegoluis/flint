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
import { TerminalView } from './TerminalView';
import { SessionCard } from './SessionCards';

const GAP = 4;

// Where a divider sits along its axis: in the gap after track `index`. `k` tracks,
// `at` the fraction of the axis before that gap (edges()[index + 1]).
function offset(at: number, k: number, index: number): string {
  return `calc(${GAP}px + (100% - ${2 * GAP + (k - 1) * GAP}px) * ${at.toFixed(4)} + ${index * GAP}px)`;
}

export function SplitView({ tab, panes, shown, active, fontSize, onEditHost }: {
  tab: Tab;
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
    <div ref={grid} className={'splits' + (multi ? ' multi' : '')}
      style={{ gridTemplateColumns: template(tab.cols), gridTemplateRows: template(tab.rows) }}>
      {tab.panes.map((id, i) => {
        const p = byId.get(id);
        if (!p) return null;
        const focused = id === tab.focus;
        const host = catalog.hosts.find((h) => h.alias === p.alias);
        const c = colorStyle(host?.color ?? '');
        const st = statusLabel(p);
        return (
          <section key={id} className={'spane' + (multi && focused ? ' focus' : '')} style={placement(tab.layout, n, i)}
            role="region" aria-label={multi ? `Pane ${i + 1} — ${p.alias}${focused ? ' (focused)' : ''}` : `Terminal — ${p.alias}`}
            data-pane={id} onMouseDownCapture={() => { if (!focused) sessions.focusPane(id); }}>
            {multi && (
              <div className="sp-h">
                <span className="sp-num">{i + 1}</span>
                <span className={'sp-dot ' + c.className} style={c.style} />
                <span className="mono grow trunc" style={{ color: 'inherit' }}>{p.alias}</span>
                {st.meta && <span className={st.metaClass} style={{ fontSize: 'var(--fs-2xs)' }}>{st.meta}</span>}
                <span className={'st ' + st.dot} role="img" aria-label={p.status} />
                <button className="sp-x" aria-label={`Close pane ${i + 1}${focused ? ` (${chordLabel('closeTab', os)})` : ''}`}
                  onMouseDown={(e) => e.stopPropagation()} onClick={() => sessions.close(id)}><Icon name="x" size="xs" /></button>
              </div>
            )}
            <div className="sp-body">
              <TerminalView tabId={id} active={shown && active} focus={shown && active && focused && p.status === 'ready'} fontSize={fontSize} />
              <SessionCard tab={p} active={active && focused} split={multi} onEditHost={onEditHost} />
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
            aria-label={d.axis === 'cols' ? 'Resize the panes beside this divider' : 'Resize the panes above and below this divider'}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(at * 100)}
            title="Drag to resize · double-click to even out"
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
