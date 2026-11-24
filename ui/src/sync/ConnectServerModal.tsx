// Settings → Vault → Connect to a server (design 23b2): the open vault goes to a
// server, or is merged with the copy it already holds. Its master password is typed
// again, and must be Strong (D-095): a vault on someone's disk needs more than one
// on this machine alone.

import { useEffect, useRef, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import type { PasswordStrength, SyncOutcome } from '../api/types';
import { useApp } from '../state/app';
import { mergeSummary, hasChanges } from '../lib/sync';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { serverErrorField, TokenField } from './TokenField';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

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

export function ConnectServerModal({ onClose, onChangePassword, onConnected }: {
  onClose: () => void;
  onChangePassword: () => void;
  onConnected: (got: SyncOutcome) => void;
}) {
  const { vault } = useApp();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [pw, setPw] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ url?: string; token?: string; label?: string; pw?: string; form?: string }>({});
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const [done, setDone] = useState<SyncOutcome | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!pw) { setStrength(null); return; }
    const n = ++seq.current;
    const t = window.setTimeout(() => {
      api.passwordStrength(pw).then((s) => { if (n === seq.current) setStrength(s); }).catch(() => {});
    }, ESTIMATE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [pw]);

  const weak = !!strength && !strength.sync_ok;
  const ready = url.trim() && token.trim() && pw && strength?.sync_ok && !busy;
  const name = vault?.name ?? t('connect_server_modal.the_vault');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setErrors({});
    try {
      const got = await api.remoteConnect(url.trim(), token, pw, label.trim());
      setToken('');
      setPw('');
      setDone(got);
      onConnected(got);
    } catch (err) {
      const fe = toFlintError(err);
      if (fe.code === 'wrong_password') setErrors({ pw: t('connect_server_modal.wrong_password_of', { name }) });
      else if (fe.code === 'invalid' && /label/.test(fe.message)) setErrors({ label: fe.message });
      else {
        const field = serverErrorField(fe.code);
        setErrors({ [field === 'form' ? 'form' : field]: fe.message });
      }
      setBusy(false);
    }
  };

  if (done) {
    const merged = done.result === 'merged';
    return (
      <Modal label={t('connect_server_modal.connected_to_a_server')} onClose={onClose} width={520}>
        <div className="modal-h"><Icon name="check" size="sm" className="ok-t" /><h2 className="grow">{merged ? t('connect_server_modal.merged_with_the_server_s') : t('connect_server_modal.uploaded')}</h2></div>
        <div className="modal-b" style={{ gap: 'var(--sp-3)' }} data-connect-outcome={done.result}>
          <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>
            {merged
              ? (hasChanges(done.report) ? t('connect_server_modal.merged_changes', { name, summary: mergeSummary(done.report) }) : t('connect_server_modal.merged_nothing', { name }))
              : <>{tr('connect_server_modal.name_is_on_span_now', { name, span: <span className="mono">{done.url}</span> })}</>}
          </span>
          <span className="hint">{t('connect_server_modal.flint_keeps_it_in_step')}</span>
        </div>
        <div className="modal-f"><span className="grow" /><button className="btn btn-primary" onClick={onClose} autoFocus>{t('common.done')}<Key>esc</Key></button></div>
      </Modal>
    );
  }

  return (
    <Modal label={t('connect_server_modal.connect_name_to_a_server', { name })} onClose={busy ? () => {} : onClose} width={560} scrimCloses={!busy}>
      <form aria-label={t('connect_server_modal.connect_to_a_server')} onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="modal-h"><Icon name="server" size="sm" /><h2 className="grow">{t('connect_server_modal.connect_name_to_a_server', { name })}</h2>
          <button type="button" className="icon-btn" aria-label={t('connect_server_modal.close_esc')} onClick={onClose} disabled={busy}><Icon name="x" size="sm" /></button></div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)' }}>
          <ServerAddress id="csa" value={url} onChange={setUrl} error={errors.url} disabled={busy} autoFocus />
          <TokenField id="cst" value={token} onChange={setToken} error={errors.token} disabled={busy} />
          <div className="field">
            <label className="flabel" htmlFor="csl">{tr('connect_server_modal.label_span', { span: <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{t('connect_server_modal.optional')}</span> })}</label>
            <div className={'input' + (errors.label ? ' err' : '')}>
              <input {...plainText} id="csl" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={64} placeholder={t('connect_server_modal.e_g_work')} autoComplete="off" disabled={busy} />
            </div>
            {errors.label
              ? <span className="hint err" role="alert">{errors.label}</span>
              : <span className="hint">{t('connect_server_modal.tells_this_vault_apart_on')}</span>}
          </div>
          <div className="field">
            <label className="flabel" htmlFor="cmp">{t('connect_server_modal.master_password_of_name_again', { name })}</label>
            <div className={'input' + (errors.pw ? ' err' : '')}>
              <input {...plainText} id="cmp" type="password" className="pw" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" disabled={busy} />
            </div>
            <div className="row" style={{ gap: 'var(--sp-3)' }}>
              <div className={'meter grow ' + meterClass(strength)} role="meter" aria-label={t('connect_server_modal.password_strength')} aria-valuenow={strength?.score ?? 0} aria-valuemin={0} aria-valuemax={4}>
                {[1, 2, 3, 4].map((i) => <i key={i} className={strength && i <= strength.score ? 'on' : ''} />)}
              </div>
              <span className={labelClass(strength)} style={{ fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-medium)' }}>{pw ? (strength?.label ?? '') : ''}</span>
            </div>
            {errors.pw
              ? <span className="hint err" role="alert">{errors.pw}</span>
              : weak
                ? <span className="hint warn-t" data-testid="sync-weak">{tr('connect_server_modal.a_vault_on_a_server', { button: <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }} onClick={onChangePassword}>{t('connect_server_modal.change_master_password')}</button> })}</span>
                : null}
          </div>
          {errors.form && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{errors.form}</span>}
        </div>
        <div className="modal-f">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!ready}>{busy ? t('connect_server_modal.connecting') : t('common.connect')}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </Modal>
  );
}

export function ServerAddress({ id, value, onChange, error, disabled, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; error?: string; disabled?: boolean; autoFocus?: boolean;
}) {
  return (
    <div className="field">
      <label className="flabel" htmlFor={id}>{t('connect_server_modal.server_address')}</label>
      <div className={'input' + (error ? ' err' : '')}>
        <Icon name="server" size="sm" className="faint" />
        <input {...plainText} id={id} className="mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://vault.example.com"
          autoComplete="off" disabled={disabled} autoFocus={autoFocus} data-autofocus={autoFocus || undefined} aria-describedby={error ? id + '-e' : undefined} />
      </div>
      {error && <span id={id + '-e'} className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
    </div>
  );
}
