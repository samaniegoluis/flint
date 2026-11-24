// New / edit an RDP host (design 21b). The type is fixed (a badge in the header).
// Address, port (3389 when left empty), user, an optional Windows domain, and a login:
// the host's own password or a credential that has one. No jump host, initial command,
// sudo or tunnels: those are SSH's. Testing the connection arrives with the RDP tab.
// Audio (milestone 60, designs 25d1/25d2): where the remote audio plays and the
// microphone, off by default.

import { useState } from 'react';
import { api, emptyHostPatch, toFlintError } from '../api/backend';
import type { HostPatch, HostView, RdpAudio } from '../api/types';
import { useApp } from '../state/app';
import { colorHex, colorName, colorStyle, TAG_COLORS } from '../lib/colors';
import { groupPaths } from '../lib/tree';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { Picker } from '../ui/Picker';
import { PasswordField } from '../ui/PasswordField';
import { TypeBadge } from './TypeBadge';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

export const RDP_PORT = 3389;

type Login = 'password' | 'credential';

const AUDIO_CHOICES: { value: RdpAudio; label: string }[] = [
  { value: 'local', label: 'rdp_host_editor.audio.local' },
  { value: 'remote', label: 'rdp_host_editor.audio.remote' },
  { value: 'off', label: 'rdp_host_editor.audio.off' },
];

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
    audio: (host?.audio || 'local') as RdpAudio,
    microphone: host?.microphone ?? false,
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
    if (!f.alias.trim()) e.alias = t('rdp_host_editor.enter_alias');
    if (!f.hostname.trim()) e.hostname = t('rdp_host_editor.enter_address');
    if (!Number.isInteger(port) || port < 1 || port > 65535) e.port = t('rdp_host_editor.port_range');
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
    if (host ? (host.audio || 'local') !== f.audio : f.audio !== 'local') { p.audio = f.audio; p.set_audio = true; }
    if ((host?.microphone ?? false) !== f.microphone) { p.microphone = f.microphone; p.set_microphone = true; }
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
      notify(host ? t('rdp_host_editor.saved_alias', { alias: saved.alias }) : t('rdp_host_editor.added_alias', { alias: saved.alias }));
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
      meta: cr.key ? t('rdp_host_editor.key_only') : t('rdp_host_editor.agent'), disabled: cr.key ? t('rdp_host_editor.only_ssh_key') : t('rdp_host_editor.no_password'),
    })),
  ];

  return (
    <Modal label={host ? t('rdp_host_editor.edit_host_alias', { alias: host.alias }) : t('rdp_host_editor.new_rdp_host')} onClose={onClose} width={680} top={52}>
      <form data-rdp-editor onSubmit={save} onKeyDown={(e) => { if (e.key === 'Enter' && (os === 'mac' ? e.metaKey : e.ctrlKey)) save(); }} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="modal-h">
          {f.color && <span className={'hmark ' + c.className} style={{ height: 20, ...c.style }} />}
          <h2 className="grow">{host ? <>{tr('rdp_host_editor.edit_host_span', { span: <span className="mono muted" style={{ fontWeight: 'var(--fw-regular)' }}>{host.alias}</span> })}</> : t('rdp_host_editor.new_host')}</h2>
          <TypeBadge type="rdp" />
          {host && <Kbd action="editHost" />}
          <button type="button" className="icon-btn" aria-label={t('rdp_host_editor.close_esc')} onClick={onClose}><Icon name="x" size="sm" /></button>
        </div>
        <div className="modal-b scroll" style={{ gap: 'var(--sp-4)', paddingBottom: 'var(--sp-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)', alignItems: 'start' }}>
            <div className="field"><label className="flabel" htmlFor="ra">{t('rdp_host_editor.alias')}</label>
              <div className={'input' + (errs.alias ? ' err' : '')}><input {...plainText} id="ra" className="mono" value={f.alias} onChange={(e) => set('alias', e.target.value)} placeholder="win-01" data-autofocus autoFocus /></div>
              {ferr(errs.alias) || <span className="hint">{tr('rdp_host_editor.what_you_type_in_span', { span: <span className="mono">flint connect</span> })}</span>}</div>
            <div className="field"><label className="flabel" htmlFor="rl">{tr('rdp_host_editor.label_span', { span: <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{t('rdp_host_editor.optional')}</span> })}</label>
              <div className="input"><input {...plainText} id="rl" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder={t('rdp_host_editor.e_g_reception_pc')} /></div></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px', gap: 'var(--sp-4)', alignItems: 'start' }}>
            <div className="field"><label className="flabel" htmlFor="rh">{t('rdp_host_editor.address')}</label>
              <div className={'input' + (errs.hostname ? ' err' : '')}><input {...plainText} id="rh" className="mono" value={f.hostname} onChange={(e) => set('hostname', e.target.value)} placeholder={t('rdp_host_editor.name_or_ip')} /></div>
              {ferr(errs.hostname)}</div>
            <div className="field"><label className="flabel" htmlFor="rp">{t('rdp_host_editor.port')}</label>
              <div className={'input' + (errs.port ? ' err' : '')}><input {...plainText} id="rp" className="mono" inputMode="numeric" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} placeholder={String(RDP_PORT)} /></div>
              {ferr(errs.port)}</div>
          </div>
          <div className="field"><span className="flabel">{t('rdp_host_editor.folder')}</span>
            <Picker label={t('rdp_host_editor.folder')} value={f.group} onChange={(v) => set('group', v)} icon="folder" placeholder={t('rdp_host_editor.no_folder')}
              options={[{ value: '', label: t('rdp_host_editor.no_folder'), text: '' }, ...groupPaths(catalog.groups).map((g) => ({ value: g, label: g.split('/').join(' / '), text: g }))]} /></div>
          <div className="field">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
              <div className="field"><label className="flabel" htmlFor="ru">{t('rdp_host_editor.user')}{' '}{login === 'credential' && <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{t('rdp_host_editor.overrides_the_credential_s')}</span>}</label>
                <div className="input"><input {...plainText} id="ru" className="mono" value={f.user} onChange={(e) => set('user', e.target.value)} placeholder={login === 'credential' ? t('rdp_host_editor.from_the_credential') : t('rdp_host_editor.administrator')} /></div></div>
              <div className="field"><label className="flabel" htmlFor="rd">{tr('rdp_host_editor.domain_span', { span: <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>{t('rdp_host_editor.optional')}</span> })}</label>
                <div className="input"><input {...plainText} id="rd" className="mono" value={f.domain} onChange={(e) => set('domain', e.target.value)} placeholder={t('rdp_host_editor.e_g_corp')} /></div></div>
            </div>
            <span className="hint">{tr('rdp_host_editor.span_and_span2_also_work', { span: <span className="mono">DOMAIN\user</span>, span2: <span className="mono">user@domain</span> })}</span>
          </div>
          <div className="field">
            <span className="flabel">{t('rdp_host_editor.login')}</span>
            <div className="seg full" role="group" aria-label={t('rdp_host_editor.login')}>
              <button type="button" aria-pressed={login === 'password'} onClick={() => { setLogin('password'); setLoginChanged(true); }}><Icon name="lock" size="sm" />{t('rdp_host_editor.own_password')}</button>
              <button type="button" aria-pressed={login === 'credential'} onClick={() => { setLogin('credential'); setLoginChanged(true); }}><Icon name="cred" size="sm" />{t('rdp_host_editor.credential')}</button>
            </div>
            {login === 'password' ? (
              <>
                <PasswordField value={f.password} onChange={(v) => set('password', v)}
                  saved={host?.has_password ? { kind: 'host', name: host.alias } : null}
                  placeholder={host?.has_password ? t('rdp_host_editor.saved_type_to_replace') : t('rdp_host_editor.password')} />
                <span className="hint">{t('rdp_host_editor.stored_in_the_vault_encrypted')}</span>
              </>
            ) : (
              <>
                <Picker label={t('rdp_host_editor.credential')} value={f.credential} onChange={(v) => set('credential', v)} icon="cred"
                  placeholder={withPassword.length ? t('rdp_host_editor.choose_a_credential') : t('rdp_host_editor.no_credential_with_a_password')}
                  options={credOptions} footer={{ label: t('rdp_host_editor.new_credential_with_a_password'), run: onNewCredential }} />
                <span className="hint">{t('rdp_host_editor.only_credentials_with_a_password')}</span>
              </>
            )}
          </div>
          <div className="field" data-rdp-audio><span className="flabel">{t('rdp_host_editor.audio')}</span>
            <div className="col" style={{ gap: 'var(--sp-3)' }}>
              <div className="col" style={{ gap: 6 }}>
                <span style={{ fontSize: 'var(--fs-sm)' }}>{t('rdp_host_editor.play_remote_audio')}</span>
                <div className="seg full" role="radiogroup" aria-label={t('rdp_host_editor.play_remote_audio')}>
                  {AUDIO_CHOICES.map((a) => (
                    <button key={a.value} type="button" aria-pressed={f.audio === a.value} data-audio={a.value} onClick={() => set('audio', a.value)}>{t(a.label)}</button>
                  ))}
                </div>
              </div>
              <label className="row" style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)', alignItems: 'flex-start' }}>
                <button type="button" className="toggle" role="switch" aria-checked={f.microphone} aria-label={t('rdp_host_editor.microphone')} data-microphone
                  onClick={() => set('microphone', !f.microphone)} />
                <span className="col" style={{ gap: 3 }}>
                  <span>{t('rdp_host_editor.microphone')}</span>
                  <span className="hint" style={{ lineHeight: 1.45 }}>{t('rdp_host_editor.lets_the_remote_computer_use')}{os === 'mac' && t('rdp_host_editor.macos_asks_for_microphone_permission')}</span>
                </span>
              </label>
              {os === 'mac' && f.microphone && !host?.microphone && (
                <div className="callout info" style={{ fontSize: 'var(--fs-xs)' }} data-mic-permission>
                  <Icon name="info" size="sm" className="info-t" />
                  <span>{t('rdp_host_editor.next_time_you_connect_macos')}</span>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 'var(--sp-4)' }}>
            <div className="field"><span className="flabel">{t('rdp_host_editor.tags')}</span>
              <div className="tags">
                {f.tags.map((tagItem) => <span key={tagItem} className="tag">{tagItem}<button type="button" aria-label={t('rdp_host_editor.remove_tag_t', { tagItem })} onClick={() => set('tags', f.tags.filter((x) => x !== tagItem))}><Icon name="x" size="xs" /></button></span>)}
                <input {...plainText} aria-label={t('rdp_host_editor.add_tag')} placeholder={t('rdp_host_editor.add_tag_2')} value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
                    if (e.key === 'Backspace' && !tagInput && f.tags.length) set('tags', f.tags.slice(0, -1));
                  }} onBlur={() => tagInput && addTag(tagInput)} />
              </div></div>
            <div className="field"><span className="flabel">{t('rdp_host_editor.colour')}</span>
              <div className="swatches" role="radiogroup" aria-label={t('rdp_host_editor.host_colour')} style={{ height: 'var(--control-h)' }}>
                <button type="button" className="sw none" role="radio" aria-checked={!f.color} aria-label={t('rdp_host_editor.none')} onClick={() => set('color', '')} />
                {TAG_COLORS.map((n) => (
                  <button key={n} type="button" className={'sw c-' + n} role="radio" aria-checked={colorName(f.color) === n} aria-label={n} onClick={() => set('color', colorHex(n))} />
                ))}
              </div></div>
          </div>
          <div className="field"><label className="flabel" htmlFor="rn">{t('rdp_host_editor.notes')}</label>
            <div className="input area"><textarea data-prose id="rn" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div></div>
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          {host && <button type="button" className="btn btn-danger-ghost" onClick={() => onDelete(host.alias)}><Icon name="trash" size="sm" />{t('rdp_host_editor.delete_host')}</button>}
          <span className="reserved" data-test-reserved title={t('rdp_host_editor.testing_an_rdp_host_arrives')}>{t('rdp_host_editor.test_connection_coming_soon')}</span>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{host ? t('common.save') : t('rdp_host_editor.add_host')}<span className="kbd-in">{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</span></button>
        </div>
      </form>
    </Modal>
  );
}
