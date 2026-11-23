// Shapes of the GUI driver's RPC replies (src/drivers/gui/rpc.cf). Secrets never
// appear here: hosts and credentials carry only `has_password`.

export interface AppInfo {
  version: string;
  os: 'mac' | 'linux' | 'windows';
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

/** The core's estimate of a master password (milestone 40): zxcvbn's 0-4 score. */
export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Strong enough for a remote vault (3 or more). */
  sync_ok: boolean;
  warning: string;
  suggestions: string[];
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

/** Where an RDP host's remote audio plays: on this computer, on the remote computer, or nowhere. */
export type RdpAudio = 'local' | 'remote' | 'off';

export interface HostView {
  alias: string;
  type: HostType;
  /** An RDP host's Windows domain; '' for none. */
  domain: string;
  /** Where an RDP host's remote audio plays (milestone 60); '' for an SSH host. */
  audio: RdpAudio | '';
  /** Whether an RDP host's remote computer may use this computer's microphone. */
  microphone: boolean;
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
  /** The full-screen note was shown once (milestone 37, design 22b2). */
  fullscreen_note_seen: boolean;
  /** Milestone 38: the extra monitors last chosen, and whether 22f4's note was shown. */
  monitors?: string[];
  monitors_note_seen?: boolean;
  collapsed: string[];
}

/** A monitor of this computer (milestone 38): points, origin at the top-left of the primary. */
export interface LocalMonitor {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
  physical: boolean;
}

/** What "Full screen on all monitors" may offer: `reason` greys it (design 22f1c). */
export interface MonitorsView {
  reason: string;
  monitors: LocalMonitor[];
  main: string;
  picks: string[];
  max: number;
}

export interface MonitorPick {
  id: string;
  width: number;
  height: number;
}

export interface RdpMonitor {
  local_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The layout the core sent: each monitor and where its part lies in the one surface. */
export interface DesktopSpan {
  monitors: RdpMonitor[];
  crops: DesktopRect[];
  width: number;
  height: number;
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
  rdp_graphics: 'auto' | 'pipeline' | 'compatible';
  /** Milestone 43: seconds between checks of a connected vault's server (0, 60, 300, 900); 0 syncs on events only. */
  sync_interval: number;
  /** Milestone 46 (D-106 (3)): the window corner toasts appear in. */
  toast_corner: ToastCorner;
  /** The app's own record that earlier cached keys were removed (D-048); the core keeps it. */
  keys_cleared?: boolean;
  /** Milestone 48: the app's own record that the flint command was offered; the core keeps it. */
  cli_offer_shown?: boolean;
  /** Milestone 52 (D-116): check for a newer Flint at launch and every hour. */
  update_check: boolean;
  /** The app's own records (milestone 52): the version whose toast was shown, and What's new's last version. */
  update_toast_version?: string;
  last_seen_version?: string;
  /** Milestone 55 (design 25b1): the active tab's server resources in the status bar. */
  server_stats: boolean;
  /** Milestone 55: colour CPU, memory and disk by load (green, amber, red). */
  server_stats_colour: boolean;
  /** Milestone 56 (26d1): new grants notify each command they allow. */
  notify_grants: boolean;
  /** Milestone 57 (25e1/25e2): *Allow sudo for a while*; off by default. */
  sudo_periods: boolean;
  /** Milestone 61 (D-134 (2)): how long approvals and a locked vault wait, in minutes (2, 5, 10, 30). */
  approval_wait: number;
  /** Milestone 63 (D-134 (4)): phone alerts through ntfy, off by default. */
  ntfy_on: boolean;
  /** The ntfy server, https://ntfy.sh by default. */
  ntfy_server: string;
  /** This machine's random topic, made by the app ('' until alerts are first on). */
  ntfy_topic: string;
}

/** Milestone 63: what the last phone alert did (`alerts:status`, `alerts_status`). */
export interface AlertStatus {
  /** 0 before the first publish. */
  at_ms: number;
  kind: '' | 'approval' | 'locked' | 'test';
  ok: boolean;
  /** Why it failed ("couldn't reach ntfy.sh: …"), '' when ok. */
  error: string;
}

/** The update check's outcome (milestone 52, src/domain/update.cf), as `update:status`. */
export type UpdateState = 'idle' | 'checking' | 'up_to_date' | 'available' | 'downloading' | 'ready' | 'error';
export type UpdateAction = 'download' | 'how' | '';
/** Why How to update: a .deb/.rpm (from a repository since milestone 54), a build from source, a folder Flint can't write, no package for this system. */
export type UpdateHow = 'package' | 'repository' | 'source' | 'readonly' | 'no_asset' | '';

export interface UpdateStatus {
  state: UpdateState;
  current: string;
  /** When the last check ended (Unix ms; 0: not in this run). */
  checked_at: number;
  auto: boolean;
  version: string;
  date: string;
  summary: string;
  /** The release's page on GitHub. */
  page: string;
  action: UpdateAction;
  how: UpdateHow;
  /** How to update from a repository (milestone 54): the system updater's command. */
  command: string;
  asset_url: string;
  asset_size: number;
  /** The package's SHA-256 from the verified manifest (milestone 53). */
  asset_sha256: string;
  /** Bytes received while downloading. */
  received: number;
  /** The first time this version was found: show the toast (once per version, D-116). */
  toast: boolean;
  /** Why the last update was not applied, shown once at launch (milestone 53). */
  outcome: string;
  code: string;
  message: string;
}

/** One version's section of CHANGELOG.md, for What's new (24g). */
export interface ChangeVersion {
  version: string;
  date: string;
  summary: string;
  groups: { title: string; items: { scope: string; text: string }[] }[];
}

export interface WhatsNew {
  current: string;
  /** At launch: the version run before this one ("since your 0.15.0"); "" otherwise. */
  since: string;
  versions: ChangeVersion[];
}

/** Settings → Appearance → Notifications (milestone 46). */
export type ToastCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export const TOAST_CORNERS: ToastCorner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

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
  audio: RdpAudio | ''; set_audio: boolean;
  microphone: boolean; set_microphone: boolean;
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
/** What the Type menu shows (milestone 58): never the text or the password. */
export interface RdpTypeInfo {
  clipboard_chars: number;
  has_password: boolean;
  /** How Type password confirms you: touchid, device, polkit, or password (the master password). */
  presence: string;
}

/** "rdp:typed": a Type's outcome. */
export interface RdpTyped {
  tab: string;
  what: 'clipboard' | 'password';
  count: number;
  code: string;
  message: string;
}

export interface RdpStats {
  updates: number;
  bytes_in: number;
  commands: number;
  decode_us: number;
  frames_read: number;
  /** 'gfx', 'bitmap', or '' while not connected. */
  pipeline: string;
  /** The codecs the graphics pipeline used, comma-separated ('' on bitmaps). */
  codec: string;
  /** This build of FreeRDP decodes H.264. */
  h264: boolean;
  /** Milestone 35: quiet re-reads of the whole desktop, and the pixels they found stale. */
  rereads: number;
  stale_px: number;
  /** The link as the server measured it (auto-detect); 0 until it has. */
  link_kbps: number;
  link_rtt_ms: number;
  /** What the engine connected in: 'pipeline' or 'compatible'. */
  mode: string;
}

/** A tab's graphics mode after a switch (milestone 35), or why it stayed (`message`). */
export interface RdpGraphicsEvent {
  tab: string;
  /** The tab's mode: 'auto', 'pipeline' or 'compatible'. */
  graphics: string;
  /** What the engine reconnected in, and the round trip Automatic chose by (-1: none). */
  engine: string;
  rtt_ms: number;
  message: string;
}

export interface DesktopReadyEvent {
  tab: string;
  width: number;
  height: number;
  frame_port: number;
  frame_token: string;
  /** Milestone 35: what the engine connected in, 'pipeline' or 'compatible'. */
  graphics: string;
  /** The link's round trip Automatic chose by, ms; -1 when not measured. */
  rtt_ms: number;
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
  /** Milestone 56: each command it allows shows in its notice (the bell). */
  notify: boolean;
  /** Milestone 57: a root period on its one host (`hosts`); always notifies. */
  root: boolean;
}

/** How Allow is confirmed: Touch ID, the Mac's password, polkit, or the master password. */
export type PresenceMethod = 'touchid' | 'device' | 'polkit' | 'password';

export interface AccessState {
  presence: PresenceMethod;
  /** The core's clock when it answered; deadlines and expiries are on it. */
  now_ms: number;
  pending: Approval[];
  grants: GrantView[];
  /** Milestone 57: *Allow sudo for a while* is on (the core's own word). */
  sudo_periods: boolean;
}

export type GrantDuration = '15m' | '1h' | '4h' | 'lock';

/** Milestone 57 (25e4): '' is each command. */
export type RootPeriod = '' | '2m' | '5m' | '15m';

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
  /** Milestone 56 (26c1): this grant notifies each command it allows. */
  notify: boolean;
  /** Milestone 57 (25e4): `exec --sudo` allowed for a root period on its host. */
  period: RootPeriod;
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
  /** Milestone 56: the grant that allowed it ('' for none) and how it ended. */
  grant: string;
  /** 'running' while it runs, 'ended' after; '' for a refusal or an older entry. */
  state: '' | 'running' | 'ended';
  exit: number;
  duration_ms: number;
  /** The error code when Flint stopped it ('not_sudoer', 'sudo_password', …), else ''. */
  result: string;
  /** Milestone 63: a phone alert went out while it waited (false before 63). */
  alerted?: boolean;
}

/** `activity:added` (milestone 56): never the command (D-127 (1)). */
export interface ActivityAddedEvent {
  id: number;
  outcome: 'allowed' | 'denied' | 'timeout';
  grant: string;
  notify: boolean;
  /** "Claude Code" for "flint, started by Claude Code". */
  program: string;
  /** The host or hosts of the command ("db1", "db1 → nas"), '' for none. */
  hosts: string;
  action: AccessNeedAction;
  at: number;
  state: '' | 'running' | 'ended';
  /** Milestone 57: the grant is a root period, with this long left when it ran. */
  root?: boolean;
  left_ms?: number;
}

/** `activity:finished` (milestone 56). */
export interface ActivityFinishedEvent {
  id: number;
  grant: string;
  exit: number;
  duration_ms: number;
  result: string;
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

// ---- The remote vault (milestones 43-44, design 23*) --------------------------------

/** Where a vault stands with its server, from this machine's memory and its file. */
export interface RemoteStatus {
  connected: boolean;
  url: string;
  version: number;
  /** Unix milliseconds; 0 for never. */
  last_sync: number;
  last_attempt: number;
  /** The last failed attempt's "code: message", or ''. */
  last_error: string;
  /** The vault holds changes the server does not have yet. */
  pending: boolean;
}

/** One vault a server keeps (milestone 45): what it can tell without a key. */
export interface ServerVault {
  id: string;
  /** The label the person chose when connecting it, in clear; may be empty. */
  label: string;
  version: number;
  size: number;
  /** Unix milliseconds of its newest version. */
  updated_at: number;
}

export interface RemoteProbe {
  url: string;
  vaults: ServerVault[];
}

export interface MergeChange {
  kind: string;
  name: string;
  change: string;
  detail: string;
}

export interface MergeReport {
  added: number;
  updated: number;
  removed: number;
  changes: MergeChange[];
  notes: MergeChange[];
}

export interface SyncOutcome {
  path: string;
  name: string;
  url: string;
  result: 'in_step' | 'uploaded' | 'merged';
  version: number;
  uploaded: boolean;
  report: MergeReport;
  rekeyed: boolean;
}

/** `vault:sync`: what a sync the app ran did (or that one started). */
export interface SyncEvent {
  path: string;
  state: 'syncing' | 'in_step' | 'uploaded' | 'merged' | 'error';
  version: number;
  report: MergeReport;
  code: string;
  message: string;
}

export interface RemoteLinkView {
  path: string;
  url: string;
}

/** Milestone 48 (D-111 (2)): one place the `flint` command can be linked from. */
export type CliLinkState = 'missing' | 'installed' | 'other-copy' | 'broken' | 'foreign';
export interface CliLinkSpot {
  path: string;
  state: CliLinkState;
  /** What the link points to now ("" when nothing or not a link). */
  target: string;
  /** macOS asks for an administrator's password to write there. */
  admin: boolean;
}
export interface CliLinkStatus {
  /** This copy of Flint carries a CLI (a packaged app). */
  available: boolean;
  cli: string;
  spots: CliLinkSpot[];
  /** What the first launch's toast offers: install once, fix every time. */
  offer: '' | 'install' | 'fix';
  /** macOS links the command (`link`); Windows puts the package's bin folder on the
   *  user's Path (`path`, milestone 50, D-121), whose one spot's path is that folder. */
  kind: 'link' | 'path';
}

/** Milestone 55: one sample of a terminal tab's server (src/domain/stats.cf), as `stats:sample`.
 * Sizes in bytes, rates in bytes per second. A field whose `has_` is false is not shown;
 * a sample with none says the host shows nothing (design 25a6). */
export interface ServerSample {
  session: string;
  os: string;
  cores: number;
  has_cpu: boolean; cpu_pct: number;
  has_mem: boolean; mem_total: number; mem_used: number; swap_total: number; swap_used: number;
  has_net: boolean; rx_rate: number; tx_rate: number; interfaces: string[];
  has_load: boolean; load1: number; load5: number; load15: number;
  has_uptime: boolean; uptime_secs: number;
  has_disk: boolean; disk_total: number; disk_used: number; disk_avail: number;
}
