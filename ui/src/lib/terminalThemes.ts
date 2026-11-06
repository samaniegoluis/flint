// Terminal colour themes (Settings → Terminal), ported from Tether's
// frontend/src/theme/terminalThemes.js. Each has a dark and a light palette; the app's
// light or dark mode picks one. They set only the terminal's colours: the 16 ANSI
// colours, background, foreground, cursor and selection. "Default" is Flint's own
// palette, read from the design tokens (--term-*, --ansi-*).

import type { ITheme } from '@xterm/xterm';

export type TermThemeId = 'default' | 'catppuccin' | 'tokyo-night' | 'aura' | 'dracula' | 'nord';

export interface TermThemeDef {
  id: TermThemeId;
  label: string;
  dark: ITheme | null;
  light: ITheme | null;
}

export const TERM_THEMES: TermThemeDef[] = [
  { id: 'default', label: 'Default', dark: null, light: null },
  // https://github.com/catppuccin/catppuccin (Mocha, Latte)
  {
    id: 'catppuccin', label: 'Catppuccin',
    dark: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      cursorAccent: '#1e1e2e',
      selectionBackground: 'rgba(205,214,244,0.15)',
      black: '#45475a',
      brightBlack: '#585b70',
      red: '#f38ba8',
      brightRed: '#f38ba8',
      green: '#a6e3a1',
      brightGreen: '#a6e3a1',
      yellow: '#f9e2af',
      brightYellow: '#f9e2af',
      blue: '#89b4fa',
      brightBlue: '#89b4fa',
      magenta: '#f5c2e7',
      brightMagenta: '#f5c2e7',
      cyan: '#94e2d5',
      brightCyan: '#94e2d5',
      white: '#bac2de',
      brightWhite: '#a6adc8',
    },
    light: {
      background: '#eff1f5',
      foreground: '#4c4f69',
      cursor: '#dc8a78',
      cursorAccent: '#eff1f5',
      selectionBackground: 'rgba(76,79,105,0.15)',
      black: '#5c5f77',
      brightBlack: '#6c6f85',
      red: '#d20f39',
      brightRed: '#d20f39',
      green: '#40a02b',
      brightGreen: '#40a02b',
      yellow: '#df8e1d',
      brightYellow: '#df8e1d',
      blue: '#1e66f5',
      brightBlue: '#1e66f5',
      magenta: '#ea76cb',
      brightMagenta: '#ea76cb',
      cyan: '#179299',
      brightCyan: '#179299',
      white: '#acb0be',
      brightWhite: '#bcc0cc',
    },
  },
  // https://github.com/enkia/tokyo-night-vscode-theme (Night, Day)
  {
    id: 'tokyo-night', label: 'Tokyo Night',
    dark: {
      background: '#1a1b26',
      foreground: '#a9b1d6',
      cursor: '#c0caf5',
      cursorAccent: '#1a1b26',
      selectionBackground: 'rgba(169,177,214,0.15)',
      black: '#15161e',
      brightBlack: '#414868',
      red: '#f7768e',
      brightRed: '#f7768e',
      green: '#9ece6a',
      brightGreen: '#9ece6a',
      yellow: '#e0af68',
      brightYellow: '#e0af68',
      blue: '#7aa2f7',
      brightBlue: '#7aa2f7',
      magenta: '#bb9af7',
      brightMagenta: '#bb9af7',
      cyan: '#7dcfff',
      brightCyan: '#7dcfff',
      white: '#a9b1d6',
      brightWhite: '#c0caf5',
    },
    light: {
      background: '#e1e2e7',
      foreground: '#3760bf',
      cursor: '#3760bf',
      cursorAccent: '#e1e2e7',
      selectionBackground: 'rgba(55,96,191,0.15)',
      black: '#e9e9ed',
      brightBlack: '#a1a6c5',
      red: '#f52a65',
      brightRed: '#f52a65',
      green: '#587539',
      brightGreen: '#587539',
      yellow: '#8c6c3e',
      brightYellow: '#8c6c3e',
      blue: '#2e7de9',
      brightBlue: '#2e7de9',
      magenta: '#9854f1',
      brightMagenta: '#9854f1',
      cyan: '#007197',
      brightCyan: '#007197',
      white: '#6172b0',
      brightWhite: '#3760bf',
    },
  },
  // https://github.com/daltonmenezes/aura-theme (light: an approximation)
  {
    id: 'aura', label: 'Aura',
    dark: {
      background: '#15141b',
      foreground: '#edecee',
      cursor: '#a277ff',
      cursorAccent: '#15141b',
      selectionBackground: 'rgba(162,119,255,0.15)',
      black: '#1c1b23',
      brightBlack: '#6d6d6d',
      red: '#ff6767',
      brightRed: '#ff6767',
      green: '#61ffca',
      brightGreen: '#61ffca',
      yellow: '#ffca85',
      brightYellow: '#ffca85',
      blue: '#a277ff',
      brightBlue: '#a277ff',
      magenta: '#f694ff',
      brightMagenta: '#f694ff',
      cyan: '#61ffca',
      brightCyan: '#61ffca',
      white: '#edecee',
      brightWhite: '#edecee',
    },
    light: {
      background: '#f3f0ff',
      foreground: '#15141b',
      cursor: '#a277ff',
      cursorAccent: '#f3f0ff',
      selectionBackground: 'rgba(162,119,255,0.12)',
      black: '#2d2b3a',
      brightBlack: '#5a5a6e',
      red: '#c93636',
      brightRed: '#c93636',
      green: '#0d9973',
      brightGreen: '#0d9973',
      yellow: '#b8720d',
      brightYellow: '#b8720d',
      blue: '#7b58d6',
      brightBlue: '#7b58d6',
      magenta: '#b84fd4',
      brightMagenta: '#b84fd4',
      cyan: '#0d9973',
      brightCyan: '#0d9973',
      white: '#3d3b4e',
      brightWhite: '#15141b',
    },
  },
  // https://github.com/dracula/dracula-theme (light: an approximation)
  {
    id: 'dracula', label: 'Dracula',
    dark: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: 'rgba(248,248,242,0.15)',
      black: '#21222c',
      brightBlack: '#6272a4',
      red: '#ff5555',
      brightRed: '#ff6e6e',
      green: '#50fa7b',
      brightGreen: '#69ff94',
      yellow: '#f1fa8c',
      brightYellow: '#ffffa5',
      blue: '#bd93f9',
      brightBlue: '#d6acff',
      magenta: '#ff79c6',
      brightMagenta: '#ff92df',
      cyan: '#8be9fd',
      brightCyan: '#a4ffff',
      white: '#f8f8f2',
      brightWhite: '#ffffff',
    },
    light: {
      background: '#f8f8f2',
      foreground: '#282a36',
      cursor: '#6272a4',
      cursorAccent: '#f8f8f2',
      selectionBackground: 'rgba(40,42,54,0.12)',
      black: '#44475a',
      brightBlack: '#6272a4',
      red: '#b81f1f',
      brightRed: '#c42828',
      green: '#257a3e',
      brightGreen: '#1e6635',
      yellow: '#8a7a00',
      brightYellow: '#9e8e00',
      blue: '#6b3dbd',
      brightBlue: '#7c4dd4',
      magenta: '#b5348a',
      brightMagenta: '#c43d99',
      cyan: '#0080a8',
      brightCyan: '#0092be',
      white: '#44475a',
      brightWhite: '#282a36',
    },
  },
  // https://github.com/nordtheme/nord (light: derived from Snow Storm)
  {
    id: 'nord', label: 'Nord',
    dark: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      cursorAccent: '#2e3440',
      selectionBackground: 'rgba(216,222,233,0.15)',
      black: '#3b4252',
      brightBlack: '#4c566a',
      red: '#bf616a',
      brightRed: '#bf616a',
      green: '#a3be8c',
      brightGreen: '#a3be8c',
      yellow: '#ebcb8b',
      brightYellow: '#ebcb8b',
      blue: '#81a1c1',
      brightBlue: '#81a1c1',
      magenta: '#b48ead',
      brightMagenta: '#b48ead',
      cyan: '#88c0d0',
      brightCyan: '#8fbcbb',
      white: '#e5e9f0',
      brightWhite: '#eceff4',
    },
    light: {
      background: '#eceff4',
      foreground: '#2e3440',
      cursor: '#5e81ac',
      cursorAccent: '#eceff4',
      selectionBackground: 'rgba(46,52,64,0.12)',
      black: '#3b4252',
      brightBlack: '#4c566a',
      red: '#bf616a',
      brightRed: '#bf616a',
      green: '#6a9955',
      brightGreen: '#6a9955',
      yellow: '#9a7e35',
      brightYellow: '#9a7e35',
      blue: '#5e81ac',
      brightBlue: '#5e81ac',
      magenta: '#8a6a96',
      brightMagenta: '#8a6a96',
      cyan: '#3d8fa1',
      brightCyan: '#3d8fa1',
      white: '#d8dee9',
      brightWhite: '#e5e9f0',
    },
  },
];

// The palette for a theme in the given mode, or null for Flint's default (tokens).
export function themePalette(id: string, dark: boolean): ITheme | null {
  const t = TERM_THEMES.find((x) => x.id === id);
  if (!t) return null;
  return dark ? t.dark : t.light;
}

const ANSI_KEYS: (keyof ITheme)[] = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

// A palette as the design's CSS variables (--term-*, --ansi-0…15), to set on an
// element: the terminal pane and the Settings preview then draw from the same
// variables whichever theme is chosen. Flint's default sets none.
export function paletteVars(p: ITheme | null): React.CSSProperties {
  if (!p) return {};
  const v: Record<string, string> = {
    '--term-bg': p.background ?? '', '--term-fg': p.foreground ?? '',
    '--term-cursor': p.cursor ?? '', '--term-cursor-text': p.cursorAccent ?? p.background ?? '',
    '--term-selection': p.selectionBackground ?? '',
  };
  ANSI_KEYS.forEach((k, i) => { v['--ansi-' + i] = String(p[k] ?? ''); });
  return v as React.CSSProperties;
}

export const ANSI_ORDER = ANSI_KEYS;
