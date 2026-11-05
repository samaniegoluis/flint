// App-wide state: platform, settings, the recent vaults, the unlocked vault and its
// catalog. Startup follows the vault lifecycle in docs/spec.md: reopen the last
// vault (from the keychain when it holds a key), else ask for its password, else
// show the welcome screen.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, FlintError, toFlintError } from '../api/backend';
import type { AppInfo, Catalog, RecentView, Settings, VaultInfo } from '../api/types';
import type { Os } from '../lib/keymap';

export type Phase = 'boot' | 'welcome' | 'create' | 'unlock' | 'main';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error' | 'info';
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system', accent: 'ember', density: 'default', follow_motion: true, reopen_last_vault: true,
  term_font: '', term_font_size: 13, term_line_height: 150, term_cursor: 'block', term_cursor_blink: true,
};

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
  go: (p: Phase) => void;
  setTarget: (r: RecentView | null) => void;
  refreshRecents: () => Promise<RecentView[]>;
  unlock: (path: string, password: string) => Promise<VaultInfo>;
  create: (path: string, name: string, password: string) => Promise<VaultInfo>;
  closeVault: () => Promise<void>;
  openVaultFile: () => Promise<void>;
  switchTo: (r: RecentView) => Promise<void>;
  refreshCatalog: () => Promise<Catalog>;
  saveSettings: (s: Settings) => Promise<void>;
  notify: (text: string, kind?: Toast['kind']) => void;
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

  const os: Os = info?.os ?? (/mac/i.test(navigator.platform) ? 'mac' : 'linux');
  const dark = settings.theme === 'system' ? sysDark : settings.theme === 'dark';

  const notify = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now();
    setToast({ id, text, kind });
    window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 4000);
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

  const unlock = useCallback(async (path: string, password: string) => {
    const v = await api.unlock(path, password);
    await enter(v);
    return v;
  }, [enter]);

  const create = useCallback(async (path: string, name: string, password: string) => {
    const v = await api.create(path, name, password);
    await enter(v);
    return v;
  }, [enter]);

  const closeVault = useCallback(async () => {
    await api.close();
    const list = await refreshRecents();
    setVault(null);
    setCatalog(EMPTY_CATALOG);
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

  // Startup.
  useEffect(() => {
    (async () => {
      try {
        const i = await api.appInfo();
        setInfo(i);
        const s = await api.settingsGet();
        setSettings(s);
        const list = await refreshRecents();
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
    go: setPhase, setTarget, refreshRecents, unlock, create, closeVault, openVaultFile, switchTo,
    refreshCatalog, saveSettings, notify, fail,
  }), [info, os, phase, settings, dark, recents, target, vault, catalog, toast, bootError, refreshRecents,
    unlock, create, closeVault, openVaultFile, switchTo, refreshCatalog, saveSettings, notify, fail]);

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
