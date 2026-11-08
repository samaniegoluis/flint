// Settings → Access (milestone 12): the grants the owner gave `flint` callers, live
// until they expire, the vault locks or the app quits; each can be ended now.
// Milestone 12b adds the vault's tokens (revoke only: `flint token create` makes
// them, approved in the window) and the activity log: what callers were allowed to
// run or refused, newest first. Reads are not logged.

import { useCallback, useEffect, useState } from 'react';
import { api, on, toFlintError } from '../api/backend';
import type { ActivityEntry, GrantView, TokenView } from '../api/types';
import type { Confirm } from '../pages/KeysPage';
import { useApp } from '../state/app';
import { presenceLabel, useAccessState } from './ApprovalDialog';

function scopeText(g: GrantView): string {
  if (g.all) return 'Whole vault';
  return [...g.groups.map((p) => `group ${p}`), ...g.hosts].join(', ') || 'Nothing (deleted)';
}

function actionsText(g: GrantView): string {
  return [g.read && 'read', g.exec && 'run commands', g.write && 'change the vault'].filter(Boolean).join(' · ');
}

function expiresText(g: GrantView, now: number, skew: number): string {
  if (g.expires_ms === 0) return 'until the vault locks';
  const min = Math.max(0, Math.round((g.expires_ms + skew - now) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min left` : `${min} min left`;
}

function tokenActions(t: TokenView): string {
  return [t.read && 'read', t.exec && 'run commands', t.write && 'change the vault'].filter(Boolean).join(' · ');
}

function tokenScope(t: TokenView): string {
  if (t.all) return 'Whole vault';
  return [...t.groups.map((p) => `group ${p}`), ...t.hosts].join(', ') || 'Nothing (deleted)';
}

/** "12 Nov, 14:05" in the viewer's time zone, from Unix seconds. */
export function whenText(secs: number): string {
  const d = new Date(secs * 1000);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function tokenUntil(t: TokenView): string {
  if (t.status === 'revoked') return `revoked ${whenText(t.revoked_at)}`;
  if (t.status === 'expired') return `expired ${whenText(t.expires_at)}`;
  return `until ${whenText(t.expires_at)}`;
}

const OUTCOME: Record<ActivityEntry['outcome'], string> = { allowed: 'Allowed', denied: 'Denied', timeout: 'No answer' };
const VIA: Record<ActivityEntry['via'], string> = { grant: 'grant', token: 'token', window: 'asked' };
const PAGE = 200;

function TokensSection({ onConfirm }: { onConfirm: (c: Confirm) => void }) {
  const { notify } = useApp();
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [showEnded, setShowEnded] = useState(false);
  const refresh = useCallback(() => { api.tokensList().then((s) => setTokens(s.tokens)).catch(() => {}); }, []);
  useEffect(() => {
    refresh();
    const off = on('access:changed', refresh);
    return () => off();
  }, [refresh]);
  const revoke = (t: TokenView) => onConfirm({
    title: `Revoke the token ${t.name}?`,
    body: 'A program that uses it is refused from now on. This cannot be undone; create a new token instead.',
    action: 'Revoke token',
    run: async () => { const s = await api.tokenRevoke(t.id); setTokens(s.tokens); notify(`Revoked ${t.name}`); },
  });
  const live = tokens.filter((t) => t.status === 'active');
  const ended = tokens.filter((t) => t.status !== 'active');
  const shown = showEnded ? [...live, ...ended] : live;
  return (
    <section data-tokens style={{ paddingTop: 'var(--sp-6)' }}>
      <div className="row" style={{ alignItems: 'center', paddingBottom: 'var(--sp-2)' }}>
        <span className="label grow">Tokens · {live.length}</span>
        {ended.length > 0 && (
          <button className="btn btn-ghost btn-sm" data-tokens-ended onClick={() => setShowEnded(!showEnded)}>
            {showEnded ? 'Hide ended' : `Show ended (${ended.length})`}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 'var(--fs-xs)', paddingBottom: 'var(--sp-2)' }}>
        For programs Flint cannot ask: cron, launchd, a CI runner. Create one with <span className="mono">flint token create</span>;
        the program passes it in <span className="mono">FLINT_TOKEN</span>. Kept in the vault, as a hash.
      </p>
      {shown.length === 0 && <div className="panel muted" data-no-tokens style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>No tokens.</div>}
      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        {shown.map((t) => (
          <div key={t.id} className="panel row" data-token={t.name} data-token-status={t.status} style={{ padding: 'var(--sp-3) var(--sp-4)', gap: 'var(--sp-3)', alignItems: 'center', opacity: t.status === 'active' ? 1 : 0.6 }}>
            <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
              <span className="strong trunc">{t.name} <span className="muted mono" style={{ fontSize: 'var(--fs-xs)' }}>{t.id}</span></span>
              <span className="muted trunc" style={{ fontSize: 'var(--fs-xs)' }}>{tokenScope(t)} · {tokenActions(t)} · {tokenUntil(t)}</span>
            </div>
            {t.status === 'active' && <button className="btn btn-secondary btn-sm" data-token-revoke onClick={() => revoke(t)}>Revoke</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivitySection() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [more, setMore] = useState(false);
  const refresh = useCallback(() => {
    api.activityLog(0, PAGE).then((p) => { setEntries(p.entries); setMore(p.entries.length === PAGE); }).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const off = on('activity:added', refresh);
    return () => off();
  }, [refresh]);
  const loadMore = () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    api.activityLog(last.id, PAGE).then((p) => { setEntries([...entries, ...p.entries]); setMore(p.entries.length === PAGE); }).catch(() => {});
  };
  return (
    <section data-activity style={{ paddingTop: 'var(--sp-6)' }}>
      <span className="label" style={{ display: 'block', paddingBottom: 'var(--sp-2)' }}>Activity</span>
      <p className="muted" style={{ fontSize: 'var(--fs-xs)', paddingBottom: 'var(--sp-2)' }}>
        What programs ran or changed through Flint, and what was refused. Allowed reads are not recorded. Kept in the vault, the newest 10,000.
      </p>
      {entries.length === 0 && <div className="panel muted" data-no-activity style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>Nothing yet.</div>}
      {entries.length > 0 && (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table activity-table">
            <thead><tr><th>When</th><th>Caller</th><th>Command</th><th>Result</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} data-activity-entry={e.outcome} data-activity-via={e.via}>
                  <td className="muted nowrap">{whenText(e.at)}</td>
                  <td>{e.caller} <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>· {VIA[e.via]}</span></td>
                  <td className="mono" style={{ wordBreak: 'break-all' }}>{e.action === 'sudo' && <span className="activity-badge" data-activity-sudo>root</span>}{e.command}</td>
                  <td className={e.outcome === 'allowed' ? 'nowrap' : 'nowrap err'}>{OUTCOME[e.outcome]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && <div style={{ paddingTop: 'var(--sp-2)' }}><button className="btn btn-ghost btn-sm" data-activity-more onClick={loadMore}>Load more</button></div>}
    </section>
  );
}

export function AccessSettings({ onConfirm }: { onConfirm: (c: Confirm) => void }) {
  const { fail } = useApp();
  const { state, setState, skew } = useAccessState(true);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t); }, []);
  const revoke = (id: string) => api.accessRevoke(id).then(setState).catch((e) => fail(toFlintError(e)));
  const grants = state?.grants ?? [];
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', paddingBottom: 'var(--sp-3)' }}>Access</h1>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', paddingBottom: 'var(--sp-4)' }}>
        Programs that run <span className="mono">flint</span> while this window holds the vault ask here first. A grant covers the
        program that started <span className="mono">flint</span> (Claude Code, a terminal), ends when it expires or the vault
        locks, and is confirmed with {presenceLabel(state?.presence ?? 'password')}.
      </p>
      <div className="row" style={{ alignItems: 'center', paddingBottom: 'var(--sp-2)' }}>
        <span className="label grow">Active grants · {grants.length}</span>
        {grants.length > 1 && <button className="btn btn-secondary btn-sm" onClick={() => revoke('')}>Revoke all</button>}
      </div>
      {grants.length === 0 && <div className="panel muted" data-no-grants style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>No program may use this vault right now.</div>}
      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        {grants.map((g) => (
          <div key={g.id} className="panel row" data-grant={g.id} style={{ padding: 'var(--sp-3) var(--sp-4)', gap: 'var(--sp-3)', alignItems: 'center' }}>
            <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
              <span className="strong trunc">{g.label}</span>
              <span className="muted trunc" style={{ fontSize: 'var(--fs-xs)' }}>{scopeText(g)} · {actionsText(g)} · {expiresText(g, now, skew)} · pid {g.anchor_pid}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => revoke(g.id)}>Revoke</button>
          </div>
        ))}
      </div>
      <TokensSection onConfirm={onConfirm} />
      <ActivitySection />
    </>
  );
}
