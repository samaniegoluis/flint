// The host editor's Tunnels section (milestone 23, design 06c1, 06c1b) and the dialog
// that adds or edits one (06c2a, 06c2b). A tunnel is saved the moment its dialog is
// confirmed, or its "Open when I connect" box is ticked: it is not part of the host's
// own Save (D-064). The local side is always 127.0.0.1 and has no field (D-062).

import { useEffect, useRef, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import type { TunnelView } from '../api/types';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { tunnels, useTunnels } from './store';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

/** Splits a destination as the core writes it: `host:port`, `[v6]:port`. */
export function splitDestination(d: string): { host: string; port: string } {
  const m = /^\[(.+)\]:(\d+)$/.exec(d) ?? /^(.*):(\d+)$/.exec(d);
  return m ? { host: m[1], port: m[2] } : { host: d, port: '' };
}

/** Other saved tunnels that use the same local port (06c2a's warning). */
export function sharedPort(list: TunnelView[], port: number, host: string, self: string): TunnelView[] {
  return list.filter((v) => v.local_port === port && !(v.host === host && v.name.toLowerCase() === self.toLowerCase()));
}

export function HostTunnels({ host, focus }: { host: string | null; focus: boolean }) {
  const { os, notify, fail } = useApp();
  const snap = useTunnels();
  const [editing, setEditing] = useState<TunnelView | 'new' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const here = os === 'mac' ? t('tunnels.this_mac') : t('tunnels.this_computer');
  const list = host ? snap.list.filter((v) => v.host === host) : [];

  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'center' });
  }, [focus]);

  if (!host) {
    return (
      <div className="tun-sec" data-host-tunnels>
        <span className="flabel row" style={{ gap: 'var(--sp-2)' }}><Icon name="tunnel" size="sm" className="info-t" />{t('host_tunnels.tunnels')}</span>
        <span className="hint">{t('host_tunnels.add_the_host_first_then')}</span>
      </div>
    );
  }

  const setOpen = async (v: TunnelView, open: boolean) => {
    const d = splitDestination(v.destination);
    try {
      await api.tunnelSave({ host: v.host, target: v.name, name: v.name, local_port: v.local_port, dest_host: d.host, dest_port: Number(d.port), open_on_connect: open });
      await tunnels.refresh();
    } catch (err) { fail(err); }
  };
  const remove = async (v: TunnelView) => {
    try {
      await api.tunnelRm(v.host, v.name);
      await tunnels.refresh();
      notify(t('host_tunnels.removed_tunnel_name', { name: v.name }));
    } catch (err) { fail(err); }
  };

  return (
    <div className="tun-sec" ref={ref} data-host-tunnels>
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <span className="flabel row grow" style={{ gap: 'var(--sp-2)' }}><Icon name="tunnel" size="sm" className="info-t" />{t('host_tunnels.tunnels')}{list.length > 0 && <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· {list.length}</span>}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing('new')} data-add-tunnel autoFocus={focus}><Icon name="plus" size="sm" />{t('host_tunnels.add_tunnel')}</button>
      </div>
      {list.length === 0 ? (
        <span className="hint" style={{ lineHeight: 1.5, fontSize: 'var(--fs-sm)' }}>
          {tr('host_tunnels.no_tunnels_a_tunnel_lets', { here, host, span: <span className="mono">127.0.0.1:5432</span>, span2: <span className="mono">localhost:5432</span> })}</span>
      ) : (
        <>
          <div className="col" role="list" style={{ gap: 4 }}>
            {list.map((v) => (
              <div key={v.name} className="tun-row" role="listitem" data-host-tunnel={v.name}>
                <span className="nm">{v.name}</span>
                <span className="mp">127.0.0.1:{v.local_port}<span className="arr">→</span>{v.destination}</span>
                <label className="opt"><input type="checkbox" checked={v.open_on_connect} onChange={(e) => { void setOpen(v, e.target.checked); }} data-open-on-connect={v.name} />
                  <span className="opt-t"><span className="opt-l" style={{ fontSize: 'var(--fs-sm)' }}>{t('host_tunnels.open_when_i_connect')}</span></span></label>
                <span className="acts">
                  <button type="button" className="icon-btn" aria-label={t('host_tunnels.edit_tunnel_name', { name: v.name })} onClick={() => setEditing(v)}><Icon name="edit" size="sm" /></button>
                  <button type="button" className="icon-btn" aria-label={t('host_tunnels.remove_tunnel_name', { name: v.name })} onClick={() => { void remove(v); }}><Icon name="trash" size="sm" /></button>
                </span>
              </div>
            ))}
          </div>
          <span className="hint">{tr('host_tunnels.they_use_this_host_s', { span: <span className="mono">127.0.0.1</span> })}</span>
        </>
      )}
      {editing && <TunnelDialog host={host} tunnel={editing === 'new' ? null : editing} all={snap.list} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TunnelDialog({ host, tunnel, all, onClose }: { host: string; tunnel: TunnelView | null; all: TunnelView[]; onClose: () => void }) {
  const { os, notify } = useApp();
  const d = tunnel ? splitDestination(tunnel.destination) : { host: '', port: '' };
  const [name, setName] = useState(tunnel?.name ?? '');
  const [local, setLocal] = useState(tunnel ? String(tunnel.local_port) : '');
  const [destHost, setDestHost] = useState(d.host === 'localhost' ? '' : d.host);
  const [destPort, setDestPort] = useState(d.port);
  const [open, setOpen] = useState(tunnel?.open_on_connect ?? false);
  const [err, setErr] = useState<{ field: 'name' | 'local' | 'dest' | 'form'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const here = os === 'mac' ? t('tunnels.this_mac') : t('tunnels.this_computer');

  const localNo = Number(local);
  const shared = Number.isInteger(localNo) && localNo > 0 ? sharedPort(all, localNo, host, tunnel?.name ?? name) : [];
  const portOk = (p: string) => /^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= 65535;

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // React events cross the portal: the host editor's form must not see this submit.
    e?.stopPropagation();
    if (busy) return;
    const n = name.trim();
    if (!n) { setErr({ field: 'name', text: t('host_tunnels.give_the_tunnel_a_name') }); return; }
    if (all.some((v) => v.host === host && v.name.toLowerCase() === n.toLowerCase() && v.name !== tunnel?.name)) {
      setErr({ field: 'name', text: t('host_tunnels.host_already_has_a_tunnel', { host, n }) });
      return;
    }
    if (!portOk(local)) { setErr({ field: 'local', text: t('host_tunnels.use_a_port_from_1') }); return; }
    const dp = destPort.trim() || local;
    if (!portOk(dp)) { setErr({ field: 'dest', text: t('host_tunnels.use_a_port_from_1') }); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.tunnelSave({ host, target: tunnel?.name ?? '', name: n, local_port: Number(local), dest_host: destHost.trim() || 'localhost', dest_port: Number(dp), open_on_connect: open });
      await tunnels.refresh();
      notify(tunnel ? t('host_tunnels.saved_tunnel_n', { n }) : t('host_tunnels.added_tunnel_n', { n }));
      onClose();
    } catch (x) {
      const fe = toFlintError(x);
      setErr({ field: fe.code === 'conflict' ? 'name' : /destination/.test(fe.message) ? 'dest' : /port/.test(fe.message) ? 'local' : 'form', text: fe.message });
      setBusy(false);
    }
  };

  const ferr = (field: 'name' | 'local' | 'dest' | 'form') => err?.field === field && (
    <span className="ferr" role="alert"><Icon name="alert" /><span>{err.text}</span></span>
  );

  return (
    <Modal label={tunnel ? t('host_tunnels.edit_tunnel_name', { name: tunnel.name }) : t('host_tunnels.add_tunnel')} onClose={onClose} width={520} top={120} layer={2}>
      <form onSubmit={save} onKeyDown={(e) => { if (e.key === 'Enter' && (os === 'mac' ? e.metaKey : e.ctrlKey)) { e.stopPropagation(); void save(); } }} data-tunnel-dialog>
        <div className="modal-h">
          <span className="prompt-ic info" style={{ width: 28, height: 28 }}><Icon name="tunnel" size="sm" /></span>
          <h2 className="grow">{tunnel ? t('host_tunnels.edit_tunnel') : t('host_tunnels.add_tunnel')} <span className="mono muted" style={{ fontWeight: 'var(--fw-regular)' }}>· {host}</span></h2>
          <button type="button" className="icon-btn" aria-label={t('host_tunnels.close_esc')} onClick={onClose}><Icon name="x" size="sm" /></button>
        </div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)' }}>
          <div className="field"><label className="flabel" htmlFor="tun-name">{t('host_tunnels.name')}</label>
            <div className={'input' + (err?.field === 'name' ? ' err' : '')}><input {...plainText} id="tun-name" className="mono" value={name} placeholder="pg" autoFocus data-autofocus onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
            {ferr('name')}
          </div>
          <div className="field"><label className="flabel" htmlFor="tun-local">{tr('host_tunnels.on_here', { here })}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: 'var(--sp-3)', alignItems: 'center' }}>
              <div className={'input' + (err?.field === 'local' ? ' err' : '')}><span className="port-pre">127.0.0.1 :</span><input {...plainText} id="tun-local" className="mono" inputMode="numeric" aria-label={t('host_tunnels.local_port')} value={local} placeholder="5432" onChange={(e) => setLocal(e.target.value.replace(/\D/g, ''))} /></div>
              <span className="hint" style={{ lineHeight: 1.45 }}>{tr('host_tunnels.always_span_only_here_can', { span: <span className="mono">127.0.0.1</span>, here })}</span>
            </div>
            {ferr('local')}
            {!err && shared.length > 0 && (
              <span className="ferr warn" data-shared-port><Icon name="alert" /><span>{tr('host_tunnels.also_used_by_p_you', { p: shared.map((v, i) => <span key={v.host + v.name}>{i > 0 ? (i === shared.length - 1 ? t('common.list_and') : t('common.list_sep')) : ''}{tr('host_tunnels.name_on_host', { name: <span className="mono">{v.name}</span>, host: v.host })}</span>) })}</span></span>
            )}
          </div>
          <div className="field"><span className="flabel">{tr('host_tunnels.on_host_span', { host, span: <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{t('host_tunnels.the_destination_as_the_server')}</span> })}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px', gap: 'var(--sp-3)' }}>
              <div className={'input' + (err?.field === 'dest' ? ' err' : '')}><input {...plainText} className="mono" placeholder="localhost" aria-label={t('host_tunnels.destination_host')} value={destHost} onChange={(e) => setDestHost(e.target.value)} autoComplete="off" /></div>
              <div className={'input' + (err?.field === 'dest' ? ' err' : '')}><input {...plainText} className="mono" inputMode="numeric" aria-label={t('host_tunnels.destination_port')} placeholder={local || 'port'} value={destPort} onChange={(e) => setDestPort(e.target.value.replace(/\D/g, ''))} /></div>
            </div>
            {ferr('dest')}
            <span className="hint" style={{ lineHeight: 1.45 }}>{tr('host_tunnels.span_is_host_itself_an', { span: <span className="mono">localhost</span>, host, span2: <span className="mono">10.0.0.5</span> })}</span>
          </div>
          <label className="opt"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
            <span className="opt-t"><span className="opt-l">{t('host_tunnels.open_when_i_connect')}</span><span className="hint">{t('host_tunnels.starts_with_the_session_the')}</span></span></label>
          {ferr('form')}
        </div>
        <div className="modal-f">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{tunnel ? t('host_tunnels.save_tunnel') : t('host_tunnels.add_tunnel')}<span className="kbd-in">{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</span></button>
        </div>
      </form>
    </Modal>
  );
}
