// Cards and prompts drawn over a pane's dimmed terminal (design screens 10, 11, 18d).
// They belong to the pane, not the window: other panes and tabs keep working. ↵ runs the
// primary action and esc cancels, except on a changed host key, which has no
// default action and puts initial focus on the safe one.

import { useEffect, useRef, useState } from 'react';
import { api } from '../api/backend';
import type { HostView } from '../api/types';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { sessions, type Pane } from './store';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

function hostLine(h: HostView | undefined, alias: string): string {
  if (!h) return alias;
  const user = h.user || '';
  const addr = `${h.hostname}:${h.port}`;
  return (user ? user + '@' : '') + addr + (h.jump ? ` · via ${h.jump}` : '') + (h.credential ? ` · credential ${h.credential}` : '');
}

export function SessionCard({ tab, active, split, onEditHost }: {
  tab: Pane;
  active: boolean;
  /** The pane shares its tab with others: closing it closes the pane, not the tab. */
  split: boolean;
  onEditHost: (alias: string) => void;
}) {
  const { catalog } = useApp();
  const host = catalog.hosts.find((h) => h.alias === tab.alias);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input, button');
    el?.focus();
  }, [active, tab.status, tab.prompt?.prompt, tab.end]);

  if (tab.status === 'ready') return null;
  if (tab.status === 'ended' && !tab.end?.code && tab.end) {
    return (
      <div className="pane-dim" ref={ref}>
        <div className="card prompt" role="status" style={{ width: 420 }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sessions.reconnect(tab.id); } }}>
          <div className="prompt-h"><span className="prompt-ic"><Icon name="term" /></span>
            <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{t('session_cards.session_ended')}</h2>
              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{tab.end.exit_code >= 0
                ? tr('session_cards.shell_exited_status', { alias: <span className="mono">{tab.alias}</span>, status: <span className="mono">{tab.end.exit_code}</span> })
                : tr('session_cards.shell_exited_signal', { alias: <span className="mono">{tab.alias}</span> })}</span></div></div>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-ghost" onClick={() => sessions.close(tab.id)}>{split ? t('session_cards.close_pane') : t('session_cards.close_tab')}<Kbd action="closeTab" /></button>
            <span className="grow" />
            <button className="btn btn-primary" data-autofocus onClick={() => sessions.reconnect(tab.id)}>{t('session_cards.reconnect')}<Kbd action="reconnect" inline /></button>
          </div>
        </div>
      </div>
    );
  }
  if (tab.status === 'connecting') {
    return (
      <div className="pane-dim" ref={ref}>
        <div className="card prompt" role="status" aria-live="polite" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.close(tab.id); } }}>
          <div className="row" style={{ gap: 'var(--sp-4)' }}>
            <span className="spinner" aria-hidden="true" />
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="prompt-t">{tr('session_cards.connecting_to_span', { span: <span className="mono">{tab.alias}</span> })}</span>
              <span className="muted mono trunc" style={{ fontSize: 'var(--fs-xs)' }}>{hostLine(host, tab.alias)}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-secondary btn-sm" data-autofocus onClick={() => sessions.close(tab.id)}>{t('common.cancel')}<Key>esc</Key></button>
            <span className="hint">{t('session_cards.each_hop_times_out_after')}</span>
          </div>
        </div>
      </div>
    );
  }
  // The prompts live in their own components; this wrapper puts them inside `ref`,
  // so the effect above gives them the focus too. Without it the focus stayed on the
  // connecting card's Cancel, which is gone by then, and ↵ and esc did nothing.
  const own = (card: React.ReactNode) => <div ref={ref} style={{ display: 'contents' }}>{card}</div>;
  if (tab.status === 'prompt' && tab.prompt?.kind === 'password') return own(<PasswordPrompt tab={tab} />);
  if (tab.status === 'prompt' && tab.prompt?.kind === 'host_key') return own(<HostKeyPrompt tab={tab} />);
  if (tab.status === 'ended' && tab.end?.code === 'host_key' && tab.changedKey) return own(<HostKeyChanged tab={tab} />);
  if (tab.status === 'ended' && tab.end?.code === 'auth') {
    return (
      <div className="pane-dim" ref={ref}>
        <div className="card prompt" role="alertdialog" aria-label={t('session_cards.authentication_failed')} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sessions.reconnect(tab.id); } if (e.key === 'Escape') { e.preventDefault(); sessions.close(tab.id); } }}>
          <div className="prompt-h"><span className="prompt-ic danger"><Icon name="lock" /></span>
            <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{t('session_cards.authentication_failed')}</h2>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{tab.end.message}</p></div></div>
          <span className="hint">{t('session_cards.if_a_password_changed_recently')}</span>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-ghost" onClick={() => onEditHost(tab.alias)}>{t('session_cards.edit_host')}<Kbd action="editHost" /></button>
            <span className="grow" />
            <button className="btn btn-primary" data-autofocus onClick={() => sessions.reconnect(tab.id)}>{t('common.retry')}<Kbd action="reconnect" inline /></button>
          </div>
        </div>
      </div>
    );
  }
  if (tab.status === 'ended' && tab.end) {
    const lost = tab.connectedAt > 0;
    return (
      <div className="pane-dim" ref={ref}>
        <div className="card prompt" role="alert" style={{ width: 460 }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sessions.reconnect(tab.id); } if (e.key === 'Escape') { e.preventDefault(); sessions.close(tab.id); } }}>
          <div className="prompt-h"><span className="prompt-ic danger"><Icon name={tab.end.code === 'host_key' ? 'shield' : 'wifi-off'} /></span>
            <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{lost ? t('session_cards.connection_lost') : t('session_cards.could_not_connect_to_alias', { alias: tab.alias })}</h2>
              <span className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>{tab.end.message}</span></div></div>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-ghost" onClick={() => sessions.close(tab.id)}>{split ? t('session_cards.close_pane') : t('session_cards.close_tab')}<Kbd action="closeTab" /></button>
            <span className="grow" />
            <button className="btn btn-primary" data-autofocus onClick={() => sessions.reconnect(tab.id)}>{t('session_cards.reconnect')}<Kbd action="reconnect" inline /></button>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function PasswordPrompt({ tab }: { tab: Pane }) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const p = tab.prompt!;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    sessions.answer(tab.id, true, pw);
    setPw('');
  };
  return (
    <div className="pane-dim">
      <form className="card prompt" role="dialog" aria-label={t('session_cards.password_for_user_alias', { user: p.user, alias: p.alias })} onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.answer(tab.id, false, ''); } }}>
        <div className="prompt-h"><span className="prompt-ic accent"><Icon name="lock" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{tr('session_cards.password_for_span', { span: <span className="mono">{p.user}@{p.alias}</span> })}</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('session_cards.no_saved_login_was_accepted')}</p></div></div>
        <div className="input lg">
          <input {...plainText} type={show ? 'text' : 'password'} className={show ? '' : 'pw'} aria-label={t('session_cards.password')} value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus autoFocus autoComplete="off" />
          <button type="button" className="icon-btn" aria-label={show ? t('session_cards.hide_password') : t('session_cards.show_password')} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
        </div>
        <span className="hint">{t('session_cards.used_for_this_connection_only')}</span>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => sessions.answer(tab.id, false, '')}>{t('common.cancel')}<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!pw}>{t('common.connect')}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </div>
  );
}

function HostKeyPrompt({ tab }: { tab: Pane }) {
  const k = tab.prompt!.host_key;
  return (
    <div className="pane-dim">
      <form className="card prompt" role="alertdialog" aria-label={t('session_cards.verify_alias', { alias: k.alias })} style={{ width: 500 }}
        onSubmit={(e) => { e.preventDefault(); sessions.answer(tab.id, true, ''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.answer(tab.id, false, ''); } }}>
        <div className="prompt-h"><span className="prompt-ic warn"><Icon name="shield" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{tr('session_cards.verify_span_before_connecting', { span: <span className="mono">{k.alias}</span> })}</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('session_cards.flint_hasn_t_seen_this')}</p></div></div>
        <dl className="kv" style={{ margin: 0 }}><dt>{t('session_cards.address')}</dt><dd className="mono">{k.addr}</dd><dt>{t('session_cards.key_type')}</dt><dd className="mono">{k.key_type}</dd></dl>
        <div className="col" style={{ gap: 6 }}><span className="flabel">{t('session_cards.fingerprint')}</span><div className="fp">{k.fingerprint}</div></div>
        <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />{t('session_cards.trusted_keys_are_stored_in')}</span>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => sessions.answer(tab.id, false, '')}>{t('common.cancel')}<Key>esc</Key></button>
          <span className="grow" />
          <button type="submit" className="btn btn-primary" data-autofocus>{t('session_cards.trust_and_connect')}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </div>
  );
}

// A changed key is always refused by the core (D-019). Replacing it is an explicit
// `known-host rm` followed by a new connection, enabled only once the person types
// the host's alias.
function HostKeyChanged({ tab }: { tab: Pane }) {
  const { fail, refreshCatalog } = useApp();
  const k = tab.changedKey!;
  const [typed, setTyped] = useState('');
  const ok = typed === k.alias;
  const replace = async () => {
    if (!ok) return;
    try {
      await api.knownHostRm(k.alias);
      await refreshCatalog();
      sessions.reconnect(tab.id);
    } catch (err) {
      fail(err);
    }
  };
  return (
    <div className="pane-dim">
      <form className="card prompt danger" role="alertdialog" aria-label={t('session_cards.the_host_key_for_alias', { alias: k.alias })} style={{ width: 540 }}
        onSubmit={(e) => e.preventDefault()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.close(tab.id); } }}>
        <div className="prompt-h"><span className="prompt-ic danger"><Icon name="shield" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{tr('session_cards.the_host_key_for_span', { span: <span className="mono">{k.alias}</span> })}</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('session_cards.nothing_was_sent_flint_stopped')}</p></div></div>
        <div className="callout danger"><Icon name="alert" size="sm" className="danger-t" /><span>{tr('session_cards.someone_may_be_intercepting_this', { strong: <strong>{t('session_cards.don_t_continue_unless_you')}</strong> })}</span></div>
        <div className="col" style={{ gap: 'var(--sp-2)' }}>
          <div className="col" style={{ gap: 4 }}><span className="flabel">{tr('session_cards.trusted_known_key_type', { known_key_type: k.known_key_type })}</span><div className="fp" style={{ textDecoration: 'line-through', color: 'var(--text-tertiary)' }}>{k.known_fingerprint}</div></div>
          <div className="col" style={{ gap: 4 }}><span className="flabel danger-t">{tr('session_cards.presented_now_key_type', { key_type: k.key_type })}</span><div className="fp" style={{ borderColor: 'var(--danger-border)' }}>{k.fingerprint}</div></div>
        </div>
        <div className="field"><label className="flabel" htmlFor={'cf-' + tab.id}>{tr('session_cards.to_replace_the_saved_key', { span: <span className="mono strong">{k.alias}</span> })}</label>
          <div className="input"><input {...plainText} id={'cf-' + tab.id} className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></div></div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className={'btn btn-danger' + (ok ? '' : ' is-disabled')} aria-disabled={!ok} onClick={() => replace()}>{t('session_cards.replace_key_and_connect')}</button>
          <span className="grow" />
          <button type="button" className="btn btn-secondary" data-autofocus onClick={() => sessions.close(tab.id)}>{t('session_cards.close_session')}<Key>esc</Key></button>
        </div>
      </form>
    </div>
  );
}
