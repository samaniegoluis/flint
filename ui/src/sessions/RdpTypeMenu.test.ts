import { describe, expect, it } from 'vitest';
import { clipboardItem, presenceHint, TYPE_MAX_CHARS, typedToast } from './RdpTypeMenu';

describe('the Type menu (milestone 58, design 25c)', () => {
  it('counts the clipboard, and greys it with no text or too much', () => {
    expect(clipboardItem(24)).toEqual({ hint: '24 characters', reason: '' });
    expect(clipboardItem(1)).toEqual({ hint: '1 character', reason: '' });
    expect(clipboardItem(0).reason).toBe('The clipboard holds no text');
    expect(clipboardItem(TYPE_MAX_CHARS).reason).toBe('');
    expect(clipboardItem(TYPE_MAX_CHARS + 1).reason).toBe('Too long to type: over 2,000 characters');
  });
  it('says how Type password will confirm you', () => {
    expect(presenceHint('touchid')).toBe('Asks for Touch ID');
    expect(presenceHint('polkit')).toBe('Asks for your system password');
    expect(presenceHint('password')).toBe('Asks for the master password');
  });
  it('says how many characters went, or why none did', () => {
    expect(typedToast({ tab: 't', what: 'clipboard', count: 24, code: '', message: '' })).toEqual({ text: 'Typed 24 characters', kind: 'ok' });
    expect(typedToast({ tab: 't', what: 'password', count: 1, code: '', message: '' }).text).toBe('Typed 1 character');
    expect(typedToast({ tab: 't', what: 'password', count: 0, code: 'not_found', message: "'win' has no saved password" })).toEqual({ text: "'win' has no saved password", kind: 'error' });
  });
});
