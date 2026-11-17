// Connect to a remote vault, from Welcome (milestone 44, design 23a): the server
// first (its address and token, checked against it: 23a1-23a2), then the vault it
// keeps, which it cannot read, so only its size, version and the label it was given
// (23a3); a server keeping several lists them to pick one (milestone 45, D-103).
// Then its master password, where to keep the local copy, and Remember. Downloading
// opens it straight into the main window (23a4).

import { useEffect, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import type { RemoteProbe, ServerVault } from '../api/types';
import { useApp } from '../state/app';
import { agoLabel, copyName, sizeLabel, urlHost } from '../lib/sync';
import { Icon, Logo } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { RememberOption } from '../ui/RememberOption';
import { ServerAddress } from '../sync/ConnectServerModal';
import { serverErrorField, TokenField } from '../sync/TokenField';

type Errors = { url?: string; token?: string; pw?: string; path?: string; form?: string };

function VaultFacts({ v, now }: { v: ServerVault; now: number }) {
  return <>{sizeLabel(v.size)} · version {v.version.toLocaleString('en-US')} · updated {agoLabel(v.updated_at, now)}</>;
}

export function ConnectRemote() {
  const { go, download, vault, target, os } = useApp();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [found, setFound] = useState<RemoteProbe | null>(null);
  const [chosen, setChosen] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [path, setPath] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const back = () => {
    if (found && !busy) { setFound(null); setChosen(''); setPw(''); setErrors({}); return; }
    go(vault ? 'main' : target ? 'unlock' : 'welcome');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !busy) back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const check = async () => {
    setBusy(true);
    setErrors({});
    try {
      const p = await api.remoteProbe(url.trim(), token);
      if (p.vaults.length === 0) {
        setErrors({ form: 'empty' });
      } else {
        setFound(p);
        setChosen(p.vaults.length === 1 ? p.vaults[0].id : '');
        setUrl(p.url);
      }
    } catch (err) {
      const fe = toFlintError(err);
      const field = serverErrorField(fe.code);
      setErrors({ [field]: fe.code === 'invalid' && /did not answer/.test(fe.message) ? "This address does not answer as a Flint vault server." : fe.message });
    }
    setBusy(false);
  };

  const choose = async () => {
    const { path: p } = await api.dialogSave('Keep the local copy in', copyName(found?.vaults.find((v) => v.id === chosen)));
    if (p) setPath(p.endsWith('.flint') ? p : p + '.flint');
  };

  const fetchVault = async () => {
    setBusy(true);
    setErrors({});
    try {
      await download(url, token, chosen, pw, path, remember);
      setToken('');
      setPw('');
    } catch (err) {
      const fe = toFlintError(err);
      if (fe.code === 'wrong_password') setErrors({ pw: "The vault on the server does not open with that master password." });
      else if (fe.code === 'exists') setErrors({ path: 'A file already exists there. Flint never overwrites one: choose another name.' });
      else if (fe.code === 'invalid' && /Strong/.test(fe.message)) setErrors({ pw: fe.message.replace(/ Change it first with `flint vault passwd`$/, ' Change it on a machine that has the vault first.') });
      else setErrors({ form: fe.message });
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!found) { if (url.trim() && token.trim()) check().catch(() => {}); return; }
    if (chosen && pw && path) fetchVault().catch(() => {});
  };

  const step2 = !!found;
  const ready = step2 ? !!chosen && !!pw && !!path && !busy : !!url.trim() && !!token.trim() && !busy;
  const now = Date.now();
  const only = found && found.vaults.length === 1 ? found.vaults[0] : null;
  return (
    <>
      <header className="titlebar" style={{ background: 'var(--surface-base)', borderBottomColor: 'transparent' }}>
        <div className="tb-brand"><Logo />Flint</div>
        <div className="tb-title">Remote vault</div>
      </header>
      <main style={{ position: 'absolute', inset: '38px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form className="card" aria-label="Connect to a remote vault" style={{ width: 520, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-1)' }} onSubmit={submit}>
          <div className="modal-h"><Icon name="server" size="sm" /><h2 className="grow">Connect to a remote vault</h2>
            <div className="steps"><span className={step2 ? '' : 'on'}>1 Server</span><i /><span className={step2 ? 'on' : ''}>2 Vault</span></div></div>
          {!step2 ? (
            <div className="modal-b" style={{ gap: 'var(--sp-5)' }} data-connect-step="server">
              <ServerAddress id="sa" value={url} onChange={setUrl} error={errors.url} disabled={busy} autoFocus />
              <TokenField id="st" value={token} onChange={setToken} error={errors.token} disabled={busy} />
              {errors.form === 'empty' && (
                <div className="callout info row" role="status" style={{ gap: 'var(--sp-2)', alignItems: 'flex-start' }} data-server-empty>
                  <Icon name="info" size="sm" className="accent-t" />
                  <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.45 }}>This server is empty. Connect it from a machine that already has the vault: Settings → Vault → Connect to a server.</span>
                </div>
              )}
              {errors.form && errors.form !== 'empty' && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{errors.form}</span>}
              <span className="hint row" style={{ gap: 6 }}><Icon name="info" size="xs" />No server yet? Self-host one in a few minutes: see <span className="strong">Self-host a remote vault</span> in Flint's docs.</span>
            </div>
          ) : (
            <div className="modal-b" style={{ gap: 'var(--sp-5)' }} data-connect-step="vault">
              {only ? (
                <div className="found" data-server-vault={only.id}>
                  <Icon name="lock" size="lg" className="accent-t" />
                  <div className="col grow" style={{ gap: 2 }}>
                    <span className="strong">{only.label ? <>A vault was found: {only.label}</> : 'A vault was found'}</span>
                    <span className="hint"><VaultFacts v={only} now={now} /> · on <span className="mono">{urlHost(found.url)}</span>. Its name appears once it opens.</span>
                  </div>
                  <span className="badge ok"><Icon name="shield" size="xs" />encrypted</span>
                </div>
              ) : (
                <div className="field" data-server-vaults={found.vaults.length}>
                  <span className="flabel">This server keeps {found.vaults.length} vaults</span>
                  <div className="opt-list" role="radiogroup" aria-label="Vaults on the server" style={{ maxHeight: 210, overflowY: 'auto' }}>
                    {found.vaults.map((v) => (
                      <label key={v.id} className="opt" data-server-vault={v.id}>
                        <input type="radio" name="server-vault" checked={chosen === v.id} onChange={() => setChosen(v.id)} disabled={busy} />
                        <span className="opt-t">
                          <span className="opt-l">{v.label || <span className="muted">No label</span>} <span className="mono faint" title={v.id}>{v.id.slice(0, 8)}</span></span>
                          <span className="hint"><VaultFacts v={v} now={now} /></span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <span className="hint row" style={{ gap: 6 }}><Icon name="shield" size="xs" />Each is encrypted: the server shows only the label it was given when connected. Its name appears once it opens.</span>
                </div>
              )}
              <div className="field">
                <label className="flabel" htmlFor="vp">Master password of that vault</label>
                <div className={'input' + (errors.pw ? ' err' : '')}>
                  <input id="vp" type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus={!!only} disabled={busy} />
                  <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
                </div>
                {errors.pw && <span className="hint err" role="alert">{errors.pw}</span>}
              </div>
              <div className="field">
                <span className="flabel">Keep the local copy in</span>
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  <div className={'input grow' + (errors.path ? ' err' : '')}><Icon name="folder" size="sm" className="faint" />
                    <input className="mono" aria-label="Local copy path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Choose where to keep it" style={{ fontSize: 'var(--fs-sm)' }} disabled={busy} /></div>
                  <button type="button" className="btn btn-secondary" style={{ height: 'var(--control-h)' }} onClick={() => choose().catch(() => {})} disabled={busy}>Choose…</button>
                </div>
                {errors.path
                  ? <span className="hint err" role="alert">{errors.path}</span>
                  : <span className="hint">Every machine keeps its own full copy and works offline.</span>}
              </div>
              <RememberOption checked={remember} onChange={setRemember} os={os} disabled={busy} />
              {busy && <span className="hint row" role="status" style={{ gap: 6 }} data-downloading><Icon name="download" size="xs" />Downloading and opening the vault…</span>}
              {errors.form && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{errors.form}</span>}
            </div>
          )}
          <div className="modal-f">
            <button type="button" className="btn btn-ghost" onClick={back} disabled={busy}>Back<Key>esc</Key></button>
            <span className="grow" />
            <button type="submit" className="btn btn-primary" disabled={!ready}>
              {step2 ? (busy ? 'Downloading…' : 'Download and open') : (busy ? 'Checking…' : 'Continue')}<span className="kbd-in">↵</span>
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
