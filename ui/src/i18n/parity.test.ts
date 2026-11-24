// Milestone 68: every English text has its Spanish one, and the other way round. A key
// missing from es.json would show English in a Spanish window; one es.json has and
// en.json lacks is a text nothing shows. Each pair names the same {params}, so a value
// never loses one on the way.

import { describe, expect, it } from 'vitest';
import en from './en.json';
import es from './es.json';

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;
const params = (v: string) => [...new Set([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

describe('en ⇔ es', () => {
  it('has the same keys', () => {
    expect(Object.keys(EN).filter((k) => !(k in ES))).toEqual([]);
    expect(Object.keys(ES).filter((k) => !(k in EN))).toEqual([]);
  });

  it('names the same parameters in each pair', () => {
    const differ = Object.keys(EN).filter((k) => k in ES && params(EN[k]).join() !== params(ES[k]).join());
    expect(differ).toEqual([]);
  });

  it('leaves no Spanish text empty', () => {
    expect(Object.keys(ES).filter((k) => ES[k].trim() === '' && EN[k].trim() !== '')).toEqual([]);
  });
});
