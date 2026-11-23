// The text field's own right-click menu (milestone 64). A release build has no engine
// menu at all (cfire turns it off whole), so Flint draws Cut, Copy, Paste and Select
// all in a text field, and nothing anywhere else.
import type { Os } from './keymap';

export type FieldAction = 'cut' | 'copy' | 'paste' | 'selectAll';

export interface FieldState {
  password: boolean;
  readOnly: boolean;
  hasSelection: boolean;
  empty: boolean;
}

export interface FieldItem {
  action: FieldAction;
  label: string;
  hint: string;
  enabled: boolean;
}

// The input types that hold text a person types and can select.
const TEXT_TYPES = new Set(['', 'text', 'search', 'password', 'email', 'url', 'tel']);

export type TextField = HTMLInputElement | HTMLTextAreaElement;

/** Whether an element takes the field menu: a text input or a textarea, enabled, and
 * not xterm.js's hidden textarea (the terminal keeps its own menu). */
export function takesFieldMenu(tag: string, type: string, disabled: boolean, inTerminal: boolean): boolean {
  if (disabled || inTerminal) return false;
  if (tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && TEXT_TYPES.has(type);
}

/** The text field a right-click landed in, or null (a button, a list, the terminal). */
export function textFieldOf(target: EventTarget | null): TextField | null {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return null;
  const type = target instanceof HTMLInputElement ? target.type : '';
  return takesFieldMenu(target.tagName, type, target.disabled, !!target.closest('.xterm')) ? target : null;
}

export function fieldStateOf(el: TextField): FieldState {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  return {
    password: el instanceof HTMLInputElement && el.type === 'password',
    readOnly: el.readOnly,
    hasSelection: end > start,
    empty: el.value.length === 0,
  };
}

/** The menu's items: Cut and Copy need a selection and never copy a password field. */
export function fieldItems(f: FieldState, os: Os): FieldItem[] {
  const mod = os === 'mac' ? '⌘' : 'Ctrl+';
  const canCopy = f.hasSelection && !f.password;
  return [
    { action: 'cut', label: 'Cut', hint: `${mod}X`, enabled: canCopy && !f.readOnly },
    { action: 'copy', label: 'Copy', hint: `${mod}C`, enabled: canCopy },
    { action: 'paste', label: 'Paste', hint: `${mod}V`, enabled: !f.readOnly },
    { action: 'selectAll', label: 'Select all', hint: `${mod}A`, enabled: !f.empty },
  ];
}
