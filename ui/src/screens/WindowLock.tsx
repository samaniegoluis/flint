// The window's own lock (milestone 14, D-048). Closing the window keeps Flint in the
// menu bar or tray: the vault stays unlocked and keeps serving the grants already
// approved, but the window comes back covered by this screen until the OS's
// presence check (Touch ID, polkit) or the master password opens it. It shows the
// vault's name and how many callers wait, nothing from inside the vault: the core
// refuses the page every read while the window is locked.

import { useEffect, useRef, useState } from 'react';
import { toFlintError } from '../api/backend';
import { useApp } from '../state/app';
import { presenceLabel } from '../access/ApprovalDialog';
import type { PresenceMethod } from '../api/types';
import { Icon, Logo } from '../ui/Icon';

export function WindowLock() {
  const { windowLock, openWindow, os, info } = useApp();
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'' | 'presence' | 'password'>('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const presence = (windowLock?.presence ?? 'password') as PresenceMethod;
  const hasPresence = presence !== 'password';

  useEffect(() => { input.current?.focus(); }, []);
  if (!windowLock) return null;

  const open = async (password: string) => {
    setBusy(password ? 'password' : 'presence');
    setError('');
    try {
      await openWindow(password);
    } catch (err) {
      const fe = toFlintError(err);
      setError(fe.code === 'wrong_password' ? 'Wrong password.' : fe.code === 'denied' ? 'Not confirmed. The window stays locked.' : fe.message);
      setBusy('');
      setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    open(pw).catch(() => {});
  };

  const where = os === 'mac' ? 'the menu bar' : 'the system tray';
  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Window locked" data-window-lock
      style={{ position: 'absolute', inset: 0, zIndex: 1100, background: 'var(--surface-sunken)' }}>
      <header className="titlebar" style={{ background: 'transparent', borderBottomColor: 'transparent' }}>
        <div className="tb-brand"><Logo />Flint</div>
      </header>
      <main style={{ position: 'absolute', inset: '38px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 'var(--sp-16)' }}>
        <form aria-label="Open the window" className="col" style={{ width: 460, gap: 'var(--sp-6)' }} onSubmit={submit}>
          <div className="col" style={{ alignItems: 'center', gap: 'var(--sp-3)', textAlign: 'center' }}>
            <Icon name="lock" size="lg" className="accent-t" />
            <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)', letterSpacing: '-0.01em' }}>{windowLock.vault}</h1>
            <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              The window was closed to {where}. The vault is still unlocked for the agents you approved.
            </span>
          </div>
          {windowLock.waiting > 0 && (
            <section className="panel row" role="status" data-window-waiting style={{ padding: 'var(--sp-3) var(--sp-4)', gap: 'var(--sp-3)', borderColor: 'var(--info-border)' }}>
              <span className="prompt-ic info" style={{ width: 28, height: 28 }}><Icon name="agent" /></span>
              <span className="grow">{windowLock.waiting === 1 ? 'A command is' : `${windowLock.waiting} commands are`} waiting for your answer. Open the window to see {windowLock.waiting === 1 ? 'it' : 'them'}.</span>
            </section>
          )}
          {hasPresence && (
            <button type="button" className="btn btn-primary" data-window-presence disabled={!!busy} onClick={() => open('').catch(() => {})} style={{ alignSelf: 'center' }}>
              {presence === 'touchid' && <Icon name="fingerprint" />}
              {busy === 'presence' ? 'Waiting for confirmation…' : `Open with ${presenceLabel(presence)}`}
            </button>
          )}
          <div className="field">
            <label className="flabel" htmlFor="wpw">{hasPresence ? 'Or the master password' : 'Master password'}</label>
            <div className={'input lg mono' + (error ? ' err' : '')} style={{ paddingLeft: 'var(--sp-4)', gap: 'var(--sp-3)' }}>
              <span className="accent-t" aria-hidden="true">❯</span>
              <input id="wpw" ref={input} type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pw}
                onChange={(e) => setPw(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'wpwe' : undefined}
                style={{ fontSize: 'var(--fs-lg)' }} disabled={!!busy} />
              <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
              <button type="submit" className={'btn btn-sm ' + (hasPresence ? 'btn-secondary' : 'btn-primary')} style={{ fontFamily: 'var(--font-ui)' }} disabled={!pw || !!busy}>{busy === 'password' ? 'Opening…' : 'Open'}<span className="kbd-in">↵</span></button>
            </div>
            {error && <span id="wpwe" className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
          </div>
          <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />Open sessions keep running behind this screen. Lock the vault from the {os === 'mac' ? 'menu bar icon' : 'tray icon'} to end every grant.</span>
        </form>
      </main>
      <footer className="mono faint" style={{ position: 'absolute', left: 0, right: 0, bottom: 'var(--sp-4)', textAlign: 'center', fontSize: 'var(--fs-xs)' }}>
        Flint {info?.version}
      </footer>
    </div>
  );
}
