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
	/** The host's own sudo password (`exec --sudo`); otherwise the login password. */
	hasSudoPassword: boolean;
	/** The initial command (D-031); '' for a plain shell. */
	command: string;
	keepShell: boolean;
	/** `ssh` or `rdp` (milestone 29); fixed once added. */
	type: 'ssh' | 'rdp';
	/** An RDP host's Windows domain; '' for none. */
	domain: string;
	/** Local forwards saved in this host (milestone 22); they go with it. */
	tunnels: Tunnel[];
}

export interface Tunnel {
	name: string;
	localPort: number;
	destHost: string;
	destPort: number;
	openOnConnect: boolean;
	/** Running in Flint, which the demo pretends is open. */
	running: boolean;
}

/** What `tunnel add|edit` sets; absent fields stay as they are. */
export interface TunnelPatch {
	name?: string;
	localPort?: number;
	dest?: [string, number];
	openOnConnect?: boolean;
}

/** TunnelView of src/application/tunnels.cf, in its field order. */
export interface TunnelView {
	host: string;
	name: string;
	local_port: number;
	destination: string;
	open_on_connect: boolean;
	state: string;
	listen: string;
	connections: number;
	error: string;
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
	/** Unlocked in the Flint app, which the demo pretends is open (D-042). One at a time. */
	unlocked: boolean;
	groups: string[];
	hosts: Host[];
	keys: Key[];
	creds: Cred[];
	knownHosts: KnownHost[];
	/** Tokens (milestone 12b): revoked, never deleted. The demo keeps no hash: nothing is real. */
	tokens: Token[];
}

export interface Token {
	id: string;
	name: string;
	all: boolean;
	groups: string[];
	hosts: string[];
	read: boolean;
	exec: boolean;
	write: boolean;
	createdAt: number;
	expiresAt: number;
	revokedAt: number;
}

export interface TokenRequest {
	name: string;
	all: boolean;
	groups: string[];
	hosts: string[];
	read: boolean;
	exec: boolean;
	write: boolean;
	ttl: string;
}

export interface World {
	current: string;
	vaults: Vault[];
	/** This terminal was allowed in Flint's window (milestone 12); until a lock. */
	approved?: boolean;
}

// ---- views: the JSON shapes of the real CLI, in its field order -------------

export function hostView(h: Host) {
	return {
		alias: h.alias, label: h.label, hostname: h.hostname, port: h.port, user: h.user,
		group: h.group, tags: h.tags, color: h.color, notes: h.notes, jump: h.jump,
		credential: h.credential, key: h.key, has_password: h.hasPassword,
		has_sudo_password: h.hasSudoPassword, command: h.command, keep_shell: h.keepShell,
		type: h.type, domain: h.domain,
	};
}

export function keyView(k: Key) {
	return { name: k.name, type: k.type, public_key: k.publicKey, fingerprint: k.fingerprint, has_passphrase: k.hasPassphrase };
}

export function credView(c: Cred) {
	return { name: c.name, user: c.user, key: c.key, has_password: c.hasPassword };
}

const TTLS: Record<string, number> = { '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '7d': 7 * 86400, '30d': 30 * 86400, '90d': 90 * 86400 };

export function tokenStatus(t: Token, now: number): string {
	if (t.revokedAt > 0) return 'revoked';
	return now >= t.expiresAt ? 'expired' : 'active';
}

export function tokenView(t: Token, now: number) {
	return {
		id: t.id, name: t.name, all: t.all, groups: t.groups, hosts: t.hosts, read: t.read, exec: t.exec, write: t.write,
		created_at: t.createdAt, expires_at: t.expiresAt, revoked_at: t.revokedAt, status: tokenStatus(t, now),
	};
}

export function tokenAllows(t: { read: boolean; exec: boolean; write: boolean }): string {
	return [t.read && 'read', t.exec && 'exec', t.write && 'write'].filter(Boolean).join(',');
}

export function tokenReach(t: { all: boolean; groups: string[]; hosts: string[] }): string {
	if (t.all) return 'whole vault';
	return [...t.hosts, ...t.groups.map((g) => '@' + g)].join(', ');
}

/** utc_text: "2026-11-08 10:00 UTC". */
export function utcText(secs: number): string {
	return new Date(secs * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/** Stable fake hex for the demo's tokens: never a real secret. */
function fakeHex(seed: string, n: number): string {
	let h = 2166136261;
	let out = '';
	for (let i = 0; out.length < n; i++) {
		for (const ch of seed + i) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
		out += h.toString(16).padStart(8, '0');
	}
	return out.slice(0, n);
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
			unlocked: v.unlocked,
			groups: [...v.groups],
			keys: v.keys.map((k: any) => ({
				name: k.name, type: k.type, fingerprint: k.fingerprint, publicKey: k.public_key, hasPassphrase: k.has_passphrase,
			})),
			creds: v.creds.map((c: any) => ({ name: c.name, user: c.user, key: c.key ?? '', hasPassword: !!c.password })),
			hosts: v.hosts.map((h: any) => ({
				alias: h.alias, label: h.label ?? '', hostname: h.hostname, port: h.port ?? 22, user: h.user ?? '',
				group: h.group ?? '', tags: h.tags ?? [], color: h.color ?? '', notes: h.notes ?? '',
				jump: h.jump ?? '', credential: h.credential ?? '', key: h.key ?? '', hasPassword: !!h.password, hasSudoPassword: false,
				command: h.command ?? '', keepShell: h.keep_shell ?? true, type: h.type ?? 'ssh', domain: h.domain ?? '',
				tunnels: (h.tunnels ?? []).map((t: any) => ({ name: t.name, localPort: t.local_port, destHost: t.dest_host ?? 'localhost', destPort: t.dest_port ?? t.local_port, openOnConnect: !!t.open_on_connect, running: false })),
			})),
			knownHosts: v.known_hosts.map((k: any) => {
				const sk = serverKeyFor(k.addr);
				return { addr: k.addr, keyType: sk.type, fingerprint: sk.fingerprint, addedAt: k.added_at };
			}),
			tokens: [],
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

/** src/domain/rdp.cf: SSH-only settings are refused on an RDP host, a domain on an SSH host. */
function checkRdpHost(h: Host): void {
	checkText('domain', h.domain, 128);
	if (h.type !== 'rdp') {
		if (h.domain) fail('invalid', 'a domain applies to RDP hosts only');
		return;
	}
	if (h.key) fail('invalid', 'an RDP host logs in with a password, not an SSH key');
	if (h.jump) fail('invalid', 'an RDP host has no jump host');
	if (h.command) fail('invalid', 'an RDP host has no initial command');
	if (h.hasSudoPassword) fail('invalid', 'an RDP host has no sudo password');
}

/** An RDP host given to something only SSH does (`wrong_host_type`). */
export function requireSshHost(h: Host, what: string): void {
	if (h.type === 'rdp') fail('wrong_host_type', `'${h.alias}' is an RDP host; ${what} needs an SSH host`);
}

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
		if (patch.sudoPassword !== undefined) h.hasSudoPassword = patch.sudoPassword;
		if (patch.command !== undefined) h.command = patch.command;
		if (patch.keepShell !== undefined) h.keepShell = patch.keepShell;
		if (patch.type !== undefined) {
			if (patch.type !== 'ssh' && patch.type !== 'rdp') fail('invalid', `host type must be 'ssh' or 'rdp', not '${patch.type}'`);
			if (!isNew && h.type !== patch.type) {
				fail('invalid', `'${h.alias}' is an ${h.type} host; a host's type cannot change (remove it and add it again)`);
			}
			h.type = patch.type;
			if (isNew && patch.port === undefined) h.port = patch.type === 'rdp' ? 3389 : 22;
		}
		if (patch.domain !== undefined) h.domain = patch.domain;
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
		checkText('initial command', h.command, 1024);
		if (/[\n\t]/.test(h.command)) fail('invalid', 'initial command must be a single line');
		h.tags.forEach((t) => checkName('tag', t));
		checkRdpHost(h);
		if (patch.jump !== undefined) {
			if (patch.jump === '') {
				h.jump = '';
			} else if (h.type === 'rdp') {
				fail('invalid', 'an RDP host has no jump host');
			} else {
				const j = this.findHost(patch.jump);
				requireSshHost(j, 'a jump host');
				if (lower(j.alias) === lower(h.alias)) fail('invalid', 'a host cannot be its own jump host');
				let cur: Host | undefined = j;
				for (let n = 0; cur && cur.jump && n < 32; n++) {
					if (lower(cur.jump) === lower(h.alias)) fail('invalid', `jump host '${patch.jump}' would make a loop`);
					cur = this.v.hosts.find((x) => lower(x.alias) === lower(cur!.jump));
				}
				h.jump = j.alias;
			}
		}
		if (patch.credential !== undefined) {
			const c = patch.credential ? this.findCred(patch.credential) : undefined;
			if (c && h.type === 'rdp' && !c.hasPassword) {
				fail('invalid', `credential '${c.name}' has no password; an RDP host logs in with a password`);
			}
			h.credential = c ? c.name : '';
		}
		if (patch.key !== undefined) {
			if (patch.key && h.type === 'rdp') fail('invalid', 'an RDP host logs in with a password, not an SSH key');
			h.key = patch.key ? this.findKey(patch.key).name : '';
		}
		if (patch.group !== undefined) h.group = patch.group ? this.ensureGroup(patch.group) : '';
	}

	addHost(patch: HostPatch): Host {
		const h: Host = {
			alias: '', label: '', hostname: '', port: 22, user: '', group: '', tags: [], color: '',
			notes: '', jump: '', credential: '', key: '', hasPassword: false, hasSudoPassword: false, command: '', keepShell: true,
			type: 'ssh', domain: '', tunnels: [],
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

	// tunnels (src/application/tunnels.cf)

	findTunnel(alias: string, name: string): Tunnel {
		const h = this.findHost(alias);
		const t = h.tunnels.find((x) => lower(x.name) === lower(name));
		if (!t) fail('not_found', `no tunnel '${name}' on host '${h.alias}'`);
		return t;
	}

	private viewOf(h: Host, t: Tunnel, inFlint: boolean): TunnelView {
		return {
			host: h.alias, name: t.name, local_port: t.localPort, destination: tunnelDestination(t.destHost, t.destPort),
			open_on_connect: t.openOnConnect, state: inFlint ? (t.running ? 'listening' : 'stopped') : '',
			listen: t.running && inFlint ? `127.0.0.1:${t.localPort}` : '', connections: 0, error: '',
		};
	}

	tunnelView(alias: string, name: string, inFlint: boolean): TunnelView {
		return this.viewOf(this.findHost(alias), this.findTunnel(alias, name), inFlint);
	}

	/** Every saved tunnel (of one host), by host then name. `inFlint` false: no state. */
	tunnelViews(alias: string, inFlint: boolean): TunnelView[] {
		const only = alias ? this.findHost(alias) : null;
		const out: TunnelView[] = [];
		for (const h of this.v.hosts) {
			if (only && h !== only) continue;
			for (const t of h.tunnels) out.push(this.viewOf(h, t, inFlint));
		}
		return out.sort((a, b) => (lower(a.host) !== lower(b.host) ? (lower(a.host) < lower(b.host) ? -1 : 1) : lower(a.name) < lower(b.name) ? -1 : 1));
	}

	private applyTunnel(h: Host, base: Tunnel, p: TunnelPatch): Tunnel {
		const t = { ...base };
		if (p.name !== undefined) t.name = p.name.trim();
		if (p.localPort !== undefined) t.localPort = p.localPort;
		if (p.dest) [t.destHost, t.destPort] = p.dest;
		if (p.openOnConnect !== undefined) t.openOnConnect = p.openOnConnect;
		checkTunnelName(t.name);
		checkTunnelPort(t.localPort, 'local port');
		const clash = h.tunnels.find((o) => o !== base && lower(o.name) === lower(t.name));
		if (clash) fail('conflict', `host already has a tunnel named '${t.name}'`);
		return t;
	}

	addTunnel(alias: string, p: TunnelPatch): TunnelView {
		if (p.localPort === undefined) fail('usage', 'a tunnel needs a local port (--local)');
		const h = this.findHost(alias);
		requireSshHost(h, 'a tunnel');
		const q = { ...p, dest: p.dest ?? (['localhost', p.localPort] as [string, number]) };
		const t = this.applyTunnel(h, { name: '', localPort: 0, destHost: '', destPort: 0, openOnConnect: false, running: false }, q);
		h.tunnels.push(t);
		return this.viewOf(h, t, this.v.unlocked);
	}

	editTunnel(alias: string, name: string, p: TunnelPatch): TunnelView {
		const h = this.findHost(alias);
		const base = this.findTunnel(alias, name);
		const t = this.applyTunnel(h, base, p);
		Object.assign(base, t);
		return this.viewOf(h, base, this.v.unlocked);
	}

	removeTunnel(alias: string, name: string): TunnelView {
		const h = this.findHost(alias);
		const t = this.findTunnel(alias, name);
		h.tunnels = h.tunnels.filter((x) => x !== t);
		t.running = false;
		return this.viewOf(h, t, this.v.unlocked);
	}

	/** Listens, unless another running tunnel holds its port (port_in_use). */
	startTunnel(alias: string, name: string): void {
		const t = this.findTunnel(alias, name);
		for (const h of this.v.hosts) {
			for (const o of h.tunnels) {
				if (o !== t && o.running && o.localPort === t.localPort) fail('port_in_use', `port ${t.localPort} on 127.0.0.1 is already in use`);
			}
		}
		t.running = true;
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

	// tokens (src/application/tokens.cf, check_token_request and create_token)

	createToken(req: TokenRequest, now: number): { token: Token; secret: string } {
		const name = req.name.trim();
		if (!name) fail('usage', 'a token needs a name: --name <name>');
		if (name.length > 64) fail('invalid', "a token's name is at most 64 characters");
		if (name.startsWith('flint_')) fail('invalid', "a token's name may not start with flint_");
		if (!(req.ttl in TTLS)) fail('invalid', '--ttl must be one of 15m, 1h, 4h, 1d, 7d, 30d, 90d');
		if (!req.read && !req.exec && !req.write) fail('usage', 'say what the token allows: --allow read,exec,write');
		let all = req.all;
		if (!all && req.groups.length === 0 && req.hosts.length === 0) {
			if (req.exec || req.write) fail('usage', 'say which hosts the token reaches: --hosts <alias,@group,...> or --all');
			all = true;
		}
		if (req.write && !all) fail('invalid', 'a token that changes the vault must reach all of it: --all');
		const groups: string[] = [];
		const hosts: string[] = [];
		if (!all) {
			for (const g of req.groups) {
				const found = this.v.groups.find((x) => x.toLowerCase() === g.toLowerCase());
				if (!found) fail('not_found', `group '${g}'`);
				groups.push(found);
			}
			for (const a of req.hosts) {
				const found = this.v.hosts.find((h) => h.alias.toLowerCase() === a.toLowerCase());
				if (!found) fail('not_found', `host '${a}'`);
				hosts.push(found.alias);
			}
		}
		if (this.v.tokens.some((t) => tokenStatus(t, now) === 'active' && t.name.toLowerCase() === name.toLowerCase())) {
			fail('conflict', `a live token is already named '${name}'; revoke it or pick another name`);
		}
		const id = fakeHex(this.v.name + name + this.v.tokens.length, 16);
		const t: Token = { id, name, all, groups, hosts, read: req.read, exec: req.exec, write: req.write, createdAt: now, expiresAt: now + TTLS[req.ttl], revokedAt: 0 };
		this.v.tokens.push(t);
		return { token: t, secret: `flint_${id}_${fakeHex('demo-secret' + id, 64)}` };
	}

	revokeToken(key: string, now: number): Token {
		const t = this.v.tokens.find((x) => x.id === key)
			?? this.v.tokens.find((x) => tokenStatus(x, now) === 'active' && x.name.toLowerCase() === key.trim().toLowerCase());
		if (!t) fail('not_found', `no token '${key}'; see \`flint token list\``);
		if (t.revokedAt === 0) t.revokedAt = now;
		return t;
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
	/** The same for the sudo password. */
	sudoPassword?: boolean;
	command?: string;
	keepShell?: boolean;
	type?: string;
	domain?: string;
}

export interface CredPatch {
	name?: string;
	user?: string;
	key?: string;
	password?: boolean;
}

// ---- tunnels (src/domain/tunnel.cf) -----------------------------------------------

export function tunnelDestination(host: string, port: number): string {
	return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

function checkTunnelName(name: string): void {
	if (name.length === 0) fail('invalid', 'a tunnel needs a name');
	if (name.length > 64) fail('invalid', 'a tunnel name has at most 64 characters');
	if (!/^[A-Za-z0-9._-]+$/.test(name)) fail('invalid', "a tunnel name has only letters, digits, '-', '.' and '_'");
}

function checkTunnelPort(port: number, what: string): void {
	if (port < 1 || port > 65535) fail('invalid', `the ${what} ${port} is not between 1 and 65535`);
}

function checkDestHost(host: string): void {
	if (host.length === 0) fail('invalid', 'a tunnel needs a destination host');
	if (host.length > 253) fail('invalid', 'the destination host has at most 253 characters');
	if (/[\x00-\x20\x7f/@]/.test(host)) fail('invalid', 'the destination host has a character a host name cannot have');
}

export function parsePortText(text: string, what: string): number {
	if (text.length === 0) fail('invalid', `the ${what} is missing`);
	if (!/^[0-9]+$/.test(text)) fail('invalid', `the ${what} '${text}' is not a number`);
	const port = Number(text);
	checkTunnelPort(port, what);
	return port;
}

/** `5432` (the server itself), `host:5432` or `[::1]:5432`. */
export function parseTunnelDestination(text: string): [string, number] {
	const t = text.trim();
	if (t.startsWith('[')) {
		const close = t.indexOf(']');
		if (close < 0 || close + 1 >= t.length || t[close + 1] !== ':') fail('invalid', 'a destination is host:port, or [address]:port');
		const host = t.slice(1, close);
		const port = parsePortText(t.slice(close + 2), 'destination port');
		checkDestHost(host);
		return [host, port];
	}
	const colon = t.lastIndexOf(':');
	if (colon < 0) return ['localhost', parsePortText(t, 'destination port')];
	const host = t.slice(0, colon);
	if (host.includes(':')) fail('invalid', 'an IPv6 destination goes in brackets: [address]:port');
	checkDestHost(host);
	return [host, parsePortText(t.slice(colon + 1), 'destination port')];
}

/** `<host>:<name>`. */
export function splitTunnelRef(text: string): [string, string] {
	const colon = text.lastIndexOf(':');
	if (colon <= 0 || colon + 1 >= text.length) fail('usage', 'a tunnel is named <host>:<name>, e.g. db1:postgres');
	return [text.slice(0, colon), text.slice(colon + 1)];
}
