// The page's text in the chosen language (milestone 66, D-140). Every string the page
// shows comes from a catalog here; the core stays English and its messages are
// rendered by id in milestone 69 (Principle 21).
//
// Keys are flat and grouped by area (`shell.tree.empty`). A value may hold `{name}`
// parameters; a key with plural forms has `key.one`, `key.other` (and whatever else
// Intl.PluralRules names for the language), chosen by the `count` parameter. A key
// missing from the chosen language reads the English one; a key missing from English
// throws in tests and shows the key itself in the app.

import en from './en.json';
import es from './es.json';

export type Lang = 'en' | 'es';
export type Params = Record<string, string | number | null | undefined>;
type Catalog = Record<string, string>;

const CATALOGS: Partial<Record<Lang, Catalog>> = { en, es };

const STRICT = import.meta.env?.MODE === 'test';

let current: Lang = 'en';
const plurals = new Map<Lang, Intl.PluralRules>();

/** The languages the page has a catalog for; the Language row shows with two or more. */
export function availableLanguages(): Lang[] {
  return (Object.keys(CATALOGS) as Lang[]).filter((l) => Object.keys(CATALOGS[l] ?? {}).length > 0);
}

/** The language a setting stands for: `system` takes the OS's (AppInfo.system_language),
 * and one with no catalog reads English. */
export function resolveLanguage(setting: string, system: string | undefined): Lang {
  const want = setting === 'system' ? (system ?? 'en') : setting;
  return (availableLanguages() as string[]).includes(want) ? (want as Lang) : 'en';
}

export function setLanguage(lang: Lang): void {
  current = CATALOGS[lang] ? lang : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

export function language(): Lang {
  return current;
}

/** For gui-e2e's scan of a Spanish window for English left in it (milestone 68). */
export function catalogsForE2E(): Partial<Record<Lang, Catalog>> {
  return CATALOGS;
}

/** For tests: put a catalog in place of a language's (null removes it). */
export function setCatalogForTest(lang: Lang, catalog: Catalog | null): void {
  if (catalog) CATALOGS[lang] = catalog; else delete CATALOGS[lang];
}

function pluralRules(lang: Lang): Intl.PluralRules {
  let r = plurals.get(lang);
  if (!r) {
    r = new Intl.PluralRules(lang);
    plurals.set(lang, r);
  }
  return r;
}

function lookup(lang: Lang, key: string): string | undefined {
  return CATALOGS[lang]?.[key];
}

export function find(key: string, params?: Params): string | undefined {
  const count = params?.count;
  if (typeof count === 'number') {
    const form = `${key}.${pluralRules(current).select(count)}`;
    const v = lookup(current, form) ?? lookup(current, `${key}.other`);
    if (v !== undefined) return v;
    const e = lookup('en', `${key}.${pluralRules('en').select(count)}`) ?? lookup('en', `${key}.other`);
    if (e !== undefined) return e;
  }
  return lookup(current, key) ?? lookup('en', key);
}

/** Replaces `{name}` with params[name], as given: a number the text shows formatted
 * goes through fmtNumber first. */
export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined && !(name in params) ? whole : String(v);
  });
}

/** The text of `key` in the current language. */
export function t(key: string, params?: Params): string {
  const text = find(key, params);
  if (text === undefined) {
    if (STRICT) throw new Error(`i18n: no "${key}" in en.json`);
    return key;
  }
  return interpolate(text, params);
}

/** The text of `key` in every language with a catalog, for a search that should find
 * it in either (the palette's language and theme rows, D-144). */
export function textInEveryLanguage(key: string): string[] {
  return availableLanguages().map((l) => lookup(l, key)).filter((v): v is string => v !== undefined);
}

/** Whether the catalog has `key` (plain or with plural forms). */
export function hasKey(key: string): boolean {
  return lookup('en', key) !== undefined || lookup('en', `${key}.other`) !== undefined;
}

export function fmtNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(current, opts).format(n);
}

export function fmtDate(d: Date | number, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(current, opts).format(d);
}
