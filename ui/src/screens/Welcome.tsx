import { useEffect } from 'react';
import { useApp } from '../state/app';
import { Icon, Logo } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { actionFor } from '../lib/keymap';
import { t } from '../i18n';
import { tr } from '../i18n/react';

export function Welcome() {
  const { go, openVaultFile, info, os, bootError, fail } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionFor(e, os);
      if (a === 'createVault') { e.preventDefault(); go('create'); }
      if (a === 'openVault') { e.preventDefault(); openVaultFile().catch(fail); }
      if (a === 'connectRemote') { e.preventDefault(); go('connect'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [os, go, openVaultFile, fail]);

  return (
    <>
      <header className="titlebar" style={{ background: 'var(--surface-base)', borderBottomColor: 'transparent' }}>
        <div className="tb-brand"><Logo />Flint</div>
      </header>
      <main style={{ position: 'absolute', inset: '38px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 'var(--sp-12)' }}>
        <div className="col" style={{ width: 560, gap: 'var(--sp-8)' }}>
          <div className="col" style={{ gap: 'var(--sp-4)', alignItems: 'center', textAlign: 'center' }}>
            <Logo size={56} label="Flint" />
            <h1 style={{ fontSize: 'var(--fs-3xl)', fontWeight: 'var(--fw-semibold)', letterSpacing: '-0.02em' }}>{t('welcome.welcome_to_flint')}</h1>
            <p className="muted" style={{ fontSize: 'var(--fs-lg)', maxWidth: 440 }}>{t('welcome.your_hosts_ssh_keys_and')}</p>
          </div>
          {bootError && <p className="hint err row" role="alert"><Icon name="alert" size="xs" />{bootError}</p>}
          <div className="col" style={{ gap: 'var(--sp-3)' }}>
            <button className="panel row" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-4)', borderColor: 'var(--accent-border)' }} onClick={() => go('create')} data-autofocus autoFocus>
              <span className="prompt-ic accent" style={{ width: 40, height: 40 }}><Icon name="plus" size="lg" /></span>
              <span className="col grow" style={{ gap: 2 }}>
                <span className="strong" style={{ fontSize: 'var(--fs-md)' }}>{t('welcome.create_a_new_vault')}</span>
                <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('welcome.pick_a_name_a_folder')}</span>
              </span>
              <Kbd action="createVault" />
            </button>
            <button className="panel row" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-4)' }} onClick={() => openVaultFile().catch(fail)}>
              <span className="prompt-ic" style={{ width: 40, height: 40 }}><Icon name="folder" size="lg" /></span>
              <span className="col grow" style={{ gap: 2 }}>
                <span className="strong" style={{ fontSize: 'var(--fs-md)' }}>{t('welcome.open_a_vault_file')}</span>
                <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{tr('welcome.choose_existing', { ext: <span className="mono">.flint</span> })}</span>
              </span>
              <Kbd action="openVault" />
            </button>
            <button className="panel row" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-4)' }} data-connect-remote onClick={() => go('connect')}>
              <span className="prompt-ic" style={{ width: 40, height: 40 }}><Icon name="server" size="lg" /></span>
              <span className="col grow" style={{ gap: 2 }}>
                <span className="strong" style={{ fontSize: 'var(--fs-md)' }}>{t('welcome.connect_to_a_remote_vault')}</span>
                <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('welcome.download_a_vault_kept_on')}</span>
              </span>
              <Kbd action="connectRemote" />
            </button>
          </div>
          <p className="row faint" style={{ justifyContent: 'center', fontSize: 'var(--fs-sm)', gap: 'var(--sp-2)' }}>
            <Icon name="cloud" size="sm" />{t('welcome.to_use_a_vault_on')}
          </p>
        </div>
      </main>
      <footer className="row faint" style={{ position: 'absolute', left: 0, right: 0, bottom: 'var(--sp-5)', justifyContent: 'center', gap: 'var(--sp-5)', fontSize: 'var(--fs-xs)' }}>
        <span className="mono">Flint {info?.version ?? ''}</span>
        <span>{t('welcome.cli')}{' '}<span className="mono muted">flint vault create</span></span>
      </footer>
    </>
  );
}
