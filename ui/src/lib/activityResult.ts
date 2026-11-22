// How an activity entry's command ended (milestone 56, D-127 (3), design 26b1): for
// View's rows and the activity entry's detail. Pure, so tested without React.

import type { ActivityEntry } from '../api/types';

export type ResultTone = 'ok' | 'danger' | 'warn' | 'info' | '';

export interface ResultView {
  /** The badge: "exit 0", "running…", "refused", "" for an entry with no result. */
  badge: string;
  tone: ResultTone;
  /** Beside it: the duration ("0.4 s") or why it was refused ("not a sudoer"). */
  meta: string;
  /** Struck through: refused before it ran (26b1). */
  refused: boolean;
}

const REFUSALS: Record<string, string> = {
  not_sudoer: 'not a sudoer',
  sudo_password: 'sudo password refused',
};

/** "0.4 s", "4.2 s", "12 s", "3 min 05 s". */
export function durationText(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export function resultView(e: Pick<ActivityEntry, 'state' | 'exit' | 'duration_ms' | 'result'>, nowMs?: number, startedMs?: number): ResultView {
  if (e.state === 'running') {
    const meta = nowMs !== undefined && startedMs !== undefined ? durationText(nowMs - startedMs) : '';
    return { badge: 'running…', tone: 'info', meta, refused: false };
  }
  if (e.state !== 'ended') return { badge: '', tone: '', meta: '', refused: false };
  if (REFUSALS[e.result]) return { badge: 'refused', tone: 'warn', meta: REFUSALS[e.result], refused: true };
  // Flint stopped it (the network, a host key, a login): its error code says why.
  if (e.result) return { badge: e.result.replaceAll('_', ' '), tone: 'danger', meta: durationText(e.duration_ms), refused: false };
  return { badge: `exit ${e.exit}`, tone: e.exit === 0 ? 'ok' : 'danger', meta: durationText(e.duration_ms), refused: false };
}

/** The remote command of a logged `flint exec <host> [--sudo] -- …`, for a row; the whole text otherwise. */
export function rowCommand(command: string): string {
  const m = /^flint exec \S+ (?:--sudo )?-- (.*)$/s.exec(command);
  return m ? m[1] : command;
}
