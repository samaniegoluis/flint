import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api/backend';
import type { RecentView } from '../api/types';
import { shortPath, useApp, vaultInitial, vaultMarkClass } from '../state/app';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';

// The vault switcher popover (⇧⌘O): recent vaults, then Open, Create and Manage.
export function VaultMenu({ onClose, onManage, style }: { onClose: () => void; onManage?: () => void; style?: CSSProperties }) {
  const { recents, vault, switchTo, openVaultFile, go, fail, refreshRecents } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState(0);

  useEffect(() => { refreshRecents().catch(() => {}); }, [refreshRecents]);

  type Item = { key: string; run: () => void };
  const items: Item[] = [
    ...recents.map((r) => ({ key: r.path, run: () => { onClose(); if (r.path !== vault?.path) switchTo(r).catch(fail); } })),
    { key: 'open', run: () => { onClose(); openVaultFile().catch(fail); } },
    { key: 'create', run: () => { onClose(); go('create'); } },
    ...(onManage ? [{ key: 'manage', run: () => { onClose(); onManage(); } }] : []),
  ];

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-hot="true"]')?.focus();
  }, [hot]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHot((hot + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHot((hot - 1 + items.length) % items.length); }
  };

  let i = -1;
  const mi = (key: string) => {
    i++;
    const idx = i;
    return { className: 'mi' + (idx === hot ? ' hot' : ''), 'data-hot': idx === hot, tabIndex: idx === hot ? 0 : -1, onMouseEnter: () => setHot(idx), onClick: () => items[idx].run(), key };
  };

  return (
    <div ref={ref} className="menu" role="dialog" aria-label="Switch vault" style={{ position: 'absolute', width: 340, zIndex: 'var(--z-popover)' as unknown as number, ...style }} onKeyDown={onKey}>
      <div className="menu-label"><span className="label">Vaults</span><Kbd action="switchVault" /></div>
      {recents.map((r) => (
        <button {...mi(r.path)} style={{ minHeight: 48 }}>
          <span className={'vault-mark ' + vaultMarkClass(r.path)}>{vaultInitial(r.name)}</span>
          <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
            <span className="strong row" style={{ gap: 6 }}>{r.name}{!r.exists && <span className="badge warn">not found</span>}</span>
            <span className="vault-path trunc">{shortPath(r.path)}</span>
          </span>
          {r.path === vault?.path && <Icon name="check" size="sm" className="accent-t" label="Current vault" />}
        </button>
      ))}
      {recents.length > 0 && <div className="menu-sep" />}
      <button {...mi('open')}><Icon name="folder" size="sm" />Open vault…<Kbd action="openVault" /></button>
      <button {...mi('create')}><Icon name="plus" size="sm" />Create vault…<Kbd action="createVault" /></button>
      {onManage && <button {...mi('manage')}><Icon name="settings" size="sm" />Manage vaults…</button>}
      <div className="menu-sep" />
      <div className="row faint" style={{ padding: 'var(--sp-1) var(--sp-2) var(--sp-2)', fontSize: 'var(--fs-xs)', gap: 'var(--sp-3)' }}>
        <span className="row" style={{ gap: 4 }}><Key>↑↓</Key>move</span>
        <span className="row" style={{ gap: 4 }}><Key>↵</Key>switch</span>
        <span className="row" style={{ gap: 4 }}><Key>esc</Key>close</span>
      </div>
    </div>
  );
}

// Renames the open vault in place: the name, then Save or Cancel. A name another
// vault in the list already uses is refused by the core (conflict).
export function RenameVault({ onDone }: { onDone: () => void }) {
  const { vault, renameVault, notify, fail } = useApp();
  const [name, setName] = useState(vault?.name ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = name.trim();
    if (!v || v === vault?.name) { onDone(); return; }
    setBusy(true);
    try {
      const old = vault?.name;
      await renameVault(v);
      notify(`Renamed ${old} to ${v}`);
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="row" style={{ gap: 'var(--sp-2)' }} onSubmit={(e) => { e.preventDefault(); save(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDone(); } }}>
      <div className="input" style={{ minWidth: 180 }}>
        <input aria-label="Vault name" value={name} maxLength={64} autoFocus data-autofocus onChange={(e) => setName(e.target.value)} />
      </div>
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !name.trim()}>Save</button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onDone}>Cancel</button>
    </form>
  );
}

// Manage vaults: every recent vault, with Forget key and Remove from list, and
// Rename for the open one (another vault is renamed after opening it).
export function ManageVaults({ onClose }: { onClose: () => void }) {
  const { recents, vault, refreshRecents, notify, fail, closeVault } = useApp();
  const [confirm, setConfirm] = useState<{ r: RecentView; kind: 'key' | 'list' } | null>(null);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => { refreshRecents().catch(() => {}); }, [refreshRecents]);

  const run = async () => {
    if (!confirm) return;
    const { r, kind } = confirm;
    setConfirm(null);
    try {
      const wasCurrent = r.path === vault?.path;
      if (kind === 'key') await api.forgetKey(r.path);
      else await api.forget(r.path);
      notify(kind === 'key' ? `This machine no longer remembers the key of ${r.name}` : `${r.name} removed from the list`);
      if (wasCurrent) {
        onClose();
        await closeVault();
      } else {
        await refreshRecents();
      }
    } catch (err) {
      fail(err);
    }
  };

  return (
    <Modal label="Manage vaults" onClose={onClose} width={720}>
      <div className="modal-h"><h2 className="grow">Manage vaults</h2><button className="icon-btn" aria-label="Close (esc)" onClick={onClose}><Icon name="x" size="sm" /></button></div>
      <div className="modal-b scroll" style={{ gap: 'var(--sp-3)' }}>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Vaults this machine has opened. The files themselves are never deleted here.</p>
        <table className="table compact">
          <thead><tr><th>Vault</th><th>File</th><th /></tr></thead>
          <tbody>
            {recents.map((r) => (
              <tr key={r.path}>
                <td className="primary">{renaming && r.path === vault?.path
                  ? <RenameVault onDone={() => setRenaming(false)} />
                  : <div className="row"><span className={'vault-mark ' + vaultMarkClass(r.path)}>{vaultInitial(r.name)}</span>{r.name}{r.path === vault?.path && <span className="badge accent">open</span>}{!r.exists && <span className="badge warn">not found</span>}</div>}</td>
                <td className="mono trunc" style={{ maxWidth: 300, fontSize: 'var(--fs-xs)' }} title={r.path}>{shortPath(r.path)}</td>
                <td style={{ textAlign: 'right' }}>
                  {r.path === vault?.path && !renaming && <button className="btn btn-ghost btn-sm" onClick={() => setRenaming(true)}>Rename</button>}
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ r, kind: 'key' })}>Forget key</button>
                  <button className="btn btn-danger-ghost btn-sm" onClick={() => setConfirm({ r, kind: 'list' })}>Remove</button>
                </td>
              </tr>
            ))}
            {recents.length === 0 && <tr><td colSpan={3} className="faint">No vaults yet.</td></tr>}
          </tbody>
        </table>
        {confirm && (
          <div className="callout warn" role="alertdialog" aria-label="Confirm">
            <Icon name="alert" size="sm" className="warn-t" />
            <div className="col grow" style={{ gap: 'var(--sp-2)' }}>
              <span>{confirm.kind === 'key'
                ? <>Forget the saved key of <strong>{confirm.r.name}</strong>? This machine will ask for its master password next time.</>
                : <>Remove <strong>{confirm.r.name}</strong> from the list and forget its key? The file stays where it is.</>}</span>
              <div className="row"><button className="btn btn-secondary btn-sm" onClick={() => setConfirm(null)} data-autofocus>Cancel</button><button className="btn btn-danger btn-sm" onClick={() => run()}>{confirm.kind === 'key' ? 'Forget key' : 'Remove'}</button></div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
