// The sync's state in the status bar (design 23c): a cloud and a word, quiet by
// default; colour only for Merged (news) and the two states that need the person.
// A vault not connected shows nothing. A click opens the popover (23c2).

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { agoLabel, syncDetail, syncLabel, type SyncState } from '../lib/sync';
import { Icon } from '../ui/Icon';
import { useSync } from './SyncProvider';
import { fmtDate, fmtNumber, t } from '../i18n';

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
    // Esc closes it, and so does any shortcut (⌘K opens the palette over it).
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
      if (e.metaKey || e.ctrlKey) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc, true); };
  }, [open]);

  const st = sync.status;
  const state = sync.state;
  if (!st || !state) return null;
  const tip = state === 'in_step' ? t('sync_status_item.synced_ago', { ago: agoLabel(st.last_sync, sync.now) })
    : state === 'offline' ? t('sync_status_item.offline_tip')
    : state === 'merged' ? t('sync_status_item.merged_tip')
    : syncDetail(state);
  const click = () => {
    if (state === 'merged' && sync.lastMerge) { sync.showDetails(); return; }
    if (state === 'password') { sync.askPassword(); return; }
    if (state === 'attention') { sync.openServerSettings(); return; }
    setOpen(!open);
  };
  const syncNow = async () => { setBusy(true); await sync.syncNow(); setBusy(false); };
  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className={'sb-sync ' + TONE[state] + (open ? ' is-open' : '')} data-sync-item={state} aria-label={t('sync_status_item.vault_sync_state', { state: syncLabel(state) })} title={tip}
        aria-expanded={open} onClick={click}>
        <Icon name={state === 'offline' ? 'cloud-off' : 'cloud'} />
        {syncLabel(state)}
        {state === 'waiting' && <span className="dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="sync-pop" role="dialog" aria-label={t('sync_status_item.vault_sync')} style={{ left: -8, bottom: 'calc(100% + 8px)' }}>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <Icon name={state === 'offline' ? 'cloud-off' : 'cloud'} size="sm" />
            <span className="strong">{syncLabel(state)}</span><span className="grow" /><span className="hint">{vault?.name}</span>
          </div>
          <span className="muted" style={{ lineHeight: 1.45 }}>{syncDetail(state)}</span>
          <dl className="kv">
            <dt>{t('sync_status_item.last_sync')}</dt><dd>{agoLabel(st.last_sync, sync.now)}{st.last_sync > 0 ? ' · ' + fmtDate(st.last_sync, { hour: '2-digit', minute: '2-digit' }) : ''}</dd>
            <dt>{t('sync_status_item.server')}</dt><dd className="mono trunc" title={st.url}>{st.url}</dd>
            <dt>{t('sync_status_item.version')}</dt><dd className="mono faint">{fmtNumber(st.version)}</dd>
          </dl>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-secondary btn-sm" data-pop-sync-now onClick={() => syncNow().catch(() => {})} disabled={busy}><Icon name="reconnect" size="sm" />{busy ? t('sync_status_item.syncing') : t('sync_status_item.sync_now')}</button>
            <span className="grow" />
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); sync.openServerSettings(); }}>{t('sync_status_item.server_settings')}</button>
          </div>
        </div>
      )}
    </span>
  );
}
