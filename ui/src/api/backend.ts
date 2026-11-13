// The bridge to the GUI driver. `window.backend.<name>(params)` is webui's RPC proxy;
// a rejected call carries the core's "code: message" text, split here into a
// FlintError so the UI can branch on stable codes (D-018, D-019).

import type {
  AccessAnswer, AccessState, ActivityEntry, AppInfo, RdpStats, RetentionDays, Catalog, CredPatch, CredView, GroupView, HostPatch, HostView, KeyView,
  CopyResult, DesktopSpan, FileEntry, MonitorPick, MonitorsView, RdpPointer, TunnelSave, TunnelView, KnownHostView, RecentView, Settings, UiStateView, TokensState, UnlockRequest, VaultInfo, VaultStatus, WindowState,
} from './types';

type Rpc = (params?: unknown) => Promise<unknown>;

declare global {
  interface Window {
    backend: Record<string, Rpc>;
    runtime: {
      EventsOn(event: string, cb: (data: never) => void): () => void;
      Quit(): void;
    };
  }
}

const CODES = [
  'internal', 'usage', 'not_found', 'conflict', 'locked', 'wrong_password', 'invalid',
  'unsupported', 'keychain', 'io', 'host_key', 'auth', 'network', 'timeout',
  'denied', 'approval_timeout', 'not_sudoer', 'sudo_password', 'permission_denied', 'exists', 'not_a_directory',
  'port_in_use',
];

export class FlintError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function toFlintError(err: unknown): FlintError {
  if (err instanceof FlintError) return err;
  const text = err instanceof Error ? err.message : String(err);
  for (const code of CODES) {
    if (text.startsWith(code + ': ')) return new FlintError(code, text.slice(code.length + 2));
  }
  return new FlintError('internal', text);
}

export async function call<T>(method: string, params: unknown = {}): Promise<T> {
  try {
    return (await window.backend[method](params)) as T;
  } catch (err) {
    throw toFlintError(err);
  }
}

export function on<T>(event: string, cb: (data: T) => void): () => void {
  return window.runtime.EventsOn(event, cb as (data: never) => void);
}

export const api = {
  appInfo: () => call<AppInfo>('app_info'),
  windowTheme: (dark: boolean) => call('window_theme', { dark }),
  dialogOpen: (title: string) => call<{ path: string }>('dialog_open', { title, default_name: '' }),
  dialogSave: (title: string, defaultName: string) => call<{ path: string }>('dialog_save', { title, default_name: defaultName }),
  settingsGet: () => call<Settings>('settings_get'),
  settingsSet: (s: Settings) => call<Settings>('settings_set', s),
  fonts: () => call<{ fonts: string[] }>('fonts_mono'),
  uiStateGet: () => call<UiStateView>('ui_state_get'),
  uiStateSet: (s: UiStateView & { vault: string }) => call<UiStateView>('ui_state_set', s),

  recents: () => call<RecentView[]>('vault_recents'),
  /** `allow` also grants the CLI caller that asked for this unlock (milestone 12).
   *  `remember` is Remember on this computer (D-048): unticked on a remembered vault, its key goes. */
  unlock: (path: string, password: string, allow = false, remember = false) => call<VaultInfo>('vault_unlock', { path, password, allow, remember }),
  create: (path: string, name: string, password: string, remember = false) => call<VaultInfo>('vault_create', { path, name, password, remember }),
  /** Whether this run knows the vault's key is remembered: the unlock screen ticks the box. */
  vaultRemembered: (path: string) => call<{ remembered: boolean }>('vault_remembered', { path }),
  /** The window's lock (milestone 14). */
  windowState: () => call<WindowState>('window_state'),
  /** Opens the locked window: the master password, or '' for Touch ID / polkit. */
  windowUnlock: (password: string) => call<WindowState>('window_unlock', { password }),
  /** Quits Flint: the window and the tray, and the CLI's way into the vault. */
  quit: () => call('app_quit'),
  /** Full screen (milestone 37): the OS's own; the change arrives as `window:fullscreen`. */
  windowFullscreen: (on: boolean) => call<{ on: boolean }>('window_fullscreen', { on }),
  close: () => call('vault_close'),
  /** Locks the vault: its key leaves memory, open sessions keep running (D-042). */
  lock: () => call('vault_lock'),
  /** Someone is using the window; keeps the vault from locking for idleness. */
  activity: () => call('activity'),
  unlockRequest: () => call<UnlockRequest>('unlock_request'),
  unlockRequestDismiss: () => call('unlock_request_dismiss'),
  /** Waiting approvals and live grants (milestone 12). */
  accessState: () => call<AccessState>('access_state'),
  /** Allow first asks for presence (Touch ID, polkit, or `password`): it may take a while. */
  accessAnswer: (a: AccessAnswer) => call<AccessState>('access_answer', a),
  /** Ends one grant, or every grant with ''. */
  accessRevoke: (id: string) => call<AccessState>('access_revoke', { name: id }),
  /** Tokens of the open vault (milestone 12b). */
  tokensList: () => call<TokensState>('tokens_list'),
  tokenRevoke: (id: string) => call<TokensState>('token_revoke', { name: id }),
  /** The newest activity entries before `before` (0: from the newest). */
  activityLog: (before: number, limit: number) => call<{ entries: ActivityEntry[] }>('activity_log', { before, limit }),
  /** How long the open vault's activity log keeps entries (milestone 15). */
  activityRetention: () => call<{ days: RetentionDays; label: string }>('activity_retention'),
  /** How many entries a retention of `days` would remove now. */
  activityRetentionPreview: (days: RetentionDays) => call<{ days: RetentionDays; remove: number }>('activity_retention_preview', { days }),
  activityRetentionSet: (days: RetentionDays) => call<{ days: RetentionDays; label: string; removed: number }>('activity_retention_set', { days }),
  /** Copies this computer's activity file, still encrypted, to `path` (milestone 39). */
  activityBackup: (path: string) => call('activity_backup', { path }),
  forgetKey: (path: string) => call('vault_forget_key', { path }),
  forget: (path: string) => call('vault_forget', { path }),
  status: () => call<VaultStatus>('vault_status'),
  rename: (name: string) => call<VaultInfo>('vault_rename', { name }),

  catalog: () => call<Catalog>('catalog'),
  groupAdd: (path: string) => call<GroupView>('group_add', { path }),
  groupRename: (name: string, newName: string) => call<GroupView>('group_rename', { name, new_name: newName }),
  groupRm: (path: string) => call<GroupView>('group_rm', { path }),
  hostAdd: (p: HostPatch) => call<HostView>('host_add', p),
  hostEdit: (target: string, p: HostPatch) => call<HostView>('host_edit', { ...p, target }),
  hostRm: (name: string) => call<HostView>('host_rm', { name }),
  keyAdd: (name: string, privateKey: string, file: string, passphrase: string) =>
    call<KeyView>('key_add', { name, private_key: privateKey, file, passphrase }),
  keyRename: (name: string, newName: string) => call<KeyView>('key_rename', { name, new_name: newName }),
  keyRm: (name: string) => call<KeyView>('key_rm', { name }),
  credAdd: (p: CredPatch) => call<CredView>('cred_add', p),
  credEdit: (target: string, p: CredPatch) => call<CredView>('cred_edit', { ...p, target }),
  credRm: (name: string) => call<CredView>('cred_rm', { name }),
  knownHostRm: (name: string) => call<KnownHostView>('known_host_rm', { name }),
  /** Tests the editor's unsaved form; the result arrives as a "host:test" event. */
  hostTest: (session: string, target: string, p: HostPatch) =>
    call('host_test', { ...p, session, target, accept_new_host_key: false }),
  /** The one call that returns a secret (D-029). Keep the value out of logs and state that outlives the field. */
  secretReveal: (kind: 'host' | 'credential', name: string) => call<{ value: string }>('secret_reveal', { kind, name }),
  /** The core puts the password on the clipboard and clears it after 30 s. */
  secretCopy: (kind: 'host' | 'credential', name: string) => call('secret_copy', { kind, name }),

  /** `noCommand` skips the host's initial command, like `flint connect --no-command`. */
  sessionOpen: (session: string, alias: string, cols: number, rows: number, noCommand = false, filesOnly = false) =>
    call('session_open', { session, alias, cols, rows, accept_new_host_key: false, no_command: noCommand, files_only: filesOnly }),
  /** An OSC 52 payload ("c;base64") a remote program wrote; the core copies it. */
  terminalClipboard: (payload: string) => call<{ outcome: string; bytes: number }>('terminal_clipboard', { name: payload }),
  sessionInput: (session: string, data: string) => call('session_input', { session, data }),
  sessionResize: (session: string, cols: number, rows: number) => call('session_resize', { session, cols, rows }),
  sessionAnswer: (session: string, prompt: string, ok: boolean, value: string) =>
    call('session_answer', { session, prompt, ok, value }),
  sessionClose: (session: string) => call('session_close', { session }),

  /** A remote desktop (milestone 30): connects on a worker; "rdp:ready" and "rdp:state" follow. */
  rdpOpen: (tab: string, alias: string, width: number, height: number, graphics: string) => call('rdp_open', { tab, alias, width, height, graphics }),
  rdpKey: (tab: string, code: string, down: boolean) => call('rdp_key', { tab, code, down }),
  rdpPointer: (tab: string, p: RdpPointer) => call('rdp_pointer', { tab, ...p }),
  rdpResize: (tab: string, width: number, height: number) => call('rdp_resize', { tab, width, height }),
  /** Milestone 38: the desktop across the chosen monitors, each the size its window measured. */
  rdpSpan: (tab: string, picks: MonitorPick[]) => call<DesktopSpan>('rdp_span', { tab, picks }),
  monitorsList: () => call<MonitorsView>('monitors_list'),
  /** A full-screen window on each extra monitor; others close. Their pages answer as `monitor:message`. */
  monitorsOpen: (ids: string[]) => call('monitors_open', { ids }),
  monitorsClose: () => call('monitors_close'),
  monitorsSend: (id: string, data: unknown) => call('monitors_send', { id, data: JSON.stringify(data) }),
  rdpClose: (tab: string) => call('rdp_close', { tab }),
  /** Milestone 34: the desktop's counters, for the statistics overlay. */
  rdpStats: (tab: string) => call<RdpStats>('rdp_stats', { tab }),
  rdpGraphics: (tab: string, graphics: string) => call('rdp_graphics', { tab, graphics }),
  /** Milestone 31: tells the server whether this machine's clipboard holds text (never the text). */
  rdpClipboardAnnounce: (tab: string) => call('rdp_clipboard_announce', { tab }),

  /** The Files view (milestone 17): SFTP over a tab's own session (D-053). */
  filesHome: (session: string) => call<{ path: string }>('files_home', { session, path: '' }),
  filesList: (session: string, path: string) => call<{ path: string; entries: FileEntry[] }>('files_list', { session, path }),
  filesRename: (session: string, from: string, to: string) => call<{ path: string }>('files_rename', { session, from, to }),
  /** A file, or a folder with everything in it. */
  filesRemove: (session: string, path: string) => call<{ path: string }>('files_remove', { session, path }),
  filesMkdir: (session: string, path: string) => call<{ path: string }>('files_mkdir', { session, path }),
  /** Resolves when the copy ends; progress arrives as "files:transfer" events with this `id`. */
  filesTransfer: (t: { session: string; id: string; direction: 'upload' | 'download'; local: string; remote: string; recursive: boolean; force: boolean }) =>
    call<CopyResult>('files_transfer', t),
  /** A copy between two sessions (milestone 19): host → Flint → host, not logged (D-055). */
  filesRelay: (t: { session: string; to_session: string; id: string; alias: string; to_alias: string; path: string; to_path: string; recursive: boolean; force: boolean }) =>
    call<CopyResult>('files_relay', t),
  filesCancel: (id: string) => call('files_cancel', { id }),
  /** A chunk (base64) of a file dropped from the OS, staged until it is uploaded (CF-004). */
  filesStage: (drop: string, rel: string, data: string) => call<{ path: string }>('files_stage', { drop, rel, data }),
  filesStageDiscard: (drop: string) => call('files_stage_discard', { id: drop }),
  /** Paste into the terminal (milestone 25): writes a staged file on the pane's host
   *  and returns its path, and the same path escaped for a shell. */
  terminalPaste: (p: { session: string; drop: string; rel: string; name: string; kind: string }) =>
    call<{ path: string; text: string; size: number }>('terminal_paste', p),
  /** The core reads the clipboard when the page's paste event came empty (WebKitGTK):
   *  its text, or an image staged in `drop` as `rel` for `terminalPaste`. */
  terminalClipboardRead: (drop: string, rel: string) =>
    call<{ kind: 'text' | 'image' | 'none'; text: string; mime: string; size: number }>('terminal_clipboard_read', { drop, rel }),

  /** Tunnels (milestone 23): every saved one, with its live state. */
  tunnelsList: () => call<TunnelView[]>('tunnels_list'),
  tunnelSave: (t: TunnelSave) => call<TunnelView>('tunnel_save', t),
  tunnelRm: (host: string, name: string) => call<TunnelView>('tunnel_rm', { host, name }),
  tunnelStop: (host: string, name: string) => call<TunnelView>('tunnel_stop', { host, name }),
  /** Starts on a worker; prompts arrive as "session:prompt" under `session`, the end as "tunnel:started".
   *  No `names`: the host's Open when I connect tunnels, or with `all` every one of them. */
  tunnelStart: (session: string, host: string, names: string[], all = false) =>
    call('tunnel_start', { session, host, names, all }),
};

export function emptyHostPatch(): HostPatch {
  return {
    alias: '', set_alias: false, label: '', set_label: false, hostname: '', set_hostname: false,
    port: 22, set_port: false, user: '', set_user: false, group: '', set_group: false,
    tags: [], set_tags: false, color: '', set_color: false, notes: '', set_notes: false,
    jump: '', set_jump: false, credential: '', set_credential: false, key: '', set_key: false,
    password: '', set_password: false, command: '', set_command: false, keep_shell: true, set_keep_shell: false,
    sudo_password: '', set_sudo_password: false, type: 'ssh', set_type: false, domain: '', set_domain: false,
  };
}

export function emptyCredPatch(): CredPatch {
  return { name: '', set_name: false, user: '', set_user: false, key: '', set_key: false, password: '', set_password: false };
}
