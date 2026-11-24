import { afterEach, describe, expect, it } from 'vitest';
import en from './en.json';
import { availableLanguages, fmtDate, fmtNumber, hasKey, language, resolveLanguage, setCatalogForTest, setLanguage, t } from './index';

const EN = {
  'test.hello': 'Hello, {name}',
  'test.hosts.one': '{count} host',
  'test.hosts.other': '{count} hosts',
  'test.only_en': 'Only in English',
};
const ES = {
  'test.hello': 'Hola, {name}',
  'test.hosts.one': '{count} host',
  'test.hosts.other': '{count} hosts',
};

afterEach(() => {
  setCatalogForTest('en', en);
  setCatalogForTest('es', null);
  setLanguage('en');
});

describe('t', () => {
  it('fills parameters and leaves an unknown one as written', () => {
    setCatalogForTest('en', EN);
    expect(t('test.hello', { name: 'codebox' })).toBe('Hello, codebox');
    expect(t('test.hello')).toBe('Hello, {name}');
  });

  it('picks the plural form by count', () => {
    setCatalogForTest('en', EN);
    expect(t('test.hosts', { count: 1 })).toBe('1 host');
    expect(t('test.hosts', { count: 0 })).toBe('0 hosts');
    expect(t('test.hosts', { count: 3 })).toBe('3 hosts');
    expect(hasKey('test.hosts')).toBe(true);
  });

  it('reads English for a key the chosen language lacks', () => {
    setCatalogForTest('en', EN);
    setCatalogForTest('es', ES);
    setLanguage('es');
    expect(language()).toBe('es');
    expect(t('test.hello', { name: 'x' })).toBe('Hola, x');
    expect(t('test.only_en')).toBe('Only in English');
  });

  it('throws in tests for a key English lacks', () => {
    setCatalogForTest('en', EN);
    expect(() => t('test.nowhere')).toThrow(/test\.nowhere/);
  });
});

describe('languages', () => {
  it('offers only the languages with a catalog, and resolves system and unknown ones', () => {
    setCatalogForTest('en', EN);
    expect(availableLanguages()).toEqual(['en']);
    expect(resolveLanguage('system', 'es')).toBe('en');
    setCatalogForTest('es', ES);
    expect(availableLanguages()).toEqual(['en', 'es']);
    expect(resolveLanguage('system', 'es')).toBe('es');
    expect(resolveLanguage('system', undefined)).toBe('en');
    expect(resolveLanguage('en', 'es')).toBe('en');
    expect(resolveLanguage('es', 'en')).toBe('es');
    expect(resolveLanguage('fr', 'en')).toBe('en');
  });

  it('formats numbers and dates for the language', () => {
    setCatalogForTest('es', ES);
    expect(fmtNumber(12345.5)).toBe('12,345.5');
    setLanguage('es');
    expect(fmtNumber(12345.5)).toBe('12.345,5');
    const d = new Date(Date.UTC(2026, 10, 23, 12));
    expect(fmtDate(d, { month: 'long', timeZone: 'UTC' })).toBe('noviembre');
  });
});
