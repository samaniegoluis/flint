// This machine's layout state (D-030): sidebar open and width, and the open vault's
// collapsed groups. Loaded when a vault opens; changes are written by the core,
// debounced, and flushed before the page moves to another vault or closes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/backend';
import type { UiStateView } from '../api/types';

// The core clamps to the same bounds (domain/ui_state.cf).
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 400;
export const SIDEBAR_DEFAULT = 264;
const SAVE_DELAY_MS = 250;

export const clampSidebar = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
// The Files view's own width (milestone 17).
export const FILES_MIN = 200;
export const FILES_MAX = 480;
export const FILES_DEFAULT = 340;
export const clampFiles = (w: number) => Math.round(Math.min(FILES_MAX, Math.max(FILES_MIN, w)));

const DEFAULTS: UiStateView = { sidebar_open: true, sidebar_width: SIDEBAR_DEFAULT, files_width: FILES_DEFAULT, collapsed: [] };

export function useUiState(vaultPath: string) {
  const [ui, setUi] = useState<UiStateView | null>(null);
  const pending = useRef<{ vault: string; state: UiStateView } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    // Layout state is a convenience: a failed write is not worth an error toast.
    if (p) api.uiStateSet({ ...p.state, vault: p.vault }).catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    setUi(null);
    api.uiStateGet()
      .then((s) => { if (live) setUi(s); })
      .catch(() => { if (live) setUi(DEFAULTS); });
    return () => { live = false; flush(); };
  }, [vaultPath, flush]);

  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [flush]);

  const update = useCallback((patch: Partial<UiStateView>) => {
    setUi((prev) => {
      const next = { ...(prev ?? DEFAULTS), ...patch };
      pending.current = { vault: vaultPath, state: next };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
      return next;
    });
  }, [vaultPath, flush]);

  return { ui, update };
}
