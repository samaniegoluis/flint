// App-wide state: platform, settings, the recent vaults, the unlocked vault and its
// catalog. Startup follows the vault lifecycle in docs/spec.md: a vault a `flint`
// command asked for, else the last vault (from the keychain when it holds a key),
// else ask for its password, else show the welcome screen.
//
// The window has a lock of its own (milestone 14): closed to the tray, it comes back
// covered by the window lock screen while the vault keeps serving its grants.
//
// Locking (D-042) keeps the main window mounted under the lock screen, so open
// sessions and their terminals carry on; the vault's key and catalog are gone until
// the master password is typed again.

import { pairs } from '../files/pair';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, FlintError, on, toFlintError } from '../api/backend';
import type { AppInfo, Catalog, LockReason, RecentView, Settings, UnlockRequest, VaultInfo, WindowState } from '../api/types';
import type { Os } from '../lib/keymap';

export type Phase = 'boot' | 'welcome' | 'create' | 'unlock' | 'main' | 'locked';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error' | 'info';
  /** One button on the toast (design 20d2's "Stop them"). */
  action?: { label: string; run: () => void };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system', accent: 'ember', density: 'default', follow_motion: true, reopen_last_vault: true,
  term_font: '', term_font_size: 13, term_line_height: 100, term_cursor: 'block', term_cursor_blink: true, term_theme: 'default',
  lock_after: '1h', paste_limit_mb: 20, rdp_mac_keys: 'mac', rdp_mac_custom: '', rdp_graphics: 'auto',
  sync_interval: 60,
};

// How often the page tells the core someone is using the window.
const ACTIVITY_EVERY_MS = 15000;

const EMPTY_CATALOG: Catalog = { groups: [], hosts: [], keys: [], credentials: [], known_hosts: [] };

interface AppApi {
  info: AppInfo | null;
  os: Os;
  phase: Phase;
  settings: Settings;
  dark: boolean;
  recents: RecentView[];
  target: RecentView | null;
  vault: VaultInfo | null;
  catalog: Catalog;
  toast: Toast | null;
  bootError: string;
  /** Why the vault locked, while the lock screen shows. */
  lockReason: LockReason | null;
  /** The unlock a `flint` command is waiting on. */
  unlockRequest: UnlockRequest | null;
  dismissUnlockRequest: () => void;
  lock: () => Promise<void>;
  /** The window's lock, while it covers the window (milestone 14). */
  windowLock: WindowState | null;
  /** Opens the locked window: the master password, or '' for Touch ID / polkit. */
  openWindow: (password: string) => Promise<void>;
  go: (p: Phase) => void;
  setTarget: (r: RecentView | null) => void;
  refreshRecents: () => Promise<RecentView[]>;
  unlock: (path: string, password: string, allow?: boolean, remember?: boolean) => Promise<VaultInfo>;
  create: (path: string, name: string, password: string, remember?: boolean) => Promise<VaultInfo>;
  closeVault: () => Promise<void>;
  openVaultFile: () => Promise<void>;
  switchTo: (r: RecentView) => Promise<void>;
  renameVault: (name: string) => Promise<VaultInfo>;
  refreshCatalog: () => Promise<Catalog>;
  saveSettings: (s: Settings) => Promise<void>;
  notify: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void;
  fail: (err: unknown) => FlintError;
}

const Ctx = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

function systemDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('boot');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sysDark, setSysDark] = useState(systemDark());
  const [recents, setRecents] = useState<RecentView[]>([]);
  const [target, setTarget] = useState<RecentView | null>(null);
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [toast, setToast] = useState<Toast | null>(null);
  const [bootError, setBootError] = useState('');
  const [lockReason, setLockReason] = useState<LockReason | null>(null);
  const [unlockRequest, setUnlockRequest] = useState<UnlockRequest | null>(null);
  const [windowLock, setWindowLock] = useState<WindowState | null>(null);

  const os: Os = info?.os ?? (/mac/i.test(navigator.platform) ? 'mac' : 'linux');
  const dark = settings.theme === 'system' ? sysDark : settings.theme === 'dark';

  const notify = useCallback((text: string, kind: Toast['kind'] = 'ok', action?: Toast['action']) => {
    const id = Date.now();
    setToast({ id, text, kind, action });
    // A toast with a button stays long enough to reach it.
    window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), action ? 8000 : 4000);
  }, []);

  const fail = useCallback((err: unknown) => {
    const e = toFlintError(err);
    notify(e.message, 'error');
    return e;
  }, [notify]);

  const refreshRecents = useCallback(async () => {
    const list = await api.recents();
    setRecents(list);
    return list;
  }, []);

  const refreshCatalog = useCallback(async () => {
    const c = await api.catalog();
    setCatalog(c);
    return c;
  }, []);

  const enter = useCallback(async (v: VaultInfo) => {
    setVault(v);
    setTarget(null);
    await refreshCatalog();
    await refreshRecents();
    setPhase('main');
  }, [refreshCatalog, refreshRecents]);

  // Renames the open vault: its name inside the file and in the recent list.
  const renameVault = useCallback(async (name: string) => {
    const v = await api.rename(name);
    setVault(v);
    await refreshRecents();
    return v;
  }, [refreshRecents]);

  const unlock = useCallback(async (path: string, password: string, allow = false, remember = false) => {
    const v = await api.unlock(path, password, allow, remember);
    setLockReason(null);
    setWindowLock(null);
    setUnlockRequest((r) => (r && r.path === v.path ? null : r));
    await enter(v);
    return v;
  }, [enter]);

  // The core locked the vault (the Lock button, idle time, the screen, sleep, the
  // CLI): the lock screen covers the window, which stays mounted.
  const showLocked = useCallback((path: string, name: string, reason: LockReason) => {
    // Locking ends the Files view's two-pane mode: the core hung up its sessions (D-059).
    pairs.closeAll();
    setCatalog(EMPTY_CATALOG);
    setLockReason(reason);
    setTarget({ path, name, current: true, exists: true });
    setPhase('locked');
  }, []);

  const lock = useCallback(async () => {
    await api.lock();
    if (vault) showLocked(vault.path, vault.name, 'manual');
  }, [vault, showLocked]);

  const dismissUnlockRequest = useCallback(() => {
    setUnlockRequest(null);
    api.unlockRequestDismiss().catch(() => {});
  }, []);

  const create = useCallback(async (path: string, name: string, password: string, remember = false) => {
    const v = await api.create(path, name, password, remember);
    await enter(v);
    return v;
  }, [enter]);

  const closeVault = useCallback(async () => {
    await api.close();
    const list = await refreshRecents();
    setVault(null);
    setCatalog(EMPTY_CATALOG);
    setLockReason(null);
    const current = list.find((r) => r.exists) ?? null;
    setTarget(current);
    setPhase(current ? 'unlock' : 'welcome');
  }, [refreshRecents]);

  // Opens a vault: from the keychain when it holds the key, else the unlock screen.
  const switchTo = useCallback(async (r: RecentView) => {
    try {
      await unlock(r.path, '');
    } catch (err) {
      const e = toFlintError(err);
      if (e.code !== 'locked' && e.code !== 'keychain') {
        fail(e);
        return;
      }
      if (vault) await api.close();
      setVault(null);
      setCatalog(EMPTY_CATALOG);
      setTarget(r);
      setPhase('unlock');
    }
  }, [unlock, vault, fail]);

  const openVaultFile = useCallback(async () => {
    const { path } = await api.dialogOpen('Open a Flint vault');
    if (!path) return;
    const name = path.split('/').pop()?.replace(/\.flint$/, '') ?? path;
    await switchTo({ path, name, current: false, exists: true });
  }, [switchTo]);

  const saveSettings = useCallback(async (s: Settings) => {
    setSettings(s);
    try {
      setSettings(await api.settingsSet(s));
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  // Theme, accent and density live on <html> so every token follows.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.accent = settings.accent;
    root.dataset.density = settings.density;
    root.dataset.motion = settings.follow_motion ? 'system' : 'full';
    if (info) api.windowTheme(dark).catch(() => {});
  }, [dark, settings.accent, settings.density, settings.follow_motion, info]);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => setSysDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // A connected vault (milestone 43): the window coming back tells the app's sync loop
  // to look at the server (it does when the last check is a while ago).
  useEffect(() => {
    if (!vault) return;
    const hint = () => { if (document.visibilityState === 'visible') api.syncHint('focus').catch(() => {}); };
    window.addEventListener('focus', hint);
    document.addEventListener('visibilitychange', hint);
    return () => {
      window.removeEventListener('focus', hint);
      document.removeEventListener('visibilitychange', hint);
    };
  }, [vault]);

  // A command from the `flint` CLI ran against this vault in the app (D-038), or a
  // sync merged another machine's changes (milestone 43): show what it changed.
  useEffect(() => on<{ path: string; name: string }>('vault:changed', (e) => {
    if (!vault || e.path !== vault.path) return;
    if (e.name !== vault.name) setVault({ ...vault, name: e.name });
    refreshCatalog().catch(() => {});
    refreshRecents().catch(() => {});
  }), [vault, refreshCatalog, refreshRecents]);

  useEffect(() => on<{ path: string; name: string; reason: LockReason }>('vault:locked', (e) => {
    // The vault's lock screen replaces the window's.
    setWindowLock(null);
    if (vault && e.path === vault.path) showLocked(e.path, vault.name, e.reason);
  }), [vault, showLocked]);

  // The window was closed to the tray: it is locked until opened again. A caller
  // asking meanwhile only changes the count the lock screen shows.
  const refreshWindowLock = useCallback(() => {
    api.windowState().then((w) => setWindowLock(w.locked ? w : null)).catch(() => {});
  }, []);
  useEffect(() => on('window:locked', refreshWindowLock), [refreshWindowLock]);
  useEffect(() => {
    if (!windowLock) return;
    const offs = [on('access:request', refreshWindowLock), on('access:resolved', refreshWindowLock)];
    return () => offs.forEach((off) => off());
  }, [windowLock, refreshWindowLock]);

  const openWindow = useCallback(async (password: string) => {
    const w = await api.windowUnlock(password);
    setWindowLock(w.locked ? w : null);
    // What the lock kept from the page: the catalog may have changed meanwhile.
    await refreshCatalog().catch(() => {});
  }, [refreshCatalog]);

  // A `flint` command is waiting for a vault: show its unlock screen, naming the
  // command. The core asks only while no vault is unlocked.
  const takeUnlockRequest = useCallback((r: UnlockRequest) => {
    if (!r.path) return;
    setUnlockRequest(r);
    if (phase === 'locked' && target?.path === r.path) return;
    if (phase === 'locked') return; // another vault is locked here; the screen offers to switch
    setTarget({ path: r.path, name: r.name, current: false, exists: true });
    setPhase('unlock');
  }, [phase, target]);
  useEffect(() => on<UnlockRequest>('vault:unlock-request', takeUnlockRequest), [takeUnlockRequest]);

  // Someone using the window keeps the vault unlocked; the core locks it after the
  // idle time in Settings.
  useEffect(() => {
    if (phase !== 'main') return;
    let last = 0;
    const touch = () => {
      const now = Date.now();
      if (now - last < ACTIVITY_EVERY_MS) return;
      last = now;
      api.activity().catch(() => {});
    };
    const kinds = ['keydown', 'pointerdown', 'wheel'] as const;
    for (const k of kinds) window.addEventListener(k, touch, { capture: true, passive: true });
    return () => { for (const k of kinds) window.removeEventListener(k, touch, { capture: true }); };
  }, [phase]);

  // Startup.
  useEffect(() => {
    (async () => {
      try {
        const i = await api.appInfo();
        setInfo(i);
        // A page reloaded behind a locked window comes back locked.
        const w = await api.windowState().catch(() => null);
        if (w?.locked) setWindowLock(w);
        const s = await api.settingsGet();
        setSettings(s);
        const list = await refreshRecents();
        // A `flint` command started this app to have a vault unlocked.
        const asked = await api.unlockRequest().catch(() => null);
        if (asked?.path) {
          setUnlockRequest(asked);
          try {
            await unlock(asked.path, '');
          } catch {
            setTarget({ path: asked.path, name: asked.name, current: false, exists: true });
            setPhase('unlock');
          }
          return;
        }
        const last = list.find((r) => r.exists);
        if (!last) {
          setPhase('welcome');
          return;
        }
        if (!s.reopen_last_vault) {
          setTarget(last);
          setPhase('unlock');
          return;
        }
        try {
          await unlock(last.path, '');
        } catch {
          setTarget(last);
          setPhase('unlock');
        }
      } catch (err) {
        setBootError(toFlintError(err).message);
        setPhase('welcome');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AppApi>(() => ({
    info, os, phase, settings, dark, recents, target, vault, catalog, toast, bootError,
    lockReason, unlockRequest, dismissUnlockRequest, lock, windowLock, openWindow,
    go: setPhase, setTarget, refreshRecents, unlock, create, closeVault, openVaultFile, switchTo, renameVault,
    refreshCatalog, saveSettings, notify, fail,
  }), [info, os, phase, settings, dark, recents, target, vault, catalog, toast, bootError,
    lockReason, unlockRequest, dismissUnlockRequest, lock, windowLock, openWindow, refreshRecents,
    unlock, create, closeVault, openVaultFile, switchTo, renameVault, refreshCatalog, saveSettings, notify, fail]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// The first letter of a vault's name, for its mark.
export function vaultInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

// A stable mark colour per vault path.
export function vaultMarkClass(path: string): string {
  const marks = ['', 'vm-sapphire', 'vm-moss', 'vm-rose', 'vm-slate'];
  let h = 0;
  for (const ch of path) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return marks[h % marks.length];
}

// "~/…" for paths under the home folder, when it can be guessed from the path.
export function shortPath(path: string): string {
  const m = path.match(/^\/(Users|home)\/[^/]+(\/.*)$/);
  return m ? '~' + m[2] : path;
}
