// Command-line handling: a small shell tokenizer for the demo prompt, and the flag
// parser of src/drivers/clicmd/args.cf.
import { fail } from './errors.ts';

/** `pipe` holds the words after a single `|`, when there is one. */
export type Tokens = { words: string[]; pipe?: string[] } | { error: string };

/**
 * Splits a line as a POSIX shell would for plain words: whitespace separates,
 * single and double quotes group, a backslash escapes the next character.
 * One `|` is kept apart (the demo pipes into jq); redirection and command lists are
 * reported, not run.
 */
export function tokenize(line: string): Tokens {
	const first: string[] = [];
	let pipe: string[] | undefined;
	let words = first;
	let cur = '';
	let inWord = false;
	let quote: '' | "'" | '"' = '';
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quote) {
			if (ch === quote) {
				quote = '';
			} else if (ch === '\\' && quote === '"' && i + 1 < line.length) {
				cur += line[++i];
			} else {
				cur += ch;
			}
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			inWord = true;
		} else if (ch === '\\' && i + 1 < line.length) {
			cur += line[++i];
			inWord = true;
		} else if (ch === ' ' || ch === '\t') {
			if (inWord) words.push(cur);
			cur = '';
			inWord = false;
		} else if (ch === '|' && !pipe && line[i + 1] !== '|') {
			if (inWord) words.push(cur);
			cur = '';
			inWord = false;
			pipe = [];
			words = pipe;
		} else if ('|<>;&`$'.includes(ch)) {
			return { error: `'${ch}' is not part of the demo shell: run one command at a time` };
		} else {
			cur += ch;
			inWord = true;
		}
	}
	if (quote) return { error: 'unterminated quote' };
	if (inWord) words.push(cur);
	if (pipe && (first.length === 0 || pipe.length === 0)) return { error: "a '|' needs a command on each side" };
	return pipe ? { words: first, pipe } : { words: first };
}

const VALUE_FLAGS = [
	'--vault', '--name', '--hostname', '--label', '--port', '--user', '--group', '--tag',
	'--color', '--notes', '--jump', '--cred', '--key', '--file', '--alias', '--timeout',
	'--exec-timeout', '--command', '--hosts', '--allow', '--ttl',
];

const BOOL_FLAGS = [
	'--json', '--help', '-h', '--version', '-V', '--master-stdin', '--password',
	'--password-stdin', '--no-password', '--passphrase', '--passphrase-stdin', '--key-stdin',
	'--no-tags', '--accept-new-host-key', '--keep-shell', '--no-keep-shell', '--no-command', '--dry-run', '--all',
	'--sudo', '--sudo-password', '--sudo-password-stdin', '--no-sudo-password',
];

const GLOBAL_FLAGS = ['--json', '--vault', '--help', '-h', '--master-stdin'];

/** Every flag the real CLI knows, for Tab completion. */
export const ALL_FLAGS = [...VALUE_FLAGS, ...BOOL_FLAGS].filter((f) => f.startsWith('--'));

export class ParsedArgs {
	positionals: string[] = [];
	flagNames: string[] = [];
	flagValues: string[] = [];
	rest: string[] = [];
	hasRest = false;

	has(name: string): boolean {
		return this.flagNames.includes(name);
	}

	/** The last value given for a flag, or "" (as `flag_value`). */
	value(name: string): string {
		let v = '';
		this.flagNames.forEach((n, i) => {
			if (n === name) v = this.flagValues[i];
		});
		return v;
	}

	values(name: string): string[] {
		return this.flagNames.flatMap((n, i) => (n === name ? [this.flagValues[i]] : []));
	}

	positional(i: number): string {
		return this.positionals[i] ?? '';
	}

	allowFlags(command: string, allowed: string[]): void {
		for (const n of this.flagNames) {
			if (!allowed.includes(n) && !GLOBAL_FLAGS.includes(n)) {
				fail('usage', `\`flint ${command}\` does not take ${n}`);
			}
		}
	}

	/** `n` arguments after the noun and the verb. */
	expectArgs(command: string, n: number, shape: string): void {
		if (this.positionals.length !== n + 2) {
			fail('usage', `usage: flint ${command} ${shape}`.trimEnd());
		}
	}
}

/** Parses the words after `flint`, as parse_cli_args does. */
export function parseFlintArgs(args: string[]): ParsedArgs {
	const p = new ParsedArgs();
	let i = 0;
	while (i < args.length) {
		const a = args[i++];
		if (a === '--') {
			p.hasRest = true;
			p.rest = args.slice(i);
			break;
		}
		if (a.length > 1 && a.startsWith('-')) {
			let name = a;
			let value = '';
			let inline = false;
			const eq = a.indexOf('=');
			if (a.startsWith('--') && eq > 0) {
				name = a.slice(0, eq);
				value = a.slice(eq + 1);
				inline = true;
			}
			if (VALUE_FLAGS.includes(name)) {
				if (!inline) {
					if (i >= args.length) fail('usage', `${name} needs a value`);
					value = args[i++];
				}
			} else if (BOOL_FLAGS.includes(name)) {
				if (inline) fail('usage', `${name} takes no value`);
			} else {
				fail('usage', `unknown flag ${name}`);
			}
			p.flagNames.push(name);
			p.flagValues.push(value);
		} else {
			p.positionals.push(a);
		}
	}
	return p;
}

/** `--json` anywhere before a bare `--`, decided before parsing (as main.cf does). */
export function wantsJson(args: string[]): boolean {
	for (const a of args) {
		if (a === '--') return false;
		if (a === '--json') return true;
	}
	return false;
}

export function parsePort(text: string): number {
	if (!/^[0-9]{1,5}$/.test(text)) fail('invalid', 'port must be a number 1-65535');
	const n = Number(text);
	if (n < 1 || n > 65535) fail('invalid', 'port must be a number 1-65535');
	return n;
}

export function parseSeconds(name: string, text: string): number {
	if (!/^[0-9]{1,6}$/.test(text)) fail('invalid', `${name} must be a number of seconds, 1-86400`);
	const n = Number(text);
	if (n < 1 || n > 86400) fail('invalid', `${name} must be a number of seconds, 1-86400`);
	return n;
}
