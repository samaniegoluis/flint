// The Tunnels view (milestone 23, design 20a, 20b): every saved tunnel grouped by host,
// each with a switch and its live state. A host's start logs in here, with its prompt
// cards inline in the host's group (password, unknown host key, login failed). The
// local side is always 127.0.0.1 (D-062).

import { useMemo, useState } from 'react';
import type { TunnelView } from '../api/types';
import { useApp } from '../state/app';
import { colorStyle } from '../lib/colors';
import { useSessions } from '../sessions/store';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { key, stateLine, switchedOn, tunnels, upOn, useTunnels, type Start } from './store';

export function TunnelsView({ resizer, onEditHost, onConnect, onPickHost }: {
  resizer: React.ReactNode;
  onEditHost: (alias: string) => void;
  onConnect: (alias: string) => void;
  /** The empty state's "Choose a host…": the palette's host list. */
  onPickHost: () => void;
}) {
  const { os, catalog } = useApp();
  const snap = useTunnels();
  const { panes } = useSessions();
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; host: string } | null>(null);
  const here = os === 'mac' ? 'this Mac' : 'this computer';

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const by = new Map<string, TunnelView[]>();
    for (const v of snap.list) {
      if (f && !(v.name.toLowerCase().includes(f) || v.host.toLowerCase().includes(f) || String(v.local_port).includes(f) || v.destination.toLowerCase().includes(f))) continue;
      by.set(v.host, [...(by.get(v.host) ?? []), v]);
    }
    return [...by.entries()];
  }, [snap.list, filter]);
  const up = snap.list.filter((v) => v.state === 'listening').length;

  const menuItems = (host: string): MenuItem[] => {
    const all = snap.list.filter((v) => v.host === host);
    const items: MenuItem[] = [];
    if (all.some((v) => v.state !== 'listening')) items.push({ label: 'Start all', icon: 'tunnel', run: () => tunnels.startTunnels(host, all.filter((v) => v.state !== 'listening').map((v) => v.name)) });
    if (upOn(snap.list, host).length > 0) items.push({ label: 'Stop all', icon: 'x', run: () => { void tunnels.stopHost(host); } });
    items.push({ label: 'Open a tab', icon: 'term', sep: items.length > 0, run: () => onConnect(host) });
    items.push({ label: 'Manage tunnels…', icon: 'edit', run: () => onEditHost(host) });
    return items;
  };

  return (
    <aside className="sidebar" data-for="tunnels" aria-label="Tunnels" data-tunnels-view>
      <div className="side-title">
        <span className="strong grow" style={{ fontSize: 'var(--fs-sm)' }}>Tunnels</span>
        {up > 0 && <span className="hint">{up} up</span>}
      </div>
      <label className="search side-search">
        <Icon name="search" size="sm" />
        <input aria-label="Filter tunnels" placeholder="Filter by name, host or port" value={filter} disabled={snap.list.length === 0}
          onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && filter) { e.stopPropagation(); setFilter(''); } }} data-tunnels-filter />
      </label>
      <div className="tun-scroll">
        {snap.loaded && snap.list.length === 0 && (
          <div className="empty" style={{ padding: 'var(--sp-6) var(--sp-5)', gap: 'var(--sp-3)' }} data-tunnels-empty>
            <span className="empty-ic"><Icon name="tunnel" /></span>
            <h2 style={{ fontSize: 'var(--fs-md)' }}>No tunnels yet</h2>
            <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-ui)' }}>A tunnel lets an app on {here} reach a service that only listens inside a server:</span>
            <span className="fp" style={{ fontSize: 'var(--fs-xs)', textAlign: 'left' }}>127.0.0.1:5432 here<span className="faint"> → </span>localhost:5432 on db1</span>
            <span className="hint" style={{ lineHeight: 1.5 }}>Add one in a host's editor, under Tunnels. It uses that host's login and jump host.</span>
            {catalog.hosts.length > 0 && <button className="btn btn-secondary btn-sm" onClick={onPickHost}><Icon name="hosts" size="sm" />Choose a host…</button>}
          </div>
        )}
        {snap.list.length > 0 && groups.length === 0 && <span className="hint" style={{ display: 'block', padding: 'var(--sp-3)' }}>No tunnel matches.</span>}
        {groups.map(([host, list]) => {
          const h = catalog.hosts.find((x) => x.alias === host);
          const c = colorStyle(h?.color ?? '');
          const start = snap.starts[host];
          const lost = list.some((v) => v.state === 'connection lost');
          const running = list.some((v) => v.state === 'listening');
          const tab = panes.some((p) => p.alias === host && p.status !== 'ended');
          const meta = lost ? 'connection lost' : start ? 'logging in…' : running ? (tab ? 'tab open' : 'no tab · own session') : tab ? 'tab open' : 'not connected';
          const lostWhy = list.find((v) => v.state === 'connection lost')?.error;
          return (
            <section key={host} className="tun-group" aria-label={`Tunnels on ${host}`} data-tunnel-host={host}>
              <div className="tun-gh">
                <span className={'hmark ' + c.className} style={c.style} />
                <span className="mono strong grow trunc">{host}</span>
                <span className={'gmeta' + (lost ? ' danger-t' : '')}>{meta}</span>
                <button className="icon-btn" aria-label={`More for ${host}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, host }); }}><Icon name="more" size="sm" /></button>
              </div>
              {lost && (
                <div className="ferr" style={{ padding: '0 var(--sp-3) var(--sp-1) var(--sp-4)' }}>
                  <Icon name="wifi-off" /><span>{lostWhy ? lostWhy + ' · ' : ''}all its tunnels stopped. Flip a switch to log in again.</span>
                </div>
              )}
              {start && <StartCard start={start} host={host} />}
              {!start && snap.loginFailed[host] && (
                <div className="tun-card danger" role="alert" data-tunnel-login-failed>
                  <div className="prompt-h" style={{ gap: 'var(--sp-2)' }}>
                    <span className="prompt-ic danger" style={{ width: 28, height: 28 }}><Icon name="lock" size="sm" /></span>
                    <div className="col grow" style={{ gap: 2 }}>
                      <span className="strong" style={{ fontSize: 'var(--fs-sm)' }}>{snap.loginFailed[host].code === 'auth' ? 'Authentication failed' : `Could not log in to ${host}`}</span>
                      <span className="hint">{snap.loginFailed[host].message}</span>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 'var(--sp-2)' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => onEditHost(host)}>Edit host</button>
                    <span className="grow" />
                    <button className="btn btn-ghost btn-sm" onClick={() => tunnels.dismissLogin(host)}>Dismiss</button>
                    <button className="btn btn-primary btn-sm" onClick={() => tunnels.startTunnels(host, list.filter((v) => snap.failed[key(host, v.name)]).map((v) => v.name))}>Retry</button>
                  </div>
                </div>
              )}
              <div role="list">
                {list.map((v) => <TunnelRow key={v.name} v={v} />)}
              </div>
            </section>
          );
        })}
      </div>
      <div className="tun-foot"><Icon name="shield" /><span>The local side is always <span className="mono">127.0.0.1</span>: only {here} can connect, never your network.</span></div>
      {resizer}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.host)} onClose={() => setMenu(null)} />}
    </aside>
  );
}

function TunnelRow({ v }: { v: TunnelView }) {
  const snap = useTunnels();
  const on = switchedOn(v, snap);
  const st = stateLine(v, snap);
  const icon = st.kind === 'danger' ? (v.state === 'connection lost' ? 'wifi-off' : 'lock') : st.kind === 'warn' ? 'alert' : null;
  return (
    <div className="tun" role="listitem" data-tunnel={v.name} data-state={st.kind}>
      <button className="toggle" role="switch" aria-checked={on} aria-label={`Tunnel ${v.name}`} data-tunnel-switch={v.name}
        onClick={() => { void tunnels.toggle(v); }} />
      <span className="tun-n">{v.name}</span>
      <span className="tun-map" title={`127.0.0.1:${v.local_port} → ${v.destination}`}>127.0.0.1:{v.local_port}<span className="arr">→</span>{v.destination}</span>
      <span className={'tun-st ' + (st.kind === 'idle' ? '' : st.kind)} data-tunnel-state>
        {st.kind === 'wait' ? <span className="mini-spin" /> : icon ? <Icon name={icon} size="xs" /> : <span className={'dot ' + (st.kind === 'ok' ? 'ok' : 'idle')} />}
        <span>{st.text}</span>
      </span>
    </div>
  );
}

/** A start logging in for `host` (design 20b1-20b3). */
function StartCard({ start, host }: { start: Start; host: string }) {
  const [pw, setPw] = useState('');
  const p = start.prompt;
  if (start.status === 'prompt' && p?.kind === 'password') {
    return (
      <form className="tun-card" aria-label={`Password for ${p.user}@${p.alias}`} data-tunnel-password
        onSubmit={(e) => { e.preventDefault(); tunnels.answer(host, true, pw); setPw(''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tunnels.answer(host, false, ''); } }}>
        <div className="prompt-h" style={{ gap: 'var(--sp-2)' }}>
          <span className="prompt-ic accent" style={{ width: 28, height: 28 }}><Icon name="lock" size="sm" /></span>
          <div className="col grow" style={{ gap: 2 }}>
            <span className="strong" style={{ fontSize: 'var(--fs-sm)' }}>Password for <span className="mono">{p.user}@{p.alias}</span></span>
            <span className="hint">For the tunnels' own session. Save it in the host editor to skip this.</span>
          </div>
        </div>
        <div className="input"><input type="password" className="pw" aria-label="Password" value={pw} autoFocus autoComplete="off" onChange={(e) => setPw(e.target.value)} /></div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => tunnels.answer(host, false, '')}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={!pw}>Connect<span className="kbd-in">↵</span></button>
        </div>
      </form>
    );
  }
  if (start.status === 'prompt' && p?.kind === 'host_key') {
    const k = p.host_key;
    return (
      <form className="tun-card" aria-label={`Verify ${k.alias}`} data-tunnel-hostkey
        onSubmit={(e) => { e.preventDefault(); tunnels.answer(host, true, ''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tunnels.answer(host, false, ''); } }}>
        <div className="prompt-h" style={{ gap: 'var(--sp-2)' }}>
          <span className="prompt-ic warn" style={{ width: 28, height: 28 }}><Icon name="shield" size="sm" /></span>
          <div className="col grow" style={{ gap: 2 }}>
            <span className="strong" style={{ fontSize: 'var(--fs-sm)' }}>Verify <span className="mono">{k.alias}</span></span>
            <span className="hint">First connection. Compare the fingerprint.</span>
          </div>
        </div>
        <div className="fp" style={{ fontSize: 'var(--fs-xs)', padding: '6px var(--sp-2)' }}>{k.key_type} · {k.fingerprint}</div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => tunnels.answer(host, false, '')}>Cancel</button>
          <span className="grow" />
          <button className="btn btn-primary btn-sm" autoFocus>Trust<span className="kbd-in">↵</span></button>
        </div>
      </form>
    );
  }
  const names = start.names.length ? start.names.join(', ') : start.all ? 'every tunnel' : 'its Open when I connect tunnels';
  return (
    <div className="tun-card" aria-live="polite" data-tunnel-connecting
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tunnels.cancel(host); } }}>
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <span className="mini-spin" style={{ width: 12, height: 12 }} />
        <span className="strong" style={{ fontSize: 'var(--fs-sm)' }}>Connecting to <span className="mono">{host}</span></span>
      </div>
      <span className="hint">Opens {names}. No terminal: the tunnels get a session of their own.</span>
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => tunnels.cancel(host)}>Cancel<Key>esc</Key></button>
    </div>
  );
}
