// The server's token (designs 23a1, 23b2, 23b4): a password field with Show and
// Paste. The value lives only in the form; once sent it goes to the keychain.

import { useRef, useState } from 'react';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';

export function TokenField({ id, value, onChange, error, disabled, autoFocus }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const { os } = useApp();
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { onChange(t.trim()); return; }
    } catch { /* WebKit may refuse: the field takes ⌘V */ }
    ref.current?.focus();
  };
  const keychain = os === 'mac' ? 'the macOS Keychain' : 'the system keyring';
  return (
    <div className="field">
      <label className="flabel" htmlFor={id}>Token</label>
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <div className={'input grow' + (error ? ' err' : '')}>
          <input ref={ref} id={id} type={show ? 'text' : 'password'} className={'mono' + (show ? '' : ' pw')} value={value}
            onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} disabled={disabled} autoFocus={autoFocus}
            aria-describedby={error ? id + '-e' : undefined} />
          <button type="button" className="icon-btn" aria-label={show ? 'Hide token' : 'Show token'} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button>
        </div>
        <button type="button" className="btn btn-secondary" style={{ height: 'var(--control-h)' }} onClick={() => paste().catch(() => {})} disabled={disabled}><Icon name="paste" size="sm" />Paste</button>
      </div>
      {error
        ? <span id={id + '-e'} className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>
        : <span className="hint">The long random string the server printed when it started. Saved in {keychain}, never shown again.</span>}
    </div>
  );
}

/** Which field a failed server check belongs under (design 23a2). */
export function serverErrorField(code: string): 'url' | 'token' | 'form' {
  if (code === 'auth' || code === 'usage') return 'token';
  if (code === 'invalid' || code === 'not_found' || code === 'network' || code === 'timeout' || code === 'refused') return 'url';
  return 'form';
}
