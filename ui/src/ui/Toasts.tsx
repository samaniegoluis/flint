// The toast stack's view (milestone 46, designs 24a, 24b, 24j1): the store's toasts
// in the corner Settings → Appearance → Notifications chose. The newest sits closest
// to the corner. Hover or focus anywhere on the stack pauses every timer; Escape
// closes the toast that holds the focus. Screen readers hear each toast through two
// live regions mounted before the first one, so the first toast is never missed.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ToastCorner } from '../api/types';
import type { ToastItem, ToastStore } from '../lib/toasts';
import { Icon } from './Icon';

const CORNER_ATTR: Record<ToastCorner, string> = {
  'bottom-right': 'br', 'bottom-left': 'bl', 'top-right': 'tr', 'top-left': 'tl',
};

export function Toasts({ store, corner }: { store: ToastStore; corner: ToastCorner }) {
  const list = useSyncExternalStore(store.subscribe, store.list);
  const said = useSyncExternalStore(store.subscribe, store.announcement);
  const hover = useRef(false);
  const focus = useRef(false);
  const top = corner.startsWith('top');

  const sync = () => (hover.current || focus.current ? store.pause() : store.resume());
  // A stack that empties under the pointer gets no mouseleave: the next toasts must
  // not start paused.
  const empty = list.length === 0;
  useEffect(() => {
    if (empty && (hover.current || focus.current)) { hover.current = false; focus.current = false; store.resume(); }
  }, [empty, store]);

  // Top corners grow downward: the newest first, under the tab bar.
  const ordered = top ? [...list].reverse() : list;
  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-toast-live="polite">{said && said.kind !== 'error' ? said.text : ''}</div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" data-toast-live="assertive">{said && said.kind === 'error' ? said.text : ''}</div>
      {list.length > 0 && (
        <div className="toasts" data-corner={CORNER_ATTR[corner]} data-toasts
          onMouseEnter={() => { hover.current = true; sync(); }}
          onMouseLeave={() => { hover.current = false; sync(); }}
          onFocus={() => { focus.current = true; sync(); }}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { focus.current = false; sync(); } }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            const el = (e.target as HTMLElement).closest<HTMLElement>('[data-toast]');
            if (!el) return;
            e.preventDefault();
            e.stopPropagation();
            store.dismiss(Number(el.dataset.toast));
          }}>
          {ordered.map((t) => <ToastView key={t.id} t={t} store={store} />)}
        </div>
      )}
    </>
  );
}

function ToastView({ t, store }: { t: ToastItem; store: ToastStore }) {
  const text = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  // More appears only when the text runs past its two lines.
  useLayoutEffect(() => {
    const el = text.current;
    if (!el || expanded) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [t.text, expanded]);

  const cls = ['toast', expanded ? 'expanded' : '', t.leaving ? 'leaving' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} data-kind={t.kind} data-toast={t.id} data-toast-kind={t.kind}>
      {t.kind === 'error'
        ? <Icon name="alert" className="t-mark" />
        : <span className="t-mark" aria-hidden="true" />}
      <span className="t-body">
        <span className="t-text" ref={text}>{t.text}</span>
        {(clamped || expanded) && (
          <button type="button" className="t-more" aria-expanded={expanded} data-toast-more
            onClick={() => setExpanded((x) => !x)}>{expanded ? 'Less' : 'More'}</button>
        )}
      </span>
      {t.progress !== undefined && (
        <span className="t-prog" aria-label={`${Math.round(t.progress)}% done`}>{Math.round(t.progress)}%</span>
      )}
      {t.actions.map((a, i) => (
        <button key={a.label} type="button" className="btn btn-secondary btn-sm" data-toast-action={i}
          onClick={() => store.act(t.id, i)}>{a.label}</button>
      ))}
      <button type="button" className="t-x" aria-label="Dismiss" data-toast-close
        onClick={() => store.dismiss(t.id)}><Icon name="x" size="sm" /></button>
    </div>
  );
}
