// New / edit an RDP host (design 21b). The type is fixed (a badge in the header).
// Address, port (3389 when left empty), user, an optional Windows domain, and a login:
// the host's own password or a credential that has one. No jump host, initial command,
// sudo or tunnels: those are SSH's. Testing the connection arrives with the RDP tab.

import { useState } from 'react';
import { api, emptyHostPatch, toFlintError } from '../api/backend';
import type { HostPatch, HostView } from '../api/types';
import { useApp } from '../state/app';
import { colorHex, colorName, colorStyle, TAG_COLORS } from '../lib/colors';
import { groupPaths } from '../lib/tree';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { Picker } from '../ui/Picker';
import { PasswordField } from '../ui/PasswordField';
import { TypeBadge } from './TypeBadge';

export const RDP_PORT = 3389;

type Login = 'password' | 'credential';

export function RdpHostEditor({ host, group, onClose, onDelete, onNewCredential }: {
  host: HostView | undefined;
  group: string;
  onClose: () => void;
  onDelete: (alias: string) => void;
  onNewCredential: () => void;
}) {
  const { catalog, refreshCatalog, notify, os } = useApp();
  const withPassword = catalog.credentials.filter((c) => c.has_password);
  const [f, setF] = useState(() => ({
    alias: host?.alias ?? '',
    label: host?.label ?? '',
    hostname: host?.hostname ?? '',
    port: host && host.port !== RDP_PORT ? String(host.port) : '',
    user: host?.user ?? '',
    domain: host?.domain ?? '',
    group: host?.group ?? group,
    tags: host?.tags ?? [],
    color: host?.color ?? '',
    notes: host?.notes ?? '',
    credential: host?.credential ?? (withPassword.length === 1 ? withPassword[0].name : ''),
    password: '',
  }));
  const [login, setLogin] = useState<Login>(host?.credential ? 'credential' : 'password');
  const [loginChanged, setLoginChanged] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [errs, setErrs] = useState<{ alias?: string; hostname?: string; port?: string }>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,$/, '');
    if (t && !f.tags.includes(t)) set('tags', [...f.tags, t]);
    setTagInput('');
  };

  // The form as a patch against the saved host (all fields for a new one), or null
  // after marking the fields that are wrong.
  const buildPatch = (): HostPatch | null => {
    const port = f.port.trim() ? Number(f.port) : RDP_PORT;
    const e: typeof errs = {};
    if (!f.alias.trim()) e.alias = 'Enter an alias: the name you type in flint connect.';
    if (!f.hostname.trim()) e.hostname = 'Enter an address: a name like win-01.corp.lan or an IP.';
    if (!Number.isInteger(port) || port < 1 || port > 65535) e.port = 'Use 1–65535.';
    setErrs(e);
    if (Object.keys(e).length > 0) return null;
    const p = emptyHostPatch();
    if (!host) { p.type = 'rdp'; p.set_type = true; }
    const field = <K extends 'alias' | 'label' | 'hostname' | 'user' | 'group' | 'color' | 'notes' | 'domain'>(k: K, v: string) => {
      if (!host || (host[k] as string) !== v) { p[k] = v; p[`set_${k}` as `set_${K}`] = true as never; }
    };
    field('alias', f.alias.trim());
    field('label', f.label.trim());
    field('hostname', f.hostname.trim());
    field('user', f.user.trim());
    field('domain', f.domain.trim());
    field('group', f.group);
    field('color', f.color);
    field('notes', f.notes);
    if (!host || host.port !== port) { p.port = port; p.set_port = true; }
    if (!host || host.tags.join('\n') !== f.tags.join('\n')) { p.tags = f.tags; p.set_tags = true; }
    if (login === 'credential' && (!host || host.credential !== f.credential)) { p.credential = f.credential; p.set_credential = true; }
    if (loginChanged) {
      if (login !== 'credential' && host?.credential) { p.credential = ''; p.set_credential = true; }
      if (login !== 'password' && host?.has_password) { p.password = ''; p.set_password = true; }
    }
    if (login === 'password' && f.password) { p.password = f.password; p.set_password = true; }
    return p;
  };

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const p = buildPatch();
    if (!p) return;
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
  const ferr = (m?: string) => m && <span className="ferr" role="alert"><Icon name="alert" /><span>{m}</span></span>;
  const credOptions = [
    ...withPassword.map((cr) => ({ value: cr.name, text: cr.name + ' ' + cr.user, label: <>{cr.name} <span className="faint mono">· {cr.user}</span></>, meta: cr.key ? 'password + key' : 'password' })),
    ...catalog.credentials.filter((cr) => !cr.has_password).map((cr) => ({
      value: cr.name, text: cr.name + ' ' + cr.user, label: <>{cr.name} <span className="mono">· {cr.user}</span></>,
      meta: cr.key ? 'key only' : 'agent', disabled: cr.key ? 'Only has an SSH key. RDP needs a password.' : 'Has no password. RDP needs one.',
    })),
  ];

  return (
    <Modal label={host ? `Edit host ${host.alias}` : 'New RDP host'} onClose={onClose} width={680} top={52}>
      <form data-rdp-editor onSubmit={save} onKeyDown={(e) => { if (e.key === 'Enter' && (os === 'mac' ? e.metaKey : e.ctrlKey)) save(); }} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="modal-h">
          {f.color && <span className={'hmark ' + c.className} style={{ height: 20, ...c.style }} />}
          <h2 className="grow">{host ? <>Edit host <span className="mono muted" style={{ fontWeight: 'var(--fw-regular)' }}>{host.alias}</span></> : 'New host'}</h2>
          <TypeBadge type="rdp" />
          {host && <Kbd action="editHost" />}
          <button type="button" className="icon-btn" aria-label="Close (esc)" onClick={onClose}><Icon name="x" size="sm" /></button>
        </div>
        <div className="modal-b scroll" style={{ gap: 'var(--sp-4)', paddingBottom: 'var(--sp-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)', alignItems: 'start' }}>
            <div className="field"><label className="flabel" htmlFor="ra">Alias</label>
              <div className={'input' + (errs.alias ? ' err' : '')}><input id="ra" className="mono" value={f.alias} onChange={(e) => set('alias', e.target.value)} placeholder="win-01" data-autofocus autoFocus /></div>
              {ferr(errs.alias) || <span className="hint">What you type in <span className="mono">flint connect</span>.</span>}</div>
            <div className="field"><label className="flabel" htmlFor="rl">Label <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· optional</span></label>
              <div className="input"><input id="rl" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Reception PC" /></div></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px', gap: 'var(--sp-4)', alignItems: 'start' }}>
            <div className="field"><label className="flabel" htmlFor="rh">Address</label>
              <div className={'input' + (errs.hostname ? ' err' : '')}><input id="rh" className="mono" value={f.hostname} onChange={(e) => set('hostname', e.target.value)} placeholder="name or IP" /></div>
              {ferr(errs.hostname)}</div>
            <div className="field"><label className="flabel" htmlFor="rp">Port</label>
              <div className={'input' + (errs.port ? ' err' : '')}><input id="rp" className="mono" inputMode="numeric" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} placeholder={String(RDP_PORT)} /></div>
              {ferr(errs.port)}</div>
          </div>
          <div className="field"><span className="flabel">Folder</span>
            <Picker label="Folder" value={f.group} onChange={(v) => set('group', v)} icon="folder" placeholder="No folder"
              options={[{ value: '', label: 'No folder', text: '' }, ...groupPaths(catalog.groups).map((g) => ({ value: g, label: g.split('/').join(' / '), text: g }))]} /></div>
          <div className="field">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
              <div className="field"><label className="flabel" htmlFor="ru">User {login === 'credential' && <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· overrides the credential's</span>}</label>
                <div className="input"><input id="ru" className="mono" value={f.user} onChange={(e) => set('user', e.target.value)} placeholder={login === 'credential' ? 'from the credential' : 'Administrator'} /></div></div>
              <div className="field"><label className="flabel" htmlFor="rd">Domain <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· optional</span></label>
                <div className="input"><input id="rd" className="mono" value={f.domain} onChange={(e) => set('domain', e.target.value)} placeholder="e.g. CORP" /></div></div>
            </div>
            <span className="hint"><span className="mono">DOMAIN\user</span> and <span className="mono">user@domain</span> also work in User.</span>
          </div>
          <div className="field">
            <span className="flabel">Login</span>
            <div className="seg full" role="group" aria-label="Login">
              <button type="button" aria-pressed={login === 'password'} onClick={() => { setLogin('password'); setLoginChanged(true); }}><Icon name="lock" size="sm" />Own password</button>
              <button type="button" aria-pressed={login === 'credential'} onClick={() => { setLogin('credential'); setLoginChanged(true); }}><Icon name="cred" size="sm" />Credential</button>
            </div>
            {login === 'password' ? (
              <>
                <PasswordField value={f.password} onChange={(v) => set('password', v)}
                  saved={host?.has_password ? { kind: 'host', name: host.alias } : null}
                  placeholder={host?.has_password ? 'Saved — type to replace' : 'Password'} />
                <span className="hint">Stored in the vault, encrypted. RDP never uses an SSH key.</span>
              </>
            ) : (
              <>
                <Picker label="Credential" value={f.credential} onChange={(v) => set('credential', v)} icon="cred"
                  placeholder={withPassword.length ? 'Choose a credential' : 'No credential with a password yet'}
                  options={credOptions} footer={{ label: 'New credential with a password…', run: onNewCredential }} />
                <span className="hint">Only credentials with a password can sign in to a remote desktop.</span>
              </>
            )}
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
          <div className="field"><label className="flabel" htmlFor="rn">Notes</label>
            <div className="input area"><textarea id="rn" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div></div>
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          {host && <button type="button" className="btn btn-danger-ghost" onClick={() => onDelete(host.alias)}><Icon name="trash" size="sm" />Delete host</button>}
          <span className="reserved" data-test-reserved title="Testing an RDP host arrives with the remote desktop tab.">Test connection · coming soon</span>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{host ? 'Save' : 'Add host'}<span className="kbd-in">{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</span></button>
        </div>
      </form>
    </Modal>
  );
}
