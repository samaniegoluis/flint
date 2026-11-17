// The sync's state in the status bar (design 23c): a cloud and a word, quiet by
// default; colour only for Merged (news) and the two states that need the person.
// A vault not connected shows nothing. A click opens the popover (23c2).

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { agoLabel, SYNC_DETAIL, SYNC_LABEL, type SyncState } from '../lib/sync';
import { Icon } from '../ui/Icon';
import { useSync } from './SyncProvider';

const TONE: Record<SyncState, string> = {
  syncing: 'syncing', merged: 'info', password: 'warn', attention: 'warn', offline: '', waiting: '', in_step: '',
};

export function SyncStatusItem() {
  const { vault } = useApp();
  const sync = useSync();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc, true); };
  }, [open]);

  const st = sync.status;
  const state = sync.state;
  if (!st || !state) return null;
  const tip = state === 'in_step' ? `Synced ${agoLabel(st.last_sync, sync.now)}`
    : state === 'offline' ? 'The server cannot be reached; changes sync when it is back'
    : state === 'merged' ? 'Changes from another machine · click for details'
    : SYNC_DETAIL[state];
  const click = () => {
    if (state === 'merged' && sync.lastMerge) { sync.showDetails(); return; }
    if (state === 'password') { sync.askPassword(); return; }
    if (state === 'attention') { sync.openServerSettings(); return; }
    setOpen(!open);
  };
  const syncNow = async () => { setBusy(true); await sync.syncNow(); setBusy(false); };
  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className={'sb-sync ' + TONE[state] + (open ? ' is-open' : '')} data-sync-item={state} aria-label={`Vault sync: ${SYNC_LABEL[state]}`} title={tip}
        aria-expanded={open} onClick={click}>
        <Icon name={state === 'offline' ? 'cloud-off' : 'cloud'} />
        {SYNC_LABEL[state]}
        {state === 'waiting' && <span className="dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="sync-pop" role="dialog" aria-label="Vault sync" style={{ left: -8, bottom: 'calc(100% + 8px)' }}>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <Icon name={state === 'offline' ? 'cloud-off' : 'cloud'} size="sm" />
            <span className="strong">{SYNC_LABEL[state]}</span><span className="grow" /><span className="hint">{vault?.name}</span>
          </div>
          <span className="muted" style={{ lineHeight: 1.45 }}>{SYNC_DETAIL[state]}</span>
          <dl className="kv">
            <dt>Last sync</dt><dd>{agoLabel(st.last_sync, sync.now)}{st.last_sync > 0 ? ' · ' + new Date(st.last_sync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</dd>
            <dt>Server</dt><dd className="mono trunc" title={st.url}>{st.url}</dd>
            <dt>Version</dt><dd className="mono faint">{st.version.toLocaleString('en-US')}</dd>
          </dl>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-secondary btn-sm" data-pop-sync-now onClick={() => syncNow().catch(() => {})} disabled={busy}><Icon name="reconnect" size="sm" />{busy ? 'Syncing…' : 'Sync now'}</button>
            <span className="grow" />
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); sync.openServerSettings(); }}>Server settings…</button>
          </div>
        </div>
      )}
    </span>
  );
}
