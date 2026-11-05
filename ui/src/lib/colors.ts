import type { CSSProperties } from 'react';

// Host colours. The vault stores a hex value (the core accepts "#rrggbb"); the UI
// offers the design's tag palette by name and shows each in the active theme's shade.

export const TAG_COLORS = ['ember', 'sapphire', 'moss', 'iris', 'rose', 'sand', 'slate'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

// The stored value of each name: its dark-theme shade from tokens.css.
const HEX: Record<TagColor, string> = {
  ember: '#F29A52', sapphire: '#78A9F2', moss: '#7BC98F', iris: '#C9A0EE',
  rose: '#EE8AA6', sand: '#D9C27A', slate: '#8F98A6',
};

export function colorHex(name: TagColor): string {
  return HEX[name];
}

export function colorName(hex: string): TagColor | null {
  const h = hex.toUpperCase();
  for (const n of TAG_COLORS) if (HEX[n] === h) return n;
  return null;
}

// The class for a stored colour: a palette name, or an inline custom value.
export function colorStyle(hex: string): { className: string; style?: CSSProperties } {
  if (!hex) return { className: '' };
  const n = colorName(hex);
  if (n) return { className: 'c-' + n };
  return { className: '', style: { ['--c' as string]: hex } as CSSProperties };
}
