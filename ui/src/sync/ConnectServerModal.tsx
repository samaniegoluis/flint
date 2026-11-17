// Settings → Vault → Connect to a server (design 23b2): the open vault goes to a
// server, or is merged with the copy it already holds. Its master password is typed
// again, and must be Strong (D-095): a vault on someone's disk needs more than one
// on this machine alone.

import { useEffect, useRef, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import type { PasswordStrength, SyncOutcome } from '../api/types';
import { useApp } from '../state/app';
import { mergeSummary, hasChanges } from '../lib/sync';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { serverErrorField, TokenField } from './TokenField';

const ESTIMATE_DELAY_MS = 120;

function meterClass(s: PasswordStrength | null): string {
  if (!s) return '';
  if (s.score <= 1) return 'weak';
  if (s.score === 2) return 'fair';
  return '';
}

function labelClass(s: PasswordStrength | null): string {
  if (!s) return 'faint';
  if (s.score <= 1) return 'danger-t';
  if (s.score === 2) return 'warn-t';
  return 'ok-t';
}

export function ConnectServerModal({ onClose, onChangePassword, onConnected }: {
  onClose: () => void;
  onChangePassword: () => void;
  onConnected: (got: SyncOutcome) => void;
}) {
  const { vault } = useApp();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ url?: string; token?: string; pw?: string; form?: string }>({});
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const [done, setDone] = useState<SyncOutcome | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!pw) { setStrength(null); return; }
    const n = ++seq.current;
    const t = window.setTimeout(() => {
      api.passwordStrength(pw).then((s) => { if (n === seq.current) setStrength(s); }).catch(() => {});
    }, ESTIMATE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [pw]);

  const weak = !!strength && !strength.sync_ok;
  const ready = url.trim() && token.trim() && pw && strength?.sync_ok && !busy;
  const name = vault?.name ?? 'the vault';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setErrors({});
    try {
      const got = await api.remoteConnect(url.trim(), token, pw);
      setToken('');
      setPw('');
      setDone(got);
      onConnected(got);
    } catch (err) {
      const fe = toFlintError(err);
      if (fe.code === 'wrong_password') setErrors({ pw: `That is not the master password of ${name}.` });
      else if (fe.code === 'conflict' && /another vault/.test(fe.message)) setErrors({ url: 'This server already keeps a different vault.' });
      else {
        const field = serverErrorField(fe.code);
        setErrors({ [field === 'form' ? 'form' : field]: fe.message });
      }
      setBusy(false);
    }
  };

  if (done) {
    const merged = done.result === 'merged';
    return (
      <Modal label="Connected to a server" onClose={onClose} width={520}>
        <div className="modal-h"><Icon name="check" size="sm" className="ok-t" /><h2 className="grow">{merged ? "Merged with the server's copy" : 'Uploaded'}</h2></div>
        <div className="modal-b" style={{ gap: 'var(--sp-3)' }} data-connect-outcome={done.result}>
          <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>
            {merged
              ? <>The server already held {name}. Both copies were merged{hasChanges(done.report) ? `: ${mergeSummary(done.report)}` : ', and nothing changed here'}.</>
              : <>{name} is on <span className="mono">{done.url}</span> now. Other machines can connect: Welcome → Connect to a remote vault.</>}
          </span>
          <span className="hint">Flint keeps it in step on its own: at unlock, after a change, and every minute.</span>
        </div>
        <div className="modal-f"><span className="grow" /><button className="btn btn-primary" onClick={onClose} autoFocus>Done<Key>esc</Key></button></div>
      </Modal>
    );
  }

  return (
    <Modal label={`Connect ${name} to a server`} onClose={busy ? () => {} : onClose} width={560} scrimCloses={!busy}>
      <form aria-label="Connect to a server" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="modal-h"><Icon name="server" size="sm" /><h2 className="grow">Connect {name} to a server</h2>
          <button type="button" className="icon-btn" aria-label="Close (esc)" onClick={onClose} disabled={busy}><Icon name="x" size="sm" /></button></div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)' }}>
          <ServerAddress id="csa" value={url} onChange={setUrl} error={errors.url} disabled={busy} autoFocus />
          <TokenField id="cst" value={token} onChange={setToken} error={errors.token} disabled={busy} />
          <div className="field">
            <label className="flabel" htmlFor="cmp">Master password of {name}, again</label>
            <div className={'input' + (errors.pw ? ' err' : '')}>
              <input id="cmp" type="password" className="pw" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" disabled={busy} />
            </div>
            <div className="row" style={{ gap: 'var(--sp-3)' }}>
              <div className={'meter grow ' + meterClass(strength)} role="meter" aria-label="Password strength" aria-valuenow={strength?.score ?? 0} aria-valuemin={0} aria-valuemax={4}>
                {[1, 2, 3, 4].map((i) => <i key={i} className={strength && i <= strength.score ? 'on' : ''} />)}
              </div>
              <span className={labelClass(strength)} style={{ fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-medium)' }}>{pw ? (strength?.label ?? '') : ''}</span>
            </div>
            {errors.pw
              ? <span className="hint err" role="alert">{errors.pw}</span>
              : weak
                ? <span className="hint warn-t" data-testid="sync-weak">A vault on a server needs a Strong password — <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }} onClick={onChangePassword}>Change master password…</button></span>
                : null}
          </div>
          {errors.form && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{errors.form}</span>}
        </div>
        <div className="modal-f">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!ready}>{busy ? 'Connecting…' : 'Connect'}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </Modal>
  );
}

export function ServerAddress({ id, value, onChange, error, disabled, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; error?: string; disabled?: boolean; autoFocus?: boolean;
}) {
  return (
    <div className="field">
      <label className="flabel" htmlFor={id}>Server address</label>
      <div className={'input' + (error ? ' err' : '')}>
        <Icon name="server" size="sm" className="faint" />
        <input id={id} className="mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://vault.example.com"
          autoComplete="off" spellCheck={false} disabled={disabled} autoFocus={autoFocus} data-autofocus={autoFocus || undefined} aria-describedby={error ? id + '-e' : undefined} />
      </div>
      {error && <span id={id + '-e'} className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
    </div>
  );
}
