import { useApp } from '../state/app';
import { chordLabel, type Action } from '../lib/keymap';

// A key chip for an app action, in this platform's notation.
export function Kbd({ action, inline }: { action: Action; inline?: boolean }) {
  const { os } = useApp();
  return <span className={inline ? 'kbd-in' : 'kbd'}>{chordLabel(action, os)}</span>;
}

export function Key({ children }: { children: string }) {
  return <span className="kbd">{children}</span>;
}
