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
