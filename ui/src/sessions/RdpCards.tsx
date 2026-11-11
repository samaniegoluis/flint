// The RDP tab's states over its desktop (design 22c, 22d): connecting, the certificate
// prompt on first use, a changed certificate (refused, no way to continue), and one
// card per reason a connection fails. ↵ runs the primary action and esc cancels,
// except on a changed certificate, which has no default action.

import { useEffect, useRef, useState } from 'react';
import type { HostView } from '../api/types';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { RDP_CONNECT_TIMEOUT_S } from '../lib/rdpInput';
import { rdpEndKind, sessions, type Pane } from './store';

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
            <span className="prompt-t">Connecting to <span className="mono">{pane.alias}</span></span>
            <span className="muted mono trunc" style={{ fontSize: 'var(--fs-xs)' }}>{who ? `${who}@` : ''}{address(host, pane.alias)}{host?.credential ? ` · credential ${host.credential}` : host?.has_password ? ' · own password' : ''}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button className="btn btn-secondary btn-sm" data-autofocus onClick={close}>Cancel<Key>esc</Key></button>
          <span className="hint">Times out after {RDP_CONNECT_TIMEOUT_S} s</span>
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
      <div className="card prompt danger" role="alertdialog" aria-label={`The certificate for ${pane.alias} has changed`} style={{ width: 560 }} data-rdp-state="cert-changed"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
        <div className="prompt-h"><span className="prompt-ic danger"><Icon name="shield" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">The certificate for <span className="mono">{pane.alias}</span> has changed</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Nothing was sent. Flint stopped before signing in.</p></div></div>
        <div className="callout danger"><Icon name="alert" size="sm" className="danger-t" /><span>Someone may be intercepting this connection. It also happens when Windows renews its certificate or a VM is rebuilt. <strong>Don't continue unless you know why it changed.</strong></span></div>
        <div className="col" style={{ gap: 'var(--sp-2)' }}>
          <div className="col" style={{ gap: 4 }}><span className="flabel">Trusted</span><div className="fp" style={{ textDecoration: 'line-through', color: 'var(--text-tertiary)' }}>{groupedFingerprint(k.known_fingerprint)}</div></div>
          <div className="col" style={{ gap: 4 }}><span className="flabel danger-t">Presented now{k.subject ? ` · ${k.subject}` : ''}{k.valid_from ? ` · valid from ${k.valid_from}` : ''}</span><div className="fp" style={{ borderColor: 'var(--danger-border)' }}>{groupedFingerprint(k.fingerprint)}</div></div>
        </div>
        <span className="hint">To trust the new one, forget the old certificate in Settings → Known hosts, then connect again. You'll be asked to verify it as on a first connection.</span>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-secondary" data-autofocus onClick={close}>Close tab<Key>esc</Key></button>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onKnownHosts}>Open Known hosts…</button>
        </div>
      </div>,
    );
  }

  if (kind === 'closed') {
    return wrap(
      <div className="card prompt" role="status" style={{ width: 420 }} data-rdp-state="closed" onKeyDown={keys}>
        <div className="prompt-h"><span className="prompt-ic"><Icon name="rdp" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">Disconnected</h2>
            <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Your Windows session keeps running on <span className="mono">{pane.alias}</span>; connecting again brings you back to it.</span></div></div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button className="btn btn-ghost" onClick={close}>Close tab<Key>esc</Key></button>
          <span className="grow" />
          <button className="btn btn-primary" data-autofocus onClick={retry}>Connect again<span className="kbd-in">↵</span></button>
        </div>
      </div>,
    );
  }

  const text = failureText(kind, pane, host);
  return wrap(
    <div className="card prompt" role="alert" style={{ width: 480 }} data-rdp-state={kind} onKeyDown={keys}>
      <div className="prompt-h"><span className="prompt-ic danger"><Icon name={text.icon} /></span>
        <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{text.title}</h2>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{text.body}</p></div></div>
      {pane.end?.message && <span className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>{pane.end.message}</span>}
      {text.hint && <span className="hint">{text.hint}</span>}
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button className="btn btn-ghost" onClick={() => onEditHost(pane.alias)}>Edit host</button>
        <button className="btn btn-ghost" onClick={close}>Close tab<Key>esc</Key></button>
        <span className="grow" />
        <button className="btn btn-primary" data-autofocus onClick={retry}>{kind === 'lost' ? 'Connect again' : 'Retry'}<span className="kbd-in">↵</span></button>
      </div>
    </div>,
  );
}

function failureText(kind: ReturnType<typeof rdpEndKind>, pane: Pane, host: HostView | undefined): { icon: 'lock' | 'wifi-off' | 'clock' | 'shield' | 'alert'; title: string; body: string; hint: string } {
  const addr = address(host, pane.alias);
  const note = host?.notes?.split('\n')[0]?.trim() ?? '';
  switch (kind) {
    case 'auth':
      return { icon: 'lock', title: 'Wrong user or password', body: `${pane.alias} didn't accept ${login(host) || 'the user'} with the saved password.`, hint: 'If the password changed on the domain, update the host or its credential. Several wrong tries can lock the account.' };
    case 'unreachable':
      return { icon: 'wifi-off', title: `Can't reach ${pane.alias}`, body: `There is no route from this computer to ${addr}.`, hint: 'If it is behind a VPN, connect the VPN first.' + (note ? ` Notes for this host say: ${note}` : '') };
    case 'timeout':
      return { icon: 'clock', title: `${pane.alias} didn't answer`, body: `No reply on ${addr} within ${RDP_CONNECT_TIMEOUT_S} s.`, hint: 'The machine may be asleep or off, or a firewall drops RDP. On a Proxmox VM, check that it is running.' };
    case 'rdp-off':
      return { icon: 'wifi-off', title: `${pane.alias} refused the session`, body: "Nothing answers on its Remote Desktop port.", hint: "Turn it on in the machine's Settings → System → Remote Desktop, then retry. On Windows Home it isn't available at all." };
    case 'refused':
      return { icon: 'alert', title: `${pane.alias} refused the session`, body: 'The server answered and would not open a session.', hint: 'All remote sessions may be in use: Windows 10/11 Pro allows one at a time. Ask someone to sign out, or try later.' };
    case 'lost':
      return { icon: 'wifi-off', title: 'Connection lost', body: `Your Windows session keeps running on ${pane.alias} for a while; connecting again brings you back to it, with your windows as you left them.`, hint: '' };
    default:
      return { icon: 'alert', title: `Could not connect to ${pane.alias}`, body: 'The connection failed.', hint: '' };
  }
}

// First connection: the RDP twin of the SSH host key prompt (design 22d1).
function CertificatePrompt({ pane }: { pane: Pane }) {
  const k = pane.prompt!.host_key;
  const self = k.subject !== '' && k.subject === k.issuer;
  return (
    <div className="pane-dim">
      <form className="card prompt" role="alertdialog" aria-label={`Verify ${k.alias}`} style={{ width: 560 }} data-rdp-state="certificate"
        onSubmit={(e) => { e.preventDefault(); sessions.answer(pane.id, true, ''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.answer(pane.id, false, ''); } }}>
        <div className="prompt-h"><span className="prompt-ic warn"><Icon name="shield" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">Verify <span className="mono">{k.alias}</span> before connecting</h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>This server's certificate is not known yet.</p></div></div>
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Address</dt><dd className="mono">{k.addr.replace(/^rdp:\/\//, '')}</dd>
          {k.subject && <><dt>Subject</dt><dd className="mono">{k.subject}</dd></>}
          {k.issuer && <><dt>Issuer</dt><dd className="mono">{k.issuer}{self && <span className="badge" style={{ marginLeft: 'var(--sp-2)' }}>self-signed</span>}</dd></>}
          {k.valid_to && <><dt>Valid</dt><dd className="mono">{k.valid_from} → {k.valid_to}</dd></>}
        </dl>
        <div className="col" style={{ gap: 6 }}><span className="flabel">SHA-256 fingerprint</span><div className="fp" data-fingerprint>{groupedFingerprint(k.fingerprint)}</div></div>
        <span className="hint">Self-signed is normal for Windows hosts and VMs: Windows makes this certificate itself. To compare, run in PowerShell on the server:</span>
        <div className="fp" data-cert-command style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>{"$c = Get-ChildItem 'Cert:\\LocalMachine\\Remote Desktop'; [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($c.RawData))"}</div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => sessions.answer(pane.id, false, '')}>Cancel<Key>esc</Key></button>
          <span className="grow" />
          <button type="submit" className="btn btn-primary" data-autofocus>Trust and connect<span className="kbd-in">↵</span></button>
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
      <form className="card prompt" role="dialog" aria-label={`Password for ${p.user}@${p.alias}`}
        onSubmit={(e) => { e.preventDefault(); sessions.answer(pane.id, true, pw); setPw(''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); sessions.answer(pane.id, false, ''); } }}>
        <div className="prompt-h"><span className="prompt-ic accent"><Icon name="lock" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">Password for <span className="mono">{p.user}</span> on <span className="mono">{p.alias}</span></h2>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>This host has no saved password.</p></div></div>
        <div className="input lg"><input type="password" className="pw" aria-label="Password" value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus autoFocus autoComplete="off" /></div>
        <span className="hint">Used for this connection only. Save it in the host editor to skip this prompt.</span>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => sessions.answer(pane.id, false, '')}>Cancel<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!pw}>Connect<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </div>
  );
}

