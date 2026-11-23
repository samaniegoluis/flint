// Settings → Notifications (milestone 63): the page's half of the ntfy settings. The
// core checks the server again on save (domain check_ntfy_server); this only says what
// is wrong as the person types, and words the last publish's outcome (27a3, 27a4).
import type { AlertStatus } from '../api/types';

/** Why `url` is not an ntfy server Flint can use, or '' when it is. */
export function ntfyServerProblem(url: string): string {
  const full = 'Enter a full address, like https://ntfy.example.com';
  const m = /^https?:\/\/(.*)$/.exec(url);
  if (!m) return full;
  if (url.length > 256) return 'That address is too long';
  const rest = m[1];
  if (/[\s?#@\\]/.test(rest) || /[^\x21-\x7e]/.test(rest)) return full;
  const host = rest.split('/')[0];
  if (!host || host.startsWith(':') || host.endsWith(':')) return full;
  return '';
}

/** The topic's address on the server, as the phone subscribes to it ('' with no topic). */
export function ntfyTopicUrl(server: string, topic: string): string {
  if (!topic) return '';
  return server.replace(/\/+$/, '') + '/' + topic;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The line beside Send test: nothing yet, the test sent, or the last alert's failure. */
export function alertStatusLine(s: AlertStatus | null): { tone: '' | 'ok' | 'error'; text: string } {
  if (!s || s.at_ms === 0) return { tone: '', text: 'No alert sent yet.' };
  const at = clock(s.at_ms);
  if (!s.ok) return { tone: 'error', text: `Last alert couldn't be sent · ${at} · ${s.error}` };
  if (s.kind === 'test') return { tone: 'ok', text: `Test sent ${at} · check your phone` };
  return { tone: 'ok', text: `Last alert sent ${at}` };
}
