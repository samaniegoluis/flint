import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityAddedEvent, ActivityFinishedEvent } from '../api/types';
import { GrantNotices, NOTICE_ANNOUNCE_MS, NOTICE_HIDE_MS, entryHosts, noticeKey, noticeText } from './grantNotices';
import { EXIT_MS, ToastStore } from './toasts';

const live = (s: ToastStore) => s.list().filter((t) => !t.leaving);
const texts = (s: ToastStore) => live(s).map((t) => t.text);

let next = 1;
function added(grant: string, hosts: string, over: Partial<ActivityAddedEvent> = {}): ActivityAddedEvent {
  return { id: next++, outcome: 'allowed', grant, notify: true, program: 'Claude Code', hosts, action: 'exec', at: 0, state: 'running', ...over };
}
const finished = (e: ActivityAddedEvent, exit = 0): ActivityFinishedEvent => ({ id: e.id, grant: e.grant, exit, duration_ms: 400, result: '' });

describe('GrantNotices', () => {
  let toasts: ToastStore;
  let n: GrantNotices;
  const viewed: string[] = [];
  const stopped: string[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    toasts = new ToastStore();
    viewed.length = 0; stopped.length = 0;
    n = new GrantNotices(toasts, { view: (g) => viewed.push(g), stop: (g) => stopped.push(g) });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('names the program and the hosts, never the command, and counts in place', () => {
    const a = added('g1', 'db1');
    n.added(a);
    expect(texts(toasts)).toEqual(['Claude Code ran a command on db1']);
    n.finished(finished(a));
    for (let i = 0; i < 8; i++) n.added(added('g1', 'db1'));
    n.added(added('g1', 'nas'));
    expect(texts(toasts)).toEqual(['Claude Code ran 10 commands on db1, nas']);
    expect(live(toasts)[0].key).toBe(noticeKey('g1'));
    expect(live(toasts)[0].actions.map((x) => x.label)).toEqual(['View', 'Stop']);
  });

  it('ignores a grant that does not notify, a refusal and a request outside any grant', () => {
    n.added(added('g1', 'db1', { notify: false }));
    n.added(added('g1', 'db1', { outcome: 'denied' }));
    n.added(added('', 'db1'));
    expect(texts(toasts)).toEqual([]);
  });

  it('stays while a command runs, then hides 10 s after the last one ends', () => {
    const a = added('g1', 'db1');
    n.added(a);
    vi.advanceTimersByTime(60_000);
    expect(texts(toasts)).toHaveLength(1);
    n.finished(finished(a));
    vi.advanceTimersByTime(NOTICE_HIDE_MS - 1);
    expect(texts(toasts)).toHaveLength(1);
    vi.advanceTimersByTime(1 + EXIT_MS);
    expect(texts(toasts)).toEqual([]);
    // The next command brings it back, with the grant's count.
    n.added(added('g1', 'db1', { state: 'ended' }));
    expect(texts(toasts)).toEqual(['Claude Code ran 2 commands on db1']);
  });

  it('pauses its timer while the stack is hovered', () => {
    const a = added('g1', 'db1');
    n.added(a);
    n.finished(finished(a));
    toasts.pause();
    vi.advanceTimersByTime(NOTICE_HIDE_MS * 3);
    expect(texts(toasts)).toHaveLength(1);
    toasts.resume();
    vi.advanceTimersByTime(NOTICE_HIDE_MS + EXIT_MS);
    expect(texts(toasts)).toEqual([]);
  });

  it('does not come back for an end once closed', () => {
    const a = added('g1', 'db1');
    n.added(a);
    toasts.dismissKey(noticeKey('g1'));
    vi.advanceTimersByTime(EXIT_MS);
    n.finished(finished(a));
    expect(texts(toasts)).toEqual([]);
  });

  it('keeps one notice per grant: three grants, three toasts', () => {
    n.added(added('g1', 'db1'));
    n.added(added('g2', 'CodeBox', { program: 'Ghostty' }));
    n.added(added('g3', 'stg-web', { program: 'herdr' }));
    n.added(added('g1', 'nas'));
    expect(texts(toasts).sort()).toEqual(['Claude Code ran 2 commands on db1, nas', 'Ghostty ran a command on CodeBox', 'herdr ran a command on stg-web'].sort());
  });

  it('View opens the grant; Stop asks once, Cancel puts it back, Stop grant revokes', () => {
    n.added(added('g1', 'db1'));
    const id = live(toasts)[0].id;
    toasts.act(id, 0);
    expect(viewed).toEqual(['g1']);
    toasts.act(id, 1);
    expect(texts(toasts)).toEqual(["Stop this grant? Claude Code can't run more on db1."]);
    // A command meanwhile does not replace the question.
    n.added(added('g1', 'nas'));
    expect(live(toasts)[0].actions.map((x) => x.label)).toEqual(['Cancel', 'Stop grant']);
    toasts.act(id, 0);
    expect(texts(toasts)).toEqual(['Claude Code ran 2 commands on db1, nas']);
    toasts.act(id, 1);
    toasts.act(id, 1);
    expect(stopped).toEqual(['g1']);
    expect(n.active()).toEqual([]);
  });

  it('goes when its grant ends and when the vault locks', () => {
    n.added(added('g1', 'db1'));
    n.added(added('g2', 'nas'));
    n.grants(['g2']);
    vi.advanceTimersByTime(EXIT_MS);
    expect(texts(toasts)).toEqual(['Claude Code ran a command on nas']);
    n.clear();
    vi.advanceTimersByTime(EXIT_MS);
    expect(texts(toasts)).toEqual([]);
    expect(n.active()).toEqual([]);
  });

  it('reads an updating notice out at most every 5 s', () => {
    n.added(added('g1', 'db1'));
    const first = toasts.announcement();
    expect(first?.text).toBe('Claude Code ran a command on db1');
    n.added(added('g1', 'db1'));
    expect(toasts.announcement()).toBe(first);
    vi.advanceTimersByTime(NOTICE_ANNOUNCE_MS);
    n.added(added('g1', 'db1'));
    expect(toasts.announcement()?.text).toBe('Claude Code ran 3 commands on db1');
  });

  it('splits a copy between two hosts', () => {
    expect(entryHosts('db1 → nas')).toEqual(['db1', 'nas']);
    expect(entryHosts('')).toEqual([]);
    expect(noticeText('Codex', 1, [])).toBe('Codex ran a command');
  });
});
