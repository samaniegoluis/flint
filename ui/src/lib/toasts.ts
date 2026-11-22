// The toast stack (milestone 46, D-106, D-109, designs 24a/24b): every message the
// page shows goes through one store. No React here, so the rules are tested with fake
// timers: per-call duration (6 s, errors 30 s), sticky toasts (progress, and what a
// call asks for), a stack of three, `key` replacing in place, a pause while the stack
// is hovered or focused.

export type ToastKind = 'ok' | 'error' | 'info';

export interface ToastAction {
  label: string;
  run: () => void;
  /** The toast stays up after the action runs (an action that changes it, e.g. Download → Downloading). */
  keepOpen?: boolean;
  /** In the accent colour: only the update's actions (Download, How to update), D-106 (2). */
  primary?: boolean;
}

export interface ToastOptions {
  text: string;
  kind?: ToastKind;
  /** Milliseconds on screen, or 'sticky' to stay until ✕ or an action. Errors default to 30 s, progress toasts to sticky (D-109). */
  duration?: number | 'sticky';
  /** Up to two buttons; any more are dropped. */
  actions?: ToastAction[];
  /** A toast with the same key is replaced in place instead of stacking a new one. */
  key?: string;
  /** A percentage (0-100) shown at a fixed width on the right. */
  progress?: number;
  /** false: a change of text is not read out (a notice updating often, milestone 56). */
  announce?: boolean;
}

export interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  actions: ToastAction[];
  key?: string;
  progress?: number;
  sticky: boolean;
  /** Set while the exit animation runs; the toast is gone EXIT_MS later. */
  leaving: boolean;
}

export const DEFAULT_DURATION_MS = 6000;
/** Errors stay longer, so a long one is read, but still leave (D-109). */
export const ERROR_DURATION_MS = 30_000;
/** A toast whose button offers what is also reachable elsewhere (20d2's Stop them, 23e1's Details): time to reach it (D-110). */
export const ACTION_DURATION_MS = 15_000;
export const MAX_VISIBLE = 3;
export const MAX_ACTIONS = 2;
export const EXIT_MS = 160;

interface Entry {
  item: ToastItem;
  /** ms left on its timer; ignored for sticky toasts. */
  remaining: number;
  startedAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

export interface Announcement { id: number; text: string; kind: ToastKind }

type Listener = () => void;

export class ToastStore {
  private shown: Entry[] = [];   // oldest first; the view puts the last one closest to the corner
  private waiting: Entry[] = []; // plain toasts held back while three sticky ones fill the stack
  private next = 1;
  private paused = false;
  private listeners = new Set<Listener>();
  private snapshot: ToastItem[] = [];
  private last: Announcement | null = null;

  subscribe = (fn: Listener) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  /** The toasts on screen, oldest first. Stable between changes (useSyncExternalStore). */
  list = (): ToastItem[] => this.snapshot;
  /** The latest toast added or changed in text, for the aria-live regions. */
  announcement = (): Announcement | null => this.last;

  show(opts: ToastOptions): number {
    const kind = opts.kind ?? 'ok';
    const sticky = opts.duration === 'sticky' || (opts.duration === undefined && opts.progress !== undefined);
    const ms = typeof opts.duration === 'number' ? Math.max(0, opts.duration)
      : kind === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS;
    const actions = (opts.actions ?? []).slice(0, MAX_ACTIONS);

    const same = opts.key !== undefined
      ? [...this.shown, ...this.waiting].find((e) => e.item.key === opts.key && !e.item.leaving)
      : undefined;
    if (same) {
      this.stop(same);
      const textChanged = same.item.text !== opts.text || same.item.kind !== kind;
      same.item = { ...same.item, text: opts.text, kind, actions, progress: opts.progress, sticky };
      same.remaining = ms;
      if (this.shown.includes(same)) this.start(same);
      if (textChanged && opts.announce !== false) this.last = { id: same.item.id, text: opts.text, kind };
      this.emit();
      return same.item.id;
    }

    const e: Entry = {
      item: { id: this.next++, text: opts.text, kind, actions, key: opts.key, progress: opts.progress, sticky, leaving: false },
      remaining: ms, startedAt: 0,
    };
    this.shown.push(e);
    this.fit();
    if (this.shown.includes(e)) {
      this.start(e);
      this.last = { id: e.item.id, text: e.item.text, kind };
    }
    this.emit();
    return e.item.id;
  }

  /** Whether a toast with `key` is on screen or waiting for a slot. */
  hasKey(key: string): boolean {
    return [...this.shown, ...this.waiting].some((e) => e.item.key === key && !e.item.leaving);
  }

  /** Closes the toast with `key`, if any. */
  dismissKey(key: string) {
    const e = [...this.shown, ...this.waiting].find((x) => x.item.key === key && !x.item.leaving);
    if (e) this.dismiss(e.item.id);
  }

  dismiss(id: number) {
    const w = this.waiting.findIndex((x) => x.item.id === id);
    if (w >= 0) { this.waiting.splice(w, 1); this.emit(); return; }
    const e = this.shown.find((x) => x.item.id === id);
    if (!e || e.item.leaving) return;
    this.stop(e);
    e.item = { ...e.item, leaving: true };
    this.emit();
    setTimeout(() => this.remove(e), EXIT_MS);
  }

  /** The newest toast still on screen, closed (Escape). */
  dismissNewest() {
    const e = [...this.shown].reverse().find((x) => !x.item.leaving);
    if (e) this.dismiss(e.item.id);
  }

  /** Runs one of a toast's actions, then closes it unless the action keeps it open. */
  act(id: number, index: number) {
    const e = this.shown.find((x) => x.item.id === id);
    const a = e?.item.actions[index];
    if (!e || !a || e.item.leaving) return;
    if (!a.keepOpen) this.dismiss(id);
    a.run();
  }

  /** The pointer or the focus is on the stack: every timer stops where it is. */
  pause() {
    if (this.paused) return;
    this.paused = true;
    for (const e of this.shown) this.stop(e);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    for (const e of this.shown) if (!e.item.leaving) this.start(e);
  }

  /** Everything gone at once, no animation (a test reset, a vault closed). */
  clear() {
    for (const e of this.shown) this.stop(e);
    this.shown = [];
    this.waiting = [];
    this.emit();
  }

  private start(e: Entry) {
    if (e.item.sticky || this.paused) return;
    e.startedAt = Date.now();
    e.timer = setTimeout(() => this.dismiss(e.item.id), e.remaining);
  }

  private stop(e: Entry) {
    if (e.timer === undefined) return;
    clearTimeout(e.timer);
    e.timer = undefined;
    e.remaining = Math.max(0, e.remaining - (Date.now() - e.startedAt));
  }

  // Over three: the oldest plain toast goes. A sticky one is never pushed out by a
  // plain one: with three sticky toasts up, a new plain toast waits for a slot. A
  // fourth sticky toast pushes out the oldest sticky one.
  private fit() {
    while (this.live().length > MAX_VISIBLE) {
      const live = this.live();
      const newest = live[live.length - 1];
      const plain = live.find((x) => !x.item.sticky);
      if (plain && plain !== newest) this.drop(plain);
      else if (plain === newest) { this.shown.splice(this.shown.indexOf(newest), 1); this.waiting.push(newest); }
      else this.drop(live[0]);
    }
  }

  private live() { return this.shown.filter((x) => !x.item.leaving); }

  private drop(e: Entry) {
    this.stop(e);
    this.shown.splice(this.shown.indexOf(e), 1);
  }

  private remove(e: Entry) {
    const i = this.shown.indexOf(e);
    if (i < 0) return;
    this.shown.splice(i, 1);
    if (this.waiting.length && this.live().length < MAX_VISIBLE) {
      const w = this.waiting.shift()!;
      this.shown.push(w);
      this.start(w);
      this.last = { id: w.item.id, text: w.item.text, kind: w.item.kind };
    }
    this.emit();
  }

  private emit() {
    this.snapshot = this.shown.map((e) => e.item);
    for (const fn of this.listeners) fn();
  }
}
