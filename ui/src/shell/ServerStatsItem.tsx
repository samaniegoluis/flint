// The active tab's server resources in the status bar (milestone 55, designs 25a1,
// 25a2, 25a5-25a10): CPU, RAM, network, disk and uptime of the focused pane's host,
// with a skeleton before the first sample, only the fields the host gives, nothing at
// all for a host that gives none, and two percentages with bars in a narrow window.
// Hovering or clicking opens the detail (25a9).

import { useEffect, useRef, useState } from 'react';
import type { ServerSample } from '../api/types';
import type { StatsView } from '../sessions/serverStats';
import {
  diskDetail, diskPct, hostLine, levelNote, loadLabel, loadLevel, memDetail, memPct, pctLabel, rateLabel, statsAria,
  uptimeLong, uptimeShort, usedOfLabel, type Level,
} from '../lib/serverStats';
import { Icon } from '../ui/Icon';
import { t } from '../i18n';
import { tr } from '../i18n/react';

interface Props {
  alias: string;
  view: StatsView | null;
  colour: boolean;
  compact: boolean;
  onSettings: () => void;
}

const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 200;

export function ServerStatsItem({ alias, view, colour, compact, onSettings }: Props) {
  const [open, setOpen] = useState<'hover' | 'pinned' | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const clearTimer = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };

  useEffect(() => {
    if (open !== 'pinned') return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(null); return; }
      if (e.metaKey || e.ctrlKey) setOpen(null);
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  useEffect(() => clearTimer, []);
  const live = view?.state === 'live' ? view : null;
  // The detail closes when its tab's host stops showing anything.
  useEffect(() => { if (!live) setOpen(null); }, [!!live]);

  if (!view || view.state === 'none') return null;
  const lvl = (pct: number): string => (colour ? ' ' + loadLevel(pct) : '');

  if (view.state === 'waiting') {
    const dots = <span className="v">··</span>;
    return (
      <button className="res loading" data-server-stats="waiting" aria-label={t('server_stats_item.server_resources_first_sample_on')} aria-busy="true" tabIndex={-1}>
        <span className="res-i"><span className="k">CPU</span>{dots}</span>
        <span className="res-i"><span className="k">RAM</span>{dots}</span>
        {!compact && <>
          <span className="res-i"><span className="k">↓</span>{dots}<span className="k">↑</span>{dots}</span>
          <span className="res-i"><span className="k">{t('server_stats_item.disk')}</span>{dots}</span>
          <span className="res-i"><span className="k">{t('server_stats_item.up')}</span>{dots}</span>
        </>}
      </button>
    );
  }

  const s = view.sample;
  const enter = () => {
    clearTimer();
    if (open) return;
    timer.current = window.setTimeout(() => setOpen((o) => o ?? 'hover'), HOVER_OPEN_MS);
  };
  const leave = () => {
    clearTimer();
    if (open !== 'hover') return;
    timer.current = window.setTimeout(() => setOpen((o) => (o === 'hover' ? null : o)), HOVER_CLOSE_MS);
  };
  const click = () => { clearTimer(); setOpen(open === 'pinned' ? null : 'pinned'); };

  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }} onMouseEnter={enter} onMouseLeave={leave}>
      <button className={'res' + (open ? ' is-open' : '')} data-server-stats="live" aria-label={statsAria(s)} aria-expanded={!!open} aria-haspopup="dialog" onClick={click}>
        {compact ? <CompactFields s={s} lvl={lvl} colour={colour} /> : <Fields s={s} lvl={lvl} />}
      </button>
      {open && <Detail alias={alias} s={s} at={view.at} colour={colour} onSettings={() => { setOpen(null); onSettings(); }} />}
    </span>
  );
}

function Fields({ s, lvl }: { s: ServerSample; lvl: (pct: number) => string }) {
  return <>
    {s.has_cpu && <span className="res-i" data-res="cpu"><span className="k">CPU</span><span className={'v' + lvl(s.cpu_pct)}>{pctLabel(s.cpu_pct)}</span></span>}
    {s.has_mem && <span className="res-i" data-res="ram"><span className="k">RAM</span><span className={'v' + lvl(memPct(s))}>{usedOfLabel(s.mem_used, s.mem_total)}</span></span>}
    {s.has_net && <span className="res-i" data-res="net"><span className="k">↓</span><span className="v">{rateLabel(s.rx_rate)}</span><span className="k">↑</span><span className="v">{rateLabel(s.tx_rate)}</span></span>}
    {s.has_disk && <span className="res-i" data-res="disk"><span className="k">{t('server_stats_item.disk')}</span><span className={'v' + lvl(diskPct(s))}>{pctLabel(diskPct(s))}</span></span>}
    {s.has_uptime && <span className="res-i" data-res="up"><span className="k">{t('server_stats_item.up')}</span><span className="v">{uptimeShort(s.uptime_secs)}</span></span>}
  </>;
}

function Bar({ pct, level, colour, wide }: { pct: number; level: Level; colour: boolean; wide?: boolean }) {
  return <span className={'res-bar' + (wide ? ' wide' : '') + (colour ? ' ' + level : '')}><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>;
}

// 900 × 600 (25a10): CPU and RAM as percentages with a bar each.
function CompactFields({ s, lvl, colour }: { s: ServerSample; lvl: (pct: number) => string; colour: boolean }) {
  return <>
    {s.has_cpu && <span className="res-i" data-res="cpu"><span className="k">CPU</span><Bar pct={s.cpu_pct} level={loadLevel(s.cpu_pct)} colour={colour} /><span className={'v' + lvl(s.cpu_pct)}>{pctLabel(s.cpu_pct)}</span></span>}
    {s.has_mem && <span className="res-i" data-res="ram"><span className="k">RAM</span><Bar pct={memPct(s)} level={loadLevel(memPct(s))} colour={colour} /><span className={'v' + lvl(memPct(s))}>{pctLabel(memPct(s))}</span></span>}
  </>;
}

function clock(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function Detail({ alias, s, at, colour, onSettings }: { alias: string; s: ServerSample; at: number; colour: boolean; onSettings: () => void }) {
  const lvl = (pct: number) => (colour ? ' ' + loadLevel(pct) : '');
  const line = hostLine(s);
  return (
    <div className="sync-pop res-pop" role="dialog" aria-label={t('server_stats_item.server_resources_alias', { alias })} data-server-stats-detail style={{ left: -8, bottom: 'calc(100% + 8px)', width: 360 }}>
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <span className="st st-on" />
        <span className="mono strong grow trunc">{alias}</span>
        {line && <span className="hint">{line}</span>}
      </div>
      <div className="res-grid">
        {s.has_cpu && <>
          <span className="k">CPU</span><Bar wide pct={s.cpu_pct} level={loadLevel(s.cpu_pct)} colour={colour} /><span className={'v' + lvl(s.cpu_pct)}>{pctLabel(s.cpu_pct)}</span>
          <span className="sub">{s.has_load ? loadLabel(s) : ''}</span>
        </>}
        {s.has_mem && <>
          <span className="k">{t('server_stats_item.memory')}</span><Bar wide pct={memPct(s)} level={loadLevel(memPct(s))} colour={colour} /><span className={'v' + lvl(memPct(s))}>{pctLabel(memPct(s))}</span>
          <span className="sub">{memDetail(s)}</span>
        </>}
        {s.has_disk && <>
          <span className="k">{t('server_stats_item.disk_2')}</span><Bar wide pct={diskPct(s)} level={loadLevel(diskPct(s))} colour={colour} /><span className={'v' + lvl(diskPct(s))}>{pctLabel(diskPct(s))}</span>
          <span className="sub">{diskDetail(s)}</span>
        </>}
        {s.has_net && <>
          <span className="k">{t('server_stats_item.network')}</span><span className="mono" style={{ gridColumn: 'span 2', fontSize: 'var(--fs-xs)' }}>↓ {rateLabel(s.rx_rate, true)} · ↑ {rateLabel(s.tx_rate, true)}</span>
          <span className="sub">{s.interfaces.join(', ')}</span>
        </>}
        {s.has_uptime && <>
          <span className="k">{t('server_stats_item.uptime')}</span><span className="mono" style={{ gridColumn: 'span 2', fontSize: 'var(--fs-xs)' }}>{uptimeLong(s.uptime_secs)}</span>
          <span className="sub" />
        </>}
      </div>
      <div className="row hint" style={{ gap: 6 }}>
        <Icon name="clock" size="xs" />
        <span className="grow">{tr('server_stats_item.last_sample_clock_every_2', { clock: clock(at) })}</span>
        <button className="link" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }} data-server-stats-settings onClick={onSettings}>{t('server_stats_item.settings')}</button>
      </div>
      {colour && <span className="hint">{levelNote()}</span>}
    </div>
  );
}
