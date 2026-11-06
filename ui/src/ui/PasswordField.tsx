// A password input with reveal and copy (D-029). A typed value is shown or hidden in
// place. A saved one is fetched only when the person asks to see it, hidden again
// after REVEAL_MS, and never kept in state that outlives the field; Copy asks the
// core to put it on the clipboard, so the value never reaches the page.

import { useEffect, useRef, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import { useApp } from '../state/app';
import { Icon } from './Icon';

export const REVEAL_MS = 10000;

export function PasswordField({ value, onChange, saved, placeholder, label = 'Password' }: {
  value: string;
  onChange: (v: string) => void;
  /** The owner of a saved password, when there is one; enables reveal and copy. */
  saved: { kind: 'host' | 'credential'; name: string } | null;
  placeholder: string;
  label?: string;
}) {
  const { notify, fail } = useApp();
  const [shown, setShown] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const hide = () => {
    window.clearTimeout(timer.current);
    setShown(false);
    setRevealed(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const showSaved = !value && !!saved;

  const toggle = async () => {
    if (shown) { hide(); return; }
    if (showSaved) {
      try {
        const r = await api.secretReveal(saved!.kind, saved!.name);
        setRevealed(r.value);
      } catch (err) {
        fail(toFlintError(err));
        return;
      }
    }
    setShown(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(hide, REVEAL_MS);
  };
  const copy = async () => {
    try {
      await api.secretCopy(saved!.kind, saved!.name);
      notify('Password copied · the clipboard clears in 30 s');
    } catch (err) {
      fail(toFlintError(err));
    }
  };

  return (
    <div className="input"><Icon name="lock" size="sm" className="faint" />
      <input type={shown ? 'text' : 'password'} className={shown ? 'mono' : 'pw'} aria-label={label} autoComplete="off" spellCheck={false}
        value={revealed ?? value} readOnly={revealed !== null} placeholder={placeholder}
        onChange={(e) => { if (revealed === null) onChange(e.target.value); }}
        onKeyDown={(e) => { if (revealed !== null && e.key.length === 1) { hide(); } }} />
      {(value || saved) && (
        <button type="button" className="icon-btn" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} title={shown ? 'Hide' : 'Show'} onClick={toggle}>
          <Icon name="eye" size="sm" />
        </button>
      )}
      {showSaved && (
        <button type="button" className="icon-btn" aria-label="Copy saved password" title="Copy · clears in 30 s" onClick={copy}><Icon name="clip" size="sm" /></button>
      )}
    </div>
  );
}
