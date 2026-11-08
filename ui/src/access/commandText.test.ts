import { describe, expect, it } from 'vitest';
import { moreText, sudoArgv } from './CommandModal';
import { exactWhen } from './AccessSettings';

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

describe('sudoArgv', () => {
  it('reads back the arguments of a logged sudo command', () => {
    expect(sudoArgv("flint exec codebox --sudo -- 'systemctl' 'restart' 'nginx'")).toEqual(['systemctl', 'restart', 'nginx']);
  });
  it("undoes the '\\'' escape and keeps spaces and newlines", () => {
    expect(sudoArgv("flint exec h --sudo -- 'sh' '-c' 'echo '\\''hi there'\\''\nid'")).toEqual(['sh', '-c', "echo 'hi there'\nid"]);
  });
  it('is null for anything else', () => {
    expect(sudoArgv('flint exec web -- uptime')).toBeNull();
    expect(sudoArgv("flint exec h --sudo -- 'cut mid-argu")).toBeNull();
  });
});

describe('exactWhen', () => {
  it('has seconds and a UTC offset', () => {
    const w = exactWhen(1_762_607_561);
    expect(w.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(w.offset).toMatch(/^UTC([+−]\d{1,2}(:\d{2})?)?$/);
  });
});
