import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  hint?: string;
  run: () => void;
}

// A context menu at a screen position. Arrow keys move, ↵ runs, esc closes.
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState(0);
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('.mi')[hot]?.focus();
  }, [hot]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 230);
  const top = Math.min(y, window.innerHeight - items.length * 34 - 16);
  return (
    <div ref={ref} className="menu" role="menu" style={{ position: 'fixed', left, top, width: 220, zIndex: 60 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); setHot((hot + 1) % items.length); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setHot((hot - 1 + items.length) % items.length); }
      }}>
      {items.map((it, i) => (
        <button key={it.label} role="menuitem" className={'mi' + (it.danger ? ' danger' : '') + (i === hot ? ' hot' : '')} tabIndex={i === hot ? 0 : -1}
          onMouseEnter={() => setHot(i)} onClick={() => { onClose(); it.run(); }}>
          {it.icon && <Icon name={it.icon} size="sm" />}<span className="grow">{it.label}</span>{it.hint && <span className="kbd">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}
