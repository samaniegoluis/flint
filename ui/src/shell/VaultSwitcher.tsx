import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api/backend';
import type { RecentView } from '../api/types';
import { shortPath, useApp, vaultInitial, vaultMarkClass } from '../state/app';
import { Icon } from '../ui/Icon';
import { Kbd, Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

// The vault switcher popover (⇧⌘O): recent vaults, then Open, Create and Manage.
export function VaultMenu({ onClose, onManage, style }: { onClose: () => void; onManage?: () => void; style?: CSSProperties }) {
  const { recents, vault, switchTo, openVaultFile, go, fail, refreshRecents } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState(0);

  useEffect(() => { refreshRecents().catch(() => {}); }, [refreshRecents]);
  // A cloud mark on the vaults kept in step by a server (milestone 44, design 23d).
  const [servers, setServers] = useState<Record<string, string>>({});
  useEffect(() => {
    api.remotes().then((r) => setServers(Object.fromEntries(r.links.map((l) => [l.path, l.url])))).catch(() => {});
  }, [recents]);

  type Item = { key: string; run: () => void };
  const items: Item[] = [
    ...recents.map((r) => ({ key: r.path, run: () => { onClose(); if (r.path !== vault?.path) switchTo(r).catch(fail); } })),
    { key: 'open', run: () => { onClose(); openVaultFile().catch(fail); } },
    { key: 'create', run: () => { onClose(); go('create'); } },
    { key: 'connect', run: () => { onClose(); go('connect'); } },
    ...(onManage ? [{ key: 'manage', run: () => { onClose(); onManage(); } }] : []),
  ];

  // The menu stays inside the window: one that would run past the bottom edge moves up
  // (over whatever opened it), and one taller than the window scrolls. The unlock
  // screen's footer sits low, and with a few vaults its menu hid the last items.
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
    el.style.maxHeight = '';
    el.style.overflowY = '';
    const margin = 8;
    const r = el.getBoundingClientRect();
    const room = window.innerHeight - 2 * margin;
    if (r.height > room) {
      el.style.maxHeight = room + 'px';
      el.style.overflowY = 'auto';
    }
    const over = r.top + Math.min(r.height, room) - (window.innerHeight - margin);
    if (over > 0) el.style.transform = `translateY(${-Math.min(over, r.top - margin)}px)`;
  }, []);
  useLayoutEffect(fit, [fit, recents.length, servers, onManage]);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

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
    <div ref={ref} className="menu" role="dialog" aria-label={t('vault_switcher.switch_vault')} style={{ position: 'absolute', width: 340, zIndex: 'var(--z-popover)' as unknown as number, ...style }} onKeyDown={onKey}>
      <div className="menu-label"><span className="label">{t('vault_switcher.vaults')}</span><Kbd action="switchVault" /></div>
      {recents.map((r) => (
        <button {...mi(r.path)} style={{ minHeight: 48 }}>
          <span className={'vault-mark ' + vaultMarkClass(r.path)}>{vaultInitial(r.name)}</span>
          <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
            <span className="strong row" style={{ gap: 6 }}>{r.name}{servers[r.path] && <span title={t('vault_switcher.kept_in_step_with_p', { p: servers[r.path] })} data-cloud-mark style={{ display: 'inline-flex' }}><Icon name="cloud" className="cloud-mark" label={t('vault_switcher.kept_in_step_with_p', { p: servers[r.path] })} /></span>}{!r.exists && <span className="badge warn">{t('vault_switcher.not_found')}</span>}</span>
            <span className="vault-path trunc">{shortPath(r.path)}</span>
          </span>
          {r.path === vault?.path && <Icon name="check" size="sm" className="accent-t" label={t('vault_switcher.current_vault')} />}
        </button>
      ))}
      {recents.length > 0 && <div className="menu-sep" />}
      <button {...mi('open')}>{tr('vault_switcher.iconopen_vault_kbd', { icon: <Icon name="folder" size="sm" />, kbd: <Kbd action="openVault" /> })}</button>
      <button {...mi('create')}>{tr('vault_switcher.iconcreate_vault_kbd', { icon: <Icon name="plus" size="sm" />, kbd: <Kbd action="createVault" /> })}</button>
      <button {...mi('connect')}>{tr('vault_switcher.iconconnect_to_a_remote_vault', { icon: <Icon name="server" size="sm" />, kbd: <Kbd action="connectRemote" /> })}</button>
      {onManage && <button {...mi('manage')}><Icon name="settings" size="sm" />{t('vault_switcher.manage_vaults')}</button>}
      <div className="menu-sep" />
      <div className="row faint" style={{ padding: 'var(--sp-1) var(--sp-2) var(--sp-2)', fontSize: 'var(--fs-xs)', gap: 'var(--sp-3)' }}>
        <span className="row" style={{ gap: 4 }}><Key>↑↓</Key>{t('vault_switcher.move')}</span>
        <span className="row" style={{ gap: 4 }}><Key>↵</Key>{t('vault_switcher.switch')}</span>
        <span className="row" style={{ gap: 4 }}><Key>esc</Key>{t('vault_switcher.close')}</span>
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
      notify(t('vault_switcher.renamed_old_to_v', { old, v }));
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
        <input {...plainText} aria-label={t('vault_switcher.vault_name')} value={name} maxLength={64} autoFocus data-autofocus onChange={(e) => setName(e.target.value)} />
      </div>
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !name.trim()}>{t('common.save')}</button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onDone}>{t('common.cancel')}</button>
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
      notify(kind === 'key' ? t('vault_switcher.this_machine_no_longer_remembers', { name: r.name }) : t('vault_switcher.name_removed_from_the_list', { name: r.name }));
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
    <Modal label={t('vault_switcher.manage_vaults_2')} onClose={onClose} width={720}>
      <div className="modal-h"><h2 className="grow">{t('vault_switcher.manage_vaults_2')}</h2><button className="icon-btn" aria-label={t('vault_switcher.close_esc')} onClick={onClose}><Icon name="x" size="sm" /></button></div>
      <div className="modal-b scroll" style={{ gap: 'var(--sp-3)' }}>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('vault_switcher.vaults_this_machine_has_opened')}</p>
        <table className="table compact">
          <thead><tr><th>{t('vault_switcher.vault')}</th><th>{t('vault_switcher.file')}</th><th /></tr></thead>
          <tbody>
            {recents.map((r) => (
              <tr key={r.path}>
                <td className="primary">{renaming && r.path === vault?.path
                  ? <RenameVault onDone={() => setRenaming(false)} />
                  : <div className="row"><span className={'vault-mark ' + vaultMarkClass(r.path)}>{vaultInitial(r.name)}</span>{r.name}{r.path === vault?.path && <span className="badge accent">{t('vault_switcher.open')}</span>}{!r.exists && <span className="badge warn">{t('vault_switcher.not_found')}</span>}</div>}</td>
                <td className="mono trunc" style={{ maxWidth: 300, fontSize: 'var(--fs-xs)' }} title={r.path}>{shortPath(r.path)}</td>
                <td style={{ textAlign: 'right' }}>
                  {r.path === vault?.path && !renaming && <button className="btn btn-ghost btn-sm" onClick={() => setRenaming(true)}>{t('common.rename')}</button>}
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ r, kind: 'key' })}>{t('vault_switcher.forget_key')}</button>
                  <button className="btn btn-danger-ghost btn-sm" onClick={() => setConfirm({ r, kind: 'list' })}>{t('common.remove')}</button>
                </td>
              </tr>
            ))}
            {recents.length === 0 && <tr><td colSpan={3} className="faint">{t('vault_switcher.no_vaults_yet')}</td></tr>}
          </tbody>
        </table>
        {confirm && (
          <div className="callout warn" role="alertdialog" aria-label={t('vault_switcher.confirm')}>
            <Icon name="alert" size="sm" className="warn-t" />
            <div className="col grow" style={{ gap: 'var(--sp-2)' }}>
              <span>{confirm.kind === 'key'
                ? <>{tr('vault_switcher.forget_the_saved_key_of', { strong: <strong>{confirm.r.name}</strong> })}</>
                : <>{tr('vault_switcher.remove_strong_from_the_list', { strong: <strong>{confirm.r.name}</strong> })}</>}</span>
              <div className="row"><button className="btn btn-secondary btn-sm" onClick={() => setConfirm(null)} data-autofocus>{t('common.cancel')}</button><button className="btn btn-danger btn-sm" onClick={() => run()}>{confirm.kind === 'key' ? t('vault_switcher.forget_key') : t('common.remove')}</button></div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
