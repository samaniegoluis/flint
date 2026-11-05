// Output formatting of src/drivers/cli/output.cf: two-space columns, "-" for empty.
import type { Host } from './vault.ts';

export function table(headers: string[], rows: string[][]): string[] {
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
	const line = (cells: string[]) =>
		cells.map((c, i) => (i + 1 === cells.length ? c : c.padEnd(widths[i] + 2))).join('');
	return [line(headers), ...rows.map(line)];
}

export function fields(names: string[], values: string[]): string[] {
	const w = Math.max(...names.map((n) => n.length));
	return names.map((n, i) => n.padEnd(w + 2) + values[i]);
}

export const dash = (s: string) => (s.length === 0 ? '-' : s);
export const yesNo = (b: boolean) => (b ? 'yes' : 'no');

/** `user@host:port`, as host_target. */
export function hostTarget(h: Host, user = h.user): string {
	let t = h.hostname;
	if (user) t = `${user}@${t}`;
	if (h.port !== 22) t += `:${h.port}`;
	return t;
}

/** cfire's json.stringify writes compact JSON, like JSON.stringify. */
export const json = (v: unknown) => JSON.stringify(v);
