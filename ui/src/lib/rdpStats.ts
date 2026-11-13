// The RDP tab's statistics (milestone 34): what the page drew, and what the core says
// the server sent, as rates over the last second. Counters only: nothing here names
// the host (Principle 5).

import type { RdpStats } from '../api/types';

/** Frames the page drew and the bytes it read from the frame channel. */
export class FrameMeter {
  frames = 0;
  bytes = 0;
  /** When the last frames were drawn (performance.now()), newest last. */
  readonly times: number[] = [];
  add(bytes: number, at = performance.now()) {
    this.frames += 1;
    this.bytes += bytes;
    this.times.push(at);
    if (this.times.length > 64) this.times.shift();
  }
  /** When the first frame after `t` was drawn, or null. */
  firstAfter(t: number): number | null {
    for (const at of this.times) if (at > t) return at;
    return null;
  }
}

export interface StatsSample {
  /** performance.now() when it was taken. */
  at: number;
  drawn: number;
  read: number;
  core: RdpStats;
}

export interface StatsRates {
  /** Frames drawn per second on this page. */
  fps: number;
  /** Updates the server drew per second (EndPaints in FreeRDP). */
  updates: number;
  /** Kilobits per second received from the server. */
  kbps: number;
  /** Mean decode time of a surface command, ms (graphics pipeline only). */
  decodeMs: number;
  /** MB per second the page read from the frame channel. */
  channelMBps: number;
}

/** The rates between two samples; zeros when they are too close or reset. */
export function ratesBetween(a: StatsSample, b: StatsSample): StatsRates {
  const s = (b.at - a.at) / 1000;
  if (s < 0.05) return { fps: 0, updates: 0, kbps: 0, decodeMs: 0, channelMBps: 0 };
  const d = (x: number, y: number) => Math.max(0, y - x);
  const cmds = d(a.core.commands, b.core.commands);
  return {
    fps: d(a.drawn, b.drawn) / s,
    updates: d(a.core.updates, b.core.updates) / s,
    kbps: (d(a.core.bytes_in, b.core.bytes_in) * 8) / 1000 / s,
    decodeMs: cmds ? d(a.core.decode_us, b.core.decode_us) / cmds / 1000 : 0,
    channelMBps: d(a.read, b.read) / 1e6 / s,
  };
}

/** The pipeline and codec as one label: "graphics pipeline · progressive", "bitmaps". */
export function pipelineLabel(core: RdpStats): string {
  if (core.pipeline === 'gfx') return core.codec ? `graphics pipeline · ${core.codec.split(',').join(', ')}` : 'graphics pipeline';
  if (core.pipeline === 'bitmap') return 'bitmap updates';
  return '';
}

/**
 * The link as the server measured it (milestone 35, `ConnectionType` auto-detect):
 * "20.0 Mbit/s · 12 ms", or '' until the server has measured it.
 */
export function linkLabel(core: RdpStats): string {
  if (!core.link_kbps && !core.link_rtt_ms) return '';
  const bw = core.link_kbps >= 1000 ? `${(core.link_kbps / 1000).toFixed(1)} Mbit/s` : `${core.link_kbps} kbit/s`;
  return core.link_rtt_ms ? `${bw} · ${core.link_rtt_ms} ms` : bw;
}

/**
 * The quiet re-reads (milestone 35): how many, and the pixels they found differing from
 * what the page had been handed. Stale pixels mean FreeRDP drew an area without
 * reporting it; the re-read sends it.
 */
export function rereadLabel(core: RdpStats): string {
  if (!core.rereads) return '';
  const stale = core.stale_px ? `${core.stale_px.toLocaleString('en-US')} stale px fixed` : 'nothing stale';
  return `${core.rereads} re-read${core.rereads === 1 ? '' : 's'} · ${stale}`;
}

/** The graphics modes, as Settings and the RDP toolbar name them (milestone 35). */
export const GRAPHICS_MODES = [
  { id: 'auto', label: 'Automatic' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'compatible', label: 'Compatible' },
] as const;

/**
 * What the tab runs and why: "Automatic: bitmaps · local network, 1 ms",
 * "Pipeline", "Compatible: bitmaps". '' before the desktop is up.
 */
export function graphicsChoiceLabel(mode: string, engine: string, rttMs: number, spanning = false): string {
  if (!engine) return '';
  const runs = engine === 'compatible' ? 'bitmaps' : 'graphics pipeline';
  if (mode !== 'auto') return engine === 'compatible' ? 'Compatible: bitmaps' : 'Pipeline: graphics pipeline';
  // Milestone 38, D-091: across monitors Automatic takes the pipeline whatever the link.
  if (spanning && engine !== 'compatible') return 'Automatic: graphics pipeline · across monitors';
  if (rttMs < 0) return `Automatic: ${runs} · link not measured`;
  return `Automatic: ${runs} · ${engine === 'compatible' ? 'local network' : 'remote link'}, ${rttMs} ms`;
}
