// The fake Linux behind `flint connect` and `flint exec`. Every host opens the same
// read-only file tree (data/remote-fs.json); only the user, hostname and alias change.
import fsData from '../data/remote-fs.json' with { type: 'json' };
import { tokenize } from './args.ts';

export interface RemoteResult {
	stdout: string[];
	stderr: string[];
	code: number;
	exit?: boolean;
	clear?: boolean;
}

export const REMOTE_COMMANDS = [
	'ls', 'cd', 'pwd', 'cat', 'echo', 'whoami', 'hostname', 'uname', 'uptime', 'df', 'date', 'clear', 'help', 'exit', 'logout',
];

export class RemoteShell {
	readonly home: string;
	cwd: string;
	private dirs = new Set<string>();
	private files = new Map<string, string>();

	readonly alias: string;
	readonly user: string;
	readonly hostname: string;
	private now: () => Date;

	constructor(alias: string, user: string, hostname: string, now: () => Date = () => new Date()) {
		this.alias = alias;
		this.user = user;
		this.hostname = hostname;
		this.now = now;
		this.home = user === 'root' ? '/root' : `/home/${user}`;
		this.cwd = this.home;
		const fill = (s: string) =>
			s.replaceAll('{home}', this.home).replaceAll('{user}', user).replaceAll('{hostname}', hostname).replaceAll('{alias}', alias);
		for (const d of fsData.dirs) this.dirs.add(fill(d));
		for (const [p, text] of Object.entries(fsData.files as Record<string, string>)) this.files.set(fill(p), fill(text));
		if (this.home === '/root') this.dirs.delete('/home/root');
	}

	/** The prompt, with `~` for the home folder. */
	prompt(): string {
		return `${this.user}@${this.shortHost()}:${this.tilde(this.cwd)}$ `;
	}

	shortHost(): string {
		return /^[0-9.]+$/.test(this.hostname) ? this.hostname : this.hostname.split('.')[0];
	}

	private tilde(p: string): string {
		if (p === this.home) return '~';
		if (p.startsWith(this.home + '/')) return '~' + p.slice(this.home.length);
		return p;
	}

	private resolve(arg: string): string {
		let p = arg === '~' || arg.startsWith('~/') ? this.home + arg.slice(1) : arg;
		if (!p.startsWith('/')) p = (this.cwd === '/' ? '' : this.cwd) + '/' + p;
		const out: string[] = [];
		for (const seg of p.split('/')) {
			if (seg === '' || seg === '.') continue;
			if (seg === '..') out.pop();
			else out.push(seg);
		}
		return '/' + out.join('/');
	}

	private children(dir: string): { name: string; isDir: boolean }[] {
		const prefix = dir === '/' ? '/' : dir + '/';
		const names = new Map<string, boolean>();
		for (const d of this.dirs) {
			if (d !== dir && d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) names.set(d.slice(prefix.length), true);
		}
		for (const f of this.files.keys()) {
			if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) names.set(f.slice(prefix.length), false);
		}
		return [...names].map(([name, isDir]) => ({ name, isDir })).sort((a, b) => (a.name < b.name ? -1 : 1));
	}

	/** Path completions for Tab: entries of the folder a partial path points into. */
	complete(partial: string): string[] {
		const slash = partial.lastIndexOf('/');
		const base = slash >= 0 ? partial.slice(0, slash + 1) : '';
		const dir = this.resolve(base || '.');
		if (!this.dirs.has(dir)) return [];
		const stem = partial.slice(slash + 1);
		return this.children(dir)
			.filter((c) => c.name.startsWith(stem) && (stem.startsWith('.') || !c.name.startsWith('.')))
			.map((c) => base + c.name + (c.isDir ? '/' : ''));
	}

	run(line: string): RemoteResult {
		const t = tokenize(line);
		if ('error' in t) return { stdout: [], stderr: [`bash: ${t.error}`], code: 2 };
		if (t.pipe) return { stdout: [], stderr: ['bash: pipes are not part of the demo server'], code: 2 };
		const [cmd, ...args] = t.words;
		if (!cmd) return { stdout: [], stderr: [], code: 0 };
		const ok = (stdout: string[]): RemoteResult => ({ stdout, stderr: [], code: 0 });
		const err = (msg: string, code = 1): RemoteResult => ({ stdout: [], stderr: [msg], code });
		switch (cmd) {
			case 'exit':
			case 'logout':
				return { stdout: ['logout'], stderr: [], code: 0, exit: true };
			case 'clear':
				return { stdout: [], stderr: [], code: 0, clear: true };
			case 'pwd':
				return ok([this.cwd]);
			case 'whoami':
				return ok([this.user]);
			case 'hostname':
				return ok([this.shortHost()]);
			case 'echo':
				return ok([args.join(' ')]);
			case 'date':
				return ok([this.now().toUTCString().replace('GMT', 'UTC')]);
			case 'uname':
				return ok([args.includes('-a') ? `Linux ${this.shortHost()} 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux` : 'Linux']);
			case 'uptime': {
				const d = this.now();
				const hh = String(d.getHours()).padStart(2, '0');
				const mm = String(d.getMinutes()).padStart(2, '0');
				const ss = String(d.getSeconds()).padStart(2, '0');
				return ok([` ${hh}:${mm}:${ss} up 41 days,  2:17,  1 user,  load average: 0.08, 0.05, 0.01`]);
			}
			case 'df':
				return ok([
					'Filesystem      Size  Used Avail Use% Mounted on',
					'/dev/sda1        40G   12G   26G  32% /',
					'tmpfs           2.0G     0  2.0G   0% /dev/shm',
				]);
			case 'help':
				return ok([
					'This is a simulated server. Commands you can try:',
					'  ls [-l] [-a] [path]   cd [path]   pwd   cat <file>',
					'  whoami   hostname   uname -a   uptime   df -h   date   clear',
					'  exit                  back to your machine',
				]);
			case 'cd': {
				const target = this.resolve(args[0] ?? '~');
				if (this.files.has(target)) return err(`bash: cd: ${args[0]}: Not a directory`);
				if (!this.dirs.has(target)) return err(`bash: cd: ${args[0]}: No such file or directory`);
				this.cwd = target;
				return ok([]);
			}
			case 'cat': {
				if (args.length === 0) return err('cat: reading stdin is not part of the demo');
				const out: string[] = [];
				const errs: string[] = [];
				for (const a of args) {
					const p = this.resolve(a);
					if (this.dirs.has(p)) errs.push(`cat: ${a}: Is a directory`);
					else if (!this.files.has(p)) errs.push(`cat: ${a}: No such file or directory`);
					else out.push(...(this.files.get(p) as string).replace(/\n$/, '').split('\n'));
				}
				return { stdout: out, stderr: errs, code: errs.length ? 1 : 0 };
			}
			case 'ls':
			case 'll': {
				const flags = args.filter((a) => a.startsWith('-')).join('');
				const long = cmd === 'll' || flags.includes('l');
				const all = flags.includes('a');
				const paths = args.filter((a) => !a.startsWith('-'));
				const target = paths[0] ?? '.';
				const p = this.resolve(target);
				if (this.files.has(p)) return ok([long ? this.longEntry(target, false, p) : target]);
				if (!this.dirs.has(p)) return err(`ls: cannot access '${target}': No such file or directory`, 2);
				let entries = this.children(p).filter((c) => all || !c.name.startsWith('.'));
				if (all) entries = [{ name: '.', isDir: true }, { name: '..', isDir: true }, ...entries];
				if (!long) return ok(entries.length ? [entries.map((e) => e.name + (e.isDir ? '/' : '')).join('  ')] : []);
				return ok([`total ${entries.length * 4}`, ...entries.map((e) => this.longEntry(e.name, e.isDir, p + '/' + e.name))]);
			}
			case 'sudo':
				return err(`${this.user} is not in the sudoers file. (This is a demo server.)`);
			case 'ssh':
			case 'flint':
				return err(`bash: ${cmd}: the demo server has no ${cmd}; exit first, then use flint on your machine`, 127);
			default:
				return err(`bash: ${cmd}: command not found`, 127);
		}
	}

	private longEntry(name: string, isDir: boolean, path: string): string {
		const size = isDir ? 4096 : (this.files.get(path) ?? '').length;
		const mode = isDir ? 'drwxr-xr-x' : path.endsWith('.sh') ? '-rwxr-xr-x' : '-rw-r--r--';
		const owner = path.startsWith(this.home) ? this.user : 'root';
		return `${mode} 1 ${owner.padEnd(6)} ${owner.padEnd(6)} ${String(size).padStart(5)} Nov  4 18:20 ${name}${isDir ? '/' : ''}`;
	}
}
