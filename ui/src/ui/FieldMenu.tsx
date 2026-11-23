import { useEffect, useRef, useState } from 'react';
import { api } from '../api/backend';
import { useApp } from '../state/app';
import { fieldItems, fieldStateOf, textFieldOf, type FieldAction, type TextField } from '../lib/fieldMenu';
import { guardBrowserKey } from '../lib/browserKeys';
import { ContextMenu } from './ContextMenu';

interface Open {
  x: number;
  y: number;
  el: TextField;
  start: number;
  end: number;
}

// The webview is never a browser (milestone 64, Principle 20). Over the whole window:
// a right-click in a text field opens Flint's own Cut, Copy, Paste and Select all, and
// the engine's reload, print, save and view-source keys are cancelled. Anything else
// right-clicked keeps its own menu (the terminal, tabs, lists) or gets none.
export function FieldMenu() {
  const { os, notify, fail } = useApp();
  const [open, setOpen] = useState<Open | null>(null);
  const osRef = useRef(os);
  osRef.current = os;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => guardBrowserKey(e, osRef.current);
    // Bubbling, after React and the terminal: a menu of their own already cancelled it.
    const onMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const el = textFieldOf(e.target);
      if (!el) return;
      e.preventDefault();
      el.focus();
      setOpen({ x: e.clientX, y: e.clientY, el, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onMenu);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', onMenu);
    };
  }, []);

  if (!open) return null;
  const { el, start, end } = open;
  // The menu takes the focus: put it and the selection back before acting.
  const restore = () => {
    el.focus();
    el.setSelectionRange(start, end);
  };
  const run = (a: FieldAction) => {
    restore();
    const selected = el.value.slice(start, end);
    switch (a) {
      case 'copy':
        api.fieldClipboardCopy(selected).catch(fail);
        break;
      case 'cut':
        api.fieldClipboardCopy(selected).then(() => {
          restore();
          document.execCommand('delete');
        }).catch(fail);
        break;
      case 'paste':
        api.fieldClipboardRead().then((r) => {
          if (r.secret) {
            notify({ text: `Press ${os === 'mac' ? '⌘V' : 'Ctrl+V'} to paste the password Flint copied`, kind: 'info', key: 'field-paste' });
            restore();
            return;
          }
          restore();
          if (r.text) document.execCommand('insertText', false, r.text);
        }).catch(fail);
        break;
      case 'selectAll':
        el.select();
        break;
    }
  };
  // The selection as it was at the right-click: the menu has the focus now.
  const state = { ...fieldStateOf(el), hasSelection: end > start };
  const items = fieldItems(state, os).map((i) => ({ label: i.label, hint: i.hint, disabled: !i.enabled, run: () => run(i.action) }));
  return <ContextMenu x={open.x} y={open.y} items={items} onClose={() => setOpen(null)} />;
}
