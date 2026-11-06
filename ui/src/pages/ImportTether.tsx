// Import from Tether (Settings → Vault, D-034): the same use case as
// `flint import tether`. Preview runs it as a dry run; Import writes it. The Tether
// password goes to the core and is cleared from the form once the import is done;
// the report holds names and counts only.

import { useRef, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import type { ImportCounts, ImportNote, TetherImportReport } from '../api/types';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { useTrapFocus } from '../ui/Modal';

function plural(n: number, one: string, many: string) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function addedTotal(c: ImportCounts) {
  return c.groups + c.hosts + c.keys + c.credentials + c.known_hosts;
}

export function countsText(c: ImportCounts) {
  return [
    plural(c.groups, 'group', 'groups'), plural(c.hosts, 'host', 'hosts'), plural(c.keys, 'key', 'keys'),
    plural(c.credentials, 'credential', 'credentials'), plural(c.known_hosts, 'known host', 'known hosts'),
  ].join(', ');
}

function Notes({ title, notes }: { title: string; notes: ImportNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="field">
      <span className="flabel">{title} ({notes.length})</span>
      <table className="table note-table" aria-label={title}>
        <colgroup><col className="note-kind" /><col className="note-name" /><col /></colgroup>
        <tbody>
          {notes.map((n, i) => (
            <tr key={i}>
              <td className="note-kind">{n.kind}</td>
              <td className="mono primary">{n.name}</td>
              <td>{n.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportTetherDrawer({ onClose }: { onClose: () => void }) {
  const { vault, refreshCatalog, notify, os } = useApp();
  const [file, setFile] = useState('');
  const [password, setPassword] = useState('');
  const [report, setReport] = useState<TetherImportReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // A path's end (the file name) matters more than its start: keep it in view.
  const showPathEnd = () => requestAnimationFrame(() => { const el = fileRef.current; if (el) el.scrollLeft = el.scrollWidth; });
  useTrapFocus(ref, onClose);

  const pick = async () => {
    const { path } = await api.dialogOpen('Choose a Tether vault');
    if (path) { setFile(path); setReport(null); showPathEnd(); }
  };

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.importTether(file.trim(), password, dryRun);
      setReport(r);
      if (!dryRun) {
        setPassword('');
        await refreshCatalog();
        notify(addedTotal(r.added) === 0
          ? `Nothing new to import: everything is already in ${vault?.name ?? 'this vault'}`
          : `Imported ${plural(r.added.hosts, 'host', 'hosts')} from Tether`);
      }
    } catch (err) {
      setError(toFlintError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const done = report && !report.dry_run;
  const ready = !!file.trim() && !!password && !busy;
  return (
    <aside ref={ref} className="drawer drawer-wide" role="dialog" aria-label="Import from Tether">
      <form style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
        onSubmit={(e) => { e.preventDefault(); if (ready && !done) run(!report); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (os === 'mac' ? e.metaKey : e.ctrlKey) && ready && !done) run(false); }}>
        <div className="modal-h"><h2 className="grow">Import from Tether</h2><button type="button" className="icon-btn" aria-label="Close (esc)" onClick={onClose}><Icon name="x" size="sm" /></button></div>
        <div className="modal-b scroll" style={{ flex: 1 }}>
          <span className="hint">
            Copies the groups, hosts, keys, credentials and trusted host keys of a Tether vault into {vault ? <strong>{vault.name}</strong> : 'this vault'}.
            The Tether file is only read. Importing again adds only what is missing.
          </span>
          <div className="field"><span className="flabel">Tether vault</span>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <div className="input grow"><Icon name="file" size="sm" className="faint" /><input ref={fileRef} className="mono" aria-label="Tether vault file" value={file} onBlur={showPathEnd} disabled={!!done}
                onChange={(e) => { setFile(e.target.value); setReport(null); }} placeholder="vault.tether" style={{ fontSize: 'var(--fs-sm)' }} data-autofocus /></div>
              <button type="button" className="btn btn-secondary" style={{ height: 'var(--control-h)' }} disabled={!!done} onClick={() => pick().catch(() => {})}>Choose…</button>
            </div>
            <span className="hint">Tether shows its path under Settings → Vault.</span></div>
          {!done && (
            <div className="field"><label className="flabel" htmlFor="tpw">Tether master password</label>
              <div className="input"><input id="tpw" type="password" className="pw" value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)} /></div></div>
          )}
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
          {report && (
            <div className="col" role="status" aria-label="Import report" style={{ gap: 'var(--sp-3)' }}>
              {addedTotal(report.added) === 0 ? (
                <div className="panel col" style={{ padding: 'var(--sp-3)', gap: 4 }}>
                  <span className="strong">{report.dry_run ? 'Preview: nothing new to import' : 'Nothing new to import'}</span>
                  <span style={{ fontSize: 'var(--fs-sm)' }}>Everything was already in {vault?.name ?? 'this vault'}: {countsText(report.already_present)}.</span>
                </div>
              ) : (
                <div className="panel col" style={{ padding: 'var(--sp-3)', gap: 4 }}>
                  <span className="strong">{report.dry_run ? 'Preview: nothing was written yet' : 'Imported'}</span>
                  <span style={{ fontSize: 'var(--fs-sm)' }}>{report.dry_run ? 'Would add' : 'Added'} {countsText(report.added)}.</span>
                  <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Already in the vault: {countsText(report.already_present)}.</span>
                </div>
              )}
              <Notes title="Changed on the way" notes={report.changed} />
              <Notes title="Not imported" notes={report.not_imported} />
            </div>
          )}
        </div>
        <div className="modal-f"><span className="grow" />
          {done ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel<Key>esc</Key></button>
              <button type="button" className="btn btn-secondary" disabled={!ready} onClick={() => run(true)}>{busy ? 'Reading…' : 'Preview'}</button>
              <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => run(false)}>{busy ? 'Importing…' : 'Import'}<span className="kbd-in">{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</span></button>
            </>
          )}
        </div>
      </form>
    </aside>
  );
}
