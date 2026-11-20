// The version item at the right of the status bar (milestone 52, design 24f with the
// owner's change, D-116): the version opens a popover with the update's state, its
// one action, Check now, What's new and About Flint. While a newer version waits,
// "Update" sits beside it in the accent colour, so the notice stays on screen after
// its toast is closed; a click on it does what the toast's button does.

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { updateActionLabel, updateAvailable, updateBarLabel, updatePopoverDetail, updateStateLine } from '../lib/update';
import { useUpdate } from './UpdateProvider';

export function UpdateStatusItem() {
  const { info } = useApp();
  const up = useUpdate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

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
  const avail = updateAvailable(st);
  const label = updateBarLabel(st);
  const title = avail ? `Flint ${st.version} is available` : `Flint ${info.version}`;
  return (
    <span ref={box} className="sb-update">
      {label && (
        <button className="sb-update-act" data-sb-update={st?.action} onClick={() => up.act()}
          title={`${title}: ${updateActionLabel(st!)}`} aria-label={`${title}. ${updateActionLabel(st!)}`}>
          {label}
        </button>
      )}
      <button className={'sb-btn sb-version' + (avail ? ' has-dot' : '') + (open ? ' is-open' : '')} data-sb-version
        aria-expanded={open} aria-label={`Flint ${info.version}${avail ? ', update available' : ''}`} title="About Flint"
        onClick={() => setOpen(!open)}>
        v{info.version}
      </button>
      {open && (
        <div className="sync-pop" role="dialog" aria-label="Flint update" data-update-pop={st?.state ?? 'idle'} style={{ right: -8, bottom: 'calc(100% + 8px)' }}>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {avail && <span className="t-mark" style={{ background: 'var(--accent)' }} />}
            <span className="strong grow">{avail ? title : `Flint ${info.version}`}</span>
          </div>
          <span className="muted" style={{ lineHeight: 1.45 }}>
            {avail ? updatePopoverDetail(st) : updateStateLine(st, up.now)}
          </span>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {avail
              ? <button className="btn btn-primary btn-sm" data-pop-update-act onClick={() => { setOpen(false); up.act(); }}>{updateActionLabel(st)}</button>
              : <button className="btn btn-secondary btn-sm" data-pop-check disabled={up.status?.state === 'checking'} onClick={() => up.checkNow()}>
                  {up.status?.state === 'checking' ? 'Checking…' : 'Check now'}
                </button>}
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); up.showWhatsNew(); }}>What's new</button>
            <span className="grow" />
            <button className="link" style={{ fontSize: 'var(--fs-xs)' }} onClick={() => { setOpen(false); up.openAbout(); }}>About Flint</button>
          </div>
        </div>
      )}
    </span>
  );
}
