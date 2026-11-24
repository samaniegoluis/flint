// The words of the toasts whose text is built from data (milestone 47): design 20d2's
// tunnels left up and Test connection's result. Kept apart from the views
// so the wording is tested without React.

import { t } from '../i18n';

/** Design 20d2: the last tab of a host closed while some of its tunnels are up. */
export function tunnelsLeftText(alias: string, names: string[]): { text: string; label: string } {
  if (names.length === 1) return { text: t('toast.tunnel_left_up', { name: names[0], alias }), label: t('toast.stop_it') };
  return { text: t('toast.tunnels_left_up', { count: names.length, alias }), label: t('toast.stop_them') };
}

/** Test connection succeeded: who answered, in how long, through how many jump hosts. */
export function testOkText(alias: string, target: string, ms: number, hops: number): string {
  const who = alias || target;
  return hops > 1 ? t('toast.test_ok_jumps', { who, ms, count: hops - 1 }) : t('toast.test_ok', { who, ms });
}

/** Test connection failed. `alias` is empty for a host not named yet. */
export function testFailText(alias: string, message: string): string {
  return alias ? t('toast.test_failed', { alias, message }) : t('toast.test_failed_unnamed', { message });
}

/** The toast's key for one host editor's test, so a second test replaces the first. */
export const testKey = (alias: string) => `test:${alias}`;
