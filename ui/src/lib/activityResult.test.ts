import { describe, expect, it } from 'vitest';
import { durationText, resultView, rowCommand } from './activityResult';

const ended = (exit: number, result = '', duration_ms = 400) => ({ state: 'ended' as const, exit, duration_ms, result });

describe('activity results', () => {
  it('shows the exit status and duration of an ended command', () => {
    expect(resultView(ended(0))).toEqual({ badge: 'exit 0', tone: 'ok', meta: '0.4 s', refused: false });
    expect(resultView(ended(1, '', 100)).tone).toBe('danger');
  });
  it('shows sudo refusals struck through, with their reason', () => {
    expect(resultView(ended(17, 'not_sudoer'))).toEqual({ badge: 'refused', tone: 'warn', meta: 'not a sudoer', refused: true });
    expect(resultView(ended(18, 'sudo_password')).meta).toBe('sudo password refused');
  });
  it('names an error of Flint by its code', () => {
    expect(resultView(ended(12, 'host_key')).badge).toBe('host key');
  });
  it('says running… and nothing for an entry with no result', () => {
    expect(resultView({ state: 'running', exit: 0, duration_ms: 0, result: '' }, 5200, 1000).meta).toBe('4.2 s');
    expect(resultView({ state: '', exit: 0, duration_ms: 0, result: '' }).badge).toBe('');
  });
  it('formats durations and the command of a row', () => {
    expect(durationText(4200)).toBe('4.2 s');
    expect(durationText(12_400)).toBe('12 s');
    expect(durationText(185_000)).toBe('3 min 05 s');
    expect(rowCommand('flint exec db1 -- systemctl status postgresql')).toBe('systemctl status postgresql');
    expect(rowCommand("flint exec nas --sudo -- 'zpool' 'scrub'")).toBe("'zpool' 'scrub'");
    expect(rowCommand('flint host add web')).toBe('flint host add web');
  });
});
