// What's new (milestone 52, designs 24g1, 24g2, 24j4): the versions since the one the
// person last ran, newest first (a long list scrolls inside the modal), or this
// version's notes when asked for. Read from the CHANGELOG.md the package carries.

import { api } from '../api/backend';
import type { ChangeVersion } from '../api/types';
import { useApp } from '../state/app';
import { CHANGELOG_URL, longDate } from '../lib/update';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { t } from '../i18n';

export function WhatsNewModal({ versions, current, since, onClose }: { versions: ChangeVersion[]; current: string; since?: string; onClose: () => void }) {
  const { fail } = useApp();
  const top = versions[0];
  const title = top ? `Flint ${top.version}` : `Flint ${current}`;
  const sub = top ? [longDate(top.date), since ? t('whats_new_modal.since_your', { since }) : ''].filter(Boolean).join(' · ') : '';
  return (
    <Modal label={t('whats_new_modal.what_s_new_in_title', { title })} onClose={onClose} width={700} top={96} className="wn">
      <div className="modal-h" style={{ alignItems: 'flex-start' }}>
        <span className="prompt-ic accent" style={{ width: 36, height: 36 }}><Icon name="sparkle" /></span>
        <div className="col grow" style={{ gap: 2 }}>
          <h2 style={{ fontSize: 'var(--fs-xl)' }}>{title}</h2>
          {sub && <span className="hint">{sub}</span>}
        </div>
        <button className="icon-btn" aria-label={t('whats_new_modal.close_esc')} onClick={onClose}><Icon name="x" size="sm" /></button>
      </div>
      <div className="modal-b wn-body scroll" data-whats-new={versions.map((v) => v.version).join(',')}>
        {versions.length === 0 && <p className="muted">{t('whats_new_modal.this_build_has_no_notes')}</p>}
        {versions.map((v, i) => (
          <section key={v.version} className="wn-sec">
            {i > 0 && <h3 className="wn-v">Flint {v.version}<span className="hint"> · {longDate(v.date)}</span></h3>}
            {v.summary && <p className="wn-sum">{v.summary}</p>}
            {v.groups.map((g) => (
              <div key={g.title} className="col" style={{ gap: 'var(--sp-2)' }}>
                <span className="label">{g.title}</span>
                <ul className="wn-list">
                  {g.items.map((it, j) => <li key={j}>{it.scope && <strong>{it.scope}: </strong>}{it.text}</li>)}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="modal-f">
        <button className="link row" style={{ fontSize: 'var(--fs-sm)', gap: 6 }} onClick={() => api.openUrl(CHANGELOG_URL).catch(fail)}>{t('whats_new_modal.full_changelog')}</button>
        <span className="grow" />
        <button className="btn btn-primary" data-autofocus onClick={onClose}>{t('common.close')}<span className="kbd">esc</span></button>
      </div>
    </Modal>
  );
}
