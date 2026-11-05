import { useState } from 'react';
import { toFlintError } from '../api/backend';
import { Icon } from './Icon';
import { Key } from './Kbd';
import { Modal } from './Modal';
import type { Confirm } from '../pages/KeysPage';

export function ConfirmDialog({ c, onClose }: { c: Confirm; onClose: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await c.run();
      onClose();
    } catch (err) {
      setError(toFlintError(err).message);
      setBusy(false);
    }
  };
  return (
    <Modal label={c.title} onClose={onClose} width={440} top={140}>
      <div className="prompt" style={{ width: 'auto' }}>
        <div className="prompt-h"><span className="prompt-ic danger"><Icon name="trash" /></span>
          <div className="col grow" style={{ gap: 4 }}><h2 className="prompt-t">{c.title}</h2><p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{c.body}</p></div></div>
        {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          <button className="btn btn-ghost" onClick={onClose} data-autofocus>Cancel<Key>esc</Key></button>
          <button className="btn btn-danger" onClick={run} disabled={busy}>{c.action}</button>
        </div>
      </div>
    </Modal>
  );
}

export interface TextAsk {
  title: string;
  label: string;
  value: string;
  action: string;
  hint?: string;
  run: (value: string) => Promise<void>;
}

export function TextDialog({ ask, onClose }: { ask: TextAsk; onClose: () => void }) {
  const [v, setV] = useState(ask.value);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await ask.run(v.trim());
      onClose();
    } catch (err) {
      setError(toFlintError(err).message);
    }
  };
  return (
    <Modal label={ask.title} onClose={onClose} width={440} top={140}>
      <form onSubmit={submit}>
        <div className="modal-h"><h2 className="grow">{ask.title}</h2></div>
        <div className="modal-b">
          <div className="field"><label className="flabel" htmlFor="ta">{ask.label}</label>
            <div className={'input' + (error ? ' err' : '')}><input id="ta" value={v} onChange={(e) => setV(e.target.value)} data-autofocus autoFocus onFocus={(e) => e.target.select()} /></div>
            {error ? <span className="hint err">{error}</span> : ask.hint && <span className="hint">{ask.hint}</span>}</div>
        </div>
        <div className="modal-f"><span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!v.trim()}>{ask.action}<span className="kbd-in">↵</span></button>
        </div>
      </form>
    </Modal>
  );
}
