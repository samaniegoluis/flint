// Credentials (design screen 08): a user plus a password or a key, linked from many
// hosts. A stored password shows only as "Password"; editing replaces it.

import { useMemo, useRef, useState } from 'react';
import { api, emptyCredPatch, toFlintError } from '../api/backend';
import type { CredView } from '../api/types';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { useTrapFocus } from '../ui/Modal';
import { PasswordField } from '../ui/PasswordField';
import { Picker } from '../ui/Picker';
import type { Confirm } from './KeysPage';

export function CredentialsPage({ editing, setEditing, onConfirm }: {
  editing: string | null | undefined; // undefined: closed · null: new · name: edit
  setEditing: (v: string | null | undefined) => void;
  onConfirm: (c: Confirm) => void;
}) {
  const { catalog, refreshCatalog, notify } = useApp();
  const [q, setQ] = useState('');
  const usedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of catalog.hosts) if (h.credential) m.set(h.credential, (m.get(h.credential) ?? 0) + 1);
    return m;
  }, [catalog.hosts]);
  const creds = catalog.credentials.filter((c) => !q || (c.name + ' ' + c.user).toLowerCase().includes(q.toLowerCase()));

  const remove = (c: CredView) => onConfirm({
    title: `Delete credential ${c.name}?`,
    body: usedBy.get(c.name) ? `${usedBy.get(c.name)} hosts use it; Flint refuses while it is in use.` : 'Its user and secret are removed from the vault.',
    action: 'Delete credential',
    run: async () => { await api.credRm(c.name); await refreshCatalog(); notify(`Deleted ${c.name}`); setEditing(undefined); },
  });

  return (
    <section className="main page" aria-label="Credentials">
      <div className="page-h">
        <h1>Credentials</h1><span className="badge">{catalog.credentials.length}</span>
        <span className="grow" />
        <label className="search" style={{ width: 240 }}><Icon name="search" size="sm" /><input aria-label="Filter credentials" placeholder="Filter credentials" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className="btn btn-primary" onClick={() => setEditing(null)}><Icon name="plus" size="sm" />New credential<Kbd action="newHost" inline /></button>
      </div>
      <p className="muted" style={{ padding: '0 var(--sp-6) var(--sp-3)', fontSize: 'var(--fs-sm)', maxWidth: 640 }}>A credential is a username plus a password or key. Link it to many hosts and change it in one place.</p>
      <div className="scroll" style={{ padding: '0 var(--sp-6) var(--sp-6)' }}>
        <table className="table">
          <thead><tr><th>Name</th><th>Username</th><th>Auth</th><th>Used by</th><th /></tr></thead>
          <tbody>
            {creds.map((c) => (
              <tr key={c.name} className={editing === c.name ? 'sel' : ''} onDoubleClick={() => setEditing(c.name)}>
                <td className="primary"><div className="row"><Icon name="cred" size="sm" className={editing === c.name ? 'info-t' : 'faint'} />{c.name}</div></td>
                <td className="mono">{c.user}</td>
                <td>{c.key ? <span className="badge info"><Icon name="key" />{c.key}</span> : c.has_password ? <span className="badge"><Icon name="lock" />Password</span> : <span className="badge"><Icon name="link" />Agent</span>}</td>
                <td className={usedBy.get(c.name) ? '' : 'faint'}>{usedBy.get(c.name) ? `${usedBy.get(c.name)} hosts` : 'Unused'}</td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-sm" onClick={() => setEditing(c.name)}><Icon name="edit" size="sm" />Edit</button></td>
              </tr>
            ))}
            {catalog.credentials.length === 0 && <tr><td colSpan={5} className="faint">No credentials yet. Create one and link it from your hosts.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing !== undefined && <CredEditor name={editing} onClose={() => setEditing(undefined)} onDelete={remove} />}
    </section>
  );
}

function CredEditor({ name, onClose, onDelete }: { name: string | null; onClose: () => void; onDelete: (c: CredView) => void }) {
  const { catalog, refreshCatalog, notify, os } = useApp();
  const cred = name ? catalog.credentials.find((c) => c.name === name) : undefined;
  const [n, setN] = useState(cred?.name ?? '');
  const [user, setUser] = useState(cred?.user ?? '');
  const [mode, setMode] = useState<'password' | 'key' | 'agent'>(cred?.key ? 'key' : cred && !cred.has_password ? 'agent' : 'password');
  const [key, setKey] = useState(cred?.key ?? '');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const ref = useRef<HTMLElement>(null);
  useTrapFocus(ref, onClose);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const p = emptyCredPatch();
    if (!cred || cred.name !== n.trim()) { p.name = n.trim(); p.set_name = true; }
    if (!cred || cred.user !== user.trim()) { p.user = user.trim(); p.set_user = true; }
    const wantKey = mode === 'key' ? key : '';
    if (!cred || cred.key !== wantKey) { p.key = wantKey; p.set_key = true; }
    if (mode === 'password' && pw) { p.password = pw; p.set_password = true; }
    if (mode !== 'password' && cred?.has_password) { p.password = ''; p.set_password = true; }
    try {
      const saved = cred ? await api.credEdit(cred.name, p) : await api.credAdd(p);
      await refreshCatalog();
      notify(cred ? `Saved ${saved.name}` : `Added ${saved.name}`);
      onClose();
    } catch (err) {
      setError(toFlintError(err).message);
    }
  };

  return (
    <aside ref={ref} className="drawer" role="dialog" aria-label={cred ? `Edit credential ${cred.name}` : 'New credential'}>
      <form style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Enter' && (os === 'mac' ? e.metaKey : e.ctrlKey)) submit(); }}>
        <div className="modal-h"><h2 className="grow">{cred ? 'Edit credential' : 'New credential'}</h2><button type="button" className="icon-btn" aria-label="Close (esc)" onClick={onClose}><Icon name="x" size="sm" /></button></div>
        <div className="modal-b scroll" style={{ flex: 1 }}>
          <div className="field"><label className="flabel" htmlFor="cn">Name</label><div className="input"><input id="cn" value={n} onChange={(e) => setN(e.target.value)} placeholder="domain-login" data-autofocus /></div></div>
          <div className="field"><label className="flabel" htmlFor="cu">Username</label><div className="input"><input id="cu" className="mono" value={user} onChange={(e) => setUser(e.target.value)} placeholder="luis" /></div></div>
          <div className="field"><span className="flabel">Authentication</span>
            <div className="seg full" role="group" aria-label="Authentication method">
              <button type="button" aria-pressed={mode === 'password'} onClick={() => setMode('password')}><Icon name="lock" size="sm" />Password</button>
              <button type="button" aria-pressed={mode === 'key'} onClick={() => setMode('key')}><Icon name="key" size="sm" />Key</button>
              <button type="button" aria-pressed={mode === 'agent'} onClick={() => setMode('agent')}><Icon name="link" size="sm" />Agent</button>
            </div>
            {mode === 'password' && <PasswordField value={pw} onChange={setPw} saved={cred?.has_password ? { kind: 'credential', name: cred.name } : null}
              placeholder={cred?.has_password ? 'Saved — type to replace' : 'Password'} />}
            {mode === 'key' && <Picker label="SSH key" value={key} onChange={setKey} icon="key" placeholder="Choose a key"
              options={catalog.keys.map((k) => ({ value: k.name, text: k.name, label: <>{k.name} <span className="faint mono">· {k.type}</span></> }))} />}
            {mode === 'agent' && <span className="hint">Uses the keys loaded in your SSH agent.</span>}
          </div>
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          {cred && <button type="button" className="btn btn-danger-ghost" onClick={() => onDelete(cred)}><Icon name="trash" size="sm" />Delete</button>}
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary">{cred ? 'Save' : 'Add credential'}<span className="kbd-in">{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</span></button>
        </div>
      </form>
    </aside>
  );
}
