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
  /** The host has its own sudo password; otherwise `exec --sudo` types the login one. */
  has_sudo_password: boolean;
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
  /** The Files view's own width (milestone 17), 200–480. */
  files_width: number;
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
  /** The app's own record that earlier cached keys were removed (D-048); the core keeps it. */
  keys_cleared?: boolean;
}

export type LockAfter = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | 'never';

/** A `flint` command asked this window to unlock a vault; `path` is "" for none. */
/** The window's own lock (milestone 14): closed to the tray, it opens with the
 *  master password or the presence check. */
export interface WindowState {
  locked: boolean;
  vault: string;
  /** How the window opens: the OS's check, or `password` where it has none. */
  presence: PresenceMethod;
  /** Callers waiting for an answer, shown once the window is open. */
  waiting: number;
}

export interface UnlockRequest {
  path: string;
  name: string;
  caller: string;
  /** Who runs it ("flint, started by Claude Code"); the unlock can allow it. */
  label: string;
  /** The whole command `caller` sums up (milestone 15). */
  command: CommandText;
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
  sudo_password: string; set_sudo_password: boolean;
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
/** What a request needs: an action of a grant, or creating a token (milestone 12b). */
export type AccessNeedAction = AccessAction | 'token' | 'sudo';

/** The token `flint token create` asks the owner for; `name` is '' otherwise. */
export interface TokenAsk {
  name: string;
  /** "read,exec" */
  allows: string;
  /** "codebox, @homelab" or "whole vault" */
  reaches: string;
  ttl: string;
}

/** A request waiting in the approval window. */
export interface Approval {
  id: string;
  vault_id: string;
  /** "flint, started by Claude Code" */
  label: string;
  /** The command, without flag values. */
  request: string;
  need: { action: AccessNeedAction; host: string };
  chain: CallerProc[];
  anchor_pid: number;
  created_ms: number;
  deadline_ms: number;
  state: string;
  token: TokenAsk;
  /** `exec --sudo` (milestone 13): host, login user and the exact argv. */
  sudo: SudoAsk;
  /** The whole command `request` sums up (milestone 15). */
  command: CommandText;
  /** `flint cp` (milestone 16): what is copied where; `direction` is "" otherwise. */
  copy?: CopyAsk;
}

export interface CopyAsk {
  direction: 'upload' | 'download' | '';
  host: string;
  /** The path on this machine, absolute. */
  local: string;
  remote: string;
  recursive: boolean;
  force: boolean;
}

export interface SudoAsk {
  host: string;
  user: string;
  argv: string[];
  /** Flint has a password to type; otherwise the window asks for one. */
  has_password: boolean;
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
  /** `exec --sudo`: a sudo password for this command, and whether to keep it. */
  sudo_password: string;
  save_sudo_password: boolean;
}

/** A token as Settings → Access lists it (milestone 12b): never its secret. Times are Unix seconds. */
export interface TokenView {
  id: string;
  name: string;
  all: boolean;
  groups: string[];
  hosts: string[];
  read: boolean;
  exec: boolean;
  write: boolean;
  created_at: number;
  expires_at: number;
  /** 0 while not revoked. */
  revoked_at: number;
  status: 'active' | 'expired' | 'revoked';
}

export interface TokensState {
  now_s: number;
  tokens: TokenView[];
}

/** One line of the activity log (milestone 12b). `at` is Unix seconds. */
export interface ActivityEntry {
  id: number;
  at: number;
  caller: string;
  via: 'grant' | 'token' | 'window';
  token: string;
  action: AccessNeedAction;
  host: string;
  command: string;
  outcome: 'allowed' | 'denied' | 'timeout';
  /** Bytes cut from the end of `command` past 16 KB (milestone 15); 0 when whole. */
  cut: number;
}

/** A command as shown and kept (milestone 15): whole up to 16 KB, `cut` bytes beyond. */
export interface CommandText {
  text: string;
  cut: number;
}

/** How long the activity log keeps entries, in days; 0 is no limit (milestone 15). */
export type RetentionDays = 30 | 90 | 365 | 0;

/** A file or folder on a host (milestone 16). `mtime` is Unix seconds. */
export interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir' | 'link' | 'other';
  size: number;
  mtime: number;
  mode: number;
}

export interface CopyResult {
  host: string;
  direction: 'upload' | 'download';
  files: { source: string; target: string; bytes: number }[];
  folders: number;
  bytes: number;
  skipped: string[];
  duration_ms: number;
}

/** A transfer's progress (milestone 17), sent as "files:transfer". */
export interface TransferEvent {
  session: string;
  id: string;
  file: string;
  file_bytes: number;
  file_size: number;
  files_done: number;
  bytes_done: number;
}
