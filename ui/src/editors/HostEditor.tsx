// New / edit host (design screen 06). Authentication is one of: a saved credential,
// a key from the vault, a password, or the SSH agent. A stored password stays hidden
// unless the person reveals or copies it (D-029); leaving the field empty keeps it.
// **Test connection** tries the unsaved form (host_test), answering a new host key
// in the editor itself. An RDP host has its own editor (RdpHostEditor, design 21b);
// a new host's type comes from the type step (HostTypeStep, design 21a).

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, emptyHostPatch, on, toFlintError } from '../api/backend';
import type { HostKeyPayload, HostPatch, HostTestEvent, HostType, HostView, SessionPromptEvent } from '../api/types';
import { useApp } from '../state/app';
import { colorHex, colorName, colorStyle, TAG_COLORS } from '../lib/colors';
import { groupPaths } from '../lib/tree';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { Picker } from '../ui/Picker';
import { PasswordField } from '../ui/PasswordField';
import { HostTunnels } from '../tunnels/HostTunnels';
import { RdpHostEditor } from './RdpHostEditor';
import { TypeBadge } from './TypeBadge';

type TestState =
  | { s: 'idle' }
  | { s: 'running' }
  | { s: 'host_key'; prompt: string; key: HostKeyPayload }
  | { s: 'ok'; ev: HostTestEvent }
  | { s: 'fail'; code: string; message: string };

let testSeq = 0;

type Mode = 'credential' | 'key' | 'password' | 'agent';

function initialMode(h?: HostView): Mode {
  if (!h) return 'credential';
  if (h.credential) return 'credential';
  if (h.key) return 'key';
  if (h.has_password) return 'password';
  return 'agent';
}

type EditorProps = {
  alias: string | null;
  group: string;
  /** A new host's type, from the type step; a saved host keeps its own. */
  type?: HostType;
  /** Opened for its Tunnels section (Manage tunnels…): scrolled there. */
  showTunnels?: boolean;
  onClose: () => void;
  onDelete: (alias: string) => void;
  onNewCredential: () => void;
};

export function HostEditor(props: EditorProps) {
  const { catalog } = useApp();
  const host = props.alias ? catalog.hosts.find((h) => h.alias === props.alias) : undefined;
  if ((host?.type ?? props.type) === 'rdp') {
    return <RdpHostEditor host={host} group={props.group} onClose={props.onClose} onDelete={props.onDelete} onNewCredential={props.onNewCredential} />;
  }
  return <SshHostEditor {...props} />;
}

function SshHostEditor({ alias, group, showTunnels = false, onClose, onDelete, onNewCredential }: {
  alias: string | null;
  group: string;
  /** Opened for its Tunnels section (Manage tunnels…): scrolled there. */
  showTunnels?: boolean;
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
    sudo_password: '',
    command: host?.command ?? '',
    keep_shell: host?.keep_shell ?? true,
  }));
  const [mode, setMode] = useState<Mode>(initialMode(host));
  // `exec --sudo` (milestone 13): the login password, or one of the host's own.
  const [sudoOwn, setSudoOwn] = useState(!!host?.has_sudo_password);
  const [sudoChange, setSudoChange] = useState(false);
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

  // The form as a patch against the saved host (all fields for a new one), or an error.
  const buildPatch = (): HostPatch | string => {
    const port = Number(f.port);
    if (!f.alias.trim() || !f.hostname.trim()) return 'Alias and hostname are required.';
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'The port must be 1 to 65535.';
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
    if (!host || host.command !== f.command.trim()) { p.command = f.command.trim(); p.set_command = true; }
    if (!host || host.keep_shell !== f.keep_shell) { p.keep_shell = f.keep_shell; p.set_keep_shell = true; }
    if (sudoOwn && f.sudo_password) { p.sudo_password = f.sudo_password; p.set_sudo_password = true; }
    if (!sudoOwn && host?.has_sudo_password) { p.sudo_password = ''; p.set_sudo_password = true; }
    return p;
  };

  // ---- Test connection --------------------------------------------------------
  const [test, setTest] = useState<TestState>({ s: 'idle' });
  const testId = useRef('');
  useEffect(() => {
    const offEnd = on<HostTestEvent>('host:test', (ev) => {
      if (ev.session !== testId.current) return;
      testId.current = '';
      setTest(ev.code ? { s: 'fail', code: ev.code, message: ev.message } : { s: 'ok', ev });
      if (!ev.code) refreshCatalog();
    });
    const offPrompt = on<SessionPromptEvent>('session:prompt', (ev) => {
      if (ev.session !== testId.current || ev.kind !== 'host_key') return;
      setTest({ s: 'host_key', prompt: ev.prompt, key: ev.host_key });
    });
    return () => {
      offEnd();
      offPrompt();
      if (testId.current) api.sessionClose(testId.current).catch(() => {});
    };
  }, [refreshCatalog]);
  const runTest = async () => {
    if (testId.current) return;
    const p = buildPatch();
    if (typeof p === 'string') { setTest({ s: 'fail', code: 'invalid', message: p }); return; }
    const id = `test-${Date.now().toString(36)}-${++testSeq}`;
    testId.current = id;
    setTest({ s: 'running' });
    try {
      await api.hostTest(id, host?.alias ?? '', p);
    } catch (err) {
      testId.current = '';
      const e = toFlintError(err);
      setTest({ s: 'fail', code: e.code, message: e.message });
    }
  };
  const answerKey = (ok: boolean) => {
    if (test.s !== 'host_key') return;
    api.sessionAnswer(testId.current, test.prompt, ok, '').catch(() => {});
    setTest({ s: 'running' });
  };

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const p = buildPatch();
    if (typeof p === 'string') { setError(p); return; }
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
  // Where "Same as the login password" takes its password from, or that there is none
  // (then the approval window asks for one each time).
  const cred = catalog.credentials.find((c) => c.name === f.credential);
  const loginSource = mode === 'credential' && cred?.has_password ? `From credential “${cred.name}”`
    : mode === 'password' && (f.password || host?.has_password) ? "This host's login password"
    : 'No login password here: the approval window asks for one each time.';

  return (
    <Modal label={host ? `Edit host ${host.alias}` : 'New host'} onClose={onClose} width={680} top={52}>
      <form onSubmit={save} onKeyDown={(e) => { if (e.key === 'Enter' && (os === 'mac' ? e.metaKey : e.ctrlKey)) save(); }} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="modal-h">
          <span className={'hmark ' + c.className} style={{ height: 20, ...c.style }} />
          <h2 className="grow">{host ? <>Edit host <span className="mono muted" style={{ fontWeight: 'var(--fw-regular)' }}>{host.alias}</span></> : 'New host'}</h2>
          <TypeBadge type="ssh" />
          {host && <Kbd action="editHost" />}
          <button type="button" className="icon-btn" aria-label="Close (esc)" onClick={onClose}><Icon name="x" size="sm" /></button>
        </div>
        <div className="modal-b scroll" style={{ gap: 'var(--sp-4)', paddingBottom: 'var(--sp-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
            <div className="field"><label className="flabel" htmlFor="ha">Alias</label>
              <div className="input"><input id="ha" className="mono" value={f.alias} onChange={(e) => set('alias', e.target.value)} placeholder="prod-api-01" data-autofocus={!showTunnels || undefined} autoFocus={!showTunnels} /></div>
              <span className="hint">What you type in <span className="mono">flint connect</span>.</span></div>
            <div className="field"><label className="flabel" htmlFor="hl">Label <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· optional</span></label>
              <div className="input"><input id="hl" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Home server" /></div></div>
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
              <PasswordField value={f.password} onChange={(v) => set('password', v)}
                saved={host?.has_password ? { kind: 'host', name: host.alias } : null}
                placeholder={host?.has_password ? 'Saved — type to replace' : 'Password'} />
            )}
            {mode === 'agent' && <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />Uses the keys loaded in your SSH agent (<span className="mono">SSH_AUTH_SOCK</span>).</span>}
          </div>
          <div className="field" data-sudo-field style={{ padding: 'var(--sp-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--surface-raised)' }}>
            <span className="flabel row" style={{ gap: 'var(--sp-2)' }}><Icon name="shield" size="sm" />Sudo password <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· for flint exec --sudo</span></span>
            <div className="opt-list" role="radiogroup" aria-label="Sudo password">
              <label className="opt"><input type="radio" name="sudo-mode" data-sudo-mode="login" checked={!sudoOwn} onChange={() => setSudoOwn(false)} />
                <span className="opt-t"><span className="opt-l">Same as the login password</span><span className="hint">{loginSource}</span></span></label>
              <label className="opt"><input type="radio" name="sudo-mode" data-sudo-mode="own" checked={sudoOwn} onChange={() => setSudoOwn(true)} />
                <span className="opt-t"><span className="opt-l">Its own password</span></span></label>
            </div>
            {sudoOwn && host?.has_sudo_password && !sudoChange ? (
              <div className="row" data-sudo-saved style={{ marginLeft: 24, gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)' }}>
                <span className="badge ok"><Icon name="check" />Saved</span><span className="mono faint">••••••••••</span><span className="grow" />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSudoChange(true)}>Change</button>
                <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setSudoOwn(false)}>Remove</button>
              </div>
            ) : sudoOwn && (
              <div style={{ marginLeft: 24 }}>
                <PasswordField value={f.sudo_password} onChange={(v) => set('sudo_password', v)} saved={null} label="Sudo password"
                  placeholder={host?.has_sudo_password ? 'Type the new one' : 'Sudo password'} />
              </div>
            )}
            <span className="hint">Flint types it only when sudo asks, and only for a command you approved in its window.</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
            <div className="field"><label className="flabel" htmlFor="hu">User {mode === 'credential' && <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· overrides the credential's</span>}</label>
              <div className="input"><input id="hu" className="mono" value={f.user} onChange={(e) => set('user', e.target.value)} placeholder={mode === 'credential' ? 'from the credential' : 'root'} /></div></div>
            <div className="field"><span className="flabel">Jump host <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· optional</span></span>
              <Picker label="Jump host" value={f.jump} onChange={(v) => set('jump', v)} icon="jump" placeholder="None"
                options={[{ value: '', label: 'None', text: '' }, ...catalog.hosts.filter((h) => h.alias !== host?.alias && h.type !== 'rdp').map((h) => ({ value: h.alias, text: h.alias, label: <span className="mono">{h.alias}</span>, meta: h.group }))]} /></div>
          </div>
          <div className="field"><label className="flabel" htmlFor="hc">On connect <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· optional</span></label>
            <div className="input"><Icon name="term" size="sm" className="faint" /><input id="hc" className="mono" value={f.command} onChange={(e) => set('command', e.target.value)} placeholder="e.g. herdr or tmux new -A -s main" spellCheck={false} autoComplete="off" /></div>
            {f.command.trim() ? (
              <label className="check" style={{ fontSize: 'var(--fs-sm)' }}><input type="checkbox" checked={f.keep_shell} onChange={(e) => set('keep_shell', e.target.checked)} />
                <span>Return to a shell when it exits <span className="faint">· otherwise the session ends with it</span></span></label>
            ) : <span className="hint">Runs in your login shell every time a session opens, like typing it yourself.</span>}
          </div>
          <HostTunnels host={host?.alias ?? null} focus={showTunnels} />
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
          {test.s === 'host_key' && (
            <div className="card prompt" role="alertdialog" aria-label={`Verify ${test.key.alias}`} style={{ boxShadow: 'none' }}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answerKey(false); } }}>
              <div className="prompt-h"><span className="prompt-ic warn"><Icon name="shield" /></span>
                <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">Verify <span className="mono">{test.key.addr}</span></h2>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Flint hasn't seen this server before. Compare the fingerprint with one you got from its admin or console.</p></div></div>
              <dl className="kv" style={{ margin: 0 }}><dt>Key type</dt><dd className="mono">{test.key.key_type}</dd></dl>
              <div className="fp">{test.key.fingerprint}</div>
              <div className="row" style={{ gap: 'var(--sp-2)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => answerKey(false)}>Cancel test<Key>esc</Key></button>
                <span className="grow" />
                <button type="button" className="btn btn-primary" data-autofocus autoFocus onClick={() => answerKey(true)}>Trust and continue</button>
              </div>
            </div>
          )}
          {test.s === 'ok' && (
            <span className="hint row" role="status" style={{ gap: 6, color: 'var(--success)' }}><Icon name="shield-ok" size="xs" />
              Connection works · <span className="mono">{test.ev.target}</span> · host key verified, logged in ({test.ev.duration_ms} ms{test.ev.hops > 1 ? `, through ${test.ev.hops - 1} jump host${test.ev.hops > 2 ? 's' : ''}` : ''})</span>
          )}
          {test.s === 'fail' && (
            <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name={test.code === 'network' || test.code === 'timeout' ? 'wifi-off' : 'alert'} size="xs" />Test failed: {test.message}</span>
          )}
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          {host && <button type="button" className="btn btn-danger-ghost" onClick={() => onDelete(host.alias)}><Icon name="trash" size="sm" />Delete host</button>}
          <button type="button" className="btn btn-secondary" onClick={runTest} disabled={test.s === 'running' || test.s === 'host_key'}>
            {test.s === 'running' ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />Testing…</> : <><Icon name="link" size="sm" />Test connection</>}
          </button>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{host ? 'Save' : 'Add host'}<span className="kbd-in">{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</span></button>
        </div>
      </form>
    </Modal>
  );
}
