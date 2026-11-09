import { describe, expect, it } from 'vitest';
import { copyTarget } from './ApprovalDialog';

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
