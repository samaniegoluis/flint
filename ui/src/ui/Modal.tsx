import { useEffect, useRef, type ReactNode } from 'react';

// A modal over a scrim. Esc and a click on the scrim close it; focus moves into it
// and stays inside while it is open.
export function Modal({ label, onClose, children, width = 560, top = 72, className = '' }: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  top?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useTrapFocus(ref, onClose);
  return (
    <>
      <div className="scrim" onMouseDown={onClose} />
      <div
        ref={ref}
        className={'modal ' + className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ left: '50%', marginLeft: -width / 2, top, width, maxHeight: `calc(100% - ${top + 24}px)` }}
      >
        {children}
      </div>
    </>
  );
}

// Moves focus into `ref` on mount, keeps Tab inside it, and calls onClose on Esc.
export function useTrapFocus(ref: React.RefObject<HTMLElement>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('input, textarea, button, [tabindex="0"]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>('input:not([disabled]), textarea, select, button:not([disabled]), [tabindex="0"]')]
        .filter((n) => n.offsetParent !== null);
      if (items.length === 0) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [ref]);
}
