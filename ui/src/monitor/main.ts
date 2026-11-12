// An extra monitor's window (milestone 38, design 22f3): the remote desktop's part that
// falls on this monitor, edge to edge, with no bar of its own (it lives on the main
// monitor). The window is opened by the native shim (flint_monitors.hpp) and has no
// RPC of its own: it talks to the process through the `flintMonitor` message handler,
// and the main page answers through `window.__flint_monitor`.
//
//   → { type: 'ready', width, height }    the size it came out, again on every change
//   ← { type: 'show', port, token, view, crop }   read view `view` of the frame channel
//   ← { type: 'state', state: 'lost' | 'rearranging' }   22f3b, 22f3c
//   → { type: 'key' | 'pointer' | 'focus' | 'blur', … }   input, sent on by the main page
//   ← { type: 'probe' } → { type: 'probe', … }   what is drawn, for gui-e2e
//   ← { type: 'e2e-input', … }   gui-e2e moves the pointer or presses a key here, as a
//     person would (the input then takes the window's own path)

import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/primitives.css';
import { injectSprite } from '../ui/Icon';
import { createRenderer, type DeskRenderer } from '../lib/deskRenderer';
import { parseFrameHeader, rdpButton, WheelAccumulator } from '../lib/rdpInput';
import { cropPoint } from '../sessions/monitors';
import type { DesktopRect } from '../api/types';

declare global {
  interface Window {
    __flint_monitor?: (msg: Record<string, unknown>) => void;
    webkit?: { messageHandlers?: Record<string, { postMessage(s: string): void }> };
    chrome?: { webview?: { postMessage(s: string): void } };
  }
}

injectSprite();

function post(msg: Record<string, unknown>) {
  const s = JSON.stringify(msg);
  const h = window.webkit?.messageHandlers?.flintMonitor;
  if (h) h.postMessage(s);
  else window.chrome?.webview?.postMessage(s);
}

const root = document.getElementById('mon')!;
const cv = document.getElementById('desk') as HTMLCanvasElement;
let renderer: DeskRenderer | null = null;
let crop: DesktopRect = { x: 0, y: 0, width: 0, height: 0 };
let reading = 0;
let frames = 0;
let card: HTMLElement | null = null;

// The theme follows the system's (the main page's own choice does not reach here).
const dark = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
document.documentElement.dataset.theme = dark;

function layout() {
  // 1:1 when the crop is the window's size (it was measured for it); else fitted.
  const s = crop.width ? Math.min(1, window.innerWidth / crop.width, window.innerHeight / crop.height) : 1;
  cv.style.width = `${Math.floor(crop.width * s)}px`;
  cv.style.height = `${Math.floor(crop.height * s)}px`;
}

function setState(state: string) {
  card?.remove();
  card = null;
  root.classList.toggle('dim', state === 'lost' || state === 'rearranging');
  if (state === 'lost') {
    card = document.createElement('div');
    card.className = 'ext-card';
    card.setAttribute('role', 'status');
    card.dataset.monitorState = 'lost';
    card.innerHTML = '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-wifi-off"></use></svg><span>Connection lost — see the main screen</span>';
  } else if (state === 'rearranging') {
    card = document.createElement('div');
    card.className = 'ext-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-busy', 'true');
    card.dataset.monitorState = 'rearranging';
    card.innerHTML = '<span class="mini-spin" style="width: 12px; height: 12px"></span><span>Rearranging…</span>';
  }
  if (card) root.appendChild(card);
}

async function read(port: number, token: string, view: number, run: number) {
  if (!renderer) renderer = createRenderer(cv, null);
  const url = `http://127.0.0.1:${port}/next?t=${token}&v=${view}`;
  while (run === reading) {
    let buf: ArrayBuffer;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.status !== 200) return;
      buf = await r.arrayBuffer();
    } catch {
      return;
    }
    if (run !== reading || !renderer) return;
    const h = parseFrameHeader(buf);
    if (!h) continue;
    if (cv.width !== h.fullW || cv.height !== h.fullH) renderer.resize(h.fullW, h.fullH);
    renderer.draw(h.x, h.y, h.w, h.h, new Uint8Array(buf, 16));
    frames++;
    if (card?.dataset.monitorState === 'rearranging' && h.fullW === crop.width && h.fullH === crop.height) setState('');
  }
}

window.__flint_monitor = (msg) => {
  if (msg.type === 'show') {
    crop = msg.crop as DesktopRect;
    layout();
    reading++;
    void read(Number(msg.port), String(msg.token), Number(msg.view), reading);
  } else if (msg.type === 'state') {
    setState(String(msg.state));
  } else if (msg.type === 'e2e-input') {
    if (msg.key) {
      for (const down of [true, false]) cv.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: String(msg.key), key: 'a', bubbles: true, cancelable: true }));
    } else {
      // A click: it goes out at once, where a move waits for the next frame.
      const r = cv.getBoundingClientRect();
      const at = { clientX: r.left + Number(msg.x), clientY: r.top + Number(msg.y), bubbles: true, button: 0 };
      cv.dispatchEvent(new MouseEvent('mousedown', at));
      cv.dispatchEvent(new MouseEvent('mouseup', at));
    }
  } else if (msg.type === 'probe') {
    // What is drawn, for gui-e2e: the canvas's size, the frames, and a few pixels.
    let pixels: number[] = [];
    try {
      const c2 = document.createElement('canvas');
      c2.width = cv.width; c2.height = cv.height;
      const g = c2.getContext('2d')!;
      g.drawImage(cv, 0, 0);
      const at = (x: number, y: number) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
      pixels = [...at(2, 2), ...at(cv.width >> 1, cv.height >> 1)];
    } catch { /* a lost context draws nothing */ }
    post({ type: 'probe', width: cv.width, height: cv.height, frames, crop, state: card?.dataset.monitorState ?? '', pixels, inner: [window.innerWidth, window.innerHeight] });
  }
};

// The size this window came out, once it settles in full screen, and on every change.
let readyTimer = 0;
const ready = () => {
  window.clearTimeout(readyTimer);
  readyTimer = window.setTimeout(() => {
    post({ type: 'ready', width: window.innerWidth, height: window.innerHeight });
    layout();
  }, 300);
};
window.addEventListener('resize', ready);
ready();

// Input: in the surface's pixels, sent on by the main page.
const point = (e: MouseEvent) => {
  const r = cv.getBoundingClientRect();
  return cropPoint(e.clientX - r.left, e.clientY - r.top, r.width, r.height, crop);
};
let pending: { x: number; y: number } | null = null;
let moveFrame = 0;
const flush = () => {
  moveFrame = 0;
  if (pending) post({ type: 'pointer', kind: 'move', button: 0, x: pending.x, y: pending.y, delta: 0 });
  pending = null;
};
cv.addEventListener('mousemove', (e) => {
  if (!crop.width) return;
  pending = point(e);
  if (!moveFrame) moveFrame = requestAnimationFrame(flush);
});
const button = (e: MouseEvent, down: boolean) => {
  if (!crop.width) return;
  const b = rdpButton(e.button);
  if (b < 0) return;
  e.preventDefault();
  if (down) cv.focus({ preventScroll: true });
  if (moveFrame) { cancelAnimationFrame(moveFrame); flush(); }
  const p = point(e);
  post({ type: 'pointer', kind: down ? 'down' : 'up', button: b, x: p.x, y: p.y, delta: 0 });
};
cv.addEventListener('mousedown', (e) => button(e, true));
cv.addEventListener('mouseup', (e) => button(e, false));
cv.addEventListener('contextmenu', (e) => e.preventDefault());
const wheel = new WheelAccumulator();
cv.addEventListener('wheel', (e) => {
  if (!crop.width) return;
  e.preventDefault();
  const p = point(e);
  const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  for (const d of wheel.push(horizontal ? -e.deltaX : e.deltaY, e.deltaMode)) post({ type: 'pointer', kind: horizontal ? 'hwheel' : 'wheel', button: 0, x: p.x, y: p.y, delta: d });
}, { passive: false });
const key = (e: KeyboardEvent, down: boolean) => {
  e.preventDefault();
  e.stopPropagation();
  post({ type: 'key', code: e.code, down, key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey });
};
cv.addEventListener('keydown', (e) => key(e, true));
cv.addEventListener('keyup', (e) => key(e, false));
window.addEventListener('focus', () => { cv.focus({ preventScroll: true }); post({ type: 'focus' }); });
window.addEventListener('blur', () => post({ type: 'blur' }));
