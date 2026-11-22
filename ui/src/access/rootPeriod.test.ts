import { describe, expect, it } from 'vitest';
import { ROOT_PERIODS, rootPeriodWarning } from './ApprovalDialog';

describe('root periods (milestone 57, 25e4/25e5)', () => {
  it('offers each command, 2, 5 or 15 minutes, never longer', () => {
    expect(ROOT_PERIODS.map((p) => p.value)).toEqual(['', '2m', '5m', '15m']);
    expect(Math.max(...ROOT_PERIODS.map((p) => p.min))).toBe(15);
  });

  it('warns with the program, the host and the minutes', () => {
    expect(rootPeriodWarning('flint, started by Claude Code', 'db1', 5))
      .toBe('Claude Code and everything it starts can run commands as root on db1 for 5 min without asking you.');
    expect(rootPeriodWarning('flint', 'nas', 2)).toBe('flint and everything it starts can run commands as root on nas for 2 min without asking you.');
  });
});

describe('View of a root period (26b1 for 26a4)', () => {
  it('says Root and its time left to the second', async () => {
    const { grantSpan } = await import('./GrantActivityModal');
    const g = { id: 'r1', label: 'x', all: false, groups: [], hosts: ['db1'], read: false, exec: false, write: false,
      created_ms: 0, expires_ms: 300_000, anchor_pid: 1, notify: true, root: true };
    expect(grantSpan(g, 0, 79_000)).toMatch(/^5 min, approved \d\d:\d\d · 3:41 left$/);
  });
});
