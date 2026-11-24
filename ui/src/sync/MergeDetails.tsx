// A merge brought changes (design 23e2): what changed, grouped by kind, labels only,
// then the notes the merge made in plain words.

import type { MergeReport } from '../api/types';
import { useApp } from '../state/app';
import { groupChanges, kindLabel, noteText } from '../lib/sync';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { t } from '../i18n';

const CHANGE_CLASS: Record<string, string> = { added: 'add', updated: 'upd', removed: 'rem' };

export function MergeDetails({ report, onClose }: { report: MergeReport; onClose: () => void }) {
  const { vault } = useApp();
  const groups = groupChanges(report.changes);
  return (
    <Modal label={t('merge_details.changes_from_another_machine')} onClose={onClose} width={520}>
      <div className="modal-h"><Icon name="cloud" size="sm" className="accent-t" /><h2 className="grow">{t('merge_details.changes_from_another_machine')}</h2></div>
      <div className="modal-b" style={{ gap: 'var(--sp-4)' }} data-merge-details>
        <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('merge_details.merged_into_name', { name: vault?.name ?? t('merge_details.the_vault') })}</span>
        {groups.map((g) => (
          <div className="chg-group" key={g.kind}>
            <span className="label">{kindLabel(g.kind, 2).replace(/^./, (c) => c.toUpperCase())}</span>
            {g.items.map((c, i) => (
              <div className="chg" key={i}><span className={'k ' + (CHANGE_CLASS[c.change] ?? '')}>{c.change}</span><span className="mono trunc">{c.name}</span></div>
            ))}
          </div>
        ))}
        {report.notes.length > 0 && (
          <div className="col" style={{ gap: 'var(--sp-2)' }}>
            <span className="label">{t('merge_details.what_the_merge_did')}</span>
            {report.notes.map((n, i) => (
              <span key={i} className="row" style={{ gap: 'var(--sp-2)', alignItems: 'flex-start', fontSize: 'var(--fs-sm)', lineHeight: 1.45 }}>
                <Icon name="info" size="xs" className="accent-t" /><span>{noteText(n)}.</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="modal-f"><span className="grow" /><button className="btn btn-primary" onClick={onClose} autoFocus>{t('common.close')}<Key>esc</Key></button></div>
    </Modal>
  );
}
