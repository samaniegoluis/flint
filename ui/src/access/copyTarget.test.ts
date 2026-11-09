import { describe, expect, it } from 'vitest';
import { copyTarget, relayTag } from './ApprovalDialog';

describe('copyTarget', () => {
  it('puts the source in a destination that ends in a slash', () => {
    expect(copyTarget('/srv/www/', '/Users/me/site')).toBe('/srv/www/site');
    expect(copyTarget('/srv/www/', '/Users/me/site/')).toBe('/srv/www/site/');
  });
  it('keeps a destination without a slash as given', () => {
    expect(copyTarget('/srv/app.conf', '/Users/me/app.conf')).toBe('/srv/app.conf');
  });
  it('does not name the login folder or its parent', () => {
    expect(copyTarget('/tmp/', '.')).toBe('/tmp/');
  });
});

describe('relayTag', () => {
  it('tags nothing when neither host is reached yet (16g1)', () => {
    expect(relayTag(false, 0, false)).toBe('');
  });
  it('says which host is new and how long the other is allowed (16g3)', () => {
    expect(relayTag(true, 32 * 60 - 10, false)).toBe('already allowed · 32 min left');
    expect(relayTag(false, 0, true)).toBe('new — this grant adds it');
    expect(relayTag(true, 90 * 60, false)).toBe('already allowed · 1 h 30 min left');
    expect(relayTag(true, 3600, false)).toBe('already allowed · 1 h left');
    expect(relayTag(true, -1, false)).toBe('already allowed · until locked');
  });
});
