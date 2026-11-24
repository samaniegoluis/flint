// New host, step 1 (design 21a1): what kind of host it is. The type is fixed once the
// host is added. ← → move, 1 / 2 pick, ↵ continues to the editor for that type.

import { useState } from 'react';
import type { HostType } from '../api/types';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { t } from '../i18n';
import { tr } from '../i18n/react';

const CARDS: { type: HostType; title: string; desc: string; extra: string }[] = [
  { type: 'ssh', title: 'host_type_step.ssh', desc: 'host_type_step.ssh_desc', extra: 'host_type_step.ssh_extra' },
  { type: 'rdp', title: 'host_type_step.rdp', desc: 'host_type_step.rdp_desc', extra: 'host_type_step.rdp_extra' },
];

export function HostTypeStep({ group, onPick, onClose }: { group: string; onPick: (t: HostType) => void; onClose: () => void }) {
  const [type, setType] = useState<HostType>('ssh');
  const onKey = (e: React.KeyboardEvent) => {
    // ↵ on Cancel or the close button is theirs.
    if ((e.target as HTMLElement).closest('.btn-ghost, .icon-btn')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setType((t) => (t === 'ssh' ? 'rdp' : 'ssh')); }
    else if (e.key === '1') { e.preventDefault(); setType('ssh'); }
    else if (e.key === '2') { e.preventDefault(); setType('rdp'); }
    else if (e.key === 'Enter') { e.preventDefault(); onPick(type); }
  };
  return (
    <Modal label={t('host_type_step.new_host_choose_its_type')} onClose={onClose} width={700} top={120}>
      <div onKeyDown={onKey} data-host-type-step style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="modal-h">
          <h2 className="grow">{t('host_type_step.new_host')}{' '}{group && <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{tr('host_type_step.in_p', { p: group.split('/').join(' / ') })}</span>}</h2>
          <span className="hint">{t('host_type_step.step_1_of_2')}</span>
          <button type="button" className="icon-btn" aria-label={t('host_type_step.close_esc')} onClick={onClose}><Icon name="x" size="sm" /></button>
        </div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)', padding: 'var(--sp-5)' }}>
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('host_type_step.what_kind_of_host_is')}</span>
          <div className="type-cards" role="radiogroup" aria-label={t('host_type_step.host_type')}>
            {CARDS.map((c, i) => (
              <button key={c.type} type="button" className="type-card" role="radio" aria-checked={type === c.type} data-type={c.type}
                data-autofocus={type === c.type || undefined} autoFocus={type === c.type}
                onClick={() => setType(c.type)} onDoubleClick={() => onPick(c.type)}>
                <span className="kbd tc-k">{i + 1}</span>
                <span className="tc-ic"><Icon name={c.type} /></span>
                <span className="col" style={{ gap: 4 }}><span className="tc-t">{t(c.title)}</span><span className="tc-d">{t(c.desc)}</span></span>
                <span className="tc-x">{t(c.extra)}</span>
              </button>
            ))}
          </div>
          <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />{t('host_type_step.the_type_can_t_be')}</span>
        </div>
        <div className="modal-f">
          <span className="row faint" style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-xs)' }}>
            <span className="row" style={{ gap: 4 }}><Key>←</Key><Key>→</Key>{t('host_type_step.choose')}</span>
            <span className="row" style={{ gap: 4 }}><Key>1</Key><Key>2</Key>{t('host_type_step.pick')}</span>
          </span>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}<Key>esc</Key></button>
          <button type="button" className="btn btn-primary" onClick={() => onPick(type)}>{t('common.continue')}<span className="kbd-in">↵</span></button>
        </div>
      </div>
    </Modal>
  );
}
