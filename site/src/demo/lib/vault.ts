// The demo's vaults, in memory. The rules and messages follow the application layer
// (src/application/*.cf, src/domain/vault.cf). Secret values are only ever a marker:
// nothing typed into the demo is kept, and no view carries one (P6).
import { fail } from './errors.ts';

export interface Host {
	alias: string;
	label: string;
	hostname: string;
	port: number;
	user: string;
	group: string;
	tags: string[];
	color: string;
	notes: string;
	jump: string;
	credential: string;
	key: string;
	hasPassword: boolean;
}

export interface Key {
	name: string;
	type: string;
	fingerprint: string;
	publicKey: string;
	hasPassphrase: boolean;
}

export interface Cred {
	name: string;
	user: string;
	key: string;
	hasPassword: boolean;
}

export interface KnownHost {
	addr: string;
	keyType: string;
	fingerprint: string;
	addedAt: string;
}

export interface Vault {
	name: string;
	path: string;
	cached: boolean;
	groups: string[];
	hosts: Host[];
	keys: Key[];
	creds: Cred[];
	knownHosts: KnownHost[];
}

export interface World {
	current: string;
	vaults: Vault[];
}

// ---- views: the JSON shapes of the real CLI, in its field order -------------

export function hostView(h: Host) {
	return {
		alias: h.alias, label: h.label, hostname: h.hostname, port: h.port, user: h.user,
		group: h.group, tags: h.tags, color: h.color, notes: h.notes, jump: h.jump,
		credential: h.credential, key: h.key, has_password: h.hasPassword,
	};
}

export function keyView(k: Key) {
	return { name: k.name, type: k.type, public_key: k.publicKey, fingerprint: k.fingerprint, has_passphrase: k.hasPassphrase };
}

export function credView(c: Cred) {
	return { name: c.name, user: c.user, key: c.key, has_password: c.hasPassword };
}

// ---- seed --------------------------------------------------------------------

/** A fake but stable host key for an address, so a host keeps its fingerprint. */
export function serverKeyFor(addr: string): { type: string; fingerprint: string } {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	let h = 2166136261;
	let fp = '';
	for (let i = 0; i < 43; i++) {
		for (const ch of addr + i) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
		fp += alphabet[h % 64];
	}
	return { type: 'ssh-ed25519', fingerprint: 'SHA256:' + fp };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function worldFromSeed(seed: any): World {
	return {
		current: seed.current,
		vaults: seed.vaults.map((v: any) => ({
			name: v.name,
			path: v.path,
			cached: v.cached,
			groups: [...v.groups],
			keys: v.keys.map((k: any) => ({
				name: k.name, type: k.type, fingerprint: k.fingerprint, publicKey: k.public_key, hasPassphrase: k.has_passphrase,
			})),
			creds: v.creds.map((c: any) => ({ name: c.name, user: c.user, key: c.key ?? '', hasPassword: !!c.password })),
			hosts: v.hosts.map((h: any) => ({
				alias: h.alias, label: h.label ?? '', hostname: h.hostname, port: h.port ?? 22, user: h.user ?? '',
				group: h.group ?? '', tags: h.tags ?? [], color: h.color ?? '', notes: h.notes ?? '',
				jump: h.jump ?? '', credential: h.credential ?? '', key: h.key ?? '', hasPassword: !!h.password,
			})),
			knownHosts: v.known_hosts.map((k: any) => {
				const sk = serverKeyFor(k.addr);
				return { addr: k.addr, keyType: sk.type, fingerprint: sk.fingerprint, addedAt: k.added_at };
			}),
		})),
	};
}

// ---- validation (src/domain/vault.cf) -----------------------------------------

export function checkName(kind: string, value: string): void {
	if (value.length === 0 || value.length > 64) fail('invalid', `${kind} must be 1-64 characters`);
	if (value.startsWith('-') || value.startsWith('.')) fail('invalid', `${kind} '${value}' must not start with '-' or '.'`);
	if (!/^[A-Za-z0-9._-]+$/.test(value)) fail('invalid', `${kind} '${value}' may use only letters, digits, '.', '_' and '-'`);
}

function checkHostname(value: string): void {
	if (value.length === 0 || value.length > 253) fail('invalid', 'hostname must be 1-253 characters');
	if (/[\x00-\x20\x7f]/.test(value)) fail('invalid', 'hostname must not contain spaces or control characters');
}

function checkColor(value: string): void {
	if (value && !/^#[0-9a-fA-F]{6}$/.test(value)) fail('invalid', "color must be '#rrggbb'");
}

function checkText(kind: string, value: string, max: number): void {
	if (value.length > max) fail('invalid', `${kind} must be at most ${max} characters`);
}

function checkGroupName(name: string): void {
	if (name.length === 0 || name.length > 64) fail('invalid', 'group name must be 1-64 characters');
	if (name.includes('/')) fail('invalid', "group name must not contain '/'");
	if (name !== name.trim()) fail('invalid', 'group name must not start or end with a space');
}

const lower = (s: string) => s.toLowerCase();

// ---- the vault's use cases ---------------------------------------------------

export class VaultOps {
	readonly v: Vault;
	constructor(v: Vault) {
		this.v = v;
	}

	findHost(alias: string): Host {
		const h = this.v.hosts.find((x) => lower(x.alias) === lower(alias));
		if (!h) fail('not_found', `no host '${alias}'`);
		return h;
	}

	findKey(name: string): Key {
		const k = this.v.keys.find((x) => x.name === name);
		if (!k) fail('not_found', `no key '${name}'`);
		return k;
	}

	findCred(name: string): Cred {
		const c = this.v.creds.find((x) => x.name === name);
		if (!c) fail('not_found', `no credential '${name}'`);
		return c;
	}

	// groups

	private splitPath(path: string): string[] {
		return path.split('/').filter((s) => s.length > 0);
	}

	requireGroup(path: string): string {
		const parts = this.splitPath(path);
		if (parts.length === 0) fail('invalid', 'group path must not be empty');
		const norm = parts.join('/');
		if (!this.v.groups.includes(norm)) fail('not_found', `no group '${path}'`);
		return norm;
	}

	/** Creates a group path and any missing parents; returns the normalised path. */
	ensureGroup(path: string): string {
		const parts = this.splitPath(path);
		if (parts.length === 0) fail('invalid', 'group path must not be empty');
		if (parts.length > 16) fail('invalid', 'groups nest at most 16 levels deep');
		parts.forEach(checkGroupName);
		for (let i = 1; i <= parts.length; i++) {
			const p = parts.slice(0, i).join('/');
			if (!this.v.groups.includes(p)) this.v.groups.push(p);
		}
		return parts.join('/');
	}

	groupView(path: string) {
		const name = path.split('/').pop() as string;
		const hosts = this.v.hosts.filter((h) => h.group === path).length;
		const subgroups = this.v.groups.filter((g) => g.startsWith(path + '/') && !g.slice(path.length + 1).includes('/')).length;
		return { path, name, hosts, subgroups };
	}

	listGroups() {
		return [...this.v.groups].sort((a, b) => (lower(a) < lower(b) ? -1 : lower(a) > lower(b) ? 1 : 0)).map((g) => this.groupView(g));
	}

	addGroup(path: string) {
		const parts = this.splitPath(path);
		if (parts.length > 0 && this.v.groups.includes(parts.join('/'))) fail('conflict', `group '${path}' already exists`);
		return this.groupView(this.ensureGroup(path));
	}

	renameGroup(path: string, newName: string) {
		checkGroupName(newName);
		const from = this.requireGroup(path);
		const parent = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
		const to = parent + newName;
		if (to !== from && this.v.groups.includes(to)) fail('conflict', `a group named '${newName}' already exists there`);
		const move = (g: string) => (g === from ? to : g.startsWith(from + '/') ? to + g.slice(from.length) : g);
		this.v.groups = this.v.groups.map(move);
		for (const h of this.v.hosts) h.group = h.group ? move(h.group) : '';
		return this.groupView(to);
	}

	removeGroup(path: string) {
		const g = this.requireGroup(path);
		const view = this.groupView(g);
		if (view.hosts > 0 || view.subgroups > 0) {
			fail('conflict', `group '${view.path}' is not empty (${view.hosts} hosts, ${view.subgroups} subgroups)`);
		}
		this.v.groups = this.v.groups.filter((x) => x !== g);
		return view;
	}

	// hosts

	listHosts(group: string, tag: string): Host[] {
		const g = group ? this.requireGroup(group) : '';
		return this.v.hosts
			.filter((h) => !g || h.group === g || h.group.startsWith(g + '/'))
			.filter((h) => !tag || h.tags.some((t) => lower(t) === lower(tag)))
			.sort((a, b) => (lower(a.alias) < lower(b.alias) ? -1 : 1));
	}

	/** Applies a patch to a host (new or existing) and validates it. */
	private applyHost(h: Host, patch: HostPatch, isNew: boolean): void {
		if (patch.alias !== undefined) {
			const other = this.v.hosts.find((x) => lower(x.alias) === lower(patch.alias as string));
			if (other && other !== h) fail('conflict', `a host with alias '${patch.alias}' already exists`);
			h.alias = patch.alias;
		}
		if (patch.label !== undefined) h.label = patch.label;
		if (patch.hostname !== undefined) h.hostname = patch.hostname;
		if (patch.port !== undefined) h.port = patch.port;
		if (patch.user !== undefined) h.user = patch.user;
		if (patch.tags !== undefined) h.tags = patch.tags;
		if (patch.color !== undefined) h.color = patch.color;
		if (patch.notes !== undefined) h.notes = patch.notes;
		if (patch.password !== undefined) h.hasPassword = patch.password;
		if (isNew) {
			if (!h.alias) fail('usage', 'a host needs an alias');
			if (!h.hostname) fail('usage', 'a host needs a hostname (--hostname)');
		}
		checkName('alias', h.alias);
		checkHostname(h.hostname);
		checkText('label', h.label, 128);
		checkText('user', h.user, 128);
		checkText('notes', h.notes, 8192);
		checkColor(h.color);
		h.tags.forEach((t) => checkName('tag', t));
		if (patch.jump !== undefined) {
			if (patch.jump === '') {
				h.jump = '';
			} else {
				const j = this.findHost(patch.jump);
				if (lower(j.alias) === lower(h.alias)) fail('invalid', 'a host cannot be its own jump host');
				let cur: Host | undefined = j;
				for (let n = 0; cur && cur.jump && n < 32; n++) {
					if (lower(cur.jump) === lower(h.alias)) fail('invalid', `jump host '${patch.jump}' would make a loop`);
					cur = this.v.hosts.find((x) => lower(x.alias) === lower(cur!.jump));
				}
				h.jump = j.alias;
			}
		}
		if (patch.credential !== undefined) h.credential = patch.credential ? this.findCred(patch.credential).name : '';
		if (patch.key !== undefined) h.key = patch.key ? this.findKey(patch.key).name : '';
		if (patch.group !== undefined) h.group = patch.group ? this.ensureGroup(patch.group) : '';
	}

	addHost(patch: HostPatch): Host {
		const h: Host = {
			alias: '', label: '', hostname: '', port: 22, user: '', group: '', tags: [], color: '',
			notes: '', jump: '', credential: '', key: '', hasPassword: false,
		};
		const groupsBefore = [...this.v.groups];
		try {
			this.applyHost(h, patch, true);
		} catch (e) {
			this.v.groups = groupsBefore;
			throw e;
		}
		this.v.hosts.push(h);
		return h;
	}

	editHost(alias: string, patch: HostPatch): Host {
		const h = this.findHost(alias);
		const before = structuredClone(h);
		const groupsBefore = [...this.v.groups];
		try {
			this.applyHost(h, patch, false);
		} catch (e) {
			Object.assign(h, before);
			this.v.groups = groupsBefore;
			throw e;
		}
		if (patch.alias !== undefined && lower(before.alias) !== lower(h.alias)) {
			for (const o of this.v.hosts) if (lower(o.jump) === lower(before.alias)) o.jump = h.alias;
		}
		return h;
	}

	removeHost(alias: string): Host {
		const h = this.findHost(alias);
		const user = this.v.hosts.find((o) => lower(o.jump) === lower(h.alias));
		if (user) fail('conflict', `host '${user.alias}' uses '${h.alias}' as its jump host`);
		this.v.hosts = this.v.hosts.filter((x) => x !== h);
		return h;
	}

	// keys

	listKeys(): Key[] {
		return [...this.v.keys].sort((a, b) => (lower(a.name) < lower(b.name) ? -1 : 1));
	}

	renameKey(name: string, newName: string): Key {
		checkName('key name', newName);
		const k = this.findKey(name);
		if (this.v.keys.some((x) => x !== k && x.name === newName)) fail('conflict', `a key named '${newName}' already exists`);
		for (const h of this.v.hosts) if (h.key === k.name) h.key = newName;
		for (const c of this.v.creds) if (c.key === k.name) c.key = newName;
		k.name = newName;
		return k;
	}

	removeKey(name: string): Key {
		const k = this.findKey(name);
		const h = this.v.hosts.find((x) => x.key === k.name);
		if (h) fail('conflict', `host '${h.alias}' uses key '${k.name}'`);
		const c = this.v.creds.find((x) => x.key === k.name);
		if (c) fail('conflict', `credential '${c.name}' uses key '${k.name}'`);
		this.v.keys = this.v.keys.filter((x) => x !== k);
		return k;
	}

	// credentials

	listCreds(): Cred[] {
		return [...this.v.creds].sort((a, b) => (lower(a.name) < lower(b.name) ? -1 : 1));
	}

	private applyCred(c: Cred, patch: CredPatch): void {
		if (patch.name !== undefined) {
			checkName('credential name', patch.name);
			if (this.v.creds.some((x) => x !== c && x.name === patch.name)) fail('conflict', `a credential named '${patch.name}' already exists`);
		}
		if (patch.user !== undefined) {
			if (!patch.user) fail('invalid', 'a credential needs a user');
			checkText('user', patch.user, 128);
		}
		const key = patch.key !== undefined ? (patch.key ? this.findKey(patch.key).name : '') : c.key;
		if (patch.name !== undefined) {
			for (const h of this.v.hosts) if (c.name && h.credential === c.name) h.credential = patch.name;
			c.name = patch.name;
		}
		if (patch.user !== undefined) c.user = patch.user;
		c.key = key;
		if (patch.password !== undefined) c.hasPassword = patch.password;
	}

	addCred(patch: CredPatch): Cred {
		if (!patch.name) fail('usage', 'a credential needs a name');
		if (!patch.user) fail('usage', 'a credential needs a user (--user)');
		const c: Cred = { name: '', user: '', key: '', hasPassword: false };
		this.applyCred(c, patch);
		this.v.creds.push(c);
		return c;
	}

	editCred(name: string, patch: CredPatch): Cred {
		const c = this.findCred(name);
		this.applyCred(c, patch);
		return c;
	}

	removeCred(name: string): Cred {
		const c = this.findCred(name);
		const h = this.v.hosts.find((x) => x.credential === c.name);
		if (h) fail('conflict', `host '${h.alias}' uses credential '${c.name}'`);
		this.v.creds = this.v.creds.filter((x) => x !== c);
		return c;
	}

	// known hosts

	/** The known_hosts address of a host: `host` on 22, `[host]:port` otherwise (D-019). */
	static addrOf(h: Host): string {
		return h.port === 22 ? h.hostname : `[${h.hostname}]:${h.port}`;
	}

	knownHostFor(h: Host): KnownHost | undefined {
		return this.v.knownHosts.find((k) => k.addr === VaultOps.addrOf(h));
	}

	knownHostRows() {
		return [...this.v.knownHosts]
			.sort((a, b) => (a.addr < b.addr ? -1 : 1))
			.map((k) => ({
				addr: k.addr,
				host: this.v.hosts.find((h) => VaultOps.addrOf(h) === k.addr)?.alias ?? '',
				key_type: k.keyType,
				fingerprint: k.fingerprint,
				added_at: k.addedAt,
			}));
	}

	removeKnownHost(selector: string): KnownHost {
		const byAlias = this.v.hosts.find((h) => lower(h.alias) === lower(selector));
		const addr = byAlias ? VaultOps.addrOf(byAlias) : selector;
		const k = this.v.knownHosts.find((x) => x.addr === addr);
		if (!k) fail('not_found', `no known host key for '${selector}'`);
		this.v.knownHosts = this.v.knownHosts.filter((x) => x !== k);
		return k;
	}
}

export interface HostPatch {
	alias?: string;
	label?: string;
	hostname?: string;
	port?: number;
	user?: string;
	group?: string;
	tags?: string[];
	color?: string;
	notes?: string;
	jump?: string;
	credential?: string;
	key?: string;
	/** Whether a password is stored after the change. The value itself is never kept. */
	password?: boolean;
}

export interface CredPatch {
	name?: string;
	user?: string;
	key?: string;
	password?: boolean;
}
