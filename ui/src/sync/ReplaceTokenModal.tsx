// Settings → Vault → Replace token (ROADMAP, brief 23b4): a new token after the
// server's was rotated. The core tries it against the server before the old one
// leaves the keychain; a refused one is an inline error and changes nothing.

import { useState } from 'react';
import { api, toFlintError } from '../api/backend';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { TokenField } from './TokenField';

export function ReplaceTokenModal({ url, onClose, onReplaced }: { url: string; onClose: () => void; onReplaced: () => void }) {
  const { notify } = useApp();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.remoteToken(token);
      setToken('');
      notify('Token replaced. It is kept in the keychain.');
      onReplaced();
      onClose();
    } catch (err) {
      const fe = toFlintError(err);
      setError(fe.code === 'auth' ? 'The server refused this token. The old one is kept.' : fe.message);
      setBusy(false);
    }
  };

  return (
    <Modal label="Replace token" onClose={busy ? () => {} : onClose} width={520} scrimCloses={!busy}>
      <form aria-label="Replace token" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="modal-h"><Icon name="key" size="sm" /><h2 className="grow">Replace token</h2>
          <button type="button" className="icon-btn" aria-label="Close (esc)" onClick={onClose} disabled={busy}><Icon name="x" size="sm" /></button></div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>The new token for <span className="mono">{url}</span>, after the server's token was rotated. Flint checks it with the server before the old one is dropped.</span>
          <TokenField id="rtk" value={token} onChange={setToken} error={error} disabled={busy} autoFocus />
        </div>
        <div className="modal-f">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!token.trim() || busy}>{busy ? 'Checking…' : 'Replace'}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </Modal>
  );
}
