import { describe, expect, it } from 'vitest';
import { alertStatusLine, ntfyServerProblem, ntfyTopicUrl } from './alerts';

describe('ntfyServerProblem', () => {
  it('takes an http(s) address with a host, as the core does', () => {
    for (const ok of ['https://ntfy.sh', 'https://ntfy.example.com:8443/base/', 'http://192.168.1.20:8080']) expect(ntfyServerProblem(ok)).toBe('');
    for (const bad of ['', 'ntfy.home', 'ftp://ntfy.sh', 'https://', 'https:///x', 'https://:80', 'https://a b', 'https://ntfy.sh/?x=1', 'https://u@ntfy.sh', 'https://ntfy.sh#t']) {
      expect(ntfyServerProblem(bad)).toBe('Enter a full address, like https://ntfy.example.com');
    }
  });
});

describe('ntfyTopicUrl', () => {
  it('joins the server and the topic once', () => {
    expect(ntfyTopicUrl('https://ntfy.sh', 'flint-x')).toBe('https://ntfy.sh/flint-x');
    expect(ntfyTopicUrl('https://n.example/base//', 'flint-x')).toBe('https://n.example/base/flint-x');
    expect(ntfyTopicUrl('https://ntfy.sh', '')).toBe('');
  });
});

describe('alertStatusLine', () => {
  const at = new Date(2026, 10, 23, 10, 42).getTime();
  it('words each outcome of 27a3 and 27a4', () => {
    expect(alertStatusLine(null)).toEqual({ tone: '', text: 'No alert sent yet.' });
    expect(alertStatusLine({ at_ms: at, kind: 'test', ok: true, error: '' })).toEqual({ tone: 'ok', text: 'Test sent 10:42 · check your phone' });
    expect(alertStatusLine({ at_ms: at, kind: 'approval', ok: true, error: '' })).toEqual({ tone: 'ok', text: 'Last alert sent 10:42' });
    expect(alertStatusLine({ at_ms: at, kind: 'approval', ok: false, error: 'ntfy.sh answered 403' }))
      .toEqual({ tone: 'error', text: "Last alert couldn't be sent · 10:42 · ntfy.sh answered 403" });
  });
});
