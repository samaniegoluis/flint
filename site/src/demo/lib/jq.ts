// A tiny jq for the demo's one allowed pipe: `flint … --json | jq [filter]`.
// jq is a separate tool, not part of Flint; the demo carries the few filters the
// tour suggests so people can see the JSON read the way scripts read it.

/** A piece of a coloured line, as jq colours its output. */
export interface Span {
	text: string;
	cls?: 'key' | 'str' | 'num' | 'null';
}

export interface JqResult {
	lines: Span[][];
	stderr: string[];
	code: number;
}

export const JQ_HELP = 'the demo knows ., .[], .[N], .field, .[].field, length, and the -r and -c flags';

type Step = { kind: 'iter' } | { kind: 'index'; n: number } | { kind: 'field'; name: string } | { kind: 'length' };

function parseFilter(f: string): Step[] | null {
	const t = f.trim();
	if (t === '' || t === '.') return [];
	if (t === 'length') return [{ kind: 'length' }];
	if (!t.startsWith('.')) return null;
	const steps: Step[] = [];
	const re = /\[\]|\[(\d+)\]|\.([A-Za-z_][A-Za-z0-9_]*)|\./y;
	let i = 0;
	while (i < t.length) {
		re.lastIndex = i;
		const m = re.exec(t);
		if (!m) return null;
		if (m[0] === '[]') steps.push({ kind: 'iter' });
		else if (m[1] !== undefined) steps.push({ kind: 'index', n: Number(m[1]) });
		else if (m[2] !== undefined) steps.push({ kind: 'field', name: m[2] });
		i = re.lastIndex;
	}
	return steps;
}

function apply(values: unknown[], step: Step): unknown[] {
	const out: unknown[] = [];
	for (const v of values) {
		if (step.kind === 'iter') {
			if (Array.isArray(v)) out.push(...v);
			else if (v && typeof v === 'object') out.push(...Object.values(v));
			else throw new Error(`Cannot iterate over ${v === null ? 'null' : typeof v}`);
		} else if (step.kind === 'index') {
			out.push(Array.isArray(v) ? (v[step.n] ?? null) : null);
		} else if (step.kind === 'field') {
			if (v !== null && (typeof v !== 'object' || Array.isArray(v))) {
				throw new Error(`Cannot index ${Array.isArray(v) ? 'array' : typeof v} with "${step.name}"`);
			}
			out.push(v === null ? null : ((v as Record<string, unknown>)[step.name] ?? null));
		} else {
			out.push(Array.isArray(v) || typeof v === 'string' ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);
		}
	}
	return out;
}

/** jq's pretty output: two-space indent, coloured keys and values. */
function pretty(v: unknown, compact: boolean): Span[][] {
	const lines: Span[][] = [[]];
	const put = (s: Span) => lines[lines.length - 1].push(s);
	const nl = (depth: number) => {
		if (compact) return;
		lines.push([{ text: '  '.repeat(depth) }]);
	};
	const scalar = (x: unknown): Span =>
		x === null
			? { text: 'null', cls: 'null' }
			: typeof x === 'string'
				? { text: JSON.stringify(x), cls: 'str' }
				: { text: String(x), cls: 'num' };
	const walk = (x: unknown, depth: number) => {
		if (Array.isArray(x)) {
			if (x.length === 0) return put({ text: '[]' });
			put({ text: '[' });
			x.forEach((item, i) => {
				nl(depth + 1);
				walk(item, depth + 1);
				if (i < x.length - 1) put({ text: ',' });
			});
			nl(depth);
			put({ text: ']' });
		} else if (x && typeof x === 'object') {
			const entries = Object.entries(x);
			if (entries.length === 0) return put({ text: '{}' });
			put({ text: '{' });
			entries.forEach(([k, val], i) => {
				nl(depth + 1);
				put({ text: JSON.stringify(k), cls: 'key' });
				put({ text: compact ? ':' : ': ' });
				walk(val, depth + 1);
				if (i < entries.length - 1) put({ text: ',' });
			});
			nl(depth);
			put({ text: '}' });
		} else {
			put(scalar(x));
		}
	};
	walk(v, 0);
	return lines;
}

/** Runs `jq <args>` on what the left side of the pipe printed. */
export function runJq(args: string[], input: string[]): JqResult {
	const raw = args.includes('-r') || args.includes('--raw-output');
	const compact = args.includes('-c') || args.includes('--compact-output');
	const unknown = args.filter((a) => a.startsWith('-') && !['-r', '-c', '--raw-output', '--compact-output'].includes(a));
	const filters = args.filter((a) => !a.startsWith('-'));
	const steps = filters.length <= 1 ? parseFilter(filters[0] ?? '.') : null;
	if (unknown.length || !steps) {
		return { lines: [], stderr: [`jq (demo): ${JQ_HELP}`], code: 3 };
	}
	const text = input.join('\n').trim();
	if (!text) return { lines: [], stderr: [], code: 0 };
	let doc: unknown;
	try {
		doc = JSON.parse(text);
	} catch {
		return { lines: [], stderr: ['jq: parse error: Invalid literal at line 1, column 1 (the input is not JSON; add --json to the flint command)'], code: 2 };
	}
	let values: unknown[] = [doc];
	try {
		for (const s of steps) values = apply(values, s);
	} catch (e) {
		return { lines: [], stderr: [`jq: error (at <stdin>:1): ${(e as Error).message}`], code: 5 };
	}
	const lines: Span[][] = [];
	for (const v of values) {
		if (raw && typeof v === 'string') lines.push([{ text: v }]);
		else lines.push(...pretty(v, compact));
	}
	return { lines, stderr: [], code: 0 };
}
