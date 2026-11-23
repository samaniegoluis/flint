import { describe, expect, it } from 'vitest';
import { folderDisplay, fold, highlight, hostFields, queryWords, search, type HostFields } from './search';

// The roadmap's examples (milestone 62), on a catalog shaped like the owner's.
const h = (alias: string, group = '', extra: Partial<HostFields> = {}): HostFields => ({ alias, label: '', hostname: alias + '.lan', tags: [], group, ...extra });
const catalog: HostFields[] = [
  h('pinflix', 'Home'),
  h('vm-de-billing-de-produccion', 'Rafa'),
  h('vm-de-billing-de-produccion-2', 'Rafa', { label: 'Facturación producción' }),
  h('codebox', 'Home'),
  h('remote-code', 'Work'),
  h('casaos-candelas', 'Home'),
  h('bp-stg-db01', 'BP', { tags: ['db'] }),
  h('bp-stg-web01', 'BP'),
  h('bp-prod-db01', 'BP', { tags: ['db'] }),
  h('tr-app01', 'Triara/Billing/PROD'),
  h('tr-app02', 'Triara/Billing/PROD'),
  h('tr-db01', 'Triara/Billing/PROD'),
  h('tr-qa01', 'Triara/Billing/QA'),
];
const find = (q: string) =>
  catalog
    .map((x) => ({ alias: x.alias, m: search(q, hostFields(x)) }))
    .filter((r) => r.m)
    .sort((a, b) => b.m!.score - a.m!.score)
    .map((r) => r.alias);

describe('search, the roadmap examples', () => {
  it('pinf finds pinflix only', () => expect(find('pinf')).toEqual(['pinflix']));
  it('code finds codebox and remote-code, codebox first', () => expect(find('code')).toEqual(['codebox', 'remote-code']));
  it('stg db and db stg find bp-stg-db01 only', () => {
    expect(find('stg db')).toEqual(['bp-stg-db01']);
    expect(find('db stg')).toEqual(['bp-stg-db01']);
  });
  it('triara prod finds the three hosts in Triara/…/PROD', () => expect(find('triara prod').sort()).toEqual(['tr-app01', 'tr-app02', 'tr-db01']));
  it('prod puts the aliases first, then the PROD folder', () => {
    const r = find('prod');
    expect(r.slice(0, 3).sort()).toEqual(['bp-prod-db01', 'vm-de-billing-de-produccion', 'vm-de-billing-de-produccion-2']);
    expect(r.slice(3).sort()).toEqual(['tr-app01', 'tr-app02', 'tr-db01']);
  });
  it('cdbx finds nothing (no initials)', () => expect(find('cdbx')).toEqual([]));
  it('what is typed together is matched together', () => expect(find('stg-db')).toEqual(['bp-stg-db01']));
});

describe('search, the rule', () => {
  it('ignores accents and case both ways', () => {
    expect(search('produccion', [{ name: 'l', text: 'Producción' }])).not.toBeNull();
    expect(search('PRODUCCIÓN', [{ name: 'l', text: 'produccion' }])).not.toBeNull();
  });
  it('needs every word', () => expect(search('stg web db', hostFields(catalog[6]))).toBeNull());
  it('ranks the alias start over a segment over anywhere over another field', () => {
    const s = (alias: string, q: string) => search(q, hostFields(h(alias)))!.score;
    const other = search('web', hostFields(h('x', '', { tags: ['web'] })))!.score;
    expect(s('web-01', 'web')).toBeGreaterThan(s('a-web', 'web'));
    expect(s('a-web', 'web')).toBeGreaterThan(s('aweb', 'web'));
    expect(s('aweb', 'web')).toBeGreaterThan(other);
  });
  it('maps positions back to the original text, accents included', () => {
    const m = search('acion', [{ name: 'l', text: 'Facturación' }])!;
    expect(m.positions.l).toEqual([6, 7, 8, 9, 10]);
  });
  it('reports which field each word came from', () => {
    const m = search('stg db', hostFields(catalog[6]))!;
    expect(m.positions.alias).toEqual([3, 4, 5, 7, 8]);
    expect(m.positions['tag:0']).toBeUndefined();
  });
  it('an empty query matches with score 0', () => expect(search('  ', [{ name: 'a', text: 'x' }])).toEqual({ score: 0, positions: {} }));
  it('splits and folds the query', () => expect(queryWords('  Stg  DÉB ')).toEqual(['stg', 'deb']));
  it('folds keeping the source index of each character', () => expect(fold('Aé')).toEqual({ text: 'ae', from: [0, 1] }));
});

describe('folderDisplay', () => {
  it('moves positions past the spaces around each slash', () => {
    const m = search('prod', [{ name: 'group', text: 'Triara/Billing/PROD' }])!;
    const d = folderDisplay('Triara/Billing/PROD', m.positions.group);
    expect(d.text).toBe('Triara / Billing / PROD');
    expect(d.positions.map((p) => d.text[p]).join('')).toBe('PROD');
  });
});

describe('highlight', () => {
  it('splits text into highlighted runs', () => {
    expect(highlight('prod-api', [0, 1, 2, 3])).toEqual([{ text: 'prod', match: true }, { text: '-api', match: false }]);
  });
});
