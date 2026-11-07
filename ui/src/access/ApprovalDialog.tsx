// The caller approval window (milestone 12, Principle 12): a `flint` command asks to
// use the vault and the owner allows it, scoped and for a while, or denies it. The
// core waits for the answer (two minutes at most) and the CLI says it is waiting.
// Allow asks for presence first: Touch ID or the Mac's password, polkit, or the
// master password where the OS has neither.
//
// `flint token create` (milestone 12b) shows the token instead: its name, what it
// allows, where and for how long, as the command asked. The owner allows or denies
// that one request; it never becomes a grant.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, on, toFlintError } from '../api/backend';
import type { AccessAction, AccessState, Approval, Catalog, GrantDuration, PresenceMethod } from '../api/types';
import { Modal } from '../ui/Modal';
import { Key } from '../ui/Kbd';
import { Icon } from '../ui/Icon';

type ScopeKind = 'host' | 'group' | 'all';

const DURATIONS: { value: GrantDuration; label: string }[] = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'lock', label: 'Until locked' },
];

const TTL_LABELS: Record<string, string> = {
  '15m': '15 minutes', '1h': '1 hour', '4h': '4 hours', '1d': '1 day', '7d': '7 days', '30d': '30 days', '90d': '90 days',
};

const ACTIONS: { value: AccessAction; label: string; hint: string }[] = [
  { value: 'read', label: 'Read', hint: 'List and show hosts, groups, keys and credentials. Never a secret.' },
  { value: 'exec', label: 'Run commands', hint: 'exec, connect and host test on the hosts in scope.' },
  { value: 'write', label: 'Change the vault', hint: 'Add, edit and remove anything. Needs the whole vault.' },
];

export function presenceLabel(m: PresenceMethod): string {
  if (m === 'touchid') return 'Touch ID';
  if (m === 'device') return 'your Mac password';
  if (m === 'polkit') return 'your login password';
  return 'the master password';
}

/** The core's times (deadlines, expiries) are on its own clock: this offset turns
 * them into Date.now() time. Taken when a state arrives. */
export function clockSkew(s: AccessState): number {
  return Date.now() - s.now_ms;
}

/** Keeps the access state in step with the core's events. */
export function useAccessState(active: boolean) {
  const [state, setStateRaw] = useState<AccessState | null>(null);
  const [skew, setSkew] = useState(0);
  const setState = useCallback((s: AccessState) => { setSkew(clockSkew(s)); setStateRaw(s); }, []);
  const refresh = useCallback(() => { api.accessState().then(setState).catch(() => {}); }, [setState]);
  useEffect(() => {
    if (!active) { setStateRaw(null); return; }
    refresh();
    const offs = [on('access:request', refresh), on('access:resolved', refresh), on('access:changed', refresh)];
    // Expired grants leave the list without an event.
    const t = window.setInterval(refresh, 15000);
    return () => { offs.forEach((off) => off()); window.clearInterval(t); };
  }, [active, refresh]);
  return { state, setState, refresh, skew };
}

function groupOf(catalog: Catalog, host: string): string {
  return catalog.hosts.find((h) => h.alias.toLowerCase() === host.toLowerCase())?.group ?? '';
}

function hostKnown(catalog: Catalog, host: string): boolean {
  return !!host && catalog.hosts.some((h) => h.alias.toLowerCase() === host.toLowerCase());
}

export function ApprovalDialog({ ap, presence, catalog, skew, onDone }: {
  ap: Approval;
  presence: PresenceMethod;
  catalog: Catalog;
  /** Date.now() minus the core's clock, which is not the wall clock. */
  skew: number;
  onDone: (s: AccessState | null) => void;
}) {
  const host = ap.need.host;
  const group = groupOf(catalog, host);
  const initialScope: ScopeKind = ap.need.action === 'write' || !hostKnown(catalog, host) ? 'all' : 'host';
  const [scope, setScope] = useState<ScopeKind>(initialScope);
  const [actions, setActions] = useState<Record<AccessAction, boolean>>({
    read: true, exec: ap.need.action === 'exec', write: ap.need.action === 'write',
  });
  const [duration, setDuration] = useState<GrantDuration>('1h');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const left = Math.max(0, Math.round((ap.deadline_ms + skew - now) / 1000));
  const chain = useMemo(() => ap.chain.map((p) => (p.argv0.split('/').pop() || p.exe.split('/').pop() || '?').replace(/^-/, '')).reverse(), [ap.chain]);

  const answer = async (allow: boolean) => {
    setBusy(true);
    setError('');
    try {
      const s = await api.accessAnswer({
        id: ap.id, allow, duration, password: allow ? password : '',
        scope: scope === 'all' ? { all: true, groups: [], hosts: [] }
          : scope === 'group' ? { all: false, groups: [group], hosts: [] }
          : { all: false, groups: [], hosts: [host] },
        read: actions.read, exec: actions.exec, write: actions.write && scope === 'all',
      });
      setPassword('');
      onDone(s);
    } catch (err) {
      const e = toFlintError(err);
      if (e.code === 'not_found') { onDone(null); return; }
      setError(e.message);
      setBusy(false);
    }
  };
  const token = ap.token?.name ? ap.token : null;
  const covers = token !== null || ((actions[ap.need.action as AccessAction]) && (ap.need.action !== 'write' || scope === 'all'));

  return (
    <Modal label="Allow access to the vault" onClose={() => { if (!busy) answer(false); }} width={520} top={96} className="approval" scrimCloses={false}>
      <form data-approval={ap.id} data-kind={token ? 'token' : 'grant'} onSubmit={(e) => { e.preventDefault(); answer(true); }}>
        <div className="modal-h">
          <span className="prompt-ic"><Icon name="lock" /></span>
          <div className="col grow" style={{ gap: 2 }}>
            <h2>{token ? `${ap.label} wants to create a token` : `${ap.label} wants to use this vault`}</h2>
            <span className="muted" style={{ fontSize: 'var(--fs-xs)' }} title={ap.chain.map((p) => `${p.pid} ${p.exe}`).join('\n')}>
              {chain.join(' → ')} · pid {ap.chain[0]?.pid ?? '?'}
            </span>
          </div>
        </div>
        <div className="modal-b">
          <div className="panel mono" data-approval-request style={{ padding: 'var(--sp-2) var(--sp-3)', fontSize: 'var(--fs-sm)', wordBreak: 'break-all' }}>{ap.request}</div>
          {token ? (
            <>
              <dl className="kv" data-token-ask>
                <dt>Name</dt><dd data-token-name>{token.name}</dd>
                <dt>Allows</dt><dd>{token.allows.split(',').map((a) => ACTIONS.find((x) => x.value === a)?.label ?? a).join(', ')}</dd>
                <dt>Reaches</dt><dd>{token.reaches}</dd>
                <dt>Expires</dt><dd>in {TTL_LABELS[token.ttl] ?? token.ttl}</dd>
              </dl>
              <span className="hint row" style={{ gap: 6 }}><Icon name="alert" size="xs" />Whoever holds the token can do this without asking, until it expires or you revoke it in Settings → Access.</span>
            </>
          ) : (
            <>
              <div className="field">
                <span className="label">Hosts</span>
                <div className="seg full" role="group" aria-label="Hosts">
                  {hostKnown(catalog, host) && <button type="button" aria-pressed={scope === 'host'} onClick={() => setScope('host')}>{host}</button>}
                  {group && <button type="button" aria-pressed={scope === 'group'} onClick={() => setScope('group')}>Group {group}</button>}
                  <button type="button" data-scope-all aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Whole vault</button>
                </div>
              </div>
              <div className="field">
                <span className="label">Actions</span>
                {ACTIONS.map((a) => (
                  <label key={a.value} className="check fit">
                    <input type="checkbox" data-action={a.value} checked={actions[a.value]} disabled={a.value === 'write' && scope !== 'all'}
                      onChange={(e) => setActions({ ...actions, [a.value]: e.target.checked })} />
                    <span className="col" style={{ gap: 2 }}><span>{a.label}</span><span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{a.hint}</span></span>
                  </label>
                ))}
              </div>
              <div className="field">
                <span className="label">For</span>
                <div className="seg full" role="group" aria-label="Duration">
                  {DURATIONS.map((d) => <button type="button" key={d.value} data-duration={d.value} aria-pressed={duration === d.value} onClick={() => setDuration(d.value)}>{d.label}</button>)}
                </div>
              </div>
            </>
          )}
          {presence === 'password' && (
            <label className="field">
              <span className="label">Master password</span>
              <div className="input"><input id="approval-pw" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} data-autofocus /></div>
            </label>
          )}
          {!covers && <span className="hint row" style={{ gap: 6 }}><Icon name="alert" size="xs" />This choice does not cover the request; it will still be refused.</span>}
          {error && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          <span className="muted grow" style={{ fontSize: 'var(--fs-xs)' }} data-approval-countdown>Denied automatically in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
          <button type="button" className="btn btn-ghost" data-approval-deny disabled={busy} onClick={() => answer(false)}>Deny<Key>esc</Key></button>
          <button type="submit" className="btn btn-primary" data-approval-allow disabled={busy || (presence === 'password' && !password)}>
            {busy && presence !== 'password' ? `Confirm with ${presenceLabel(presence)}…` : 'Allow'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
