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
}

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
