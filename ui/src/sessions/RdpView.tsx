// A remote desktop in its tab (milestone 30, design 22a): the desktop drawn on a
// canvas, scaled to fit and letterboxed on --surface-desk, with the keyboard and the
// pointer sent to it. Frames are read from the tab's local frame channel (D-071): a
// long poll that returns the region drawn since the last read, so a slow page skips
// frames instead of queueing them.
//
// The desktop follows the tab's size (in CSS pixels): the store opens the connection
// at the first size the view measures and resizes it once a new one settles.
//
// Milestone 34: frames are drawn through WebGL when the page has a real GPU, else with
// putImageData (lib/deskRenderer); the statistics overlay shows what the desktop costs.

import { useEffect, useRef, useState } from 'react';
import { api } from '../api/backend';
import { useApp } from '../state/app';
import { runAction } from '../shell/actions';
import { fitScale, HeldKeys, modMapOf, parseFrameHeader, rdpButton, rdpKeptAction, toDesktop, WheelAccumulator } from '../lib/rdpInput';
import { createRenderer, type DeskRenderer } from '../lib/deskRenderer';
import { FrameMeter, graphicsChoiceLabel } from '../lib/rdpStats';
import { sessions, type Pane } from './store';
import { cropPoint, monitors } from './monitors';
import { RdpCard } from './RdpCards';
import { RdpStatsOverlay } from './RdpStatsOverlay';

/** Tests force a renderer by setting this before the tab opens ('2d' or 'webgl'). */
declare global { interface Window { __flintRdpRenderer?: string } }

export function RdpView({ pane, active, showStats, onEditHost, onKnownHosts }: {
  pane: Pane;
  /** The tab is the one shown: it takes the keyboard. */
  active: boolean;
  /** The statistics overlay is on (the toolbar's Stats). */
  showStats: boolean;
  onEditHost: (alias: string) => void;
  onKnownHosts: () => void;
}) {
  const { os, settings } = useApp();
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });
  const [deskSize, setDeskSize] = useState({ width: 0, height: 0 });
  const ready = pane.status === 'ready' && pane.desktop !== null;
  const session = pane.session;
  // The canvas's renderer, made once per canvas element: a canvas keeps the first kind
  // of context it hands out, so a lost WebGL context remounts the canvas in 2D.
  const renderer = useRef<DeskRenderer | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const forced = useRef<string | null>(null);
  const meter = useRef(new FrameMeter());
  // gui-e2e's benchmark (run rdpbench) reads the frames drawn.
  useEffect(() => {
    const e2e = (window as unknown as { __flintE2E?: Record<string, unknown> }).__flintE2E;
    if (e2e) e2e.rdpMeter = meter.current;
  }, []);
  const [rendererKind, setRendererKind] = useState('');

  // Settings → Remote desktop → Graphics, for the next connection.
  useEffect(() => { sessions.setDesktopGraphics(settings.rdp_graphics); }, [settings.rdp_graphics]);

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
    if (!cv) return;
    if (!renderer.current) {
      renderer.current = createRenderer(cv, forced.current ?? window.__flintRdpRenderer ?? null);
      setRendererKind(renderer.current?.kind ?? '');
    }
    const r0 = renderer.current;
    if (!r0) return;
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
        if (r0.lost()) {
          // The GPU went away: start again on a new canvas, in 2D.
          forced.current = '2d';
          renderer.current = null;
          setCanvasKey((k) => k + 1);
          break;
        }
        if (cv.width !== h.fullW || cv.height !== h.fullH) {
          r0.resize(h.fullW, h.fullH);
          setDeskSize({ width: h.fullW, height: h.fullH });
          sessions.desktopDrawn(pane.id, h.fullW, h.fullH);
        }
        r0.draw(h.x, h.y, h.w, h.h, new Uint8Array(buf, 16));
        meter.current.add(buf.byteLength);
      }
    })();
    return () => { stop = true; };
  }, [ready, desk, canvasKey]);

  useEffect(() => () => { renderer.current?.dispose(); renderer.current = null; }, [canvasKey]);

  // Input: keys while the canvas has the focus, released when it loses it.
  // The modifier keys of a Mac keyboard follow Settings → Remote desktop (D-074).
  const held = useRef<HeldKeys | null>(null);
  const modPreset = settings.rdp_mac_keys;
  const modCustom = settings.rdp_mac_custom;
  useEffect(() => {
    held.current = new HeldKeys((code, down) => { if (session) api.rdpKey(session, code, down).catch(() => {}); }, os, modMapOf(modPreset, modCustom));
    return () => { held.current?.releaseAll(); held.current = null; };
  }, [session, os, modPreset, modCustom]);

  useEffect(() => {
    if (ready && active) canvas.current?.focus({ preventScroll: true });
  }, [ready, active]);

  // The clipboard (milestone 31, D-074): whenever the desktop takes the keyboard (the
  // tab, the canvas, the window coming back), the server learns whether this machine's
  // clipboard holds text, so a paste there can ask for it. The text is sent only then.
  const announce = () => { if (ready && session) api.rdpClipboardAnnounce(session).catch(() => {}); };
  useEffect(() => {
    if (!ready || !active) return;
    const onWindowFocus = () => { if (document.activeElement === canvas.current) announce(); };
    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  });

  // An extra monitor's window (milestone 38) sends its input here: the same keys path
  // (the Mac's modifiers, the chords Flint keeps, the held keys) and the same pointer.
  useEffect(() => {
    if (!ready || !session) return;
    monitors.setInput(pane.id, {
      key: (k) => {
        if (k.down) {
          const kept = rdpKeptAction(k, os);
          if (kept) { held.current?.releaseAll(); runAction(kept); return; }
          held.current?.down(k.code);
        } else {
          held.current?.up(k.code);
        }
      },
      pointer: (p) => { api.rdpPointer(session, p).catch(() => {}); },
      focus: () => { api.rdpClipboardAnnounce(session).catch(() => {}); },
      blur: () => held.current?.releaseAll(),
    });
    return () => monitors.setInput(pane.id, null);
  }, [ready, session, pane.id, os]);

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
  // Spanning monitors (milestone 38), this canvas shows the primary's part of the
  // surface: its pointer lands at that part's place.
  const point = (e: React.MouseEvent | React.WheelEvent) => {
    const cv = canvas.current!;
    const r = cv.getBoundingClientRect();
    const box = monitors.spanBox(pane.id);
    if (box) {
      // Not held to this monitor: a drag that leaves it goes on into the next (cropPoint).
      const o = monitors.mainOffset(pane.id);
      return cropPoint(e.clientX - r.left, e.clientY - r.top, r.width, r.height, { x: o.x, y: o.y, width: cv.width, height: cv.height }, box);
    }
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
    <div className="rdp-area" ref={area} data-rdp-pane={pane.id} data-rdp-session={session ?? ''}>
      <canvas key={canvasKey} ref={canvas} className={'rdp-canvas' + (ready ? '' : ' stale')} tabIndex={0} aria-label={`Remote desktop of ${pane.alias}`}
        data-desktop={deskSize.width ? `${deskSize.width}x${deskSize.height}` : ''} data-renderer={rendererKind}
        style={{ width: shownW || 0, height: shownH || 0, visibility: deskSize.width ? 'visible' : 'hidden' }}
        onKeyDown={onKeyDown} onKeyUp={onKeyUp} onFocus={announce} onBlur={() => held.current?.releaseAll()}
        onMouseMove={onMouseMove} onMouseDown={(e) => onMouseButton(e, true)} onMouseUp={(e) => onMouseButton(e, false)}
        onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
      {showStats && ready && session && <RdpStatsOverlay session={session} renderer={rendererKind} meter={meter.current}
        choice={graphicsChoiceLabel(pane.graphics, pane.desktop?.engine ?? '', pane.desktop?.rttMs ?? -1)} />}
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
