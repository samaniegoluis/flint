// One xterm.js terminal per tab. It stays mounted while the tab is open (hidden when
// another tab is active), so scrollback survives tab switches and reconnects.
//
// Ported from Tether's terminal: Kitty keyboard protocol (xterm.js 6.1 beta),
// the WebGL renderer (the DOM renderer mis-sizes cells in this beta), dead-key and
// dictation fixes, and app chords taken before they reach the shell.

import { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { useApp } from '../state/app';
import { actionFor } from '../lib/keymap';
import { runAction } from '../shell/actions';
import { sessions } from './store';
import styles from './TerminalView.module.css';

const PRINTABLE_KEY_CODE_RE = /^(Key[A-Z]|Digit[0-9]|Space|Backquote|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|Intl(Backslash|Ro|Yen))$/;
const IME_SENTINEL_KEYS = new Set(['Dead', 'Unidentified', 'Process', 'AltGraph']);

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// The terminal palette comes from the tokens (--ansi-0…15, --term-*), read when the
// theme changes.
export function terminalTheme(): ITheme {
  const ansi = (n: number) => cssVar('--ansi-' + n);
  return {
    background: cssVar('--term-bg'), foreground: cssVar('--term-fg'),
    cursor: cssVar('--term-cursor'), cursorAccent: cssVar('--term-cursor-text'),
    selectionBackground: cssVar('--term-selection'),
    black: ansi(0), red: ansi(1), green: ansi(2), yellow: ansi(3), blue: ansi(4), magenta: ansi(5), cyan: ansi(6), white: ansi(7),
    brightBlack: ansi(8), brightRed: ansi(9), brightGreen: ansi(10), brightYellow: ansi(11), brightBlue: ansi(12),
    brightMagenta: ansi(13), brightCyan: ansi(14), brightWhite: ansi(15),
  };
}

export function fontStack(family: string): string {
  const base = cssVar('--font-mono') || 'monospace';
  return family ? `"${family}", ${base}` : base;
}

export function TerminalView({ tabId, active, focus, fontSize }: { tabId: string; active: boolean; focus: boolean; fontSize: number }) {
  const { os, settings, dark } = useApp();
  const hostRef = useRef<HTMLDivElement>(null);
  // xterm mounts in an inner box with no padding: FitAddon sizes the terminal from
  // its parent's computed height, which under border-box includes the padding, so a
  // padded parent got one row too many and the last line was cut off.
  const screenRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const osRef = useRef(os);
  osRef.current = os;

  const refit = () => {
    const term = termRef.current;
    if (!term || !activeRef.current) return;
    try {
      fitRef.current?.fit();
      sessions.resize(tabId, term.cols, term.rows);
    } catch {
      // not measurable while hidden
    }
  };

  useEffect(() => {
    const term = new Terminal({
      fontFamily: fontStack(settings.term_font),
      fontSize,
      lineHeight: settings.term_line_height / 100,
      cursorStyle: settings.term_cursor,
      cursorBlink: settings.term_cursor_blink,
      scrollback: 10000,
      allowProposedApi: true,
      theme: terminalTheme(),
      vtExtensions: { kittyKeyboard: true },
    } as ConstructorParameters<typeof Terminal>[0]);
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(screenRef.current!);
    let webgl: WebglAddon | undefined;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => { webgl?.dispose(); webgl = undefined; });
      term.loadAddon(webgl);
    } catch {
      webgl = undefined;
    }
    termRef.current = term;
    fitRef.current = fit;
    // The headless end-to-end run reads the terminal's buffer (scripts/gui-e2e.js).
    const e2e = (window as unknown as { __flintE2E?: { terms: Record<string, Terminal> } }).__flintE2E;
    if (e2e) e2e.terms[tabId] = term;
    try {
      fit.fit();
      sessions.resize(tabId, term.cols, term.rows);
    } catch {
      // hidden at mount
    }

    let committed = '';
    const onCompositionEnd = (e: CompositionEvent) => { committed = e.data ?? ''; };
    term.textarea?.addEventListener('compositionend', onCompositionEnd);

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const lastCommit = committed;
      committed = '';
      // A dead key that did not combine is flushed as one keydown carrying the dead
      // char plus the next one; the dead char already went out on compositionend.
      if (lastCommit && e.key.length > lastCommit.length && e.key.startsWith(lastCommit)) {
        e.preventDefault();
        term.paste(e.key.slice(lastCommit.length));
        return false;
      }
      // Dictation and text expanders insert a whole string in one keydown.
      if (e.key.length > 1 && PRINTABLE_KEY_CODE_RE.test(e.code) && !IME_SENTINEL_KEYS.has(e.key)) {
        e.preventDefault();
        term.paste(e.key);
        return false;
      }
      const mac = osRef.current === 'mac';
      // Copy and paste: ⌘C/⌘V on macOS (native events), Ctrl+Shift+C/V on Linux.
      if (!mac && e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyC') {
        if (term.hasSelection()) navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        return false;
      }
      if (!mac && e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyV') return false;
      const action = actionFor(e, osRef.current);
      if (action) {
        e.preventDefault();
        runAction(action);
        return false;
      }
      // Other ⌘ chords belong to the OS (⌘Q, ⌘H, ⌘C, ⌘V): keep them out of the
      // Kitty encoder, which would swallow them.
      if (mac && e.metaKey) return false;
      return true;
    });

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) {
        navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        term.clearSelection();
      } else {
        navigator.clipboard?.readText().then((t) => term.paste(t)).catch(() => {});
      }
    };
    term.element?.addEventListener('contextmenu', onContextMenu);

    const input = term.onData((data) => sessions.input(tabId, data));
    sessions.attach(tabId, (bytes) => term.write(bytes));

    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(refit);
    });
    observer.observe(screenRef.current!);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      input.dispose();
      sessions.detach(tabId);
      term.textarea?.removeEventListener('compositionend', onCompositionEnd);
      term.element?.removeEventListener('contextmenu', onContextMenu);
      webgl?.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Theme, font and cursor follow Settings live.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = terminalTheme();
  }, [dark, settings.accent]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontStack(settings.term_font);
    term.options.fontSize = fontSize;
    term.options.lineHeight = settings.term_line_height / 100;
    term.options.cursorStyle = settings.term_cursor;
    term.options.cursorBlink = settings.term_cursor_blink;
    refit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.term_font, fontSize, settings.term_line_height, settings.term_cursor, settings.term_cursor_blink]);

  useEffect(() => {
    if (!active) return;
    refit();
    if (focus) termRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focus]);

  return (
    <div ref={hostRef} className={styles.term} data-tab={tabId} hidden={!active}>
      <div ref={screenRef} className={styles.screen} />
    </div>
  );
}

// Focuses the active tab's terminal (after a prompt closes, or F6).
export function focusTerminal(tabId: string | null) {
  if (!tabId) return;
  const el = document.querySelector<HTMLElement>(`[data-tab="${tabId}"] textarea`);
  el?.focus();
}
