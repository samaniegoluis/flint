import { describe, expect, it } from 'vitest';
import { passwordStrength } from './strength';

describe('passwordStrength', () => {
  it('grades by length, variety and words', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('short').label).toBe('Too short');
    expect(passwordStrength('abcdefgh').score).toBe(1);
    expect(passwordStrength('ember-granite-violet-harbor').score).toBe(4);
  });
});
