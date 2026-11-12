// The RDP tab's statistics (milestone 34): what the page drew, and what the core says
// the server sent, as rates over the last second. Counters only: nothing here names
// the host (Principle 5).

import type { RdpStats } from '../api/types';

/** Frames the page drew and the bytes it read from the frame channel. */
export class FrameMeter {
  frames = 0;
  bytes = 0;
  add(bytes: number) {
    this.frames += 1;
    this.bytes += bytes;
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
  if (core.pipeline === 'gfx') return core.codec ? `graphics pipeline · ${core.codec}` : 'graphics pipeline';
  if (core.pipeline === 'bitmap') return 'bitmap updates';
  return '';
}
