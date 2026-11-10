// The keyboard map from the design handoff (docs/design/README.md): macOS ⌘ maps to
// Ctrl+Shift on Linux, ⇧⌘ to Ctrl+Alt+Shift and ⌥⌘ to Ctrl+Alt, so plain Ctrl chords
// always reach the terminal (Kitty keyboard protocol).

export type Os = 'mac' | 'linux';

export type Action =
  | 'palette' | 'gotoHost' | 'switchVault' | 'openVault' | 'createVault'
  | 'newSession' | 'closeTab' | 'reconnect' | 'duplicate' | 'toggleSidebar'
  | 'splitRight' | 'splitDown' | 'focusNextPane' | 'focusPrevPane'
  | 'layout1' | 'layout2' | 'layout3' | 'layout4'
  | 'viewHosts' | 'viewFiles' | 'viewTunnels' | 'viewKeys' | 'viewCredentials' | 'settings' | 'newHost' | 'editHost'
  | 'collapseAll' | 'expandAll'
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
  shiftOnly?: boolean;
  label: string;
}

const CHORDS: Record<Action, Chord> = {
  palette: { code: 'KeyK', label: 'K' },
  gotoHost: { code: 'KeyP', label: 'P' },
  switchVault: { code: 'KeyO', shifted: true, label: 'O' },
  openVault: { code: 'KeyO', label: 'O' },
  createVault: { code: 'KeyN', shifted: true, label: 'N' },
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
  editHost: { code: 'KeyI', label: 'I' },
  collapseAll: { none: true, code: '', label: '' },
  expandAll: { none: true, code: '', label: '' },
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

export const ACTION_TITLES: Record<Action, string> = {
  palette: 'Command palette',
  gotoHost: 'Go to host',
  switchVault: 'Switch vault',
  openVault: 'Open vault file',
  createVault: 'Create vault',
  newSession: 'New session',
  closeTab: 'Close pane',
  reconnect: 'Reconnect',
  duplicate: 'Duplicate session',
  splitRight: 'Split right',
  splitDown: 'Split down',
  focusNextPane: 'Focus next pane',
  focusPrevPane: 'Focus previous pane',
  layout1: 'Layout: side by side',
  layout2: 'Layout: stacked',
  layout3: 'Layout: grid 2 × 2',
  layout4: 'Layout: one large + two small',
  toggleSidebar: 'Toggle sidebar',
  viewHosts: 'Hosts view',
  viewFiles: 'Files view',
  viewTunnels: 'Tunnels view',
  viewKeys: 'SSH keys',
  viewCredentials: 'Credentials',
  settings: 'Settings',
  newHost: 'New host',
  editHost: 'Edit host',
  collapseAll: 'Collapse all groups',
  expandAll: 'Expand all groups',
  lock: 'Lock vault',
  quit: 'Quit Flint',
  fontBigger: 'Bigger terminal font',
  fontSmaller: 'Smaller terminal font',
  fontReset: 'Reset terminal font',
  nextRegion: 'Next region',
  prevRegion: 'Previous region',
  tab1: 'Go to tab 1', tab2: 'Go to tab 2', tab3: 'Go to tab 3', tab4: 'Go to tab 4',
  tab5: 'Go to tab 5', tab6: 'Go to tab 6', tab7: 'Go to tab 7', tab8: 'Go to tab 8',
  tab9: 'Go to tab 9',
};

export const SHORTCUT_GROUPS: { title: string; actions: Action[] }[] = [
  { title: 'General', actions: ['palette', 'gotoHost', 'settings', 'lock', 'quit', 'nextRegion', 'prevRegion'] },
  { title: 'Vaults', actions: ['switchVault', 'openVault', 'createVault'] },
  { title: 'Sessions', actions: ['newSession', 'closeTab', 'reconnect', 'duplicate', 'tab1', 'tab9'] },
  { title: 'Panes', actions: ['splitRight', 'splitDown', 'focusNextPane', 'focusPrevPane', 'layout1', 'layout2', 'layout3', 'layout4'] },
  { title: 'Views', actions: ['viewHosts', 'viewFiles', 'viewTunnels', 'viewKeys', 'viewCredentials', 'toggleSidebar'] },
  { title: 'Hosts', actions: ['newHost', 'editHost'] },
  { title: 'Terminal', actions: ['fontBigger', 'fontSmaller', 'fontReset'] },
];
