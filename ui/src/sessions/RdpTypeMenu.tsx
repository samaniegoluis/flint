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
import { plainText } from '../ui/plainText';
import { fmtNumber, t } from '../i18n';
import { tr } from '../i18n/react';

/** The most Type takes (the core's RDP_TYPE_MAX_CHARS). */
export const TYPE_MAX_CHARS = 2000;

/** The clipboard item's hint, and why it is greyed ('' when it is offered). */
export function clipboardItem(chars: number): { hint: string; reason: string } {
  if (chars <= 0) return { hint: '', reason: t('rdp_type_menu.the_clipboard_holds_no_text') };
  if (chars > TYPE_MAX_CHARS) return { hint: '', reason: t('rdp_type_menu.too_long_to_type_over', { p: fmtNumber(TYPE_MAX_CHARS) }) };
  return { hint: `${chars} ${chars === 1 ? 'character' : 'characters'}`, reason: '' };
}

/** The password item's hint: how it will confirm you. */
export function presenceHint(presence: string): string {
  switch (presence) {
    case 'touchid': return t('rdp_type_menu.asks_touch_id');
    case 'device': return t('rdp_type_menu.asks_mac_password');
    case 'polkit': return t('rdp_type_menu.asks_system_password');
    default: return t('rdp_type_menu.asks_master_password');
  }
}

/** The toast after a Type (25c3). */
export function typedToast(typed: RdpTyped): { text: string; kind: 'ok' | 'error' } {
  if (typed.code) return { text: typed.message || t('rdp_type_menu.could_not_type_into_the'), kind: 'error' };
  return { text: t('rdp_type_menu.typed', { count: typed.count, n: fmtNumber(typed.count) }), kind: 'ok' };
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
        aria-haspopup="menu" aria-expanded={open} title={t('rdp_type_menu.type_the_clipboard_or_the')} onClick={() => set(!open)}>
        <Icon name="keyboard" size="sm" />{bar ? t('rdp_type_menu.type') : <span className="tb-l">{t('rdp_type_menu.type')}</span>}
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={t('rdp_type_menu.type')} data-rdp-type-menu
          style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', width: 320, zIndex: 30 }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); set(false); } }}>
          {!info ? (
            <div className="mi is-disabled" aria-busy="true" style={{ color: 'var(--text-disabled)' }}><span className="mini-spin" />{t('rdp_type_menu.reading_the_clipboard')}</div>
          ) : clip.reason ? (
            <button className="mi is-disabled" role="menuitem" aria-disabled="true" data-type-clipboard data-reason={clip.reason}
              style={{ color: 'var(--text-disabled)', minHeight: 40, alignItems: 'flex-start', paddingTop: 6 }}>
              <Icon name="clip" size="sm" />
              <span className="col grow" style={{ gap: 2 }}><span>{t('rdp_type_menu.type_clipboard')}</span><span className="hint">{clip.reason}</span></span>
            </button>
          ) : (
            <button className="mi" role="menuitem" data-type-clipboard onClick={() => type('clipboard')}>
              <Icon name="clip" size="sm" /><span className="grow">{t('rdp_type_menu.type_clipboard')}</span><span className="hint">{clip.hint}</span>
            </button>
          )}
          {info && (info.has_password ? (asking ? (
            <form className="col" style={{ gap: 6, padding: '6px var(--sp-2)' }} data-type-master
              onSubmit={(e) => { e.preventDefault(); if (master) type('password', master); }}>
              <label className="hint" htmlFor="type-master">{tr('rdp_type_menu.master_password_to_type_span', { span: <span className="mono">{alias}</span> })}</label>
              <div className="row" style={{ gap: 6 }}>
                <input {...plainText} id="type-master" className="input grow" type="password" autoFocus autoComplete="off" value={master}
                  onChange={(e) => setMaster(e.target.value)} aria-label={t('rdp_type_menu.master_password')} />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!master}>{t('rdp_type_menu.type')}</button>
              </div>
            </form>
          ) : (
            <button className="mi" role="menuitem" data-type-password onClick={typePassword}>
              <Icon name="key" size="sm" /><span className="grow">{tr('rdp_type_menu.type_span_s_password', { span: <span className="mono">{alias}</span> })}</span>
              <span className="hint">{presenceHint(info.presence)}</span>
            </button>
          )) : (
            <button className="mi is-disabled" role="menuitem" aria-disabled="true" data-type-password data-reason="No saved password"
              style={{ color: 'var(--text-disabled)', minHeight: 40, alignItems: 'flex-start', paddingTop: 6 }}>
              <Icon name="key" size="sm" />
              <span className="col grow" style={{ gap: 2 }}><span>{tr('rdp_type_menu.type_span_s_password', { span: <span className="mono">{alias}</span> })}</span><span className="hint">{t('rdp_type_menu.no_saved_password')}</span></span>
            </button>
          ))}
          <div className="menu-sep" />
          <div className="hint" style={{ padding: '4px var(--sp-2) 6px', lineHeight: 1.45, whiteSpace: 'normal' }}>
            {t('rdp_type_menu.sends_the_text_as_keystrokes')}
          </div>
        </div>
      )}
    </span>
  );
}
