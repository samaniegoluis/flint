import { useEffect, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import { useApp } from '../state/app';
import { Icon, Logo } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { passwordStrength } from '../lib/strength';
import { RememberOption } from '../ui/RememberOption';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

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
  const [remember, setRemember] = useState(false);

  const strength = passwordStrength(pw);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const ready = name.trim() && path && pw.length >= MIN_LEN && pw === pw2 && !busy;

  const back = () => go(vault ? 'main' : target ? 'unlock' : 'welcome');

  // Esc goes back wherever focus is: WebKit on macOS does not focus a checkbox on
  // click, so after ticking Remember the focus is on the page, outside the form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const choose = async () => {
    const fileName = (name.trim() || 'vault').toLowerCase().replace(/[^a-z0-9._-]+/g, '-') + '.flint';
    const { path: p } = await api.dialogSave(t('create_vault.dialog_title'), fileName);
    if (p) setPath(p.endsWith('.flint') ? p : p + '.flint');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await create(path, name.trim(), pw, remember);
    } catch (err) {
      setError(toFlintError(err).message);
      setBusy(false);
    }
  };

  return (
    <>
      <header className="titlebar" style={{ background: 'var(--surface-base)', borderBottomColor: 'transparent' }}>
        <div className="tb-brand"><Logo />Flint</div>
        <div className="tb-title">{t('create_vault.new_vault')}</div>
      </header>
      <main style={{ position: 'absolute', inset: '38px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form className="card" aria-label={t('create_vault.create_vault')} style={{ width: 520, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-1)' }} onSubmit={submit}>
          <div className="modal-h"><Logo size={22} /><h2>{t('create_vault.create_a_vault')}</h2></div>
          <div className="modal-b" style={{ gap: 'var(--sp-5)' }}>
            <div className="field">
              <label className="flabel" htmlFor="vn">{t('create_vault.name')}</label>
              <div className="input"><input {...plainText} id="vn" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('create_vault.work')} autoFocus maxLength={64} /></div>
            </div>
            <div className="field">
              <span className="flabel">{t('create_vault.location')}</span>
              <div className="row" style={{ gap: 'var(--sp-2)' }}>
                <div className="input grow"><Icon name="folder" size="sm" className="faint" />
                  <input {...plainText} className="mono" aria-label={t('create_vault.vault_file_path')} value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('create_vault.choose_where_to_save_the')} style={{ fontSize: 'var(--fs-sm)' }} /></div>
                <button type="button" className="btn btn-secondary" style={{ height: 'var(--control-h)' }} onClick={() => choose().catch(() => {})}>{t('create_vault.choose')}</button>
              </div>
              <span className="hint row" style={{ gap: 6 }}><Icon name="cloud" size="xs" />{t('create_vault.put_it_in_a_synced')}</span>
            </div>
            <div className="field">
              <label className="flabel" htmlFor="mp">{t('create_vault.master_password')}</label>
              <div className="input">
                <input {...plainText} id="mp" type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
                <button type="button" className="icon-btn" aria-label={show ? t('create_vault.hide_password') : t('create_vault.show_password')} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
              </div>
              <div className="row" style={{ gap: 'var(--sp-3)' }}>
                <div className={'meter grow ' + strength.meter} role="meter" aria-label={t('create_vault.password_strength')} aria-valuenow={strength.score} aria-valuemin={0} aria-valuemax={4}>
                  {[1, 2, 3, 4].map((i) => <i key={i} className={i <= strength.score ? 'on' : ''} />)}
                </div>
                <span className={strength.textClass} style={{ fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-medium)' }}>{pw ? strength.label : ''}</span>
              </div>
              <span className="hint">{tr('create_vault.at_least_min_len_characters', { MIN_LEN })}</span>
            </div>
            <div className="field">
              <label className="flabel" htmlFor="mp2">{t('create_vault.confirm_master_password')}</label>
              <div className={'input' + (mismatch ? ' err' : '')}>
                <input {...plainText} id="mp2" type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" aria-describedby={mismatch ? 'mp2e' : undefined} />
                {pw2 && !mismatch && <Icon name="check" size="sm" className="ok-t" label={t('create_vault.passwords_match')} />}
              </div>
              {mismatch && <span id="mp2e" className="hint err">{t('create_vault.the_passwords_do_not_match')}</span>}
            </div>
            <RememberOption checked={remember} onChange={setRemember} os={os} disabled={busy} />
            {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
          </div>
          <div className="modal-f">
            <button type="button" className="btn btn-ghost" onClick={back}>{t('common.back')}<Key>esc</Key></button>
            <span className="grow" />
            <button type="submit" className="btn btn-primary" disabled={!ready}>{busy ? t('create_vault.creating') : t('create_vault.create_vault')}<span className="kbd-in">↵</span></button>
          </div>
        </form>
      </main>
    </>
  );
}
