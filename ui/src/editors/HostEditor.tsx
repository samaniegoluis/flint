// New / edit host (design screen 06). Authentication is one of: a saved credential,
// a key from the vault, a password, or the SSH agent. A stored password is never
// shown; leaving the field empty keeps it.

import { useMemo, useState } from 'react';
import { api, emptyHostPatch, toFlintError } from '../api/backend';
import type { HostView } from '../api/types';
import { useApp } from '../state/app';
import { colorHex, colorName, colorStyle, TAG_COLORS } from '../lib/colors';
import { groupPaths } from '../lib/tree';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { Picker } from '../ui/Picker';

type Mode = 'credential' | 'key' | 'password' | 'agent';

function initialMode(h?: HostView): Mode {
  if (!h) return 'credential';
  if (h.credential) return 'credential';
  if (h.key) return 'key';
  if (h.has_password) return 'password';
  return 'agent';
}

export function HostEditor({ alias, group, onClose, onDelete, onNewCredential }: {
  alias: string | null;
  group: string;
  onClose: () => void;
  onDelete: (alias: string) => void;
  onNewCredential: () => void;
}) {
  const { catalog, refreshCatalog, notify, os } = useApp();
  const host = alias ? catalog.hosts.find((h) => h.alias === alias) : undefined;
  const [f, setF] = useState(() => ({
    alias: host?.alias ?? '',
    label: host?.label ?? '',
    hostname: host?.hostname ?? '',
    port: String(host?.port ?? 22),
    user: host?.user ?? '',
    group: host?.group ?? group,
    tags: host?.tags ?? [],
    color: host?.color ?? '',
    notes: host?.notes ?? '',
    jump: host?.jump ?? '',
    credential: host?.credential ?? (catalog.credentials.length === 1 ? catalog.credentials[0].name : ''),
    key: host?.key ?? '',
    password: '',
  }));
  const [mode, setMode] = useState<Mode>(initialMode(host));
  const [modeChanged, setModeChanged] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of catalog.hosts) if (h.credential) m.set(h.credential, (m.get(h.credential) ?? 0) + 1);
    return m;
  }, [catalog.hosts]);

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,$/, '');
    if (t && !f.tags.includes(t)) set('tags', [...f.tags, t]);
    setTagInput('');
  };

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const port = Number(f.port);
    if (!f.alias.trim() || !f.hostname.trim()) { setError('Alias and hostname are required.'); return; }
    if (!Number.isInteger(port) || port < 1 || port > 65535) { setError('The port must be 1 to 65535.'); return; }
    const p = emptyHostPatch();
    const field = <K extends 'alias' | 'label' | 'hostname' | 'user' | 'group' | 'color' | 'notes' | 'jump'>(k: K, v: string) => {
      if (!host || (host[k] as string) !== v) { p[k] = v; p[`set_${k}` as `set_${K}`] = true as never; }
    };
    field('alias', f.alias.trim());
    field('label', f.label.trim());
    field('hostname', f.hostname.trim());
    field('user', f.user.trim());
    field('group', f.group);
    field('color', f.color);
    field('notes', f.notes);
    field('jump', f.jump);
    if (!host || host.port !== port) { p.port = port; p.set_port = true; }
    if (!host || host.tags.join('\n') !== f.tags.join('\n')) { p.tags = f.tags; p.set_tags = true; }
    const ref = (k: 'credential' | 'key', v: string) => {
      if (!host || host[k] !== v) { p[k] = v; p[`set_${k}`] = true; }
    };
    if (mode === 'credential') ref('credential', f.credential);
    if (mode === 'key') ref('key', f.key);
    if (modeChanged) {
      if (mode !== 'credential') ref('credential', '');
      if (mode !== 'key') ref('key', '');
      if (mode !== 'password' && host?.has_password) { p.password = ''; p.set_password = true; }
    }
    if (mode === 'password' && f.password) { p.password = f.password; p.set_password = true; }
    setBusy(true);
    setError('');
    try {
      const saved = host ? await api.hostEdit(host.alias, p) : await api.hostAdd(p);
      await refreshCatalog();
      notify(host ? `Saved ${saved.alias}` : `Added ${saved.alias}`);
      onClose();
    } catch (err) {
      setError(toFlintError(err).message);
      setBusy(false);
    }
  };

  const c = colorStyle(f.color);
  const modes: { m: Mode; icon: 'cred' | 'key' | 'lock' | 'link'; label: string }[] = [
    { m: 'credential', icon: 'cred', label: 'Credential' },
    { m: 'key', icon: 'key', label: 'Key' },
    { m: 'password', icon: 'lock', label: 'Password' },
    { m: 'agent', icon: 'link', label: 'Agent' },
  ];
  return (
    <Modal label={host ? `Edit host ${host.alias}` : 'New host'} onClose={onClose} width={680} top={52}>
      <form onSubmit={save} onKeyDown={(e) => { if (e.key === 'Enter' && (os === 'mac' ? e.metaKey : e.ctrlKey)) save(); }} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="modal-h">
          <span className={'hmark ' + c.className} style={{ height: 20, ...c.style }} />
          <h2 className="grow">{host ? <>Edit host <span className="mono muted" style={{ fontWeight: 'var(--fw-regular)' }}>{host.alias}</span></> : 'New host'}</h2>
          {host && <Kbd action="editHost" />}
          <button type="button" className="icon-btn" aria-label="Close (esc)" onClick={onClose}><Icon name="x" size="sm" /></button>
        </div>
        <div className="modal-b scroll" style={{ gap: 'var(--sp-4)', paddingBottom: 'var(--sp-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
            <div className="field"><label className="flabel" htmlFor="ha">Alias</label>
              <div className="input"><input id="ha" className="mono" value={f.alias} onChange={(e) => set('alias', e.target.value)} placeholder="prod-api-01" data-autofocus autoFocus /></div>
              <span className="hint">What you type in <span className="mono">flint connect</span>.</span></div>
            <div className="field"><label className="flabel" htmlFor="hl">Label <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· optional</span></label>
              <div className="input"><input id="hl" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="API server 1" /></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px', gap: 'var(--sp-4)' }}>
              <div className="field"><label className="flabel" htmlFor="hh">Hostname</label>
                <div className="input"><input id="hh" className="mono" value={f.hostname} onChange={(e) => set('hostname', e.target.value)} placeholder="10.0.4.21" /></div></div>
              <div className="field"><label className="flabel" htmlFor="hp">Port</label>
                <div className="input"><input id="hp" className="mono" inputMode="numeric" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} /></div></div>
            </div>
            <div className="field"><span className="flabel">Folder</span>
              <Picker label="Folder" value={f.group} onChange={(v) => set('group', v)} icon="folder" placeholder="No folder"
                options={[{ value: '', label: 'No folder', text: '' }, ...groupPaths(catalog.groups).map((g) => ({ value: g, label: g.split('/').join(' / '), text: g }))]} /></div>
          </div>
          <div className="field">
            <span className="flabel">Authentication</span>
            <div className="seg full" role="group" aria-label="Authentication method">
              {modes.map((x) => (
                <button key={x.m} type="button" aria-pressed={mode === x.m} onClick={() => { setMode(x.m); setModeChanged(true); }}><Icon name={x.icon} size="sm" />{x.label}</button>
              ))}
            </div>
            {mode === 'credential' && (
              <Picker label="Credential" value={f.credential} onChange={(v) => set('credential', v)} icon="cred" placeholder="Choose a credential"
                options={catalog.credentials.map((cr) => ({ value: cr.name, text: cr.name + ' ' + cr.user, label: <>{cr.name} <span className="faint mono">· {cr.user} · {cr.key ? 'key ' + cr.key : cr.has_password ? 'password' : 'agent'}</span></>, meta: `${usage.get(cr.name) ?? 0} hosts` }))}
                footer={{ label: 'New credential…', run: onNewCredential }} />
            )}
            {mode === 'key' && (
              <Picker label="SSH key" value={f.key} onChange={(v) => set('key', v)} icon="key" placeholder={catalog.keys.length ? 'Choose a key' : 'No keys in this vault yet'}
                options={catalog.keys.map((k) => ({ value: k.name, text: k.name, label: <>{k.name} <span className="faint mono">· {k.type}</span></> }))} />
            )}
            {mode === 'password' && (
              <div className="input"><Icon name="lock" size="sm" className="faint" />
                <input type="password" className="pw" aria-label="Password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="off"
                  placeholder={host?.has_password ? 'Saved — type to replace' : 'Password'} /></div>
            )}
            {mode === 'agent' && <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />Uses the keys loaded in your SSH agent (<span className="mono">SSH_AUTH_SOCK</span>).</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
            <div className="field"><label className="flabel" htmlFor="hu">User {mode === 'credential' && <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· overrides the credential's</span>}</label>
              <div className="input"><input id="hu" className="mono" value={f.user} onChange={(e) => set('user', e.target.value)} placeholder={mode === 'credential' ? 'from the credential' : 'root'} /></div></div>
            <div className="field"><span className="flabel">Jump host <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· optional</span></span>
              <Picker label="Jump host" value={f.jump} onChange={(v) => set('jump', v)} icon="jump" placeholder="None"
                options={[{ value: '', label: 'None', text: '' }, ...catalog.hosts.filter((h) => h.alias !== host?.alias).map((h) => ({ value: h.alias, text: h.alias, label: <span className="mono">{h.alias}</span>, meta: h.group }))]} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 'var(--sp-4)' }}>
            <div className="field"><span className="flabel">Tags</span>
              <div className="tags">
                {f.tags.map((t) => <span key={t} className="tag">{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => set('tags', f.tags.filter((x) => x !== t))}><Icon name="x" size="xs" /></button></span>)}
                <input aria-label="Add tag" placeholder="Add tag…" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
                    if (e.key === 'Backspace' && !tagInput && f.tags.length) set('tags', f.tags.slice(0, -1));
                  }} onBlur={() => tagInput && addTag(tagInput)} />
              </div></div>
            <div className="field"><span className="flabel">Colour</span>
              <div className="swatches" role="radiogroup" aria-label="Host colour" style={{ height: 'var(--control-h)' }}>
                <button type="button" className="sw none" role="radio" aria-checked={!f.color} aria-label="None" onClick={() => set('color', '')} />
                {TAG_COLORS.map((n) => (
                  <button key={n} type="button" className={'sw c-' + n} role="radio" aria-checked={colorName(f.color) === n} aria-label={n} onClick={() => set('color', colorHex(n))} />
                ))}
              </div></div>
          </div>
          <div className="field"><label className="flabel" htmlFor="hn">Notes</label>
            <div className="input area"><textarea id="hn" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div></div>
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          {host && <button type="button" className="btn btn-danger-ghost" onClick={() => onDelete(host.alias)}><Icon name="trash" size="sm" />Delete host</button>}
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{host ? 'Save' : 'Add host'}<span className="kbd-in">{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</span></button>
        </div>
      </form>
    </Modal>
  );
}
