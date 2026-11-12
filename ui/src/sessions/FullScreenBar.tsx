// The connection bar of a full-screen RDP tab (milestone 37, designs 22b1–22b3). It
// drops from the top edge when the pointer reaches it and goes again once the pointer
// leaves, unless pinned. On macOS the top edge also reveals the system's menu bar and
// the window's title bar, so the bar drops below them (`top`). The first time, a note
// says how to leave; while the connection is lost the bar stays open (22b3).

import { useEffect, useRef, useState } from 'react';
import { HostTypeIcon, Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import type { Pane } from './store';

/** How long the bar stays after the pointer leaves it. */
const HIDE_AFTER_MS = 700;
/** How long the first-time note stays. */
export const NOTE_MS = 6000;

export function FullScreenBar({ pane, top, noteSeen, onNoteSeen, onExit, onDisconnect }: {
  pane: Pane;
  /** macOS: what the revealed menu bar and title bar cover, in px. */
  top: number;
  noteSeen: boolean;
  onNoteSeen: () => void;
  onExit: () => void;
  onDisconnect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [note, setNote] = useState(!noteSeen);
  const timer = useRef<number | undefined>(undefined);
  const lost = pane.status === 'ended';

  useEffect(() => {
    if (!note) return;
    // Seen once shown, even when full screen ends before the note goes.
    onNoteSeen();
    const t = window.setTimeout(() => setNote(false), NOTE_MS);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = () => { window.clearTimeout(timer.current); setHover(true); };
  const hide = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHover(false), HIDE_AFTER_MS); };

  const open = hover || pinned || lost;
  const kept = pinned || lost;
  const d = pane.desktop;
  const at = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const meta = lost
    ? `disconnected ${pane.endedAt ? at(pane.endedAt) : ''}`.trim()
    : d ? `${d.width} × ${d.height}${d.rttMs >= 0 ? ` · ${d.rttMs} ms` : ''}` : 'connecting';

  return (
    <>
      <div className="fs-edge" data-fs-edge onMouseEnter={show} onMouseLeave={hide} />
      {open ? (
        <div className="fs-bar" role="toolbar" aria-label="Connection bar" data-fs-bar
          style={{ top: hover && !kept ? top : 0 }} onMouseEnter={show} onMouseLeave={hide}>
          <button className={'icon-btn' + (kept ? ' on' : '')} aria-pressed={kept} disabled={lost}
            aria-label={kept ? 'Bar kept open' : 'Keep the bar shown'} title={kept ? 'Bar kept open' : 'Keep the bar shown'}
            data-fs-pin onClick={() => setPinned((p) => !p)}>
            <Icon name="pin" size="sm" />
          </button>
          <HostTypeIcon type="rdp" size="md" />
          <span className="mono strong">{pane.alias}</span>
          <span className="faint mono" style={{ fontSize: 'var(--fs-xs)' }}>{meta}</span>
          <span className="sep" />
          <button className="btn btn-ghost btn-sm" data-fs-exit onClick={onExit}>
            <Icon name="shrink" size="sm" />Exit full screen<Kbd action="fullscreen" />
          </button>
          {!lost && (
            <button className="btn btn-ghost btn-sm" data-fs-disconnect onClick={onDisconnect}>
              <Icon name="plug" size="sm" />Disconnect
            </button>
          )}
        </div>
      ) : (
        <span className="fs-tab" aria-label="Connection bar, hidden" data-fs-tab onMouseEnter={show} />
      )}
      {note && !open && (
        <div className="fs-note" role="status" data-fs-note>
          <Icon name="info" size="sm" />
          <span>Point at the top edge, or press <Kbd action="fullscreen" /> to leave.</span>
        </div>
      )}
    </>
  );
}
