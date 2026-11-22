// Wires the live notices of grants (lib/grantNotices.ts) to the core's events and the
// app's toast stack, and shows View (26b1) for the notice that asked.

import { useEffect, useMemo, useState } from 'react';
import { on, api } from '../api/backend';
import type { ActivityAddedEvent, ActivityFinishedEvent } from '../api/types';
import { GrantNotices } from '../lib/grantNotices';
import { toasts, useApp } from '../state/app';
import { useAccessState } from './ApprovalDialog';
import { GrantActivityModal } from './GrantActivityModal';

export function GrantNoticesHost({ onLog }: { onLog: () => void }) {
  const { fail, vault } = useApp();
  const [viewing, setViewing] = useState<{ grant: string; program: string } | null>(null);
  const { state, skew } = useAccessState(!!vault);
  const programs = useMemo(() => new Map<string, string>(), []);
  const notices = useMemo(() => new GrantNotices(toasts, {
    view: (grant) => setViewing({ grant, program: programs.get(grant) ?? 'A program' }),
    stop: (grant) => { api.accessRevoke(grant).catch((e) => fail(e)); },
  }), [fail, programs]);

  useEffect(() => {
    const offs = [
      on<ActivityAddedEvent>('activity:added', (e) => {
        if (e.grant && e.program) programs.set(e.grant, e.program);
        notices.added(e);
      }),
      on<ActivityFinishedEvent>('activity:finished', (e) => notices.finished(e)),
      on('vault:locked', () => { notices.clear(); setViewing(null); }),
    ];
    return () => offs.forEach((off) => off());
  }, [notices, programs]);

  // A grant revoked, expired or ended by a lock takes its notice with it.
  useEffect(() => {
    if (state) notices.grants(state.grants.map((g) => g.id));
  }, [state, notices]);

  if (!viewing) return null;
  const view = state?.grants.find((g) => g.id === viewing.grant) ?? null;
  return (
    <GrantActivityModal grant={viewing.grant} program={viewing.program} view={view} skew={skew}
      onStop={() => { notices.stopNow(viewing.grant); setViewing(null); }}
      onLog={() => { setViewing(null); onLog(); }}
      onClose={() => setViewing(null)} />
  );
}
