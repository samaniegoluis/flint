// The RDP tab's statistics (milestone 34): a small panel over the desktop's top right
// corner, once a second, of what the desktop costs: frames drawn here, updates the
// server sent, bandwidth, the codec and how long it takes to decode, and how the page
// draws. Turned on from the toolbar's Stats; it takes no input, so the pointer goes
// through to the desktop.

import { useEffect, useRef, useState } from 'react';
import { api } from '../api/backend';
import type { RdpStats } from '../api/types';
import { pipelineLabel, ratesBetween, type FrameMeter, type StatsRates, type StatsSample } from '../lib/rdpStats';

/** The last second's rates, for the benchmark (scripts/gui-e2e.js, run rdpbench). */
declare global { interface Window { __flintRdpRates?: StatsRates & { pipeline: string; renderer: string } } }

export function RdpStatsOverlay({ session, renderer, meter }: { session: string; renderer: string; meter: FrameMeter }) {
  const last = useRef<StatsSample | null>(null);
  const [view, setView] = useState<{ rates: StatsRates; core: RdpStats } | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      let core: RdpStats;
      try {
        core = await api.rdpStats(session);
      } catch {
        return;
      }
      if (stop) return;
      const now: StatsSample = { at: performance.now(), drawn: meter.frames, read: meter.bytes, core };
      if (last.current) {
        const rates = ratesBetween(last.current, now);
        setView({ rates, core });
        window.__flintRdpRates = { ...rates, pipeline: pipelineLabel(core), renderer };
      }
      last.current = now;
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => { stop = true; window.clearInterval(id); };
  }, [session, meter, renderer]);

  const r = view?.rates;
  return (
    <div className="rdp-stats mono" data-rdp-stats role="status" aria-label="Desktop statistics">
      <div><span className="faint">drawn</span> {r ? r.fps.toFixed(0) : '…'} fps</div>
      <div><span className="faint">server</span> {r ? r.updates.toFixed(0) : '…'} updates/s</div>
      <div><span className="faint">in</span> {r ? formatKbps(r.kbps) : '…'}</div>
      {view && view.core.pipeline === 'gfx' && <div><span className="faint">decode</span> {r!.decodeMs.toFixed(1)} ms</div>}
      <div className="faint" data-rdp-pipeline>{view ? pipelineLabel(view.core) : ''}</div>
      <div className="faint" data-rdp-renderer>{renderer === 'webgl' ? 'drawn with WebGL' : renderer === '2d' ? 'drawn in 2D' : ''}{view && !view.core.h264 ? ' · no H.264 here' : ''}</div>
    </div>
  );
}

function formatKbps(k: number): string {
  return k >= 1000 ? `${(k / 1000).toFixed(1)} Mbit/s` : `${k.toFixed(0)} kbit/s`;
}
