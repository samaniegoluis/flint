import { describe, expect, it } from 'vitest';

// Every text field spreads `plainText` (milestone 62): no spelling correction or
// autocorrect where an alias, a path or a search is typed. A field of prose says so
// with `data-prose`. Checked on the source, so a new field cannot forget it.
const sources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const NOT_TEXT = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'hidden']);

describe('text fields', () => {
  it('found the sources', () => expect(Object.keys(sources).length).toBeGreaterThan(50));

  it('every text input and textarea turns correction off, or is prose', () => {
    const missing: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      for (const m of src.matchAll(/<(input|textarea)\b([\s\S]*?)\/>/g)) {
        const attrs = m[2];
        const type = /type="([^"]+)"/.exec(attrs)?.[1] ?? 'text';
        if (NOT_TEXT.has(type)) continue;
        if (attrs.includes('{...plainText}') || attrs.includes('data-prose')) continue;
        missing.push(`${file}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
