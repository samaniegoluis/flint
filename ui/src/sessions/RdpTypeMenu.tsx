// The RDP toolbar's Type menu (milestone 58, designs 25c1-25c3): the clipboard or the
// host's saved password sent as keystrokes, for places a paste does not reach (the
// Windows administrator prompt on the secure desktop). The page never sees either:
// it learns the clipboard's character count and whether a password is saved, and the
// core types the text itself. Type password asks for your presence every time (Touch
// ID, the Mac's password, polkit; the vault's master password, asked here, where the
// system has none). "rdp:typed" says how it went, as a toast.

import { useEffect, useRef, useState } from 'react';
import { api, on } from '../api/backend';
import type { RdpTyped, RdpTypeInfo } from '../api/types';
import { Icon } from '../ui/Icon';

/** The most Type takes (the core's RDP_TYPE_MAX_CHARS). */
export const TYPE_MAX_CHARS = 2000;

/** The clipboard item's hint, and why it is greyed ('' when it is offered). */
export function clipboardItem(chars: number): { hint: string; reason: string } {
  if (chars <= 0) return { hint: '', reason: 'The clipboard holds no text' };
  if (chars > TYPE_MAX_CHARS) return { hint: '', reason: `Too long to type: over ${TYPE_MAX_CHARS.toLocaleString('en-US')} characters` };
  return { hint: `${chars} ${chars === 1 ? 'character' : 'characters'}`, reason: '' };
}

/** The password item's hint: how it will confirm you. */
export function presenceHint(presence: string): string {
  switch (presence) {
    case 'touchid': return 'Asks for Touch ID';
    case 'device': return "Asks for this Mac's password";
    case 'polkit': return 'Asks for your system password';
    default: return 'Asks for the master password';
  }
}

/** The toast after a Type (25c3). */
export function typedToast(t: RdpTyped): { text: string; kind: 'ok' | 'error' } {
  if (t.code) return { text: t.message || 'Could not type into the remote desktop', kind: 'error' };
  return { text: `Typed ${t.count} ${t.count === 1 ? 'character' : 'characters'}`, kind: 'ok' };
}

/** Shows each Type's outcome as a toast, for as long as the page runs. */
export function listenTyped(notify: (text: string, kind: 'ok' | 'error') => void): () => void {
  return on<RdpTyped>('rdp:typed', (t) => {
    const n = typedToast(t);
    notify(n.text, n.kind);
  });
}

export function TypeMenuButton({ session, alias, bar, onOpenChange }: {
  session: string;
  alias: string;
  /** In full screen's connection bar, styled as its buttons. */
  bar?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<RdpTypeInfo | null>(null);
  // Where the system has no presence check: the master password, asked in the menu.
  const [asking, setAsking] = useState(false);
  const [master, setMaster] = useState('');
  const ref = useRef<HTMLSpanElement>(null);
  const set = (o: boolean) => { setOpen(o); onOpenChange?.(o); };
  useEffect(() => {
    if (!open) return;
    setInfo(null);
    setAsking(false);
    setMaster('');
    api.rdpTypeInfo(session, alias).then(setInfo).catch(() => setInfo({ clipboard_chars: 0, has_password: false, presence: 'password' }));
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) set(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session, alias]);
  const type = (what: 'clipboard' | 'password', password = '') => {
    set(false);
    setMaster('');
    // Back to the desktop, so what comes next goes where it typed.
    (document.querySelector(`canvas.rdp-canvas[aria-label="Remote desktop of ${CSS.escape(alias)}"]`) as HTMLCanvasElement | null)?.focus({ preventScroll: true });
    api.rdpType(session, alias, what, password).catch(() => {});
  };
  const typePassword = () => {
    if (info?.presence === 'password') setAsking(true);
    else type('password');
  };
  const clip = clipboardItem(info?.clipboard_chars ?? 0);
  return (
    <span className="mon-anchor" ref={ref}>
      <button className={bar ? 'btn btn-ghost btn-sm' + (open ? ' is-active' : '') : 'tbtn' + (open ? ' on' : '')} data-rdp-type
        aria-haspopup="menu" aria-expanded={open} title="Type the clipboard or the password as keystrokes" onClick={() => set(!open)}>
        <Icon name="keyboard" size="sm" />{bar ? 'Type' : <span className="tb-l">Type</span>}
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Type" data-rdp-type-menu
          style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', width: 320, zIndex: 30 }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); set(false); } }}>
          {!info ? (
            <div className="mi is-disabled" aria-busy="true" style={{ color: 'var(--text-disabled)' }}><span className="mini-spin" />Reading the clipboard…</div>
          ) : clip.reason ? (
            <button className="mi is-disabled" role="menuitem" aria-disabled="true" data-type-clipboard data-reason={clip.reason}
              style={{ color: 'var(--text-disabled)', minHeight: 40, alignItems: 'flex-start', paddingTop: 6 }}>
              <Icon name="clip" size="sm" />
              <span className="col grow" style={{ gap: 2 }}><span>Type clipboard</span><span className="hint">{clip.reason}</span></span>
            </button>
          ) : (
            <button className="mi" role="menuitem" data-type-clipboard onClick={() => type('clipboard')}>
              <Icon name="clip" size="sm" /><span className="grow">Type clipboard</span><span className="hint">{clip.hint}</span>
            </button>
          )}
          {info && (info.has_password ? (asking ? (
            <form className="col" style={{ gap: 6, padding: '6px var(--sp-2)' }} data-type-master
              onSubmit={(e) => { e.preventDefault(); if (master) type('password', master); }}>
              <label className="hint" htmlFor="type-master">Master password, to type <span className="mono">{alias}</span>'s password</label>
              <div className="row" style={{ gap: 6 }}>
                <input id="type-master" className="input grow" type="password" autoFocus autoComplete="off" value={master}
                  onChange={(e) => setMaster(e.target.value)} aria-label="Master password" />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!master}>Type</button>
              </div>
            </form>
          ) : (
            <button className="mi" role="menuitem" data-type-password onClick={typePassword}>
              <Icon name="key" size="sm" /><span className="grow">Type <span className="mono">{alias}</span>'s password</span>
              <span className="hint">{presenceHint(info.presence)}</span>
            </button>
          )) : (
            <button className="mi is-disabled" role="menuitem" aria-disabled="true" data-type-password data-reason="No saved password"
              style={{ color: 'var(--text-disabled)', minHeight: 40, alignItems: 'flex-start', paddingTop: 6 }}>
              <Icon name="key" size="sm" />
              <span className="col grow" style={{ gap: 2 }}><span>Type <span className="mono">{alias}</span>'s password</span><span className="hint">No saved password</span></span>
            </button>
          ))}
          <div className="menu-sep" />
          <div className="hint" style={{ padding: '4px var(--sp-2) 6px', lineHeight: 1.45, whiteSpace: 'normal' }}>
            Sends the text as keystrokes, for places paste doesn't reach, such as the Windows administrator prompt. Nothing is shown on screen.
          </div>
        </div>
      )}
    </span>
  );
}
