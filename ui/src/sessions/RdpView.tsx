// A remote desktop in its tab (milestone 30, design 22a): the desktop drawn on a
// canvas, scaled to fit and letterboxed on --surface-desk, with the keyboard and the
// pointer sent to it. Frames are read from the tab's local frame channel (D-071): a
// long poll that returns the region drawn since the last read, so a slow page skips
// frames instead of queueing them.
//
// The desktop follows the tab's size (in CSS pixels): the store opens the connection
// at the first size the view measures and resizes it once a new one settles.

import { useEffect, useRef, useState } from 'react';
import { api } from '../api/backend';
import { useApp } from '../state/app';
import { runAction } from '../shell/actions';
import { fitScale, HeldKeys, parseFrameHeader, rdpButton, rdpKeptAction, toDesktop, WheelAccumulator } from '../lib/rdpInput';
import { sessions, type Pane } from './store';
import { RdpCard } from './RdpCards';

export function RdpView({ pane, active, onEditHost, onKnownHosts }: {
  pane: Pane;
  /** The tab is the one shown: it takes the keyboard. */
  active: boolean;
  onEditHost: (alias: string) => void;
  onKnownHosts: () => void;
}) {
  const { os } = useApp();
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });
  const [deskSize, setDeskSize] = useState({ width: 0, height: 0 });
  const ready = pane.status === 'ready' && pane.desktop !== null;
  const session = pane.session;

  // The tab's area: the first size opens the connection, later ones resize it.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      setAreaSize({ width: r.width, height: r.height });
      sessions.desktopArea(pane.id, r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pane.id]);

  // The frame loop, while the desktop is up.
  const desk = pane.desktop;
  useEffect(() => {
    if (!ready || !desk) return;
    const cv = canvas.current;
    const ctx = cv?.getContext('2d', { alpha: false });
    if (!cv || !ctx) return;
    let stop = false;
    const url = `http://127.0.0.1:${desk.port}/next?t=${desk.token}`;
    (async () => {
      while (!stop) {
        let buf: ArrayBuffer;
        try {
          const r = await fetch(url, { cache: 'no-store' });
          if (r.status !== 200) break;
          buf = await r.arrayBuffer();
        } catch {
          break;
        }
        if (stop) break;
        const h = parseFrameHeader(buf);
        if (!h) continue;
        if (cv.width !== h.fullW || cv.height !== h.fullH) {
          cv.width = h.fullW;
          cv.height = h.fullH;
          setDeskSize({ width: h.fullW, height: h.fullH });
        }
        ctx.putImageData(new ImageData(new Uint8ClampedArray(buf, 16), h.w, h.h), h.x, h.y);
      }
    })();
    return () => { stop = true; };
  }, [ready, desk]);

  // Input: keys while the canvas has the focus, released when it loses it.
  const held = useRef<HeldKeys | null>(null);
  useEffect(() => {
    held.current = new HeldKeys((code, down) => { if (session) api.rdpKey(session, code, down).catch(() => {}); }, os);
    return () => { held.current?.releaseAll(); held.current = null; };
  }, [session, os]);

  useEffect(() => {
    if (ready && active) canvas.current?.focus({ preventScroll: true });
  }, [ready, active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const kept = rdpKeptAction(e.nativeEvent, os);
    if (kept) {
      e.preventDefault();
      held.current?.releaseAll();
      runAction(kept);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    held.current?.down(e.code);
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    held.current?.up(e.code);
  };

  // The pointer, in desktop pixels. Moves are sent once per frame.
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const moveFrame = useRef(0);
  const wheel = useRef(new WheelAccumulator());
  const point = (e: React.MouseEvent | React.WheelEvent) => {
    const cv = canvas.current!;
    const r = cv.getBoundingClientRect();
    return toDesktop(e.clientX - r.left, e.clientY - r.top, r.width, r.height, cv.width, cv.height);
  };
  const flushMove = () => {
    moveFrame.current = 0;
    const m = pendingMove.current;
    pendingMove.current = null;
    if (m && session) api.rdpPointer(session, { kind: 'move', button: 0, x: m.x, y: m.y, delta: 0 }).catch(() => {});
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!ready) return;
    pendingMove.current = point(e);
    if (!moveFrame.current) moveFrame.current = requestAnimationFrame(flushMove);
  };
  const onMouseButton = (e: React.MouseEvent, down: boolean) => {
    if (!ready || !session) return;
    const b = rdpButton(e.button);
    if (b < 0) return;
    e.preventDefault();
    if (down) canvas.current?.focus({ preventScroll: true });
    if (moveFrame.current) { cancelAnimationFrame(moveFrame.current); flushMove(); }
    const p = point(e);
    api.rdpPointer(session, { kind: down ? 'down' : 'up', button: b, x: p.x, y: p.y, delta: 0 }).catch(() => {});
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!ready || !session) return;
    const p = point(e);
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const notches = wheel.current.push(horizontal ? -e.deltaX : e.deltaY, e.deltaMode);
    for (const d of notches) api.rdpPointer(session, { kind: horizontal ? 'hwheel' : 'wheel', button: 0, x: p.x, y: p.y, delta: d }).catch(() => {});
  };

  // Never larger than 1:1: a desktop that could not follow the tab is letterboxed sharp.
  const scale = Math.min(1, fitScale(areaSize.width, areaSize.height, deskSize.width, deskSize.height));
  const shownW = Math.floor(deskSize.width * scale);
  const shownH = Math.floor(deskSize.height * scale);
  return (
    <div className="rdp-area" ref={area} data-rdp-pane={pane.id}>
      <canvas ref={canvas} className="rdp-canvas" tabIndex={0} aria-label={`Remote desktop of ${pane.alias}`}
        data-desktop={deskSize.width ? `${deskSize.width}x${deskSize.height}` : ''}
        style={{ width: shownW || 0, height: shownH || 0, visibility: deskSize.width ? 'visible' : 'hidden' }}
        onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={() => held.current?.releaseAll()}
        onMouseMove={onMouseMove} onMouseDown={(e) => onMouseButton(e, true)} onMouseUp={(e) => onMouseButton(e, false)}
        onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
      <RdpCard pane={pane} active={active} onEditHost={onEditHost} onKnownHosts={onKnownHosts} />
    </div>
  );
}

/** The desktop's scale in the tab, for the toolbar: 1 when it fits as is. */
export function desktopScaleLabel(pane: Pane, areaW: number, areaH: number): string {
  if (!pane.desktop) return '';
  const s = Math.min(1, fitScale(areaW, areaH, pane.desktop.width, pane.desktop.height));
  return s >= 0.995 ? '' : `scaled to ${Math.round(s * 100)}%`;
}
