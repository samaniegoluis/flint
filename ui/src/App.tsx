import { useEffect, useRef } from 'react';
import { AppProvider, toasts, useApp } from './state/app';
import { Welcome } from './screens/Welcome';
import { CreateVault } from './screens/CreateVault';
import { ConnectRemote } from './screens/ConnectRemote';
import { Unlock } from './screens/Unlock';
import { WindowLock } from './screens/WindowLock';
import { Shell } from './shell/Shell';
import { Logo } from './ui/Icon';
import { Toasts } from './ui/Toasts';
import { FieldMenu } from './ui/FieldMenu';
import { CloseAsk } from './shell/CloseAsk';
import { sessions } from './sessions/store';
import { UpdateProvider } from './update/UpdateProvider';

// The main window, and the lock screens over it (the vault's, or the window's own
// when it was closed to the tray): the same element in every phase, so a lock never
// unmounts the terminals of the sessions that keep running.
function Main() {
  const { phase, windowLock } = useApp();
  const vaultLocked = phase === 'locked';
  const locked = vaultLocked || !!windowLock;
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current) host.current.inert = locked;
  }, [locked]);
  return (
    <>
      <div ref={host} style={{ display: 'contents' }} aria-hidden={locked || undefined}><Shell /></div>
      {vaultLocked && <Unlock locked />}
      {!vaultLocked && windowLock && <WindowLock />}
    </>
  );
}

function Phase() {
  const { phase, info } = useApp();

  // The headless end-to-end run (scripts/gui-e2e.sh) loads its driver script.
  useEffect(() => {
    if (!info?.e2e) return;
    const s = document.createElement('script');
    s.src = '/e2e.js';
    document.body.appendChild(s);
  }, [info?.e2e]);

  if (phase === 'boot') {
    return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Logo size={40} label="Flint" /></div>;
  }
  if (phase === 'welcome') return <Welcome />;
  if (phase === 'create') return <CreateVault />;
  if (phase === 'connect') return <ConnectRemote />;
  if (phase === 'unlock') return <Unlock />;
  return <Main />;
}

function Root() {
  const { os, settings } = useApp();
  return (
    <div className="app" data-os={os}>
      {/* Inside .app: the provider draws What's new and the Relaunch confirmation,
          which take the app's font and tokens from here (outside it, WebKit's serif). */}
      <UpdateProvider>
        <Phase />
        <Toasts store={toasts} corner={settings.toast_corner} />
        <FieldMenu />
        <CloseAsk />
      </UpdateProvider>
    </div>
  );
}

export function App() {
  useEffect(() => sessions.start(), []);
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}
