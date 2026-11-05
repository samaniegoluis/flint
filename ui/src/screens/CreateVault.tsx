import { useState } from 'react';
import { api, toFlintError } from '../api/backend';
import { useApp } from '../state/app';
import { Icon, Logo } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { passwordStrength } from '../lib/strength';

const MIN_LEN = 8;

export function CreateVault() {
  const { go, create, vault, target, os } = useApp();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const strength = passwordStrength(pw);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const ready = name.trim() && path && pw.length >= MIN_LEN && pw === pw2 && !busy;

  const back = () => go(vault ? 'main' : target ? 'unlock' : 'welcome');

  const choose = async () => {
    const fileName = (name.trim() || 'vault').toLowerCase().replace(/[^a-z0-9._-]+/g, '-') + '.flint';
    const { path: p } = await api.dialogSave('Create a Flint vault', fileName);
    if (p) setPath(p.endsWith('.flint') ? p : p + '.flint');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await create(path, name.trim(), pw);
    } catch (err) {
      setError(toFlintError(err).message);
      setBusy(false);
    }
  };

  const keychain = os === 'mac' ? 'macOS Keychain' : 'the Secret Service keyring';
  return (
    <>
      <header className="titlebar" style={{ background: 'var(--surface-base)', borderBottomColor: 'transparent' }}>
        <div className="tb-brand"><Logo />Flint</div>
        <div className="tb-title">New vault</div>
      </header>
      <main style={{ position: 'absolute', inset: '38px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form className="card" aria-label="Create vault" style={{ width: 520, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-1)' }} onSubmit={submit}
          onKeyDown={(e) => { if (e.key === 'Escape') back(); }}>
          <div className="modal-h"><Logo size={22} /><h2>Create a vault</h2></div>
          <div className="modal-b" style={{ gap: 'var(--sp-5)' }}>
            <div className="field">
              <label className="flabel" htmlFor="vn">Name</label>
              <div className="input"><input id="vn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Work" autoFocus maxLength={64} /></div>
            </div>
            <div className="field">
              <span className="flabel">Location</span>
              <div className="row" style={{ gap: 'var(--sp-2)' }}>
                <div className="input grow"><Icon name="folder" size="sm" className="faint" />
                  <input className="mono" aria-label="Vault file path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Choose where to save the file" style={{ fontSize: 'var(--fs-sm)' }} /></div>
                <button type="button" className="btn btn-secondary" style={{ height: 'var(--control-h)' }} onClick={() => choose().catch(() => {})}>Choose…</button>
              </div>
              <span className="hint row" style={{ gap: 6 }}><Icon name="cloud" size="xs" />Put it in a synced folder (iCloud Drive, Dropbox, Syncthing) to use it on your other machines.</span>
            </div>
            <div className="field">
              <label className="flabel" htmlFor="mp">Master password</label>
              <div className="input">
                <input id="mp" type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
                <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
              </div>
              <div className="row" style={{ gap: 'var(--sp-3)' }}>
                <div className={'meter grow ' + strength.meter} role="meter" aria-label="Password strength" aria-valuenow={strength.score} aria-valuemin={0} aria-valuemax={4}>
                  {[1, 2, 3, 4].map((i) => <i key={i} className={i <= strength.score ? 'on' : ''} />)}
                </div>
                <span className={strength.textClass} style={{ fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-medium)' }}>{pw ? strength.label : ''}</span>
              </div>
              <span className="hint">At least {MIN_LEN} characters; four random words work well. A forgotten master password cannot be recovered.</span>
            </div>
            <div className="field">
              <label className="flabel" htmlFor="mp2">Confirm master password</label>
              <div className={'input' + (mismatch ? ' err' : '')}>
                <input id="mp2" type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" aria-describedby={mismatch ? 'mp2e' : undefined} />
                {pw2 && !mismatch && <Icon name="check" size="sm" className="ok-t" label="Passwords match" />}
              </div>
              {mismatch && <span id="mp2e" className="hint err">The passwords do not match.</span>}
            </div>
            <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />Flint keeps the vault key in {keychain} so this machine opens the vault without asking.</span>
            {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
          </div>
          <div className="modal-f">
            <button type="button" className="btn btn-ghost" onClick={back}>Back<Key>esc</Key></button>
            <span className="grow" />
            <button type="submit" className="btn btn-primary" disabled={!ready}>{busy ? 'Creating…' : 'Create vault'}<span className="kbd-in">↵</span></button>
          </div>
        </form>
      </main>
    </>
  );
}
