// One xterm.js terminal per pane. It stays mounted while the pane is open (hidden when
// another tab is active), so scrollback survives tab switches, splits and reconnects.
// `tabId` is the pane's id (milestone 20: a tab holds up to four panes).
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
import { keyInput } from '../lib/keyInput';
import { clipboardKey } from '../lib/clipboardKeys';
import { api } from '../api/backend';
import { runAction } from '../shell/actions';
import { sessions } from './store';
import { parseOsc7 } from '../files/paths';
import styles from './TerminalView.module.css';
import { paletteVars, themePalette } from '../lib/terminalThemes';
import { discardStaged, overLimit, pasteChoice, pasteStaged, readClipboard, uploadPaste } from './paste';


function readVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

// The terminal palette comes from the CSS variables (--ansi-0…15, --term-*) as `el`
// sees them: the design tokens, overridden on the pane by the chosen colour theme
// (Settings → Terminal). Read again when the theme or the light/dark mode changes.
export function terminalTheme(el: Element = document.documentElement): ITheme {
  const cssVar = (name: string) => readVar(name, el);
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

// Every mounted terminal's "redraw all glyphs". The WebGL renderer shares one glyph
// atlas between terminals with the same options: when a new pane's terminal mounts
// (a split) or one is resized, the others kept drawing from cells the atlas had
// moved, and showed garbled glyphs until their next output (M20 owner check).
const redrawers = new Set<() => void>();
function redrawOthers(self: () => void) {
  for (const r of redrawers) if (r !== self) r();
}

export function fontStack(family: string): string {
  const base = readVar('--font-mono') || 'monospace';
  return family ? `"${family}", ${base}` : base;
}

export function TerminalView({ tabId, active, focus, fontSize }: { tabId: string; active: boolean; focus: boolean; fontSize: number }) {
  const { os, settings, dark, notify } = useApp();
  // Read by the paste listener, which is set up once.
  const pasteRef = useRef({ limit: settings.paste_limit_mb, notify });
  pasteRef.current = { limit: settings.paste_limit_mb, notify };
  const hostRef = useRef<HTMLDivElement>(null);
  // xterm mounts in an inner box with no padding: FitAddon sizes the terminal from
  // its parent's computed height, which under border-box includes the padding, so a
  // padded parent got one row too many and the last line was cut off.
  const screenRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const webglRef = useRef<WebglAddon | null>(null);

  // The WebGL renderer draws each glyph once into a texture atlas and reuses it. A
  // glyph drawn before the terminal's font was ready keeps the fallback font, and
  // only cells redrawn later (a selection, a new background) use the real one: text
  // that changes font when selected, or nearly vanishes after a font change. Dropping
  // the atlas once the font is in redraws every glyph with it. Cheap: glyphs are
  // drawn again on demand.
  //
  // Only a shown terminal is fitted (through `refit`): fitting a hidden one measured
  // its box under display:none, where "100%" reads as 100 px, and shrank the terminal
  // to 11x5. A full-screen program's screen (herdr, M31 owner check) was cut to that
  // and never drawn again, since the shell was told no new size.
  const redrawGlyphs = () => {
    const term = termRef.current;
    if (!term) return;
    try {
      webglRef.current?.clearTextureAtlas();
    } catch {
      // no atlas yet
    }
    refit();
    term.refresh(0, term.rows - 1);
  };
  // After the next two frames, when a system font (which fires no font-loading
  // event) has been resolved for the new text.
  const redrawGlyphsSoon = () => {
    requestAnimationFrame(() => requestAnimationFrame(redrawGlyphs));
  };
  // When the browser takes the WebGL context away, xterm falls back to its DOM
  // renderer, which starts empty and shows only what changes later. Everything is
  // drawn again at once, and WebGL comes back when the tab is shown again.
  const attachWebgl = (term: Terminal) => {
    if (webglRef.current) return;
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => {
        gl.dispose();
        if (webglRef.current === gl) webglRef.current = null;
        // A hidden window draws nothing (WebKit stops requestAnimationFrame): this runs
        // and the rows fill when the window is seen again (M35b).
        requestAnimationFrame(() => term.refresh(0, term.rows - 1));
      });
      term.loadAddon(gl);
      webglRef.current = gl;
    } catch {
      webglRef.current = null;
    }
  };
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
      theme: terminalTheme(hostRef.current ?? undefined),
      vtExtensions: { kittyKeyboard: true },
    } as ConstructorParameters<typeof Terminal>[0]);
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(screenRef.current!);
    termRef.current = term;
    fitRef.current = fit;
    attachWebgl(term);
    // Web fonts (the bundled ones) report when they finish loading; system fonts do not.
    let alive = true;
    const onFontsLoaded = () => { if (alive) redrawGlyphs(); };
    const redrawMine = () => { if (alive) redrawGlyphsSoon(); };
    redrawers.add(redrawMine);
    document.fonts?.ready.then(onFontsLoaded).catch(() => {});
    document.fonts?.addEventListener('loadingdone', onFontsLoaded);
    redrawGlyphsSoon();
    redrawOthers(redrawMine);
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
      // Dead keys, IME and dictation (lib/keyInput.ts).
      const ki = keyInput(e, lastCommit);
      if (ki.kind === 'paste') {
        e.preventDefault();
        if (ki.text) term.paste(ki.text);
        return false;
      }
      const mac = osRef.current === 'mac';
      // Copy and paste: ⌘C/⌘V on macOS (native events), Ctrl+Shift+C/V on Linux, and
      // on Windows also Ctrl+C/V and Ctrl/Shift+Insert (lib/clipboardKeys.ts).
      const ck = clipboardKey(e, osRef.current, term.hasSelection());
      if (ck === 'copy') {
        if (term.hasSelection()) {
          navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
          // As Windows Terminal: the next Ctrl+C interrupts again.
          if (osRef.current === 'windows') term.clearSelection();
        }
        return false;
      }
      if (ck === 'nativePaste') return false;
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

    // An image on the clipboard with no text (milestone 25): written on the pane's
    // host, and its path pasted instead. Caught before xterm.js's own paste handler,
    // which would paste nothing. ⌘V on macOS, Ctrl+Shift+V on Linux.
    // `upload` writes the image on the session's host and resolves to the text to paste;
    // `drop` frees what was staged when it is refused before that.
    const pasteImage = (file: { name: string; size: number }, upload: (session: string) => Promise<string>, drop: () => void) => {
      const { limit, notify: say } = pasteRef.current;
      const pane = sessions.pane(tabId);
      if (!pane || pane.status !== 'ready' || !pane.session) {
        drop();
        say('Connect first: the image is pasted on the server', 'error');
        return;
      }
      const tooBig = overLimit(file, limit);
      if (tooBig) {
        drop();
        say(tooBig, 'error');
        return;
      }
      say(`Pasting image to ${pane.alias}…`, 'info');
      const session = pane.session;
      upload(session).then((text) => {
        // The pane may have reconnected or closed meanwhile: paste only into the same session.
        if (alive && sessions.pane(tabId)?.session === session) term.paste(text);
      }).catch((err: { message: string }) => say(`Paste to ${pane.alias} failed: ${err.message}`, 'error'));
    };
    const onPaste = (e: ClipboardEvent) => {
      const choice = pasteChoice(e.clipboardData);
      if (choice.kind === 'text') return;
      e.preventDefault();
      e.stopPropagation();
      if (choice.kind === 'image') {
        pasteImage(choice.file, (session) => uploadPaste(session, choice.file), () => {});
        return;
      }
      // WebKitGTK hands the page an empty paste event: the core reads the clipboard.
      readClipboard().then((r) => {
        if (!alive) {
          if (r.kind === 'image') discardStaged(r.image);
          return;
        }
        if (r.kind === 'text') term.paste(r.text);
        if (r.kind === 'image') {
          pasteImage({ name: 'The image', size: r.size }, (session) => pasteStaged(session, r.image), () => discardStaged(r.image));
        }
      }).catch((err: { message: string }) => pasteRef.current.notify(`Paste failed: ${err.message}`, 'error'));
    };
    term.element?.addEventListener('paste', onPaste, true);

    const input = term.onData((data) => sessions.input(tabId, data));
    // OSC 52: a remote program (Neovim, tmux, Zellij) sets the clipboard. The core
    // writes it: the webview refuses a clipboard write no click started. Queries are
    // ignored there, so the remote never reads the clipboard.
    const osc52 = term.parser.registerOscHandler(52, (payload) => {
      api.terminalClipboard(payload).catch((err) => console.warn('OSC 52 copy failed', err));
      return true;
    });
    // OSC 7: the shell reports its folder; the Files view can go there (milestone 17).
    const osc7 = term.parser.registerOscHandler(7, (payload) => {
      const cwd = parseOsc7(payload);
      if (cwd) sessions.setCwd(tabId, cwd);
      return true;
    });
    sessions.attach(tabId, (bytes) => term.write(bytes));

    let raf = 0;
    let settle = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(refit);
      // Once a split or a divider drag settles, every pane redraws its glyphs.
      clearTimeout(settle);
      settle = window.setTimeout(() => { redrawMine(); redrawOthers(redrawMine); }, 150);
    });
    observer.observe(screenRef.current!);

    return () => {
      alive = false;
      redrawers.delete(redrawMine);
      clearTimeout(settle);
      document.fonts?.removeEventListener('loadingdone', onFontsLoaded);
      cancelAnimationFrame(raf);
      observer.disconnect();
      input.dispose();
      osc52.dispose();
      osc7.dispose();
      sessions.detach(tabId);
      term.textarea?.removeEventListener('compositionend', onCompositionEnd);
      term.element?.removeEventListener('contextmenu', onContextMenu);
      term.element?.removeEventListener('paste', onPaste, true);
      webglRef.current?.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      webglRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Theme, font and cursor follow Settings live.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = terminalTheme(hostRef.current ?? undefined);
  }, [dark, settings.accent, settings.term_theme]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontStack(settings.term_font);
    term.options.fontSize = fontSize;
    term.options.lineHeight = settings.term_line_height / 100;
    term.options.cursorStyle = settings.term_cursor;
    term.options.cursorBlink = settings.term_cursor_blink;
    refit();
    redrawGlyphsSoon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.term_font, fontSize, settings.term_line_height, settings.term_cursor, settings.term_cursor_blink]);

  useEffect(() => {
    if (!active) return;
    // After the parent's effects: coming back from Settings, Shell restores the
    // sidebar (root data-collapsed) in its own effect, which runs after this one.
    // Fitting now measured the wider pane and sent the shell a resize too many,
    // which zsh answered by drawing its prompt again.
    const t = setTimeout(refit, 0);
    const term = termRef.current;
    if (term && !webglRef.current) {
      attachWebgl(term);
      term.refresh(0, term.rows - 1);
    }
    if (focus) termRef.current?.focus();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focus]);

  return (
    <div ref={hostRef} className={styles.term} data-tab={tabId} hidden={!active} style={paletteVars(themePalette(settings.term_theme, dark))}>
      <div ref={screenRef} className={styles.screen} />
    </div>
  );
}

// Focuses a pane's terminal (after a prompt closes, or F6).
export function focusTerminal(tabId: string | null) {
  if (!tabId) return;
  const el = document.querySelector<HTMLElement>(`[data-tab="${tabId}"] textarea`);
  el?.focus();
}
