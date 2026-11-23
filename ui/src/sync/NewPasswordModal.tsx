// The master password was changed on another machine (design 23f): calm, not an
// error. The new one syncs, and this machine's vault opens with it from then on.

import { useState } from 'react';
import { api, toFlintError } from '../api/backend';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { plainText } from '../ui/plainText';

export function NewPasswordModal({ vaultName, onClose }: { vaultName: string; onClose: () => void }) {
  const { notify } = useApp();
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.syncNow(pw);
      notify(`${vaultName} now opens with the new master password`);
      onClose();
    } catch (err) {
      const fe = toFlintError(err);
      setError(fe.code === 'wrong_password' ? 'That is not the new master password.' : fe.message);
      setBusy(false);
    }
  };

  return (
    <Modal label="New master password" onClose={busy ? () => {} : onClose} width={480} top={160} scrimCloses={!busy}>
      <form aria-label="New master password" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="modal-h"><Icon name="key" size="sm" className="warn-t" /><h2 className="grow">New master password</h2></div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>The master password of <span className="strong">{vaultName}</span> was changed on another machine. Type the new one to keep syncing.</span>
          <div className="field">
            <label className="flabel" htmlFor="nnp">New master password</label>
            <div className={'input' + (error ? ' err' : '')}>
              <input {...plainText} id="nnp" type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus data-autofocus disabled={busy} />
              <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
            </div>
            {error
              ? <span className="hint err" role="alert">{error}</span>
              : <span className="hint">From now on this machine's vault opens with the new password too.</span>}
          </div>
        </div>
        <div className="modal-f">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Later<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!pw || busy}>{busy ? 'Syncing…' : 'Sync'}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </Modal>
  );
}
