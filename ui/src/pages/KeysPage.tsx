// SSH keys (design screen 07): the vault's keys, stored by content, with the hosts
// and credentials that use them. A key is added by pasting it or picking a file;
// the private half never comes back to the page.

import { useMemo, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { useTrapFocus } from '../ui/Modal';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { useRef } from 'react';

export function KeysPage({ adding, setAdding, onConfirm }: { adding: boolean; setAdding: (v: boolean) => void; onConfirm: (c: Confirm) => void }) {
  const { catalog, notify, fail, refreshCatalog } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);

  const usedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of catalog.hosts) if (h.key) m.set(h.key, (m.get(h.key) ?? 0) + 1);
    for (const c of catalog.credentials) if (c.key) m.set(c.key, (m.get(c.key) ?? 0) + 1);
    return m;
  }, [catalog]);

  const keys = catalog.keys.filter((k) => !q || (k.name + ' ' + k.fingerprint).toLowerCase().includes(q.toLowerCase()));

  const copy = (name: string, pub: string) => {
    navigator.clipboard?.writeText(pub).then(() => notify(`Public key of ${name} copied`)).catch(() => notify('Copy failed', 'error'));
  };

  const rename = async () => {
    if (!renaming) return;
    try {
      await api.keyRename(renaming.name, renaming.value.trim());
      await refreshCatalog();
      setRenaming(null);
    } catch (err) {
      fail(err);
    }
  };

  const remove = (name: string) => onConfirm({
    title: `Delete key ${name}?`,
    body: usedBy.get(name) ? `It is linked to ${usedBy.get(name)} hosts or credentials; Flint refuses while it is in use.` : 'The private key is removed from the vault. This cannot be undone.',
    action: 'Delete key',
    run: async () => { await api.keyRm(name); await refreshCatalog(); notify(`Deleted ${name}`); },
  });

  return (
    <section className="main page" aria-label="SSH keys">
      <div className="page-h">
        <h1>SSH keys</h1><span className="badge">{catalog.keys.length}</span>
        <span className="grow" />
        <label className="search" style={{ width: 240 }}><Icon name="search" size="sm" /><input aria-label="Filter keys" placeholder="Filter by name or fingerprint" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size="sm" />Add key<Kbd action="newHost" inline /></button>
      </div>
      <div className="scroll" style={{ padding: '0 var(--sp-6) var(--sp-6)' }}>
        {catalog.keys.length === 0 ? (
          <div className="empty" style={{ paddingTop: 'var(--sp-12)' }}>
            <span className="empty-ic"><Icon name="key" size="lg" /></span>
            <h2>No SSH keys yet</h2>
            <p style={{ maxWidth: 420 }}>Paste a private key or import one from a file. It is stored encrypted inside the vault, so it travels with it.</p>
            <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size="sm" />Add key</button>
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Fingerprint</th><th>Used by</th><th style={{ textAlign: 'right' }}>Public key</th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.name} className={sel === k.name ? 'sel' : ''} onClick={() => setSel(k.name)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSel(k.name);
                    setMenu({ x: e.clientX, y: e.clientY, items: [
                      { label: 'Copy public key', icon: 'clip', run: () => copy(k.name, k.public_key) },
                      { label: 'Rename', icon: 'edit', run: () => setRenaming({ name: k.name, value: k.name }) },
                      { label: 'Delete key', icon: 'trash', danger: true, run: () => remove(k.name) },
                    ] });
                  }}>
                  <td className="primary"><div className="row">
                    <Icon name="key" size="sm" className={sel === k.name ? 'info-t' : 'faint'} />
                    {renaming?.name === k.name ? (
                      <div className="input" style={{ height: 26 }}><input className="mono" autoFocus value={renaming.value} aria-label="New key name"
                        onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setRenaming(null); }} onBlur={() => setRenaming(null)} /></div>
                    ) : <span className="mono">{k.name}</span>}
                    {k.has_passphrase && <Icon name="lock" size="xs" className="faint" label="Has passphrase" />}
                  </div></td>
                  <td><span className="chip">{k.type.toUpperCase().replace('SSH-', '')}</span></td>
                  <td className="mono" style={{ fontSize: 'var(--fs-xs)' }} title={k.fingerprint}>{k.fingerprint}</td>
                  <td className={usedBy.get(k.name) ? '' : 'faint'}>{usedBy.get(k.name) ? `${usedBy.get(k.name)} uses` : 'Unused'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); copy(k.name, k.public_key); }}><Icon name="clip" size="sm" />Copy</button>
                    <button className="btn btn-ghost btn-sm btn-icon" aria-label={`More actions for ${k.name}`} onClick={(e) => {
                      e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMenu({ x: r.left - 180, y: r.bottom + 4, items: [
                        { label: 'Rename', icon: 'edit', run: () => setRenaming({ name: k.name, value: k.name }) },
                        { label: 'Delete key', icon: 'trash', danger: true, run: () => remove(k.name) },
                      ] });
                    }}><Icon name="more" size="sm" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {adding && <AddKeyDrawer onClose={() => setAdding(false)} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </section>
  );
}

export interface Confirm {
  title: string;
  body: string;
  action: string;
  run: () => Promise<void>;
}

function AddKeyDrawer({ onClose }: { onClose: () => void }) {
  const { refreshCatalog, notify, os } = useApp();
  const [source, setSource] = useState<'paste' | 'file'>('paste');
  const [text, setText] = useState('');
  const [file, setFile] = useState('');
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useTrapFocus(ref, onClose);

  const encrypted = /ENCRYPTED|aes\d+-ctr|bcrypt/.test(text) || (text.includes('OPENSSH PRIVATE KEY') && /YmNyeXB0/.test(text));

  const pick = async () => {
    const { path } = await api.dialogOpen('Choose a private key');
    if (!path) return;
    setFile(path);
    if (!name) setName(path.split('/').pop()!.replace(/\.(pem|key)$/, ''));
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const k = await api.keyAdd(name.trim(), source === 'paste' ? text : '', source === 'file' ? file : '', pass);
      await refreshCatalog();
      notify(`Added key ${k.name}`);
      onClose();
    } catch (err) {
      setError(toFlintError(err).message);
      setBusy(false);
    }
  };

  const ready = name.trim() && (source === 'paste' ? text.trim() : file) && !busy;
  return (
    <aside ref={ref} className="drawer" role="dialog" aria-label="Add SSH key">
      <form style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Enter' && (os === 'mac' ? e.metaKey : e.ctrlKey) && ready) submit(); }}>
        <div className="modal-h"><h2 className="grow">Add SSH key</h2><button type="button" className="icon-btn" aria-label="Close (esc)" onClick={onClose}><Icon name="x" size="sm" /></button></div>
        <div className="modal-b scroll" style={{ flex: 1 }}>
          <div className="seg full" role="group" aria-label="Source">
            <button type="button" aria-pressed={source === 'paste'} onClick={() => setSource('paste')}><Icon name="clip" size="sm" />Paste</button>
            <button type="button" aria-pressed={source === 'file'} onClick={() => { setSource('file'); if (!file) pick().catch(() => {}); }}><Icon name="file" size="sm" />From file…</button>
          </div>
          {source === 'paste' ? (
            <div className="field"><label className="flabel" htmlFor="pk">Private key</label>
              <div className="input area"><textarea id="pk" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" spellCheck={false} data-autofocus /></div></div>
          ) : (
            <div className="field"><span className="flabel">Key file</span>
              <div className="row" style={{ gap: 'var(--sp-2)' }}>
                <div className="input grow"><Icon name="file" size="sm" className="faint" /><input className="mono" aria-label="Key file" value={file} onChange={(e) => setFile(e.target.value)} style={{ fontSize: 'var(--fs-sm)' }} /></div>
                <button type="button" className="btn btn-secondary" style={{ height: 'var(--control-h)' }} onClick={() => pick().catch(() => {})}>Choose…</button>
              </div>
              <span className="hint">The file's content is copied into the vault; the file itself is not needed afterwards.</span></div>
          )}
          <div className="field"><label className="flabel" htmlFor="kn">Name</label>
            <div className="input"><input id="kn" className="mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="deploy-2026" /></div></div>
          <div className="field"><label className="flabel" htmlFor="kp">Passphrase <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>· {encrypted ? 'this key is encrypted' : 'only if the key is encrypted'}</span></label>
            <div className="input"><input id="kp" type={show ? 'text' : 'password'} className={show ? '' : 'pw'} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
              <button type="button" className="icon-btn" aria-label={show ? 'Hide passphrase' : 'Show passphrase'} onClick={() => setShow(!show)}><Icon name="eye" size="sm" /></button></div>
            <span className="hint">Stored in the vault, sealed like the key, so connections never ask for it.</span></div>
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f"><span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" disabled={!ready}>{busy ? 'Adding…' : 'Add key'}<span className="kbd-in">{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</span></button>
        </div>
      </form>
    </aside>
  );
}
