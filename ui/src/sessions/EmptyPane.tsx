// An empty pane (milestone 72, design 28a*): a place in a split waiting for a host. The
// focused one shows a compact host picker in its middle, the host it was split from
// first and preselected, so ⌘D then ↵ repeats the old same-host split; the others stay
// quiet, with one button and the chord that moves the focus there. Choosing a host
// turns the pane into that host's session (sessions.fill); Esc closes it.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { chordLabel } from '../lib/keymap';
import { colorStyle } from '../lib/colors';
import { folderDisplay, highlight } from '../lib/search';
import { Icon } from '../ui/Icon';
import { plainText } from '../ui/plainText';
import { sessions, type Pane } from './store';
import { pickerRows } from './picker';
import { t } from '../i18n';
import { tr } from '../i18n/react';

/** Below this size the picker shows three rows and no folder column (28a3). */
const SMALL_W = 380;
const SMALL_H = 330;

function Hl({ text, positions }: { text: string; positions: number[] | undefined }) {
  if (!positions?.length) return <>{text}</>;
  return <>{highlight(text, positions).map((r, i) => (r.match ? <span key={i} className="match">{r.text}</span> : <span key={i}>{r.text}</span>))}</>;
}

export function EmptyPane({ pane, focused, live, fromNo }: {
  pane: Pane;
  /** The pane has the tab's focus (the only pane of a tab always has it). */
  focused: boolean;
  /** Its tab is the one shown and the sessions area is on screen. */
  live: boolean;
  /** The number of the pane it was split from, 0 when that pane is gone. */
  fromNo: number;
}) {
  const { os, catalog } = useApp();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [hot, setHot] = useState(0);
  const [small, setSmall] = useState(false);

  useLayoutEffect(() => {
    const el = root.current?.closest('.spane') ?? root.current;
    if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); setSmall(r.width < SMALL_W || r.height < SMALL_H); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The search field takes the keys whenever this pane does.
  useEffect(() => { if (focused && live) input.current?.focus({ preventScroll: true }); }, [focused, live]);

  const list = useMemo(() => pickerRows(catalog.hosts, pane.suggest, sessions.recentHosts(), q, small ? 3 : 5), [catalog.hosts, pane.suggest, q, small]);
  const cur = Math.min(hot, Math.max(0, list.rows.length - 1));
  const choose = (alias: string) => sessions.fill(pane.id, alias);

  if (!focused) {
    return (
      <div className="sp-body-center" ref={root} data-empty-pane={pane.id}>
        <div className="ep-quiet">
          <button type="button" className="btn btn-secondary btn-sm" data-empty-connect onClick={() => sessions.focusPane(pane.id)}>
            <Icon name="plus" size="sm" />{t('empty_pane.connect_to_a_host')}
          </button>
          <span className="hint row" style={{ gap: 6 }}><span className="kbd">{chordLabel('focusNextPane', os)}</span>{t('empty_pane.moves_here')}</span>
        </div>
      </div>
    );
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHot((cur + 1) % Math.max(1, list.rows.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHot((cur - 1 + list.rows.length) % Math.max(1, list.rows.length)); }
    else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      const row = list.rows[cur];
      if (row) choose(row.host.alias);
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sessions.close(pane.id); }
  };

  let lastKind = '';
  return (
    <div className="sp-body-center" ref={root} data-empty-pane={pane.id}>
      <div className={'hp' + (small ? ' sm' : '')} role="dialog" aria-label={t('empty_pane.choose_a_host_for_this_pane')} data-host-picker>
        <label className="hp-search">
          <Icon name="search" size="sm" className="faint" />
          <input {...plainText} ref={input} aria-label={t('empty_pane.search_hosts')} placeholder={t('empty_pane.search_hosts')} value={q}
            role="combobox" aria-expanded="true" aria-controls={pane.id + '-hpl'} aria-activedescendant={list.rows[cur] ? `${pane.id}-hp-${cur}` : undefined}
            onChange={(e) => { setQ(e.target.value); setHot(0); }} onKeyDown={onKey} />
          <span className="kbd">esc</span>
        </label>
        {list.rdp && (
          <div className="hp-note" data-picker-rdp>
            <Icon name="info" size="sm" />
            <span>{tr('empty_pane.rdp_own_tab', { alias: <span className="mono">{list.rdp}</span>, chord: <span className="kbd">{chordLabel('palette', os)}</span> })}</span>
          </div>
        )}
        <div className="hp-list" role="listbox" id={pane.id + '-hpl'} aria-label={t('empty_pane.hosts')}>
          {list.rows.length === 0 && !list.rdp && <div className="hp-note" data-picker-none>{q ? t('empty_pane.no_host_matches') : t('empty_pane.no_hosts')}</div>}
          {list.rows.map((r, i) => {
            const c = colorStyle(r.host.color);
            const pos = r.match?.positions ?? {};
            const where = r.host.group ? folderDisplay(r.host.group, pos.group) : null;
            // A heading where the rows change from the suggestion to the others (28a1).
            const heading = !q && r.kind !== lastKind && r.kind !== 'same' && i > 0
              ? (r.kind === 'recent' ? t('empty_pane.recent') : t('empty_pane.hosts')) : '';
            lastKind = r.kind;
            return (
              <div key={r.host.alias} style={{ display: 'contents' }}>
                {heading && <div className="menu-label" style={{ padding: '6px var(--sp-2) 2px' }}><span className="label">{heading}</span></div>}
                <button type="button" id={`${pane.id}-hp-${i}`} className={'hp-row' + (i === cur ? ' hot' : '')} role="option" aria-selected={i === cur} tabIndex={-1}
                  data-picker-host={r.host.alias} onMouseEnter={() => setHot(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r.host.alias)}>
                  <span className={'hmark ' + c.className} style={c.style} />
                  <span className="hp-a">
                    <span className="hp-alias"><Hl text={r.host.alias} positions={pos.alias} />
                      {r.kind === 'same' && <span className="hp-same">{fromNo ? t('empty_pane.same_as_pane', { n: fromNo }) : t('empty_pane.same_host')}</span>}
                    </span>
                    <span className="hp-addr">{r.host.user ? `${r.host.user}@` : ''}<Hl text={r.host.hostname} positions={pos.hostname} /></span>
                  </span>
                  {where && <span className="hp-g"><Hl text={where.text} positions={where.positions} /></span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="hp-k">
          <span><span className="kbd">↵</span>{t('empty_pane.connect')}</span>
          <span><span className="kbd">esc</span>{t('empty_pane.close_pane')}</span>
        </div>
      </div>
    </div>
  );
}
