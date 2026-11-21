// The update notice as the page sees it (milestone 52, designs 24c, 24e, 24f, 24g,
// 24i, D-116): the core's last `update:status`, shared by the toast, the status bar's
// version item, About's Updates block and the palette, so all of them say the same
// thing at once. The toast shows once per version (the core says when); the status
// bar keeps saying it after the toast is closed. What's new (24g) lives here too: once
// per version after an update, and on demand. Milestone 53 (24c2-24c4, 24d1, D-111):
// Download inside Flint, its progress in the toast and the status bar (✕ only hides
// the toast), a sticky Ready toast with Relaunch, 24d1 when sessions or tunnels are
// open, and why the last update was not applied, once. The toast that a version is
// out stays away while the popover or About's Updates block is on screen (D-119).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, on } from '../api/backend';
import type { ChangeVersion, UpdateStatus } from '../api/types';
import { toasts, useApp } from '../state/app';
import { UPDATE_TOAST_KEY, UPDATES_DOCS_URL, relaunchClosesText, updateActionLabel, updateDownloadFailure, updateDownloadingText, updatePercent, updateReadyText, updateToastText } from '../lib/update';
import { sessions } from '../sessions/store';
import { tunnels } from '../tunnels/store';
import { RelaunchConfirm } from './RelaunchConfirm';
import { WhatsNewModal } from './WhatsNewModal';

interface UpdateApi {
  status: UpdateStatus | null;
  /** Bytes of the package received while it downloads. */
  received: number;
  now: number;
  /** Check now (About, the popover, the palette). */
  checkNow: () => void;
  /** Download, Relaunch once it is ready, or How to update (About). */
  act: () => void;
  /** What's new in this version (About, the popover, the palette). */
  showWhatsNew: () => void;
  /** The shell's way to Settings → About; unset while the vault is locked. */
  setAboutOpener: (fn: (() => void) | null) => void;
  openAbout: () => void;
  /** A surface that shows the update's state and its button (the version's popover,
   *  About's Updates block) is on screen until the returned function runs. */
  onScreen: () => () => void;
}

const Ctx = createContext<UpdateApi | null>(null);

export function useUpdate(): UpdateApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUpdate outside UpdateProvider');
  return v;
}

/** While `active`, this component shows the update's news itself: no toast over it. */
export function useUpdateOnScreen(active = true) {
  const { onScreen } = useUpdate();
  useEffect(() => (active ? onScreen() : undefined), [active, onScreen]);
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { notify, fail, phase } = useApp();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [received, setReceived] = useState(0);
  const [confirm, setConfirm] = useState<{ version: string; closes: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [whatsNew, setWhatsNew] = useState<{ versions: ChangeVersion[]; since: string; current: string } | null>(null);
  const [launchNews, setLaunchNews] = useState<{ versions: ChangeVersion[]; since: string; current: string } | null>(null);
  const aboutOpener = useRef<(() => void) | null>(null);
  const surfaces = useRef(0);
  const statusRef = useRef<UpdateStatus | null>(null);
  statusRef.current = status;

  const openAbout = useCallback(() => {
    if (aboutOpener.current) aboutOpener.current();
    else api.openUrl(UPDATES_DOCS_URL).catch(fail);
  }, [fail]);

  // Relaunch: 24d1 first when sessions or tunnels would close.
  const relaunch = useCallback(async () => {
    const st = statusRef.current;
    if (!st || st.state !== 'ready') return;
    const open = sessions.get().panes.filter((p) => p.status !== 'ended').length;
    const up = tunnels.get().list.filter((t) => t.state === 'listening').length;
    const commands = (await api.cliRunning().catch(() => ({ count: 0 }))).count;
    const closes = relaunchClosesText(open, up, commands);
    if (closes) setConfirm({ version: st.version, closes });
    else api.updateHint('relaunch').catch(fail);
  }, [fail]);

  const download = useCallback(() => { api.updateHint('download').catch(fail); }, [fail]);

  const act = useCallback(() => {
    const st = statusRef.current;
    if (!st) return;
    if (st.state === 'ready') { relaunch(); return; }
    if (st.state !== 'available') return;
    if (st.action === 'download') download();
    else openAbout();
  }, [download, relaunch, openAbout]);

  // The download's bytes so far: the toast's percentage and the status bar's.
  useEffect(() => on<{ received: number }>('update:progress', (p) => {
    setReceived(p.received);
    const st = statusRef.current;
    // ✕ hid the toast; the download goes on and only the status bar counts (D-111 (4)).
    const showing = toasts.list().some((t) => t.key === UPDATE_TOAST_KEY && !t.leaving);
    if (st && st.state === 'downloading' && showing) {
      notify({ text: updateDownloadingText(st), kind: 'info', key: UPDATE_TOAST_KEY, progress: updatePercent(p.received, st.asset_size) });
    }
  }), [notify]);

  // Every outcome of the core's loop; the toast when the core says it is due.
  useEffect(() => on<UpdateStatus>('update:status', (st) => {
    const before = statusRef.current;
    // Two outcomes can arrive before a render (a download that fails at once): the next
    // one must see this one, not the state of the last render.
    statusRef.current = st;
    setStatus(st);
    setNow(Date.now());
    if (st.outcome) {
      api.updateHint('outcome_shown').catch(() => {});
      notify({ text: st.outcome, kind: 'error', key: UPDATE_TOAST_KEY });
    }
    if (st.state === 'downloading' && before?.state !== 'downloading') {
      setReceived(0);
      notify({ text: updateDownloadingText(st), kind: 'info', key: UPDATE_TOAST_KEY, progress: 0 });
      return;
    }
    if (st.state === 'ready' && before?.state === 'downloading') {
      notify({
        text: updateReadyText(st), kind: 'ok', key: UPDATE_TOAST_KEY, duration: 'sticky',
        actions: [{ label: 'Relaunch', primary: true, run: () => relaunch() }],
      });
      return;
    }
    if (st.state === 'available' && before?.state === 'downloading' && st.code) {
      // The download failed: nothing was kept (24c4a, 24c4b). Retry only where it can help.
      const f = updateDownloadFailure(st);
      notify({
        text: f.text, kind: 'error', key: UPDATE_TOAST_KEY,
        actions: [f.retry ? { label: 'Retry', run: () => download() } : { label: 'Details', run: () => openAbout() }],
      });
      return;
    }
    if (st.toast && st.state === 'available') {
      // The core asks for the toast until it hears it was shown (a page that loads
      // after the check still gets it, once).
      api.updateHint('toast_shown').catch(() => {});
      // The popover or About's Updates block already says it, with its button: a toast
      // would repeat it (over the popover). Seen there, so it does not come later either.
      if (surfaces.current > 0) return;
      notify({
        text: updateToastText(st), kind: 'info', key: UPDATE_TOAST_KEY, duration: 'sticky',
        actions: [{ label: updateActionLabel(st), primary: true, run: () => act() }],
      });
    }
  }), [notify, act, relaunch, download, openAbout]);

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
  const onScreen = useCallback(() => {
    surfaces.current++;
    return () => { surfaces.current--; };
  }, []);
  const setAboutOpener = useCallback((fn: (() => void) | null) => { aboutOpener.current = fn; }, []);

  const value = useMemo<UpdateApi>(() => ({ status, received, now, checkNow, act, showWhatsNew, setAboutOpener, openAbout, onScreen }),
    [status, received, now, checkNow, act, showWhatsNew, setAboutOpener, openAbout, onScreen]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {confirm && <RelaunchConfirm version={confirm.version} closes={confirm.closes} onCancel={() => setConfirm(null)}
        onRelaunch={() => { setConfirm(null); api.updateHint('relaunch').catch(fail); }} />}
      {whatsNew && <WhatsNewModal versions={whatsNew.versions} current={whatsNew.current} since={whatsNew.since} onClose={() => setWhatsNew(null)} />}
    </Ctx.Provider>
  );
}
