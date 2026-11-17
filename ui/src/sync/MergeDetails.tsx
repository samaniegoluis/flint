// A merge brought changes (design 23e2): what changed, grouped by kind, labels only,
// then the notes the merge made in plain words.

import type { MergeReport } from '../api/types';
import { useApp } from '../state/app';
import { groupChanges, kindLabel, noteText } from '../lib/sync';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';

const CHANGE_CLASS: Record<string, string> = { added: 'add', updated: 'upd', removed: 'rem' };

export function MergeDetails({ report, onClose }: { report: MergeReport; onClose: () => void }) {
  const { vault } = useApp();
  const groups = groupChanges(report.changes);
  return (
    <Modal label="Changes from another machine" onClose={onClose} width={520}>
      <div className="modal-h"><Icon name="cloud" size="sm" className="accent-t" /><h2 className="grow">Changes from another machine</h2></div>
      <div className="modal-b" style={{ gap: 'var(--sp-4)' }} data-merge-details>
        <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Merged into {vault?.name ?? 'the vault'}. Labels only; nothing secret is listed.</span>
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
            <span className="label">What the merge did</span>
            {report.notes.map((n, i) => (
              <span key={i} className="row" style={{ gap: 'var(--sp-2)', alignItems: 'flex-start', fontSize: 'var(--fs-sm)', lineHeight: 1.45 }}>
                <Icon name="info" size="xs" className="accent-t" /><span>{noteText(n)}.</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="modal-f"><span className="grow" /><button className="btn btn-primary" onClick={onClose} autoFocus>Close<Key>esc</Key></button></div>
    </Modal>
  );
}
