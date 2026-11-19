import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DURATION_MS, ERROR_DURATION_MS, EXIT_MS, ToastStore } from './toasts';

const texts = (s: ToastStore) => s.list().filter((t) => !t.leaving).map((t) => t.text);

describe('ToastStore', () => {
  let s: ToastStore;
  beforeEach(() => { vi.useFakeTimers(); s = new ToastStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('leaves after 6 s by default, with an exit animation first', () => {
    s.show({ text: 'Saved' });
    vi.advanceTimersByTime(DEFAULT_DURATION_MS - 1);
    expect(texts(s)).toEqual(['Saved']);
    vi.advanceTimersByTime(1);
    expect(s.list()[0].leaving).toBe(true);
    vi.advanceTimersByTime(EXIT_MS);
    expect(s.list()).toEqual([]);
  });

  it('takes a duration per call', () => {
    s.show({ text: 'quick', duration: 1000 });
    s.show({ text: 'slow', duration: 9000 });
    vi.advanceTimersByTime(1000 + EXIT_MS);
    expect(texts(s)).toEqual(['slow']);
  });

  it('keeps errors 30 s, and progress and sticky toasts until closed', () => {
    s.show({ text: 'Upload failed', kind: 'error' });
    const prog = s.show({ text: 'Downloading', kind: 'info', progress: 7 });
    s.show({ text: 'Decide', duration: 'sticky' });
    vi.advanceTimersByTime(ERROR_DURATION_MS - 1);
    expect(texts(s)).toEqual(['Upload failed', 'Downloading', 'Decide']);
    vi.advanceTimersByTime(1 + EXIT_MS);
    expect(texts(s)).toEqual(['Downloading', 'Decide']);
    vi.advanceTimersByTime(10 * 60_000);
    expect(texts(s)).toEqual(['Downloading', 'Decide']);
    s.dismiss(prog);
    vi.advanceTimersByTime(EXIT_MS);
    expect(texts(s)).toEqual(['Decide']);
  });

  it('keeps an error until closed when the call says sticky', () => {
    s.show({ text: 'Keep me', kind: 'error', duration: 'sticky' });
    vi.advanceTimersByTime(10 * 60_000);
    expect(texts(s)).toEqual(['Keep me']);
  });

  it('pauses every timer while hovered or focused, and resumes with the time left', () => {
    s.show({ text: 'Saved' });
    vi.advanceTimersByTime(4000);
    s.pause();
    vi.advanceTimersByTime(30_000);
    expect(texts(s)).toEqual(['Saved']);
    s.resume();
    vi.advanceTimersByTime(1999);
    expect(texts(s)).toEqual(['Saved']);
    vi.advanceTimersByTime(1);
    expect(texts(s)).toEqual([]);
  });

  it('starts a toast that arrives during a pause only on resume', () => {
    s.pause();
    s.show({ text: 'Saved' });
    vi.advanceTimersByTime(10_000);
    expect(texts(s)).toEqual(['Saved']);
    s.resume();
    vi.advanceTimersByTime(DEFAULT_DURATION_MS);
    expect(texts(s)).toEqual([]);
  });

  it('stacks three at most, pushing out the oldest plain toast', () => {
    for (const t of ['a', 'b', 'c', 'd']) s.show({ text: t });
    expect(texts(s)).toEqual(['b', 'c', 'd']);
  });

  it('never lets a plain toast push out a sticky one', () => {
    s.show({ text: 'error 1', kind: 'error', duration: 'sticky' });
    s.show({ text: 'plain' });
    s.show({ text: 'error 2', kind: 'error', duration: 'sticky' });
    s.show({ text: 'error 3', kind: 'error', duration: 'sticky' });
    expect(texts(s)).toEqual(['error 1', 'error 2', 'error 3']);
  });

  it('holds a plain toast back while three sticky ones fill the stack', () => {
    const first = s.show({ text: 'e1', kind: 'error', duration: 'sticky' });
    s.show({ text: 'e2', kind: 'error', duration: 'sticky' });
    s.show({ text: 'e3', kind: 'error', duration: 'sticky' });
    s.show({ text: 'Saved' });
    expect(texts(s)).toEqual(['e1', 'e2', 'e3']);
    s.dismiss(first);
    vi.advanceTimersByTime(EXIT_MS);
    expect(texts(s)).toEqual(['e2', 'e3', 'Saved']);
    expect(s.announcement()?.text).toBe('Saved');
    vi.advanceTimersByTime(DEFAULT_DURATION_MS + EXIT_MS);
    expect(texts(s)).toEqual(['e2', 'e3']);
  });

  it('lets a fourth sticky toast push out the oldest sticky one', () => {
    for (const t of ['e1', 'e2', 'e3', 'e4']) s.show({ text: t, kind: 'error', duration: 'sticky' });
    expect(texts(s)).toEqual(['e2', 'e3', 'e4']);
  });

  it('replaces a toast with the same key in place', () => {
    const a = s.show({ text: 'Flint 1.4.0 is available', kind: 'info', duration: 'sticky', key: 'update' });
    s.show({ text: 'other' });
    const b = s.show({ text: 'Downloading Flint 1.4.0', kind: 'info', progress: 7, key: 'update' });
    expect(b).toBe(a);
    expect(texts(s)).toEqual(['Downloading Flint 1.4.0', 'other']);
    expect(s.list()[0].progress).toBe(7);
    s.show({ text: 'Downloading Flint 1.4.0', kind: 'info', progress: 42, key: 'update' });
    expect(s.list()[0].progress).toBe(42);
  });

  it('restarts the timer of a toast replaced by key', () => {
    s.show({ text: 'one', key: 'k' });
    vi.advanceTimersByTime(5000);
    s.show({ text: 'two', key: 'k' });
    vi.advanceTimersByTime(5000);
    expect(texts(s)).toEqual(['two']);
    vi.advanceTimersByTime(1000);
    expect(texts(s)).toEqual([]);
  });

  it('keeps two buttons at most', () => {
    const run = () => {};
    s.show({ text: 'x', actions: [{ label: 'A', run }, { label: 'B', run }, { label: 'C', run }] });
    expect(s.list()[0].actions.map((a) => a.label)).toEqual(['A', 'B']);
  });

  it('closes the toast after its action unless the action keeps it open', () => {
    const ran: string[] = [];
    const id = s.show({ text: 'Tab closed', actions: [{ label: 'Stop them', run: () => ran.push('stop') }] });
    const keep = s.show({ text: 'Available', duration: 'sticky', actions: [{ label: 'Download', run: () => ran.push('dl'), keepOpen: true }] });
    s.act(id, 0);
    s.act(keep, 0);
    vi.advanceTimersByTime(EXIT_MS);
    expect(ran).toEqual(['stop', 'dl']);
    expect(texts(s)).toEqual(['Available']);
  });

  it('closes the newest with Escape', () => {
    s.show({ text: 'old', kind: 'error' });
    s.show({ text: 'new', kind: 'error' });
    s.dismissNewest();
    vi.advanceTimersByTime(EXIT_MS);
    expect(texts(s)).toEqual(['old']);
  });

  it('gives every toast its own id, even in the same millisecond', () => {
    const a = s.show({ text: 'a' });
    const b = s.show({ text: 'b' });
    expect(a).not.toBe(b);
    s.dismiss(a);
    vi.advanceTimersByTime(EXIT_MS);
    expect(texts(s)).toEqual(['b']);
  });

  it('announces new toasts and changed text, not a progress tick', () => {
    s.show({ text: 'Downloading', kind: 'info', progress: 1, key: 'd' });
    const first = s.announcement();
    s.show({ text: 'Downloading', kind: 'info', progress: 50, key: 'd' });
    expect(s.announcement()).toBe(first);
    s.show({ text: 'Ready', kind: 'info', key: 'd', duration: 'sticky' });
    expect(s.announcement()?.text).toBe('Ready');
  });

  it('keeps the same snapshot between changes', () => {
    s.show({ text: 'a' });
    expect(s.list()).toBe(s.list());
  });
});
