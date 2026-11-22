// The live notice of what a grant runs (milestone 56, D-117 (3)-(5), D-127, designs
// 26a1-26a3, 26e1). One toast per grant, keyed by the grant's id and updated in place:
// "Claude Code ran 10 commands on db1, nas". It names the program and the hosts, never
// the command (a secret in a command would show on a shared screen); View shows the
// commands. The toast stays while a command of its grant runs and hides
// NOTICE_HIDE_MS after the last one ends (the stack's hover and focus pause that
// timer), then comes back, updated, with the next. Stop asks once inside the toast
// (26a3) before it revokes the grant. Everything goes when the vault locks.
//
// A root period's notice (milestone 57, 26a4) says "as root" and its time left, and
// stays while the period lasts: it goes when the period ends.
//
// No React here, so the rules are tested with fake timers (grantNotices.test.ts).

import type { ActivityAddedEvent, ActivityFinishedEvent } from '../api/types';
import type { ToastStore } from './toasts';

export const NOTICE_HIDE_MS = 10_000;
/** A notice that keeps changing is read out at most this often (aria-live). */
export const NOTICE_ANNOUNCE_MS = 5_000;

export const noticeKey = (grant: string) => `grant-notice:${grant}`;

interface Group {
  grant: string;
  program: string;
  hosts: string[];
  count: number;
  running: Set<number>;
  confirming: boolean;
  /** When the notice was last read out, ms; 0 never. */
  announced: number;
  /** A root period (milestone 57), and when it ends on this page's clock (ms). */
  root: boolean;
  ends: number;
}

export interface NoticeHandlers {
  view: (grant: string) => void;
  stop: (grant: string) => void;
}

/** The hosts of one entry: "db1 → nas" is a copy between two. */
export function entryHosts(hosts: string): string[] {
  return hosts.split(' → ').map((h) => h.trim()).filter(Boolean);
}

/** "Claude Code ran a command on db1", "… ran 10 commands on db1, nas"; a root
 *  period's "… ran 3 commands as root on db1". */
export function noticeText(program: string, count: number, hosts: string[], root = false): string {
  const what = (count === 1 ? 'ran a command' : `ran ${count} commands`) + (root ? ' as root' : '');
  return hosts.length ? `${program} ${what} on ${hosts.join(', ')}` : `${program} ${what}`;
}

/** "3:41 left" for 221 s. */
export function leftText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;
}

export function stopText(program: string, hosts: string[]): string {
  return hosts.length ? `Stop this grant? ${program} can't run more on ${hosts.join(', ')}.` : `Stop this grant? ${program} can't run more.`;
}

export class GrantNotices {
  private groups = new Map<string, Group>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(private toasts: ToastStore, private handlers: NoticeHandlers, private now: () => number = Date.now) {}

  /** `activity:added`: a command one of the grants allowed, if that grant notifies. */
  added(e: ActivityAddedEvent) {
    if (!e.notify || !e.grant || e.outcome !== 'allowed') return;
    let g = this.groups.get(e.grant);
    if (!g) {
      g = { grant: e.grant, program: e.program || 'A program', hosts: [], count: 0, running: new Set(), confirming: false, announced: 0, root: false, ends: 0 };
      this.groups.set(e.grant, g);
    }
    if (e.root) {
      g.root = true;
      g.ends = this.now() + Math.max(0, e.left_ms ?? 0);
      this.tick();
    }
    g.count += 1;
    for (const h of entryHosts(e.hosts)) if (!g.hosts.includes(h)) g.hosts.push(h);
    if (e.state === 'running') g.running.add(e.id);
    this.render(g, true);
  }

  /** `activity:finished`: the notice starts its hide timer once nothing of its grant runs. */
  finished(e: ActivityFinishedEvent) {
    const g = this.groups.get(e.grant);
    if (!g || !g.running.delete(e.id)) return;
    // A notice closed (✕ or its timer) does not come back for an end, only for a new command.
    if (this.toasts.hasKey(noticeKey(g.grant))) this.render(g, false);
  }

  /** The live grants (`access:changed`): a notice of a grant that ended goes. */
  grants(live: string[]) {
    for (const id of [...this.groups.keys()]) {
      if (!live.includes(id)) this.drop(id);
    }
  }

  /** The vault locked: every notice goes at once (grants end on lock). */
  clear() {
    for (const id of [...this.groups.keys()]) this.drop(id);
  }

  /** The grants with a notice, for a test or a check. */
  active(): string[] { return [...this.groups.keys()]; }

  count(grant: string): number { return this.groups.get(grant)?.count ?? 0; }

  private drop(id: string) {
    this.groups.delete(id);
    this.toasts.dismissKey(noticeKey(id));
    this.tick();
  }

  /** A root period's time left, every second, while one has a notice. */
  private tick() {
    const roots = [...this.groups.values()].some((g) => g.root);
    if (roots && !this.ticker) {
      this.ticker = setInterval(() => this.second(), 1000);
    } else if (!roots && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private second() {
    const t = this.now();
    for (const g of [...this.groups.values()]) {
      if (!g.root) continue;
      // The period ended: its notice goes with it (the core refuses what comes after).
      if (t >= g.ends) { this.drop(g.grant); continue; }
      if (!g.confirming && this.toasts.hasKey(noticeKey(g.grant))) this.render(g, false);
    }
  }

  private render(g: Group, fresh: boolean) {
    if (g.confirming) return;
    const key = noticeKey(g.grant);
    const shown = this.toasts.hasKey(key);
    const t = this.now();
    // Read out when it appears, and then at most every NOTICE_ANNOUNCE_MS.
    const announce = !shown || (fresh && t - g.announced >= NOTICE_ANNOUNCE_MS);
    if (announce) g.announced = t;
    this.toasts.show({
      key, kind: g.root ? 'root' : 'info', announce,
      text: noticeText(g.program, g.count, g.hosts, g.root),
      side: g.root ? leftText(g.ends - t) : undefined,
      duration: g.root || g.running.size > 0 ? 'sticky' : NOTICE_HIDE_MS,
      actions: [
        { label: 'View', keepOpen: true, run: () => this.handlers.view(g.grant) },
        { label: 'Stop', keepOpen: true, run: () => this.confirm(g.grant) },
      ],
    });
  }

  private confirm(grant: string) {
    const g = this.groups.get(grant);
    if (!g) return;
    g.confirming = true;
    this.toasts.show({
      key: noticeKey(grant), kind: 'info', duration: 'sticky',
      text: stopText(g.program, g.hosts),
      actions: [
        { label: 'Cancel', keepOpen: true, run: () => this.cancel(grant) },
        { label: 'Stop grant', run: () => this.stop(grant) },
      ],
    });
  }

  private cancel(grant: string) {
    const g = this.groups.get(grant);
    if (!g) return;
    g.confirming = false;
    this.render(g, false);
  }

  /** Stop grant from View: no question there, the button says what it does. */
  stopNow(grant: string) {
    this.drop(grant);
    this.handlers.stop(grant);
  }

  private stop(grant: string) {
    this.groups.delete(grant);
    this.tick();
    this.handlers.stop(grant);
  }
}
