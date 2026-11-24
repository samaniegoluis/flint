// The master password was changed on another machine (design 23f): calm, not an
// error. The new one syncs, and this machine's vault opens with it from then on.

import { useState } from 'react';
import { api, toFlintError } from '../api/backend';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

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
      notify(t('new_password_modal.vaultname_now_opens_with_the', { vaultName }));
      onClose();
    } catch (err) {
      const fe = toFlintError(err);
      setError(fe.code === 'wrong_password' ? t('new_password_modal.wrong_new_password') : fe.message);
      setBusy(false);
    }
  };

  return (
    <Modal label={t('new_password_modal.new_master_password')} onClose={busy ? () => {} : onClose} width={480} top={160} scrimCloses={!busy}>
      <form aria-label={t('new_password_modal.new_master_password')} onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="modal-h"><Icon name="key" size="sm" className="warn-t" /><h2 className="grow">{t('new_password_modal.new_master_password')}</h2></div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>{tr('new_password_modal.the_master_password_of_span', { span: <span className="strong">{vaultName}</span> })}</span>
          <div className="field">
            <label className="flabel" htmlFor="nnp">{t('new_password_modal.new_master_password')}</label>
            <div className={'input' + (error ? ' err' : '')}>
              <input {...plainText} id="nnp" type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus data-autofocus disabled={busy} />
              <button type="button" className="icon-btn" aria-label={show ? t('new_password_modal.hide_password') : t('new_password_modal.show_password')} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
            </div>
            {error
              ? <span className="hint err" role="alert">{error}</span>
              : <span className="hint">{t('new_password_modal.from_now_on_this_machine')}</span>}
          </div>
        </div>
        <div className="modal-f">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('new_password_modal.later')}<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!pw || busy}>{busy ? t('new_password_modal.syncing') : t('new_password_modal.sync')}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </Modal>
  );
}
