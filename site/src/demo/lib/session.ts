// One demo terminal: the local prompt, the fake remote shells, prompts for secrets
// and host keys, Tab completion and the guided tour. No DOM: the page renders the
// lines this emits (src/components/CliDemo.astro).
import seed from '../data/seed-vault.json' with { type: 'json' };
import tourData from '../data/tour.json' with { type: 'json' };
import { ALL_FLAGS, tokenize } from './args.ts';
import { COMMANDS, runFlint, type Ask, type Io, type Outcome, type Run } from './cli.ts';
import { FlintError } from './errors.ts';
import { json } from './format.ts';
import { REMOTE_COMMANDS, RemoteShell } from './remote.ts';
import { worldFromSeed, type World } from './vault.ts';

export type LineKind = 'echo' | 'out' | 'err' | 'hint' | 'note';

export interface Line {
	kind: LineKind;
	text: string;
	/** For `echo`: the prompt the command was typed at. */
	prompt?: string;
	/** For `note`: a page the line links to. */
	href?: string;
}

interface TourStep {
	hint: string[];
	run: string;
	match: string;
	where: 'local' | 'remote';
	chips?: string[];
}

const TOUR = tourData as { intro: string[]; steps: TourStep[]; done: string[] };
export const TOUR_STEPS: readonly TourStep[] = TOUR.steps;

const LOCAL_PROMPT = '❯ ';
const LOCAL_BUILTINS = ['flint', 'help', 'clear', 'tour', 'reset'];

export interface SessionOptions {
	onLine: (line: Line) => void;
	onClear?: () => void;
	now?: () => Date;
	tour?: boolean;
}

export class DemoSession {
	world: World;
	/** Index of the current tour step; `null` when the tour is off or done. */
	tourStep: number | null;
	private pending: { gen: Run; ask: Ask } | null = null;
	private remote: { shell: RemoteShell; json: boolean } | null = null;
	private toldAboutRemote = false;
	private now: () => Date;

	private opts: SessionOptions;

	constructor(opts: SessionOptions) {
		this.opts = opts;
		this.world = worldFromSeed(seed);
		this.now = opts.now ?? (() => new Date());
		this.tourStep = opts.tour === false ? null : 0;
	}

	/** Prints the welcome and the first tour hint. */
	start(): void {
		TOUR.intro.forEach((t) => this.hint(t));
		if (this.tourStep !== null) this.showStep();
		else this.hint('# Type `flint help` to see every command, or `tour` for a guided tour.');
	}

	// ---- what the page shows ----

	prompt(): { text: string; secret: boolean } {
		if (this.pending) {
			const lines = this.pending.ask.label.split('\n');
			return { text: lines[lines.length - 1], secret: this.pending.ask.secret };
		}
		if (this.remote) return { text: this.remote.shell.prompt(), secret: false };
		return { text: LOCAL_PROMPT, secret: false };
	}

	/** Commands the visitor can tap instead of typing. */
	chips(): string[] {
		if (this.pending) return this.pending.ask.secret ? [] : ['yes', 'no'];
		const step = this.tourStep !== null ? TOUR.steps[this.tourStep] : undefined;
		if (this.remote) {
			if (step?.where === 'remote' && step.chips) return step.chips;
			return ['ls', 'cat notes.txt', 'uptime', 'exit'];
		}
		if (step?.where === 'local') return [step.run];
		return ['flint help', 'flint host list', 'flint connect db', 'flint vault list'];
	}

	/** "Step 2 of 8", or null with no tour running. */
	tourLabel(): string | null {
		return this.tourStep === null ? null : `Step ${this.tourStep + 1} of ${TOUR.steps.length}`;
	}

	// ---- input ----

	submit(input: string): void {
		const p = this.prompt();
		this.emit({ kind: 'echo', prompt: p.text, text: p.secret ? '' : input });
		if (this.pending) {
			this.drive(this.pending.gen, input);
			return;
		}
		if (this.remote) {
			this.runRemote(input);
			return;
		}
		this.runLocal(input);
	}

	/** Ctrl-C: drops the line or cancels a prompt. */
	interrupt(input: string): void {
		const p = this.prompt();
		this.emit({ kind: 'echo', prompt: p.text, text: (p.secret ? '' : input) + '^C' });
		if (this.pending) {
			this.pending.gen.return({ code: 130 });
			this.pending = null;
		}
	}

	stopTour(): void {
		this.tourStep = null;
		this.hint('# Tour closed. Type `tour` to start it again.');
	}

	restartTour(): void {
		this.tourStep = 0;
		this.showStep();
	}

	// ---- local side ----

	private runLocal(input: string): void {
		const t = tokenize(input);
		if ('error' in t) {
			this.err(`zsh: ${t.error}`);
			return;
		}
		const words = t.words;
		if (words.length === 0) return;
		const [cmd, ...rest] = words;
		switch (cmd) {
			case 'flint':
				this.drive(runFlint(rest, this.world, this.io()), undefined, words);
				return;
			case 'clear':
				this.opts.onClear?.();
				return;
			case 'help':
				this.hint('# This is a simulated terminal. `flint help` lists every Flint command.');
				this.hint('# Also here: `tour` (guided tour), `clear`, `reset` (a fresh demo vault).');
				return;
			case 'tour':
				this.restartTour();
				return;
			case 'reset':
				this.world = worldFromSeed(seed);
				this.hint('# The demo vault is back to its first state.');
				return;
			case 'ssh':
				this.err('zsh: command not found: ssh');
				this.hint(`# Flint replaces it here: flint connect ${rest.find((w) => !w.startsWith('-')) ?? 'db'}`);
				return;
			case 'exit':
			case 'logout':
				this.hint('# This is your machine in the demo. Close the demo with Esc or the × button.');
				return;
			default:
				this.err(`zsh: command not found: ${cmd}`);
				this.hint('# Only `flint` runs on this side. Try `flint help`.');
		}
	}

	private drive(gen: Run, answer?: string, words?: string[]): void {
		this.pending = null;
		let r: IteratorResult<Ask, Outcome>;
		try {
			r = answer === undefined ? gen.next() : gen.next(answer);
		} catch (e) {
			const msg = e instanceof FlintError ? e.message : String(e);
			this.err(`flint (demo): something went wrong in the demo: ${msg}`);
			return;
		}
		if (!r.done) {
			const lines = r.value.label.split('\n');
			lines.slice(0, -1).forEach((l) => this.out(l));
			this.pending = { gen, ask: r.value };
			this.pendingWords = words ?? this.pendingWords;
			return;
		}
		const done = r.value;
		const typed = words ?? this.pendingWords;
		this.pendingWords = undefined;
		if (done.connect) {
			this.enterRemote(done.connect);
		}
		if (done.code === 0 && typed) this.advanceTour(typed, 'local');
	}

	private pendingWords: string[] | undefined;

	// ---- remote side ----

	private enterRemote(c: NonNullable<Outcome['connect']>): void {
		const shell = new RemoteShell(c.alias, c.user, c.hostname, this.now);
		this.remote = { shell, json: c.json };
		this.out('Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)');
		this.out('');
		const step = this.tourStep !== null ? TOUR.steps[this.tourStep] : undefined;
		if (!this.toldAboutRemote && step?.where !== 'local') {
			this.hint('# A simulated server: try ls, cat notes.txt, uptime, then exit.');
		}
		this.toldAboutRemote = true;
	}

	private runRemote(input: string): void {
		const r = this.remote!.shell.run(input);
		r.stdout.forEach((l) => this.out(l));
		r.stderr.forEach((l) => this.err(l));
		if (r.clear) this.opts.onClear?.();
		if (r.exit) {
			const { shell, json: asJson } = this.remote!;
			this.remote = null;
			if (asJson) this.out(json({ host: shell.alias, exit_code: 0 }));
			this.advanceTour(['exit'], 'remote');
		}
	}

	// ---- tour ----

	private showStep(): void {
		if (this.tourStep === null) return;
		const step = TOUR.steps[this.tourStep];
		const [first, ...more] = step.hint;
		this.hint(`# Step ${this.tourStep + 1}/${TOUR.steps.length} · ${first}`);
		more.forEach((h) => this.hint('# ' + h));
	}

	private advanceTour(words: string[], where: 'local' | 'remote'): void {
		if (this.tourStep === null) return;
		const step = TOUR.steps[this.tourStep];
		if (step.where !== where) return;
		const need = step.match.split(' ');
		const matches = words[0] === need[0] && need.slice(1).every((w, i) => (i < 2 ? words[i + 1] === w : words.includes(w)));
		if (!matches) return;
		this.tourStep += 1;
		if (this.tourStep >= TOUR.steps.length) {
			this.tourStep = null;
			TOUR.done.forEach((t) => this.hint(t));
			return;
		}
		this.showStep();
	}

	// ---- Tab completion ----

	/** Completes the last word. Returns the new input; prints the options when ambiguous. */
	complete(input: string): string {
		if (this.pending) return input;
		const cut = input.lastIndexOf(' ') + 1;
		const head = input.slice(0, cut);
		const word = input.slice(cut);
		const before = head.trim().split(/\s+/).filter(Boolean);
		const options = this.candidates(before, word).filter((c) => c.startsWith(word));
		if (options.length === 0) return input;
		if (options.length === 1) {
			const only = options[0];
			return head + only + (only.endsWith('/') ? '' : ' ');
		}
		let common = options[0];
		for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1);
		if (common.length > word.length) return head + common;
		this.emit({ kind: 'echo', prompt: this.prompt().text, text: input });
		this.out(options.join('  '));
		return input;
	}

	private candidates(before: string[], word: string): string[] {
		if (this.remote) {
			if (before.length === 0) return REMOTE_COMMANDS;
			return this.remote.shell.complete(word);
		}
		if (before.length === 0) return LOCAL_BUILTINS;
		if (before[0] !== 'flint') return [];
		const args = before.slice(1).filter((w) => !w.startsWith('-'));
		if (word.startsWith('-')) return ALL_FLAGS;
		const v = this.world.vaults.find((x) => x.name === this.world.current);
		const aliases = v ? v.hosts.map((h) => h.alias) : [];
		const last = before[before.length - 1];
		if (['--jump'].includes(last)) return aliases;
		if (last === '--group') return v ? v.groups : [];
		if (last === '--key') return v ? v.keys.map((k) => k.name) : [];
		if (last === '--cred') return v ? v.creds.map((c) => c.name) : [];
		if (last === '--vault') return this.world.vaults.map((x) => x.name);
		if (args.length === 0) return Object.keys(COMMANDS);
		const noun = args[0];
		if (noun === 'connect' || noun === 'exec') return args.length === 1 ? aliases : [];
		if (args.length === 1) return COMMANDS[noun] ?? [];
		if (args.length === 2) {
			const verb = args[1];
			if (noun === 'host' && ['show', 'edit', 'rm'].includes(verb)) return aliases;
			if (noun === 'known-host' && verb === 'rm') return aliases;
			if (noun === 'key' && ['show', 'rename', 'rm'].includes(verb)) return v ? v.keys.map((k) => k.name) : [];
			if (noun === 'cred' && ['show', 'edit', 'rm'].includes(verb)) return v ? v.creds.map((c) => c.name) : [];
			if (noun === 'group' && ['rename', 'rm'].includes(verb)) return v ? v.groups : [];
			if (noun === 'vault' && ['use', 'forget'].includes(verb)) return this.world.vaults.map((x) => x.name);
		}
		return [];
	}

	// ---- output ----

	private io(): Io {
		return {
			out: (l) => this.out(l),
			err: (l) => this.err(l),
			note: (l, href) => this.emit({ kind: 'note', text: l, href }),
			now: this.now,
		};
	}

	private emit(line: Line) {
		this.opts.onLine(line);
	}
	private out(text: string) {
		this.emit({ kind: 'out', text });
	}
	private err(text: string) {
		this.emit({ kind: 'err', text });
	}
	private hint(text: string) {
		this.emit({ kind: 'hint', text });
	}
}
