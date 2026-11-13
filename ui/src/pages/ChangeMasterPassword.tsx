// Settings → Vault → Change master password (milestone 40, D-095). The current
// password, the new one twice, and the core's strength estimate as it is typed (a
// zxcvbn score; the page never estimates on its own). Any password of 8 or more is
// taken; under Strong the dialog says a remote vault will need more.

import { useEffect, useRef, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import type { PasswordStrength } from '../api/types';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';

const MIN_LEN = 8;
const ESTIMATE_DELAY_MS = 120;

function meterClass(s: PasswordStrength | null): string {
  if (!s) return '';
  if (s.score <= 1) return 'weak';
  if (s.score === 2) return 'fair';
  return '';
}

function labelClass(s: PasswordStrength | null): string {
  if (!s) return 'faint';
  if (s.score <= 1) return 'danger-t';
  if (s.score === 2) return 'warn-t';
  return 'ok-t';
}

export function ChangeMasterPassword({ onClose }: { onClose: () => void }) {
  const { vault, notify } = useApp();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const seq = useRef(0);

  // The estimate follows the typing, a moment after it stops; a late answer for an
  // older value is dropped.
  useEffect(() => {
    if (!pw) { setStrength(null); return; }
    const n = ++seq.current;
    const t = window.setTimeout(() => {
      api.passwordStrength(pw).then((s) => { if (n === seq.current) setStrength(s); }).catch(() => {});
    }, ESTIMATE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [pw]);

  const mismatch = pw2.length > 0 && pw !== pw2;
  const short = pw.length > 0 && pw.length < MIN_LEN;
  const ready = current.length > 0 && pw.length >= MIN_LEN && pw === pw2 && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.passwd(current, pw);
      notify(r.remembered ? 'Master password changed. This computer still remembers the vault.' : 'Master password changed');
      onClose();
    } catch (err) {
      const fe = toFlintError(err);
      setError(fe.code === 'wrong_password' ? 'The current master password is wrong.' : fe.message);
      setBusy(false);
    }
  };

  const type = show ? 'text' : 'password';
  return (
    <Modal label="Change master password" onClose={busy ? () => {} : onClose} width={520} scrimCloses={!busy}>
      <form aria-label="Change master password" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="modal-h"><h2 className="grow">Change master password</h2>
          <button type="button" className="icon-btn" aria-label="Close (esc)" onClick={onClose} disabled={busy}><Icon name="x" size="sm" /></button></div>
        <div className="modal-b" style={{ gap: 'var(--sp-5)' }}>
          <div className="field">
            <label className="flabel" htmlFor="cmp-current">Current master password</label>
            <div className="input">
              <input id="cmp-current" type={type} className={show ? '' : 'pw'} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus data-autofocus disabled={busy} />
              <button type="button" className="icon-btn" aria-label={show ? 'Hide passwords' : 'Show passwords'} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
            </div>
          </div>
          <div className="field">
            <label className="flabel" htmlFor="cmp-new">New master password</label>
            <div className={'input' + (short ? ' err' : '')}>
              <input id="cmp-new" type={type} className={show ? '' : 'pw'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" disabled={busy} />
            </div>
            <div className="row" style={{ gap: 'var(--sp-3)' }}>
              <div className={'meter grow ' + meterClass(strength)} role="meter" aria-label="Password strength" aria-valuenow={strength?.score ?? 0} aria-valuemin={0} aria-valuemax={4}>
                {[1, 2, 3, 4].map((i) => <i key={i} className={strength && i <= strength.score ? 'on' : ''} />)}
              </div>
              <span className={labelClass(strength)} data-testid="strength-label" style={{ fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-medium)' }}>{pw ? (strength?.label ?? '') : ''}</span>
            </div>
            {short
              ? <span className="hint err">At least {MIN_LEN} characters.</span>
              : strength && !strength.sync_ok
                ? <span className="hint" data-testid="strength-advice">{strength.warning ? strength.warning + '. ' : ''}{strength.suggestions[0] ?? ''} A remote vault will need Strong or better.</span>
                : <span className="hint">Four random words work well. A forgotten master password cannot be recovered.</span>}
          </div>
          <div className="field">
            <label className="flabel" htmlFor="cmp-new2">Confirm new master password</label>
            <div className={'input' + (mismatch ? ' err' : '')}>
              <input id="cmp-new2" type={type} className={show ? '' : 'pw'} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" disabled={busy} aria-describedby={mismatch ? 'cmp-e' : undefined} />
              {pw2 && !mismatch && <Icon name="check" size="sm" className="ok-t" label="Passwords match" />}
            </div>
            {mismatch && <span id="cmp-e" className="hint err">The passwords do not match.</span>}
          </div>
          <span className="hint">Saved passwords and keys are sealed again under the new password. {vault?.name ?? 'The vault'} keeps its place in the vault list, and other machines that open it through a synced folder will need the new password.</span>
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel<Key>esc</Key></button>
          <span className="grow" />
          <button type="submit" className="btn btn-primary" disabled={!ready}>{busy ? 'Changing…' : 'Change password'}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </Modal>
  );
}
