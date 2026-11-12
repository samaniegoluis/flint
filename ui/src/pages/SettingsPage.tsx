// Settings (design screens 12a–12d): per-machine appearance and terminal settings
// (saved at once), the keyboard map (read-only; customising it is on the roadmap),
// the open vault, and on macOS what a Mac keyboard's modifiers send in an RDP tab
// (milestone 31, D-074; no design screen, built from these sections' parts).

import { useEffect, useState } from 'react';
import { api } from '../api/backend';
import { PASTE_LIMITS, type LockAfter, type Settings, type VaultStatus } from '../api/types';
import { shortPath, useApp, vaultInitial, vaultMarkClass } from '../state/app';
import { ACTION_TITLES, chordLabel, SHORTCUT_GROUPS } from '../lib/keymap';
import { Icon, type IconName } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { Picker } from '../ui/Picker';
import type { Confirm } from './KeysPage';
import { RenameVault } from '../shell/VaultSwitcher';
import { paletteVars, TERM_THEMES, themePalette } from '../lib/terminalThemes';
import { MAC_MOD_KEYS, MOD_TARGETS, modMapOf, modMapText, type MacModKey, type ModTarget } from '../lib/rdpInput';
import { AccessSettings } from '../access/AccessSettings';

export type SettingsSection = 'appearance' | 'terminal' | 'remote' | 'shortcuts' | 'vault' | 'access' | 'about';

const SECTIONS: { id: SettingsSection; label: string; icon: IconName }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'terminal', label: 'Terminal', icon: 'term' },
  { id: 'remote', label: 'Remote desktop', icon: 'rdp' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard' },
  { id: 'vault', label: 'Vault', icon: 'lock' },
  { id: 'access', label: 'Access', icon: 'shield-key' },
  { id: 'about', label: 'About', icon: 'info' },
];

export function SettingsPage({ section, setSection, onLock, onConfirm }: {
  section: SettingsSection;
  setSection: (s: SettingsSection) => void;
  onLock: () => void;
  onConfirm: (c: Confirm) => void;
}) {
  const { os } = useApp();
  // Remote desktop: graphics everywhere (milestone 34); the Mac keyboard's modifiers on
  // macOS only, where a PC keyboard does not already match.
  const sections = SECTIONS;
  return (
    <section className="main page" aria-label="Settings" style={{ flexDirection: 'row' }}>
      <nav className="settings-nav" aria-label="Settings sections">
        <span className="label" style={{ padding: '0 var(--sp-2) var(--sp-2)' }}>Settings</span>
        {sections.map((s) => (
          <button key={s.id} className={'nav-i' + (section === s.id ? ' on' : '')} aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
            <Icon name={s.icon} size="sm" />{s.label}
          </button>
        ))}
      </nav>
      <div className="grow scroll" style={{ padding: 'var(--sp-5) var(--sp-8)' }}>
        <div className="col" style={{ maxWidth: 860 }}>
          {section === 'appearance' && <Appearance />}
          {section === 'terminal' && <TerminalSettings />}
          {section === 'remote' && <RemoteDesktopSettings mac={os === 'mac'} />}
          {section === 'shortcuts' && <Shortcuts />}
          {section === 'vault' && <VaultSettings onLock={onLock} onConfirm={onConfirm} />}
          {section === 'access' && <AccessSettings onConfirm={onConfirm} />}
          {section === 'about' && <About />}
        </div>
      </div>
    </section>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-l"><span className="t">{title}</span>{desc && <span className="d">{desc}</span>}</div>
      <div className="col grow" style={{ gap: 'var(--sp-2)' }}>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="row" style={{ gap: 'var(--sp-3)', cursor: 'pointer' }}>
      <button type="button" className="toggle" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
      <span>{label}</span>
    </label>
  );
}

function useSetting() {
  const { settings, saveSettings } = useApp();
  return [settings, (p: Partial<Settings>) => saveSettings({ ...settings, ...p })] as const;
}

function ThemeCard({ value, label, current, onPick }: { value: Settings['theme']; label: string; current: string; onPick: () => void }) {
  const preview = (theme: 'dark' | 'light') => (
    <div data-theme={theme} className="grow" style={{ display: 'flex', background: 'var(--surface-base)' }}>
      <div style={{ width: 22, background: 'var(--surface-chrome)', borderRight: '1px solid var(--border-subtle)' }} />
      <div className="col grow" style={{ padding: 8, gap: 5 }}>
        <div style={{ height: 6, width: '70%', borderRadius: 3, background: 'var(--text-tertiary)', opacity: 0.6 }} />
        <div style={{ height: 6, width: '45%', borderRadius: 3, background: 'var(--accent)' }} />
        <div className="grow" style={{ borderRadius: 4, background: 'var(--term-bg)', border: '1px solid var(--border-subtle)' }} />
      </div>
    </div>
  );
  return (
    <button type="button" className="theme-card" role="radio" aria-checked={current === value} onClick={onPick}>
      <div className="theme-prev">{value === 'system' ? <>{preview('dark')}{preview('light')}</> : preview(value)}</div>
      <span style={{ fontSize: 'var(--fs-sm)' }}>{label}</span>
    </button>
  );
}

function Appearance() {
  const [s, set] = useSetting();
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', paddingBottom: 'var(--sp-2)' }}>Appearance</h1>
      <Row title="Theme" desc="Both themes come from the same tokens.">
        <div className="row" role="radiogroup" aria-label="Theme" style={{ gap: 'var(--sp-4)' }}>
          <ThemeCard value="dark" label="Dark" current={s.theme} onPick={() => set({ theme: 'dark' })} />
          <ThemeCard value="light" label="Light" current={s.theme} onPick={() => set({ theme: 'light' })} />
          <ThemeCard value="system" label="Match system" current={s.theme} onPick={() => set({ theme: 'system' })} />
        </div>
      </Row>
      <Row title="Accent" desc="Focus, active tab, primary buttons, cursor.">
        <div className="swatches" role="radiogroup" aria-label="Accent">
          {(['ember', 'sapphire', 'moss', 'iris'] as const).map((a) => (
            <button key={a} type="button" className={'sw c-' + a} role="radio" aria-checked={s.accent === a} aria-label={a} title={a} onClick={() => set({ accent: a })} />
          ))}
        </div>
      </Row>
      <Row title="Density" desc="Row height in the host tree, tabs and lists.">
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <div className="seg" role="group" aria-label="Density">
            {(['compact', 'default', 'comfortable'] as const).map((d) => (
              <button key={d} type="button" aria-pressed={s.density === d} onClick={() => set({ density: d })}>{d[0].toUpperCase() + d.slice(1)}</button>
            ))}
          </div>
          <span className="hint">22 · 26 · 30 px rows</span>
        </div>
      </Row>
      <Row title="Motion" desc="Popovers, drawers, sidebar collapse.">
        <Toggle on={s.follow_motion} onChange={(v) => set({ follow_motion: v })} label="Follow the system's “Reduce motion” setting" />
      </Row>
      <Row title="Window" desc="Applies on next launch.">
        <Toggle on={s.reopen_last_vault} onChange={(v) => set({ reopen_last_vault: v })} label="Reopen the last vault on launch" />
      </Row>
    </>
  );
}

function Stepper({ value, onChange, min, max, step, format, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; format: (v: number) => string; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={'Decrease ' + label} onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min}>−</button>
      <span aria-live="polite">{format(value)}</span>
      <button type="button" aria-label={'Increase ' + label} onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max}>+</button>
    </div>
  );
}

// A theme's swatch: its background with four of its ANSI colours.
function ThemeSwatch({ vars }: { vars: React.CSSProperties }) {
  return (
    <span aria-hidden="true" style={{ ...vars, display: 'inline-flex', gap: 2, padding: 3, borderRadius: 4, background: 'var(--term-bg)', border: '1px solid var(--border-subtle)' }}>
      {[1, 2, 4, 5].map((n) => <span key={n} style={{ width: 6, height: 10, borderRadius: 1, background: `var(--ansi-${n})` }} />)}
    </span>
  );
}

function TerminalSettings() {
  const [s, set] = useSetting();
  const { dark } = useApp();
  const themeVars = paletteVars(themePalette(s.term_theme, dark));
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => { api.fonts().then((r) => setFonts(r.fonts)).catch(() => setFonts([])); }, []);
  const nerd = (f: string) => /nerd/i.test(f);
  const family = s.term_font ? `"${s.term_font}", var(--font-mono)` : 'var(--font-mono)';
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', paddingBottom: 'var(--sp-2)' }}>Terminal</h1>
      <Row title="Colours" desc={`The terminal's palette, in its ${dark ? 'dark' : 'light'} variant: it follows the app's theme.`}>
        <div className="seg" role="radiogroup" aria-label="Terminal colours" style={{ flexWrap: 'wrap' }}>
          {TERM_THEMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={s.term_theme === t.id} aria-pressed={s.term_theme === t.id}
              onClick={() => set({ term_theme: t.id })} style={{ gap: 'var(--sp-2)' }}>
              <ThemeSwatch vars={paletteVars(dark ? t.dark : t.light)} />{t.label}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Font" desc="Monospaced fonts installed on this machine. Nerd Font builds show prompt glyphs.">
        <div style={{ maxWidth: 360 }}>
          <Picker label="Terminal font" value={s.term_font} onChange={(v) => set({ term_font: v })} placeholder="JetBrains Mono"
            options={[{ value: '', label: 'JetBrains Mono', text: 'JetBrains Mono', meta: 'bundled' },
              ...fonts.map((f) => ({ value: f, label: <span style={{ fontFamily: `"${f}"` }}>{f}</span>, text: f, meta: nerd(f) ? 'Nerd' : undefined }))]} />
        </div>
        <span className="hint">{fonts.length} installed monospaced fonts</span>
      </Row>
      <Row title="Size">
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <Stepper label="font size" value={s.term_font_size} min={8} max={32} step={1} format={(v) => v + ' px'} onChange={(v) => set({ term_font_size: v })} />
          <span className="hint"><Kbd action="fontBigger" /> / <Kbd action="fontSmaller" /> in a session · <Kbd action="fontReset" /> resets</span>
        </div>
      </Row>
      <Row title="Line height">
        <Stepper label="line height" value={s.term_line_height} min={100} max={200} step={5} format={(v) => (v / 100).toFixed(2)} onChange={(v) => set({ term_line_height: v })} />
      </Row>
      <Row title="Cursor">
        <div className="row" style={{ gap: 'var(--sp-4)' }}>
          <div className="seg" role="group" aria-label="Cursor style">
            {(['block', 'bar', 'underline'] as const).map((c) => (
              <button key={c} type="button" aria-pressed={s.term_cursor === c} onClick={() => set({ term_cursor: c })}>{c[0].toUpperCase() + c.slice(1)}</button>
            ))}
          </div>
          <Toggle on={s.term_cursor_blink} onChange={(v) => set({ term_cursor_blink: v })} label="Blink" />
        </div>
      </Row>
      <Row title="Largest file to paste" desc="An image pasted into a session is uploaded to the server and its path is pasted, for a program there such as Claude Code. Larger files go through Files. Set on this computer.">
        <div className="seg" role="radiogroup" aria-label="Largest file to paste">
          {PASTE_LIMITS.map((mb) => (
            <button key={mb} type="button" role="radio" aria-checked={s.paste_limit_mb === mb} aria-pressed={s.paste_limit_mb === mb} onClick={() => set({ paste_limit_mb: mb })}>{mb} MB</button>
          ))}
        </div>
      </Row>
      <Row title="Preview" desc="Uses the chosen colours and font.">
        <div className="term" style={{ ...themeVars, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontFamily: family, fontSize: s.term_font_size, lineHeight: s.term_line_height / 100 }}>
          <div className="l"><span className="g">luis</span><span className="d">@</span><span className="b">prod-api-01</span> <span className="c">~/srv/api</span> <span className="m">(main)</span> <span className="pc">❯</span> ls</div>
          <div className="l"><span className="b">dist</span>  <span className="b">src</span>  <span className="g">deploy.sh</span>  package.json  <span className="r">release.tar.gz</span></div>
          <div className="l"><span className="d"># 0O 1lI {'{}'}[] =&gt; != === -&gt;</span></div>
          <div className="l"><span className="g">luis</span><span className="d">@</span><span className="b">prod-api-01</span> <span className="c">~/srv/api</span> <span className="m">(main)</span> <span className="pc">❯</span> <span className="cur" /></div>
        </div>
      </Row>
    </>
  );
}

const MOD_KEY_LABELS: Record<MacModKey, string> = {
  ControlLeft: '⌃ Control (left)', ControlRight: '⌃ Control (right)', AltLeft: '⌥ Option (left)',
  AltRight: '⌥ Option (right)', MetaLeft: '⌘ Command (left)', MetaRight: '⌘ Command (right)',
};
const MOD_TARGET_LABELS: Record<ModTarget, string> = { ctrl: 'Ctrl', alt: 'Alt', altgr: 'AltGr', win: 'Win', off: 'Off' };

// Milestone 31 (D-074): what each modifier key of this Mac sends to Windows. A preset
// shows its table; changing a key starts a Custom table from what is shown.
// The version this build was made from (milestone 32): git's, read at build time.
function About() {
  const { info } = useApp();
  const libs: [string, string | undefined][] = [
    ['libssh', info?.libssh], ['libsodium', info?.libsodium], ['SQLite', info?.sqlite], ['FreeRDP', info?.freerdp],
  ];
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', marginBottom: 'var(--sp-3)' }}>About</h1>
      <Row title="Version" desc="The version this build of Flint was made from.">
        <span className="mono strong" data-about-version>Flint {info?.version ?? ''}</span>
        <span className="hint">What changed in each version is on the Changelog page of Flint's docs. A version with a suffix (<span className="mono">0.1.0-3-gabc1234</span>) is a build made between two releases.</span>
      </Row>
      <Row title="Libraries" desc="Linked into this build.">
        <table className="table compact" data-about-libs>
          <tbody>
            {libs.map(([name, v]) => <tr key={name}><td>{name}</td><td className="mono">{v || '—'}</td></tr>)}
          </tbody>
        </table>
      </Row>
    </>
  );
}

function RemoteDesktopSettings({ mac }: { mac: boolean }) {
  const [s, set] = useSetting();
  const map = modMapOf(s.rdp_mac_keys, s.rdp_mac_custom);
  const pick = (k: MacModKey, t: ModTarget) => set({ rdp_mac_keys: 'custom', rdp_mac_custom: modMapText({ ...map, [k]: t }) });
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', marginBottom: 'var(--sp-3)' }}>Remote desktop</h1>
      <Row title="Graphics" desc="How a new remote desktop tab is sent to this computer. Each tab can switch from its toolbar while connected.">
        <div className="seg" role="radiogroup" aria-label="Remote desktop graphics" data-rdp-graphics>
          {(['auto', 'compatible'] as const).map((g) => (
            <button key={g} type="button" role="radio" aria-checked={s.rdp_graphics === g} aria-pressed={s.rdp_graphics === g} data-graphics={g}
              onClick={() => set({ rdp_graphics: g })}>
              {g === 'auto' ? 'Automatic' : 'Compatible'}
            </button>
          ))}
        </div>
        <span className="hint">
          {s.rdp_graphics === 'auto'
            ? <>The graphics pipeline with the best codec both ends support (H.264 where this computer decodes it): smoother, less bandwidth. A server without it gets the classic updates.</>
            : <>Classic bitmap updates, as earlier versions of Flint used. Try it if the desktop shows wrong colours or garbled areas.</>}
        </span>
      </Row>
      {mac && <>
      <Row title="Modifier keys" desc="What this Mac's modifier keys send in an RDP tab. Set on this computer.">
        <div className="seg" role="radiogroup" aria-label="Modifier keys preset" data-rdp-keys-preset>
          {(['mac', 'windows', 'custom'] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={s.rdp_mac_keys === p} aria-pressed={s.rdp_mac_keys === p} data-preset={p}
              onClick={() => set(p === 'custom' ? { rdp_mac_keys: 'custom', rdp_mac_custom: modMapText(map) } : { rdp_mac_keys: p })}>
              {p === 'mac' ? 'Mac' : p === 'windows' ? 'Windows' : 'Custom'}
            </button>
          ))}
        </div>
        <span className="hint">
          {s.rdp_mac_keys === 'mac' && <><span className="kbd">⌘C</span> and <span className="kbd">⌘V</span> copy and paste in Windows, as on a Mac; <span className="kbd">⌃</span> is the Windows key.</>}
          {s.rdp_mac_keys === 'windows' && <>Keys where a PC keyboard has them: <span className="kbd">⌃C</span> and <span className="kbd">⌃V</span> copy and paste; <span className="kbd">⌥</span> is the Windows key.</>}
          {s.rdp_mac_keys === 'custom' && <>Each key as set below. Choose Mac or Windows to go back to a preset.</>}
        </span>
      </Row>
      <Row title="Each key" desc="Left and right keys apart. Off sends nothing.">
        <table className="table compact" data-rdp-keys-table>
          <tbody>
            {MAC_MOD_KEYS.map((k) => (
              <tr key={k}>
                <td className="primary" style={{ whiteSpace: 'nowrap' }}>{MOD_KEY_LABELS[k]}</td>
                <td>
                  <div className="seg" role="radiogroup" aria-label={`${MOD_KEY_LABELS[k]} sends`} data-mod-key={k}>
                    {MOD_TARGETS.map((t) => (
                      <button key={t} type="button" role="radio" aria-checked={map[k] === t} aria-pressed={map[k] === t} data-target={t} onClick={() => pick(k, t)}>{MOD_TARGET_LABELS[t]}</button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Row>
      <div className="callout info"><Icon name="keyboard" size="sm" className="info-t" /><span>Flint's own shortcuts stay on <span className="mono strong">⌘</span> in an RDP tab: the command palette and <span className="mono strong">⌘1</span>–<span className="mono strong">⌘9</span>. Combinations macOS keeps for itself, such as <span className="mono strong">⌘Tab</span> and <span className="mono strong">⌘Space</span>, never reach Windows.</span></div>
      </>}
    </>
  );
}

function Shortcuts() {
  const [q, setQ] = useState('');
  const match = (t: string) => !q || t.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="col" style={{ gap: 'var(--sp-3)' }}>
      <div className="row" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="grow" style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)' }}>Keyboard shortcuts</h1>
        <label className="search" style={{ width: 220 }}><Icon name="search" size="sm" /><input aria-label="Filter shortcuts" placeholder="Filter actions or keys" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="callout info"><Icon name="keyboard" size="sm" className="info-t" /><span>On Linux <span className="mono strong">⌘</span> becomes <span className="mono strong">Ctrl+Shift</span> and <span className="mono strong">⇧⌘</span> becomes <span className="mono strong">Ctrl+Alt+Shift</span>, so plain Ctrl combos always reach the terminal (Kitty keyboard protocol). Custom shortcuts are coming in a later version.</span></div>
      <table className="table compact">
        <thead><tr><th>Action</th><th>macOS</th><th>Linux</th></tr></thead>
        <tbody>
          {SHORTCUT_GROUPS.flatMap((g) => g.actions).filter((a) => match(ACTION_TITLES[a] + chordLabel(a, 'mac') + chordLabel(a, 'linux'))).map((a) => (
            <tr key={a}>
              <td className="primary">{a === 'tab9' ? 'Go to tab 9' : ACTION_TITLES[a]}</td>
              <td><span className="kbd">{chordLabel(a, 'mac')}</span></td>
              <td><span className="kbd">{chordLabel(a, 'linux')}</span></td>
            </tr>
          ))}
          {match('copy paste') && <tr><td className="primary">Copy · paste in the terminal</td><td><span className="kbd-group"><span className="kbd">⌘C</span><span className="kbd">⌘V</span></span></td><td><span className="kbd-group"><span className="kbd">Ctrl+Shift+C</span><span className="kbd">Ctrl+Shift+V</span></span></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const LOCK_AFTER: { value: LockAfter; label: string }[] = [
  { value: '1m', label: '1 minute' },
  { value: '5m', label: '5 minutes' },
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'never', label: 'Never' },
];

// Auto-lock (D-042): idle time here; the screen locking and sleep always lock.
function LockAfterRow() {
  const [s, set] = useSetting();
  return (
    <Row title="Lock after" desc="With nobody using Flint or its CLI for this long, the vault locks. It also locks when the screen locks and before the computer sleeps. Set on this computer.">
      <div className="row">
        <div className="seg" role="radiogroup" aria-label="Lock after">
          {LOCK_AFTER.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={s.lock_after === o.value} aria-pressed={s.lock_after === o.value} onClick={() => set({ lock_after: o.value })}>{o.label}</button>
          ))}
        </div>
      </div>
    </Row>
  );
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function VaultSettings({ onLock, onConfirm }: { onLock: () => void; onConfirm: (c: Confirm) => void }) {
  const { vault, catalog, os, refreshCatalog, notify, closeVault } = useApp();
  const [st, setSt] = useState<VaultStatus | null>(null);
  const [renaming, setRenaming] = useState(false);
  // Sessions record trusted keys on their worker, and the CLI can change the file:
  // read the catalog again when the page opens, or Known hosts shows a stale list.
  useEffect(() => { refreshCatalog().catch(() => {}); }, [refreshCatalog]);
  useEffect(() => { api.status().then(setSt).catch(() => {}); }, [catalog]);
  if (!vault) return null;
  const keychain = os === 'mac' ? 'macOS Keychain' : 'the Secret Service keyring';
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', paddingBottom: 'var(--sp-3)' }}>Vault</h1>
      <div className="panel row" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-4)' }}>
        <span className={'vault-mark lg ' + vaultMarkClass(vault.path)}>{vaultInitial(vault.name)}</span>
        <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
          <span className="strong" style={{ fontSize: 'var(--fs-lg)' }}>{vault.name}</span>
          <span className="mono muted trunc" style={{ fontSize: 'var(--fs-sm)' }} title={vault.path}>{shortPath(vault.path)}</span>
          {st && <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{count(st.hosts, 'host')} · {count(st.keys, 'key')} · {count(st.credentials, 'credential')} · {count(st.groups, 'group')} · format v{vault.format}</span>}
        </div>
      </div>
      <Row title="Name" desc="Shown in the vault switcher and used by flint --vault. The file keeps its name.">
        {renaming
          ? <RenameVault onDone={() => setRenaming(false)} />
          : <div className="row"><button className="btn btn-secondary btn-sm" onClick={() => setRenaming(true)}>Rename…</button></div>}
      </Row>
      <Row title="On this device" desc={st?.cached ? `The vault key is in ${keychain}.` : 'This machine asks for the master password.'}>
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <span className={'badge ' + (st?.cached ? 'ok' : '')}>{st?.cached ? 'Remembered' : 'Not remembered'}</span>
          {st?.cached && <button className="btn btn-secondary btn-sm" onClick={() => onConfirm({
            title: 'Forget the key on this device?',
            body: 'Every session closes, and opening this vault will ask for its master password.',
            action: 'Forget key',
            run: async () => { await api.forgetKey(vault.path); notify('This machine no longer remembers the vault key'); await closeVault(); },
          })}>Forget on this device</button>}
        </div>
      </Row>
      <Row title="Lock" desc="Clears the vault key from memory. Open sessions keep running behind the lock screen; the flint CLI and new sessions wait until you unlock with the master password.">
        <div><button className="btn btn-secondary" onClick={onLock}><Icon name="lock" size="sm" />Lock now<Kbd action="lock" /></button></div>
      </Row>
      <LockAfterRow />
      <Row title="Known hosts" desc="Server keys this vault trusts. Shared with the Flint CLI.">
        {catalog.known_hosts.length === 0 ? <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>None yet: a server's key is recorded the first time you trust it.</span> : (
          <table className="table compact">
            <thead><tr><th>Address</th><th>Host</th><th>Key</th><th /></tr></thead>
            <tbody>
              {catalog.known_hosts.map((k) => (
                <tr key={k.addr}>
                  <td className="mono primary">{k.addr}</td>
                  <td className="mono">{k.host || '—'}</td>
                  <td className="mono trunc" style={{ fontSize: 'var(--fs-xs)', maxWidth: 260 }} title={k.fingerprint}>{k.key_type} {k.fingerprint}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-sm" onClick={() => onConfirm({
                    title: `Forget the key of ${k.addr}?`,
                    body: 'The next connection asks you to verify the server again.',
                    action: 'Forget',
                    run: async () => { await api.knownHostRm(k.addr); await refreshCatalog(); },
                  })}>Forget</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Row>
      <Row title="Master password" desc="Changing it is coming in a later version (flint vault passwd).">
        <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>—</span>
      </Row>
    </>
  );
}
