import { useEffect, useRef, useState } from 'react';
import { toFlintError } from '../api/backend';
import { shortPath, useApp } from '../state/app';
import { Icon, Logo } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { actionFor } from '../lib/keymap';
import { VaultMenu } from '../shell/VaultSwitcher';

export function Unlock() {
  const { target, unlock, openVaultFile, os, info, fail, go } = useApp();
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [caps, setCaps] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionFor(e, os);
      if (a === 'switchVault') { e.preventDefault(); setSwitcher(true); }
      if (a === 'openVault') { e.preventDefault(); openVaultFile().catch(fail); }
      if (a === 'createVault') { e.preventDefault(); go('create'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [os, openVaultFile, fail, go]);

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
  return (
    <>
      <header className="titlebar" style={{ background: 'transparent', borderBottomColor: 'transparent' }}>
        <div className="tb-brand"><Logo />Flint</div>
      </header>
      <main style={{ position: 'absolute', inset: '38px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 'var(--sp-16)', background: 'var(--surface-sunken)' }}>
        <form aria-label="Unlock vault" className="col" style={{ width: 460, gap: 'var(--sp-6)' }} onSubmit={submit}>
          <div className="col" style={{ alignItems: 'center', gap: 'var(--sp-3)', textAlign: 'center' }}>
            <Logo size={40} label="Flint" />
            <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)', letterSpacing: '-0.01em' }}>{target.name}</h1>
            <span className="mono muted" style={{ fontSize: 'var(--fs-sm)' }}>{shortPath(target.path)}</span>
          </div>
          <div className="field">
            <label className="flabel" htmlFor="pw">Master password — this {os === 'mac' ? 'Mac' : 'machine'} has no saved key for this vault</label>
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
          <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />Once unlocked, the key is saved in {keychain} and the next launch opens this vault without asking.</span>
          <div className="row" style={{ justifyContent: 'center', gap: 'var(--sp-5)', paddingTop: 'var(--sp-5)', borderTop: '1px solid var(--border-subtle)', position: 'relative' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSwitcher(true)}>Switch vault<Kbd action="switchVault" /></button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openVaultFile().catch(fail)}>Open file…<Kbd action="openVault" /></button>
            {switcher && <VaultMenu onClose={() => setSwitcher(false)} style={{ top: 48, left: '50%', marginLeft: -170 }} />}
          </div>
        </form>
      </main>
      <footer className="mono faint" style={{ position: 'absolute', left: 0, right: 0, bottom: 'var(--sp-4)', textAlign: 'center', fontSize: 'var(--fs-xs)' }}>
        Flint {info?.version} · vault format v1 · Argon2id + SQLCipher + XChaCha20-Poly1305
      </footer>
    </>
  );
}
