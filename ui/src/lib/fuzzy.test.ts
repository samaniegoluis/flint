import { describe, expect, it } from 'vitest';
import { fuzzy, highlight } from './fuzzy';

describe('fuzzy', () => {
  it('prefers substrings and earlier matches', () => {
    const a = fuzzy('prod', 'prod-api-01')!;
    const b = fuzzy('prod', 'db-prod')!;
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.positions).toEqual([0, 1, 2, 3]);
  });

  it('matches characters in order and rejects the rest', () => {
    expect(fuzzy('pa1', 'prod-api-01')).not.toBeNull();
    expect(fuzzy('zz', 'prod-api-01')).toBeNull();
  });

  it('splits text into highlighted runs', () => {
    expect(highlight('prod-api', [0, 1, 2, 3])).toEqual([{ text: 'prod', match: true }, { text: '-api', match: false }]);
  });
});
