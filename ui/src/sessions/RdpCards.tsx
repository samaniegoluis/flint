// The RDP tab's states over its desktop (design 22c, 22d): connecting, the certificate
// prompt on first use, a changed certificate (refused, no way to continue), and one
// card per reason a connection fails. ↵ runs the primary action and esc cancels,
// except on a changed certificate, which has no default action.

import { useEffect, useRef, useState } from 'react';
import type { HostView } from '../api/types';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { RDP_CONNECT_TIMEOUT_S } from '../lib/rdpInput';
import { rdpEndKind, sessions, type Pane } from './store';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

/** "4f:a2:…" as the design groups it: upper-case bytes split by spaces. */
export function groupedFingerprint(fp: string): string {
  return fp.split(':').map((b) => b.toUpperCase()).join(' ');
}

function login(h: HostView | undefined): string {
  if (!h) return '';
  const user = h.user ? (h.domain && !h.user.includes('\\') && !h.user.includes('@') ? `${h.domain}\\${h.user}` : h.user) : '';
  return user;
}

function address(h: HostView | undefined, alias: string): string {
  return h ? `${h.hostname}:${h.port}` : alias;
}

export function RdpCard({ pane, active, onEditHost, onKnownHosts }: {
  pane: Pane;
  active: boolean;
  onEditHost: (alias: string) => void;
  onKnownHosts: () => void;
}) {
  const { catalog } = useApp();
  const host = catalog.hosts.find((h) => h.alias === pane.alias);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input, button');
    el?.focus();
  }, [active, pane.status, pane.prompt?.prompt, pane.end]);

  if (pane.status === 'ready') return null;
  const wrap = (card: React.ReactNode) => <div className="pane-dim" ref={ref}>{card}</div>;
  const retry = () => sessions.reconnect(pane.id);
  const close = () => sessions.closeTab(pane.tab);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); retry(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  if (pane.status === 'connecting') {
    const who = login(host);
    return wrap(
      <div className="card prompt" role="status" aria-live="polite" data-rdp-state="connecting" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
        <div className="row" style={{ gap: 'var(--sp-4)' }}>
          <span className="spinner" aria-hidden="true" />
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <span className="prompt-t">{tr('rdp_cards.connecting_to_span', { span: <span className="mono">{pane.alias}</span> })}</span>
            <span className="muted mono trunc" style={{ fontSize: 'var(--fs-xs)' }}>{who ? `${who}@` : ''}{address(host, pane.alias)}{host?.credential ? t('rdp_cards.via_credential', { name: host.credential }) : host?.has_password ? t('rdp_cards.own_password') : ''}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button className="btn btn-secondary btn-sm" data-autofocus onClick={close}>{t('common.cancel')}<Key>esc</Key></button>
          <span className="hint">{tr('rdp_cards.times_out_after_rdp_connect', { RDP_CONNECT_TIMEOUT_S })}</span>
        </div>
      </div>,
    );
  }

  if (pane.status === 'prompt' && pane.prompt?.kind === 'host_key') return <div ref={ref} style={{ display: 'contents' }}><CertificatePrompt pane={pane} /></div>;
  if (pane.status === 'prompt' && pane.prompt?.kind === 'password') return <div ref={ref} style={{ display: 'contents' }}><RdpPasswordPrompt pane={pane} /></div>;
  if (pane.status !== 'ended') return null;

  const kind = rdpEndKind(pane);
  if (kind === 'cert-changed') {
    const k = pane.changedKey!;
    return wrap(
      <div className="card prompt danger" role="alertdialog" aria-label={t('rdp_cards.the_certificate_for_alias_has', { alias: pane.alias })} style={{ width: 560 }} data-rdp-state="cert-changed"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
        <div className="prompt-h"><span className="prompt-ic danger"><Icon name="shield" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{tr('rdp_cards.the_certificate_for_span_has', { span: <span className="mono">{pane.alias}</span> })}</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('rdp_cards.nothing_was_sent_flint_stopped')}</p></div></div>
        <div className="callout danger"><Icon name="alert" size="sm" className="danger-t" /><span>{tr('rdp_cards.someone_may_be_intercepting_this', { strong: <strong>{t('rdp_cards.don_t_continue_unless_you')}</strong> })}</span></div>
        <div className="col" style={{ gap: 'var(--sp-2)' }}>
          <div className="col" style={{ gap: 4 }}><span className="flabel">{t('rdp_cards.trusted')}</span><div className="fp" style={{ textDecoration: 'line-through', color: 'var(--text-tertiary)' }}>{groupedFingerprint(k.known_fingerprint)}</div></div>
          <div className="col" style={{ gap: 4 }}><span className="flabel danger-t">{t('rdp_cards.presented_now')}{k.subject ? ` · ${k.subject}` : ''}{k.valid_from ? t('rdp_cards.valid_from_valid_from', { valid_from: k.valid_from }) : ''}</span><div className="fp" style={{ borderColor: 'var(--danger-border)' }}>{groupedFingerprint(k.fingerprint)}</div></div>
        </div>
        <span className="hint">{t('rdp_cards.to_trust_the_new_one')}</span>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-secondary" data-autofocus onClick={close}>{t('rdp_cards.close_tab')}<Key>esc</Key></button>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onKnownHosts}>{t('rdp_cards.open_known_hosts')}</button>
        </div>
      </div>,
    );
  }

  if (kind === 'closed') {
    return wrap(
      <div className="card prompt" role="status" style={{ width: 420 }} data-rdp-state="closed" onKeyDown={keys}>
        <div className="prompt-h"><span className="prompt-ic"><Icon name="rdp" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{t('rdp_cards.disconnected')}</h2>
            <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{tr('rdp_cards.your_windows_session_keeps_running', { span: <span className="mono">{pane.alias}</span> })}</span></div></div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button className="btn btn-ghost" onClick={close}>{t('rdp_cards.close_tab')}<Key>esc</Key></button>
          <span className="grow" />
          <button className="btn btn-primary" data-autofocus onClick={retry}>{t('rdp_cards.connect_again')}<span className="kbd-in">↵</span></button>
        </div>
      </div>,
    );
  }

  // Design 22c7: the session dropped while it was up. The last frame stays, greyed,
  // under the card; Windows keeps the session for a while, so a reconnect finds it.
  if (kind === 'lost') {
    return wrap(
      <div className="card prompt" role="alert" style={{ width: 460 }} data-rdp-state="lost" onKeyDown={keys}>
        <div className="prompt-h"><span className="prompt-ic danger"><Icon name="wifi-off" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{t('rdp_cards.connection_lost')}</h2>
            <span className="mono muted" style={{ fontSize: 'var(--fs-xs)' }} data-rdp-lost-reason>{lostReason(pane)}</span></div></div>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{tr('rdp_cards.your_windows_session_keeps_running_2', { span: <span className="mono">{pane.alias}</span> })}</p>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button className="btn btn-ghost" onClick={close}>{t('rdp_cards.close_tab')}<Kbd action="closeTab" /></button>
          <span className="grow" />
          <button className="btn btn-primary" data-autofocus data-rdp-reconnect onClick={retry}>{t('rdp_cards.reconnect')}<Kbd action="reconnect" inline /></button>
        </div>
      </div>,
    );
  }

  const text = failureText(kind, pane, host);
  // A switch to Compatible that the server closed leaves the tab in the mode that
  // worked, and Retry connects in that one (owner, milestone 60): the button says so.
  const retryIn = kind === 'setup-closed' && pane.graphics && pane.graphics !== 'compatible' ? (GRAPHICS_LABEL[pane.graphics] ? t(GRAPHICS_LABEL[pane.graphics]) : '') : '';
  return wrap(
    <div className="card prompt" role="alert" style={{ width: 480 }} data-rdp-state={kind} onKeyDown={keys}>
      <div className="prompt-h"><span className="prompt-ic danger"><Icon name={text.icon} /></span>
        <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{text.title}</h2>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{text.body}</p></div></div>
      {pane.end?.message && <span className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>{pane.end.message}</span>}
      {text.hint && <span className="hint">{text.hint}</span>}
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button className="btn btn-ghost" onClick={() => onEditHost(pane.alias)}>{t('rdp_cards.edit_host')}</button>
        <button className="btn btn-ghost" onClick={close}>{t('rdp_cards.close_tab')}<Key>esc</Key></button>
        <span className="grow" />
        <button className="btn btn-primary" data-autofocus data-rdp-retry={retryIn || undefined} onClick={retry}>{retryIn ? t('rdp_cards.retry_in_retryin', { retryIn }) : t('common.retry')}<span className="kbd-in">↵</span></button>
      </div>
    </div>,
  );
}

const GRAPHICS_LABEL: Record<string, string> = { auto: 'rdp_cards.graphics.auto', pipeline: 'rdp_cards.graphics.pipeline' };

/** "the connection was lost (ERRCONNECT_…) · 10:21": why, and when (design 22c7). */
export function lostReason(pane: Pane): string {
  const msg = pane.end?.message ?? '';
  if (!pane.endedAt) return msg;
  const at = new Date(pane.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return msg ? `${msg} · ${at}` : at;
}

function failureText(kind: ReturnType<typeof rdpEndKind>, pane: Pane, host: HostView | undefined): { icon: 'lock' | 'wifi-off' | 'clock' | 'shield' | 'alert'; title: string; body: string; hint: string } {
  const addr = address(host, pane.alias);
  const note = host?.notes?.split('\n')[0]?.trim() ?? '';
  switch (kind) {
    case 'auth':
      return { icon: 'lock', title: t('rdp_cards.wrong_user_or_password'), body: t('rdp_cards.alias_didn_t_accept_p', { alias: pane.alias, p: login(host) || t('rdp_cards.the_user') }), hint: t('rdp_cards.if_the_password_changed_on') };
    case 'unreachable':
      return { icon: 'wifi-off', title: t('rdp_cards.can_t_reach_alias', { alias: pane.alias }), body: t('rdp_cards.there_is_no_route_from', { addr }), hint: note ? t('rdp_cards.vpn_hint_note', { note }) : t('rdp_cards.vpn_hint') };
    case 'timeout':
      return { icon: 'clock', title: t('rdp_cards.alias_didn_t_answer', { alias: pane.alias }), body: t('rdp_cards.no_reply_on_addr_within', { addr, RDP_CONNECT_TIMEOUT_S }), hint: t('rdp_cards.the_machine_may_be_asleep') };
    case 'rdp-off':
      return { icon: 'wifi-off', title: t('rdp_cards.alias_refused_the_session', { alias: pane.alias }), body: t('rdp_cards.nothing_answers_on_its_remote'), hint: t('rdp_cards.turn_it_on_in_the') };
    case 'legacy-security':
      return { icon: 'shield', title: t('rdp_cards.alias_needs_a_safer_connection', { alias: pane.alias }), body: t('rdp_cards.it_offers_only_the_old'), hint: t('rdp_cards.on_the_server_set_require') };
    case 'setup-closed':
      return { icon: 'alert', title: t('rdp_cards.alias_closed_the_connection_during', { alias: pane.alias }), body: t('rdp_cards.it_answered_and_took_the'), hint: t('rdp_cards.some_servers_such_as_gnome') };
    case 'refused':
      return { icon: 'alert', title: t('rdp_cards.alias_refused_the_session', { alias: pane.alias }), body: t('rdp_cards.the_server_answered_and_would'), hint: t('rdp_cards.all_remote_sessions_may_be') };
    default:
      return { icon: 'alert', title: t('rdp_cards.could_not_connect_to_alias', { alias: pane.alias }), body: t('rdp_cards.the_connection_failed'), hint: '' };
  }
}

// First connection: the RDP twin of the SSH host key prompt (design 22d1).
function CertificatePrompt({ pane }: { pane: Pane }) {
  const k = pane.prompt!.host_key;
  const self = k.subject !== '' && k.subject === k.issuer;
  return (
    <div className="pane-dim">
      <form className="card prompt" role="alertdialog" aria-label={t('rdp_cards.verify_alias', { alias: k.alias })} style={{ width: 560 }} data-rdp-state="certificate"
        onSubmit={(e) => { e.preventDefault(); sessions.answer(pane.id, true, ''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.answer(pane.id, false, ''); } }}>
        <div className="prompt-h"><span className="prompt-ic warn"><Icon name="shield" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{tr('rdp_cards.verify_span_before_connecting', { span: <span className="mono">{k.alias}</span> })}</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('rdp_cards.this_server_s_certificate_is')}</p></div></div>
        <dl className="kv" style={{ margin: 0 }}>
          <dt>{t('rdp_cards.address')}</dt><dd className="mono">{k.addr.replace(/^rdp:\/\//, '')}</dd>
          {k.subject && <><dt>{t('rdp_cards.subject')}</dt><dd className="mono">{k.subject}</dd></>}
          {k.issuer && <><dt>{t('rdp_cards.issuer')}</dt><dd className="mono">{k.issuer}{self && <span className="badge" style={{ marginLeft: 'var(--sp-2)' }}>{t('rdp_cards.self_signed')}</span>}</dd></>}
          {k.valid_to && <><dt>{t('rdp_cards.valid')}</dt><dd className="mono">{k.valid_from} → {k.valid_to}</dd></>}
        </dl>
        <div className="col" style={{ gap: 6 }}><span className="flabel">{t('rdp_cards.sha_256_fingerprint')}</span><div className="fp" data-fingerprint>{groupedFingerprint(k.fingerprint)}</div></div>
        <span className="hint">{t('rdp_cards.self_signed_is_normal_for')}</span>
        <div className="fp" data-cert-command data-i18n-skip style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>{"$c = Get-ChildItem 'Cert:\\LocalMachine\\Remote Desktop'; [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($c.RawData))"}</div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => sessions.answer(pane.id, false, '')}>{t('common.cancel')}<Key>esc</Key></button>
          <span className="grow" />
          <button type="submit" className="btn btn-primary" data-autofocus>{t('rdp_cards.trust_and_connect')}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </div>
  );
}

// An RDP host with no saved password asks for one, for this connection only.
function RdpPasswordPrompt({ pane }: { pane: Pane }) {
  const [pw, setPw] = useState('');
  const p = pane.prompt!;
  return (
    <div className="pane-dim">
      <form className="card prompt" role="dialog" aria-label={t('rdp_cards.password_for_user_alias', { user: p.user, alias: p.alias })}
        onSubmit={(e) => { e.preventDefault(); sessions.answer(pane.id, true, pw); setPw(''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.answer(pane.id, false, ''); } }}>
        <div className="prompt-h"><span className="prompt-ic accent"><Icon name="lock" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{tr('rdp_cards.password_for_span_on_span2', { span: <span className="mono">{p.user}</span>, span2: <span className="mono">{p.alias}</span> })}</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('rdp_cards.this_host_has_no_saved')}</p></div></div>
        <div className="input lg"><input {...plainText} type="password" className="pw" aria-label={t('rdp_cards.password')} value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus autoFocus autoComplete="off" /></div>
        <span className="hint">{t('rdp_cards.used_for_this_connection_only')}</span>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => sessions.answer(pane.id, false, '')}>{t('common.cancel')}<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!pw}>{t('common.connect')}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </div>
  );
}

