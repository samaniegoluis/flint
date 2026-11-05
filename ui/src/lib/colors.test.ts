import { describe, expect, it } from 'vitest';
import { colorHex, colorName, colorStyle } from './colors';

describe('colors', () => {
  it('round-trips palette names through hex', () => {
    expect(colorName(colorHex('moss'))).toBe('moss');
    expect(colorName('#f29a52')).toBe('ember');
    expect(colorName('#123456')).toBeNull();
  });
  it('keeps a custom hex as an inline variable', () => {
    expect(colorStyle('#123456').style).toEqual({ '--c': '#123456' });
    expect(colorStyle('').className).toBe('');
  });
});
