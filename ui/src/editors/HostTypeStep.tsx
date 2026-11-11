// New host, step 1 (design 21a1): what kind of host it is. The type is fixed once the
// host is added. ← → move, 1 / 2 pick, ↵ continues to the editor for that type.

import { useState } from 'react';
import type { HostType } from '../api/types';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';

const CARDS: { type: HostType; title: string; desc: string; extra: string }[] = [
  { type: 'ssh', title: 'SSH', desc: 'A terminal on a Linux or Unix server.', extra: 'Files, tunnels and split panes' },
  { type: 'rdp', title: 'Remote desktop (RDP)', desc: 'A Windows desktop in a tab.', extra: 'Windows Server, Windows 10/11 Pro, VMs' },
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
    <Modal label="New host: choose its type" onClose={onClose} width={700} top={120}>
      <div onKeyDown={onKey} data-host-type-step style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="modal-h">
          <h2 className="grow">New host {group && <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· in {group.split('/').join(' / ')}</span>}</h2>
          <span className="hint">Step 1 of 2</span>
          <button type="button" className="icon-btn" aria-label="Close (esc)" onClick={onClose}><Icon name="x" size="sm" /></button>
        </div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)', padding: 'var(--sp-5)' }}>
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>What kind of host is it?</span>
          <div className="type-cards" role="radiogroup" aria-label="Host type">
            {CARDS.map((c, i) => (
              <button key={c.type} type="button" className="type-card" role="radio" aria-checked={type === c.type} data-type={c.type}
                data-autofocus={type === c.type || undefined} autoFocus={type === c.type}
                onClick={() => setType(c.type)} onDoubleClick={() => onPick(c.type)}>
                <span className="kbd tc-k">{i + 1}</span>
                <span className="tc-ic"><Icon name={c.type} /></span>
                <span className="col" style={{ gap: 4 }}><span className="tc-t">{c.title}</span><span className="tc-d">{c.desc}</span></span>
                <span className="tc-x">{c.extra}</span>
              </button>
            ))}
          </div>
          <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />The type can't be changed later. To change it, remove the host and add it again.</span>
        </div>
        <div className="modal-f">
          <span className="row faint" style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-xs)' }}>
            <span className="row" style={{ gap: 4 }}><Key>←</Key><Key>→</Key>choose</span>
            <span className="row" style={{ gap: 4 }}><Key>1</Key><Key>2</Key>pick</span>
          </span>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel<Key>esc</Key></button>
          <button type="button" className="btn btn-primary" onClick={() => onPick(type)}>Continue<span className="kbd-in">↵</span></button>
        </div>
      </div>
    </Modal>
  );
}
