// Milestone 68: the page in Spanish, through the real catalogs. Numbers, sizes and
// dates follow the language (never a pinned 'en-US'), and plurals pick Spanish forms.

import { afterEach, describe, expect, it } from 'vitest';
import { fmtDate, setLanguage, t } from './index';
import { sizeLabel, agoLabel } from '../lib/sync';
import { shortDate } from '../lib/update';
import { mb } from '../sessions/paste';

afterEach(() => setLanguage('en'));

describe('Spanish', () => {
  it('reads the Spanish catalog and its plurals', () => {
    setLanguage('es');
    expect(t('settings_page.section.appearance')).toBe('Apariencia');
    expect(t('shell.sessions_open', { count: 1 })).toBe('1 sesión');
    expect(t('shell.sessions_open', { count: 3 })).toBe('3 sesiones');
    // Intl names a "many" form for Spanish millions: it falls back to "other".
    expect(t('shell.sessions_open', { count: 1000000 })).toBe('1000000 sesiones');
  });

  it('formats sizes, dates and times in Spanish', () => {
    setLanguage('es');
    expect(sizeLabel(1.5 * 1024 * 1024)).toBe('1,5 MB');
    expect(mb(2.5 * 1024 * 1024)).toBe('2,5 MB');
    expect(shortDate('2026-11-18')).toBe('18 nov');
    expect(fmtDate(Date.UTC(2026, 10, 18, 14, 5), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })).toBe('14:05');
    expect(agoLabel(1000, 1000 + 5 * 60_000)).toBe('hace 5 min');
  });

  it('formats the same values in English as before', () => {
    expect(sizeLabel(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(shortDate('2026-11-18')).toBe('18 Nov');
  });
});
