// The connection bar of a full-screen RDP tab (milestone 37, designs 22b1–22b3). It
// drops from the top edge when the pointer reaches it and goes again once the pointer
// leaves, unless pinned. On macOS the top edge also reveals the system's menu bar and
// the window's title bar, so the bar drops below them (`top`). The first time, a note
// says how to leave; while the connection is lost the bar stays open (22b3).

import { useEffect, useRef, useState } from 'react';
import { HostTypeIcon, Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import type { Pane } from './store';
import { useMonitors } from './monitors';
import { MonitorsButton } from './MonitorsUi';

/** How long the bar stays after the pointer leaves it. */
const HIDE_AFTER_MS = 700;
/** How long the first-time note stays. */
export const NOTE_MS = 6000;

export function FullScreenBar({ pane, top, noteSeen, onNoteSeen, monitorsNoteSeen, onMonitorsNoteSeen, onSpan, onExit, onDisconnect }: {
  pane: Pane;
  /** Milestone 38: 22f4's note was shown once; spanning the monitors chosen in the popover. */
  monitorsNoteSeen: boolean;
  onMonitorsNoteSeen: () => void;
  onSpan: (picks: string[]) => void;
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
  // Milestone 38: across monitors, the bar says so (22f2a, 22f2b) and stays while the
  // popover is open; the first time, a note says where the bar is (22f4).
  const mon = useMonitors();
  const spanning = mon.phase !== 'off' && mon.pane === pane.id;
  const busy = spanning && (mon.phase === 'opening' || mon.phase === 'arranging');
  const [popover, setPopover] = useState(false);
  const [monNote, setMonNote] = useState(false);
  useEffect(() => {
    if (!spanning || mon.phase !== 'on' || monitorsNoteSeen || monNote) return;
    setMonNote(true);
    onMonitorsNoteSeen();
    const t = window.setTimeout(() => setMonNote(false), NOTE_MS);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanning, mon.phase]);
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

  const open = hover || pinned || lost || popover || busy;
  const kept = pinned || lost || popover || busy;
  const pinOn = pinned || lost;
  const d = pane.desktop;
  const at = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const meta = lost
    ? `disconnected ${pane.endedAt ? at(pane.endedAt) : ''}`.trim()
    : d ? `${spanning && mon.span ? `${mon.span.monitors.length} monitors · ${mon.span.width} × ${mon.span.height}` : `${d.width} × ${d.height}`}${d.rttMs >= 0 ? ` · ${d.rttMs} ms` : ''}` : 'connecting';

  return (
    <>
      <div className="fs-edge" data-fs-edge onMouseEnter={show} onMouseLeave={hide} />
      {open ? (
        <div className="fs-bar" role="toolbar" aria-label="Connection bar" data-fs-bar
          style={{ top: hover && !kept ? top : 0 }} onMouseEnter={show} onMouseLeave={hide}>
          <button className={'icon-btn' + (pinOn ? ' on' : '')} aria-pressed={pinOn} disabled={lost}
            aria-label={pinOn ? 'Bar kept open' : 'Keep the bar shown'} title={pinOn ? 'Bar kept open' : 'Keep the bar shown'}
            data-fs-pin onClick={() => setPinned((p) => !p)}>
            <Icon name="pin" size="sm" />
          </button>
          <HostTypeIcon type="rdp" size="md" />
          <span className="mono strong">{pane.alias}</span>
          {busy
            ? <span className="row faint" style={{ gap: 6, fontSize: 'var(--fs-xs)' }} data-fs-rearranging><span className="mini-spin" />Rearranging the desktop…</span>
            : <span className="faint mono" style={{ fontSize: 'var(--fs-xs)' }}>{meta}</span>}
          <span className="sep" />
          {!lost && <MonitorsButton onOpenChange={setPopover} onSpan={onSpan} />}
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
      {monNote && !open && mon.span && (
        <div className="fs-note" role="status" data-fs-monitors-note>
          <Icon name="monitors" size="sm" />
          <span>The desktop spans {mon.span.monitors.length} monitors. Move the pointer to the top of the main screen for the bar.</span>
        </div>
      )}
      {note && !monNote && !open && (
        <div className="fs-note" role="status" data-fs-note>
          <Icon name="info" size="sm" />
          <span>Point at the top edge, or press <Kbd action="fullscreen" /> to leave.</span>
        </div>
      )}
    </>
  );
}
