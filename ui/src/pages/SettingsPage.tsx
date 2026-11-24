// Settings (design screens 12a–12d): per-machine appearance and terminal settings
// (saved at once), the keyboard map (read-only; customising it is on the roadmap),
// the open vault, and on macOS what a Mac keyboard's modifiers send in an RDP tab
// (milestone 31, D-074; no design screen, built from these sections' parts).

import { useEffect, useState } from 'react';
import { api } from '../api/backend';
import { PASTE_LIMITS, TOAST_CORNERS, type CliLinkSpot, type CliLinkStatus, type LockAfter, type Settings, type ToastCorner, type VaultStatus } from '../api/types';
import { CLI_TOAST_KEY, cliActionLabel, cliSpotAction, cliSpotText, winPath } from '../lib/cliLink';
import { installCli, shortPath, useApp, vaultInitial, vaultMarkClass } from '../state/app';
import { ACTION_TITLES, chordLabel, SHORTCUT_GROUPS } from '../lib/keymap';
import { Icon, type IconName } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { Picker } from '../ui/Picker';
import type { Confirm } from './KeysPage';
import { RenameVault } from '../shell/VaultSwitcher';
import { ChangeMasterPassword } from './ChangeMasterPassword';
import { paletteVars, TERM_THEMES, themePalette } from '../lib/terminalThemes';
import { MAC_MOD_KEYS, MOD_TARGETS, modMapOf, modMapText, type MacModKey, type ModTarget } from '../lib/rdpInput';
import { NotificationsSettings } from './NotificationsSettings';
import { AccessSettings } from '../access/AccessSettings';
import { GRAPHICS_MODES } from '../lib/rdpStats';
import { useSync } from '../sync/SyncProvider';
import { ConnectServerModal } from '../sync/ConnectServerModal';
import { ReplaceTokenModal } from '../sync/ReplaceTokenModal';
import { agoLabel, SYNC_LABEL } from '../lib/sync';
import { useUpdate, useUpdateOnScreen } from '../update/UpdateProvider';
import { updateActionLabel, updateAvailable, updateDownloadFailure, updateDownloading, updateHowText, updatePercent, updateReady, updateReadyHint, updateRelaunchFailure, updateStateLine } from '../lib/update';
import { plainText } from '../ui/plainText';
import { t } from '../i18n';
import { tr } from '../i18n/react';

export type SettingsSection = 'appearance' | 'terminal' | 'remote' | 'shortcuts' | 'vault' | 'access' | 'notifications' | 'about';

const SECTIONS: { id: SettingsSection; label: string; icon: IconName }[] = [
  { id: 'appearance', label: 'settings_page.section.appearance', icon: 'palette' },
  { id: 'terminal', label: 'settings_page.section.terminal', icon: 'term' },
  { id: 'remote', label: 'settings_page.section.remote', icon: 'rdp' },
  { id: 'shortcuts', label: 'settings_page.section.shortcuts', icon: 'keyboard' },
  { id: 'vault', label: 'settings_page.section.vault', icon: 'lock' },
  { id: 'access', label: 'settings_page.section.access', icon: 'shield-key' },
  // Milestone 63 (27a): the approval wait and phone alerts.
  { id: 'notifications', label: 'settings_page.section.notifications', icon: 'bell' },
  { id: 'about', label: 'settings_page.section.about', icon: 'info' },
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
    <section className="main page" aria-label={t('settings_page.settings')} style={{ flexDirection: 'row' }}>
      <nav className="settings-nav" aria-label={t('settings_page.settings_sections')}>
        <span className="label" style={{ padding: '0 var(--sp-2) var(--sp-2)' }}>{t('settings_page.settings')}</span>
        {sections.map((s) => (
          <button key={s.id} className={'nav-i' + (section === s.id ? ' on' : '')} aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
            <Icon name={s.icon} size="sm" />{t(s.label)}
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
          {section === 'notifications' && <NotificationsSettings />}
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

const CORNER_LABEL: Record<ToastCorner, string> = {
  'bottom-right': 'settings_page.corner.bottom_right', 'bottom-left': 'settings_page.corner.bottom_left', 'top-right': 'settings_page.corner.top_right', 'top-left': 'settings_page.corner.top_left',
};
const CORNER_CLASS: Record<ToastCorner, string> = { 'bottom-right': 'br', 'bottom-left': 'bl', 'top-right': 'tr', 'top-left': 'tl' };

function Appearance() {
  const [s, set] = useSetting();
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', paddingBottom: 'var(--sp-2)' }}>{t('settings_page.appearance')}</h1>
      <Row title={t('settings_page.theme')} desc={t('settings_page.both_themes_come_from_the')}>
        <div className="row" role="radiogroup" aria-label={t('settings_page.theme')} style={{ gap: 'var(--sp-4)' }}>
          <ThemeCard value="dark" label={t('settings_page.dark')} current={s.theme} onPick={() => set({ theme: 'dark' })} />
          <ThemeCard value="light" label={t('settings_page.light')} current={s.theme} onPick={() => set({ theme: 'light' })} />
          <ThemeCard value="system" label={t('settings_page.match_system')} current={s.theme} onPick={() => set({ theme: 'system' })} />
        </div>
      </Row>
      <Row title={t('settings_page.accent')} desc={t('settings_page.focus_active_tab_primary_buttons')}>
        <div className="swatches" role="radiogroup" aria-label={t('settings_page.accent')}>
          {(['ember', 'sapphire', 'moss', 'iris'] as const).map((a) => (
            <button key={a} type="button" className={'sw c-' + a} role="radio" aria-checked={s.accent === a} aria-label={a} title={a} onClick={() => set({ accent: a })} />
          ))}
        </div>
      </Row>
      <Row title={t('settings_page.density')} desc={t('settings_page.row_height_in_the_host')}>
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <div className="seg" role="group" aria-label={t('settings_page.density')}>
            {(['compact', 'default', 'comfortable'] as const).map((d) => (
              <button key={d} type="button" aria-pressed={s.density === d} onClick={() => set({ density: d })}>{d[0].toUpperCase() + d.slice(1)}</button>
            ))}
          </div>
          <span className="hint">{t('settings_page.22_26_30_px_rows')}</span>
        </div>
      </Row>
      <Row title={t('settings_page.toasts')} desc={t('settings_page.where_toasts_appear')}>
        <div className="row" style={{ gap: 'var(--sp-4)' }}>
          <div className="cpick" role="radiogroup" aria-label={t('settings_page.toast_corner')}>
            <span className="cp-bar" /><span className="cp-rail" /><span className="cp-sb" />
            {TOAST_CORNERS.map((c) => (
              <button key={c} type="button" className={'cp-c ' + CORNER_CLASS[c] + (s.toast_corner === c ? ' on' : '')} role="radio"
                aria-checked={s.toast_corner === c} aria-label={t(CORNER_LABEL[c])} data-corner={c} onClick={() => set({ toast_corner: c })} />
            ))}
          </div>
          <div className="col" style={{ gap: 2, fontSize: 'var(--fs-sm)' }}>
            <span data-corner-label>{t(CORNER_LABEL[s.toast_corner])}{s.toast_corner === 'bottom-right' && <span className="faint">{' '}{t('settings_page.default')}</span>}</span>
            <span className="hint" style={{ maxWidth: 260, lineHeight: 1.45 }}>{t('settings_page.bottom_corners_sit_above_the')}</span>
          </div>
        </div>
      </Row>
      <Row title={t('settings_page.motion')} desc={t('settings_page.popovers_drawers_sidebar_collapse')}>
        <Toggle on={s.follow_motion} onChange={(v) => set({ follow_motion: v })} label={t('settings_page.follow_the_system_s_reduce')} />
      </Row>
      <Row title={t('settings_page.window')} desc={t('settings_page.applies_on_next_launch')}>
        <Toggle on={s.reopen_last_vault} onChange={(v) => set({ reopen_last_vault: v })} label={t('settings_page.reopen_the_last_vault_on')} />
      </Row>
    </>
  );
}

function Stepper({ value, onChange, min, max, step, format, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; format: (v: number) => string; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={t('settings_page.decrease', { label })} onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min}>−</button>
      <span aria-live="polite">{format(value)}</span>
      <button type="button" aria-label={t('settings_page.increase', { label })} onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max}>+</button>
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
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', paddingBottom: 'var(--sp-2)' }}>{t('settings_page.terminal')}</h1>
      <Row title={t('settings_page.colours')} desc={t('settings_page.the_terminal_s_palette_in', { p: dark ? 'dark' : 'light' })}>
        <div className="seg" role="radiogroup" aria-label={t('settings_page.terminal_colours')} style={{ flexWrap: 'wrap' }}>
          {TERM_THEMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={s.term_theme === t.id} aria-pressed={s.term_theme === t.id}
              onClick={() => set({ term_theme: t.id })} style={{ gap: 'var(--sp-2)' }}>
              <ThemeSwatch vars={paletteVars(dark ? t.dark : t.light)} />{t.label}
            </button>
          ))}
        </div>
      </Row>
      <Row title={t('settings_page.font')} desc={t('settings_page.monospaced_fonts_installed_on_this')}>
        <div style={{ maxWidth: 360 }}>
          <Picker label={t('settings_page.terminal_font')} value={s.term_font} onChange={(v) => set({ term_font: v })} placeholder={t('settings_page.jetbrains_mono')}
            options={[{ value: '', label: t('settings_page.jetbrains_mono'), text: t('settings_page.jetbrains_mono'), meta: 'bundled' },
              ...fonts.map((f) => ({ value: f, label: <span style={{ fontFamily: `"${f}"` }}>{f}</span>, text: f, meta: nerd(f) ? 'Nerd' : undefined }))]} />
        </div>
        <span className="hint">{tr('settings_page.length_installed_monospaced_fonts', { length: fonts.length })}</span>
      </Row>
      <Row title={t('settings_page.size')}>
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <Stepper label={t('settings_page.font_size')} value={s.term_font_size} min={8} max={32} step={1} format={(v) => v + ' px'} onChange={(v) => set({ term_font_size: v })} />
          <span className="hint">{tr('settings_page.kbd_kbd2_in_a_session', { kbd: <Kbd action="fontBigger" />, kbd2: <Kbd action="fontSmaller" />, kbd3: <Kbd action="fontReset" /> })}</span>
        </div>
      </Row>
      <Row title={t('settings_page.line_height')}>
        <Stepper label={t('settings_page.line_height_2')} value={s.term_line_height} min={100} max={200} step={5} format={(v) => (v / 100).toFixed(2)} onChange={(v) => set({ term_line_height: v })} />
      </Row>
      <Row title={t('settings_page.cursor')}>
        <div className="row" style={{ gap: 'var(--sp-4)' }}>
          <div className="seg" role="group" aria-label={t('settings_page.cursor_style')}>
            {(['block', 'bar', 'underline'] as const).map((c) => (
              <button key={c} type="button" aria-pressed={s.term_cursor === c} onClick={() => set({ term_cursor: c })}>{c[0].toUpperCase() + c.slice(1)}</button>
            ))}
          </div>
          <Toggle on={s.term_cursor_blink} onChange={(v) => set({ term_cursor_blink: v })} label={t('settings_page.blink')} />
        </div>
      </Row>
      <Row title={t('settings_page.largest_file_to_paste')} desc={t('settings_page.an_image_pasted_into_a')}>
        <div className="seg" role="radiogroup" aria-label={t('settings_page.largest_file_to_paste')}>
          {PASTE_LIMITS.map((mb) => (
            <button key={mb} type="button" role="radio" aria-checked={s.paste_limit_mb === mb} aria-pressed={s.paste_limit_mb === mb} onClick={() => set({ paste_limit_mb: mb })}>{mb} MB</button>
          ))}
        </div>
      </Row>
      <Row title={t('settings_page.server_resources')} desc={t('settings_page.cpu_memory_network_disk_and')}>
        <label className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start', cursor: 'pointer' }}>
          <button type="button" className="toggle" role="switch" aria-checked={s.server_stats} aria-label={t('settings_page.show_server_resources')} data-setting="server_stats" onClick={() => set({ server_stats: !s.server_stats })} />
          <span className="col" style={{ gap: 3 }}>
            <span>{t('settings_page.show_server_resources')}</span>
            <span className="hint" style={{ lineHeight: 1.45, maxWidth: 440 }}>{t('settings_page.reads_cpu_memory_and_network')}</span>
          </span>
        </label>
        <label className="check" style={{ marginLeft: 46 }}>
          <input type="checkbox" checked={s.server_stats_colour} disabled={!s.server_stats} data-setting="server_stats_colour" onChange={(e) => set({ server_stats_colour: e.target.checked })} />
          <span style={{ fontSize: 'var(--fs-sm)' }}>{t('settings_page.colour_values_by_load')}</span>
        </label>
      </Row>
      <Row title={t('settings_page.preview')} desc={t('settings_page.uses_the_chosen_colours_and')}>
        <div className="term" data-i18n-skip style={{ ...themeVars, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontFamily: family, fontSize: s.term_font_size, lineHeight: s.term_line_height / 100 }}>
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
  ControlLeft: 'settings_page.mod_key.controlleft', ControlRight: 'settings_page.mod_key.controlright', AltLeft: 'settings_page.mod_key.altleft',
  AltRight: 'settings_page.mod_key.altright', MetaLeft: 'settings_page.mod_key.metaleft', MetaRight: 'settings_page.mod_key.metaright',
};
const MOD_TARGET_LABELS: Record<ModTarget, string> = { ctrl: 'settings_page.mod_target.ctrl', alt: 'settings_page.mod_target.alt', altgr: 'settings_page.mod_target.altgr', win: 'settings_page.mod_target.win', off: 'settings_page.mod_target.off' };

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
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', marginBottom: 'var(--sp-3)' }}>{t('settings_page.about')}</h1>
      <Row title={t('settings_page.version')} desc={t('settings_page.the_version_this_build_of')}>
        <span className="mono strong" data-about-version>Flint {info?.version ?? ''}</span>
        <span className="hint">{t('settings_page.a_version_with_a_suffix')}<span className="mono">{t('settings_page.0_1_0_3_gabc1234')}</span>{t('settings_page.is_a_build_made_between')}</span>
      </Row>
      <Updates />
      <CommandLine />
      <Row title={t('settings_page.libraries')} desc={t('settings_page.linked_into_this_build')}>
        <table className="table compact" data-about-libs>
          <tbody>
            {libs.map(([name, v]) => <tr key={name}><td>{name}</td><td className="mono">{v || '—'}</td></tr>)}
          </tbody>
        </table>
      </Row>
    </>
  );
}

// Milestone 52 (design 24e, D-116): the update's state, its one action, Check now, the
// automatic check and What's new. Milestone 53 (24e3, 24e4, 24e6, D-111): Download
// here, its progress with a bar, Ready with Verified and Relaunch, and why a download
// was discarded.
function Updates() {
  const up = useUpdate();
  useUpdateOnScreen();
  const [settings, save] = useSetting();
  const st = up.status;
  const downloading = updateDownloading(st);
  const ready = updateReady(st);
  const avail = updateAvailable(st) || downloading || ready;
  const how = updateAvailable(st) && st.action === 'how' ? updateHowText(st) : '';
  const pct = downloading ? updatePercent(up.received, st!.asset_size) : 0;
  const failed = updateAvailable(st) && st.code ? updateDownloadFailure(st) : null;
  return (
    <Row title={t('settings_page.updates')} desc={t('settings_page.the_app_and_the_flint')}>
      <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }} data-about-update={st?.state ?? 'idle'}>
        {avail && <span className="t-mark" style={{ background: 'var(--accent)' }} />}
        <span className={avail ? 'strong' : ''}>{ready ? t('settings_page.flint_version_is_ready', { version: st!.version }) : updateStateLine(st, up.now) || t('settings_page.not_checked_yet')}</span>
        {ready && <span className="badge ok" data-about-verified>{t('settings_page.verified')}</span>}
        {downloading && <span className="muted mono" data-about-progress={pct}>{pct}%</span>}
        <span className="grow" />
        {updateAvailable(st) && st.action === 'download' && <button className="btn btn-primary btn-sm" data-about-download onClick={() => up.act()}>{updateActionLabel(st)}</button>}
        {ready && <button className="btn btn-primary btn-sm" data-about-relaunch onClick={() => up.act()}>{t('settings_page.relaunch')}</button>}
        {!avail && (
          <button className="btn btn-secondary btn-sm" data-about-check disabled={up.status?.state === 'checking'} onClick={() => up.checkNow()}>
            {up.status?.state === 'checking' ? t('settings_page.checking') : t('settings_page.check_now')}
          </button>
        )}
      </div>
      {downloading && (
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('settings_page.downloading_flint_version', { version: st!.version })}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {ready && <span className="hint" data-about-ready-hint>{updateReadyHint(st!)}</span>}
      {ready && st!.code && <span className="hint danger-t" data-about-relaunch-failed={st!.code}>{updateRelaunchFailure(st!).text}</span>}
      {failed && <span className="hint danger-t" data-about-failed={st?.code}>{failed.retry ? failed.text : t('settings_page.the_download_of_version_didn', { version: st!.version })}</span>}
      {how && (
        <span className="hint" data-about-how={st?.how}>
          {how}{' '}
          <button className="link" onClick={() => { api.openUrl(st!.page).catch(() => {}); }}>{t('settings_page.open_the_release_page')}</button>
        </span>
      )}
      {how && st?.command && <UpdateCommand command={st.command} />}
      {st?.state === 'error' && st.message && <span className="hint">{st.message}</span>}
      <Toggle on={settings.update_check} onChange={(v) => save({ update_check: v })} label={t('settings_page.check_for_updates_automatically')} />
      <span className="hint">{t('settings_page.fetches_a_small_signed_file')}</span>
      <button className="link" style={{ alignSelf: 'flex-start' }} data-about-whats-new onClick={() => up.showWhatsNew()}>{t('settings_page.what_s_new_in')}{' '}{st?.current || ''}</button>
    </Row>
  );
}

// Milestone 54 (D-124 (6)): How to update for a package from a repository, the
// system updater's command with Copy.
function UpdateCommand({ command }: { command: string }) {
  const { notify } = useApp();
  return (
    <div className="row" style={{ gap: 'var(--sp-2)' }} data-about-update-command>
      <code className="mono">{command}</code>
      <button className="btn btn-secondary btn-sm" onClick={() => {
        navigator.clipboard?.writeText(command).then(() => notify({ text: t('settings_page.command_copied'), key: 'copied:update-command' })).catch(() => {});
      }}>{t('common.copy')}</button>
    </div>
  );
}

// Milestone 48 (D-111 (2)): the flint command from this copy, linked from a folder on
// the PATH, so updating Flint updates it. Never linked without the person's click.
function CommandLine() {
  const { notify, fail } = useApp();
  const [st, setSt] = useState<CliLinkStatus | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { api.cliStatus(false).then(setSt).catch(() => {}); }, []);
  if (!st) return null;
  const act = async (spot: CliLinkSpot) => {
    setBusy(spot.path);
    try {
      if (cliSpotAction(spot) === 'remove') {
        setSt(await api.cliRemove(spot.path));
        notify({ text: st.kind === 'path' ? t('settings_page.removed_winpath_from_your_path', { winPath: winPath(spot.path) }) : t('settings_page.removed_shortpath', { shortPath: shortPath(spot.path) }), key: CLI_TOAST_KEY });
      } else {
        const next = await installCli(spot.path, notify, fail, st.kind);
        if (next) setSt(next);
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy('');
    }
  };
  return (
    <Row title={t('settings_page.command_line')} desc={st.kind === 'path'
      ? t('settings_page.the_flint_command_runs_from')
      : t('settings_page.the_flint_command_runs_this')}>
      {!st.available
        ? <span className="hint" data-cli-none>{tr('settings_page.no_flint_command', { script: <span className="mono">scripts/install.sh</span> })}</span>
        : (
          <table className="table compact" data-cli-spots>
            <tbody>
              {st.spots.map((spot) => {
                const a = cliSpotAction(spot);
                return (
                  <tr key={spot.path} data-cli-spot={spot.state}>
                    <td className="mono">{st.kind === 'path' ? winPath(spot.path) : shortPath(spot.path)}</td>
                    <td>{cliSpotText(spot, st.kind)}</td>
                    <td>{a && (
                      <button className="btn btn-ghost btn-sm" disabled={busy !== ''} data-cli-action={a} onClick={() => act(spot)}>
                        {cliActionLabel(a, st.kind)}
                      </button>
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </Row>
  );
}

function RemoteDesktopSettings({ mac }: { mac: boolean }) {
  const [s, set] = useSetting();
  const map = modMapOf(s.rdp_mac_keys, s.rdp_mac_custom);
  const pick = (k: MacModKey, t: ModTarget) => set({ rdp_mac_keys: 'custom', rdp_mac_custom: modMapText({ ...map, [k]: t }) });
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', marginBottom: 'var(--sp-3)' }}>{t('settings_page.remote_desktop')}</h1>
      <Row title={t('settings_page.graphics')} desc={t('settings_page.how_a_new_remote_desktop')}>
        <div className="seg" role="radiogroup" aria-label={t('settings_page.remote_desktop_graphics')} data-rdp-graphics>
          {GRAPHICS_MODES.map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={s.rdp_graphics === g.id} aria-pressed={s.rdp_graphics === g.id} data-graphics={g.id}
              onClick={() => set({ rdp_graphics: g.id })}>
              {g.label}
            </button>
          ))}
        </div>
        <span className="hint">
          {s.rdp_graphics === 'auto'
            ? <>{t('settings_page.chosen_when_the_tab_connects')}</>
            : s.rdp_graphics === 'pipeline'
              ? <>{t('settings_page.always_the_graphics_pipeline_with')}</>
              : <>{t('settings_page.always_the_classic_bitmap_updates')}</>}
        </span>
      </Row>
      {mac && <>
      <Row title={t('settings_page.modifier_keys')} desc={t('settings_page.what_this_mac_s_modifier')}>
        <div className="seg" role="radiogroup" aria-label={t('settings_page.modifier_keys_preset')} data-rdp-keys-preset>
          {(['mac', 'windows', 'custom'] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={s.rdp_mac_keys === p} aria-pressed={s.rdp_mac_keys === p} data-preset={p}
              onClick={() => set(p === 'custom' ? { rdp_mac_keys: 'custom', rdp_mac_custom: modMapText(map) } : { rdp_mac_keys: p })}>
              {p === 'mac' ? t('settings_page.mac') : p === 'windows' ? 'Windows' : t('settings_page.custom')}
            </button>
          ))}
        </div>
        <span className="hint">
          {s.rdp_mac_keys === 'mac' && <>{tr('settings_page.span_and_span2_copy_and', { span: <span className="kbd">⌘C</span>, span2: <span className="kbd">⌘V</span>, span3: <span className="kbd">⌃</span> })}</>}
          {s.rdp_mac_keys === 'windows' && <>{tr('settings_page.keys_where_a_pc_keyboard', { span: <span className="kbd">⌃C</span>, span2: <span className="kbd">⌃V</span>, span3: <span className="kbd">⌥</span> })}</>}
          {s.rdp_mac_keys === 'custom' && <>{t('settings_page.each_key_as_set_below')}</>}
        </span>
      </Row>
      <Row title={t('settings_page.each_key')} desc={t('settings_page.left_and_right_keys_apart')}>
        <table className="table compact" data-rdp-keys-table>
          <tbody>
            {MAC_MOD_KEYS.map((k) => (
              <tr key={k}>
                <td className="primary" style={{ whiteSpace: 'nowrap' }}>{t(MOD_KEY_LABELS[k])}</td>
                <td>
                  <div className="seg" role="radiogroup" aria-label={t('settings_page.mod_key_sends', { key: t(MOD_KEY_LABELS[k]) })} data-mod-key={k}>
                    {MOD_TARGETS.map((tg) => (
                      <button key={tg} type="button" role="radio" aria-checked={map[k] === tg} aria-pressed={map[k] === tg} data-target={tg} onClick={() => pick(k, tg)}>{t(MOD_TARGET_LABELS[tg])}</button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Row>
      <div className="callout info"><Icon name="keyboard" size="sm" className="info-t" /><span>{tr('settings_page.rdp_mac_note', { cmd: <span className="mono strong">⌘</span>, digits: <><span className="mono strong">⌘1</span>–<span className="mono strong">⌘9</span></>, tab: <span className="mono strong">⌘Tab</span>, space: <span className="mono strong">⌘Space</span> })}</span></div>
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
        <h1 className="grow" style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)' }}>{t('settings_page.keyboard_shortcuts')}</h1>
        <label className="search" style={{ width: 220 }}><Icon name="search" size="sm" /><input {...plainText} aria-label={t('settings_page.filter_shortcuts')} placeholder={t('settings_page.filter_actions_or_keys')} value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="callout info"><Icon name="keyboard" size="sm" className="info-t" /><span>{tr('settings_page.linux_keys_note', { cmd: <span className="mono strong">⌘</span>, ctrlShift: <span className="mono strong">Ctrl+Shift</span>, shiftCmd: <span className="mono strong">⇧⌘</span>, ctrlAltShift: <span className="mono strong">Ctrl+Alt+Shift</span> })}</span></div>
      <table className="table compact">
        <thead><tr><th>{t('settings_page.action')}</th><th>macOS</th><th>{t('settings_page.linux_windows')}</th></tr></thead>
        <tbody>
          {SHORTCUT_GROUPS.flatMap((g) => g.actions).filter((a) => match(ACTION_TITLES[a] + chordLabel(a, 'mac') + chordLabel(a, 'linux'))).map((a) => (
            <tr key={a}>
              <td className="primary">{a === 'tab9' ? t('settings_page.go_to_tab_9') : ACTION_TITLES[a]}</td>
              <td><span className="kbd">{chordLabel(a, 'mac')}</span></td>
              <td><span className="kbd">{chordLabel(a, 'linux')}</span></td>
            </tr>
          ))}
          {match('copy paste') && <tr><td className="primary">{t('settings_page.copy_paste_in_the_terminal')}</td><td><span className="kbd-group"><span className="kbd">⌘C</span><span className="kbd">⌘V</span></span></td><td><span className="kbd-group"><span className="kbd">Ctrl+Shift+C</span><span className="kbd">Ctrl+Shift+V</span></span></td></tr>}
          {match('copy paste windows insert') && <tr><td className="primary">{t('settings_page.also_on_windows_copy_paste')}</td><td>—</td><td><span className="kbd-group"><span className="kbd">Ctrl+C</span><span className="kbd">{t('settings_page.ctrl_insert')}</span></span> · <span className="kbd-group"><span className="kbd">Ctrl+V</span><span className="kbd">{t('settings_page.shift_insert')}</span></span><br /><span className="muted">{t('settings_page.ctrl_c_copies_only_while')}</span></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const LOCK_AFTER: { value: LockAfter; label: string }[] = [
  { value: '1m', label: 'settings_page.lock_after_choice.1m' },
  { value: '5m', label: 'settings_page.lock_after_choice.5m' },
  { value: '15m', label: 'settings_page.lock_after_choice.15m' },
  { value: '30m', label: 'settings_page.lock_after_choice.30m' },
  { value: '1h', label: 'settings_page.lock_after_choice.1h' },
  { value: '4h', label: 'settings_page.lock_after_choice.4h' },
  { value: 'never', label: 'settings_page.lock_after_choice.never' },
];

// Auto-lock (D-042): idle time here; the screen locking and sleep always lock.
function LockAfterRow() {
  const [s, set] = useSetting();
  return (
    <Row title={t('settings_page.lock_after')} desc={t('settings_page.with_nobody_using_flint_or')}>
      <div className="row">
        <div className="seg" role="radiogroup" aria-label={t('settings_page.lock_after')}>
          {LOCK_AFTER.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={s.lock_after === o.value} aria-pressed={s.lock_after === o.value} onClick={() => set({ lock_after: o.value })}>{t(o.label)}</button>
          ))}
        </div>
      </div>
    </Row>
  );
}


const CHECK_EVERY: { value: number; label: string }[] = [
  { value: 0, label: 'settings_page.check_every.0' },
  { value: 60, label: 'settings_page.check_every.60' },
  { value: 300, label: 'settings_page.check_every.300' },
  { value: 900, label: 'settings_page.check_every.900' },
];

// Settings → Vault → Server (milestone 44, designs 23b1, 23b3): the vault's server,
// its state, how often to check, the token and Disconnect.
function ServerRow({ onConfirm, onChangePassword }: { onConfirm: (c: Confirm) => void; onChangePassword: () => void }) {
  const { notify } = useApp();
  const sync = useSync();
  const [s, set] = useSetting();
  const [connecting, setConnecting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = sync.status;
  const syncNow = async () => { setBusy(true); await sync.syncNow(); setBusy(false); };
  // Kept across the switch to Connected, so its outcome (Uploaded, Merged) stays up.
  const connectModal = connecting && <ConnectServerModal onClose={() => setConnecting(false)} onConnected={() => { sync.refresh().catch(() => {}); }}
    onChangePassword={() => { setConnecting(false); onChangePassword(); }} />;
  if (!st) {
    return (
      <Row title={t('settings_page.server')} desc={t('settings_page.keep_this_vault_in_step')}>
        <div className="row" style={{ gap: 'var(--sp-3)' }} data-server="off">
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('settings_page.not_connected')}</span>
          <span className="grow" />
          <button className="btn btn-secondary btn-sm" data-connect-server onClick={() => setConnecting(true)}><Icon name="server" size="sm" />{t('settings_page.connect_to_a_server')}</button>
        </div>
        {connectModal}
      </Row>
    );
  }
  const state = sync.state ?? 'in_step';
  const tone = state === 'merged' ? 'accent-t' : state === 'password' || state === 'attention' ? 'warn-t' : 'muted';
  return (
    <Row title={t('settings_page.server')} desc={t('settings_page.the_server_stores_the_encrypted')}>
      <div className="col grow" style={{ gap: 'var(--sp-3)', minWidth: 0 }} data-server="on">
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <span className="mono strong trunc" title={st.url}>{st.url}</span>
          <span className="grow" />
          <button className="btn btn-secondary btn-sm" data-sync-now onClick={() => syncNow().catch(() => {})} disabled={busy}><Icon name="reconnect" size="sm" />{busy ? t('settings_page.syncing') : t('settings_page.sync_now')}</button>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)' }} data-sync-state={state}>
          <Icon name={state === 'offline' ? 'cloud-off' : 'cloud'} size="sm" className={tone} />
          <span className={tone === 'muted' ? '' : tone}>{SYNC_LABEL[state]} · {agoLabel(st.last_sync, sync.now)}</span>
          <span className="faint mono" style={{ fontSize: 'var(--fs-xs)' }}>{tr('settings_page.version_p', { p: st.version.toLocaleString('en-US') })}</span>
          {state === 'password' && <button className="btn btn-ghost btn-sm" onClick={sync.askPassword}>{t('settings_page.type_the_new_password')}</button>}
        </div>
        {(state === 'attention' || state === 'offline') && sync.lastError && <span className="hint">{sync.lastError.replace(/^[a-z_]+: /, '')}</span>}
        <div className="row" style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
          <span style={{ whiteSpace: 'nowrap' }}>{t('settings_page.check_every')}</span>
          <div className="seg" role="radiogroup" aria-label={t('settings_page.check_every')}>
            {CHECK_EVERY.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={s.sync_interval === o.value} aria-pressed={s.sync_interval === o.value} onClick={() => set({ sync_interval: o.value })}>{t(o.label)}</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
          <span>{t('settings_page.token')}</span>
          <span className="badge ok"><Icon name="check" size="xs" />{t('settings_page.saved_in_the_keychain')}</span>
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" data-replace-token onClick={() => setReplacing(true)}>{t('settings_page.replace_token')}</button>
          <button className="btn btn-ghost btn-sm" data-disconnect-server onClick={() => onConfirm({
            title: t('settings_page.disconnect_this_vault_from_its'),
            body: 'This machine stops syncing it. The local copy stays as it is and keeps working, the server keeps its copy, and nothing is deleted.',
            action: 'Disconnect',
            run: async () => { await api.remoteDisconnect(); notify(t('settings_page.this_machine_no_longer_syncs')); await sync.refresh(); },
          })}>{t('settings_page.disconnect')}</button>
        </div>
      </div>
      {connectModal}
      {replacing && <ReplaceTokenModal url={st.url} onClose={() => setReplacing(false)} onReplaced={() => { sync.syncNow().catch(() => {}); }} />}
    </Row>
  );
}


function VaultSettings({ onLock, onConfirm }: { onLock: () => void; onConfirm: (c: Confirm) => void }) {
  const { vault, catalog, os, refreshCatalog, notify, closeVault } = useApp();
  const [st, setSt] = useState<VaultStatus | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(0);
  // Sessions record trusted keys on their worker, and the CLI can change the file:
  // read the catalog again when the page opens, or Known hosts shows a stale list.
  useEffect(() => { refreshCatalog().catch(() => {}); }, [refreshCatalog]);
  useEffect(() => { api.status().then(setSt).catch(() => {}); }, [catalog, changed]);
  if (!vault) return null;
  const keychain = os === 'mac' ? 'macOS Keychain' : os === 'windows' ? 'Windows Credential Manager' : 'the Secret Service keyring';
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', paddingBottom: 'var(--sp-3)' }}>{t('settings_page.vault')}</h1>
      <div className="panel row" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-4)' }}>
        <span className={'vault-mark lg ' + vaultMarkClass(vault.path)}>{vaultInitial(vault.name)}</span>
        <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
          <span className="strong" style={{ fontSize: 'var(--fs-lg)' }}>{vault.name}</span>
          <span className="mono muted trunc" style={{ fontSize: 'var(--fs-sm)' }} title={vault.path}>{shortPath(vault.path)}</span>
          {st && <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{[t('settings_page.n_hosts', { count: st.hosts }), t('settings_page.n_keys', { count: st.keys }), t('settings_page.n_credentials', { count: st.credentials }), t('settings_page.n_groups', { count: st.groups }), t('settings_page.format_v', { format: vault.format })].join(' · ')}</span>}
        </div>
      </div>
      <Row title={t('settings_page.name')} desc={t('settings_page.shown_in_the_vault_switcher')}>
        {renaming
          ? <RenameVault onDone={() => setRenaming(false)} />
          : <div className="row"><button className="btn btn-secondary btn-sm" onClick={() => setRenaming(true)}>{t('settings_page.rename')}</button></div>}
      </Row>
      <Row title={t('settings_page.on_this_device')} desc={st?.cached ? t('settings_page.the_vault_key_is_in', { keychain }) : t('settings_page.this_machine_asks_for_the')}>
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <span className={'badge ' + (st?.cached ? 'ok' : '')}>{st?.cached ? t('settings_page.remembered') : t('settings_page.not_remembered')}</span>
          {st?.cached && <button className="btn btn-secondary btn-sm" onClick={() => onConfirm({
            title: t('settings_page.forget_the_key_on_this'),
            body: 'Every session closes, and opening this vault will ask for its master password.',
            action: 'Forget key',
            run: async () => { await api.forgetKey(vault.path); notify(t('settings_page.this_machine_no_longer_remembers')); await closeVault(); },
          })}>{t('settings_page.forget_on_this_device')}</button>}
        </div>
      </Row>
      <ServerRow onConfirm={onConfirm} onChangePassword={() => setChanging(true)} />
      <Row title={t('common.lock')} desc={t('settings_page.clears_the_vault_key_from')}>
        <div><button className="btn btn-secondary" onClick={onLock}>{tr('settings_page.iconlock_nowkbd', { icon: <Icon name="lock" size="sm" />, kbd: <Kbd action="lock" /> })}</button></div>
      </Row>
      <LockAfterRow />
      <Row title={t('settings_page.known_hosts')} desc={t('settings_page.server_keys_this_vault_trusts')}>
        {catalog.known_hosts.length === 0 ? <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>{t('settings_page.none_yet_a_server_s')}</span> : (
          <table className="table compact">
            <thead><tr><th>{t('settings_page.address')}</th><th>{t('settings_page.host')}</th><th>{t('settings_page.key')}</th><th /></tr></thead>
            <tbody>
              {catalog.known_hosts.map((k) => (
                <tr key={k.addr}>
                  <td className="mono primary">{k.addr}</td>
                  <td className="mono">{k.host || '—'}</td>
                  <td className="mono trunc" style={{ fontSize: 'var(--fs-xs)', maxWidth: 260 }} title={k.fingerprint}>{k.key_type} {k.fingerprint}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-sm" onClick={() => onConfirm({
                    title: t('settings_page.forget_the_key_of_addr', { addr: k.addr }),
                    body: 'The next connection asks you to verify the server again.',
                    action: 'Forget',
                    run: async () => { await api.knownHostRm(k.addr); await refreshCatalog(); },
                  })}>{t('settings_page.forget')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Row>
      <Row title={t('settings_page.master_password')} desc={t('settings_page.opens_the_vault_and_seals')}>
        <div className="row"><button className="btn btn-secondary btn-sm" onClick={() => setChanging(true)}>{t('settings_page.change_master_password')}</button></div>
      </Row>
      {changing && <ChangeMasterPassword onClose={() => { setChanging(false); setChanged((n) => n + 1); }} />}
    </>
  );
}
