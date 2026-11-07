// Settings → Access (milestone 12): the grants the owner gave `flint` callers, live
// until they expire, the vault locks or the app quits; each can be ended now.

import { useEffect, useState } from 'react';
import { api, toFlintError } from '../api/backend';
import type { GrantView } from '../api/types';
import { useApp } from '../state/app';
import { presenceLabel, useAccessState } from './ApprovalDialog';

function scopeText(g: GrantView): string {
  if (g.all) return 'Whole vault';
  return [...g.groups.map((p) => `group ${p}`), ...g.hosts].join(', ') || 'Nothing (deleted)';
}

function actionsText(g: GrantView): string {
  return [g.read && 'read', g.exec && 'run commands', g.write && 'change the vault'].filter(Boolean).join(' · ');
}

function expiresText(g: GrantView, now: number): string {
  if (g.expires_ms === 0) return 'until the vault locks';
  const min = Math.max(0, Math.round((g.expires_ms - now) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min left` : `${min} min left`;
}

export function AccessSettings() {
  const { fail } = useApp();
  const { state, setState } = useAccessState(true);
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
              <span className="muted trunc" style={{ fontSize: 'var(--fs-xs)' }}>{scopeText(g)} · {actionsText(g)} · {expiresText(g, now)} · pid {g.anchor_pid}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => revoke(g.id)}>Revoke</button>
          </div>
        ))}
      </div>
    </>
  );
}
