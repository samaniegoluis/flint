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
import { t } from '../i18n';
import { tr } from '../i18n/react';

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
      notify(t('replace_token_modal.token_replaced_it_is_kept'));
      onReplaced();
      onClose();
    } catch (err) {
      const fe = toFlintError(err);
      setError(fe.code === 'auth' ? t('replace_token_modal.token_refused') : fe.message);
      setBusy(false);
    }
  };

  return (
    <Modal label={t('replace_token_modal.replace_token')} onClose={busy ? () => {} : onClose} width={520} scrimCloses={!busy}>
      <form aria-label={t('replace_token_modal.replace_token')} onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="modal-h"><Icon name="key" size="sm" /><h2 className="grow">{t('replace_token_modal.replace_token')}</h2>
          <button type="button" className="icon-btn" aria-label={t('replace_token_modal.close_esc')} onClick={onClose} disabled={busy}><Icon name="x" size="sm" /></button></div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>{tr('replace_token_modal.the_new_token_for_span', { span: <span className="mono">{url}</span> })}</span>
          <TokenField id="rtk" value={token} onChange={setToken} error={error} disabled={busy} autoFocus />
        </div>
        <div className="modal-f">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!token.trim() || busy}>{busy ? t('replace_token_modal.checking') : t('replace_token_modal.replace')}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </Modal>
  );
}
