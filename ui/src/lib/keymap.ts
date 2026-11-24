// The keyboard map from the design handoff (docs/design/README.md): macOS ⌘ maps to
// Ctrl+Shift on Linux, ⇧⌘ to Ctrl+Alt+Shift and ⌥⌘ to Ctrl+Alt, so plain Ctrl chords
// always reach the terminal (Kitty keyboard protocol).

import { t } from '../i18n';

export type Os = 'mac' | 'linux' | 'windows';

export type Action =
  | 'palette' | 'gotoHost' | 'switchVault' | 'openVault' | 'createVault' | 'connectRemote'
  | 'newSession' | 'closeTab' | 'reconnect' | 'duplicate' | 'toggleSidebar'
  | 'splitRight' | 'splitDown' | 'focusNextPane' | 'focusPrevPane'
  | 'layout1' | 'layout2' | 'layout3' | 'layout4'
  | 'viewHosts' | 'viewFiles' | 'viewTunnels' | 'viewKeys' | 'viewCredentials' | 'settings' | 'newHost' | 'newSshHost' | 'newRdpHost' | 'editHost'
  | 'collapseAll' | 'expandAll' | 'fullscreen' | 'fullscreenAll'
  | 'syncNow' | 'connectServer' | 'disconnectServer' | 'showLastMerge'
  | 'checkUpdates' | 'whatsNew' | 'aboutFlint'
  | 'lock' | 'quit' | 'fontBigger' | 'fontSmaller' | 'fontReset' | 'nextRegion' | 'prevRegion'
  | 'tab1' | 'tab2' | 'tab3' | 'tab4' | 'tab5' | 'tab6' | 'tab7' | 'tab8' | 'tab9';

// `none` marks an action with no shortcut (palette and buttons only). `shifted` is the
// ⇧⌘ layer and `alt` the ⌥⌘ one. `code` is KeyboardEvent.code, so the map holds on any
// keyboard layout. `bare` chords (F6) take no modifier.
interface Chord {
  none?: boolean;
  code: string;
  shifted?: boolean;
  alt?: boolean;
  bare?: boolean;
  /** Full screen's own chord (milestone 37): ⌃⌘F on macOS, Ctrl+Alt+Enter elsewhere. */
  fullscreen?: boolean;
  shiftOnly?: boolean;
  label: string;
}

const CHORDS: Record<Action, Chord> = {
  palette: { code: 'KeyK', label: 'K' },
  gotoHost: { code: 'KeyP', label: 'P' },
  switchVault: { code: 'KeyO', shifted: true, label: 'O' },
  openVault: { code: 'KeyO', label: 'O' },
  createVault: { code: 'KeyN', shifted: true, label: 'N' },
  // Milestone 44 (design 01): beside ⌘O and ⇧⌘O.
  connectRemote: { code: 'KeyO', alt: true, label: 'O' },
  newSession: { code: 'KeyT', label: 'T' },
  closeTab: { code: 'KeyW', label: 'W' },
  reconnect: { code: 'KeyR', label: 'R' },
  // Split right takes ⌘D, so Duplicate moves to ⌥⌘D (design 18, README).
  duplicate: { code: 'KeyD', alt: true, label: 'D' },
  splitRight: { code: 'KeyD', label: 'D' },
  splitDown: { code: 'KeyD', shifted: true, label: 'D' },
  focusNextPane: { code: 'BracketRight', label: ']' },
  focusPrevPane: { code: 'BracketLeft', label: '[' },
  layout1: { code: 'Digit1', alt: true, label: '1' },
  layout2: { code: 'Digit2', alt: true, label: '2' },
  layout3: { code: 'Digit3', alt: true, label: '3' },
  layout4: { code: 'Digit4', alt: true, label: '4' },
  toggleSidebar: { code: 'KeyB', label: 'B' },
  viewHosts: { code: 'KeyH', shifted: true, label: 'H' },
  viewFiles: { code: 'KeyE', label: 'E' },
  viewTunnels: { code: 'KeyT', shifted: true, label: 'T' },
  viewKeys: { code: 'KeyK', shifted: true, label: 'K' },
  viewCredentials: { code: 'KeyC', shifted: true, label: 'C' },
  settings: { code: 'Comma', label: ',' },
  newHost: { code: 'KeyN', label: 'N' },
  newSshHost: { none: true, code: '', label: '' },
  newRdpHost: { none: true, code: '', label: '' },
  editHost: { code: 'KeyI', label: 'I' },
  collapseAll: { none: true, code: '', label: '' },
  // Milestone 44 (design 23h): the palette's sync commands, no shortcut.
  syncNow: { none: true, code: '', label: '' },
  connectServer: { none: true, code: '', label: '' },
  disconnectServer: { none: true, code: '', label: '' },
  showLastMerge: { none: true, code: '', label: '' },
  // Milestone 52 (design 24i): the update's commands, no shortcut.
  checkUpdates: { none: true, code: '', label: '' },
  whatsNew: { none: true, code: '', label: '' },
  aboutFlint: { none: true, code: '', label: '' },
  expandAll: { none: true, code: '', label: '' },
  fullscreen: { fullscreen: true, code: 'KeyF', label: 'F' },
  fullscreenAll: { none: true, code: '', label: '' },
  lock: { code: 'KeyL', label: 'L' },
  quit: { code: 'KeyQ', label: 'Q' },
  fontBigger: { code: 'Equal', label: '+' },
  fontSmaller: { code: 'Minus', label: '−' },
  fontReset: { code: 'Digit0', label: '0' },
  nextRegion: { code: 'F6', bare: true, label: 'F6' },
  prevRegion: { code: 'F6', shiftOnly: true, label: 'F6' },
  tab1: { code: 'Digit1', label: '1' },
  tab2: { code: 'Digit2', label: '2' },
  tab3: { code: 'Digit3', label: '3' },
  tab4: { code: 'Digit4', label: '4' },
  tab5: { code: 'Digit5', label: '5' },
  tab6: { code: 'Digit6', label: '6' },
  tab7: { code: 'Digit7', label: '7' },
  tab8: { code: 'Digit8', label: '8' },
  tab9: { code: 'Digit9', label: '9' },
};

export interface KeyLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

function matches(c: Chord, e: KeyLike, os: Os): boolean {
  if (c.fullscreen) {
    // macOS's own full-screen chord; elsewhere VMware's, which no terminal or remote
    // desktop shortcut uses.
    if (os === 'mac') return e.code === 'KeyF' && e.metaKey && e.ctrlKey && !e.altKey && !e.shiftKey;
    return (e.code === 'Enter' || e.code === 'NumpadEnter') && e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey;
  }
  if (c.none || e.code !== c.code) return false;
  if (c.bare) return !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
  if (c.shiftOnly) return e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
  if (c.alt) {
    if (os === 'mac') return e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey;
    return e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey;
  }
  if (os === 'mac') {
    return e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey === !!c.shifted;
  }
  return e.ctrlKey && e.shiftKey && !e.metaKey && e.altKey === !!c.shifted;
}

// The app action a key press triggers, or null when it belongs to the terminal or
// the focused control.
export function actionFor(e: KeyLike, os: Os): Action | null {
  for (const [action, chord] of Object.entries(CHORDS) as [Action, Chord][]) {
    if (matches(chord, e, os)) return action;
  }
  return null;
}

export function chordLabel(action: Action, os: Os): string {
  const c = CHORDS[action];
  if (c.none) return '';
  if (c.fullscreen) return os === 'mac' ? '⌃⌘F' : 'Ctrl+Alt+Enter';
  if (c.bare) return c.label;
  if (c.shiftOnly) return os === 'mac' ? '⇧' + c.label : 'Shift+' + c.label;
  if (c.alt) return (os === 'mac' ? '⌥⌘' : 'Ctrl+Alt+') + c.label;
  if (os === 'mac') return (c.shifted ? '⇧⌘' : '⌘') + c.label;
  return (c.shifted ? 'Ctrl+Alt+Shift+' : 'Ctrl+Shift+') + c.label;
}

// Labels for chords that are not app actions (shown in hints).
export function modLabel(key: string, os: Os): string {
  return os === 'mac' ? '⌘' + key : 'Ctrl+Shift+' + key;
}

/** An action's name, as the palette and Settings → Shortcuts show it. */
export function actionTitle(a: Action): string {
  return t(`keymap.action.${a}`);
}

/** Settings → Shortcuts' groups; `title` is a catalog key. */
export const SHORTCUT_GROUPS: { title: string; actions: Action[] }[] = [
  { title: 'keymap.group.general', actions: ['palette', 'gotoHost', 'settings', 'lock', 'quit', 'nextRegion', 'prevRegion'] },
  { title: 'keymap.group.vaults', actions: ['switchVault', 'openVault', 'createVault'] },
  { title: 'keymap.group.sessions', actions: ['newSession', 'closeTab', 'reconnect', 'duplicate', 'fullscreen', 'tab1', 'tab9'] },
  { title: 'keymap.group.panes', actions: ['splitRight', 'splitDown', 'focusNextPane', 'focusPrevPane', 'layout1', 'layout2', 'layout3', 'layout4'] },
  { title: 'keymap.group.views', actions: ['viewHosts', 'viewFiles', 'viewTunnels', 'viewKeys', 'viewCredentials', 'toggleSidebar'] },
  { title: 'keymap.group.hosts', actions: ['newHost', 'editHost'] },
  { title: 'keymap.group.terminal', actions: ['fontBigger', 'fontSmaller', 'fontReset'] },
];
