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
import { api, on } from '../api/backend';
import { useApp } from '../state/app';
import { runAction } from '../shell/actions';
import { CursorCache, fitScale, HeldKeys, LOCK_KEYS, LockSync, modMapOf, parseFrameHeader, rdpButton, rdpKeptAction, toDesktop, unicodeText, WheelAccumulator, type CursorImage, type RdpCursorEvent } from '../lib/rdpInput';
import { createRenderer, type DeskRenderer } from '../lib/deskRenderer';
import { FrameMeter, graphicsChoiceLabel } from '../lib/rdpStats';
import { sessions, type Pane } from './store';
import { cropPoint, monitors, useMonitors } from './monitors';
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

  // The lock keys (milestone 58): the remote's follow this machine's. Each key and
  // pointer event carries their state and a change is sent; a new connection and the
  // focus coming back start over, so the next event sends it again (as mstsc does on
  // focus). The lock keys themselves are never sent as presses (HeldKeys).
  const locks = useRef<LockSync | null>(null);
  useEffect(() => {
    locks.current = new LockSync((f) => { if (session) api.rdpLocks(session, f).catch(() => {}); }, os);
    return () => { locks.current = null; };
  }, [session, os, desk]);
  const seen = (e: { getModifierState(k: string): boolean }) => { if (ready) locks.current?.seen(e); };

  // The remote pointer's shape (milestone 58): the server's images, kept by id, become
  // the canvas's CSS cursor, drawn at the desktop's scale.
  const cursors = useRef(new CursorCache());
  const [cursorTick, setCursorTick] = useState(0);
  useEffect(() => {
    if (!session) return;
    cursors.current = new CursorCache();
    return on<RdpCursorEvent>('rdp:cursor', (e) => {
      if (e.tab !== session) return;
      if (cursors.current.apply(e)) setCursorTick((n) => n + 1);
    });
  }, [session]);

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
    seen(e);
    if (LOCK_KEYS.includes(e.code)) { e.preventDefault(); e.stopPropagation(); return; }
    const kept = rdpKeptAction(e.nativeEvent, os);
    if (kept) {
      e.preventDefault();
      held.current?.releaseAll();
      runAction(kept);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // A character from no key (a Stream Deck's Text action) goes as Unicode.
    const text = unicodeText(e.nativeEvent);
    if (text !== null) {
      if (session) api.rdpText(session, text).catch(() => {});
      return;
    }
    held.current?.down(e.code);
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    seen(e);
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
  const point = (e: { clientX: number; clientY: number }) => {
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
  const onMouseMove = (e: { clientX: number; clientY: number; buttons: number; getModifierState?(k: string): boolean }) => {
    if (!ready) return;
    if (e.getModifierState) seen(e as { getModifierState(k: string): boolean });
    pendingMove.current = point(e);
    if (!moveFrame.current) moveFrame.current = requestAnimationFrame(flushMove);
  };
  // A drag that leaves the canvas (milestone 38): with a button held the system goes on
  // sending the pointer to this page, past the window's edge and over the next monitor,
  // but to the document, not the canvas. Until the button is let go the page's moves and
  // the release are read from the window too, or Windows would keep the button pressed
  // with the pointer stuck at the edge (a window dragged across stuck to the pointer).
  const dragOff = useRef<(() => void) | null>(null);
  const followDrag = () => {
    dragOff.current?.();
    const off = (e: MouseEvent) => e.target === canvas.current;
    const move = (e: MouseEvent) => { if (!off(e)) onMouseMove(e); };
    const up = (e: MouseEvent) => { if (!off(e)) onMouseButton(e, false); };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
    dragOff.current = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      dragOff.current = null;
    };
  };
  useEffect(() => () => dragOff.current?.(), []);
  // Automatic across monitors (milestone 38, D-091): with bitmaps Windows stops drawing
  // for seconds while a window crosses from one monitor to the other, so a tab in
  // Automatic takes the pipeline while it spans, and goes back to what its round trip
  // picks when it leaves. Only on a change, not when the view mounts. Spanning counts
  // from 'on' (the layout is with the engine, so the reconnect carries it) until 'off':
  // the re-span after that reconnect passes through 'arranging' and must not count as
  // leaving.
  const mon = useMonitors();
  const mine = mon.pane === pane.id;
  const wasSpanning = useRef(false);
  const spanOn = mine && mon.phase === 'on' ? true : !mine || mon.phase === 'off' ? false : wasSpanning.current;
  useEffect(() => {
    if (spanOn === wasSpanning.current) return;
    wasSpanning.current = spanOn;
    if (!spanOn) sessions.fitDesktopToArea(pane.id);
    sessions.autoForMonitors(pane.id, spanOn);
  }, [spanOn, pane.id]);
  const onMouseButton = (e: { clientX: number; clientY: number; button: number; buttons: number; preventDefault(): void; getModifierState?(k: string): boolean }, down: boolean) => {
    if (!ready || !session) return;
    if (e.getModifierState) seen(e as { getModifierState(k: string): boolean });
    const b = rdpButton(e.button);
    if (b < 0) return;
    e.preventDefault();
    if (down) canvas.current?.focus({ preventScroll: true });
    if (down) followDrag();
    else if (e.buttons === 0) dragOff.current?.();
    if (moveFrame.current) { cancelAnimationFrame(moveFrame.current); flushMove(); }
    const p = point(e);
    // A press is preceded by a move to its own point, as mstsc sends it: a remote app
    // that has seen no move there may take the first click only to focus (milestone 58).
    if (down) api.rdpPointer(session, { kind: 'move', button: 0, x: p.x, y: p.y, delta: 0 }).catch(() => {});
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
  const cursor = cursorStyle(cursors.current, scale, cursorTick);
  return (
    <div className="rdp-area" ref={area} data-rdp-pane={pane.id} data-rdp-session={session ?? ''}>
      <canvas key={canvasKey} ref={canvas} className={'rdp-canvas' + (ready ? '' : ' stale')} tabIndex={0} aria-label={`Remote desktop of ${pane.alias}`}
        data-desktop={deskSize.width ? `${deskSize.width}x${deskSize.height}` : ''} data-renderer={rendererKind}
        data-cursor={cursorKind(cursors.current)}
        style={{ width: shownW || 0, height: shownH || 0, visibility: deskSize.width ? 'visible' : 'hidden', cursor: ready ? cursor : undefined }}
        onKeyDown={onKeyDown} onKeyUp={onKeyUp} onFocus={() => { locks.current?.reset(); announce(); }} onBlur={() => held.current?.releaseAll()}
        onMouseMove={onMouseMove} onMouseDown={(e) => onMouseButton(e, true)} onMouseUp={(e) => onMouseButton(e, false)}
        onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
      {showStats && ready && session && <RdpStatsOverlay session={session} renderer={rendererKind} meter={meter.current}
        choice={graphicsChoiceLabel(pane.graphics, pane.desktop?.engine ?? '', pane.desktop?.rttMs ?? -1, monitors.spanning(pane.id))} />}
      <RdpCard pane={pane} active={active} onEditHost={onEditHost} onKnownHosts={onKnownHosts} />
    </div>
  );
}

// The CSS cursors made from the server's images, by image and scale.
const cursorUrls = new WeakMap<CursorImage, Map<number, string>>();

/** An image as a CSS cursor value, drawn at `scale` (the desktop's in the tab). */
function cursorUrl(img: CursorImage, scale: number): string {
  let byScale = cursorUrls.get(img);
  if (!byScale) { byScale = new Map(); cursorUrls.set(img, byScale); }
  const known = byScale.get(scale);
  if (known) return known;
  const bytes = Uint8ClampedArray.from(atob(img.rgba), (c) => c.charCodeAt(0));
  let value = 'default';
  if (bytes.length === img.width * img.height * 4) {
    const src = document.createElement('canvas');
    src.width = img.width;
    src.height = img.height;
    src.getContext('2d')?.putImageData(new ImageData(bytes, img.width, img.height), 0, 0);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const g = out.getContext('2d');
    if (g) {
      g.imageSmoothingEnabled = scale < 1;
      g.drawImage(src, 0, 0, w, h);
      const hx = Math.min(w - 1, Math.round(img.hotX * scale));
      const hy = Math.min(h - 1, Math.round(img.hotY * scale));
      value = `url(${out.toDataURL('image/png')}) ${hx} ${hy}, default`;
    }
  }
  byScale.set(scale, value);
  return value;
}

/** The canvas's cursor for what the remote shows. `_tick` re-reads after a change. */
function cursorStyle(c: CursorCache, scale: number, _tick: number): string {
  const s = c.shown;
  if (s.kind === 'hidden') return 'none';
  if (s.kind === 'default') return 'default';
  const img = c.image(s.id);
  return img ? cursorUrl(img, scale) : 'default';
}

/** What the canvas shows, for the tests: "image:<id>", "hidden" or "default". */
function cursorKind(c: CursorCache): string {
  return c.shown.kind === 'image' ? `image:${c.shown.id}` : c.shown.kind;
}

/** The desktop's scale in the tab, for the toolbar: 1 when it fits as is. */
export function desktopScaleLabel(pane: Pane, areaW: number, areaH: number): string {
  if (!pane.desktop) return '';
  const s = Math.min(1, fitScale(areaW, areaH, pane.desktop.width, pane.desktop.height));
  return s >= 0.995 ? '' : `scaled to ${Math.round(s * 100)}%`;
}
