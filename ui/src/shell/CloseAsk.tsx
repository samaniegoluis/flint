// ✕ on a desktop with no tray (milestone 65, D-138 (3)): the first time, the core
// shows the window again and asks here. The answer is kept in Settings → Access, and
// `window_close` then closes as answered. Esc leaves the window open and asks again
// at the next ✕.

import { useEffect, useState } from 'react';
import { api, on, toFlintError } from '../api/backend';
import { useApp } from '../state/app';
import { Modal } from '../ui/Modal';
import type { Settings } from '../api/types';

export function CloseAsk() {
  const { settings, saveSettings, fail } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => on('window:close_ask', () => setOpen(true)), []);
  if (!open) return null;
  const answer = async (close_action: Settings['close_action']) => {
    setOpen(false);
    try {
      await saveSettings({ ...settings, close_action });
      await api.windowClose();
    } catch (e) { fail(toFlintError(e)); }
  };
  return (
    <Modal label="Keep Flint running in the background?" onClose={() => setOpen(false)} width={440} top={200} scrimCloses={false}>
      <div className="modal-h"><h2 className="grow">Keep Flint running in the background?</h2></div>
      <div className="modal-b" data-close-ask style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>
        <span>It serves the <span className="mono">flint</span> command and your grants. This desktop has no tray icon to bring the window back: open Flint again to show it.</span>
        <span className="hint">You can change this in Settings → Access.</span>
      </div>
      <div className="modal-f">
        <span className="grow" />
        <button className="btn btn-secondary" data-close-ask-quit onClick={() => answer('quit')}>Quit</button>
        <button className="btn btn-primary" data-autofocus data-close-ask-keep onClick={() => answer('background')}>Keep running</button>
      </div>
    </Modal>
  );
}
