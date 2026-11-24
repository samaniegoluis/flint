// The session toolbar's Tunnels button and its menu (milestone 23, design 20c1, 20c2):
// a check per tunnel of the tab's host with its live state, then Manage tunnels….
// The tunnels run in their own session, never in this tab (D-062).

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/app';
import { chordLabel } from '../lib/keymap';
import { Icon } from '../ui/Icon';
import { portAdvice, stateLine, switchedOn, tunnels, useTunnels } from './store';
import { t } from '../i18n';
import { tr } from '../i18n/react';

export function TunnelsButton({ host, onManage }: { host: string; onManage: (alias: string) => void }) {
  const { os } = useApp();
  const snap = useTunnels();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const list = snap.list.filter((v) => v.host === host);
  const up = list.filter((v) => v.state === 'listening').length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    ref.current?.querySelector<HTMLElement>('.menu .mi')?.focus();
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const advice = list.map((v) => portAdvice(v, snap)).find(Boolean) ?? '';
  return (
    <span ref={ref} style={{ position: 'relative', display: 'flex' }}>
      <button className={'tbtn' + (open ? ' on' : '')} aria-haspopup="menu" aria-expanded={open} data-toolbar-tunnels
        title={up > 0 ? t('tunnels_menu.up_tunnelp_up_on_host', { up, p: up === 1 ? '' : 's', host }) : t('tunnels_menu.tunnels_on_host', { host })} onClick={() => setOpen((o) => !o)}>
        <Icon name="tunnel" size="sm" /><span className="tb-l">{t('tunnels_menu.tunnels')}</span>
        {up > 0 && <span className="tcount" aria-label={`${up} up`}>{up}</span>}
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={t('tunnels_menu.tunnels_on_host', { host })} data-tunnels-menu
          style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', width: 380, maxWidth: 'calc(100vw - 120px)', zIndex: 30 }}
          onKeyDown={(e) => {
            const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.mi')];
            const i = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
            if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
          }}>
          <div className="menu-label"><span className="label">{tr('tunnels_menu.tunnels_on_span', { span: <span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{host}</span> })}</span></div>
          {list.length === 0 && <div className="hint" style={{ padding: '4px var(--sp-2) 6px' }}>{t('tunnels_menu.no_tunnels_on_this_host')}</div>}
          {list.map((v) => {
            const on = switchedOn(v, snap);
            const st = stateLine(v, snap);
            const icon = st.kind === 'danger' ? (v.state === 'connection lost' ? 'wifi-off' : 'lock') : st.kind === 'warn' ? 'alert' : null;
            return (
              <button key={v.name} className="mi" role="menuitemcheckbox" aria-checked={on} data-tunnels-menu-item={v.name}
                style={{ minHeight: 44, alignItems: 'flex-start', paddingTop: 6, paddingBottom: 6 }} onClick={() => { void tunnels.toggle(v); }}>
                <span className={'mbox' + (on ? ' on' : '')} style={{ marginTop: 1 }}>{on && <Icon name="check" />}</span>
                <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="row" style={{ gap: 'var(--sp-2)' }}><span className="strong">{v.name}</span>
                    <span className="tun-map" style={{ fontSize: 'var(--fs-xs)' }}>127.0.0.1:{v.local_port}<span className="arr">→</span>{v.destination}</span></span>
                  <span className={'tun-st ' + (st.kind === 'idle' ? '' : st.kind)}>
                    {st.kind === 'wait' ? <span className="mini-spin" /> : icon ? <Icon name={icon} size="xs" /> : <span className={'dot ' + (st.kind === 'ok' ? 'ok' : 'idle')} />}
                    <span>{st.text}</span>
                  </span>
                </span>
              </button>
            );
          })}
          {advice && <><div className="menu-sep" /><div className="ferr warn" style={{ padding: '2px var(--sp-2) 6px' }}><Icon name="alert" /><span>{advice}</span></div></>}
          {snap.starts[host]?.status === 'prompt' && (
            <div className="hint" style={{ padding: '2px var(--sp-2) 6px' }}>{tr('tunnels_menu.logging_in_needs_you_answer', { chordLabel: chordLabel('viewTunnels', os) })}</div>
          )}
          <div className="menu-sep" />
          <button className="mi" role="menuitem" onClick={() => { setOpen(false); onManage(host); }}>
            <Icon name="edit" size="sm" /><span className="grow">{list.length === 0 ? t('tunnels_menu.add_a_tunnel') : t('tunnels_menu.manage_tunnels')}</span><span className="kbd">{chordLabel('editHost', os)}</span>
          </button>
          <div className="hint" style={{ padding: '6px var(--sp-2) 4px', lineHeight: 1.45 }}>{t('tunnels_menu.tunnels_run_in_their_own')}</div>
        </div>
      )}
    </span>
  );
}

/** The mark on a tab or a host row while the host has tunnels up (design 20d1). */
export function TunnelMark({ host }: { host: string }) {
  const snap = useTunnels();
  const up = snap.list.filter((v) => v.host === host && v.state === 'listening');
  if (up.length === 0) return null;
  const tip = [t('tunnels_menu.up_on_host', { count: up.length, host }),
    ...up.map((v) => `${v.name} · 127.0.0.1:${v.local_port} → ${v.destination}${v.connections ? t('tunnels_menu.conns', { n: v.connections }) : ''}`),
    t('tunnels_menu.closing_leaves_them_up')].join('\n');
  return (
    <span className="tun-mark" aria-label={t('tunnels_menu.n_tunnels_up', { count: up.length })} title={tip} data-tun-mark={host}>
      <Icon name="tunnel" />{up.length}
    </span>
  );
}
