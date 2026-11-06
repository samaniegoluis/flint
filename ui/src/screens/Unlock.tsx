import { useEffect, useRef, useState } from 'react';
import { toFlintError } from '../api/backend';
import { shortPath, useApp } from '../state/app';
import { Icon, Logo } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { actionFor } from '../lib/keymap';
import { VaultMenu } from '../shell/VaultSwitcher';
import { sessions, useSessions } from '../sessions/store';
import type { LockReason } from '../api/types';

const LOCK_REASONS: Record<LockReason, string> = {
  manual: 'Locked.',
  idle: 'Locked after being idle.',
  screen: 'Locked when the screen locked.',
  sleep: 'Locked before the computer went to sleep.',
  cli: 'Locked by flint vault lock.',
};

// `locked`: the vault was locked in this window. The screen covers the main window,
// whose sessions keep running, and only the master password opens it again (D-042).
export function Unlock({ locked = false }: { locked?: boolean }) {
  const { target, unlock, openVaultFile, os, info, fail, go, lockReason, unlockRequest, dismissUnlockRequest, closeVault } = useApp();
  const { tabs } = useSessions();
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [caps, setCaps] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      const a = actionFor(e, os);
      if (a === 'switchVault') { e.preventDefault(); setSwitcher(true); }
      if (a === 'openVault') { e.preventDefault(); openVaultFile().catch(fail); }
      if (a === 'createVault') { e.preventDefault(); go('create'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked, os, openVaultFile, fail, go]);

  useEffect(() => { setPw(''); setError(''); input.current?.focus(); }, [target?.path]);

  if (!target) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setError('');
    // Argon2id holds the app's UI thread for about a second (CF-046); the page keeps
    // painting "Unlocking…" because WebKit renders it in another process.
    try {
      await unlock(target.path, pw);
    } catch (err) {
      const fe = toFlintError(err);
      setError(fe.code === 'wrong_password'
        ? 'Wrong password.' + (caps ? ' Caps Lock is on — check it and your keyboard layout.' : '')
        : fe.message);
      setBusy(false);
      // The field keeps the attempt, selected, so retyping replaces it (design 03b).
      // A timeout, not requestAnimationFrame: the field is enabled again only after
      // this render, and a hidden headless page never runs animation frames (CF-050).
      setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0);
    }
  };

  const keychain = os === 'mac' ? 'macOS Keychain' : 'the keyring';
  const live = tabs.filter((t) => t.status !== 'ended').length;
  const request = unlockRequest && unlockRequest.path ? unlockRequest : null;
  // Leaves the locked vault for another one: its sessions end.
  const closeLocked = async () => {
    sessions.closeAll();
    await closeVault();
  };
  const switchToRequested = async () => {
    if (!request) return;
    sessions.closeAll();
    await closeVault();
    try {
      await unlock(request.path, '');
    } catch {
      // closeVault picked the current vault; the request names another one.
    }
  };
  const body = (
    <>
      <header className="titlebar" style={{ background: 'transparent', borderBottomColor: 'transparent' }}>
        <div className="tb-brand"><Logo />Flint</div>
      </header>
      <main style={{ position: 'absolute', inset: '38px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 'var(--sp-16)', background: 'var(--surface-sunken)' }}>
        <form aria-label={locked ? 'Vault locked' : 'Unlock vault'} className="col" style={{ width: 460, gap: 'var(--sp-6)' }} onSubmit={submit}>
          {request && (
            <div className="panel col" role="status" data-unlock-request style={{ padding: 'var(--sp-3) var(--sp-4)', gap: 'var(--sp-2)', borderColor: 'var(--accent)' }}>
              <span className="row" style={{ gap: 6 }}><Icon name="info" size="xs" className="accent-t" /><span><span className="mono strong">{request.caller}</span> wants to use {request.path === target.path ? 'this vault' : <>vault <span className="strong">{request.name}</span></>}.</span></span>
              <span className="hint">{request.path === target.path
                ? 'Unlock it to let the command run again; nothing runs until you do.'
                : 'Close this vault to unlock that one; the sessions here end.'}</span>
              <div className="row" style={{ gap: 'var(--sp-3)' }}>
                {request.path !== target.path && <button type="button" className="btn btn-secondary btn-sm" onClick={() => switchToRequested().catch(fail)}>Unlock {request.name} instead</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={dismissUnlockRequest}>Dismiss</button>
              </div>
            </div>
          )}
          <div className="col" style={{ alignItems: 'center', gap: 'var(--sp-3)', textAlign: 'center' }}>
            {locked ? <Icon name="lock" size="lg" className="accent-t" /> : <Logo size={40} label="Flint" />}
            <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)', letterSpacing: '-0.01em' }}>{target.name}</h1>
            <span className="mono muted" style={{ fontSize: 'var(--fs-sm)' }}>{shortPath(target.path)}</span>
            {locked && <span className="muted" data-lock-reason={lockReason ?? 'manual'} style={{ fontSize: 'var(--fs-sm)' }}>{LOCK_REASONS[lockReason ?? 'manual']}{live > 0 ? ` ${live === 1 ? 'One session keeps' : `${live} sessions keep`} running.` : ''}</span>}
          </div>
          <div className="field">
            <label className="flabel" htmlFor="pw">{locked ? 'Master password' : <>Master password — this {os === 'mac' ? 'Mac' : 'machine'} has no saved key for this vault</>}</label>
            <div className={'input lg mono' + (error ? ' err' : '')} style={{ paddingLeft: 'var(--sp-4)', gap: 'var(--sp-3)' }}>
              <span className="accent-t" aria-hidden="true">❯</span>
              <input id="pw" ref={input} type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pw} autoFocus
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => setCaps(e.getModifierState?.('CapsLock') ?? false)}
                onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock') ?? false)}
                aria-describedby={error ? 'pwe' : undefined} aria-invalid={!!error} style={{ fontSize: 'var(--fs-lg)' }} disabled={busy} />
              {caps && <span className="badge warn" style={{ fontFamily: 'var(--font-ui)' }}>⇪ Caps Lock</span>}
              <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
              <button type="submit" className="btn btn-primary btn-sm" style={{ fontFamily: 'var(--font-ui)' }} disabled={!pw || busy}>{busy ? 'Unlocking…' : 'Unlock'}<span className="kbd-in">↵</span></button>
            </div>
            {error && <span id="pwe" className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
          </div>
          {locked
            ? <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />The vault key left memory when it locked. Until you unlock, the flint CLI and new sessions cannot use this vault.</span>
            : <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />Once unlocked, the key is saved in {keychain} and the next launch opens this vault without asking.</span>}
          <div className="row" style={{ justifyContent: 'center', gap: 'var(--sp-5)', paddingTop: 'var(--sp-5)', borderTop: '1px solid var(--border-subtle)', position: 'relative' }}>
            {locked
              ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => closeLocked().catch(fail)}>Close vault{live > 0 ? ' and end its sessions' : ''}</button>
              : <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSwitcher(true)}>Switch vault<Kbd action="switchVault" /></button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openVaultFile().catch(fail)}>Open file…<Kbd action="openVault" /></button>
              </>}
            {switcher && <VaultMenu onClose={() => setSwitcher(false)} style={{ top: 48, left: '50%', marginLeft: -170 }} />}
          </div>
        </form>
      </main>
      <footer className="mono faint" style={{ position: 'absolute', left: 0, right: 0, bottom: 'var(--sp-4)', textAlign: 'center', fontSize: 'var(--fs-xs)' }}>
        Flint {info?.version} · vault format v1 · Argon2id + SQLCipher + XChaCha20-Poly1305
      </footer>
    </>
  );
  if (!locked) return body;
  // Over the main window, which stays mounted underneath.
  return <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Vault locked" style={{ position: 'absolute', inset: 0, zIndex: 1000, background: 'var(--surface-sunken)' }}>{body}</div>;
}
