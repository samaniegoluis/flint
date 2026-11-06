// Cards and prompts drawn over a tab's dimmed terminal (design screens 10 and 11).
// They belong to the tab, not the window: other tabs keep working. ↵ runs the
// primary action and esc cancels, except on a changed host key, which has no
// default action and puts initial focus on the safe one.

import { useEffect, useRef, useState } from 'react';
import { api } from '../api/backend';
import type { HostView } from '../api/types';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { sessions, type Tab } from './store';

function hostLine(h: HostView | undefined, alias: string): string {
  if (!h) return alias;
  const user = h.user || '';
  const addr = `${h.hostname}:${h.port}`;
  return (user ? user + '@' : '') + addr + (h.jump ? ` · via ${h.jump}` : '') + (h.credential ? ` · credential ${h.credential}` : '');
}

export function SessionCard({ tab, active, onEditHost }: { tab: Tab; active: boolean; onEditHost: (alias: string) => void }) {
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
            <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">Session ended</h2>
              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>The shell on <span className="mono">{tab.alias}</span> exited{tab.end.exit_code >= 0 ? <> with status <span className="mono">{tab.end.exit_code}</span></> : ' on a signal'}.</span></div></div>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-ghost" onClick={() => sessions.close(tab.id)}>Close tab<Kbd action="closeTab" /></button>
            <span className="grow" />
            <button className="btn btn-primary" data-autofocus onClick={() => sessions.reconnect(tab.id)}>Reconnect<Kbd action="reconnect" inline /></button>
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
              <span className="prompt-t">Connecting to <span className="mono">{tab.alias}</span></span>
              <span className="muted mono trunc" style={{ fontSize: 'var(--fs-xs)' }}>{hostLine(host, tab.alias)}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-secondary btn-sm" data-autofocus onClick={() => sessions.close(tab.id)}>Cancel<Key>esc</Key></button>
            <span className="hint">Each hop times out after 15 s</span>
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
        <div className="card prompt" role="alertdialog" aria-label="Authentication failed" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sessions.reconnect(tab.id); } if (e.key === 'Escape') { e.preventDefault(); sessions.close(tab.id); } }}>
          <div className="prompt-h"><span className="prompt-ic danger"><Icon name="lock" /></span>
            <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">Authentication failed</h2>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{tab.end.message}</p></div></div>
          <span className="hint">If a password changed recently, update the host or its credential — every host that uses it gets the fix.</span>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-ghost" onClick={() => onEditHost(tab.alias)}>Edit host<Kbd action="editHost" /></button>
            <span className="grow" />
            <button className="btn btn-primary" data-autofocus onClick={() => sessions.reconnect(tab.id)}>Retry<Kbd action="reconnect" inline /></button>
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
            <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{lost ? 'Connection lost' : `Could not connect to ${tab.alias}`}</h2>
              <span className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>{tab.end.message}</span></div></div>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-ghost" onClick={() => sessions.close(tab.id)}>Close tab<Kbd action="closeTab" /></button>
            <span className="grow" />
            <button className="btn btn-primary" data-autofocus onClick={() => sessions.reconnect(tab.id)}>Reconnect<Kbd action="reconnect" inline /></button>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function PasswordPrompt({ tab }: { tab: Tab }) {
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
      <form className="card prompt" role="dialog" aria-label={`Password for ${p.user}@${p.alias}`} onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.answer(tab.id, false, ''); } }}>
        <div className="prompt-h"><span className="prompt-ic accent"><Icon name="lock" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">Password for <span className="mono">{p.user}@{p.alias}</span></h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No saved login was accepted. The server asked for a password.</p></div></div>
        <div className="input lg">
          <input type={show ? 'text' : 'password'} className={show ? '' : 'pw'} aria-label="Password" value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus autoFocus autoComplete="off" />
          <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
        </div>
        <span className="hint">Used for this connection only. Save it in the host editor to skip this prompt.</span>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => sessions.answer(tab.id, false, '')}>Cancel<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!pw}>Connect<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </div>
  );
}

function HostKeyPrompt({ tab }: { tab: Tab }) {
  const k = tab.prompt!.host_key;
  return (
    <div className="pane-dim">
      <form className="card prompt" role="alertdialog" aria-label={`Verify ${k.alias}`} style={{ width: 500 }}
        onSubmit={(e) => { e.preventDefault(); sessions.answer(tab.id, true, ''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.answer(tab.id, false, ''); } }}>
        <div className="prompt-h"><span className="prompt-ic warn"><Icon name="shield" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">Verify <span className="mono">{k.alias}</span> before connecting</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Flint hasn't seen this server before. Compare the fingerprint with one you got from its admin or console.</p></div></div>
        <dl className="kv" style={{ margin: 0 }}><dt>Address</dt><dd className="mono">{k.addr}</dd><dt>Key type</dt><dd className="mono">{k.key_type}</dd></dl>
        <div className="col" style={{ gap: 6 }}><span className="flabel">Fingerprint</span><div className="fp">{k.fingerprint}</div></div>
        <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />Trusted keys are stored in the vault and shared with the Flint CLI.</span>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => sessions.answer(tab.id, false, '')}>Cancel<Key>esc</Key></button>
          <span className="grow" />
          <button type="submit" className="btn btn-primary" data-autofocus>Trust and connect<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </div>
  );
}

// A changed key is always refused by the core (D-019). Replacing it is an explicit
// `known-host rm` followed by a new connection, enabled only once the person types
// the host's alias.
function HostKeyChanged({ tab }: { tab: Tab }) {
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
      <form className="card prompt danger" role="alertdialog" aria-label={`The host key for ${k.alias} has changed`} style={{ width: 540 }}
        onSubmit={(e) => e.preventDefault()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.close(tab.id); } }}>
        <div className="prompt-h"><span className="prompt-ic danger"><Icon name="shield" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">The host key for <span className="mono">{k.alias}</span> has changed</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Nothing was sent. Flint stopped before logging in.</p></div></div>
        <div className="callout danger"><Icon name="alert" size="sm" className="danger-t" /><span>Someone may be intercepting this connection. It also happens after a server is rebuilt. <strong>Don't continue unless you know why the key changed.</strong></span></div>
        <div className="col" style={{ gap: 'var(--sp-2)' }}>
          <div className="col" style={{ gap: 4 }}><span className="flabel">Trusted · {k.known_key_type}</span><div className="fp" style={{ textDecoration: 'line-through', color: 'var(--text-tertiary)' }}>{k.known_fingerprint}</div></div>
          <div className="col" style={{ gap: 4 }}><span className="flabel danger-t">Presented now · {k.key_type}</span><div className="fp" style={{ borderColor: 'var(--danger-border)' }}>{k.fingerprint}</div></div>
        </div>
        <div className="field"><label className="flabel" htmlFor={'cf-' + tab.id}>To replace the saved key, type <span className="mono strong">{k.alias}</span></label>
          <div className="input"><input id={'cf-' + tab.id} className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></div></div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className={'btn btn-danger' + (ok ? '' : ' is-disabled')} aria-disabled={!ok} onClick={() => replace()}>Replace key and connect</button>
          <span className="grow" />
          <button type="button" className="btn btn-secondary" data-autofocus onClick={() => sessions.close(tab.id)}>Close session<Key>esc</Key></button>
        </div>
      </form>
    </div>
  );
}
