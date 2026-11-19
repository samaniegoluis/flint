import { describe, expect, it } from 'vitest';
import { testFailText, testKey, testOkText, tunnelsLeftText } from './toastText';

describe('tunnelsLeftText (20d2)', () => {
  it('counts the tunnels, as the design does', () => {
    expect(tunnelsLeftText('prod-db', ['pg', 'redis'])).toEqual({ text: 'Tab closed. 2 tunnels still up on prod-db', label: 'Stop them' });
  });
  it('names a single tunnel', () => {
    expect(tunnelsLeftText('prod-db', ['pg'])).toEqual({ text: 'Tab closed. Tunnel pg still up on prod-db', label: 'Stop it' });
  });
});

describe('Test connection toasts', () => {
  it('says who answered and how fast', () => {
    expect(testOkText('web', 'deploy@web:22', 84, 1)).toBe('Connection to web works · 84 ms');
  });
  it('falls back to the target for a host with no alias yet', () => {
    expect(testOkText('', 'deploy@10.0.0.4:22', 84, 1)).toBe('Connection to deploy@10.0.0.4:22 works · 84 ms');
  });
  it('counts jump hosts', () => {
    expect(testOkText('db', 'x', 90, 2)).toBe('Connection to db works · 90 ms, through 1 jump host');
    expect(testOkText('db', 'x', 90, 3)).toBe('Connection to db works · 90 ms, through 2 jump hosts');
  });
  it('names the host that failed', () => {
    expect(testFailText('web', 'connection refused')).toBe('Test of web failed: connection refused');
    expect(testFailText('', 'enter a hostname')).toBe('Test of the connection failed: enter a hostname');
  });
  it('keys one toast per editor', () => {
    expect(testKey('web')).toBe('test:web');
    expect(testKey('')).toBe('test:');
  });
});
