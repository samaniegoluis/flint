import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface PickerOption {
  value: string;
  label: ReactNode;
  text: string; // for filtering
  meta?: ReactNode;
}

// A select field (design: .select + .menu listbox) with a filter and keyboard use.
export function Picker({ value, options, onChange, icon, placeholder, label, search = true, footer }: {
  value: string;
  options: PickerOption[];
  onChange: (v: string) => void;
  icon?: IconName;
  placeholder: string;
  label: string;
  search?: boolean;
  footer?: { label: string; run: () => void };
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hot, setHot] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const shown = options.filter((o) => !q || o.text.toLowerCase().includes(q.toLowerCase()));
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => { setHot(Math.max(0, shown.findIndex((o) => o.value === value))); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ('');
    btn.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHot(Math.min(shown.length - 1, hot + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHot(Math.max(0, hot - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[hot]) pick(shown[hot].value); }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button ref={btn} type="button" className={'select' + (open ? ' open' : '')} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        {icon && <Icon name={icon} size="sm" className="faint" />}
        <span className={'grow trunc' + (current ? '' : ' faint')} style={{ textAlign: 'left' }}>{current ? current.label : placeholder}</span>
        <Icon name="chev" size="sm" className="faint" />
      </button>
      {open && (
        <div className="menu" role="listbox" aria-label={label} style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', maxHeight: 280, overflow: 'auto', zIndex: 70 }} onKeyDown={onKey}>
          {search && (
            <label className="search" style={{ margin: 'var(--sp-1)' }}>
              <Icon name="search" size="sm" />
              <input autoFocus aria-label={'Search ' + label} placeholder="Search" value={q} onChange={(e) => { setQ(e.target.value); setHot(0); }} />
            </label>
          )}
          {shown.map((o, i) => (
            <button key={o.value || '∅'} type="button" role="option" aria-selected={o.value === value} className={'mi' + (i === hot ? ' hot' : '')}
              onMouseEnter={() => setHot(i)} onClick={() => pick(o.value)} autoFocus={!search && i === hot}>
              <span className="grow trunc">{o.label}</span>
              {o.meta && <span className="faint mi-end" style={{ fontSize: 'var(--fs-xs)' }}>{o.meta}</span>}
              {o.value === value && <Icon name="check" size="sm" className="accent-t" />}
            </button>
          ))}
          {shown.length === 0 && <span className="faint" style={{ padding: 'var(--sp-2)', fontSize: 'var(--fs-sm)' }}>No match</span>}
          {footer && (
            <>
              <div className="menu-sep" />
              <button type="button" className="mi accent-t" onClick={() => { setOpen(false); footer.run(); }}><Icon name="plus" size="sm" />{footer.label}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
