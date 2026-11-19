// The words of the toasts whose text is built from data (milestone 47): design 20d2's
// tunnels left up and Test connection's result. Kept apart from the views
// so the wording is tested without React.

/** Design 20d2: the last tab of a host closed while some of its tunnels are up. */
export function tunnelsLeftText(alias: string, names: string[]): { text: string; label: string } {
  if (names.length === 1) return { text: `Tab closed. Tunnel ${names[0]} still up on ${alias}`, label: 'Stop it' };
  return { text: `Tab closed. ${names.length} tunnels still up on ${alias}`, label: 'Stop them' };
}

/** Test connection succeeded: who answered, in how long, through how many jump hosts. */
export function testOkText(alias: string, target: string, ms: number, hops: number): string {
  const who = alias || target;
  const via = hops > 1 ? `, through ${hops - 1} jump host${hops > 2 ? 's' : ''}` : '';
  return `Connection to ${who} works · ${ms} ms${via}`;
}

/** Test connection failed. `alias` is empty for a host not named yet. */
export function testFailText(alias: string, message: string): string {
  return `Test of ${alias || 'the connection'} failed: ${message}`;
}

/** The toast's key for one host editor's test, so a second test replaces the first. */
export const testKey = (alias: string) => `test:${alias}`;
