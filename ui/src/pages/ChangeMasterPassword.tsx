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
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

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
      notify(r.remembered ? t('change_master_password.master_password_changed_this_computer') : t('change_master_password.master_password_changed'));
      onClose();
    } catch (err) {
      const fe = toFlintError(err);
      setError(fe.code === 'wrong_password' ? 'The current master password is wrong.' : fe.message);
      setBusy(false);
    }
  };

  const type = show ? 'text' : 'password';
  return (
    <Modal label={t('change_master_password.change_master_password')} onClose={busy ? () => {} : onClose} width={520} scrimCloses={!busy}>
      <form aria-label={t('change_master_password.change_master_password')} onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="modal-h"><h2 className="grow">{t('change_master_password.change_master_password')}</h2>
          <button type="button" className="icon-btn" aria-label={t('change_master_password.close_esc')} onClick={onClose} disabled={busy}><Icon name="x" size="sm" /></button></div>
        <div className="modal-b" style={{ gap: 'var(--sp-5)' }}>
          <div className="field">
            <label className="flabel" htmlFor="cmp-current">{t('change_master_password.current_master_password')}</label>
            <div className="input">
              <input {...plainText} id="cmp-current" type={type} className={show ? '' : 'pw'} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus data-autofocus disabled={busy} />
              <button type="button" className="icon-btn" aria-label={show ? t('change_master_password.hide_passwords') : t('change_master_password.show_passwords')} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
            </div>
          </div>
          <div className="field">
            <label className="flabel" htmlFor="cmp-new">{t('change_master_password.new_master_password')}</label>
            <div className={'input' + (short ? ' err' : '')}>
              <input {...plainText} id="cmp-new" type={type} className={show ? '' : 'pw'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" disabled={busy} />
            </div>
            <div className="row" style={{ gap: 'var(--sp-3)' }}>
              <div className={'meter grow ' + meterClass(strength)} role="meter" aria-label={t('change_master_password.password_strength')} aria-valuenow={strength?.score ?? 0} aria-valuemin={0} aria-valuemax={4}>
                {[1, 2, 3, 4].map((i) => <i key={i} className={strength && i <= strength.score ? 'on' : ''} />)}
              </div>
              <span className={labelClass(strength)} data-testid="strength-label" style={{ fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-medium)' }}>{pw ? (strength?.label ?? '') : ''}</span>
            </div>
            {short
              ? <span className="hint err">{tr('change_master_password.at_least_min_len_characters', { MIN_LEN })}</span>
              : strength && !strength.sync_ok
                ? <span className="hint" data-testid="strength-advice">{strength.warning ? strength.warning + '. ' : ''}{strength.suggestions[0] ?? ''}{' '}{t('change_master_password.a_remote_vault_will_need')}</span>
                : <span className="hint">{t('change_master_password.four_random_words_work_well')}</span>}
          </div>
          <div className="field">
            <label className="flabel" htmlFor="cmp-new2">{t('change_master_password.confirm_new_master_password')}</label>
            <div className={'input' + (mismatch ? ' err' : '')}>
              <input {...plainText} id="cmp-new2" type={type} className={show ? '' : 'pw'} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" disabled={busy} aria-describedby={mismatch ? 'cmp-e' : undefined} />
              {pw2 && !mismatch && <Icon name="check" size="sm" className="ok-t" label={t('change_master_password.passwords_match')} />}
            </div>
            {mismatch && <span id="cmp-e" className="hint err">{t('change_master_password.the_passwords_do_not_match')}</span>}
          </div>
          <span className="hint">{vault?.name ? t('change_master_password.keeps_place_named', { name: vault.name }) : t('change_master_password.keeps_place')}</span>
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}<Key>esc</Key></button>
          <span className="grow" />
          <button type="submit" className="btn btn-primary" disabled={!ready}>{busy ? t('change_master_password.changing') : t('change_master_password.change_password')}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </Modal>
  );
}
