// The bridge to the GUI driver. `window.backend.<name>(params)` is webui's RPC proxy;
// a rejected call carries the core's "code: message" text, split here into a
// FlintError so the UI can branch on stable codes (D-018, D-019).

import type {
  AppInfo, Catalog, CredPatch, CredView, GroupView, HostPatch, HostView, KeyView,
  KnownHostView, RecentView, Settings, TetherImportReport, UiStateView, UnlockRequest, VaultInfo, VaultStatus,
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
  unlock: (path: string, password: string) => call<VaultInfo>('vault_unlock', { path, password }),
  create: (path: string, name: string, password: string) => call<VaultInfo>('vault_create', { path, name, password }),
  close: () => call('vault_close'),
  /** Locks the vault: its key leaves memory, open sessions keep running (D-042). */
  lock: () => call('vault_lock'),
  /** Someone is using the window; keeps the vault from locking for idleness. */
  activity: () => call('activity'),
  unlockRequest: () => call<UnlockRequest>('unlock_request'),
  unlockRequestDismiss: () => call('unlock_request_dismiss'),
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
  /** Copies a Tether vault into the open vault; `dryRun` only reports (D-034). */
  importTether: (path: string, password: string, dryRun: boolean) =>
    call<TetherImportReport>('import_tether', { path, password, dry_run: dryRun }),
  /** The one call that returns a secret (D-029). Keep the value out of logs and state that outlives the field. */
  secretReveal: (kind: 'host' | 'credential', name: string) => call<{ value: string }>('secret_reveal', { kind, name }),
  /** The core puts the password on the clipboard and clears it after 30 s. */
  secretCopy: (kind: 'host' | 'credential', name: string) => call('secret_copy', { kind, name }),

  /** `noCommand` skips the host's initial command, like `flint connect --no-command`. */
  sessionOpen: (session: string, alias: string, cols: number, rows: number, noCommand = false) =>
    call('session_open', { session, alias, cols, rows, accept_new_host_key: false, no_command: noCommand }),
  /** An OSC 52 payload ("c;base64") a remote program wrote; the core copies it. */
  terminalClipboard: (payload: string) => call<{ outcome: string; bytes: number }>('terminal_clipboard', { name: payload }),
  sessionInput: (session: string, data: string) => call('session_input', { session, data }),
  sessionResize: (session: string, cols: number, rows: number) => call('session_resize', { session, cols, rows }),
  sessionAnswer: (session: string, prompt: string, ok: boolean, value: string) =>
    call('session_answer', { session, prompt, ok, value }),
  sessionClose: (session: string) => call('session_close', { session }),
};

export function emptyHostPatch(): HostPatch {
  return {
    alias: '', set_alias: false, label: '', set_label: false, hostname: '', set_hostname: false,
    port: 22, set_port: false, user: '', set_user: false, group: '', set_group: false,
    tags: [], set_tags: false, color: '', set_color: false, notes: '', set_notes: false,
    jump: '', set_jump: false, credential: '', set_credential: false, key: '', set_key: false,
    password: '', set_password: false, command: '', set_command: false, keep_shell: true, set_keep_shell: false,
  };
}

export function emptyCredPatch(): CredPatch {
  return { name: '', set_name: false, user: '', set_user: false, key: '', set_key: false, password: '', set_password: false };
}
