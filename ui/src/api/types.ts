// Shapes of the GUI driver's RPC replies (src/drivers/gui/rpc.cf). Secrets never
// appear here: hosts and credentials carry only `has_password`.

export interface AppInfo {
  version: string;
  os: 'mac' | 'linux';
  libssh: string;
  libsodium: string;
  sqlite: string;
  freerdp: string;
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

/** `ssh` (every host from before milestone 29) or `rdp`; fixed once the host is added. */
export type HostType = 'ssh' | 'rdp';

export interface HostView {
  alias: string;
  type: HostType;
  /** An RDP host's Windows domain; '' for none. */
  domain: string;
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
  /** Milestone 25: the largest image or file a paste uploads, in MB. */
  paste_limit_mb: PasteLimit;
  /** Milestone 31 (D-074): what a Mac keyboard's modifier keys send in an RDP tab. */
  rdp_mac_keys: 'mac' | 'windows' | 'custom';
  /** The custom table, "MetaLeft=ctrl,AltLeft=alt,…"; a key left out keeps the Mac preset's. */
  rdp_mac_custom: string;
  /** Milestone 34: 'auto' offers the graphics pipeline (RDPGFX), 'compatible' keeps bitmap updates. */
  rdp_graphics: 'auto' | 'compatible';
  /** The app's own record that earlier cached keys were removed (D-048); the core keeps it. */
  keys_cleared?: boolean;
}

export type LockAfter = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | 'never';
/** Settings → Terminal → Largest file to paste (milestone 25). */
export type PasteLimit = 10 | 20 | 50 | 100;
export const PASTE_LIMITS: PasteLimit[] = [10, 20, 50, 100];

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
  /** Given only when the host is added: the type is fixed after that. */
  type: HostType; set_type: boolean;
  domain: string; set_domain: boolean;
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
  /** An RDP server's certificate (milestone 30); '' for an SSH host key. */
  subject: string;
  issuer: string;
  valid_from: string;
  valid_to: string;
}

/** A remote desktop is up (milestone 30): its size and its frame channel (D-071). */
/** A remote desktop's counters since its tab opened (milestone 34). */
export interface RdpStats {
  updates: number;
  bytes_in: number;
  commands: number;
  decode_us: number;
  frames_read: number;
  /** 'gfx', 'bitmap', or '' while not connected. */
  pipeline: string;
  /** The graphics pipeline's last codec ('' on bitmaps). */
  codec: string;
  /** This build of FreeRDP decodes H.264. */
  h264: boolean;
}

export interface DesktopReadyEvent {
  tab: string;
  width: number;
  height: number;
  frame_port: number;
  frame_token: string;
}

/** A remote desktop's state; `code` is '' when it was closed on purpose. */
export interface RdpStateEvent {
  tab: string;
  state: 'connecting' | 'ended';
  code: string;
  message: string;
}

/** A pointer event for a remote desktop, in desktop pixels. */
export interface RdpPointer {
  kind: 'move' | 'down' | 'up' | 'wheel' | 'hwheel';
  button: number;
  x: number;
  y: number;
  delta: number;
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
  /** `host2`: the second host of a copy between two (milestone 18), else "". */
  need: { action: AccessNeedAction; host: string; host2?: string };
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
  /** `flint tunnel up|down` (milestone 22): `verb` is "" otherwise. */
  tunnel?: TunnelAsk;
}

export interface TunnelAsk {
  verb: 'up' | 'down' | '';
  host: string;
  name: string;
  local_port: number;
  /** As the host sees it: `localhost:5432`, `db.internal:5432`, `[fd00::5]:443`. */
  destination: string;
  /** `up`: 127.0.0.1:<local_port> cannot be bound now (design 16h2, milestone 23). */
  port_in_use?: boolean;
  /** With `port_in_use`: the program holding the port and its pid, when Flint may see it ('' for another user's process). */
  port_owner?: string;
  port_owner_pid?: number;
}

/** A saved tunnel and its state (milestone 22, D-063). */
export interface TunnelView {
  host: string;
  name: string;
  local_port: number;
  destination: string;
  open_on_connect: boolean;
  /** "stopped", "listening" or "connection lost". */
  state: string;
  /** `127.0.0.1:<port>` while it listens. */
  listen: string;
  connections: number;
  error: string;
}

export interface TunnelSave {
  host: string;
  /** The tunnel's current name; '' adds one. */
  target: string;
  name: string;
  local_port: number;
  dest_host: string;
  dest_port: number;
  open_on_connect: boolean;
}

/** The end of a start from the app (milestone 23). */
export interface TunnelStartedEvent {
  session: string;
  host: string;
  results: { name: string; code: string; message: string }[];
  /** The login itself failed: every tunnel of the start stayed down. */
  code: string;
  message: string;
}

export interface CopyAsk {
  /** `relay`: from `host`'s `remote` to `to_host`'s `to_path` (milestone 18). */
  direction: 'upload' | 'download' | 'relay' | '';
  host: string;
  /** The path on this machine, absolute ("" for a relay). */
  local: string;
  remote: string;
  to_host?: string;
  to_path?: string;
  recursive: boolean;
  force: boolean;
  /** A relay copy (design 16g3): the caller's own live grant already runs commands on
   * `host` / `to_host`, until `*_until` on the core's clock (0 = until the vault locks). */
  host_allowed?: boolean;
  host_allowed_until?: number;
  to_allowed?: boolean;
  to_allowed_until?: number;
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
  to_host?: string;
  direction: 'upload' | 'download' | 'relay';
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
