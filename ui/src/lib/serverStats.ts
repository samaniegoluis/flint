// Live server resources (milestone 55, designs 25a, 25b): how a sample reads in the
// status bar and its detail. Pure functions; the core sends raw numbers
// (src/domain/stats.cf). Units are binary (1024), named GB, MB and KB as htop does.

import type { ServerSample } from '../api/types';
import { t } from '../i18n';

export type Level = 'ok' | 'warn' | 'hot';

/** Green under 60 %, amber to 85 %, red above (design 25a9's note). */
export function loadLevel(pct: number): Level {
  if (pct < 60) return 'ok';
  if (pct <= 85) return 'warn';
  return 'hot';
}

/** What the colours mean, under the popover's figures. */
export function levelNote(): string {
  return t('server_stats.level_note');
}

export function memPct(s: ServerSample): number {
  return s.mem_total > 0 ? (100 * s.mem_used) / s.mem_total : 0;
}

/** As df counts it: used of what the person can use (used + available), rounded up. */
export function diskPct(s: ServerSample): number {
  const base = s.disk_used + s.disk_avail;
  return base > 0 ? Math.ceil((100 * s.disk_used) / base) : 0;
}

export function pctLabel(pct: number): string {
  return `${Math.round(Math.max(0, Math.min(100, pct)))}%`;
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

function num(v: number, places: number): string {
  return v.toFixed(places);
}

/** A size with one decimal under 10 and none above: "17 GB", "2.0 GB", "512 MB". */
export function sizeLabel(bytes: number): string {
  const b = Math.max(0, bytes);
  const [unit, name] = b >= TB ? [TB, 'TB'] : b >= GB ? [GB, 'GB'] : b >= MB ? [MB, 'MB'] : [KB, 'KB'];
  const v = b / unit;
  return `${num(v, v < 10 ? 1 : 0)} ${name}`;
}

/** Used over total in the total's unit, one decimal: "12.1/15.6 GB" (the bar). */
export function usedOfLabel(used: number, total: number, sep = '/'): string {
  const unit = total >= GB ? GB : MB;
  const name = unit === GB ? 'GB' : 'MB';
  const places = unit === GB ? 1 : 0;
  return `${num(Math.max(0, used) / unit, places)}${sep}${num(Math.max(0, total) / unit, places)} ${name}`;
}

/** A rate: "84 KB/s", "1.2 MB/s" (the bar), "1.24 MB/s" with `precise` (the detail). */
export function rateLabel(bps: number, precise = false): string {
  const b = Math.max(0, bps);
  if (b < KB) return `${Math.round(b)} B/s`;
  if (b < MB) return `${Math.round(b / KB)} KB/s`;
  if (b < GB) {
    const v = b / MB;
    return `${num(v, precise ? 2 : v < 10 ? 1 : 0)} MB/s`;
  }
  return `${num(b / GB, precise ? 2 : 1)} GB/s`;
}

/** Uptime, short ("41 d", "6 h", "12 min") for the bar. */
export function uptimeShort(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s >= 86400) return `${Math.floor(s / 86400)} d`;
  if (s >= 3600) return `${Math.floor(s / 3600)} h`;
  return `${Math.max(1, Math.floor(s / 60))} min`;
}

/** Uptime, long ("41 days 6 h", "1 day", "6 h 12 min", "12 min") for the detail. */
export function uptimeLong(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} day${d === 1 ? '' : 's'}${h > 0 ? ` ${h} h` : ''}`;
  if (h > 0) return `${h} h${m > 0 ? ` ${m} min` : ''}`;
  return `${Math.max(1, m)} min`;
}

export function loadLabel(s: ServerSample): string {
  return `load ${s.load1.toFixed(2)} · ${s.load5.toFixed(2)} · ${s.load15.toFixed(2)}`;
}

/** "4 cores · Ubuntu 24.04" (the detail's header). */
export function hostLine(s: ServerSample): string {
  const parts: string[] = [];
  if (s.cores > 0) parts.push(`${s.cores} core${s.cores === 1 ? '' : 's'}`);
  if (s.os) parts.push(s.os);
  return parts.join(' · ');
}

export function memDetail(s: ServerSample): string {
  const mem = usedOfLabel(s.mem_used, s.mem_total, ' of ').replace(/ of ([\d.]+) (\w+)$/, ' $2 of $1 $2');
  if (s.swap_total <= 0) return mem;
  return `${mem} · swap ${usedOfLabel(s.swap_used, s.swap_total, ' of ')}`;
}

export function diskDetail(s: ServerSample): string {
  return `${sizeLabel(s.disk_used)} of ${sizeLabel(s.disk_total)} · ${sizeLabel(s.disk_avail)} free`;
}

export function hasFields(s: ServerSample): boolean {
  return s.has_cpu || s.has_mem || s.has_net || s.has_disk || s.has_uptime || s.has_load;
}

/** What a screen reader hears for the bar: "CPU 23 percent, RAM 78 percent, …". */
export function statsAria(s: ServerSample): string {
  const parts: string[] = [];
  if (s.has_cpu) parts.push(t('server_stats.aria.cpu', { pct: Math.round(s.cpu_pct) }));
  if (s.has_mem) parts.push(t('server_stats.aria.ram', { pct: Math.round(memPct(s)) }));
  if (s.has_net) parts.push(t('server_stats.aria.net', { down: rateLabel(s.rx_rate), up: rateLabel(s.tx_rate) }));
  if (s.has_disk) parts.push(t('server_stats.aria.disk', { pct: diskPct(s) }));
  if (s.has_uptime) parts.push(t('server_stats.aria.uptime', { uptime: uptimeLong(s.uptime_secs) }));
  return t('server_stats.aria.all', { parts: parts.join(', ') });
}
