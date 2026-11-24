// Connect to a remote vault, from Welcome (milestone 44, design 23a): the server
// first (its address and token, checked against it: 23a1-23a2), then the vault it
// keeps, which it cannot read, so only its size, version and the label it was given
// (23a3); a server keeping several lists them to pick one (milestone 45, D-103).
// Then its master password, where to keep the local copy, and Remember. Downloading
// opens it straight into the main window (23a4).

import { useEffect, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import type { RemoteProbe, ServerVault } from '../api/types';
import { useApp } from '../state/app';
import { agoLabel, copyName, sizeLabel, urlHost } from '../lib/sync';
import { Icon, Logo } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { RememberOption } from '../ui/RememberOption';
import { ServerAddress } from '../sync/ConnectServerModal';
import { serverErrorField, TokenField } from '../sync/TokenField';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

type Errors = { url?: string; token?: string; pw?: string; path?: string; form?: string };

function VaultFacts({ v, now }: { v: ServerVault; now: number }) {
  return <>{tr('connect_remote.sizelabel_version_p_updated_agolabel', { sizeLabel: sizeLabel(v.size), p: v.version.toLocaleString('en-US'), agoLabel: agoLabel(v.updated_at, now) })}</>;
}

export function ConnectRemote() {
  const { go, download, vault, target, os } = useApp();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [found, setFound] = useState<RemoteProbe | null>(null);
  const [chosen, setChosen] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [path, setPath] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const back = () => {
    if (found && !busy) { setFound(null); setChosen(''); setPw(''); setErrors({}); return; }
    go(vault ? 'main' : target ? 'unlock' : 'welcome');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !busy) back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const check = async () => {
    setBusy(true);
    setErrors({});
    try {
      const p = await api.remoteProbe(url.trim(), token);
      if (p.vaults.length === 0) {
        setErrors({ form: 'empty' });
      } else {
        setFound(p);
        setChosen(p.vaults.length === 1 ? p.vaults[0].id : '');
        setUrl(p.url);
      }
    } catch (err) {
      const fe = toFlintError(err);
      const field = serverErrorField(fe.code);
      setErrors({ [field]: fe.code === 'invalid' && /did not answer/.test(fe.message) ? t('connect_remote.not_a_vault_server') : fe.message });
    }
    setBusy(false);
  };

  const choose = async () => {
    const { path: p } = await api.dialogSave(t('connect_remote.keep_the_local_copy_in'), copyName(found?.vaults.find((v) => v.id === chosen)));
    if (p) setPath(p.endsWith('.flint') ? p : p + '.flint');
  };

  const fetchVault = async () => {
    setBusy(true);
    setErrors({});
    try {
      await download(url, token, chosen, pw, path, remember);
      setToken('');
      setPw('');
    } catch (err) {
      const fe = toFlintError(err);
      if (fe.code === 'wrong_password') setErrors({ pw: t('connect_remote.wrong_server_password') });
      else if (fe.code === 'exists') setErrors({ path: t('connect_remote.file_exists') });
      else if (fe.code === 'invalid' && /Strong/.test(fe.message)) setErrors({ pw: fe.message.replace(/ Change it first with `flint vault passwd`$/, ' ' + t('connect_remote.change_it_elsewhere_first')) });
      else setErrors({ form: fe.message });
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!found) { if (url.trim() && token.trim()) check().catch(() => {}); return; }
    if (chosen && pw && path) fetchVault().catch(() => {});
  };

  const step2 = !!found;
  const ready = step2 ? !!chosen && !!pw && !!path && !busy : !!url.trim() && !!token.trim() && !busy;
  const now = Date.now();
  const only = found && found.vaults.length === 1 ? found.vaults[0] : null;
  return (
    <>
      <header className="titlebar" style={{ background: 'var(--surface-base)', borderBottomColor: 'transparent' }}>
        <div className="tb-brand"><Logo />Flint</div>
        <div className="tb-title">{t('connect_remote.remote_vault')}</div>
      </header>
      <main style={{ position: 'absolute', inset: '38px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form className="card" aria-label={t('connect_remote.connect_to_a_remote_vault')} style={{ width: 520, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-1)' }} onSubmit={submit}>
          <div className="modal-h"><Icon name="server" size="sm" /><h2 className="grow">{t('connect_remote.connect_to_a_remote_vault')}</h2>
            <div className="steps"><span className={step2 ? '' : 'on'}>{t('connect_remote.1_server')}</span><i /><span className={step2 ? 'on' : ''}>{t('connect_remote.2_vault')}</span></div></div>
          {!step2 ? (
            <div className="modal-b" style={{ gap: 'var(--sp-5)' }} data-connect-step="server">
              <ServerAddress id="sa" value={url} onChange={setUrl} error={errors.url} disabled={busy} autoFocus />
              <TokenField id="st" value={token} onChange={setToken} error={errors.token} disabled={busy} />
              {errors.form === 'empty' && (
                <div className="callout info row" role="status" style={{ gap: 'var(--sp-2)', alignItems: 'flex-start' }} data-server-empty>
                  <Icon name="info" size="sm" className="accent-t" />
                  <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.45 }}>{t('connect_remote.this_server_is_empty_connect')}</span>
                </div>
              )}
              {errors.form && errors.form !== 'empty' && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{errors.form}</span>}
              <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />{tr('connect_remote.no_server_yet', { page: <span className="strong">{t('connect_remote.self_host_a_remote_vault')}</span> })}</span>
            </div>
          ) : (
            <div className="modal-b" style={{ gap: 'var(--sp-5)' }} data-connect-step="vault">
              {only ? (
                <div className="found" data-server-vault={only.id}>
                  <Icon name="lock" size="lg" className="accent-t" />
                  <div className="col grow" style={{ gap: 2 }}>
                    <span className="strong">{only.label ? <>{tr('connect_remote.a_vault_was_found_label', { label: only.label })}</> : t('connect_remote.a_vault_was_found')}</span>
                    <span className="hint">{tr('connect_remote.vaultfacts_on_span_its_name', { vaultfacts: <VaultFacts v={only} now={now} />, span: <span className="mono">{urlHost(found.url)}</span> })}</span>
                  </div>
                  <span className="badge ok"><Icon name="shield" size="xs" />{t('connect_remote.encrypted')}</span>
                </div>
              ) : (
                <div className="field" data-server-vaults={found.vaults.length}>
                  <span className="flabel">{tr('connect_remote.this_server_keeps_length_vaults', { length: found.vaults.length })}</span>
                  <div className="opt-list" role="radiogroup" aria-label={t('connect_remote.vaults_on_the_server')} style={{ maxHeight: 210, overflowY: 'auto' }}>
                    {found.vaults.map((v) => (
                      <label key={v.id} className="opt" data-server-vault={v.id}>
                        <input type="radio" name="server-vault" checked={chosen === v.id} onChange={() => setChosen(v.id)} disabled={busy} />
                        <span className="opt-t">
                          <span className="opt-l">{v.label || <span className="muted">{t('connect_remote.no_label')}</span>} <span className="mono faint" title={v.id}>{v.id.slice(0, 8)}</span></span>
                          <span className="hint"><VaultFacts v={v} now={now} /></span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <span className="hint row" style={{ gap: 6 }}><Icon name="shield" size="xs" />{t('connect_remote.each_is_encrypted_the_server')}</span>
                </div>
              )}
              <div className="field">
                <label className="flabel" htmlFor="vp">{t('connect_remote.master_password_of_that_vault')}</label>
                <div className={'input' + (errors.pw ? ' err' : '')}>
                  <input {...plainText} id="vp" type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus={!!only} disabled={busy} />
                  <button type="button" className="icon-btn" aria-label={show ? t('connect_remote.hide_password') : t('connect_remote.show_password')} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
                </div>
                {errors.pw && <span className="hint err" role="alert">{errors.pw}</span>}
              </div>
              <div className="field">
                <span className="flabel">{t('connect_remote.keep_the_local_copy_in')}</span>
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  <div className={'input grow' + (errors.path ? ' err' : '')}><Icon name="folder" size="sm" className="faint" />
                    <input {...plainText} className="mono" aria-label={t('connect_remote.local_copy_path')} value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('connect_remote.choose_where_to_keep_it')} style={{ fontSize: 'var(--fs-sm)' }} disabled={busy} /></div>
                  <button type="button" className="btn btn-secondary" style={{ height: 'var(--control-h)' }} onClick={() => choose().catch(() => {})} disabled={busy}>{t('connect_remote.choose')}</button>
                </div>
                {errors.path
                  ? <span className="hint err" role="alert">{errors.path}</span>
                  : <span className="hint">{t('connect_remote.every_machine_keeps_its_own')}</span>}
              </div>
              <RememberOption checked={remember} onChange={setRemember} os={os} disabled={busy} />
              {busy && <span className="hint row" role="status" style={{ gap: 6 }} data-downloading><Icon name="download" size="xs" />{t('connect_remote.downloading_and_opening_the_vault')}</span>}
              {errors.form && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{errors.form}</span>}
            </div>
          )}
          <div className="modal-f">
            <button type="button" className="btn btn-ghost" onClick={back} disabled={busy}>{t('common.back')}<Key>esc</Key></button>
            <span className="grow" />
            <button type="submit" className="btn btn-primary" disabled={!ready}>
              {step2 ? (busy ? t('connect_remote.downloading') : t('connect_remote.download_and_open')) : (busy ? t('connect_remote.checking') : t('common.continue'))}<span className="kbd-in">↵</span>
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
