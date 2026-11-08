import { describe, expect, it } from 'vitest';
import { moreText } from './CommandModal';

describe('moreText', () => {
  it('says nothing for a summary that is the whole command', () => {
    expect(moreText('flint exec web -- uptime', 'flint exec web -- uptime')).toBe('');
  });
  it('counts what a cut summary leaves out', () => {
    const whole = 'flint exec web -- ' + 'x'.repeat(500);
    const summary = whole.slice(0, 157) + '...';
    expect(moreText(summary, whole)).toBe(`+${(500 + 18 - 157).toLocaleString()} more characters`);
  });
  it('does not count a command that really ends in three dots', () => {
    expect(moreText('flint exec web -- echo ...', 'flint exec web -- echo ...')).toBe('');
  });
});
