// The version item at the right of the status bar (milestone 52, design 24f with the
// owner's change, D-116): the version opens a popover with the update's state, its
// one action, Check now, What's new and About Flint. While a newer version waits,
// "Update" sits beside it in the accent colour, so the notice stays on screen after
// its toast is closed; a click on it does what the toast's button does.

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { updateActionLabel, updateBarLabel, updateDownloading, updatePending, updatePopoverDetail, updateReady, updateStateLine } from '../lib/update';
import { useUpdate, useUpdateOnScreen } from './UpdateProvider';
import { t } from '../i18n';

export function UpdateStatusItem() {
  const { info } = useApp();
  const up = useUpdate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useUpdateOnScreen(open);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
      if (e.metaKey || e.ctrlKey) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc, true); };
  }, [open]);

  if (!info?.version) return null;
  const st = up.status;
  // Available, downloading or ready: the version item carries the dot and its action.
  const avail = updatePending(st);
  const ready = updateReady(st);
  const downloading = updateDownloading(st);
  const label = updateBarLabel(st, up.received);
  const title = !st || !avail ? `Flint ${info.version}` : ready ? `Flint ${st.version} is ready` : downloading ? `Downloading Flint ${st.version}` : `Flint ${st.version} is available`;
  return (
    <span ref={box} className="sb-update">
      {label && (
        <button className="sb-update-act" data-sb-update={ready ? 'relaunch' : downloading ? 'downloading' : st?.action} disabled={downloading} onClick={() => up.act()}
          title={downloading ? title : `${title}: ${updateActionLabel(st!)}`} aria-label={downloading ? `${title}, ${label}` : `${title}. ${updateActionLabel(st!)}`}>
          {label}
        </button>
      )}
      <button className={'sb-btn sb-version' + (avail ? ' has-dot' : '') + (open ? ' is-open' : '')} data-sb-version
        aria-expanded={open} aria-label={`Flint ${info.version}${avail ? ', update available' : ''}`} title={t('update_status_item.about_flint')}
        onClick={() => setOpen(!open)}>
        v{info.version}
      </button>
      {open && (
        <div className="sync-pop" role="dialog" aria-label={t('update_status_item.flint_update')} data-update-pop={st?.state ?? 'idle'} style={{ right: -8, bottom: 'calc(100% + 8px)' }}>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {avail && <span className="t-mark" style={{ background: 'var(--accent)' }} />}
            <span className="strong grow">{avail ? title : `Flint ${info.version}`}</span>
            {ready && <span className="badge ok" data-pop-verified>{t('update_status_item.verified')}</span>}
          </div>
          <span className="muted" style={{ lineHeight: 1.45 }}>
            {avail ? updatePopoverDetail(st!) : updateStateLine(st, up.now)}
          </span>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {avail && downloading && <span className="muted" data-pop-progress>{label}</span>}
            {avail && !downloading
              ? <button className="btn btn-primary btn-sm" data-pop-update-act onClick={() => { setOpen(false); up.act(); }}>{updateActionLabel(st!)}</button>
              : avail ? null
              : <button className="btn btn-secondary btn-sm" data-pop-check disabled={up.status?.state === 'checking'} onClick={() => up.checkNow()}>
                  {up.status?.state === 'checking' ? t('update_status_item.checking') : t('update_status_item.check_now')}
                </button>}
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); up.showWhatsNew(); }}>{t('update_status_item.what_s_new')}</button>
            <span className="grow" />
            <button className="link" style={{ fontSize: 'var(--fs-xs)' }} onClick={() => { setOpen(false); up.openAbout(); }}>{t('update_status_item.about_flint')}</button>
          </div>
        </div>
      )}
    </span>
  );
}
