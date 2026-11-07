// Shapes of the GUI driver's RPC replies (src/drivers/gui/rpc.cf). Secrets never
// appear here: hosts and credentials carry only `has_password`.

export interface AppInfo {
  version: string;
  os: 'mac' | 'linux';
  libssh: string;
  libsodium: string;
  sqlite: string;
  e2e: boolean;
}

export interface RecentView {
  name: string;
  path: string;
  current: boolean;
  exists: boolean;
}

export interface VaultInfo {
  path: string;
  name: string;
  format: number;
  cached: boolean;
}

export interface VaultStatus {
  path: string;
  name: string;
  exists: boolean;
  cached: boolean;
  groups: number;
  hosts: number;
  keys: number;
  credentials: number;
}

export interface GroupView {
  path: string;
  name: string;
  hosts: number;
  subgroups: number;
}

export interface HostView {
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
  has_password: boolean;
  /** Run on every interactive session instead of a bare shell (D-031); '' for none. */
  command: string;
  /** A login shell follows when `command` exits. */
  keep_shell: boolean;
}

export interface KeyView {
  name: string;
  type: string;
  public_key: string;
  fingerprint: string;
  has_passphrase: boolean;
}

export interface CredView {
  name: string;
  user: string;
  key: string;
  has_password: boolean;
}

export interface KnownHostView {
  addr: string;
  host: string;
  key_type: string;
  fingerprint: string;
  added_at: string;
}

export interface Catalog {
  groups: GroupView[];
  hosts: HostView[];
  keys: KeyView[];
  credentials: CredView[];
  known_hosts: KnownHostView[];
}

// The layout state of this machine (D-030): the sidebar, and the open vault's
// collapsed groups by path (the core stores their ids).
export interface UiStateView {
  sidebar_open: boolean;
  sidebar_width: number;
  collapsed: string[];
}

export interface Settings {
  theme: 'system' | 'dark' | 'light';
  accent: 'ember' | 'sapphire' | 'moss' | 'iris';
  density: 'compact' | 'default' | 'comfortable';
  follow_motion: boolean;
  reopen_last_vault: boolean;
  term_font: string;
  term_font_size: number;
  term_line_height: number;
  term_cursor: 'block' | 'bar' | 'underline';
  term_cursor_blink: boolean;
  term_theme: 'default' | 'catppuccin' | 'tokyo-night' | 'aura' | 'dracula' | 'nord';
  /** Auto-lock after this long with nobody using the vault (D-042). */
  lock_after: LockAfter;
}

export type LockAfter = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | 'never';

/** A `flint` command asked this window to unlock a vault; `path` is "" for none. */
export interface UnlockRequest {
  path: string;
  name: string;
  caller: string;
  /** Who runs it ("flint, started by Claude Code"); the unlock can allow it. */
  label: string;
}

/** Why the vault locked: the Lock button, idle time, the screen, sleep or `flint vault lock`. */
export type LockReason = 'manual' | 'idle' | 'screen' | 'sleep' | 'cli';

// A host patch as the core's HostPatch: a `set_*` flag says the field is given.
export interface HostPatch {
  alias: string; set_alias: boolean;
  label: string; set_label: boolean;
  hostname: string; set_hostname: boolean;
  port: number; set_port: boolean;
  user: string; set_user: boolean;
  group: string; set_group: boolean;
  tags: string[]; set_tags: boolean;
  color: string; set_color: boolean;
  notes: string; set_notes: boolean;
  jump: string; set_jump: boolean;
  credential: string; set_credential: boolean;
  key: string; set_key: boolean;
  password: string; set_password: boolean;
  command: string; set_command: boolean;
  keep_shell: boolean; set_keep_shell: boolean;
}

export interface CredPatch {
  name: string; set_name: boolean;
  user: string; set_user: boolean;
  key: string; set_key: boolean;
  password: string; set_password: boolean;
}

export interface HostKeyPayload {
  alias: string;
  addr: string;
  key_type: string;
  fingerprint: string;
  known_key_type: string;
  known_fingerprint: string;
}

export interface SessionStateEvent {
  session: string;
  state: 'connecting' | 'ready' | 'ended';
  code: string;
  message: string;
  exit_code: number;
}

export interface SessionPromptEvent {
  session: string;
  prompt: string;
  kind: 'password' | 'host_key' | 'host_key_changed';
  user: string;
  alias: string;
  host_key: HostKeyPayload;
}

// The end of a host test (host_test): `code` is '' when the connection works.
export interface HostTestEvent {
  session: string;
  code: string;
  message: string;
  host: string;
  target: string;
  hops: number;
  duration_ms: number;
}

/** flint import tether (D-034): counts and notes only, never a secret. */
export interface ImportCounts {
  groups: number;
  hosts: number;
  keys: number;
  credentials: number;
  known_hosts: number;
}

export interface ImportNote {
  kind: string;
  name: string;
  detail: string;
}

export interface TetherImportReport {
  file: string;
  format: number;
  dry_run: boolean;
  added: ImportCounts;
  already_present: ImportCounts;
  changed: ImportNote[];
  not_imported: ImportNote[];
}

// ---- Caller approval (milestone 12) ----------------------------------------------

/** One process of a caller's chain, the `flint` CLI first. */
export interface CallerProc {
  pid: number;
  ppid: number;
  started: number;
  exe: string;
  argv0: string;
}

export type AccessAction = 'read' | 'exec' | 'write';

/** A request waiting in the approval window. */
export interface Approval {
  id: string;
  vault_id: string;
  /** "flint, started by Claude Code" */
  label: string;
  /** The command, without flag values. */
  request: string;
  need: { action: AccessAction; host: string };
  chain: CallerProc[];
  anchor_pid: number;
  created_ms: number;
  deadline_ms: number;
  state: string;
}

export interface GrantView {
  id: string;
  label: string;
  all: boolean;
  groups: string[];
  hosts: string[];
  read: boolean;
  exec: boolean;
  write: boolean;
  created_ms: number;
  /** 0 = until the vault locks. */
  expires_ms: number;
  anchor_pid: number;
}

/** How Allow is confirmed: Touch ID, the Mac's password, polkit, or the master password. */
export type PresenceMethod = 'touchid' | 'device' | 'polkit' | 'password';

export interface AccessState {
  presence: PresenceMethod;
  /** The core's clock when it answered; deadlines and expiries are on it. */
  now_ms: number;
  pending: Approval[];
  grants: GrantView[];
}

export type GrantDuration = '15m' | '1h' | '4h' | 'lock';

export interface AccessAnswer {
  id: string;
  allow: boolean;
  scope: { all: boolean; groups: string[]; hosts: string[] };
  read: boolean;
  exec: boolean;
  write: boolean;
  duration: GrantDuration;
  password: string;
}
