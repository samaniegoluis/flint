// The update notice as the page sees it (milestone 52, designs 24c, 24e, 24f, 24g,
// 24i, D-116): the core's last `update:status`, shared by the toast, the status bar's
// version item, About's Updates block and the palette, so all of them say the same
// thing at once. The toast shows once per version (the core says when); the status
// bar keeps saying it after the toast is closed. What's new (24g) lives here too: once
// per version after an update, and on demand.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, on } from '../api/backend';
import type { ChangeVersion, UpdateStatus } from '../api/types';
import { useApp } from '../state/app';
import { UPDATE_TOAST_KEY, UPDATES_DOCS_URL, updateActionLabel, updateToastText } from '../lib/update';
import { WhatsNewModal } from './WhatsNewModal';

interface UpdateApi {
  status: UpdateStatus | null;
  now: number;
  /** Check now (About, the popover, the palette). */
  checkNow: () => void;
  /** Download (the release page, until milestone 53) or How to update (About). */
  act: () => void;
  /** What's new in this version (About, the popover, the palette). */
  showWhatsNew: () => void;
  /** The shell's way to Settings → About; unset while the vault is locked. */
  setAboutOpener: (fn: (() => void) | null) => void;
  openAbout: () => void;
}

const Ctx = createContext<UpdateApi | null>(null);

export function useUpdate(): UpdateApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUpdate outside UpdateProvider');
  return v;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { notify, fail, phase } = useApp();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [whatsNew, setWhatsNew] = useState<{ versions: ChangeVersion[]; since: string; current: string } | null>(null);
  const [launchNews, setLaunchNews] = useState<{ versions: ChangeVersion[]; since: string; current: string } | null>(null);
  const aboutOpener = useRef<(() => void) | null>(null);
  const statusRef = useRef<UpdateStatus | null>(null);
  statusRef.current = status;

  const openAbout = useCallback(() => {
    if (aboutOpener.current) aboutOpener.current();
    else api.openUrl(UPDATES_DOCS_URL).catch(fail);
  }, [fail]);

  const act = useCallback(() => {
    const st = statusRef.current;
    if (!st || st.state !== 'available') return;
    // Milestone 52 opens the release page; the download inside Flint is milestone 53.
    if (st.action === 'download') api.openUrl(st.page).catch(fail);
    else openAbout();
  }, [fail, openAbout]);

  // Every outcome of the core's loop; the toast when the core says it is due.
  useEffect(() => on<UpdateStatus>('update:status', (st) => {
    setStatus(st);
    setNow(Date.now());
    if (st.toast && st.state === 'available') {
      notify({
        text: updateToastText(st), kind: 'info', key: UPDATE_TOAST_KEY, duration: 'sticky',
        actions: [{ label: updateActionLabel(st), primary: true, run: () => act() }],
      });
    }
  }), [notify, act]);

  // The last outcome, for a page that starts after it (and a reload).
  useEffect(() => { api.updateHint('status').catch(() => {}); }, []);

  // "10 min ago" moves on.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // What's new once per version: asked once at launch (the core records it as seen),
  // shown once the vault is open.
  useEffect(() => {
    api.whatsNew(true).then((w) => {
      if (w.versions.length > 0) setLaunchNews({ versions: w.versions, since: w.since, current: w.current });
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (phase === 'main' && launchNews) { setWhatsNew(launchNews); setLaunchNews(null); }
  }, [phase, launchNews]);

  const checkNow = useCallback(() => { api.updateHint('now').catch(fail); }, [fail]);
  const showWhatsNew = useCallback(() => {
    api.whatsNew(false).then((w) => setWhatsNew({ versions: w.versions, since: '', current: w.current })).catch(fail);
  }, [fail]);
  const setAboutOpener = useCallback((fn: (() => void) | null) => { aboutOpener.current = fn; }, []);

  const value = useMemo<UpdateApi>(() => ({ status, now, checkNow, act, showWhatsNew, setAboutOpener, openAbout }),
    [status, now, checkNow, act, showWhatsNew, setAboutOpener, openAbout]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {whatsNew && <WhatsNewModal versions={whatsNew.versions} current={whatsNew.current} since={whatsNew.since} onClose={() => setWhatsNew(null)} />}
    </Ctx.Provider>
  );
}
