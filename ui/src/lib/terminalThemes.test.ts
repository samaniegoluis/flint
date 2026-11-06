import { describe, expect, it } from 'vitest';
import { ANSI_ORDER, paletteVars, TERM_THEMES, themePalette } from './terminalThemes';

const HEX = /^#[0-9a-f]{6}$/i;

describe('terminal themes', () => {
  it('lists the six themes of the spec, Default first', () => {
    expect(TERM_THEMES.map((t) => t.id)).toEqual(['default', 'catppuccin', 'tokyo-night', 'aura', 'dracula', 'nord']);
  });

  it('gives every theme but Default a complete dark and light palette', () => {
    for (const t of TERM_THEMES.slice(1)) {
      for (const p of [t.dark, t.light]) {
        expect(p).not.toBeNull();
        for (const k of ['background', 'foreground', 'cursor', ...ANSI_ORDER] as const) {
          expect(String(p![k]), `${t.id}.${k}`).toMatch(HEX);
        }
        expect(p!.selectionBackground).toBeTruthy();
      }
      expect(t.dark!.background).not.toEqual(t.light!.background);
    }
  });

  it('maps a palette to the design variables, and Default to none', () => {
    expect(themePalette('default', true)).toBeNull();
    expect(themePalette('unknown', true)).toBeNull();
    const v = paletteVars(themePalette('aura', true)) as Record<string, string>;
    expect(v['--term-bg']).toBe('#15141b');
    expect(v['--ansi-4']).toBe('#a277ff');
    expect(v['--ansi-15']).toBe('#edecee');
    expect(paletteVars(null)).toEqual({});
  });
});
