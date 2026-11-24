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
import { testFailText, testKey, testOkText } from '../lib/toastText';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { Picker } from '../ui/Picker';
import { PasswordField } from '../ui/PasswordField';
import { HostTunnels } from '../tunnels/HostTunnels';
import { RdpHostEditor } from './RdpHostEditor';
import { TypeBadge } from './TypeBadge';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';
import { coreText } from '../i18n/core';

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
    if (!f.alias.trim() || !f.hostname.trim()) return t('host_editor.alias_hostname_required');
    if (!Number.isInteger(port) || port < 1 || port > 65535) return t('host_editor.port_range');
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
  // The result shows inline as the record, and in a toast too (milestone 47), so it is
  // seen on a small window; one toast per editor, a second test replaces the first.
  const [test, setTest] = useState<TestState>({ s: 'idle' });
  const testId = useRef('');
  const testWho = useRef({ alias: '', key: '' });
  const failTest = (code: string, message: string) => {
    setTest({ s: 'fail', code, message });
    notify({ text: testFailText(testWho.current.alias, message), kind: 'error', key: testWho.current.key });
  };
  const failRef = useRef(failTest);
  failRef.current = failTest;
  useEffect(() => {
    const offEnd = on<HostTestEvent>('host:test', (ev) => {
      if (ev.session !== testId.current) return;
      testId.current = '';
      if (ev.code) { failRef.current(ev.code, coreText(ev)); return; }
      setTest({ s: 'ok', ev });
      notify({ text: testOkText(testWho.current.alias, ev.target, ev.duration_ms, ev.hops), key: testWho.current.key });
      refreshCatalog();
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
  }, [refreshCatalog, notify]);
  const runTest = async () => {
    if (testId.current) return;
    testWho.current = { alias: f.alias.trim(), key: testKey(host?.alias ?? '') };
    const p = buildPatch();
    if (typeof p === 'string') { failTest('invalid', p); return; }
    const id = `test-${Date.now().toString(36)}-${++testSeq}`;
    testId.current = id;
    setTest({ s: 'running' });
    try {
      await api.hostTest(id, host?.alias ?? '', p);
    } catch (err) {
      testId.current = '';
      const e = toFlintError(err);
      failTest(e.code, coreText(e));
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
      notify(host ? t('host_editor.saved_alias', { alias: saved.alias }) : t('host_editor.added_alias', { alias: saved.alias }));
      onClose();
    } catch (err) {
      setError(toFlintError(err).message);
      setBusy(false);
    }
  };

  const c = colorStyle(f.color);
  const modes: { m: Mode; icon: 'cred' | 'key' | 'lock' | 'link'; label: string }[] = [
    { m: 'credential', icon: 'cred', label: t('host_editor.credential') },
    { m: 'key', icon: 'key', label: t('host_editor.key') },
    { m: 'password', icon: 'lock', label: t('host_editor.password') },
    { m: 'agent', icon: 'link', label: t('host_editor.agent') },
  ];
  // Where "Same as the login password" takes its password from, or that there is none
  // (then the approval window asks for one each time).
  const cred = catalog.credentials.find((c) => c.name === f.credential);
  const loginSource = mode === 'credential' && cred?.has_password ? t('host_editor.login_from_credential', { name: cred.name })
    : mode === 'password' && (f.password || host?.has_password) ? t('host_editor.login_own_password')
    : t('host_editor.login_none');

  return (
    <Modal label={host ? t('host_editor.edit_host_alias', { alias: host.alias }) : t('host_editor.new_host')} onClose={onClose} width={680} top={52}>
      <form onSubmit={save} onKeyDown={(e) => { if (e.key === 'Enter' && (os === 'mac' ? e.metaKey : e.ctrlKey)) save(); }} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="modal-h">
          {f.color && <span className={'hmark ' + c.className} style={{ height: 20, ...c.style }} />}
          <h2 className="grow">{host ? <>{tr('host_editor.edit_host_span', { span: <span className="mono muted" style={{ fontWeight: 'var(--fw-regular)' }}>{host.alias}</span> })}</> : t('host_editor.new_host')}</h2>
          <TypeBadge type="ssh" />
          {host && <Kbd action="editHost" />}
          <button type="button" className="icon-btn" aria-label={t('host_editor.close_esc')} onClick={onClose}><Icon name="x" size="sm" /></button>
        </div>
        <div className="modal-b scroll" style={{ gap: 'var(--sp-4)', paddingBottom: 'var(--sp-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
            <div className="field"><label className="flabel" htmlFor="ha">{t('host_editor.alias')}</label>
              <div className="input"><input {...plainText} id="ha" className="mono" value={f.alias} onChange={(e) => set('alias', e.target.value)} placeholder="prod-api-01" data-autofocus={!showTunnels || undefined} autoFocus={!showTunnels} /></div>
              <span className="hint">{tr('host_editor.what_you_type_in_span', { span: <span className="mono">flint connect</span> })}</span></div>
            <div className="field"><label className="flabel" htmlFor="hl">{tr('host_editor.label_span', { span: <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{t('host_editor.optional')}</span> })}</label>
              <div className="input"><input {...plainText} id="hl" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder={t('host_editor.e_g_home_server')} /></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px', gap: 'var(--sp-4)' }}>
              <div className="field"><label className="flabel" htmlFor="hh">{t('host_editor.hostname')}</label>
                <div className="input"><input {...plainText} id="hh" className="mono" value={f.hostname} onChange={(e) => set('hostname', e.target.value)} placeholder="10.0.4.21" /></div></div>
              <div className="field"><label className="flabel" htmlFor="hp">{t('host_editor.port')}</label>
                <div className="input"><input {...plainText} id="hp" className="mono" inputMode="numeric" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} /></div></div>
            </div>
            <div className="field"><span className="flabel">{t('host_editor.folder')}</span>
              <Picker label={t('host_editor.folder')} value={f.group} onChange={(v) => set('group', v)} icon="folder" placeholder={t('host_editor.no_folder')}
                options={[{ value: '', label: t('host_editor.no_folder'), text: '' }, ...groupPaths(catalog.groups).map((g) => ({ value: g, label: g.split('/').join(' / '), text: g }))]} /></div>
          </div>
          <div className="field">
            <span className="flabel">{t('host_editor.authentication')}</span>
            <div className="seg full" role="group" aria-label={t('host_editor.authentication_method')}>
              {modes.map((x) => (
                <button key={x.m} type="button" aria-pressed={mode === x.m} onClick={() => { setMode(x.m); setModeChanged(true); }}><Icon name={x.icon} size="sm" />{x.label}</button>
              ))}
            </div>
            {mode === 'credential' && (
              <Picker label={t('host_editor.credential')} value={f.credential} onChange={(v) => set('credential', v)} icon="cred" placeholder={t('host_editor.choose_a_credential')}
                options={catalog.credentials.map((cr) => ({ value: cr.name, text: cr.name + ' ' + cr.user, label: <>{cr.name} <span className="faint mono">· {cr.user} · {cr.key ? 'key ' + cr.key : cr.has_password ? 'password' : 'agent'}</span></>, meta: `${usage.get(cr.name) ?? 0} hosts` }))}
                footer={{ label: t('host_editor.new_credential'), run: onNewCredential }} />
            )}
            {mode === 'key' && (
              <Picker label={t('host_editor.ssh_key')} value={f.key} onChange={(v) => set('key', v)} icon="key" placeholder={catalog.keys.length ? t('host_editor.choose_a_key') : t('host_editor.no_keys_in_this_vault')}
                options={catalog.keys.map((k) => ({ value: k.name, text: k.name, label: <>{k.name} <span className="faint mono">· {k.type}</span></> }))} />
            )}
            {mode === 'password' && (
              <PasswordField value={f.password} onChange={(v) => set('password', v)}
                saved={host?.has_password ? { kind: 'host', name: host.alias } : null}
                placeholder={host?.has_password ? t('host_editor.saved_type_to_replace') : t('host_editor.password')} />
            )}
            {mode === 'agent' && <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" /><span>{tr('host_editor.uses_the_keys_loaded_in', { span: <span className="mono">SSH_AUTH_SOCK</span> })}</span></span>}
          </div>
          <div className="field" data-sudo-field style={{ padding: 'var(--sp-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--surface-raised)' }}>
            <span className="flabel row" style={{ gap: 'var(--sp-2)' }}><Icon name="shield" size="sm" />{tr('host_editor.sudo_password_span', { span: <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{t('host_editor.for_flint_exec_sudo')}</span> })}</span>
            <div className="opt-list" role="radiogroup" aria-label={t('host_editor.sudo_password')}>
              <label className="opt"><input type="radio" name="sudo-mode" data-sudo-mode="login" checked={!sudoOwn} onChange={() => setSudoOwn(false)} />
                <span className="opt-t"><span className="opt-l">{t('host_editor.same_as_the_login_password')}</span><span className="hint">{loginSource}</span></span></label>
              <label className="opt"><input type="radio" name="sudo-mode" data-sudo-mode="own" checked={sudoOwn} onChange={() => setSudoOwn(true)} />
                <span className="opt-t"><span className="opt-l">{t('host_editor.its_own_password')}</span></span></label>
            </div>
            {sudoOwn && host?.has_sudo_password && !sudoChange ? (
              <div className="row" data-sudo-saved style={{ marginLeft: 24, gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)' }}>
                <span className="badge ok"><Icon name="check" />{t('host_editor.saved')}</span><span className="mono faint">••••••••••</span><span className="grow" />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSudoChange(true)}>{t('host_editor.change')}</button>
                <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setSudoOwn(false)}>{t('common.remove')}</button>
              </div>
            ) : sudoOwn && (
              <div style={{ marginLeft: 24 }}>
                <PasswordField value={f.sudo_password} onChange={(v) => set('sudo_password', v)} saved={null} label={t('host_editor.sudo_password')}
                  placeholder={host?.has_sudo_password ? t('host_editor.type_the_new_one') : t('host_editor.sudo_password')} />
              </div>
            )}
            <span className="hint">{t('host_editor.flint_types_it_only_when')}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
            <div className="field"><label className="flabel" htmlFor="hu">{t('host_editor.user')}{' '}{mode === 'credential' && <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{t('host_editor.overrides_the_credential_s')}</span>}</label>
              <div className="input"><input {...plainText} id="hu" className="mono" value={f.user} onChange={(e) => set('user', e.target.value)} placeholder={mode === 'credential' ? t('host_editor.from_the_credential') : 'root'} /></div></div>
            <div className="field"><span className="flabel">{tr('host_editor.jump_host_span', { span: <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{t('host_editor.optional')}</span> })}</span>
              <Picker label={t('host_editor.jump_host')} value={f.jump} onChange={(v) => set('jump', v)} icon="jump" placeholder={t('host_editor.none')}
                options={[{ value: '', label: t('host_editor.none'), text: '' }, ...catalog.hosts.filter((h) => h.alias !== host?.alias && h.type !== 'rdp').map((h) => ({ value: h.alias, text: h.alias, label: <span className="mono">{h.alias}</span>, meta: h.group }))]} /></div>
          </div>
          <div className="field"><label className="flabel" htmlFor="hc">{tr('host_editor.on_connect_span', { span: <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{t('host_editor.optional')}</span> })}</label>
            <div className="input"><Icon name="term" size="sm" className="faint" /><input {...plainText} id="hc" className="mono" value={f.command} onChange={(e) => set('command', e.target.value)} placeholder={t('host_editor.e_g_herdr_or_tmux')} autoComplete="off" /></div>
            {f.command.trim() ? (
              <label className="check" style={{ fontSize: 'var(--fs-sm)' }}><input type="checkbox" checked={f.keep_shell} onChange={(e) => set('keep_shell', e.target.checked)} />
                <span>{tr('host_editor.return_to_a_shell_when', { span: <span className="faint">{t('host_editor.otherwise_the_session_ends_with')}</span> })}</span></label>
            ) : <span className="hint">{t('host_editor.runs_in_your_login_shell')}</span>}
          </div>
          <HostTunnels host={host?.alias ?? null} focus={showTunnels} />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 'var(--sp-4)' }}>
            <div className="field"><span className="flabel">{t('host_editor.tags')}</span>
              <div className="tags">
                {f.tags.map((tagItem) => <span key={tagItem} className="tag">{tagItem}<button type="button" aria-label={t('host_editor.remove_tag_t', { tagItem })} onClick={() => set('tags', f.tags.filter((x) => x !== tagItem))}><Icon name="x" size="xs" /></button></span>)}
                <input {...plainText} aria-label={t('host_editor.add_tag')} placeholder={t('host_editor.add_tag_2')} value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
                    if (e.key === 'Backspace' && !tagInput && f.tags.length) set('tags', f.tags.slice(0, -1));
                  }} onBlur={() => tagInput && addTag(tagInput)} />
              </div></div>
            <div className="field"><span className="flabel">{t('host_editor.colour')}</span>
              <div className="swatches" role="radiogroup" aria-label={t('host_editor.host_colour')} style={{ height: 'var(--control-h)' }}>
                <button type="button" className="sw none" role="radio" aria-checked={!f.color} aria-label={t('host_editor.none')} onClick={() => set('color', '')} />
                {TAG_COLORS.map((n) => (
                  <button key={n} type="button" className={'sw c-' + n} role="radio" aria-checked={colorName(f.color) === n} aria-label={n} onClick={() => set('color', colorHex(n))} />
                ))}
              </div></div>
          </div>
          <div className="field"><label className="flabel" htmlFor="hn">{t('host_editor.notes')}</label>
            <div className="input area"><textarea data-prose id="hn" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div></div>
          {test.s === 'host_key' && (
            <div className="card prompt" role="alertdialog" aria-label={t('host_editor.verify_alias', { alias: test.key.alias })} style={{ boxShadow: 'none' }}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answerKey(false); } }}>
              <div className="prompt-h"><span className="prompt-ic warn"><Icon name="shield" /></span>
                <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{tr('host_editor.verify_span', { span: <span className="mono">{test.key.addr}</span> })}</h2>
                  <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('host_editor.flint_hasn_t_seen_this')}</p></div></div>
              <dl className="kv" style={{ margin: 0 }}><dt>{t('host_editor.key_type')}</dt><dd className="mono">{test.key.key_type}</dd></dl>
              <div className="fp">{test.key.fingerprint}</div>
              <div className="row" style={{ gap: 'var(--sp-2)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => answerKey(false)}>{t('host_editor.cancel_test')}<Key>esc</Key></button>
                <span className="grow" />
                <button type="button" className="btn btn-primary" data-autofocus autoFocus onClick={() => answerKey(true)}>{t('host_editor.trust_and_continue')}</button>
              </div>
            </div>
          )}
          {test.s === 'ok' && (
            <span className="hint row" role="status" style={{ gap: 6, color: 'var(--success)' }}><Icon name="shield-ok" size="xs" />
              {test.ev.hops > 1
                ? tr('host_editor.connection_works_jumps', { target: <span className="mono">{test.ev.target}</span>, ms: test.ev.duration_ms, count: test.ev.hops - 1 })
                : tr('host_editor.connection_works', { target: <span className="mono">{test.ev.target}</span>, ms: test.ev.duration_ms })}</span>
          )}
          {test.s === 'fail' && (
            <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name={test.code === 'network' || test.code === 'timeout' ? 'wifi-off' : 'alert'} size="xs" /><span>{tr('host_editor.test_failed_message', { message: test.message })}</span></span>
          )}
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          {host && <button type="button" className="btn btn-danger-ghost" onClick={() => onDelete(host.alias)}><Icon name="trash" size="sm" />{t('host_editor.delete_host')}</button>}
          <button type="button" className="btn btn-secondary" onClick={runTest} disabled={test.s === 'running' || test.s === 'host_key'}>
            {test.s === 'running' ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />{t('host_editor.testing')}</> : <><Icon name="link" size="sm" />{t('host_editor.test_connection')}</>}
          </button>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{host ? t('common.save') : t('host_editor.add_host')}<span className="kbd-in">{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</span></button>
        </div>
      </form>
    </Modal>
  );
}
