// Headless end-to-end run of the desktop app, driven through its real UI.
// scripts/gui-e2e.sh fills in the @@…@@ values and runs the app with FLINT_GUI_E2E;
// the app loads this file once the page has started (ui/src/App.tsx).
(async () => {
  const VAULT = '@@VAULT@@';
  const PORT = '@@PORT@@';
  const PORT2 = '@@PORT2@@';
  const PORT3 = '@@PORT3@@';
  // A free port on 127.0.0.1 for the tunnels step (milestone 23).
  const TPORT = '@@TPORT@@';
  // FreeRDP's sample server (milestone 30), and a forwarder whose first two
  // connections reach it and every later one a second sample server with another
  // certificate: one address, a changed certificate.
  const RPORT = '@@RPORT@@';
  const RPORT_FWD = '@@RPORT_FWD@@';
  // Flint's own RDP test server (milestone 31): the clipboard, the keys it received
  // and a dropped connection, driven over its control port. '0' when it is not running.
  const CPORT = '@@CPORT@@';
  // The version the build was made from (scripts/version.sh, milestone 32).
  const VERSION = '@@VERSION@@';
  const CCTL = '@@CCTL@@';
  const USER = '@@USER@@';
  const KEY = `@@KEY@@`;
  // gui-e2e.sh runs the app once per run, each on a fresh vault and config folder:
  // every run creates the vault and connects to `local`, then does only its own steps.
  // A failure names its run, and one run can be repeated alone (scripts/repeat.sh).
  //   terminal  the shell, files, a jump host, tabs, copy between servers, split panes,
  //             a changed host key
  //   vault     test connection, initial command, palette, settings, known hosts,
  //             sidebar and groups, rename, lock, the tray
  //   tunnels   tunnels in the app (milestone 23)
  //   paste     an image pasted into the terminal lands on the server (milestone 25)
  //   vim       vim in the terminal
  //   rdp       an RDP host in a tab against FreeRDP's sample server (milestone 30);
  //             the clipboard, modifier keys and a dropped session against Flint's own
  //             test server (milestone 31)
  //   webgl     a terminal's lost WebGL context, alone and with a desktop behind it
  //             (milestone 35b): seconds a repetition with scripts/repeat.sh
  //   fullscreen  an immersive full-screen RDP tab (milestone 37): every way in and out,
  //             the bar, the note, the desktop's size, a lost connection
  //   multimon  a desktop across monitors (milestone 38): the extra window on a second
  //             monitor draws its part, its pointer and keys reach the server, the
  //             popover, a lost connection, leaving. Needs two monitors: Linux runs it
  //             under Xorg's dummy driver with two outputs, macOS on a person's screens
  //             with FLINT_E2E_MULTIMON=1
  //   rdpbench  milestone 34's benchmark against a real Windows host (scripts/rdp-bench.sh,
  //             never part of the default runs): harmless input only, the Start menu and
  //             Task view, in each graphics mode
  const RUN = '@@RUN@@';
  // webgl only: '1' when a person hides the window for the loss (FLINT_E2E_WEBGL_COVER).
  const COVER = '@@COVER@@';
  // fullscreen only: '1' when the window really goes full screen (FLINT_E2E_NATIVE_FS).
  const NATIVEFS = '@@NATIVEFS@@';
  const RUNS = ['terminal', 'vault', 'tunnels', 'paste', 'vim', 'rdp', 'webgl', 'fullscreen', 'multimon', 'rdpbench', 'clilink', 'update', 'selfupdate'];
  // The benchmark's host (rdpbench only; '' otherwise).
  const BHOST = '@@BHOST@@';
  const BUSER = '@@BUSER@@';
  const BPW = '@@BPW@@';
  const BMODES = '@@BMODES@@';
  // rdpbench, milestone 38: '' a 1920x1080 desktop in the window; '1' full screen on one
  // monitor; '2' full screen on all monitors (two), each extra window counted too.
  const BMONS = '@@BMONS@@';
  const MASTER = 'e2e-master-password-42';
  const HOST_PW_MARKER = 'gui-host-pw-marker';

  window.__flintE2E = { terms: {} };
  const log = (m) => window.backend.e2e_log({ name: String(m) });
  // The headless window is hidden, and WebKit throttles a hidden page's timers to
  // a crawl (CF-050). MessageChannel posts are not throttled, so waits spin on them.
  const sleep = (ms) => new Promise((resolve) => {
    const end = performance.now() + ms;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { if (performance.now() >= end) resolve(); else ch.port2.postMessage(0); };
    ch.port2.postMessage(0);
  });
  let step = 'start';
  const t0 = performance.now();
  const setStep = (s) => { step = s; return log('--   ' + s + ` (${Math.round((performance.now() - t0) / 1000)} s)`); };
  let passed = 0;

  async function waitFor(fn, what, ms = 20000) {
    const start = Date.now();
    for (;;) {
      let v;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - start > ms) throw new Error('timed out waiting for ' + what);
      await sleep(50);
    }
  }
  // waitFor for a condition that needs an RPC (an async function).
  async function waitForAsync(fn, what, ms = 20000) {
    const start = Date.now();
    for (;;) {
      let v;
      try { v = await fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - start > ms) throw new Error('timed out waiting for ' + what);
      await sleep(50);
    }
  }
  const text = () => document.body.innerText;
  const hasText = (t) => text().includes(t);
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
  const byText = (sel, t, root = document) => qa(sel, root).find((el) => el.textContent.includes(t));
  async function click(sel, t, root) {
    const el = await waitFor(() => (t === undefined ? q(sel, root) : byText(sel, t, root)), `${sel} "${t ?? ''}"`);
    el.click();
    await sleep(60);
    return el;
  }
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  async function fill(sel, value) {
    const el = await waitFor(() => q(sel), sel);
    setValue(el, value);
    await sleep(30);
  }
  async function pick(label, option) {
    await click(`button.select[aria-label="${label}"]`);
    await click('[role="listbox"] .mi', option);
  }
  // New host opens the type step first (milestone 29, design 21a): SSH, then Continue.
  async function newSshHost(sel, t) {
    await click(sel, t);
    await waitFor(() => q('[data-host-type-step]'), 'the type step');
    await click('.type-card[data-type="ssh"]');
    await click('.modal button', 'Continue');
    await waitFor(() => q('#ha'), 'the SSH host editor');
  }
  // Milestone 52 (24f): the status bar's version opens a popover; About Flint is in it.
  async function openAbout() {
    q('[data-sb-version]').click();
    const pop = await waitFor(() => q('[data-update-pop]'), "the version's popover");
    await click('.link', 'About Flint', pop);
  }
  function check(cond, what) {
    if (!cond) throw new Error('check failed: ' + what);
    passed++;
    return log('ok   ' + what);
  }
  // The active tab's focused pane (milestone 20: a tab holds up to four).
  const activeRegion = () => qa('.pane > div').find((d) => d.style.display !== 'none');
  const activePane = () => { const r = activeRegion(); return r?.querySelector('.spane.focus') ?? r?.querySelector('.spane') ?? r; };
  const activeTerm = () => {
    const tab = q('.tab.on');
    const region = activePane();
    const id = region?.querySelector('[data-tab]')?.getAttribute('data-tab');
    return tab && id ? window.__flintE2E.terms[id] : null;
  };
  const termText = () => {
    const t = activeTerm();
    if (!t) return '';
    const b = t.buffer.active;
    const lines = [];
    for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
    return lines.join('\n');
  };
  async function type(data) {
    const ta = await waitFor(() => activePane()?.querySelector('textarea'), 'terminal textarea');
    ta.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', data);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(50);
  }
  async function enter() {
    // A paste of "\r" is turned into Enter by xterm's bracketed-paste-free path.
    const t = activeTerm();
    const ta = activePane().querySelector('textarea');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    await sleep(50);
    return t;
  }
  async function runInTerminal(cmd, marker) {
    await type(cmd);
    await enter();
    await waitFor(() => termText().includes(marker), `"${marker}" in the terminal`, 20000);
  }
  const toolbarIs = (status) => !!q(`.toolbar .st[data-status="${status}"]`);

  try {
    if (!RUNS.includes(RUN)) throw new Error(`unknown run "${RUN}"`);
    await log('run: ' + RUN);
    // Windows (the VM): windows/front.py clicks the page's own title bar about two seconds
    // after the window shows, to give the page the keyboard focus (W-16). Nothing starts
    // before that click: landing on a dialog's backdrop, it closed the terminal run's
    // New host dialog (2026-11-19).
    if ((await window.backend.app_info({})).os === 'windows') {
      await waitFor(() => document.hasFocus(), "the page's focus (windows/front.py's click)", 30000);
    }
    if (RUN === 'selfupdate') {
      // Milestone 53 (24c2, 24c3, 24c4b, D-111): the self-update from a copy laid out by
      // scripts/gui-e2e.sh, against a manifest of its own. This script sits inside the
      // installed package, so the app update-apply starts after the swap runs the new
      // package's copy of it. A first launch (the welcome screen) downloads; an app that
      // finds a vault already there was started by update-apply: the new one, or the old
      // one put back with why. scripts/gui-e2e.sh checks the folders on disk.
      await setStep('which launch');
      const first = await waitForAsync(async () => {
        if (hasText('Welcome to Flint')) return 'first';
        if (hasText('Unlock') || hasText('E2E Vault')) return 'relaunched';
        return null;
      }, 'the welcome or the unlock screen', 30000);
      const status = () => new Promise((resolve) => {
        const off = window.runtime.EventsOn('update:status', (st) => { off(); resolve(st); });
        window.backend.update_hint({ reason: 'status' });
      });
      const updToast = (text) => qa('[data-toast]').find((el) => !el.classList.contains('leaving') && (el.querySelector('.t-text')?.textContent || '').startsWith(text));
      if (first === 'relaunched') {
        // The page shows why the last update was not applied as soon as it hears it,
        // so look for the toast itself (the core then forgets the outcome, once shown).
        let back = null;
        const until = Date.now() + 8000;
        while (!back && Date.now() < until) { back = updToast('The new version did not start'); if (!back) await sleep(100); }
        const st = await status();
        if (back) {
          await setStep('rolled back');
          await check(true, `the old Flint says why (${back.querySelector('.t-text').textContent})`);
          await check(!st.outcome, 'the core says it once');
          await log('selfupdate: rolled back');
        } else {
          await setStep('the new Flint');
          await check(st.current === VERSION, `the relaunched Flint runs (${st.current})`);
          await log('selfupdate: relaunched into the new package');
        }
        await log(`${passed} checks passed`);
        await window.backend.e2e_report({ ok: true, detail: '' });
        window.runtime.Quit();
        return;
      }
      // A vault first, so the app started after Relaunch finds one (the unlock screen).
      await setStep('create vault');
      await click('button.panel', 'Create a new vault');
      await fill('#vn', 'E2E Vault');
      await fill('input[aria-label="Vault file path"]', VAULT);
      await fill('#mp', MASTER);
      await fill('#mp2', MASTER);
      await click('button[type="submit"]', 'Create vault');
      await waitFor(() => hasText('Add your first host'), 'the empty vault page', 30000);
      await setStep('download');
      // The run's feed sends the package in slices over ~3 s (scripts/gui-e2e.sh): the
      // page must see it move, not only 0 % and then Ready.
      const heard = new Set();
      let mostReceived = 0;
      const percents = new Set();
      window.runtime.EventsOn('update:progress', (p) => { heard.add(p.received); mostReceived = Math.max(mostReceived, p.received); });
      const avail = await waitFor(() => updToast('Flint 99.0.0 is available'), 'the update toast', 30000);
      const dl = byText('button', 'Download', avail);
      await check(!!dl, 'the toast offers Download');
      dl.click();
      const watch = setInterval(() => { const pct = updToast('Downloading Flint 99.0.0')?.querySelector('.t-prog')?.textContent.match(/^(\d+)%$/); if (pct) percents.add(Number(pct[1])); }, 50);
      const outcome = await waitFor(() => updToast('Flint 99.0.0 is ready') || updToast("Flint 99.0.0 didn't pass verification"), 'the download to end', 60000);
      if ((outcome.querySelector('.t-text')?.textContent || '').includes("didn't pass verification")) {
        await setStep('discarded');
        await check(!byText('button', 'Retry', outcome), 'a download that fails verification offers no Retry (24c4b)');
        const st = await status();
        await check(st.state === 'available' && st.code === 'invalid', `the core discarded it (${st.state}, ${st.code})`);
        await log('selfupdate: discarded');
        await log(`${passed} checks passed`);
        await window.backend.e2e_report({ ok: true, detail: '' });
        window.runtime.Quit();
        return;
      }
      await setStep('ready');
      const rl = byText('button', 'Relaunch', outcome);
      await check(!!rl && rl.classList.contains('btn-primary'), 'the Ready toast offers Relaunch, in the accent colour (24c3)');
      const st = await status();
      await check(st.state === 'ready' && st.version === '99.0.0', 'the core says it is ready');
      clearInterval(watch);
      await waitFor(() => mostReceived === st.asset_size, `the page to hear the whole download (${mostReceived} of ${st.asset_size} bytes)`, 2000);
      const between = [...heard].filter((n) => n > 0 && n < st.asset_size).length;
      await check(between >= 3, `the page heard the download move (${between} counts between 0 and ${st.asset_size})`);
      const shown = [...percents].filter((n) => n > 0 && n < 100);
      await check(shown.length >= 2, `the toast's percentage moved (${[...percents].sort((a, b) => a - b).join(', ')} %)`);
      await log(`${passed} checks passed`);
      await log('selfupdate: relaunching');
      // Nothing is open, so Relaunch goes straight through (24d1 is for open work): the
      // app quits here and update-apply takes over.
      rl.click();
      return;
    }

    await setStep('welcome');
    await waitFor(() => hasText('Welcome to Flint'), 'the welcome screen');
    await check(true, 'a first launch shows the welcome screen');

    await setStep('create vault');
    await click('button.panel', 'Create a new vault');
    await fill('#vn', 'E2E Vault');
    await fill('input[aria-label="Vault file path"]', VAULT);
    await fill('#mp', MASTER);
    await fill('#mp2', MASTER);
    await click('button[type="submit"]', 'Create vault');
    await waitFor(() => hasText('Add your first host'), 'the empty vault page', 30000);
    await check(q('.vault-name')?.textContent === 'E2E Vault', 'the new vault opens on the empty state');

    if (RUN === 'clilink' && (await window.backend.app_info({})).os === 'windows') {
      // Milestone 50 (D-121): the package's bin folder on the user's Path, here a
      // registry key of the run's own whose Path names a copy that was moved
      // (scripts/gui-e2e.sh, which then reads back what the app wrote).
      await setStep('the flint command on the PATH');
      const cliToast = (re) => qa('[data-toast]').find((el) => !el.classList.contains('leaving') && re.test(el.querySelector('.t-text')?.textContent ?? ''));
      const fix = await waitFor(() => cliToast(/^flint on your PATH runs a copy of Flint that was moved or deleted$/), 'the offer to fix the moved folder');
      await check(fix.dataset.kind === 'info', 'a Path naming a moved copy is offered a fix at launch');
      await click('[data-toast] button', 'Use this copy');
      await waitFor(() => cliToast(/^Added .*\\cli\\Flint\\bin to your PATH: open a new terminal and run flint$/), 'the added toast');
      await check(!cliToast(/moved or deleted/), 'the result replaces the offer in place');
      await openAbout();
      await waitFor(() => q('[data-cli-spots]'), "About's Command line row");
      const row = () => q('[data-cli-spots] tr');
      await check(qa('[data-cli-spots] tr').length === 1, 'Windows has one place: the bin folder');
      await check(row()?.dataset.cliSpot === 'installed' && row().cells[0].textContent.endsWith('\\cli\\Flint\\bin'), `About shows the folder on the PATH (${row()?.cells[0].textContent})`);
      row().querySelector('[data-cli-action="remove"]').click();
      await waitFor(() => row()?.dataset.cliSpot === 'missing', 'the folder taken off');
      await check(!!byText('button', 'Add to PATH', row()), 'Remove from PATH takes it off and offers Add to PATH');
      row().querySelector('[data-cli-action="install"]').click();
      await waitFor(() => row()?.dataset.cliSpot === 'installed', 'the folder on the PATH again');
      const st = await window.backend.cli_status({ first: false });
      await check(st.kind === 'path' && st.spots[0].path.endsWith('/cli/Flint/bin'), 'the status names this copy\'s bin folder');
      await log(`${passed} checks passed`);
      await window.backend.e2e_report({ ok: true, detail: '' });
      window.runtime.Quit();
      return;
    }

    if (RUN === 'clilink') {
      // Milestone 48 (D-111 (2)): the flint command from a packaged app. The run's own
      // ~/.local/bin holds a link to a copy that was moved (scripts/gui-e2e.sh).
      await setStep('the flint command');
      const cliToast = (re) => qa('[data-toast]').find((el) => !el.classList.contains('leaving') && re.test(el.querySelector('.t-text')?.textContent ?? ''));
      const fix = await waitFor(() => cliToast(/^The flint command in .*\.local\/bin\/flint runs a copy of Flint that was moved or deleted$/), 'the offer to fix the moved link');
      await check(fix.dataset.kind === 'info', 'a link to a moved copy is offered a fix at launch');
      await click('[data-toast] button', 'Use this copy');
      await waitFor(() => cliToast(/^Installed .*\.local\/bin\/flint/), 'the installed toast');
      await check(!cliToast(/runs a copy of Flint that was moved/), 'the result replaces the offer in place');
      await openAbout();
      await waitFor(() => q('[data-cli-spots]'), 'About\'s Command line row');
      const spot = (end) => qa('[data-cli-spots] tr').find((r) => r.cells[0].textContent.endsWith(end));
      await check(spot('.local/bin/flint')?.dataset.cliSpot === 'installed', 'About shows the link now runs this copy');
      await check(spot('/clisys/flint')?.cells[1].textContent.length > 0, `About names the other place (${spot('/clisys/flint')?.cells[1].textContent})`);
      await check((await window.backend.settings_get({})).cli_offer_shown === false, 'a fix is not the first-launch offer: that one is still to show');
      spot('.local/bin/flint').querySelector('[data-cli-action="remove"]').click();
      await waitFor(() => spot('.local/bin/flint')?.dataset.cliSpot === 'missing', 'the removed link');
      await check(true, 'Remove takes the link away');
      spot('.local/bin/flint').querySelector('[data-cli-action="install"]').click();
      await waitFor(() => spot('.local/bin/flint')?.dataset.cliSpot === 'installed', 'the link again');
      const st = await window.backend.cli_status({ first: false });
      await check(st.spots[1].target.endsWith('/cli/Flint.app/Contents/Helpers/flint'), 'Install links this copy\'s CLI');
      await log(`${passed} checks passed`);
      await window.backend.e2e_report({ ok: true, detail: '' });
      window.runtime.Quit();
      return;
    }

    if (RUN === 'update') {
      // Milestone 52 (designs 24c, 24e, 24f, 24g, 24i, D-116): a signed manifest of Flint
      // 99.0.0 on the run's own feed (scripts/gui-e2e.sh), checked at launch.
      await setStep("what's new after an update");
      // A build with no git (the Linux check's container) is 0.0.0-dev: older than the
      // 0.15.0 seen, so What's new rightly stays shut.
      const devBuild = VERSION.startsWith('0.0.0');
      if (devBuild) {
        await sleep(1500);
        await check(!q('[data-whats-new]'), "What's new stays shut for a build older than the version seen");
      } else {
        const wn = await waitFor(() => q('[data-whats-new]'), "What's new at the first unlock after an update", 30000);
        await check(wn.dataset.whatsNew.split(',').includes('0.16.0') && !wn.dataset.whatsNew.split(',').includes('0.15.0'), `What's new shows the versions since the last one run (${wn.dataset.whatsNew})`);
        await check(hasText('since your 0.15.0'), "What's new names the version the person had");
        await check((await window.backend.settings_get({})).last_seen_version === VERSION, 'this version is recorded as seen');
        await click('.modal.wn .btn-primary', 'Close');
        await waitFor(() => !q('[data-whats-new]'), "What's new closed");
      }

      await setStep('the update toast');
      const upToast = () => qa('[data-toast]').find((el) => !el.classList.contains('leaving') && el.querySelector('.t-text')?.textContent === 'Flint 99.0.0 is available');
      const toast = await waitFor(upToast, 'the update toast at launch', 30000);
      // Download where the manifest has this system's package (the Mac: always); How to
      // update where it has none (Linux on arm64, the Docker check).
      const bar = await waitFor(() => q('[data-sb-update]'), 'Update in the status bar');
      const action = bar.dataset.sbUpdate;
      const label = action === 'download' ? 'Download' : 'How to update';
      if ((await window.backend.app_info({})).os === 'mac') await check(action === 'download', 'a Mac with a package in the manifest gets Download');
      const dl = byText('button', label, toast);
      await check(!!dl && dl.classList.contains('btn-primary'), `the toast offers ${label}, in the accent colour (24c)`);
      await check(bar.textContent === 'Update', 'the status bar says Update beside the version (D-116)');
      await check(q('[data-sb-version]').classList.contains('has-dot'), 'the version item carries the dot (24f2)');
      await check((await window.backend.settings_get({})).update_toast_version === '99.0.0', 'the toast is recorded as shown for 99.0.0');
      toast.querySelector('[data-toast-close], .t-x').click();
      await waitFor(() => !upToast(), 'the toast closed');
      await check(!!q('[data-sb-update]'), 'closing the toast leaves Update in the status bar');

      await setStep('the popover and its action');
      q('[data-sb-version]').click();
      const pop = await waitFor(() => q('[data-update-pop="available"]'), "the version's popover");
      await check(pop.textContent.includes('Flint 99.0.0 is available') && pop.textContent.includes(`You have ${VERSION}`), 'the popover says what is available and what you have');
      await click('[data-pop-update-act]', label);
      await check(!q('[data-update-pop]'), `${label} closes the popover`);
      if (action === 'download') {
        // Milestone 53: Download downloads, here from the run's feed, which has no
        // package: the toast says so and offers Retry (24c4a), and nothing was kept.
        const failed = await waitFor(() => qa('[data-toast]').find((el) => !el.classList.contains('leaving') && (el.querySelector('.t-text')?.textContent || '').startsWith("Couldn't download Flint 99.0.0")), 'the download to fail against a feed with no package', 30000);
        await check(!!byText('button', 'Retry', failed), `a failed download offers Retry (${failed.querySelector('.t-text').textContent})`);
        await check(q('[data-sb-update]')?.dataset.sbUpdate === 'download', 'the status bar offers Download again');
      } else {
        await waitFor(() => q('[data-about-how]'), 'How to update opens About with what to do');
        await check(q('[data-about-how]').dataset.aboutHow.length > 0, `About says why (${q('[data-about-how]').dataset.aboutHow})`);
      }

      await setStep('About');
      await openAbout();
      const about = await waitFor(() => q('[data-about-update="available"]'), "About's Updates block");
      await check(about.textContent.includes('Flint 99.0.0 is available · released 1 Dec'), `About says it, with the release date (${about.textContent})`);
      await check(action !== 'download' || !!q('[data-about-download]'), 'About offers Download where there is a package');

      await setStep('check again: no second toast');
      let got = null;
      const off = window.runtime.EventsOn('update:status', (st) => { if (st.state !== 'checking') got = st; });
      await window.backend.update_hint({ reason: 'now' });
      await waitFor(() => got, 'the second check', 20000);
      off();
      await check(got.state === 'available' && !got.toast, 'a second check finds the same version and asks for no toast');
      await sleep(300);
      await check(!upToast(), 'the toast does not come back for the same version (D-116)');

      // D-119: no toast over a surface that already says it (the owner's check of 53: the
      // toast covered the popover after its Check now). The core's status for a version
      // not toasted yet goes in through webui's own event entry, so the step does not
      // hang on the feed's timing.
      await setStep('no toast over the popover or About');
      const fresh = (v) => window.__cfire_event_dispatch('update:status', { ...got, version: v, toast: true });
      const toastFor = (v) => qa('[data-toast]').find((el) => !el.classList.contains('leaving') && el.querySelector('.t-text')?.textContent === `Flint ${v} is available`);
      fresh('99.0.1');
      await sleep(400);
      await check(!toastFor('99.0.1'), "a new version found with About open: About says it, no toast");
      await click('.nav-i', 'Appearance');
      q('[data-sb-version]').click();
      await waitFor(() => q('[data-update-pop]'), "the version's popover");
      fresh('99.0.2');
      await sleep(400);
      await check(!toastFor('99.0.2'), 'a new version found with the popover open: no toast over it');
      await check(!!q('[data-sb-update]'), 'Update stays in the status bar');
      q('[data-sb-version]').click();
      await waitFor(() => !q('[data-update-pop]'), 'the popover closed');
      fresh('99.0.3');
      const shown = await waitFor(() => toastFor('99.0.3'), 'the toast with nothing else saying it', 5000);
      shown.querySelector('[data-toast-close], .t-x').click();
      await waitFor(() => !toastFor('99.0.3'), 'the toast closed');
      window.__cfire_event_dispatch('update:status', got);
      await openAbout();
      await waitFor(() => q('[data-about-update="available"]'), "About's Updates block again");

      await setStep('the automatic check off');
      const toggle = await waitFor(() => byText('label', 'Check for updates automatically')?.querySelector('[role="switch"]'), 'the automatic check toggle');
      await check(toggle.getAttribute('aria-checked') === 'true', 'the automatic check is on by default');
      toggle.click();
      await waitForAsync(async () => (await window.backend.settings_get({})).update_check === false, 'the setting saved off');
      await check((await window.backend.settings_get({})).update_toast_version === '99.0.0', "the page's save keeps the app's own records");
      await check(true, 'the automatic check turns off');

      await setStep("What's new on demand");
      await click('[data-about-whats-new]');
      const wn2 = await waitFor(() => q('[data-whats-new]'), "What's new from About");
      await check(devBuild ? hasText('no notes in its changelog') : wn2.dataset.whatsNew.length > 0, `What's new shows this version's notes (${wn2.dataset.whatsNew || 'none for a dev build'})`);
      // v0.18.0 drew it outside .app, in WebKit's serif (the owner's check of 53).
      const wnFont = getComputedStyle(wn2).fontFamily;
      await check(!!wn2.closest('.app') && wnFont.startsWith('Geist'), `What's new is inside the app, in its font (${wnFont})`);
      await click('.modal.wn .btn-primary', 'Close');
      await log(`${passed} checks passed`);
      await window.backend.e2e_report({ ok: true, detail: '' });
      window.runtime.Quit();
      return;
    }

    await setStep('add key');
    await click('.rail-btn', 'Keys');
    await click('.page-h .btn-primary', 'Add key');
    await fill('#pk', KEY);
    await fill('#kn', 'e2e-key');
    await click('.drawer button[type="submit"]', 'Add key');
    await waitFor(() => byText('.table td', 'e2e-key'), 'the key row');
    await check(byText('.table td', 'SHA256:'), 'a pasted key shows its fingerprint');
    await check(!text().includes('PRIVATE KEY'), 'the private key is not shown back');

    await setStep('add host');
    await click('.rail-btn', 'Hosts');
    await newSshHost('.btn-primary', 'New host');
    await fill('#ha', 'local');
    await fill('#hh', '127.0.0.1');
    await fill('#hp', PORT);
    await click('.seg button', 'Key');
    await pick('SSH key', 'e2e-key');
    await fill('#hu', USER);
    await click('.modal button[type="submit"]', 'Add host');
    await waitFor(() => byText('.tree .ti', 'local'), 'the host in the tree');
    await check(true, 'a new host appears in the sidebar tree');

    await setStep('host with a saved password');
    await newSshHost('.side-head .icon-btn[aria-label^="New host"]');
    await fill('#ha', 'pwhost');
    await fill('#hh', '127.0.0.2');
    // A label with an accent and a tag, for the palette's search by words (milestone 62).
    await fill('#hl', 'Facturación');
    await fill('.modal input[aria-label="Add tag"]', 'Billing-DB');
    q('.modal input[aria-label="Add tag"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => byText('.modal .tag', 'Billing-DB'), 'the tag on pwhost');
    await click('.seg button', 'Password');
    await fill('input[aria-label="Password"]', HOST_PW_MARKER);
    await click('.modal button[type="submit"]', 'Add host');
    await waitFor(() => byText('.tree .ti', 'pwhost'), 'pwhost in the tree');
    const catalog = await window.backend.catalog({});
    await check(!JSON.stringify(catalog).includes(HOST_PW_MARKER), 'the catalog reply carries no password (Principle 6)');
    await check(catalog.hosts.find((h) => h.alias === 'pwhost').has_password, 'the host reports has_password');

    await setStep('connect: unknown host key');
    byText('.tree .ti', 'local').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await waitFor(() => hasText('before connecting'), 'the host key prompt');
    await check(q('.fp')?.textContent.startsWith('SHA256:'), 'the prompt shows the server fingerprint');
    await check(byText('.tab', 'verify host'), 'the tab is labelled "verify host"');
    await click('button[type="submit"]', 'Trust and connect');
    await waitFor(() => toolbarIs('ready'), 'the session to be ready', 30000);
    await check(true, 'trusting the key opens the shell');

    await setStep('shell I/O');
    await runInTerminal('echo flint-gui-$((40+2))', 'flint-gui-42');
    await check(true, 'typed input reaches the shell and its output reaches xterm.js');
    const known = (await window.backend.catalog({})).known_hosts;
    await check(known.some((k) => k.addr === `[127.0.0.1]:${PORT}`), 'the trusted key is stored in the vault');

    await setStep('resize');
    const term = activeTerm();
    // The page sends its size when the tab is laid out, which can land just after
    // the shell started: ask again a few times before calling it a failure.
    let sized = false;
    for (let i = 0; i < 5 && !sized; i++) {
      await runInTerminal(`stty size; echo size-done-${i}`, `size-done-${i}`);
      sized = termText().includes(`${term.rows} ${term.cols}`);
      if (!sized) await sleep(300);
    }
    await check(sized, `the PTY has the terminal's size (${term.rows} ${term.cols})`);
    {
      const box = term.element.parentElement.getBoundingClientRect();
      const screen = term.element.querySelector('.xterm-screen').getBoundingClientRect();
      if (!(screen.bottom <= box.bottom + 0.5 && screen.right <= box.right + 0.5)) {
        const r = (x) => `${Math.round(x.top)}..${Math.round(x.bottom)} x ${Math.round(x.left)}..${Math.round(x.right)}`;
        const el = term.element.getBoundingClientRect();
        log(`diag: resize box ${r(box)}, term ${r(el)}, screen ${r(screen)}, rows ${term.rows}, window ${innerWidth}x${innerHeight}, parent ${term.element.parentElement.className}, children ${[...term.element.parentElement.children].map((c) => c.className + ':' + Math.round(c.getBoundingClientRect().height)).join(', ')}`);
      }
      await check(screen.bottom <= box.bottom + 0.5 && screen.right <= box.right + 0.5,
        `the terminal's rows fit inside the pane (screen ${Math.round(screen.height)} px, box ${Math.round(box.height)} px)`);
    }

    if (RUN === 'webgl') {
      // The page's visibility over the whole run (WebKit suspends a hidden page, D-068).
      {
        const v0 = performance.now();
        document.addEventListener('visibilitychange', () => log(`diag: visibility ${document.visibilityState} at ${Math.round(performance.now() - v0)} ms (step: ${step})`));
      }
      // Milestone 35b: the lost-WebGL-context check, alone, so a repetition takes
      // seconds (ROADMAP §6). WebKit may take a hidden terminal's WebGL context while a
      // desktop draws (the owner's herdr screen, M31). Every step is stamped in ms from
      // the loss and printed, pass or fail, so one failure shows where the time goes.
      const loseAndRedraw = async (label) => {
        await waitFor(() => activeTerm(), 'the local terminal');
        const host = activePane()?.querySelector('.xterm');
        const glOf = () => [...(host?.querySelectorAll('canvas') ?? [])].map((c) => c.getContext('webgl2')).find((g) => g && !g.isContextLost());
        const glc = await waitFor(() => glOf(), 'the terminal drawing with WebGL', 5000).catch(() => null);
        await check(!!glc, `${label}: the terminal draws with WebGL`);
        const mark = `drawn-${label}-$((50+5))`;
        const want = `drawn-${label}-55`;
        await runInTerminal(`clear; echo ${mark}`, want);
        const term = activeTerm();
        const t0 = performance.now();
        const ev = [];
        const stamp = (n) => ev.push(`${n}@${Math.round(performance.now() - t0)}`);
        glc.canvas.addEventListener('webglcontextlost', () => stamp('lost'), { once: true });
        glc.canvas.addEventListener('webglcontextrestored', () => stamp('restored'), { once: true });
        const refresh = term.refresh.bind(term);
        term.refresh = (a, b) => { stamp(`refresh(${a}-${b})`); return refresh(a, b); };
        let rowsSeen = false;
        let textSeen = false;
        const watch = () => {
          const rows = host?.querySelector('.xterm-rows');
          if (rows && !rowsSeen) { rowsSeen = true; stamp(`dom-rows(n=${rows.children.length})`); }
          if (rows && !textSeen && (rows.textContent ?? '').includes(want)) { textSeen = true; stamp('dom-text'); }
        };
        const mo = new MutationObserver(watch);
        mo.observe(host, { childList: true, subtree: true, characterData: true });
        // requestAnimationFrame's pulse: frames counted, gaps over 500 ms stamped.
        let frames = 0;
        let lastFrame = performance.now();
        let pulsing = true;
        const tick = (t) => {
          frames++;
          if (t - lastFrame > 500) stamp(`raf-gap(${Math.round(t - lastFrame)})`);
          lastFrame = t;
          if (pulsing) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        // Guided by a person (FLINT_E2E_WEBGL_COVER=1, label "alone"): the context is lost
        // while the window is hidden, as when a covered window loses it in daily use.
        let banner = null;
        if (COVER === '1' && label === 'alone') {
          banner = document.createElement('div');
          banner.style.cssText = 'position:fixed;inset:auto 20px 20px 20px;z-index:99999;padding:24px;font:600 22px system-ui;background:#c2410c;color:#fff;border-radius:12px';
          banner.textContent = 'Test: press ⌘H now to hide Flint. Wait 10 seconds, then click Flint in the Dock.';
          document.body.appendChild(banner);
          await waitFor(() => document.visibilityState === 'hidden', 'the window hidden by the person', 120000);
          banner.remove();
          stamp('hidden-by-person');
        }
        glc.getExtension('WEBGL_lose_context')?.loseContext();
        const drawnIn = (ms) => waitFor(() => (host?.querySelector('.xterm-rows')?.textContent ?? '').includes(want), 'the terminal drawn again', ms).then(() => true, () => false);
        // WebKit stops drawing a hidden page (a covered or minimised window, D-068): no
        // requestAnimationFrame, so xterm's DOM renderer draws nothing until the window is
        // seen again. What matters is the terminal drawn once it is: while hidden, wait
        // for the window to come back (a person uncovering it), then give it 5 s.
        if (COVER === '1' && label === 'alone') {
          // Wait for the window to be shown again, then give the terminal 5 s.
          await waitFor(() => document.visibilityState === 'visible', 'the window shown again', 120000);
          stamp(`shown(drawn-before=${(host?.querySelector('.xterm-rows')?.textContent ?? '').includes(want)})`);
        }
        let drawn = await drawnIn(5000);
        if (!drawn && document.visibilityState === 'hidden') {
          stamp('hidden');
          log(`diag: ${label}: the window is hidden (covered?); the check waits up to 60 s for it to be drawn or seen`);
          const has = () => (host?.querySelector('.xterm-rows')?.textContent ?? '').includes(want);
          await waitFor(() => has() || document.visibilityState === 'visible', 'drawn or seen again', 60000).catch(() => null);
          if (has()) drawn = true;
          else if (document.visibilityState === 'visible') { stamp('visible'); drawn = await drawnIn(5000); }
        }
        const diag = `D ${term._core?._renderService?._isPaused}/${term._core?._renderService?._needsFullRefresh} n=${host?.querySelector('.xterm-rows')?.children.length} r=${term.rows} c=${term.cols} buf=${termText().includes(want)} cw=${host?.querySelector('.xterm-rows')?.offsetWidth}x${host?.querySelector('.xterm-rows')?.offsetHeight} vis=${document.visibilityState} focus=${document.hasFocus()}`;
        // On a failure, keep watching a while longer: drawn late, or never.
        const late = drawn ? true : await drawnIn(10000);
        mo.disconnect();
        pulsing = false;
        stamp(`frames=${frames},last@${Math.round(lastFrame - t0)}`);
        term.refresh = refresh;
        log(`diag: ${label}: ${ev.join(' ')}${drawn ? '' : late ? ' (drawn late)' : ' (never drawn)'} | ${diag}`);
        if (!drawn && document.visibilityState === 'hidden') {
          throw new Error(`${label}: the window stayed hidden (covered or minimised) for 60 s, so nothing could be drawn: leave the test window uncovered (${ev.join(' ')})`);
        }
        await check(drawn, `${label}: after a lost WebGL context the whole terminal is drawn again within 5 s of being seen (${ev.join(' ')} | ${diag})`);
      };

      await setStep('webgl: the context lost with nothing else drawing');
      await loseAndRedraw('alone');
      if (CPORT !== '0') {
        await setStep('webgl: the context lost while a desktop draws behind');
        await click('.side-head .icon-btn[aria-label^="New host"]');
        await waitFor(() => q('[data-host-type-step]'), 'the type step');
        await click('.type-card[data-type="rdp"]');
        await click('.modal button', 'Continue');
        await waitFor(() => q('[data-rdp-editor]'), 'the RDP editor');
        await fill('#ra', 'rdp-clip');
        await fill('#rh', '127.0.0.1');
        await fill('#rp', String(CPORT));
        await fill('#ru', 'e2e');
        await fill('#rd', 'LAB');
        await fill('.modal input[aria-label="Password"]', 'x');
        await click('.modal button[type="submit"]', 'Add host');
        await waitFor(() => byText('.tree .ti', 'rdp-clip'), 'rdp-clip in the tree');
        byText('.tree .ti', 'rdp-clip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await waitFor(() => q('.tab.on') && q('[data-rdp-state="certificate"]', activeRegion()), 'the certificate prompt (test server)', 30000);
        await click('button[type="submit"]', 'Trust and connect');
        const canvas = () => q('canvas.rdp-canvas', activeRegion());
        await waitFor(() => canvas()?.dataset.desktop, 'the test server desktop', 30000);
        // The terminal hidden behind the desktop, as in the rdp run, then shown again.
        await sleep(1500);
        await click('.tab', 'local');
        await loseAndRedraw('desktop');
        await click('.tab', 'rdp-clip');
        await waitFor(() => canvas(), 'the desktop again');
        await sleep(300);
        await click('.tab', 'local');
        // loseAndRedraw checks first that WebGL came back when the tab was shown again.
        await loseAndRedraw('again');
      }
    }

    if (RUN === 'fullscreen') {
      // Milestone 37: an immersive full-screen RDP tab against Flint's test server. The
      // headless window cannot go full screen (CF-111): the core stands in for the OS
      // and answers `window:fullscreen` at once, so what is checked is the page, the
      // desktop's size, and every way in and out. The OS's own full screen is the owner's.
      if (CPORT === '0') throw new Error('the fullscreen run needs Flint\'s RDP test server (scripts/test.sh starts it)');
      const isMac = (await window.backend.app_info({})).os === 'mac';
      const ctl = async (cmd) => (await fetch(`http://127.0.0.1:${CCTL}/${cmd}`, { cache: 'no-store' })).text();
      const app = () => q('.app');
      const immersive = () => app()?.dataset.fullscreen === 'true';
      const hiddenEl = (sel) => { const el = q(sel); return !el || el.offsetParent === null || getComputedStyle(el).display === 'none'; };
      const canvas = () => q('canvas.rdp-canvas', activeRegion());
      const fsChord = (target) => (target ?? document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', isMac
        ? { key: 'f', code: 'KeyF', bubbles: true, cancelable: true, metaKey: true, ctrlKey: true }
        : { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ctrlKey: true, altKey: true }));
      const fitsArea = () => {
        const d = canvas()?.dataset.desktop;
        if (!d) return false;
        const [w, h] = d.split('x').map(Number);
        const a = q('.rdp-area', activeRegion()).getBoundingClientRect();
        return Math.abs(w - Math.floor(a.width)) <= 2 && Math.abs(h - Math.floor(a.height)) <= 2;
      };
      // Full screen on macOS covers the screen but for a notch's band (MacBooks with one).
      const coversScreen = () => window.innerWidth === screen.width && window.innerHeight >= screen.height - 40;
      const hover = (el, on) => el.dispatchEvent(new MouseEvent(on ? 'mouseover' : 'mouseout', { bubbles: true, relatedTarget: null }));
      // A timeline of what the window says, printed with every step (rule 9).
      {
        const f0 = performance.now();
        window.runtime.EventsOn('window:fullscreen', (e) => log(`diag: window:fullscreen ${JSON.stringify(e)} at ${Math.round(performance.now() - f0)} ms, window ${window.innerWidth}x${window.innerHeight}, immersive ${immersive()} (step: ${step})`));
      }

      await setStep('fullscreen: an RDP tab on the test server');
      await click('.side-head .icon-btn[aria-label^="New host"]');
      await waitFor(() => q('[data-host-type-step]'), 'the type step');
      await click('.type-card[data-type="rdp"]');
      await click('.modal button', 'Continue');
      await waitFor(() => q('[data-rdp-editor]'), 'the RDP editor');
      await fill('#ra', 'rdp-full');
      await fill('#rh', '127.0.0.1');
      await fill('#rp', String(CPORT));
      await fill('#ru', 'e2e');
      await fill('.modal input[aria-label="Password"]', 'x');
      await click('.modal button[type="submit"]', 'Add host');
      await waitFor(() => byText('.tree .ti', 'rdp-full'), 'rdp-full in the tree');
      byText('.tree .ti', 'rdp-full').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await waitFor(() => q('.tab.on') && q('[data-rdp-state="certificate"]', activeRegion()), 'the certificate prompt', 30000);
      await click('button[type="submit"]', 'Trust and connect');
      await waitFor(() => q('[data-rdp-size]') && canvas()?.dataset.desktop, 'the desktop', 30000);
      const before = canvas().dataset.desktop;
      await check(!immersive() && !q('[data-fs-bar]'), 'a new RDP tab starts in the window, with Flint around it');

      await setStep('fullscreen: the toolbar button, the first time');
      await click('[data-rdp-fullscreen]');
      await waitFor(() => immersive(), 'the page immersive');
      for (const sel of ['.titlebar', '.rail', '.statusbar', '.tabbar', '[data-rdp-toolbar]', '.sidebar']) {
        await check(hiddenEl(sel), `full screen hides ${sel}`);
      }
      {
        const m = q('.main').getBoundingClientRect();
        await check(m.left === 0 && m.top === 0 && Math.round(m.width) === window.innerWidth && Math.round(m.height) === window.innerHeight,
          `the desktop's area is the whole window (${Math.round(m.width)}x${Math.round(m.height)} of ${window.innerWidth}x${window.innerHeight})`);
      }
      await waitFor(() => canvas()?.dataset.desktop && canvas().dataset.desktop !== before && fitsArea(), 'the desktop at the full size', 30000);
      await check(true, `the remote desktop takes the full size (${before} → ${canvas().dataset.desktop})`);
      await check(q('[data-rdp-size]') === null || !q('[data-rdp-state]', activeRegion()), 'the session stays up');
      const note = await waitFor(() => q('[data-fs-note]'), 'the first-time note');
      const chordText = isMac ? '⌃⌘F' : 'Ctrl+Alt+Enter';
      await check(note.textContent.includes('Point at the top edge') && note.textContent.includes(chordText), `the first time, a note says how to leave (${note.textContent.trim()})`);
      await check(!!q('[data-fs-tab]') && !q('[data-fs-bar]'), 'the bar starts folded to a tab');

      if (NATIVEFS === '1') {
        // The window itself: the screen's size once macOS has moved it to its Space.
        const full = await waitFor(() => coversScreen(), 'the window at the screen\'s size', 10000).catch(() => false);
        log(`diag: native: window ${window.innerWidth}x${window.innerHeight}, screen ${screen.width}x${screen.height}`);
        await check(full, `the window is full screen at the screen's size (${window.innerWidth}x${window.innerHeight} of ${screen.width}x${screen.height})`);
        await waitFor(() => fitsArea(), 'the desktop at the screen size', 30000);
        await check(true, `the remote desktop takes the screen's size (${canvas().dataset.desktop})`);
      }
      await setStep('fullscreen: the bar drops from the top edge');
      hover(q('[data-fs-edge]'), true);
      const bar = await waitFor(() => q('[data-fs-bar]'), 'the connection bar');
      await check(bar.textContent.includes('rdp-full') && bar.textContent.includes(canvas().dataset.desktop.replace('x', ' × ')), `the bar names the host and the desktop's size (${bar.textContent.trim().slice(0, 60)})`);
      await check(bar.textContent.includes('Exit full screen') && bar.textContent.includes(chordText) && bar.textContent.includes('Disconnect'), 'the bar offers Exit full screen with its chord, and Disconnect');
      if (NATIVEFS === '1') {
        const t = parseInt(bar.style.top, 10);
        log(`diag: native: the bar drops at ${bar.style.top}`);
        await check(t > 0, `on macOS the bar drops below the menu bar and title bar (${bar.style.top})`);
      }
      hover(q('[data-fs-edge]'), false);
      await waitFor(() => !q('[data-fs-bar]'), 'the bar gone after the pointer left', 3000);
      await check(true, 'the bar goes once the pointer leaves');
      hover(q('[data-fs-edge]'), true);
      await click('[data-fs-pin]');
      hover(q('[data-fs-bar]'), false);
      await sleep(1200);
      await check(!!q('[data-fs-bar]') && q('[data-fs-pin]').getAttribute('aria-pressed') === 'true', 'a pinned bar stays');
      await click('[data-fs-pin]');

      await setStep('fullscreen: Exit full screen in the bar');
      await waitFor(() => !q('[data-fs-bar]'), 'an unpinned bar gone', 3000);
      hover(q('[data-fs-edge]'), true);
      await click('[data-fs-exit]');
      await waitFor(() => !immersive(), 'the page back in the window');
      if (NATIVEFS === '1') {
        const back = await waitFor(() => !coversScreen(), 'the window back to its size', 10000).catch(() => false);
        await check(back, `the window leaves full screen (${window.innerWidth}x${window.innerHeight})`);
      }
      for (const sel of ['.titlebar', '.rail', '.statusbar', '.tabbar', '[data-rdp-toolbar]']) {
        await check(!hiddenEl(sel), `leaving full screen shows ${sel} again`);
      }
      await waitFor(() => canvas()?.dataset.desktop === before && fitsArea(), 'the desktop back at the tab size', 30000);
      await check(true, `the desktop returns to the tab's size (${before})`);
      await check(!q('[data-rdp-state]', activeRegion()), 'the session is still up');
      {
        // The note shows once on this machine (design 22b2), kept in the config folder.
        const seen = await waitForAsync(async () => ((await window.backend.ui_state_get({})).fullscreen_note_seen ? true : null), 'the note marked seen', 10000).catch(() => false);
        await check(seen, 'the first-time note is remembered as seen');
      }

      await setStep('fullscreen: the chord, both ways, kept from the remote');
      await ctl('clear');
      canvas().focus();
      fsChord(canvas());
      await waitFor(() => immersive(), 'the page immersive from the chord');
      await sleep(400);
      await check(!q('[data-fs-note]'), 'the note does not show a second time');
      canvas().focus();
      fsChord(canvas());
      await waitFor(() => !immersive(), 'the page back from the chord');
      {
        const keys = await ctl('keys');
        // The chord's modifiers may reach the remote and be let go; its letter never does.
        const letter = isMac ? '0x21' : '0x1c';
        await check(!keys.split(' ').some((k) => k === 'd:' + letter), `the chord's key does not reach the remote (${keys})`);
      }

      await setStep('fullscreen: the palette, and another tab leaves');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true, cancelable: true, metaKey: isMac, ctrlKey: !isMac, shiftKey: !isMac }));
      await waitFor(() => q('[aria-label="Command palette"]'), 'the palette');
      await fill('[aria-label="Command palette"] input', 'Full screen');
      const fsItem = await waitFor(() => byText('[role="option"]', 'Full screen'), 'Full screen in the palette');
      await check(fsItem.getAttribute('aria-disabled') !== 'true' && fsItem.textContent.includes(chordText), 'the palette offers Full screen with its chord on an RDP tab');
      fsItem.click();
      await waitFor(() => immersive(), 'the page immersive from the palette');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true, cancelable: true, metaKey: isMac, ctrlKey: !isMac, shiftKey: !isMac }));
      await waitFor(() => !immersive(), 'full screen left for another tab');
      await check(q('.tab.on')?.textContent.includes('local'), 'going to another tab leaves full screen and shows it');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true, cancelable: true, metaKey: isMac, ctrlKey: !isMac, shiftKey: !isMac }));
      await waitFor(() => q('[aria-label="Command palette"]'), 'the palette on the SSH tab');
      await fill('[aria-label="Command palette"] input', 'Full screen');
      const greyed = await waitFor(() => byText('[role="option"]', 'Full screen'), 'Full screen in the palette (SSH tab)');
      await check(greyed.getAttribute('aria-disabled') === 'true' && greyed.title === 'RDP tabs only', 'on an SSH tab the palette greys Full screen: "RDP tabs only"');
      q('[aria-label="Command palette"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await waitFor(() => !q('[aria-label="Command palette"]'), 'the palette closed');

      await setStep('fullscreen: the tab menu, and the OS leaving by its own means');
      await click('.tab', 'rdp-full');
      byText('.tab', 'rdp-full').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 60 }));
      const menu = await waitFor(() => q('[data-tab-menu]'), 'the tab menu');
      await check(menu.textContent.includes('Full screen') && menu.textContent.includes(chordText) && menu.textContent.includes('Close tab'), 'the tab menu offers Full screen with its chord');
      await click('[data-tab-menu-item="fullscreen"]');
      await waitFor(() => immersive(), 'the page immersive from the tab menu');
      const screenSized = coversScreen;
      if (NATIVEFS === '1') await waitFor(() => screenSized(), 'the window full screen from the tab menu', 10000);
      await window.backend.e2e_window_fullscreen({ on: false });
      await waitFor(() => !immersive(), 'the page back when the OS left full screen');
      await check(!hiddenEl('.titlebar'), 'leaving full screen another way (the green button) brings Flint back');
      if (NATIVEFS === '1') await waitFor(() => !screenSized(), 'the window out of full screen', 10000);
      await window.backend.e2e_window_fullscreen({ on: true });
      await waitFor(() => immersive(), 'the page immersive when the OS entered full screen', 10000);
      if (NATIVEFS === '1') await waitFor(() => screenSized(), 'the window full screen again', 10000);
      await check(true, 'entering full screen another way on an RDP tab makes it immersive, as Windows App');

      await setStep('fullscreen: the connection lost keeps full screen, the bar open');
      await waitFor(() => fitsArea() && !q('[data-rdp-state]', activeRegion()), 'the desktop at full size', 30000);
      await ctl('drop');
      const lostBar = await waitFor(() => q('[data-fs-bar]') && q('[data-fs-bar]').textContent.includes('disconnected') ? q('[data-fs-bar]') : null, 'the bar open on a lost connection', 30000);
      await check(immersive() && lostBar.textContent.includes('Exit full screen') && !lostBar.textContent.includes('Disconnect'), 'a lost connection stays full screen with the bar open and Exit full screen');
      await check(!!byText('button', 'Reconnect'), 'the connection-lost card offers Reconnect');
      await click('[data-fs-exit]');
      await waitFor(() => !immersive(), 'out of full screen');
      await check(!hiddenEl('.tabbar'), 'Exit full screen brings the tabs back');
    }

    if (RUN === 'multimon') {
      // Milestone 38 against Flint's test server, whose 64x64 tiles each have a colour
      // that says where they are (tileColour): a window that draws the wrong part of the
      // desktop shows the wrong colour. The test server has no Display Control, so each
      // layout reaches it through the invisible reconnect (D-072 (4)).
      if (CPORT === '0') throw new Error('the multimon run needs Flint\'s RDP test server (scripts/test.sh starts it)');
      const ctl = async (cmd) => (await fetch(`http://127.0.0.1:${CCTL}/${cmd}`, { cache: 'no-store' })).text();
      const isMac = (await window.backend.app_info({})).os === 'mac';
      const mons = () => window.__flintE2E.monitors;
      const app = () => q('.app');
      const immersive = () => app()?.dataset.fullscreen === 'true';
      const canvas = () => q('canvas.rdp-canvas', activeRegion());
      const tileColour = (x, y) => { const tx = Math.floor(x / 64), ty = Math.floor(y / 64); return [0x30 + (tx * 37) % 192, 0x30 + (ty * 53) % 192, 0x2e]; };
      const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 3);
      // Answers from the extra windows' pages, as they reach the main page.
      const probes = [];
      window.runtime.EventsOn('monitor:message', (e) => {
        try { const m = JSON.parse(e.data); if (m.type === 'probe') probes.push({ id: e.id, ...m }); } catch { /* not ours */ }
        if (!String(e.data).includes('"pointer"')) log(`diag: monitor:message ${e.id} ${String(e.data).slice(0, 160)} (step: ${step})`);
      });
      window.runtime.EventsOn('monitor:closed', (e) => log(`diag: monitor:closed ${e.id} (step: ${step})`));
      const probe = async (id) => {
        const n = probes.length;
        await window.backend.monitors_send({ id, data: JSON.stringify({ type: 'probe' }) });
        return waitFor(() => probes.slice(n).find((p) => p.id === id), `the window on monitor ${id} to answer`, 10000);
      };
      const input = (id, msg) => window.backend.monitors_send({ id, data: JSON.stringify({ type: 'e2e-input', ...msg }) });
      // A timeline of the store, printed with every step (rule 9).
      {
        const f0 = performance.now();
        let last = '';
        const tick = () => {
          const m = mons()?.get();
          // The tab's desktop, its area and what Automatic chose (D-091 reconnects it).
          const cv = document.querySelector('canvas.rdp-canvas');
          const area = document.querySelector('.rdp-area')?.getBoundingClientRect();
          const mode = document.querySelector('[title^="Automatic"], [title^="Pipeline"], [title^="Compatible"]')?.getAttribute('title')?.split('.')[0] ?? '';
          const tab = `desk=${cv?.dataset.desktop ?? '-'} area=${area ? `${Math.floor(area.width)}x${Math.floor(area.height)}` : '-'} mode=${mode}`;
          const now = m ? `${m.phase} picks=${m.picks.join(',')} span=${m.span ? `${m.span.width}x${m.span.height}` : '-'} err=${m.error} ${tab}` : 'no store';
          if (now !== last) { last = now; log(`diag: monitors ${now} at ${Math.round(performance.now() - f0)} ms (step: ${step})`); }
          setTimeout(tick, 100);
        };
        tick();
      }

      await setStep('multimon: what the system offers');
      await waitFor(() => mons(), 'the monitors store');
      const view = await window.backend.monitors_list({});
      log(`diag: monitors ${JSON.stringify(view)}`);
      await check(view.monitors.length >= 2 && view.reason === '' && view.max === 2 && view.picks.length === 2 && view.picks[0] === view.main,
        `two monitors or more, offered, capped at 2, the main one first (${view.monitors.length} monitors, picks ${view.picks.join(',')}, reason '${view.reason}')`);
      const extra = view.picks[1];

      await setStep('multimon: an RDP tab on the test server');
      await click('.side-head .icon-btn[aria-label^="New host"]');
      await waitFor(() => q('[data-host-type-step]'), 'the type step');
      await click('.type-card[data-type="rdp"]');
      await click('.modal button', 'Continue');
      await waitFor(() => q('[data-rdp-editor]'), 'the RDP editor');
      await fill('#ra', 'rdp-mon');
      await fill('#rh', '127.0.0.1');
      await fill('#rp', String(CPORT));
      await fill('#ru', 'e2e');
      await fill('.modal input[aria-label="Password"]', 'x');
      await click('.modal button[type="submit"]', 'Add host');
      await waitFor(() => byText('.tree .ti', 'rdp-mon'), 'rdp-mon in the tree');
      byText('.tree .ti', 'rdp-mon').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await waitFor(() => q('.tab.on') && q('[data-rdp-state="certificate"]', activeRegion()), 'the certificate prompt', 30000);
      await click('button[type="submit"]', 'Trust and connect');
      await waitFor(() => q('[data-rdp-size]') && canvas()?.dataset.desktop, 'the desktop', 30000);

      await setStep('multimon: the Full screen menu offers all monitors');
      await click('[data-rdp-fullscreen-menu]');
      const menu = await waitFor(() => q('[data-fullscreen-menu]'), 'the Full screen menu');
      const all = await waitFor(() => { const b = q('[data-fullscreen-all]', menu); return b && !b.dataset.reason ? b : null; }, 'all monitors offered');
      await check(all.textContent.includes('Full screen on all monitors') && all.textContent.includes('2 monitors'), `the menu offers all monitors (${all.textContent.trim()})`);
      await click('[data-fullscreen-all]');
      await waitFor(() => immersive(), 'the page immersive');
      await waitFor(() => mons().get().phase === 'on', 'the desktop across the monitors', 40000);
      // The span may be computed while the main window's full screen is still growing;
      // the new size spans again a moment later (seen on Linux: a 948x666 main part,
      // then 1080x800). The checks below read the settled span: unchanged for a second.
      let seen = '';
      let since = performance.now();
      const settled = () => {
        const m = mons().get();
        const now = m.phase === 'on' && m.span ? JSON.stringify(m.span) : '';
        if (now !== seen) { seen = now; since = performance.now(); return null; }
        return now && performance.now() - since >= 1000 ? m.span : null;
      };
      const span = await waitFor(settled, 'the span to settle', 15000);
      log(`diag: span ${JSON.stringify(span)}`);
      await check(span.monitors.length === 2 && span.monitors[0].primary && span.monitors[0].local_id === view.main && span.monitors[1].local_id === extra,
        `the layout has the main monitor as primary and the extra one (${span.monitors.map((m) => `${m.local_id}@${m.x},${m.y} ${m.width}x${m.height}`).join(' + ')})`);
      const crop0 = span.crops[0];
      const crop1 = span.crops[1];

      await setStep('multimon: each window draws its part');
      await waitFor(() => canvas()?.dataset.desktop === `${crop0.width}x${crop0.height}`, `the main window at its part (${crop0.width}x${crop0.height})`, 30000);
      await check(true, `the main window draws the primary's part, ${canvas().dataset.desktop}`);
      {
        // The canvas is cleared when it takes the new size; the frame follows.
        const pixel = () => {
          const copy = document.createElement('canvas');
          copy.width = crop0.width; copy.height = crop0.height;
          copy.getContext('2d').drawImage(canvas(), 0, 0);
          return Array.from(copy.getContext('2d').getImageData(70, 70, 1, 1).data.slice(0, 3));
        };
        const want = tileColour(crop0.x + 70, crop0.y + 70);
        await waitFor(() => near(pixel(), want), 'the main window\'s tile', 10000).catch(() => {});
        await check(near(pixel(), want), `the main window shows the tile at its crop (${pixel()} for ${want})`);
      }
      const wantA = tileColour(crop1.x + 2, crop1.y + 2);
      const wantB = tileColour(crop1.x + (crop1.width >> 1), crop1.y + (crop1.height >> 1));
      let p = await waitForAsync(async () => { const r = await probe(extra); return r.frames > 0 && r.width === crop1.width && r.height === crop1.height ? r : null; }, 'the extra window drawing its part', 30000);
      await check(true, `the extra window draws ${p.width}x${p.height} in ${p.frames} frames (window ${p.inner.join('x')})`);
      p = await waitForAsync(async () => { const r = await probe(extra); return near(r.pixels.slice(0, 3), wantA) && near(r.pixels.slice(3, 6), wantB) ? r : null; }, 'the extra window\'s tiles', 10000).catch(() => probe(extra));
      await check(near(p.pixels.slice(0, 3), wantA) && near(p.pixels.slice(3, 6), wantB), `the extra window shows the tiles of its own crop (${p.pixels} for ${wantA},${wantB})`);

      await setStep('multimon: the pointer and the keys of each window');
      await ctl('clear');
      await input(extra, { x: 100, y: 130 });
      const ptr = await waitForAsync(async () => { const r = await ctl('pointer'); return r !== '-' ? r : null; }, 'the server to see the pointer', 10000);
      await check(ptr === `${crop1.x + 100},${crop1.y + 130}`, `the extra window's pointer lands at its crop (${ptr}, expected ${crop1.x + 100},${crop1.y + 130})`);
      {
        const r = canvas().getBoundingClientRect();
        const sx = crop0.width / r.width, sy = crop0.height / r.height;
        // A click goes out at once; a move waits for the next animation frame.
        const at = { clientX: r.left + 40 / sx, clientY: r.top + 50 / sy, bubbles: true, button: 0 };
        await ctl('clear');
        canvas().dispatchEvent(new MouseEvent('mousedown', at));
        canvas().dispatchEvent(new MouseEvent('mouseup', at));
        const want = `${crop0.x + 40},${crop0.y + 50}`;
        const got = await waitForAsync(async () => { const v = await ctl('pointer'); return v === want ? v : null; }, 'the main window\'s pointer at its crop', 10000).catch(() => ctl('pointer'));
        await check(got === want, `the main window's pointer lands at the primary's place (${got}, expected ${want})`);
      }
      await input(extra, { key: 'KeyA' });
      const keys = await waitForAsync(async () => { const k = await ctl('keys'); return k.includes('u:0x1e') ? k : null; }, 'the key to reach the server', 10000);
      await check(keys.includes('d:0x1e') && keys.includes('u:0x1e'), `a key pressed in the extra window reaches the server (${keys})`);

      await setStep('multimon: the bar and the popover');
      q('[data-fs-edge]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
      const bar = await waitFor(() => q('[data-fs-bar]'), 'the connection bar');
      await check(bar.textContent.includes('2 monitors') && bar.textContent.includes(`${span.width} × ${span.height}`), `the bar says the desktop spans 2 monitors (${bar.textContent.trim().slice(0, 80)})`);
      await click('[data-fs-monitors]');
      const pop = await waitFor(() => q('[data-monitors-popover]'), 'the Monitors popover');
      const tiles = [...pop.querySelectorAll('[data-monitor]')];
      await check(tiles.length === view.monitors.length && q(`[data-monitor="${CSS.escape(view.main)}"]`, pop).textContent.includes('Main · taskbar')
        && q(`[data-monitor="${CSS.escape(extra)}"]`, pop).getAttribute('aria-checked') === 'true', `the popover maps ${tiles.length} monitors, the main one tagged, the extra one checked`);
      if (view.monitors.length > 2) {
        const third = view.monitors.find((m) => !view.picks.includes(m.id)).id;
        await check(q(`[data-monitor="${CSS.escape(third)}"]`, pop).classList.contains('cap'), 'a third monitor cannot be checked past the cap');
      }

      await setStep('multimon: unchecking the extra monitor goes back to one');
      q(`[data-monitor="${CSS.escape(extra)}"]`, pop).click();
      await waitFor(() => mons().get().phase === 'off', 'back to one monitor', 10000);
      await check(immersive(), 'the main window stays full screen');
      await waitFor(() => { const d = canvas()?.dataset.desktop; const a = q('.rdp-area', activeRegion()).getBoundingClientRect(); return d && Math.abs(Number(d.split('x')[0]) - Math.floor(a.width)) <= 2 && Math.abs(Number(d.split('x')[1]) - Math.floor(a.height)) <= 2; }, 'the desktop at the main window\'s size', 30000);
      await check(true, `the desktop is the main window's size again (${canvas().dataset.desktop})`);
      {
        const n0 = probes.length;
        await window.backend.monitors_send({ id: extra, data: JSON.stringify({ type: 'probe' }) });
        await sleep(1500);
        await check(!probes.slice(n0).some((x) => x.id === extra), 'the extra window closed (it answers no more)');
      }

      await setStep('multimon: checking it again spans again; a lost connection says so there');
      q(`[data-monitor="${CSS.escape(extra)}"]`, q('[data-monitors-popover]') ?? document).click();
      await waitFor(() => mons().get().phase === 'on', 'across the monitors again', 40000);
      await waitForAsync(async () => { const r = await probe(extra); return r.frames > 0 && r.width === crop1.width ? r : null; }, 'the extra window drawing again', 30000);
      await check(true, 'checking the extra monitor in the popover spans the desktop again');
      await ctl('drop');
      p = await waitForAsync(async () => { const r = await probe(extra); return r.state === 'lost' ? r : null; }, 'the extra window to say the connection was lost', 30000);
      await check(true, 'a lost connection shows "Connection lost — see the main screen" on the extra monitor');
      await click('[data-fs-exit]');
      await waitFor(() => !immersive() && mons().get().phase === 'off', 'out of full screen and back to one monitor', 10000);
      await check(true, 'Exit full screen ends the desktop across monitors');
      if (isMac) log('diag: macOS: the extra window leaves its Space');
    }

    if (RUN === 'vim') {
      await setStep('vim');
      // A full-screen editor queries the terminal at start (DECRQM, XTGETTCAP, DA2…).
      // A reply that throws inside xterm.js stops its write queue: the editor still
      // gets every key but the screen never changes again (vite.config.ts, target).
      const key = (k, code, keyCode) => {
        const ta = activePane().querySelector('textarea');
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, keyCode, bubbles: true, cancelable: true }));
      };
      const keys = async (text) => {
        for (const ch of text) {
          key(ch, ch === ':' ? 'Semicolon' : 'Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0));
          await sleep(30);
        }
      };
      await runInTerminal('rm -f /tmp/flint-e2e-vim.txt; vim -u DEFAULTS /tmp/flint-e2e-vim.txt', 'flint-e2e-vim.txt" [New]');
      await keys('ihello');
      await waitFor(() => termText().includes('-- INSERT --'), 'vim in insert mode');
      await check(true, 'vim redraws after its start-up queries (DECRQM)');
      key('Escape', 'Escape', 27);
      // Esc and the next key in one SSH packet read as an Alt chord: wait for vim to
      // leave insert mode first, as a person typing would.
      await waitFor(() => !termText().includes('-- INSERT --'), 'vim back in normal mode');
      await keys(':wq');
      key('Enter', 'Enter', 13);
      // Keys sent while vim is still quitting are lost: the tty changes mode under them
      // (seen on Windows, 2026-11-09: the cat never ran). Wait, as a person would, for
      // vim to leave the alternate screen and the shell's prompt to settle.
      await waitFor(() => activeTerm().buffer.active.type === 'normal', 'vim to quit');
      for (let screen = '', t0 = Date.now(); termText() !== screen && Date.now() - t0 < 10000; ) {
        screen = termText();
        await sleep(300);
      }
      await runInTerminal('cat /tmp/flint-e2e-vim.txt; echo vim-$((6*7))', 'vim-42');
      await check(/^hello$/m.test(termText()), 'keys typed in vim reach it (insert, Esc, :wq)' + (/^hello$/m.test(termText()) ? '' : ' — terminal: ' + termText().split('\n').filter((l) => l.trim()).slice(-6).join(' | ')));
    }

    if (RUN === 'terminal') {
      // Milestone 55: the tab's server resources in the status bar, read over a second
      // channel of its own session. Only a Linux sshd (the Docker check) has them; the
      // Mac's and the Windows VM's show nothing, and say no error.
      await setStep('server resources');
      if ((await window.backend.app_info({})).os === 'linux') {
        let probe = 0;
        // Whether `n` loops run on the server, asked a few times (a closed channel takes
        // a moment to end its loop). "[w]hile" keeps grep from counting itself.
        const loops = async (n) => {
          for (let i = 0; i < 20; i++) {
            probe += 1;
            const mark = `loops-${probe}-`;
            await type(`echo ${mark}$(grep -las "[w]hile read -r _" /proc/[0-9]*/cmdline | wc -l)`);
            await enter();
            const seen = new RegExp(mark + '(\\d+)');
            await waitFor(() => seen.test(termText()), `"${mark}" in the terminal`);
            if (termText().match(seen)[1] === String(n)) return true;
            await sleep(250);
          }
          return false;
        };
        await waitFor(() => q('[data-server-stats="live"]'), 'the status bar shows the server resources', 15000);
        const bar = q('[data-server-stats="live"]');
        await check(['cpu', 'ram', 'net', 'disk', 'up'].every((k) => bar.querySelector(`[data-res="${k}"]`)), 'CPU, RAM, network, disk and uptime are in the status bar');
        await check(/Server resources: CPU \d+ percent/.test(bar.getAttribute('aria-label') ?? ''), 'the item says what it shows to a screen reader');
        await check(await loops(1), 'one resources loop runs on the server');
        bar.click();
        await waitFor(() => q('[data-server-stats-detail]'), 'the detail opens on a click');
        await check(hasText('Last sample') && hasText('Memory') && hasText('Uptime'), 'the detail shows memory, uptime and the last sample');
        await click('[data-server-stats-settings]');
        await waitFor(() => q('[data-setting="server_stats"]'), 'Settings… opens Settings, Terminal');
        q('[data-setting="server_stats"]').click();
        await waitFor(() => !q('[data-server-stats]'), 'turning the setting off hides the resources');
        await click('.rail-btn', 'Hosts');
        await waitFor(() => activeTerm(), 'the terminal again');
        await check(await loops(0), 'turning the setting off ends the loop on the server');
        await click('.rail-btn', 'Settings');
        await waitFor(() => q('[data-setting="server_stats"]'), 'Settings, Terminal');
        q('[data-setting="server_stats"]').click();
        await click('.rail-btn', 'Hosts');
        await waitFor(() => q('[data-server-stats="live"]'), 'turning it on again shows them again', 15000);
      } else {
        await sleep(3000);
        await check(!q('[data-server-stats]'), 'a server that is not Linux shows no resources');
      }

      await setStep('osc 52');
      // A remote program sets the clipboard: the core writes it (the run's private board).
      await runInTerminal(`printf '\\033]52;c;%s\\a' "$(printf 'osc52-from-remote-%s' "$((6*7))" | base64)"; echo osc-sent-$((6*7))`, 'osc-sent-42');
      {
        const clip = await waitForAsync(async () => {
          const r = await window.backend.e2e_clipboard({});
          const v = (typeof r === 'string' ? JSON.parse(r) : r)?.name;
          return v === 'osc52-from-remote-42' ? v : null;
        }, 'the OSC 52 text on the clipboard');
        await check(clip === 'osc52-from-remote-42', 'OSC 52 from the remote reaches the clipboard');
      }
      await runInTerminal(`printf '\\033]52;c;?\\a'; echo osc-query-$((6*7))`, 'osc-query-42');
      await check(true, 'an OSC 52 query is ignored and the session carries on');

      await setStep('input order');
      // 300 writes in one tick, as xterm.js answering a burst of colour queries: they
      // must reach the remote in order (Tether 14a1461).
      await runInTerminal('stty -echo; cat > /tmp/flint-e2e-order.txt; stty echo; echo cat-done-$((6*7))', '');
      await sleep(300);
      {
        const t = activeTerm();
        for (let i = 0; i < 300; i++) t.input(`L${i}\n`, true);
        // On the Windows VM the test sshd is MSYS2's, whose pty dropped a ^D that came in
        // the same burst (a second ^D ended cat; owner, 2026-11-19): there it goes
        // apart. The burst's order is what this checks, on every system.
        if ((await window.backend.app_info({})).os === 'windows') {
          // The first ^D is lost there even 300 ms apart; a second ended cat. Up to three,
          // each only while cat still runs (a ^D at the shell's prompt would end it).
          for (let i = 0; i < 3 && !termText().includes('cat-done-42'); i++) { await sleep(i ? 1000 : 300); if (!termText().includes('cat-done-42')) t.input('\x04', true); }
        } else {
          t.input('\x04', true);
        }
      }
      try {
        await waitFor(() => termText().includes('cat-done-42'), 'cat to finish');
      } catch (e) {
        // diag (Windows VM, 2026-11-19): what the terminal showed when cat did not end.
        await log('diag: terminal tail: ' + JSON.stringify(termText().slice(-300)));
        // A second ^D: did the first one get lost, or does cat never see EOF here?
        activeTerm().input('\x04', true);
        await sleep(2000);
        await log('diag: after a second ^D, cat ' + (termText().includes('cat-done-42') ? 'ended' : 'still runs'));
        if (termText().includes('cat-done-42')) {
          await runInTerminal(`wc -l < /tmp/flint-e2e-order.txt; echo wc-$((6*7))`, 'wc-42');
          await log('diag: lines in the file: ' + JSON.stringify(termText().slice(-40)));
        }
        throw e;
      }
      await runInTerminal(`awk 'NR-1!=substr($0,2){bad=1} END{print ((bad||NR!=300)?"order-bad-" NR:"order-" "ok")}' /tmp/flint-e2e-order.txt`, '\norder-');
      await check(termText().includes('order-ok'), 'a 300-write burst reaches the remote in order' + (termText().includes('order-ok') ? '' : ' — ' + (termText().match(/order-bad-\d+/) || [''])[0]));

      await setStep('dead key');
      // WebKit's flush of a dead ' that did not combine: compositionend commits "'",
      // then one keydown carries "'s". Only the "s" is new (Tether a872c3f).
      await runInTerminal('stty -echo; head -n 1 > /tmp/flint-e2e-dead.txt; stty echo; echo head-done-$((6*7))', '');
      await sleep(300);
      {
        const t = activeTerm();
        const ta = activePane().querySelector('textarea');
        t.input("it'", true); // what xterm sends for the committed composition
        ta.dispatchEvent(new CompositionEvent('compositionend', { data: "'", bubbles: true }));
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: "'s", code: 'KeyS', keyCode: 222, bubbles: true, cancelable: true }));
        await sleep(100);
        t.input('\r', true);
      }
      await waitFor(() => termText().includes('head-done-42'), 'head to finish');
      await runInTerminal('echo "[$(cat /tmp/flint-e2e-dead.txt)]-$((6*7))"', ']-42');
      await check(termText().includes("[it's]"), "a dead ' flushed with s types it's, not it''s");

      await setStep('windows clipboard keys');
      // Windows (windows-port): Shift+Insert and Ctrl+V paste, Ctrl+Insert copies, and
      // Ctrl+C copies while text is selected (lib/clipboardKeys.ts). None of them may
      // reach the remote as a key: Shift+Insert used to arrive as ESC[2;2~ and the shell
      // printed "2~". A synthetic key cannot make the webview paste, so this checks that
      // the remote gets only what is typed after them, and that Ctrl+C over a selection
      // does not interrupt.
      if ((await window.backend.app_info({})).os === 'windows') {
        await runInTerminal('stty -echo; head -n 1 > /tmp/flint-e2e-keys.txt; stty echo; echo keys-done-$((6*7))', '');
        await sleep(300);
        const t = activeTerm();
        const ta = qa('.pane > div').find((d) => d.style.display !== 'none').querySelector('textarea');
        const press = (code, key, mods) => ta.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...mods }));
        press('Insert', 'Insert', { shiftKey: true });
        press('KeyV', 'v', { ctrlKey: true });
        press('Insert', 'Insert', { ctrlKey: true });
        t.selectAll();
        press('KeyC', 'c', { ctrlKey: true });
        const cleared = !t.hasSelection();
        await sleep(100);
        t.input('typed-after\r', true);
        await waitFor(() => termText().includes('keys-done-42'), 'head to finish');
        await runInTerminal('echo "[$(cat /tmp/flint-e2e-keys.txt)]-keys$((6*7))"', ']-keys42');
        const got = ([...termText().matchAll(/\[([^\]\n]*)\]-keys42/g)].pop() || ['', '?'])[1];
        await check(got === 'typed-after', 'Shift+Insert, Ctrl+V, Ctrl+Insert and Ctrl+C over a selection send nothing to the remote' + (got === 'typed-after' ? '' : ` — the remote read [${JSON.stringify(got)}]`));
        await check(cleared, 'Ctrl+C over a selection copies and clears it, so the next Ctrl+C interrupts');
      } else {
        await log('skip windows clipboard keys: not Windows');
      }

      await setStep('files view');
      {
        // Milestone 17: the Files view over the tab's own session (D-053). The sshd is
        // this machine, so the host's files are a scratch folder here.
        const mac = (await window.backend.app_info({})).os === 'mac';
        const chord = (code, key, extra = {}) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
          key, code, bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac, shiftKey: !mac, ...extra }));
        const dir = `/tmp/flint-gui-files-${Date.now()}`;
        await runInTerminal(`mkdir -p ${dir}/old && printf hello > ${dir}/a.txt && head -c 33554432 /dev/zero > ${dir}/big.bin && echo files-ready-$((6*7))`, 'files-ready-42');
        chord('KeyE', 'e');
        const aside = () => q('.sidebar[data-for="files"]');
        await waitFor(() => aside()?.dataset.filesPath, 'the Files view to list the login folder', 20000);
        await check(document.querySelector('.app')?.dataset.view === 'files' && q('[data-files-host]')?.textContent === 'local', 'the Files shortcut opens the view on the active tab, "Files · local"');
        // A login shell may report its folder already (zsh on macOS does); bash in the Linux image does not.
        if (q('[data-files-goto-cwd]')?.getAttribute('aria-disabled') === 'true') await check(/OSC 7/.test(q('[data-files-goto-cwd]').title), "Go to the terminal's folder is off, with a hint, while the shell reports none (OSC 7)");
        else await log('note the login shell reports its folder (OSC 7) already');
        // OSC 7 from the shell: the crosshair takes the view to the terminal's folder.
        await runInTerminal(`cd ${dir} && printf '\\033]7;file://e2e%s\\033\\\\' "$PWD"; echo osc7-$((6*7))`, 'osc7-42');
        await waitFor(() => q('[data-files-goto-cwd]')?.getAttribute('aria-disabled') === 'false', 'the OSC 7 folder');
        q('[data-files-goto-cwd]').click();
        await waitFor(() => aside()?.dataset.filesPath === dir && q('[data-file="a.txt"]'), 'the scratch folder listed');
        await check(q('[data-files-count]')?.textContent === 'Synced with terminal', "Go to the terminal's folder lists the shell's folder, synced");
        await check(q('[data-file="old"]')?.dataset.kind === 'dir' && qa('.frow[data-file]')[0]?.dataset.file === 'old', 'folders come first, with sizes and dates beside files');
        // New folder, rename, delete.
        await click('[data-files-mkdir]');
        await fill('#ta', 'made');
        await click('.modal button[type="submit"]');
        await waitFor(() => q('[data-file="made"]'), 'the new folder');
        await check(q('[data-file="made"]').dataset.kind === 'dir', 'New folder creates a folder on the host');
        q('[data-file="a.txt"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }));
        await click('.menu .mi', 'Rename');
        await fill('#ta', 'b.txt');
        await click('.modal button[type="submit"]');
        await waitFor(() => q('[data-file="b.txt"]') && !q('[data-file="a.txt"]'), 'the renamed file');
        await check(q('[data-file="b.txt"].sel'), 'Rename renames on the host and keeps the file selected');
        q('[data-file="old"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }));
        await click('.menu .mi', 'Delete');
        await waitFor(() => hasText('Delete old?'), 'the delete confirmation');
        await click('.modal .btn-danger', 'Delete folder');
        await waitFor(() => !q('[data-file="old"]'), 'the folder to go');
        await check(true, 'Delete asks first, then removes the folder');
        // Into a folder and back up with ⌘↑.
        q('[data-file="made"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await waitFor(() => aside()?.dataset.filesPath === dir + '/made', 'the subfolder');
        {
          // A narrow panel shrinks the folders above, never the one being shown.
          const nav = q('[data-files-crumbs]');
          nav.style.maxWidth = '140px';
          const cur = nav.querySelector('.cur-c');
          // Reading the boxes lays the page out; no frame is needed (none comes in a headless run).
          const box = cur && { cr: cur.getBoundingClientRect().right, nr: nav.getBoundingClientRect().right, nw: nav.getBoundingClientRect().width, sw: cur.scrollWidth, cw: cur.clientWidth };
          const fits = box && cur.textContent === 'made' && box.nw <= 140.5 && box.cr <= box.nr + 0.5 && box.sw <= box.cw;
          nav.style.maxWidth = '';
          await check(fits, 'in a narrow panel the breadcrumb keeps the current folder whole' + (fits ? '' : ` ${JSON.stringify(box)}`));
        }
        q('[data-files-list]').focus();
        q('[data-files-list]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac, shiftKey: !mac }));
        // The path changes before the listing arrives ("Loading…"): wait for the rows too.
        await waitFor(() => aside()?.dataset.filesPath === dir && q('[data-file="made"]'), 'back up one folder, listed');
        await check(q('[data-file="made"].sel'), 'the up chord climbs one folder and selects where it came from');
        {
          // A path typed or pasted in the path bar: the Go to folder chord, `/` in the
          // list, or a click on the current folder turn the breadcrumb into a field.
          const list = () => q('[data-files-list]');
          const field = () => q('[data-files-path-input]');
          const enter = (k) => field().dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
          list().focus();
          list().dispatchEvent(new KeyboardEvent('keydown', { key: 'G', code: 'KeyG', bubbles: true, cancelable: true, shiftKey: true, metaKey: mac, ctrlKey: !mac }));
          await waitFor(() => field(), 'the path field');
          await check(field().value === dir && !q('[data-files-crumbs]'), 'the Go to folder chord turns the breadcrumb into a field holding the path');
          await fill('[data-files-path-input]', `  ${dir}//made/  `);
          enter('Enter');
          await waitFor(() => aside()?.dataset.filesPath === dir + '/made' && !field(), 'the typed folder');
          await check(q('[data-files-crumbs] .cur-c')?.textContent === 'made', 'a path typed in the field goes there, and the breadcrumb comes back');
          list().focus();
          list().dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', bubbles: true, cancelable: true }));
          await waitFor(() => field(), 'the path field from a slash');
          await check(field().value === '/', 'a slash typed in the list starts a path in the field');
          await fill('[data-files-path-input]', `${dir}/b.txt`);
          enter('Enter');
          await waitFor(() => aside()?.dataset.filesPath === dir && q('[data-file="b.txt"].sel'), "the file's folder");
          await check(!field(), "a file's path opens its folder with the file selected");
          q('[data-files-crumbs] .cur-c').click();
          await waitFor(() => field(), 'the path field from a click');
          await fill('[data-files-path-input]', `${dir}/no-such-folder`);
          enter('Enter');
          await waitFor(() => field()?.getAttribute('aria-invalid') === 'true', 'the field marked as wrong');
          await check(aside()?.dataset.filesPath === dir && q('[data-file="b.txt"]'), 'a path that does not exist keeps the folder shown and the field open');
          await fill('[data-files-path-input]', 'made/../made');
          enter('Enter');
          await waitFor(() => aside()?.dataset.filesPath === dir + '/made' && !field(), 'the relative folder');
          q('[data-files-crumbs] .cur-c').click();
          await waitFor(() => field(), 'the path field again');
          enter('Escape');
          await waitFor(() => !field() && q('[data-files-crumbs]'), 'the breadcrumb back');
          await check(aside()?.dataset.filesPath === dir + '/made', 'Esc leaves the field and the folder as they were');
          q('[data-files-crumbs] button[title="' + dir + '"]').click();
          await waitFor(() => aside()?.dataset.filesPath === dir, 'back in the scratch folder');
        }
        // A drop from the OS: the page stages the bytes, then uploads them (CF-004).
        const dt = new DataTransfer();
        dt.items.add(new File(['dropped-bytes-42\n'], 'dropped.txt', { type: 'text/plain' }));
        aside().dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        await waitFor(() => q('[data-files-dropzone]'), 'the drop zone');
        await check(q('[data-files-dropzone]').textContent.includes(`local:${dir}`), 'dragging files over the sidebar shows the drop zone and the remote folder');
        aside().dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        await waitFor(() => q('[data-transfer="dropped.txt"][data-state="done"]'), 'the dropped file uploaded', 20000);
        await waitFor(() => q('[data-file="dropped.txt"]'), 'the uploaded file in the list');
        await runInTerminal(`cat ${dir}/dropped.txt; ls -a ${dir} | grep -c flint-part; echo drop-check-$((6*7))`, 'drop-check-42');
        await check(termText().includes('dropped-bytes-42') && /\n0\n/.test(termText()), 'a file dropped from the OS lands on the host byte for byte, with no part file left');
        // The same name again: the row asks before it replaces.
        const dt2 = new DataTransfer();
        dt2.items.add(new File(['second-version\n'], 'dropped.txt'));
        aside().dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
        await waitFor(() => q('[data-transfer="dropped.txt"][data-state="conflict"]'), 'the replace question');
        await check(true, 'an upload over an existing file asks first');
        q('[data-transfer="dropped.txt"][data-state="conflict"] [data-transfer-replace]').click();
        await waitFor(() => qa('[data-transfer="dropped.txt"][data-state="done"]').length === 2, 'the replaced upload');
        await runInTerminal(`cat ${dir}/dropped.txt; echo replace-check-$((6*7))`, 'replace-check-42');
        await check(termText().includes('second-version'), 'Replace uploads over the existing file');
        await click('[data-files-clear]');
        await check(!q('[data-transfer]'), 'Clear done empties the queue of finished transfers');
        // A download and a cancel, through the same RPC the save dialog leads to.
        const session = aside().dataset.filesSession;
        // The local side is the app's own path. On the Windows VM the test sshd is MSYS2's,
        // whose /tmp is not the native app's (there /tmp is C:\tmp): the shell names it.
        let local = dir;
        if (!mac && (await window.backend.app_info({})).os === 'windows') {
          await runInTerminal(`echo "L[$(cygpath -m ${dir})]L-$((6*7))"`, ']L-42');
          local = ([...termText().matchAll(/L\[([^\]\n]*)\]L-42/g)].pop() || ['', dir])[1];
        }
        const res = await window.backend.files_transfer({ session, id: 'e2e-dl', direction: 'download', local: local + '/made/b-copy.txt', remote: dir + '/b.txt', recursive: false, force: true });
        await check(res.bytes === 5, 'a download over the tab\'s session copies the file');
        let heard = 0;
        const off = window.runtime.EventsOn('files:transfer', (ev) => { if (ev.id === 'e2e-cancel') heard++; });
        const started = window.backend.files_transfer({ session, id: 'e2e-cancel', direction: 'download', local: local + '/made/big-copy.bin', remote: dir + '/big.bin', recursive: false, force: true })
          .then(() => 'finished', (err) => String(err));
        await waitFor(() => heard > 0, 'progress of the big download');
        await window.backend.files_cancel({ id: 'e2e-cancel' });
        const outcome = await started;
        off();
        await check(/cancelled/.test(outcome), 'a running transfer reports progress and stops when cancelled: ' + outcome);
        await runInTerminal(`ls -a ${dir}/made | grep -c -e flint-part -e big-copy; echo cancel-check-$((6*7))`, 'cancel-check-42');
        await check(/\n0\n/.test(termText()), 'a cancelled download leaves no partial file');
        // The terminal still works beside SFTP, and the Files button toggles the view.
        await runInTerminal('echo beside-sftp-$((6*7))', 'beside-sftp-42');
        await check(true, 'the terminal keeps working beside the Files view');
        // A narrow window (under 1040 px) lays the sidebar over the terminal: it must be
        // drawn whole there, the top-most thing at its centre (milestone 21).
        const overTerminal = (sel) => {
          const el = q(sel);
          const r = el?.getBoundingClientRect();
          if (!r || r.height < 300) return false;
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return el.contains(at) && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)';
        };
        // The headless window cannot be resized (CF-111), so the page is told it is 900 px
        // wide: the shell lays the sidebar out by window.innerWidth.
        const width = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        const setWidth = (w) => {
          if (w) Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => w });
          else if (width) Object.defineProperty(window, 'innerWidth', width);
          else delete window.innerWidth;
          window.dispatchEvent(new Event('resize'));
        };
        setWidth(900);
        await waitFor(() => document.querySelector('.app')?.dataset.narrow === 'true', 'the narrow layout', 10000);
        await click('.rail-btn', 'Files');
        await waitFor(() => overTerminal('.sidebar[data-for="files"]'), 'the Files view drawn over the terminal in a narrow window', 10000);
        await check(true, 'in a narrow window the Files view is drawn whole, over the terminal');
        await click('.rail-btn', 'Hosts');
        await waitFor(() => overTerminal('.sidebar[data-for="hosts"]'), 'the Hosts view drawn over the terminal in a narrow window', 10000);
        await check(true, 'in a narrow window the Hosts view is drawn whole, over the terminal');
        setWidth(0);
        await waitFor(() => document.querySelector('.app')?.dataset.narrow === 'false', 'the wide layout again', 10000);
        await runInTerminal(`rm -rf ${dir}; cd; echo files-clean-$((6*7))`, 'files-clean-42');
        if (document.querySelector('.app')?.dataset.view !== 'hosts' || !q('.sidebar[data-for="hosts"]')) await click('.rail-btn', 'Hosts');
        await waitFor(() => document.querySelector('.app')?.dataset.view === 'hosts' && q('.sidebar[data-for="hosts"]'), 'back to the Hosts view');
      }

      await setStep('exit');
      await type('exit 7');
      await enter();
      await waitFor(() => hasText('Session ended'), 'the session ended card');
      await check(hasText('with status 7'), 'the remote exit status is shown');
      await click('.rail-btn', 'Files');
      await waitFor(() => q('[data-files-empty]'), 'the Files view without a session');
      await check(hasText('Open a session to browse its files') && q('[data-files-reconnect]'), 'Files on an ended session offers Reconnect (14c)');
      await click('.rail-btn', 'Hosts');
      await click('.pane-dim .btn-primary', 'Reconnect');
      await waitFor(() => toolbarIs('ready'), 'the reconnected session', 30000);
      await check(!hasText('before connecting'), 'a reconnect to a known host does not ask again');
      await runInTerminal('echo again-ok', 'again-ok');
      await check(true, 'the reconnected session works');

      await setStep('jump host');
      await newSshHost('.side-head .icon-btn[aria-label^="New host"]');
      await fill('#ha', 'inner');
      await fill('#hh', 'localhost');
      await fill('#hp', PORT2);
      await click('.seg button', 'Key');
      await pick('SSH key', 'e2e-key');
      await fill('#hu', USER);
      await pick('Jump host', 'local');
      await click('.modal button[type="submit"]', 'Add host');
      await waitFor(() => byText('.tree .ti', 'inner'), 'inner in the tree');
      byText('.tree .ti', 'inner').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await waitFor(() => hasText('before connecting'), 'the second hop host key prompt');
      await check(q('.kv dd')?.textContent === `[localhost]:${PORT2}`, 'only the unknown hop asks');
      await click('button[type="submit"]', 'Trust and connect');
      await waitFor(() => toolbarIs('ready'), 'the jump session', 30000);
      await runInTerminal('echo via-jump-ok', 'via-jump-ok');
      await check(qa('.tab').length === 2, 'the jump session opened in a second tab');

      await setStep('tabs');
      await click('.tab', 'local');
      await waitFor(() => termText().includes('again-ok'), 'the first tab terminal');
      await check(termText().includes('again-ok') && !termText().includes('via-jump-ok'), 'each tab keeps its own scrollback');

      await setStep('copy between servers');
      {
        // Milestone 19: a second Files pane on another host, floating beside the view
        // (D-059), and copies host → Flint → host. Both sshds are this machine and the
        // same user, so both login folders are this $HOME.
        const mac = (await window.backend.app_info({})).os === 'mac';
        const chord = (code, key, extra = {}) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
          key, code, bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac, shiftKey: !mac, ...extra }));
        const name = `flint-e2e-two-${Date.now()}`;
        await runInTerminal(`mkdir -p ~/${name}/src/sub ~/${name}/dst && printf hello-relay > ~/${name}/src/a.txt && printf deep-relay > ~/${name}/src/sub/x.txt && cd ~/${name}/src && printf '\\033]7;file://e2e%s\\033\\\\' "$PWD"; echo two-ready-$((6*7))`, 'two-ready-42');
        chord('KeyE', 'e');
        const aside = () => q('.sidebar[data-for="files"]');
        await waitFor(() => aside()?.dataset.filesPath?.endsWith(`/${name}/src`) && q('[data-file="a.txt"]'), 'the Files view on the OSC 7 folder', 20000);
        await check(true, "the Files view opens on the terminal's folder by itself (OSC 7)");
        const base = aside().dataset.filesPath.replace(/\/src$/, '');
        // 14d1: the picker, this tab's host greyed out.
        await click('[data-files-pick]');
        await waitFor(() => q('[data-files-picker]'), 'the server picker');
        const me = byText('[data-files-picker] .picker-row.off', 'local');
        await check(me && me.textContent.includes('this tab') && q('[data-files-pick-host="inner"]'), "the picker lists the vault's hosts and greys out this tab's (14d1)");
        await click('[data-files-pick-host="inner"]');
        const pane = () => q('[data-files-pane="2"]');
        await waitFor(() => pane()?.dataset.pairStatus === 'ready' && pane().dataset.filesPath, 'the second pane listed', 20000);
        await check(pane().textContent.includes('its tab’s session') && qa('.tab').length === 2, "a host with an open tab lends that tab's session: no new login");
        const main = q('.main').getBoundingClientRect();
        await check(pane().getBoundingClientRect().left >= aside().getBoundingClientRect().right - 2 && Math.abs(main.left - aside().getBoundingClientRect().right) < 3,
          'the second pane floats over the terminal, which keeps its width (D-059)');
        const into = async (folder, path) => {
          pane().querySelector(`[data-file="${folder}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          // Every folder entered here holds something: wait for its rows, not only its path
          // (the path changes first; the Windows VM's MSYS2 SFTP lists late).
          await waitFor(() => pane().dataset.filesPath === path && pane().querySelector('.frow[data-file]'), 'the second pane in ' + path + ', listed');
        };
        await waitFor(() => pane().querySelector(`[data-file="${name}"]`), 'the scratch folder in the second pane');
        await into(name, base);
        {
          // The second pane's path bar takes a typed path too; Esc in the field closes
          // the field, not the pane.
          const field = () => pane().querySelector('[data-files-pane-path-input]');
          const key = (k) => field().dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
          pane().querySelector('[data-files-pane-crumbs] .cur-c').click();
          await waitFor(() => field(), "the second pane's path field");
          key('Escape');
          await waitFor(() => !field(), "the second pane's breadcrumb back");
          await check(pane() && pane().dataset.filesPath === base, 'Esc in the second pane’s path field closes the field and keeps the pane');
          pane().querySelector('[data-files-pane-crumbs] .cur-c').click();
          await waitFor(() => field(), "the second pane's path field again");
          setValue(field(), base + '/dst');
          key('Enter');
          await waitFor(() => pane().dataset.filesPath === base + '/dst' && !field(), 'the second pane in the typed folder');
          await check(true, 'a path typed in the second pane goes there');
        }
        // 14d3a: drag a file from the first pane onto the second.
        const drag = async (row, target) => {
          const dt = new DataTransfer();
          row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
          target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 700, clientY: 300 }));
          await waitFor(() => q('[data-files-drag-label]'), 'the drag label');
          const label = q('[data-files-drag-label]').textContent;
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
          row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
          return label;
        };
        const row1 = (n) => aside().querySelector(`:scope > .col [data-file="${n}"]`);
        const label = await drag(row1('a.txt'), pane().querySelector('[data-files-list]'));
        await check(label.includes('Copy to inner · dst/'), 'dragging over the other pane names its host and folder (14d3a): ' + label);
        await waitFor(() => q('[data-transfer="a.txt"][data-direction="relay"][data-state="done"]'), 'the copy between servers', 20000);
        await check(q('[data-transfer="a.txt"] [data-transfer-route]')?.textContent === 'localinner', 'the queue row reads local → inner (14d4)');
        await waitFor(() => pane().querySelector('[data-file="a.txt"]'), 'the copy listed in the second pane');
        // The same name again: the strip asks (14d4); Replace copies over it.
        await drag(row1('a.txt'), pane().querySelector('[data-files-list]'));
        await waitFor(() => q('.conflict[data-transfer="a.txt"]'), 'the replace question');
        await check(q('.conflict[data-transfer="a.txt"]').textContent.includes('already exists on inner in dst/'), 'a name clash names the host and folder');
        q('.conflict[data-transfer="a.txt"] [data-transfer-replace]').click();
        await waitFor(() => qa('[data-transfer="a.txt"][data-state="done"]').length === 2, 'the replaced copy');
        // ⌘→ (Ctrl+Shift+→) copies the selection: a folder, with what is in it.
        row1('sub').click();
        await sleep(150);
        aside().querySelector(':scope > .col [data-files-list]').focus();
        chord('ArrowRight', 'ArrowRight');
        await waitFor(() => q('[data-transfer="sub"][data-direction="relay"][data-state="done"]'), 'the folder copy', 20000);
        await runInTerminal(`cat ${base}/dst/a.txt ${base}/dst/sub/x.txt; ls -a ${base}/dst | grep -c flint-part; echo relay-check-$((6*7))`, 'relay-check-42');
        await check(termText().includes('hello-relaydeep-relay') && /\n0\n/.test(termText()), 'files and folders land on the other host byte for byte, with no part file left');
        // Hiding is not closing (D-059): Esc hides the pane, the chip brings it back as it was.
        pane().querySelector('[data-files-list]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await waitFor(() => !pane() && q('[data-files-pair-chip]'), 'the hidden pane');
        await check(q('[data-files-pair-chip]').textContent.includes('inner'), 'a hidden pane leaves a chip naming its host');
        q('[data-files-pair-chip]').click();
        await waitFor(() => pane()?.dataset.filesPath === base + '/dst', 'the pane back');
        await check(true, 'the chip shows the pane again on the same folder');
        q('.pane').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await waitFor(() => !pane(), 'a click in the terminal hides the pane');
        q('[data-files-pair-chip]').click();
        await waitFor(() => pane(), 'the pane back again');
        await click('[data-files-one-pane]');
        await waitFor(() => !pane() && q('[data-files-pick]'), 'one pane');
        await check(qa('.tab').length === 2, 'One pane ends the mode and leaves the borrowed tab alone');

        // A host with no open tab: a session with no terminal, its host key asked in the pane (14d5c).
        await click('.rail-btn', 'Hosts');
        await newSshHost('.side-head .icon-btn[aria-label^="New host"]');
        await fill('#ha', 'side');
        await fill('#hh', '127.0.0.1');
        await fill('#hp', PORT2);
        await click('.seg button', 'Key');
        await pick('SSH key', 'e2e-key');
        await fill('#hu', USER);
        await click('.modal button[type="submit"]', 'Add host');
        await waitFor(() => byText('.tree .ti', 'side'), 'side in the tree');
        chord('KeyE', 'e');
        await click('[data-files-pick]');
        await click('[data-files-pick-host="side"]');
        await waitFor(() => pane()?.querySelector('[data-files-pane-hostkey]'), 'the host key question in the pane', 20000);
        await check(pane().textContent.includes('Verify side'), "a new host's key is asked inside the pane (14d5c)");
        await click('[data-files-pane-hostkey] button[type="submit"]');
        await waitFor(() => pane()?.dataset.pairStatus === 'ready' && pane().dataset.filesPath, 'the Flint-only session', 20000);
        await check(pane().textContent.includes('Flint-only session') && qa('.tab').length === 2, 'a host with no tab gets a session of its own with no terminal, and no tab');
        await waitFor(() => pane().querySelector(`[data-file="${name}"]`), 'the scratch folder over the Flint-only session');
        await into(name, base);
        // ⌘← copies from the second pane back to the first: src already has a.txt, so Skip.
        pane().querySelector('[data-file="src"]').click();
        await into('src', base + '/src');
        pane().querySelector('[data-file="a.txt"]').click();
        await sleep(150);
        pane().querySelector('[data-files-list]').focus();
        chord('ArrowLeft', 'ArrowLeft');
        await waitFor(() => q('.conflict[data-transfer="a.txt"]'), 'a copy back to the first pane, asked');
        // Pressed again, or held so the key repeats, while it waits: still one copy (owner walkthrough).
        chord('ArrowLeft', 'ArrowLeft');
        chord('ArrowLeft', 'ArrowLeft', { repeat: true });
        await sleep(300);
        await check(qa('[data-transfer="a.txt"][data-direction="relay"]:not([data-state="done"])').length === 1,'a second ⌘← while the copy waits does not queue it again');
        q('.conflict[data-transfer="a.txt"] [data-transfer-skip]').click();
        await waitFor(() => !q('.conflict'), 'skipped');
        await check(/Skipped/.test(q('[data-transfer="a.txt"][data-state="cancelled"]')?.textContent ?? ''), 'a copy from the second pane to the first asks before replacing, and Skip leaves it and reads Skipped');
        await click('[data-files-one-pane]');
        await waitFor(() => !pane(), 'one pane');
        await runInTerminal(`cd; rm -rf ~/${name}; echo two-clean-$((6*7))`, 'two-clean-42');
        // Later steps meet [127.0.0.1]:PORT2 as a new host key: leave it as found.
        await window.backend.known_host_rm({ name: 'side' });
        await window.backend.host_rm({ name: 'side' });
        await click('[data-files-clear]');
        await click('.rail-btn', 'Hosts');
        await waitFor(() => document.querySelector('.app')?.dataset.view === 'hosts', 'back to the Hosts view');
      }

      await setStep('split panes');
      {
        const mac = (await window.backend.app_info({})).os === 'mac';
        // App chords where the terminal has the focus: ⌘ is Ctrl+Shift on Linux, ⇧⌘ is
        // Ctrl+Alt+Shift and ⌥⌘ is Ctrl+Alt.
        const send = (code, layer = '') => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
          key: '', code, bubbles: true, cancelable: true,
          ...(mac ? { metaKey: true, shiftKey: layer === 'shift', altKey: layer === 'alt' }
            : { ctrlKey: true, shiftKey: layer !== 'alt', altKey: layer !== '' }),
        }));
        const panes = () => qa('.spane', activeRegion());
        const grid = () => activeRegion()?.querySelector('.splits');
        const sessionCount = () => Number((q('.statusbar')?.textContent.match(/(\d+) sessions?/) ?? [0, 0])[1]);
        const paneTerm = (el) => window.__flintE2E.terms[el.querySelector('[data-tab]').getAttribute('data-tab')];
        const termOf = (el) => { const b = paneTerm(el).buffer.active; const out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? ''); return out.join('\n'); };
        await click('.tab', 'local');
        await waitFor(() => toolbarIs('ready'), 'the local tab');
        const tabsBefore = qa('.tab').length;
        const sessionsBefore = sessionCount();
        (await waitFor(() => activePane()?.querySelector('textarea'), 'terminal')).focus();
        send('KeyD', 'alt');
        await waitFor(() => qa('.tab').length === tabsBefore + 1 && toolbarIs('ready'), 'a duplicated tab', 30000);
        await check(q('.tab.on')?.textContent.includes('local'), 'Duplicate moved to ⌥⌘D (Ctrl+Alt+D) and opens a new tab of the host');
        await check(q('[data-split-button]') && !q('[data-split-button]').getAttribute('aria-disabled'), "the toolbar's Split button is on");

        activePane().querySelector('textarea').focus();
        send('KeyD');
        await waitFor(() => panes().length === 2, 'a second pane');
        await check(grid().classList.contains('multi') && grid().style.gridTemplateColumns.split('fr').length - 1 === 2 && qa('.tab').length === tabsBefore + 1,
          '⌘D (Ctrl+Shift+D) splits the tab right, in the same tab');
        await check(panes()[1].classList.contains('focus') && q('[data-pane-badge]')?.textContent === 'pane 2 of 2' && /2/.test(q('.tab.on .tab-split')?.textContent ?? ''),
          'the new pane has the focus, the toolbar says "pane 2 of 2" and the tab shows two panes');
        await waitFor(() => toolbarIs('ready'), 'the second pane connected', 30000);
        await runInTerminal('echo pane-two-$$-$((6*7))', 'pane-two-');
        const pid = await waitFor(() => (termText().match(/pane-two-(\d+)-42/) ?? [])[1], "pane two's shell pid");
        await check(!termOf(panes()[0]).includes('pane-two-'), 'each pane is its own session with its own scrollback');
        await check(getComputedStyle(panes()[0].querySelector('[data-tab]')).opacity === '0.6' && getComputedStyle(panes()[1].querySelector('[data-tab]')).opacity === '1',
          "the other pane's output is dimmed to 60 %");
        await check(sessionCount() === sessionsBefore + 2, 'the status bar counts each pane as a session');

        send('KeyD', 'shift');
        await waitFor(() => panes().length === 3, 'a third pane');
        await check(panes()[0].style.gridRow.includes('span 2'), '⇧⌘D with three panes makes one large + two small');
        await waitFor(() => toolbarIs('ready'), 'the third pane connected', 30000);

        // The palette's ⇧⌘↵ opens a host in a new pane (18e).
        send('KeyK');
        await fill('.palette input', 'inner');
        await waitFor(() => q('[data-palette-hints]')?.textContent.includes('new pane'), 'the new pane hint');
        await check(byText('[role="option"]', 'in a new pane'), 'the palette offers "Open inner in a new pane"');
        q('.palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac, shiftKey: true }));
        await waitFor(() => panes().length === 4, 'a fourth pane');
        await check(grid().style.gridTemplateRows.split('fr').length - 1 === 2 && panes()[3].textContent.includes('inner'), "⇧⌘↵ in the palette opens the host in a new pane; four make a grid");
        await waitFor(() => toolbarIs('ready'), 'inner connected in its pane', 30000);
        activePane().querySelector('textarea').focus();
        send('KeyD');
        await sleep(200);
        await check(panes().length === 4 && hasText('A tab holds up to 4 panes'), 'a fifth pane is refused with a note');

        send('Digit1', 'alt');
        await waitFor(() => grid().style.gridTemplateColumns.split('fr').length - 1 === 4, 'side by side');
        await check(true, '⌥⌘1 (Ctrl+Alt+1) lays the four panes side by side');
        send('Digit3', 'alt');
        await waitFor(() => grid().style.gridTemplateRows.split('fr').length - 1 === 2, 'the grid again');
        await check(true, '⌥⌘3 (Ctrl+Alt+3) puts them back in a grid');

        send('BracketLeft');
        await waitFor(() => panes()[2].classList.contains('focus'), 'focus on pane 3');
        send('BracketRight');
        send('BracketRight');
        await waitFor(() => panes()[0].classList.contains('focus'), 'focus wraps to pane 1');
        await check(q('[data-pane-badge]')?.textContent === 'pane 1 of 4', '⌘[ and ⌘] move the focus between panes, wrapping around');
        panes()[3].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await waitFor(() => panes()[3].classList.contains('focus'), 'a click focuses pane 4');
        await check(q('.toolbar .mono.strong')?.textContent === 'inner', 'a click focuses a pane, and the toolbar follows it');

        await click('[data-toolbar-files]');
        await waitFor(() => q('[data-files-host]')?.textContent === 'inner', 'Files on inner');
        await check(q('[data-files-pane-no]')?.textContent === '4', "the Files view follows the focused pane and carries its number (18g)");
        panes()[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await waitFor(() => q('[data-files-host]')?.textContent === 'local' && q('[data-files-pane-no]')?.textContent === '2', 'Files follows to pane 2');
        await check(true, 'focusing another pane moves the Files view to it');
        await click('[data-toolbar-files]');
        await click('.rail-btn', 'Hosts');

        const div = q('.sp-div.cols', activeRegion());
        const before = grid().style.gridTemplateColumns;
        div.focus();
        div.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await waitFor(() => grid().style.gridTemplateColumns !== before, 'the columns resized');
        await check(/0\.55fr/.test(grid().style.gridTemplateColumns), 'a divider resizes the panes beside it');
        div.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await waitFor(() => grid().style.gridTemplateColumns === before, 'evened out');
        await check(true, 'a double-click on a divider evens the panes out');

        // Close pane 2 with its ×: only its session hangs up.
        panes()[1].querySelector('.sp-x').click();
        await waitFor(() => panes().length === 3, 'three panes');
        await check(sessionCount() === sessionsBefore + 3, 'closing a pane hangs up its session');
        panes()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await waitFor(() => panes()[0].classList.contains('focus'), 'pane 1 focused');
        // A process that has exited but is not reaped yet still answers kill -0: look at its state.
        await runInTerminal(`for i in $(seq 1 30); do s=$(ps -o stat= -p ${pid} 2>/dev/null); case "$s" in ''|Z*) break;; esac; sleep 0.5; done; s=$(ps -o stat= -p ${pid} 2>/dev/null); case "$s" in ''|Z*) echo pane-gone-$((40+2));; *) echo pane-still-$((40+1)) "[$s]"; ps -o pid,ppid,stat,args -p ${pid};; esac`, 'pane-');
        await waitFor(() => /pane-(still-41|gone-42)/.test(termText()), 'the check on the closed pane', 25000);
        await check(termText().includes('pane-gone-42'), "the closed pane's shell ended on the host; the other panes keep working" + (termText().includes('pane-gone-42') ? '' : ' — terminal: ' + termText().split('\n').filter((l) => l.trim()).slice(-4).join(' | ')));
        send('KeyW');
        await waitFor(() => panes().length === 2, 'two panes');
        await check(sessionCount() === sessionsBefore + 2, '⌘W closes the focused pane');
        await click('.tab.on .tx');
        await waitFor(() => qa('.tab').length === tabsBefore, 'the split tab closed');
        await check(sessionCount() === sessionsBefore, "closing the tab hangs up every pane's session");
        await click('.tab', 'local');
        await waitFor(() => toolbarIs('ready'), 'back on the local tab');
      }

      await setStep('changed host key');
      await newSshHost('.side-head .icon-btn[aria-label^="New host"]');
      await fill('#ha', 'moved');
      await fill('#hh', '127.0.0.1');
      await fill('#hp', PORT3);
      await click('.seg button', 'Key');
      await pick('SSH key', 'e2e-key');
      await fill('#hu', USER);
      await click('.modal button[type="submit"]', 'Add host');
      await waitFor(() => byText('.tree .ti', 'moved'), 'moved in the tree');
      byText('.tree .ti', 'moved').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await waitFor(() => hasText('before connecting'), 'the first host key prompt for moved');
      await click('button[type="submit"]', 'Trust and connect');
      await waitFor(() => toolbarIs('ready'), 'moved, first contact', 30000);
      await type('exit');
      await enter();
      await waitFor(() => hasText('Session ended'), 'moved to end');
      // The forwarder now reaches the other sshd: same address, another key.
      await click('.pane-dim .btn-primary', 'Reconnect');
      await waitFor(() => hasText('has changed'), 'the changed key card', 30000);
      await check(qa('.fp').length === 2, 'the card shows the trusted and the presented key');
      const replace = byText('.pane-dim button', 'Replace key and connect');
      await check(replace.getAttribute('aria-disabled') === 'true', 'Replace is disabled until the alias is typed');
      replace.click();
      await sleep(200);
      await check(hasText('has changed'), 'clicking the disabled Replace does nothing');
      await check(document.activeElement?.textContent.includes('Close session'), 'the safe action has the initial focus');
      await fill('.pane-dim input', 'moved');
      await click('.pane-dim button', 'Replace key and connect');
      await waitFor(() => hasText('before connecting'), 'a fresh host key prompt after replacing', 30000);
      await click('button[type="submit"]', 'Trust and connect');
      await waitFor(() => toolbarIs('ready'), 'moved, new key', 30000);
      await check(true, 'replacing the key forgets the old one and asks again');

      // Milestone 68: a live terminal tab through a switch to Spanish and back: the
      // session keeps running, the chrome around it changes language, no English left.
      await setStep('a terminal tab in Spanish');
      {
        const cats = window.__flintE2E.catalogs;
        const esValues = Object.values(cats.es);
        const pieces = [...new Set(Object.entries(cats.en).flatMap(([k, v]) => v.split(/\{\w+\}/)
          .map((p) => p.trim()).filter((p) => /[A-Za-z]{2,}\W+[A-Za-z]{2,}/.test(p) && p.length >= 10 && cats.es[k] !== v && !esValues.some((e) => e.includes(p)))))];
        // The terminal's own text is the remote's, in whatever language it speaks.
        const chrome = () => { const c = q('.app').cloneNode(true); c.querySelectorAll('.xterm').forEach((x) => x.remove()); return c.innerText; };
        const tabEl = q('.tab.on');
        await type('echo before-es-$((40+2))');
        await enter();
        await waitFor(() => termText().includes('before-es-42'), 'the marker before the switch');
        await click('.rail-btn', 'Settings');
        await click('.nav-i', 'Appearance');
        await click('[data-language="es"]');
        await waitFor(() => document.documentElement.lang === 'es', 'the page in Spanish');
        await click('.rail-btn', 'Hosts');
        await waitFor(() => toolbarIs('ready'), 'the terminal tab in Spanish');
        await check(tabEl.isConnected && termText().includes('before-es-42'), 'the tab and its terminal are the same through the switch');
        await type('echo after-es-$((40+3))');
        await enter();
        await waitFor(() => termText().includes('after-es-43'), 'the session still answers in Spanish');
        await check(!!q('[title^="Dividir"]') && !!q('[title^="Archivos"]') && hasText('Hosts'), "the tab's toolbar reads Dividir and Archivos");
        // A toast keeps the language it was shown in: clear the ones from before.
        window.__flintE2E.toasts?.clear();
        await sleep(300);
        const left = pieces.filter((p) => chrome().includes(p));
        if (left.length) await log('diag: English left around the terminal: ' + JSON.stringify(left));
        await check(left.length === 0, `the window around a terminal tab is in Spanish (${left.length} English texts left)`);
        await click('.rail-btn', 'Ajustes');
        await click('.nav-i', 'Apariencia');
        await click('[data-language="system"]');
        await waitFor(() => document.documentElement.lang === 'en', 'the page in English again');
        await click('.rail-btn', 'Hosts');
        await waitFor(() => toolbarIs('ready'), 'the terminal tab in English again');
        await check(true, 'back to System: English again');
      }
    }


    if (RUN === 'rdp') {
      await setStep('rdp: first connection asks for the certificate');
      const isMac = (await window.backend.app_info({})).os === 'mac';
      const chord = (k, code) => (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, metaKey: isMac, ctrlKey: !isMac, shiftKey: !isMac }));
      // Through the RDP editor, as a person adds one (the tree reloads on save).
      const addRdp = async (alias, port, password) => {
        await click('.side-head .icon-btn[aria-label^="New host"]');
        await waitFor(() => q('[data-host-type-step]'), 'the type step');
        await click('.type-card[data-type="rdp"]');
        await click('.modal button', 'Continue');
        await waitFor(() => q('[data-rdp-editor]'), 'the RDP editor');
        await fill('#ra', alias);
        await fill('#rh', '127.0.0.1');
        await fill('#rp', String(port));
        await fill('#ru', 'e2e');
        await fill('#rd', 'LAB');
        await fill('.modal input[aria-label="Password"]', password);
        await click('.modal button[type="submit"]', 'Add host');
        await waitFor(() => byText('.tree .ti', alias), alias + ' in the tree');
      };
      await addRdp('rdp-sample', RPORT, 'rdp-pw-marker');
      await addRdp('rdp-closed', 9, 'x');
      await addRdp('rdp-fwd', RPORT_FWD, 'x');
      // Milestone 34: the sample server's desktop is drawn in 2D (forced); the test
      // server's below takes this machine's renderer (WebGL on a real GPU). Neither
      // offers the graphics pipeline (ROADMAP, "RDPGFX in Flint's test server").
      window.__flintRdpRenderer = '2d';
      const open = async (alias) => {
        const r = await waitFor(() => byText('.tree .ti', alias), alias + ' in the tree');
        r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      };
      const rdpState = (st) => q(`.tab.on`) && q(`[data-rdp-state="${st}"]`, activeRegion());
      await open('rdp-sample');
      await waitFor(() => rdpState('certificate'), 'the certificate prompt', 30000);
      const fp = q('[data-fingerprint]', activeRegion()).textContent;
      await check(/^([0-9A-F]{2} ){31}[0-9A-F]{2}$/.test(fp), `the prompt shows the SHA-256 fingerprint grouped in bytes (${fp.slice(0, 11)}…)`);
      await check(hasText('CN = flint-test') || hasText('CN=flint-test') || hasText('flint-test'), 'the prompt names the certificate subject');
      await check(byText('.badge', 'self-signed'), 'a self-signed certificate is marked so');
      await check(byText('.tab', 'verify certificate'), 'the tab is labelled "verify certificate"');
      await click('button[type="submit"]', 'Trust and connect');

      await setStep('rdp: the desktop is drawn');
      await waitFor(() => q('[data-rdp-size]'), 'the desktop', 30000);
      const canvas = () => q('canvas.rdp-canvas', activeRegion());
      await waitFor(() => canvas()?.dataset.desktop, 'a first frame', 20000);
      const [dw, dh] = canvas().dataset.desktop.split('x').map(Number);
      const area = q('.rdp-area', activeRegion()).getBoundingClientRect();
      await check(Math.abs(dw - Math.floor(area.width)) <= 2 && Math.abs(dh - Math.floor(area.height)) <= 1,
        `the desktop has the tab's size (${dw}x${dh} for ${Math.floor(area.width)}x${Math.floor(area.height)})`);
      {
        // The desktop canvas may be WebGL (milestone 34): read it through a 2D copy.
        const copy = document.createElement('canvas');
        copy.width = dw;
        copy.height = dh;
        copy.getContext('2d').drawImage(canvas(), 0, 0);
        const px = copy.getContext('2d').getImageData(0, 0, dw, dh).data;
        let lit = 0;
        for (let i = 0; i < px.length; i += 4 * 97) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++;
        await check(lit > 50, `the canvas shows the server's picture (${lit} lit samples)`);
      }
      {
        const tab = q('[data-rdp-session]', activeRegion()).dataset.rdpSession;
        const st = await window.backend.rdp_stats({ tab });
        await check(st.pipeline === 'bitmap' && canvas().dataset.renderer === '2d', `a server without the graphics pipeline gets bitmap updates, drawn in 2D (${st.pipeline}, ${canvas().dataset.renderer})`);
      }
      const known = (await window.backend.catalog({})).known_hosts;
      await check(known.some((k) => k.addr === `rdp://127.0.0.1:${RPORT}` && k.key_type === 'x509'), 'the trusted certificate is kept in the vault');
      await check(q('[data-rdp-toolbar]').textContent.includes('LAB\\e2e'), 'the toolbar names the domain user');

      await setStep('rdp: keyboard and pointer reach the session');
      {
        const cv = canvas();
        const r = cv.getBoundingClientRect();
        cv.focus();
        await check(document.activeElement === cv, 'the desktop takes the keyboard focus');
        cv.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
        cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 20, clientY: r.top + 20 }));
        cv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 20, clientY: r.top + 20 }));
        cv.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, clientX: r.left + 20, clientY: r.top + 20 }));
        const kd = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true });
        cv.dispatchEvent(kd);
        cv.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }));
        await check(kd.defaultPrevented, 'a key on the desktop is taken from the page');
        // ⌘W (Ctrl+Shift+W on Linux) goes to the remote: the tab stays.
        const tabs = qa('.tab').length;
        cv.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true, cancelable: true, metaKey: isMac, ctrlKey: !isMac, shiftKey: !isMac }));
        await sleep(300);
        await check(qa('.tab').length === tabs, 'a Flint chord other than the palette goes to the remote desktop');
        await sleep(300);
        await check(q('[data-rdp-size]') && !q('[data-rdp-state]', activeRegion()), 'input leaves the session up');
        // The palette chord still opens the palette, on an RDP tab too.
        cv.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true, cancelable: true, metaKey: isMac, ctrlKey: !isMac, shiftKey: !isMac }));
        await waitFor(() => q('[aria-label="Command palette"]'), 'the palette from the desktop');
        await check(true, 'the palette chord stays Flint\'s on an RDP tab');
        await fill('[aria-label="Command palette"] input', 'Split right');
        const split = await waitFor(() => byText('[role="option"]', 'Split right'), 'Split right in the palette');
        await check(split.getAttribute('aria-disabled') === 'true' && split.title === 'SSH hosts only', 'the palette greys pane actions on an RDP tab: "SSH hosts only"');
        await fill('[aria-label="Command palette"] input', 'Tunnels view');
        const tv = await waitFor(() => byText('[role="option"]', 'Tunnels view'), 'Tunnels view in the palette');
        await check(tv.getAttribute('aria-disabled') === 'true', 'the palette greys the Tunnels view on an RDP tab');
        q('[aria-label="Command palette"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await waitFor(() => !q('[aria-label="Command palette"]'), 'the palette closed');
      }

      await setStep('rdp: Files says it is for SSH hosts');
      await click('.rail-btn', 'Files');
      await waitFor(() => q('[data-files-rdp]'), 'the Files view on an RDP tab');
      await check(hasText('Files is for SSH hosts'), 'the Files view says a remote desktop has no files to browse');
      await click('.rail-btn', 'Hosts');

      await setStep('rdp: the desktop follows the tab size');
      {
        const before = canvas().dataset.desktop;
        chord('b', 'KeyB');
        await waitFor(() => canvas().dataset.desktop && canvas().dataset.desktop !== before, 'a new desktop size', 30000);
        const now = canvas().dataset.desktop.split('x').map(Number);
        const a = q('.rdp-area', activeRegion()).getBoundingClientRect();
        await check(Math.abs(now[0] - Math.floor(a.width)) <= 2, `a wider tab gets a wider desktop (${before} → ${now.join('x')}), reconnected without Display Control`);
        await check(q('[data-rdp-size]') && !q('[data-rdp-state]', activeRegion()), 'the session is up after the resize');
        chord('b', 'KeyB');
      }

      await setStep('rdp: a quiet second re-reads the desktop, and the mode switches for this tab (milestone 35)');
      {
        const session = () => q('[data-rdp-session]', activeRegion()).dataset.rdpSession;
        const st = await waitForAsync(async () => { const x = await window.backend.rdp_stats({ tab: session() }); return x.rereads > 0 ? x : null; }, 'a quiet re-read', 15000);
        await check(st.rereads > 0 && st.stale_px === 0, `a quiet second re-reads the whole desktop, nothing stale on the sample server (${st.rereads} re-reads, ${st.stale_px} px)`);
        const seg = () => q('[data-rdp-tab-graphics]');
        await check(seg()?.querySelector('[data-graphics="auto"]')?.getAttribute('aria-pressed') === 'true', 'the toolbar shows the tab in Automatic, from Settings');
        {
          const first = await window.backend.rdp_stats({ tab: session() });
          await check(first.mode === 'compatible' && seg().title.includes('local network'), `Automatic picks bitmaps on loopback, a local network (${first.mode}; "${seg().title}")`);
        }
        const size = canvas().dataset.desktop;
        await click('[data-rdp-tab-graphics] button[data-graphics="compatible"]');
        await waitFor(() => seg()?.querySelector('[data-graphics="compatible"]')?.getAttribute('aria-pressed') === 'true' && !q('[data-rdp-graphics-busy]'), 'the tab in Compatible', 30000);
        // The toolbar stops being busy when the desktop is back; the pipeline it took is
        // known with its first update, a moment later (Docker, milestone 68: read as '').
        const settled = () => waitForAsync(async () => { const x = await window.backend.rdp_stats({ tab: session() }); return x.pipeline ? x : null; }, 'the pipeline the reconnected desktop took', 10000);
        const after = await settled();
        await check(after.mode === 'compatible' && after.pipeline === 'bitmap', `the desktop reconnected in Compatible (${after.mode}, ${after.pipeline})`);
        await check(!q('[data-rdp-graphics-note]') && q('[data-rdp-size]') && !q('[data-rdp-state]', activeRegion()) && canvas().dataset.desktop === size, 'the session stays up at its size after the switch');
        await check((await window.backend.settings_get({})).rdp_graphics === 'auto', 'Settings keeps Automatic as the default');
        await click('[data-rdp-tab-graphics] button[data-graphics="pipeline"]');
        await waitFor(() => seg()?.querySelector('[data-graphics="pipeline"]')?.getAttribute('aria-pressed') === 'true' && !q('[data-rdp-graphics-busy]'), 'the tab in Pipeline', 30000);
        {
          const p = await settled();
          await check(p.mode === 'pipeline' && p.pipeline === 'bitmap', `Pipeline asks for the graphics pipeline; the sample server, without it, sends bitmaps (${p.mode}, ${p.pipeline})`);
        }
        await click('[data-rdp-tab-graphics] button[data-graphics="auto"]');
        await waitFor(() => seg()?.querySelector('[data-graphics="auto"]')?.getAttribute('aria-pressed') === 'true' && !q('[data-rdp-graphics-busy]'), 'the tab back in Automatic', 30000);
        await check((await window.backend.rdp_stats({ tab: session() })).mode === 'compatible', 'and back to Automatic, which measures again and picks bitmaps');
      }

      await setStep('rdp: disconnect and connect again');
      {
        // diag (Windows VM, 2026-11-19): Disconnect once ended as "Connection lost — the
        // session is closed". What the tab was doing at the click, and each state after it.
        const stateNow = () => q('[data-rdp-state]', activeRegion())?.dataset.rdpState ?? 'none';
        const sess = q('[data-rdp-session]', activeRegion())?.dataset.rdpSession;
        const stats = sess ? await window.backend.rdp_stats({ tab: sess }).catch((e) => String(e)) : 'no session';
        await log(`diag: before Disconnect: state=${stateNow()} size=${!!q('[data-rdp-size]')} busy=${!!q('[data-rdp-graphics-busy]')} stats=${JSON.stringify(stats)}`);
        const t0 = Date.now();
        const seen = [];
        let last = '';
        const tick = setInterval(() => { const st = stateNow(); if (st !== last) { last = st; seen.push(`${Date.now() - t0}ms:${st}`); } }, 20);
        await click('[data-rdp-disconnect]');
        try {
          await waitFor(() => rdpState('closed'), 'the disconnected card', 20000);
        } finally {
          clearInterval(tick);
          await log(`diag: after Disconnect: ${seen.join(' ')}`);
        }
      }
      await check(byText('.tab', 'disconnected'), 'Disconnect keeps the tab, marked disconnected');
      await click('button', 'Connect again');
      await waitFor(() => q('[data-rdp-size]'), 'the desktop again', 30000);
      await check(!rdpState('certificate'), 'connecting again asks for no certificate');

      await setStep('rdp: the session keeps running under the vault lock (D-072)');
      {
        const vaultPath = (await window.backend.vault_status({})).path;
        await click('.statusbar .sb-btn', 'Lock');
        await waitFor(() => q('.lock-screen'), 'the lock screen');
        await fill('#pw', MASTER);
        await click('button[type="submit"]', 'Unlock');
        await waitFor(() => !q('.lock-screen'), 'the unlock', 30000);
        await check(q('[data-rdp-size]') && !q('[data-rdp-state]', activeRegion()), 'the remote desktop is still up after a lock and unlock');
        void vaultPath;
      }

      await setStep('rdp: a closed port says Remote Desktop is off');
      await open('rdp-closed');
      await waitFor(() => rdpState('rdp-off'), 'the refused card', 30000);
      await check(hasText('refused the session') && hasText('Remote Desktop'), 'a closed RDP port shows "refused the session" and how to turn Remote Desktop on');
      await check(byText('.tab', 'refused'), 'the tab says refused');
      await click('button', 'Close tab');

      await setStep('rdp: a changed certificate is refused');
      await open('rdp-fwd');
      await waitFor(() => rdpState('certificate'), 'the certificate prompt (first server)', 30000);
      await click('button[type="submit"]', 'Trust and connect');
      await waitFor(() => q('[data-rdp-size]'), 'the forwarded desktop', 30000);
      await click('[data-rdp-disconnect]');
      await waitFor(() => rdpState('closed'), 'the disconnected card', 20000);
      await click('button', 'Connect again');
      await waitFor(() => rdpState('cert-changed'), 'the changed certificate card', 30000);
      await check(hasText('has changed') && hasText('Nothing was sent'), 'a changed certificate stops the connection and says nothing was sent');
      await check(!byText('button', 'Trust and connect') && byText('button', 'Open Known hosts'), 'there is no way to continue, only Known hosts');
      await check(byText('.tab', 'certificate changed'), 'the tab says certificate changed');
      const fps = qa('.fp', activeRegion()).map((e) => e.textContent);
      await check(fps.length === 2 && fps[0] !== fps[1], 'both fingerprints are shown');
      await click('button', 'Close tab');

      if (CPORT !== '0') {
        await setStep('rdp: text copied on the remote reaches this machine (milestone 31)');
        // Bounded, and timed when slow (rule 9, milestone 58's Linux run that hung here
        // with no verdict): a test server that stops answering names itself.
        const ctl = async (cmd) => {
          const t0 = performance.now();
          try {
            return await (await fetch(`http://127.0.0.1:${CCTL}/${cmd}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) })).text();
          } catch (e) {
            log(`diag: test server control "${cmd.slice(0, 20)}" failed after ${Math.round(performance.now() - t0)} ms: ${e}`);
            throw e;
          } finally {
            const ms = performance.now() - t0;
            if (ms > 2000) log(`diag: test server control "${cmd.slice(0, 20)}" took ${Math.round(ms)} ms`);
          }
        };
        const hex = (t) => Array.from(new TextEncoder().encode(t), (b) => b.toString(16).padStart(2, '0')).join('');
        const clipNow = async () => { const r = await window.backend.e2e_clipboard({}); return (typeof r === 'string' ? JSON.parse(r) : r)?.name; };
        await addRdp('rdp-clip', CPORT, 'x');
        delete window.__flintRdpRenderer;
        // The desktop drawn with this machine's renderer still shows the server's picture.
        await open('rdp-clip');
        await waitFor(() => rdpState('certificate'), 'the certificate prompt (test server)', 30000);
        await click('button[type="submit"]', 'Trust and connect');
        await waitFor(() => q('[data-rdp-size]'), 'the test server desktop', 30000);

        await ctl('clear');
        await ctl('copy/' + hex('copied in Windows ✓\r\nline two'));
        const got = await waitForAsync(async () => ((await clipNow()) === 'copied in Windows ✓\nline two' ? true : null), 'the remote copy on the clipboard', 15000);
        await check(got, 'text copied on the remote is on this machine\'s clipboard, CRLF as LF');

        await setStep('rdp: text copied here is sent when the remote pastes');
        await window.backend.e2e_clipboard_set({ name: 'from this Mac\nüñí' });
        const cv = canvas();
        cv.blur();
        cv.focus();
        const announced = await waitForAsync(async () => ((await ctl('formats')) === '13' ? true : null), 'the clipboard announced', 15000);
        await check(announced, 'focusing the desktop announces text on the clipboard');
        await check((await ctl('pasted')) === '-', 'nothing is sent before the remote pastes');
        await ctl('paste');
        const pasted = await waitForAsync(async () => ((await ctl('pasted')) === hex('from this Mac\r\nüñí') ? true : null), 'the text at the server', 15000);
        await check(pasted, 'a paste on the remote gets this machine\'s text, LF as CRLF');
        // The owner's case (M31 check): a second copy here, the desktop not clicked
        // again, must reach the next paste instead of the text Windows fetched before.
        await ctl('clear');
        await window.backend.e2e_clipboard_set({ name: 'second copy' });
        const again = await waitForAsync(async () => ((await ctl('formats')) === '13' ? true : null), 'the new copy announced', 15000);
        await check(again, 'a new copy here is announced with the desktop left as it was');
        await ctl('paste');
        const second = await waitForAsync(async () => ((await ctl('pasted')) === hex('second copy') ? true : null), 'the second text at the server', 15000);
        await check(second, 'the next paste on the remote gets the new text, not the old one');

        await setStep('rdp: modifier keys follow the preset');
        const press = async (code) => {
          const c = canvas();
          c.focus();
          c.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
          c.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
          await sleep(200);
        };
        const keysAfter = async (code) => { await ctl('clear'); await press(code); return waitForAsync(async () => { const k = await ctl('keys'); return k !== '-' ? k : null; }, 'keys at the server', 10000); };
        if (isMac) {
          await check((await keysAfter('MetaLeft')) === 'd:0x1d u:0x1d', 'Mac preset: ⌘ sends Ctrl');
          await check((await keysAfter('ControlLeft')) === 'd:0x15b u:0x15b', 'Mac preset: ⌃ sends the Windows key');
          await click('.rail-btn', 'Settings');
          await click('.nav-i', 'Remote desktop');
          await click('[data-rdp-keys-preset] button[data-preset="windows"]');
          await waitForAsync(async () => ((await window.backend.settings_get({})).rdp_mac_keys === 'windows' ? true : null), 'the Windows preset saved');
          await click('[data-mod-key="AltLeft"] button[data-target="off"]');
          const saved = await waitForAsync(async () => { const st = await window.backend.settings_get({}); return st.rdp_mac_keys === 'custom' ? st : null; }, 'the custom table saved');
          await check(saved.rdp_mac_custom.includes('AltLeft=off') && saved.rdp_mac_custom.includes('MetaLeft=alt'), 'changing one key starts a custom table from the preset');
          await click('.rail-btn', 'Hosts');
          await click('.tab', 'rdp-clip');
          await waitFor(() => canvas(), 'the desktop again');
          await check((await keysAfter('MetaLeft')) === 'd:0x38 u:0x38', 'custom from Windows: left ⌘ sends Alt');
          await check((await keysAfter('ControlLeft')) === 'd:0x1d u:0x1d', 'custom from Windows: ⌃ sends Ctrl');
          await ctl('clear');
          await press('AltLeft');
          await sleep(300);
          await check((await ctl('keys')) === '-', 'a key set to Off sends nothing');
        } else {
          await check((await keysAfter('MetaLeft')) === 'd:0x15b u:0x15b', 'a PC keyboard sends the Windows key as it is');
        }

        await setStep('rdp: the remote pointer is the canvas cursor (milestone 58)');
        {
          const cur = () => canvas().dataset.cursor;
          await ctl('cursor/new');
          await waitFor(() => (cur() || '').startsWith('image:'), 'the server pointer on the canvas', 10000);
          const css = canvas().style.cursor.replace(/"/g, '');
          await check(/^url\(data:image\/png;base64,/.test(css) && / 3 4, default$/.test(css),
            `the pointer's image and hotspot are the canvas's cursor (${canvas().style.cursor.slice(-24)})`);
          const shown = cur();
          await ctl('cursor/null');
          await waitFor(() => cur() === 'hidden', 'the pointer hidden', 10000);
          await check(canvas().style.cursor === 'none', 'a hidden remote pointer hides the cursor');
          await ctl('cursor/cached');
          await waitFor(() => cur() === shown, 'the cached pointer again', 10000);
          await check(true, 'a pointer from the server cache comes back with no new image');
          await ctl('cursor/default');
          await waitFor(() => cur() === 'default', 'the arrow', 10000);
          await check(canvas().style.cursor === 'default', 'the system pointer is the arrow');
        }

        await setStep('rdp: the lock keys follow this machine, never as presses (milestone 58)');
        {
          const c = canvas();
          c.focus();
          await ctl('clear');
          c.dispatchEvent(new KeyboardEvent('keydown', { code: 'CapsLock', key: 'CapsLock', modifierCapsLock: true, bubbles: true, cancelable: true }));
          c.dispatchEvent(new KeyboardEvent('keyup', { code: 'CapsLock', key: 'CapsLock', modifierCapsLock: true, bubbles: true, cancelable: true }));
          const caps = new KeyboardEvent('keydown', { code: 'CapsLock', modifierCapsLock: true }).getModifierState('CapsLock');
          const want = String((caps ? 4 : 0) | (isMac ? 2 : 0));
          const sync = await waitForAsync(async () => { const v = await ctl('sync'); return v === want ? v : null; }, 'the synchronize event', 10000).catch(() => ctl('sync'));
          log(`diag: lock sync ${sync} (the page reads Caps Lock ${caps ? 'on' : 'off'} from a synthetic event)`);
          await check(sync === want, `the lock keys reach the remote as a synchronize event (${sync})`);
          const keys = await ctl('keys');
          await check(!/0x3a\b/.test(keys), `Caps Lock is not sent as a press (${keys})`);
          c.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', key: 'b', bubbles: true, cancelable: true }));
          c.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB', key: 'b', bubbles: true, cancelable: true }));
          await sleep(300);
          const after = await ctl('sync');
          const wantOff = String(isMac ? 2 : 0);
          await check(after === wantOff, `a key with Caps Lock off turns the remote's off (${after})`);
        }

        await setStep('rdp: a click is a move to its point, then the press (milestone 58)');
        {
          const c = canvas();
          const r = c.getBoundingClientRect();
          const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, button: 0 };
          await ctl('clear');
          c.dispatchEvent(new MouseEvent('mousedown', { ...at, buttons: 1 }));
          c.dispatchEvent(new MouseEvent('mouseup', { ...at, buttons: 0 }));
          const mice = await waitForAsync(async () => { const m = await ctl('mice'); return /u1:/.test(m) ? m : null; }, 'the click at the server', 10000);
          const m = mice.match(/^m:(\d+,\d+) d1:(\d+,\d+) u1:(\d+,\d+)$/);
          await check(!!m && m[1] === m[2] && m[2] === m[3], `a press comes right after a move to its point (${mice})`);
        }

        await setStep('rdp: a character from no key goes as Unicode (a Stream Deck, milestone 58)');
        {
          const c = canvas();
          c.focus();
          await ctl('clear');
          c.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'ł', bubbles: true, cancelable: true }));
          c.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'ł', bubbles: true, cancelable: true }));
          const keys = await waitForAsync(async () => { const k = await ctl('keys'); return k.includes('u:U+142') ? k : null; }, 'the Unicode key at the server', 10000).catch(() => ctl('keys'));
          await check(/d:U\+142 u:U\+142/.test(keys) && !/0x1e/.test(keys), `the character arrives, not the key in its place (${keys})`);
        }

        await setStep('rdp: Type the clipboard and the host\'s password (design 25c, milestone 58)');
        {
          const lastToast = () => qa('[data-toast]:not(.leaving) .t-text').map((e) => e.textContent).pop() || '';
          const nonMods = (k) => k.split(' ').filter((e) => e.startsWith('u:') && e !== 'u:0x2a' && e !== 'u:0x138').length;
          await window.backend.e2e_clipboard_set({ name: 'Hi!' });
          await click('[data-rdp-type]');
          await waitFor(() => q('[data-rdp-type-menu] [data-type-clipboard]'), 'the Type menu', 10000);
          await check(q('[data-type-clipboard] .hint')?.textContent === '3 characters', `the menu counts the clipboard (${q('[data-type-clipboard] .hint')?.textContent})`);
          await check(!!q('[data-type-password]:not([aria-disabled])') && hasText("rdp-clip's password"), 'the host\'s saved password is offered');
          await ctl('clear');
          await click('[data-type-clipboard]');
          await waitFor(() => lastToast() === 'Typed 3 characters', 'the typed toast', 15000);
          await check(!q('[data-rdp-type-menu]'), 'Type clipboard closes the menu and says Typed 3 characters');
          const k1 = await ctl('keys');
          await check(nonMods(k1) === 3, `three characters reach the remote as keys (${k1})`);
          await check(document.activeElement === canvas(), 'the desktop has the keyboard again');

          // Type password asks for presence every time (owner, milestone 58): here the
          // master password (the run sets FLINT_PRESENCE=password).
          const setInput = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
          const askMaster = async (pw) => {
            await click('[data-rdp-type]');
            await waitFor(() => q('[data-type-password]:not([aria-disabled])'), 'the password item', 10000);
            await check(q('[data-type-password] .hint')?.textContent === 'Asks for the master password', 'the password item says it asks for the master password');
            await click('[data-type-password]');
            const input = await waitFor(() => q('[data-type-master] input[type="password"]'), 'the master password field', 5000);
            setInput(input, pw);
            await click('[data-type-master] button[type="submit"]');
          };
          await ctl('clear');
          await askMaster('not the master');
          await waitFor(() => /nothing was typed/.test(lastToast()), 'the refusal', 15000);
          await sleep(300);
          await check((await ctl('keys')) === '-', `a wrong master password types nothing (${lastToast()})`);
          await ctl('clear');
          await askMaster(MASTER);
          await waitFor(() => lastToast() === 'Typed 1 character', 'the password typed', 15000);
          const k2 = await ctl('keys');
          await check(nonMods(k2) === 1, `with presence confirmed, the saved password reaches the remote, typed by the core (${k2})`);

          await window.backend.e2e_clipboard_set({ name: '' });
          await click('[data-rdp-type]');
          await waitFor(() => q('[data-type-clipboard][aria-disabled="true"]'), 'the greyed clipboard item', 10000);
          await check(q('[data-type-clipboard]').dataset.reason === 'The clipboard holds no text', 'with no text on the clipboard Type clipboard is greyed and says why');
          await click('[data-rdp-type]');
          await waitFor(() => !q('[data-rdp-type-menu]'), 'the menu closed', 5000);
        }

        await setStep('rdp: an SSH tab behind the desktop keeps its size and its picture (owner, herdr)');
        {
          await click('.tab', 'local');
          await waitFor(() => activeTerm(), 'the local terminal');
          await runInTerminal("trap 'echo winch-$(stty size | tr \" \" x)' WINCH; echo armed-$((40+2))", 'armed-42');
          const before = termText();
          await click('.tab', 'rdp-clip');
          await waitFor(() => canvas(), 'the desktop');
          await sleep(1500);
          await click('.tab', 'local');
          await sleep(1500);
          const after = termText().slice(before.length - 200);
          const winches = (termText().match(/winch-\d+x\d+/g) || []);
          log('winches: ' + JSON.stringify(winches));
          await check(winches.length === 0, `going to the desktop and back sends the shell no resize (${winches.join(', ') || 'none'})`);
          void after;
          // A full-screen program's screen survives the trip (owner, herdr): the hidden
          // terminal was fitted under display:none, shrank to 11x5 and cut the alternate
          // screen, which nothing drew again since the shell saw no new size.
          {
            const sizes = [];
            const sub = activeTerm().onResize((e) => sizes.push(`${e.cols}x${e.rows}`));
            await type("printf '\\033[?1049h\\033[20;60Halt-mark-%d' 42; sleep 8; printf '\\033[?1049l'");
            await enter();
            await waitFor(() => termText().includes('alt-mark-42'), 'the full-screen mark');
            await click('.tab', 'rdp-clip');
            await waitFor(() => canvas(), 'the desktop');
            await sleep(1500);
            await click('.tab', 'local');
            await sleep(300);
            sub.dispose();
            await check(sizes.length === 0, `the hidden terminal keeps its size (${sizes.join(', ') || 'no resize'})`);
            await check(termText().includes('alt-mark-42'), "a full-screen program's screen is still there when the tab comes back");
            await waitFor(() => !termText().includes('alt-mark-42'), 'the full-screen program done', 15000);
          }
          // The lost-WebGL-context check (M31) is the webgl run's (milestone 35b).
          await click('.tab', 'rdp-clip');
          await waitFor(() => canvas(), 'the desktop again');
        }

        await setStep('rdp: a dropped session offers to reconnect (design 22c7)');
        await ctl('drop');
        await waitFor(() => rdpState('lost'), 'the connection lost card', 20000);
        await check(canvas().classList.contains('stale'), 'the last frame stays, greyed');
        await check(/connection was lost/.test(q('[data-rdp-lost-reason]').textContent) && /\d{1,2}:\d{2}/.test(q('[data-rdp-lost-reason]').textContent), 'the card names the reason and the time');
        await check(byText('.tab', 'disconnected'), 'the tab says disconnected');
        chord('r', 'KeyR');
        await waitFor(() => q('[data-rdp-size]') && !q('[data-rdp-state]', activeRegion()), 'the desktop after Reconnect', 30000);
        await check(!canvas().classList.contains('stale'), 'Reconnect (the reconnect chord) brings the desktop back');
        await click('.tab.on .tx');
        await waitFor(() => !byText('.tab', 'rdp-clip'), 'the test server tab closed');

        await setStep('rdp: Automatic falls back to the pipeline when the server closes during setup (milestone 59)');
        {
          // As GNOME Remote Desktop: the test server closes in the capability exchange a
          // client that offers no graphics pipeline.
          await ctl('gfxonly/on');
          await addRdp('rdp-gnome', CPORT, 'x');
          await open('rdp-gnome');
          await waitFor(() => q('[data-rdp-size]') || q('[data-rdp-state]:not([data-rdp-state="connecting"])', activeRegion()), 'the desktop or a card', 60000);
          await check(!!q('[data-rdp-size]') && !q('[data-rdp-state]', activeRegion()), `Automatic connects to a server that takes only the pipeline (${q('[data-rdp-state]', activeRegion())?.dataset.rdpState ?? 'up'})`);
          const session = () => q('[data-rdp-session]', activeRegion()).dataset.rdpSession;
          await check((await window.backend.rdp_stats({ tab: session() })).mode === 'pipeline', 'the tab runs in the pipeline');
          // Compatible twice (FreeRDP reconnects once by itself), then the pipeline.
          await check((await ctl('setups')) === '3', `Compatible, FreeRDP's own retry, then the pipeline (${await ctl('setups')} setups)`);
          await click('.tab.on .tx');
          await waitFor(() => !byText('.tab', 'rdp-gnome'), 'the tab closed');
          await ctl('gfxonly/on');
          await open('rdp-gnome');
          await waitFor(() => q('[data-rdp-size]'), 'the desktop again', 30000);
          await check((await ctl('setups')) === '1', `the host is remembered: the next connection goes straight to the pipeline (${await ctl('setups')} setup)`);

          await setStep('rdp: a server that closed during setup has its own card (milestone 59)');
          await click('[data-rdp-tab-graphics] button[data-graphics="compatible"]');
          await waitFor(() => rdpState('setup-closed'), 'the closed-during-setup card', 60000);
          await check(hasText('closed the connection during setup') && hasText('graphics pipeline'), 'the card says the server closed during setup, and names the pipeline');
          await check(!hasText('no route'), 'it never says there is no route');
          await check(byText('.tab', 'closed during setup'), 'the tab says closed during setup');
          await check(hasText("in this tab's toolbar or in Settings"), 'the hint names both places Compatible is chosen (owner, milestone 60)');
          await check(q('[data-rdp-retry]')?.textContent.startsWith('Retry in Automatic'), `Retry says it connects in the mode that worked (${q('[data-rdp-retry]')?.textContent})`);
          await click('[data-rdp-retry]');
          await waitFor(() => q('[data-rdp-size]'), 'the desktop again in Automatic', 30000);
          await check((await window.backend.rdp_stats({ tab: session() })).mode === 'pipeline', 'Retry in Automatic connects, in the pipeline');
          await click('.tab.on .tx');
          await waitFor(() => !byText('.tab', 'rdp-gnome'), 'the tab closed');
          await ctl('gfxonly/off');
        }
      } else {
        log('rdp: no test server (FLINT_RDP_CLIP_PORT), clipboard steps skipped');
      }

      await setStep('rdp: closing the tab ends the session');
      await click('.tab.on .tx');
      await waitFor(() => !q('[data-rdp-toolbar]'), 'the RDP tab closed');
      const cat = await window.backend.catalog({});
      await check(!JSON.stringify(cat).includes('rdp-pw-marker'), 'no RDP password in the catalog (Principle 6)');
    }

    if (RUN === 'rdpbench') {
      // Milestone 34: each mode at 1920x1080 on the real host. The input is harmless
      // (memory: the session is the owner's real desktop): the Windows key opens and Esc
      // closes the Start menu; Win+Tab opens Task view, a whole-screen animation.
      // Each phase logs "bench:" with its window in epoch ms, for scripts/rdp-bench.sh
      // to put the CPU samples beside it.
      if (!BHOST) throw new Error('rdpbench needs FLINT_RDP_TEST_HOST, _USER and _PASSWORD');
      await setStep('rdpbench: add the host');
      await click('.side-head .icon-btn[aria-label^="New host"]');
      await waitFor(() => q('[data-host-type-step]'), 'the type step');
      await click('.type-card[data-type="rdp"]');
      await click('.modal button', 'Continue');
      await waitFor(() => q('[data-rdp-editor]'), 'the RDP editor');
      await fill('#ra', 'bench');
      await fill('#rh', BHOST);
      await fill('#ru', BUSER);
      await fill('.modal input[aria-label="Password"]', BPW);
      await click('.modal button[type="submit"]', 'Add host');
      await waitFor(() => byText('.tree .ti', 'bench'), 'the bench host in the tree');
      const bench = (o) => log('bench: ' + JSON.stringify(o));
      const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
      const p95 = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] : 0; };
      // The window is on screen, so timers are not throttled: a plain timeout, not the
      // spinning sleep above, which would cost a core in WebKit's content process.
      const rest = (ms) => new Promise((r) => setTimeout(r, ms));
      let trusted = false;
      for (const mode of BMODES.split(',')) {
        const [graphics, renderer] = mode.split('/');
        await setStep(`rdpbench: ${mode}`);
        await click('.rail-btn', 'Settings');
        await click('.nav-i', 'Remote desktop');
        await click(`[data-rdp-graphics] button[data-graphics="${graphics}"]`);
        await waitForAsync(async () => ((await window.backend.settings_get({})).rdp_graphics === graphics ? true : null), `graphics ${graphics} saved`);
        await click('.rail-btn', 'Hosts');
        window.__flintRdpRenderer = renderer;
        const r = await waitFor(() => byText('.tree .ti', 'bench'), 'bench in the tree');
        r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        if (!trusted) {
          await waitFor(() => q('[data-rdp-state="certificate"]', activeRegion()), 'the certificate prompt', 30000);
          await click('button[type="submit"]', 'Trust and connect');
          trusted = true;
        }
        await waitFor(() => q('[data-rdp-size]'), 'the desktop', 30000);
        const area = await waitFor(() => q('[data-rdp-session]', activeRegion()), 'the desktop area');
        const tab = area.dataset.rdpSession;
        // Extra monitors' windows (BMONS 2): their frames, read through their probes.
        const probes = [];
        const off = window.runtime.EventsOn('monitor:message', (e) => { try { const m = JSON.parse(e.data); if (m.type === 'probe') probes.push({ id: e.id, ...m }); } catch { /* not ours */ } });
        let extras = [];
        const extraFrames = async () => {
          let n = 0;
          for (const id of extras) {
            const k = probes.length;
            await window.backend.monitors_send({ id, data: JSON.stringify({ type: 'probe' }) });
            const p = await waitFor(() => probes.slice(k).find((x) => x.id === id), `the window on ${id}`, 5000).catch(() => null);
            n += p ? p.frames : 0;
          }
          return n;
        };
        let size = '1920x1080';
        if (BMONS === '1' || BMONS === '2') {
          // Full screen (milestone 37), and across the monitors (38): the desktop's size is
          // the screens', whatever they are; the bench says which.
          await rest(3000);
          if (BMONS === '1') {
            await click('[data-rdp-fullscreen]');
            await waitFor(() => q('.app')?.dataset.fullscreen === 'true', 'full screen');
            await rest(6000);
          } else {
            await click('[data-rdp-fullscreen-menu]');
            await click('[data-fullscreen-all]');
            const mons = () => window.__flintE2E.monitors;
            await waitFor(() => mons()?.get().phase === 'on', 'the desktop across the monitors', 60000);
            extras = mons().get().span.monitors.slice(1).map((m) => m.local_id);
            await rest(4000);
            size = `${mons().get().span.width}x${mons().get().span.height}`;
          }
          if (BMONS === '1') size = q('canvas.rdp-canvas', activeRegion()).dataset.desktop;
        } else {
          // The size of M28's measurement, whatever the window's: scaled down to fit. Display
          // Control opens a moment after the desktop, so the size is asked again until it holds.
          const sized = () => q('canvas.rdp-canvas', activeRegion())?.dataset.desktop === '1920x1080';
          for (let i = 0; i < 15 && !sized(); i++) {
            await rest(2000);
            await window.backend.rdp_resize({ tab, width: 1920, height: 1080 }).catch(() => {});
          }
          await waitFor(sized, 'a 1920x1080 desktop', 20000);
          await rest(3000);
        }
        const meter = window.__flintE2E.rdpMeter;
        const key = (code, down) => window.backend.rdp_key({ tab, code, down });
        const tap = async (code) => { await key(code, true); await key(code, false); };
        const quiet = async (ms) => { const start = meter.frames; await rest(ms); return meter.frames - start; };
        const sample = async () => ({ at: performance.now(), drawn: meter.frames, extra: await extraFrames(), read: meter.bytes, core: await window.backend.rdp_stats({ tab }) });
        const rates = (a, b) => {
          const sec = (b.at - a.at) / 1000;
          const cmds = b.core.commands - a.core.commands;
          return { fps: +((b.drawn - a.drawn) / sec).toFixed(1), extraFps: +((b.extra - a.extra) / sec).toFixed(1), updates: +((b.core.updates - a.core.updates) / sec).toFixed(1),
            kbps: Math.round(((b.core.bytes_in - a.core.bytes_in) * 8) / 1000 / sec), channelMBps: +((b.read - a.read) / 1e6 / sec).toFixed(1),
            decodeMs: cmds ? +((b.core.decode_us - a.core.decode_us) / cmds / 1000).toFixed(2) : 0 };
        };
        const drawnWith = q('canvas.rdp-canvas', activeRegion()).dataset.renderer;

        // Settle: after a change of size or monitors, Windows in Compatible (bitmap updates)
        // sends nothing for a few seconds while it reactivates the session: 3 s for one
        // monitor, 4 to more than 13 s for two, measured at the adapter (milestone 38); the
        // graphics pipeline answers at once. A fixed rest left the first presses inside that
        // window ("no frame after the Windows key", p95 4 s). The Start menu is tried until
        // it answers within a second twice in a row, and the time it took is reported.
        await setStep(`rdpbench: ${mode}: settle`);
        const settleFrom = performance.now();
        for (let ok = 0; ok < 2; ) {
          if (performance.now() - settleFrom > 45000) throw new Error('the desktop did not answer the Windows key within 45 s');
          const t = performance.now();
          await tap('MetaLeft');
          await rest(1000);
          ok = meter.firstAfter(t) !== null ? ok + 1 : 0;
          await tap('Escape');
          await rest(800);
        }
        const settleMs = Math.round(performance.now() - settleFrom);

        // Start-menu latency: the first frame drawn after the key.
        await setStep(`rdpbench: ${mode}: Start menu latency`);
        const lat = [];
        const latFrom = Date.now();
        for (let i = 0; i < 12; i++) {
          await quiet(600);
          const before = meter.frames;
          const t = performance.now();
          await tap('MetaLeft');
          const until = performance.now() + 5000;
          while (meter.frames === before && performance.now() < until) await rest(20);
          const first = meter.firstAfter(t);
          if (first === null) throw new Error('no frame after the Windows key');
          lat.push(first - t);
          await rest(900);
          await tap('Escape');
        }
        await rest(1200);
        const latTo = Date.now();

        // Task view, opened and closed over and over for 8 s.
        await setStep(`rdpbench: ${mode}: Task view animation`);
        const animFrom = Date.now();
        const a = await sample();
        const end = performance.now() + 8000;
        while (performance.now() < end) {
          await key('MetaLeft', true); await tap('Tab'); await key('MetaLeft', false);
          await rest(700);
          await tap('Escape');
          await rest(500);
        }
        const b = await sample();
        const animTo = Date.now();
        await rest(1500);

        // Idle: nothing happens on the desktop for 5 s.
        const i0 = await sample();
        const idleFrom = Date.now();
        await rest(5000);
        const i1 = await sample();
        const idleTo = Date.now();
        bench({ mode, monitors: BMONS || 'window', size, settleMs, pipeline: b.core.pipeline, codec: b.core.codec, h264: b.core.h264, renderer: drawnWith,
          latency: { median: Math.round(median(lat)), p95: Math.round(p95(lat)), from: latFrom, to: latTo },
          animation: { ...rates(a, b), from: animFrom, to: animTo }, idle: { ...rates(i0, i1), from: idleFrom, to: idleTo } });
        // Automatic picks by the round trip (milestone 35): either is right, as long as it says which.
        const want = graphics === 'compatible' ? 'bitmap' : graphics === 'pipeline' ? 'gfx' : b.core.mode === 'compatible' ? 'bitmap' : 'gfx';
        await check(b.core.pipeline === want, `${mode}: the ${graphics} mode uses the expected pipeline (${b.core.pipeline} ${b.core.codec}, engine ${b.core.mode})`);
        off();
        if (q('.app')?.dataset.fullscreen === 'true') {
          q('[data-fs-edge]')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
          await click('[data-fs-exit]');
          await waitFor(() => q('.app')?.dataset.fullscreen !== 'true', 'out of full screen');
          await rest(2000);
        }
        await click('.tab.on .tx');
        await waitFor(() => !q('[data-rdp-toolbar]'), 'the bench tab closed');
        await rest(1500);
      }
    }

    if (RUN === 'paste') {
      // A paste event as ⌘V hands it: an image file, with or without text beside it.
      const pasteData = async (text, files) => {
        const ta = await waitFor(() => activePane()?.querySelector('textarea'), 'terminal textarea');
        ta.focus();
        const dt = new DataTransfer();
        if (text !== null) dt.setData('text/plain', text);
        for (const f of files) dt.items.add(f);
        ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        await sleep(50);
      };
      // A real 1×1 PNG.
      const pngBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const png = new File([pngBytes], 'Screen Shot e2e.png', { type: 'image/png' });
      const pathRe = /(\/\S*\/\.cache\/flint\/paste\/p-[a-z0-9-]+\/Screen-Shot-e2e\.png)/;
      // The buffer with wrapped rows joined: a long path spans two rows.
      // Keys typed while the shell redraws its prompt can be lost (an async prompt; seen
      // on Windows, 2026-11-11: the ls ran without the pasted path). Wait, as a person
      // would, for the screen to stop changing.
      const settle = async () => {
        for (let screen = '', t0 = Date.now(); termText() !== screen && Date.now() - t0 < 10000; ) {
          screen = termText();
          await sleep(300);
        }
      };
      const fullText = () => {
        const b = activeTerm()?.buffer.active;
        if (!b) return '';
        let out = '';
        for (let i = 0; i < b.length; i++) {
          const line = b.getLine(i);
          if (!line) continue;
          out += (i > 0 && !line.isWrapped ? '\n' : '') + line.translateToString(true);
        }
        return out;
      };
      const pathCount = () => (fullText().match(new RegExp(pathRe.source, 'g')) || []).length;

      await setStep('paste: an image');
      // On the Windows VM the test sshd is MSYS2's, on NTFS mounted noacl: its files have
      // no POSIX modes to check (owner, 2026-11-18, as the suites skip them there). A real
      // server is Linux, and macOS and Linux check them.
      const srvModes = (await window.backend.app_info({})).os !== 'windows';
      const fileMode = srvModes ? '-rw-------@?' : '-[-rwx]{9}';
      const modeNote = srvModes ? 'mode 0600' : 'mode not checked (MSYS2 test server)';
      // /bin/ls: the login shell may alias ls (eza on the owner's Mac).
      await type('/bin/ls -ln ');
      // Every text the toast store shows, recorded as it changes: a local upload is quick
      // enough for its result to replace "Pasting…" before a poll of the page sees it.
      const seen = [];
      const offSeen = window.__flintE2E.toasts.subscribe(() => {
        for (const t of window.__flintE2E.toasts.list()) if (!seen.includes(t.text)) seen.push(t.text);
      });
      await pasteData(null, [png]);
      await waitFor(() => seen.includes('Pasting image to local…'), 'the upload notice');
      await check(true, 'pasting an image shows "Pasting image to local…"');
      const pasted = await waitFor(() => fullText().match(pathRe), 'the pasted path in the prompt', 20000);
      const path = pasted[1];
      await check(true, `the image's path on the server is pasted into the prompt (${path})`);
      // Milestone 47: the result replaces "Pasting…" in place (one toast per pane).
      const pasteToasts = () => [...document.querySelectorAll('[data-toast]')]
        .filter((el) => !el.classList.contains('leaving') && /^Past/.test(el.querySelector('.t-text')?.textContent ?? ''))
        .map((el) => el.querySelector('.t-text').textContent);
      await waitFor(() => pasteToasts().includes('Pasted the image on local'), 'the paste result toast');
      offSeen();
      await check(pasteToasts().length === 1, `"Pasted the image on local" replaces "Pasting…" (${pasteToasts()})`);
      await settle();
      await type('; echo ls-$((6*7))');
      await enter();
      await waitFor(() => termText().includes('ls-42'), 'the ls of the pasted file');
      // macOS's ls marks extended attributes with '@' after the mode.
      await check(new RegExp(`${fileMode} +1 +\\d+ +\\d+ +${pngBytes.length} `).test(fullText()), `the file is on the server, ${modeNote}, ${pngBytes.length} bytes`);
      const folder = path.replace(/\/[^/]+$/, '');
      await runInTerminal(`/bin/ls -ld ${folder} ~/.cache/flint/paste ~/.cache/flint | cut -c1-10 | sort | uniq -c; echo modes-$((6*7))`, 'modes-42');
      if (srvModes) await check(/3 drwx------/.test(termText()), 'its folder, the paste folder and ~/.cache/flint are 0700');
      else await log('skip  the 0700 folders (no POSIX modes on the MSYS2 test server)');
      await runInTerminal(`od -An -tx1 -N8 ${path} | tr -s ' '; echo head-$((6*7))`, 'head-42');
      await check(termText().includes(' 89 50 4e 47 0d 0a 1a 0a'), 'the bytes on the server are the pasted image');

      await setStep('paste: an empty paste event reads the clipboard');
      // WebKitGTK hands the page a paste event with nothing in it: the core reads the
      // system clipboard (the run's private board on macOS) and stages the image itself.
      await window.backend.e2e_clipboard_png({ name: btoa(String.fromCharCode(...pngBytes)) });
      const nativeRe = /(\/\S*\/\.cache\/flint\/paste\/p-[a-z0-9-]+\/paste\.png)/;
      await type('/bin/ls -ln ');
      await pasteData(null, []);
      const nativePasted = await waitFor(() => fullText().match(nativeRe), 'the path of the image the core read', 20000);
      await check(true, `an empty paste event pastes the clipboard's image, read by the core (${nativePasted[1]})`);
      await settle();
      await type('; echo native-$((6*7))');
      await enter();
      await waitFor(() => termText().includes('native-42'), 'the ls of the image the core read');
      await check(new RegExp(`${fileMode} +1 +\\d+ +\\d+ +${pngBytes.length} `).test(fullText().split('native-42')[0].slice(-400)), `it is on the server, ${modeNote}, ${pngBytes.length} bytes`);
      const nativeFolder = nativePasted[1].replace(/\/[^/]+$/, '');

      await setStep('paste: text wins');
      const before = pathCount();
      await pasteData('echo text-wins-$((6*7))', [png]);
      await enter();
      await waitFor(() => termText().includes('text-wins-42'), 'the pasted text to run');
      await sleep(500);
      await check(pathCount() === before && !hasText('Paste to local failed'), 'a clipboard with text and an image pastes the text, and uploads nothing');

      await setStep('paste: over the limit');
      const big = new File([new Uint8Array(20 * 1048576 + 1)], 'big.png', { type: 'image/png' });
      await pasteData(null, [big]);
      await waitFor(() => hasText('over the 20 MB paste limit'), 'the limit toast');
      await check(hasText('Use Files to upload it'), 'an image over the limit is refused, pointing to Files');

      await setStep('paste: the limit is a setting');
      const saved = await window.backend.settings_get({});
      await check(saved.paste_limit_mb === 20, 'the paste limit defaults to 20 MB');
      await runInTerminal(`rm -rf ${folder} ${nativeFolder}; echo cleaned-$((6*7))`, 'cleaned-42');
    }

    if (RUN === 'tunnels') {
      await setStep('tunnels');
      // Milestone 23 (design 06c, 20): a tunnel saved in the host editor, started from
      // the Tunnels view, used by a second host whose address is the tunnel's port, then
      // the toolbar menu, the palette, a port in use and removing it.
      const tunView = () => q('[data-tunnels-view]');
      const tunState = (name) => q(`[data-tunnel="${name}"]`)?.dataset.state ?? '';
      const tunText = (name) => q(`[data-tunnel="${name}"] [data-tunnel-state]`)?.textContent ?? '';
      await click('.rail-btn', 'Hosts');
      await click('.tab', 'local');
      await waitFor(() => toolbarIs('ready'), 'the local tab');
      await click('[data-toolbar-tunnels]');
      await waitFor(() => q('[data-tunnels-menu]'), 'the toolbar Tunnels menu');
      await check(hasText('No tunnels on this host yet.'), 'the toolbar menu of a host with no tunnels says so');
      await click('[data-tunnels-menu] .mi', 'Add a tunnel…');
      await waitFor(() => q('[data-host-tunnels]'), 'the host editor at its Tunnels section');
      await check(hasText('No tunnels. A tunnel lets an app'), "the editor's Tunnels section has an empty state");
      await click('[data-add-tunnel]');
      await fill('#tun-name', 'fwd');
      await fill('#tun-local', TPORT);
      await fill('[data-tunnel-dialog] input[aria-label="Destination host"]', '127.0.0.1');
      await fill('[data-tunnel-dialog] input[aria-label="Destination port"]', PORT2);
      await click('[data-tunnel-dialog] button[type="submit"]');
      await waitFor(() => q('[data-host-tunnel="fwd"]'), 'the saved tunnel in the editor');
      await check(q('[data-host-tunnel="fwd"] .mp')?.textContent === `127.0.0.1:${TPORT}→127.0.0.1:${PORT2}`, 'the editor lists the tunnel as 127.0.0.1:port → destination');
      await click('[data-add-tunnel]');
      await fill('#tun-name', 'FWD');
      await fill('#tun-local', PORT);
      await waitFor(() => q('[data-shared-port]') || true, 'a moment');
      await click('[data-tunnel-dialog] button[type="submit"]');
      await waitFor(() => q('[data-tunnel-dialog] .ferr[role="alert"]'), 'the name error');
      await check(/already has a tunnel named FWD/.test(q('[data-tunnel-dialog] .ferr').textContent), 'a name used on the host is refused inline, whatever its case');
      await fill('#tun-name', 'busy');
      await click('[data-tunnel-dialog] button[type="submit"]');
      await waitFor(() => q('[data-host-tunnel="busy"]'), 'the second tunnel');
      await click('.modal button', 'Cancel');
      await waitFor(() => !q('[data-host-tunnels]'), 'the editor to close');

      await click('.rail-btn', 'Tunnels');
      await waitFor(() => tunView() && q('[data-tunnel="fwd"]'), 'the Tunnels view');
      await check(q('[data-tunnel-host="local"]') && tunText('fwd') === 'stopped', 'the Tunnels view lists the host\'s tunnels, stopped');
      await click('[data-tunnel-switch="fwd"]');
      await waitFor(() => tunState('fwd') === 'ok', 'fwd listening', 30000);
      await check(tunText('fwd') === 'listening · no connections', 'the switch starts the tunnel on its own session: "listening · no connections"');
      await waitFor(() => q('[data-tunnels-badge]')?.textContent === '1' && q('[data-tunnels-status]') && q('.tab [data-tun-mark="local"]'), 'the marks');
      await check(true, 'the rail badge, the status bar and the tab mark show 1 tunnel up');
      await click('[data-tunnel-switch="busy"]');
      await waitFor(() => tunState('busy') === 'warn', 'busy refused', 30000);
      await check(/^port \d+ in use · by another program$/.test(tunText('busy')), 'a port in use shows as such: ' + tunText('busy'));

      // A host whose address is the tunnel: its shell proves bytes go through.
      await click('.rail-btn', 'Hosts');
      await newSshHost('.side-head .icon-btn[aria-label^="New host"]');
      await fill('#ha', 'through');
      await fill('#hh', '127.0.0.1');
      await fill('#hp', TPORT);
      await click('.seg button', 'Key');
      await pick('SSH key', 'e2e-key');
      await fill('#hu', USER);
      await click('.modal button[type="submit"]', 'Add host');
      await waitFor(() => byText('.tree .ti', 'through'), 'through in the tree');
      byText('.tree .ti', 'through').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await waitFor(() => hasText('before connecting'), 'the host key prompt through the tunnel');
      await click('button[type="submit"]', 'Trust and connect');
      await waitFor(() => toolbarIs('ready'), 'the session through the tunnel', 30000);
      await runInTerminal('echo through-tunnel-ok', 'through-tunnel-ok');
      await check(true, 'a session to 127.0.0.1:<tunnel port> reaches the destination through the tunnel');
      await click('.rail-btn', 'Tunnels');
      await waitFor(() => tunText('fwd') === 'listening · 1 connection', 'one connection', 10000);
      await check(true, 'the Tunnels view counts the live connection');
      await click('.tab.on .tx');
      await waitFor(() => tunText('fwd') === 'listening · no connections', 'the connection to close', 10000);
      await check(true, 'closing that tab closes its connection; the tunnel stays up');

      // The toolbar menu stops it; the palette starts it again.
      await click('.tab', 'local');
      await waitFor(() => toolbarIs('ready'), 'the local tab');
      await check(q('[data-toolbar-tunnels] .tcount')?.textContent === '1', 'the toolbar Tunnels button counts the tunnels up');
      await click('[data-toolbar-tunnels]');
      await click('[data-tunnels-menu-item="fwd"]');
      await waitFor(() => tunState('fwd') === 'idle' && !q('[data-tunnels-badge]'), 'fwd stopped from the menu', 10000);
      await check(q('[data-tunnels-menu-item="fwd"]')?.getAttribute('aria-checked') === 'false', 'the toolbar menu stops a tunnel, and its check clears');
      await click('[data-toolbar-tunnels]');
      await waitFor(() => !q('[data-tunnels-menu]'), 'the menu to close');
      await click('.palette-btn');
      // By the row's own words too ("start fwd"), not only the tunnel's name.
      await fill('[aria-label="Command palette"] input', 'start fwd');
      await waitFor(() => byText('[role="option"]', 'Start tunnel fwd on local'), 'the palette action');
      await check(q('[role="option"].hot')?.textContent.includes('Start tunnel fwd on local'), '"start fwd" puts "Start tunnel fwd on local" first, above Connect with tunnels');
      {
        const input = q('[aria-label="Command palette"] input');
        await check(input.spellcheck === false && input.getAttribute('autocorrect') === 'off', 'the palette field has no spelling correction');
      }
      await click('[role="option"]', 'Start tunnel fwd on local');
      await waitFor(() => tunState('fwd') === 'ok', 'fwd from the palette', 30000);
      await check(true, 'the palette starts a tunnel: "Start tunnel fwd on local"');
      await click('.palette-btn');
      await fill('[aria-label="Command palette"] input', 'stop fwd');
      await waitFor(() => byText('[role="option"]', 'Stop tunnel fwd on local'), 'the stop action');
      await check(true, 'a running tunnel is offered as "Stop tunnel fwd on local", found by "stop fwd"');
      q('[aria-label="Command palette"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      await waitFor(() => !q('[aria-label="Command palette"]'), 'the palette to close');

      // Removing a running tunnel stops it; the view shows its empty state at the end.
      await click('[data-toolbar-tunnels]');
      await click('[data-tunnels-menu] .mi', 'Manage tunnels…');
      await waitFor(() => q('[data-host-tunnel="fwd"]'), 'the editor');
      await click('[data-host-tunnel="fwd"] button[aria-label="Remove tunnel fwd"]');
      await click('[data-host-tunnel="busy"] button[aria-label="Remove tunnel busy"]');
      await waitFor(() => !q('[data-host-tunnel]'), 'both removed');
      await click('.modal button', 'Cancel');
      // The Tunnels view is still open beside the tab (a click on its rail item would hide it).
      await waitFor(() => q('[data-tunnels-empty]') && !q('[data-tunnels-badge]'), 'the empty Tunnels view', 10000);
      await check(true, 'removing a running tunnel stops it; the Tunnels view shows its empty state');
      const after = await window.backend.tunnels_list({});
      await check(Array.isArray(after) && after.length === 0, 'no tunnel is left saved');
      await click('.rail-btn', 'Hosts');
      byText('.tree .ti', 'through').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
      await click('.menu .mi', 'Delete host');
      await click('.modal button', 'Delete host');
      await waitFor(() => !byText('.tree .ti', 'through'), 'through deleted');
    }

    if (RUN === 'vault') {
      await setStep('test connection');
      const isMac = (await window.backend.app_info({})).os === 'mac';
      const shortcut = (key, code) => (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, metaKey: isMac, ctrlKey: !isMac, shiftKey: !isMac }));
      await newSshHost('.side-head .icon-btn[aria-label^="New host"]');
      await fill('#ha', 'probe');
      // 127.0.0.1, not localhost: on Linux localhost resolves to ::1 first, where the
      // test sshds do not listen. [127.0.0.1]:PORT2 is not known yet (inner went
      // through localhost).
      await fill('#hh', '127.0.0.1');
      await fill('#hp', '1');
      await click('.seg button', 'Key');
      await pick('SSH key', 'e2e-key');
      await fill('#hu', USER);
      await click('.modal button', 'Test connection');
      await waitFor(() => hasText('Test failed'), 'the failed test', 30000);
      await check(true, 'a test of a closed port reports the failure in the editor');
      // Milestone 47: the result is in a toast too, one per editor (`key`).
      const testToasts = () => [...document.querySelectorAll('[data-toast]')]
        .filter((el) => !el.classList.contains('leaving') && /^(Test of probe failed|Connection to probe works)/.test(el.querySelector('.t-text')?.textContent ?? ''));
      await waitFor(() => testToasts().length === 1, 'the failed test toast');
      await check(testToasts()[0].dataset.kind === 'error', `the failure is an error toast too (${testToasts()[0].querySelector('.t-text').textContent})`);
      await fill('#hp', PORT2);
      await click('.modal button', 'Test connection');
      await waitFor(() => q('.modal [role="alertdialog"]'), 'the host key card in the editor', 30000);
      await check(q('.modal [role="alertdialog"] .fp')?.textContent.startsWith('SHA256:'), 'the test asks to verify a new host key in the editor');
      await click('.modal [role="alertdialog"] button', 'Trust and continue');
      await waitFor(() => hasText('Connection works'), 'the successful test', 30000);
      await check(hasText(`${USER}@127.0.0.1:${PORT2}`), 'the test names the target it reached');
      await waitFor(() => testToasts().some((el) => el.dataset.kind === 'ok'), 'the successful test toast');
      await check(testToasts().length === 1 && /^Connection to probe works · \d+ ms$/.test(testToasts()[0].querySelector('.t-text').textContent),
        `the success replaces the failure's toast in place (${testToasts().map((el) => el.querySelector('.t-text').textContent)})`);
      await check(hasText('Connection works ·'), 'the inline line stays as the record');
      await check(!(await window.backend.catalog({})).hosts.some((h) => h.alias === 'probe'), 'testing does not save the host');

      await setStep('initial command');
      await fill('#hc', 'echo started-$((40+2))');
      await check(q('.modal .check input[type="checkbox"]')?.checked === true, 'a login shell follows the command by default');
      await click('.modal button[type="submit"]', 'Add host');
      await waitFor(() => byText('.tree .ti', 'probe'), 'probe in the tree');
      const withProbe = await window.backend.catalog({});
      await check(withProbe.known_hosts.find((k) => k.addr === `[127.0.0.1]:${PORT2}`)?.host === 'probe', 'the key trusted in the test belongs to the saved host');
      await check(withProbe.hosts.find((h) => h.alias === 'probe').command === 'echo started-$((40+2))', 'the initial command is saved');
      byText('.tree .ti', 'probe').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await waitFor(() => toolbarIs('ready'), 'the probe session', 30000);
      await check(!hasText('before connecting'), 'a key trusted in a test is not asked about again');
      await waitFor(() => termText().includes('started-42'), 'the initial command output', 20000);
      await runInTerminal('echo shell-after-$((6*7))', 'shell-after-42');
      await check(true, 'the initial command runs on the PTY, then a login shell');

      await setStep('connect without the initial command');
      const tabsBeforePlain = qa('.tab').length;
      shortcut('k', 'KeyK');
      await waitFor(() => q('[aria-label="Command palette"]'), 'the palette');
      await fill('[aria-label="Command palette"] input', 'probe');
      const plainRow = await waitFor(() => qa('[aria-label="Command palette"] [role="option"]').find((o) => o.textContent.includes('Connect without command')), 'the "without" row for probe');
      await check(plainRow.textContent.includes('echo started-$((40+2))'), 'the palette names the command it will skip');
      plainRow.click();
      await waitFor(() => qa('.tab').length === tabsBeforePlain + 1, 'a new tab for probe');
      await waitFor(() => toolbarIs('ready'), 'the plain probe session', 30000);
      await runInTerminal('echo plain-$((6*7))', 'plain-42');
      await check(!termText().includes('started-42'), 'the session opened without the initial command');
      shortcut('r', 'KeyR');
      await waitFor(() => toolbarIs('connecting') || toolbarIs('ready'), 'the reconnect');
      await waitFor(() => toolbarIs('ready'), 'the plain probe session again', 30000);
      await runInTerminal('echo again-$((6*7))', 'again-42');
      await check(!termText().includes('started-42'), 'a reconnect keeps the session without the initial command');

      await setStep('browser keys');
      // Milestone 64: the engine's reload and print keys are cancelled outside the
      // terminal; in it, Ctrl+R and F5 still reach the remote program.
      {
        const press = (target, o) => {
          const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...o });
          target.dispatchEvent(ev);
          return ev;
        };
        await runInTerminal('cat -v; echo cat-done-$((6*7))', 'cat -v');
        const ta = activePane().querySelector('textarea');
        await check(press(ta, { key: 'r', code: 'KeyR', keyCode: 82, ctrlKey: true }).defaultPrevented, 'Ctrl+R in the terminal is not left to the engine');
        press(ta, { key: 'F5', code: 'F5', keyCode: 116 });
        await enter();
        // The tty echoes ^R as its reprint key (a new line), then cat prints F5's sequence.
        await waitFor(() => /cat -v;[^\n]*\n\^R\n[\s\S]*\^\[\[15~/.test(termText()), 'Ctrl+R and F5 echoed by the remote');
        await check(true, 'Ctrl+R and F5 in the terminal reach the remote program');
        // Ctrl+D ends cat (Ctrl+C would abort the shell's whole command list).
        press(ta, { key: 'd', code: 'KeyD', keyCode: 68, ctrlKey: true });
        await waitFor(() => termText().includes('cat-done-42'), 'cat to end');
        const field = document.body;
        await check(press(field, { key: 'F5', code: 'F5' }).defaultPrevented, 'F5 outside the terminal is cancelled');
        await check(press(field, { key: 's', code: 'KeyS', metaKey: isMac, ctrlKey: !isMac }).defaultPrevented, 'the save key is cancelled');
        await check(press(field, { key: 'u', code: 'KeyU', metaKey: isMac, ctrlKey: !isMac }).defaultPrevented, 'the view-source key is cancelled');
        await check(press(field, { key: 'p', code: 'KeyP', metaKey: isMac, ctrlKey: !isMac }).defaultPrevented, 'the print key is cancelled');
        await sleep(100);
        if (q('[aria-label="Command palette"]')) {
          // ⌘P is Go to host on macOS: the guard leaves Flint's own chord running.
          await check(isMac, 'only macOS opens Go to host on ⌘P');
          q('[aria-label="Command palette"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await waitFor(() => !q('[aria-label="Command palette"]'), 'the palette to close');
        } else {
          await check(!isMac, 'macOS opens Go to host on ⌘P, the guard notwithstanding');
        }
        if (!isMac) {
          // Ctrl+Shift+P is Go to host elsewhere: cancelled for the engine, run by Flint.
          press(field, { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true });
          await waitFor(() => q('[aria-label="Command palette"]'), 'Go to host on Ctrl+Shift+P');
          q('[aria-label="Command palette"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await waitFor(() => !q('[aria-label="Command palette"]'), 'the palette to close');
          await check(true, "Flint's own chord on a guarded key still runs");
        }
      }

      await setStep('reveal and copy');
      shortcut('k', 'KeyK');
      await waitFor(() => q('[aria-label="Command palette"]'), 'the palette');
      await fill('[aria-label="Command palette"] input', 'pwh');
      await waitFor(() => q('[role="option"].hot')?.textContent.includes('pwhost'), 'pwhost hot');
      shortcut('i', 'KeyI');
      await waitFor(() => q('[role="dialog"][aria-label^="Edit host"]'), 'the pwhost editor');
      const pwInput = () => q('.modal input[aria-label="Password"]');
      await check(pwInput()?.type === 'password' && pwInput().value === '', 'a saved password starts hidden and out of the page');
      await click('.modal button[aria-label="Show password"]');
      await waitFor(() => pwInput().value === HOST_PW_MARKER, 'the revealed password');
      await check(pwInput().type === 'text' && pwInput().readOnly, 'Show reveals the saved password, read-only');
      await click('.modal button[aria-label="Hide password"]');
      await check(pwInput().value === '' && pwInput().type === 'password', 'Hide drops it from the field');
      await click('.modal button[aria-label="Copy saved password"]');
      await waitFor(() => hasText('Password copied'), 'the copy toast');
      await check(true, 'Copy asks the core to put the password on the clipboard');
      await check(!JSON.stringify(await window.backend.catalog({})).includes(HOST_PW_MARKER), 'the catalog still carries no password');

      await setStep('field menu');
      // Milestone 64: a release has no engine menu, so a text field gets Flint's own.
      {
        const rightClick = (el) => {
          const r = el.getBoundingClientRect();
          const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5 });
          el.dispatchEvent(ev);
          return ev;
        };
        const items = () => qa('.menu[role="menu"] .mi').map((b) => `${b.textContent.replace(/(⌘|Ctrl\+).*/, '')}${b.getAttribute('aria-disabled') ? '-' : '+'}`);
        const closeMenu = async () => {
          q('.menu[role="menu"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await waitFor(() => !q('.menu[role="menu"]'), 'the field menu to close');
        };
        const hh = q('#hh');
        hh.setSelectionRange(0, 0);
        await check(rightClick(hh).defaultPrevented, 'a right-click in a field is taken by Flint');
        await waitFor(() => q('.menu[role="menu"]'), 'the field menu');
        await check(items().join(' ') === 'Cut- Copy- Paste+ Select all+', `with nothing selected, Cut and Copy are off (${items().join(' ')})`);
        const before = hh.value;
        await click('.menu[role="menu"] .mi', 'Paste');
        await waitFor(() => hasText('to paste the password Flint copied'), 'the secret paste notice');
        await check(q('#hh').value === before, 'Paste refuses the password Flint copied and says to use the paste keys');
        const ha = q('#ha');
        ha.focus();
        ha.setSelectionRange(0, 3);
        rightClick(ha);
        await waitFor(() => q('.menu[role="menu"]'), 'the field menu on the alias');
        await check(items().join(' ') === 'Cut+ Copy+ Paste+ Select all+', `with a selection, everything is on (${items().join(' ')})`);
        await click('.menu[role="menu"] .mi', 'Copy');
        const copied = await waitForAsync(async () => {
          const r = await window.backend.e2e_clipboard({});
          const v = (typeof r === 'string' ? JSON.parse(r) : r)?.name;
          return v === 'pwh' ? v : null;
        }, 'the copied selection');
        await check(copied === 'pwh', 'Copy puts the selection on the clipboard');
        const pw = q('.modal input[aria-label="Password"]');
        rightClick(pw);
        await waitFor(() => q('.menu[role="menu"]'), 'the field menu on the password');
        await check(items()[1] === 'Copy-', 'a password field never offers Copy');
        await closeMenu();
        const heading = q('.modal h2') ?? q('.modal');
        await check(!rightClick(heading).defaultPrevented && !q('.menu[role="menu"]'), 'a right-click outside a field opens nothing');
      }
      await click('.modal button', 'Cancel');
      await waitFor(() => !q('[role="dialog"][aria-label^="Edit host"]'), 'the editor to close');

      await setStep('palette');
      const mac = isMac;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', metaKey: mac, ctrlKey: !mac, shiftKey: !mac, bubbles: true, cancelable: true }));
      await waitFor(() => q('[aria-label="Command palette"]'), 'the palette');
      // Milestone 64: the field menu's Paste types plain text into a field (the
      // clipboard holds "pwh", copied from the alias above).
      {
        const input = q('[aria-label="Command palette"] input');
        const r = input.getBoundingClientRect();
        input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5 }));
        await waitFor(() => q('.menu[role="menu"]'), 'the field menu in the palette');
        await click('.menu[role="menu"] .mi', 'Paste');
        await waitFor(() => q('[aria-label="Command palette"] input')?.value === 'pwh', 'the pasted text');
        await waitFor(() => byText('[role="option"]', 'pwhost'), 'pwhost found by the pasted text');
        await check(true, 'Paste in the field menu types the clipboard into the field, and the page sees it');
      }
      await fill('[aria-label="Command palette"] input', 'pwh');
      await waitFor(() => byText('[role="option"]', 'pwhost'), 'pwhost in the palette');
      await check(q('[role="option"].hot')?.textContent.includes('pwhost'), 'the palette ranks the matching host first');
      const footer = () => q('[data-palette-hints]')?.textContent ?? '';
      await check(footer().includes('edit host'), 'the palette offers ⌘I while a host is hot');
      // Milestone 62: every word whole, from any field; never letters scattered.
      const pwRow = () => qa('[aria-label="Command palette"] [role="option"]').find((o) => o.textContent.includes('pwhost'));
      await fill('[aria-label="Command palette"] input', 'pwhst');
      await sleep(150);
      await check(!pwRow(), 'letters scattered across a name find nothing: "pwhst" does not find pwhost');
      await fill('[aria-label="Command palette"] input', 'db billing');
      const tagRow = await waitFor(() => pwRow(), 'pwhost by its tag');
      const tagNote = tagRow.querySelector('[data-match-field="tag"]');
      await check(tagNote?.textContent === ' · tag: Billing-DB' && [...tagNote.querySelectorAll('.match')].map((m) => m.textContent).join(' ') === 'Billing DB',
        'two words found in a tag the row does not show: "· tag: Billing-DB", both highlighted');
      await fill('[aria-label="Command palette"] input', 'facturacion pwh');
      const labelRow = await waitFor(() => pwRow(), 'pwhost by its label and alias');
      await check(labelRow.querySelector('[data-match-field="label"]')?.textContent.includes('Facturación') && labelRow.querySelector('.mono .match')?.textContent === 'pwh',
        'accents ignored, words from two fields: "facturacion pwh" finds pwhost, its label shown and "pwh" highlighted');
      await fill('[aria-label="Command palette"] input', '0.2 pwh');
      await waitFor(() => pwRow()?.querySelector('.grow .match')?.textContent === '0.2', 'the hostname highlighted');
      await check(true, 'word order does not matter, and a host with no folder highlights its hostname: "0.2 pwh"');
      await fill('[aria-label="Command palette"] input', 'reconnect');
      await waitFor(() => q('[role="option"].hot')?.textContent.includes('Reconnect'), 'Reconnect hot');
      await check(!footer().includes('edit host') && !footer().includes('new tab'), 'the palette does not offer ⌘I or ⌘↵ on an action');
      q('[aria-label="Command palette"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(100);

      // A real keyboard sends keys to whatever has the focus, so these do too: a dialog
      // whose focus stayed behind it would ignore Esc.
      const press = (key, code, mods = {}) => (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...mods }));
      const cmd = (key, code) => press(key, code, { metaKey: mac, ctrlKey: !mac, shiftKey: !mac });
      const editorOpen = () => q('[role="dialog"][aria-label^="Edit host"]');
      async function escClosesEditor(how) {
        await waitFor(editorOpen, 'the host editor, ' + how);
        await sleep(150);
        await check(editorOpen().contains(document.activeElement), `the host editor opened ${how} has the focus`);
        press('Escape', 'Escape');
        await sleep(100);
        await check(!editorOpen(), `Esc closes the host editor opened ${how}`);
      }
      // ⌘T is "New session": ↵ opens another tab even for a host that already has one,
      // where ⌘P would switch to it.
      if (qa('.tab').length) {
        const before = qa('.tab').length;
        cmd('t', 'KeyT');
        const opened = await waitFor(() => qa('[aria-label="Command palette"] [role="option"]').find((o) => o.textContent.includes('open in tab')), 'a host with an open tab in the ⌘T palette');
        const alias = opened.querySelector('.mono').textContent;
        await check(q('[aria-label="Command palette"] input').placeholder === 'New session on…', '⌘T opens the palette as "New session on…"');
        await fill('[aria-label="Command palette"] input', alias);
        await waitFor(() => q('[role="option"].hot')?.textContent.includes(alias), alias + ' hot');
        await check(q('[role="option"].hot .hint')?.textContent === 'New tab', '⌘T offers a new tab for a host that has one open');
        press('Enter', 'Enter');
        await waitFor(() => qa('.tab').length === before + 1, 'a second tab of ' + alias);
        await check(q('.tab.on')?.textContent.includes(alias), `↵ in the ⌘T palette opens another tab of ${alias}`);
        q('.tab.on .tx').click();
        await waitFor(() => qa('.tab').length === before, 'the extra tab to close');
        await sleep(100);
      }
      cmd('k', 'KeyK');
      await waitFor(() => q('[aria-label="Command palette"]'), 'the palette again');
      await fill('[aria-label="Command palette"] input', 'pwh');
      await waitFor(() => q('[role="option"].hot')?.textContent.includes('pwhost'), 'pwhost hot');
      cmd('i', 'KeyI');
      await escClosesEditor('from the palette');
      if (qa('.tab').length) {
        (await waitFor(() => activePane()?.querySelector('textarea'), 'terminal textarea')).focus();
        cmd('i', 'KeyI');
        await escClosesEditor('from the terminal');
        // In the real app the terminal took the focus back from the editor, and xterm
        // swallowed Esc (owner walkthrough).
        cmd('i', 'KeyI');
        await waitFor(editorOpen, 'the host editor again');
        const ta = activePane().querySelector('textarea');
        ta.focus();
        await sleep(50);
        if (!editorOpen().contains(document.activeElement)) {
          // diag (Windows VM, 2026-11-19): where the focus is over the next 500 ms.
          const where = () => { const a = document.activeElement; return (a?.tagName || '-') + (a?.className ? '.' + String(a.className).split(' ')[0] : '') + (editorOpen().contains(a) ? ' (editor)' : ''); };
          const seen = [where()];
          for (let i = 0; i < 5; i++) { await sleep(100); seen.push(where()); }
          await log('diag: focus after ta.focus(), every 100 ms: ' + seen.join(' | ') + '; document.hasFocus=' + document.hasFocus());
        }
        await check(editorOpen().contains(document.activeElement), 'a dialog takes the focus back from the terminal behind it');
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
        await sleep(100);
        await check(!editorOpen(), 'Esc closes a dialog even when the key reaches the terminal behind it');
      }

      await setStep('settings');
      const openTabs = qa('.tab').length;
      // The shell prints a mark on every SIGWINCH: coming back must not resize it.
      if (openTabs) await runInTerminal("trap 'echo winch-$((5+5))' WINCH; echo kept-$((20+3))", 'kept-23');
      await click('.rail-btn', 'Settings');
      await click('.swatches .sw[aria-label="moss"]');
      await waitFor(() => document.documentElement.dataset.accent === 'moss', 'the accent');
      const accentNow = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase();
      await click('.theme-card', 'Dark');
      await waitFor(() => document.documentElement.dataset.theme === 'dark', 'the dark theme');
      await check(accentNow() === '#7BC98F', `the accent colour follows the setting in the dark theme (${accentNow()})`);
      await click('.theme-card', 'Light');
      await waitFor(() => document.documentElement.dataset.theme === 'light', 'the light theme');
      await check(accentNow() === '#4FA068', `the accent colour follows the setting in the light theme (${accentNow()})`);
      const saved = await window.backend.settings_get({});
      await check(saved.accent === 'moss' && saved.theme === 'light', 'appearance settings are saved');
      await click('.nav-i', 'Terminal');
      await waitFor(() => hasText('installed monospaced fonts'), 'the terminal settings');
      await click('[role="radiogroup"][aria-label="Terminal colours"] button', 'Aura');
      await waitForAsync(async () => (await window.backend.settings_get({})).term_theme === 'aura', 'the terminal theme to be saved');
      const preview = q('.set-row .term');
      await check(preview.style.getPropertyValue('--term-bg') === '#f3f0ff', `the preview uses Aura's light palette in the light theme (${preview.style.getPropertyValue('--term-bg')})`);
      const pane = q('[data-tab]');
      if (pane) await check(pane.style.getPropertyValue('--ansi-4') === '#7b58d6', 'an open terminal takes the chosen palette');
      await click('[role="radiogroup"][aria-label="Terminal colours"] button', 'Default');
      await waitFor(() => !q('.set-row .term').style.getPropertyValue('--term-bg'), 'the default palette (tokens) again');
      await check(true, 'Default goes back to the design tokens');
      await check(q('[data-sb-version]')?.textContent.trim() === `v${VERSION}`, `the status bar shows the version (${q('[data-sb-version]')?.textContent.trim()})`);
      await click('.nav-i', 'Appearance');

      // Milestone 46: the toast component (24a, 24b) and its corner (24h), driven
      // through the page's store (window.__flintE2E.toasts).
      await setStep('toasts');
      const T = window.__flintE2E.toasts;
      T.clear();
      const shown = () => qa('[data-toast]').filter((el) => !el.classList.contains('leaving'));
      const shownText = () => shown().map((el) => el.querySelector('.t-text').textContent);
      await waitFor(() => !q('[data-toasts]'), 'the stack to empty');
      await check(!!q('[data-toast-live="polite"]') && !!q('[data-toast-live="assertive"]'), 'both aria-live regions stay mounted with no toast on screen');
      await check((await window.backend.settings_get({})).toast_corner === 'bottom-right', 'toasts start in the bottom right corner');
      for (const t of ['one', 'two', 'three', 'four']) T.show({ text: 'toast ' + t });
      await waitFor(() => shown().length === 3, 'three toasts');
      await check(shownText().join(',') === 'toast two,toast three,toast four', `a stack of three, the oldest pushed out, the newest closest to the corner (${shownText()})`);
      const stack = q('[data-toasts]').getBoundingClientRect();
      const sb = q('.statusbar')?.getBoundingClientRect();
      await check(window.innerWidth - stack.right < 40 && (!sb || stack.bottom <= sb.top), `the stack sits bottom right, above the status bar (${Math.round(stack.right)}/${window.innerWidth}, ${Math.round(stack.bottom)}/${Math.round(sb?.top ?? -1)})`);
      await check(shown().every((el) => el.querySelector('[data-toast-close]')), 'every toast has a ✕');
      T.clear();

      T.show({ text: 'an error that stays', kind: 'error' });
      await waitFor(() => q('[data-toast-live="assertive"]').textContent === 'an error that stays', 'the error in the assertive region');
      await check(true, 'an error is announced in the assertive region');
      T.show({ text: 'a quick one', duration: 300 });
      await waitFor(() => q('[data-toast-live="polite"]').textContent === 'a quick one', 'the toast in the polite region');
      await waitFor(() => shownText().join() === 'an error that stays', 'the quick toast to leave', 15000);
      await check(true, 'a toast leaves after its own duration and an error stays longer (30 s)');
      shown()[0].querySelector('[data-toast-close]').click();
      await waitFor(() => shown().length === 0, 'the ✕ to close the error');
      await check(true, '✕ closes a toast');

      T.show({ text: 'paused while hovered', duration: 400 });
      const hovered = await waitFor(() => shown()[0], 'the hover toast');
      hovered.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
      await sleep(1500);
      await check(shownText().join() === 'paused while hovered', 'a hovered stack keeps its toasts');
      hovered.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
      await waitFor(() => shown().length === 0, 'the toast to leave once the pointer goes', 15000);
      await check(true, 'the timer resumes when the pointer leaves');

      T.show({ text: 'closed by Escape', kind: 'error' });
      await waitFor(() => shown().length === 1, 'the Escape toast');
      const startedAt = document.activeElement;
      for (let i = 0; i < 10 && !q('[data-toasts]')?.contains(document.activeElement); i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', code: 'F6', bubbles: true, cancelable: true }));
        await sleep(60);
        const ae = document.activeElement;
        await log(`diag: F6 ${i}: ${ae?.tagName}.${String(ae?.className).slice(0, 40)} toasts=${!!q('[data-toasts]')} shown=${shown().length}`);
      }
      await check(q('[data-toasts]').contains(document.activeElement), 'F6 reaches the toast stack like any other region');
      const fromEl = q('.nav-i.on') ?? q('.nav-i');
      fromEl.focus();
      q('[data-toast-close]', shown()[0]).focus();
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      await waitFor(() => shown().length === 0, 'Escape to close the focused toast');
      await check(true, 'Escape closes the toast holding the focus');
      await check(document.activeElement === fromEl, `the focus goes back where it came from (${document.activeElement?.className}, was ${startedAt?.className})`);

      T.show({ text: 'Flint 9.9.9 is available', kind: 'info', duration: 'sticky', key: 'e2e' });
      T.show({ text: 'Downloading Flint 9.9.9', kind: 'info', progress: 42, key: 'e2e' });
      await waitFor(() => shownText().join() === 'Downloading Flint 9.9.9', 'the keyed toast to change in place');
      await check(shown().length === 1 && shown()[0].querySelector('.t-prog')?.textContent === '42%', 'a key replaces the toast in place, with its progress');
      T.clear();

      let ran = '';
      T.show({ text: 'two buttons', duration: 'sticky', actions: [
        { label: 'Keep', run: () => { ran += 'k'; }, keepOpen: true },
        { label: 'Go', run: () => { ran += 'g'; } },
        { label: 'Third', run: () => {} }] });
      await waitFor(() => shown().length === 1, 'the toast with buttons');
      await check(qa('[data-toast-action]', shown()[0]).length === 2, 'a toast keeps two buttons at most');
      q('[data-toast-action="0"]', shown()[0]).click();
      await sleep(400);
      await check(ran === 'k' && shown().length === 1, 'an action that keeps the toast open leaves it up');
      q('[data-toast-action="1"]', shown()[0]).click();
      await waitFor(() => shown().length === 0, 'the second action to close the toast');
      await check(ran === 'kg', 'an action runs and closes the toast');

      T.show({ text: 'A long error that runs well past two lines of the toast so that More appears beside it: '.repeat(4), kind: 'error' });
      const more = await waitFor(() => shown()[0]?.querySelector('[data-toast-more]'), 'More on a long toast');
      await check(more.textContent === 'More', 'a text clamped at two lines gets More');
      more.click();
      await waitFor(() => shown()[0]?.classList.contains('expanded') && shown()[0].querySelector('[data-toast-more]').textContent === 'Less', 'the expanded toast');
      await check(true, 'More expands the toast, Less folds it');
      T.clear();

      await setStep('toast corner');
      await click('.cpick [data-corner="top-left"]');
      await waitForAsync(async () => (await window.backend.settings_get({})).toast_corner === 'top-left', 'the corner to be saved');
      await check(q('[data-corner-label]')?.textContent.startsWith('Top left'), 'the picker names the chosen corner');
      T.show({ text: 'top left', kind: 'error' });
      const tl = await waitFor(() => q('[data-toasts][data-corner="tl"]'), 'the stack in the top left');
      const r = tl.getBoundingClientRect();
      const rail = q('.rail')?.getBoundingClientRect();
      await check(r.top < window.innerHeight / 2 && (!rail || r.left >= rail.right), `the stack moves to the top left, never over the rail (${Math.round(r.left)},${Math.round(r.top)})`);
      T.clear();
      await click('.cpick [data-corner="bottom-right"]');
      await waitForAsync(async () => (await window.backend.settings_get({})).toast_corner === 'bottom-right', 'the default corner again');
      await check(true, 'the corner goes back to bottom right');
      await check(!!q('[role="radiogroup"][aria-label="Toast corner"]') && [...qa('.set-row .set-l .t')].some((e) => e.textContent === 'Toasts'), "Appearance names the corner picker's row Toasts (27c)");

      // Milestone 68: the window in Spanish, switched live from the Language row, with
      // no English left on any Settings section, the shell around it, or the palette.
      await setStep('Spanish, live');
      {
        const cats = window.__flintE2E.catalogs;
        const esValues = Object.values(cats.es);
        // The literal pieces of each English text that a Spanish window must not show:
        // two words or more, and not a piece the Spanish catalog itself uses.
        const englishPieces = [...new Set(Object.entries(cats.en).flatMap(([k, v]) => v.split(/\{\w+\}/)
          .map((p) => p.trim()).filter((p) => /[A-Za-z]{2,}\W+[A-Za-z]{2,}/.test(p) && p.length >= 10 && cats.es[k] !== v && !esValues.some((e) => e.includes(p)))))];
        const englishLeft = () => { const now = text(); return englishPieces.filter((p) => now.includes(p)); };
        const row = await waitFor(() => q('[role="radiogroup"][aria-label="Language"]'), 'the Language row');
        await check(row.querySelector('[aria-checked="true"]')?.getAttribute('data-language') === 'system' && document.documentElement.lang === 'en',
          'the Language row shows, on System by default, and the window is in English');
        const termBefore = q('[data-tab]');
        await click('[data-language="es"]');
        await waitForAsync(async () => (await window.backend.settings_get({})).language === 'es', 'Español to be saved');
        await waitFor(() => document.documentElement.lang === 'es' && q('h1')?.textContent === 'Apariencia', 'the page in Spanish');
        await check(!!q('[role="radiogroup"][aria-label="Idioma"]') && byText('.nav-i', 'Atajos de teclado') && byText('.nav-i', 'Bóveda'),
          'the switch is live: Appearance reads Apariencia, the sections Bóveda and Atajos de teclado, with no restart');
        await check(!termBefore || termBefore.isConnected, 'an open terminal tab is kept through the switch');
        const leaks = [];
        for (const nav of qa('.nav-i')) {
          nav.click();
          await sleep(250);
          for (const p of englishLeft()) leaks.push(`${nav.textContent.trim()}: ${p}`);
        }
        if (leaks.length) await log('diag: English left in Spanish: ' + JSON.stringify(leaks));
        await check(leaks.length === 0, `every Settings section, and the shell around it, is in Spanish (${leaks.length} English texts left)`);
        await check(hasText('Ajustes') && qa('.nav-i').length >= 6, 'the rail and the status bar are in Spanish too');
        await click('.nav-i', 'Apariencia');
        await click('[data-language="en"]');
        await waitFor(() => document.documentElement.lang === 'en' && q('h1')?.textContent === 'Appearance', 'the page in English again');
        await check(englishLeft().length > 0 && byText('.nav-i', 'Keyboard shortcuts'), 'English comes back live, too');
        await click('[data-language="system"]');
        await waitForAsync(async () => (await window.backend.settings_get({})).language === 'system', 'System to be saved');
        await check(true, 'the setting goes back to System');
      }

      // Milestone 63 (27a*): Settings → Notifications, the approval wait and phone alerts.
      // The server is pointed at a closed port on this machine: nothing leaves the run.
      await setStep('notifications');
      await click('.nav-i', 'Notifications');
      await waitFor(() => q('[data-phone-alerts]'), 'Settings → Notifications');
      {
        const picked = () => q('[data-approval-wait] [aria-checked="true"]')?.getAttribute('data-approval-wait-min');
        const sw = () => q('[data-setting="ntfy_on"]');
        const saved = () => window.backend.settings_get({});
        await check(picked() === '2' && sw()?.getAttribute('aria-checked') === 'false' && /An agent is waiting for your approval.*Flint is locked and an agent is waiting/.test(q('[data-alerts-off]')?.textContent ?? '') && !q('[data-ntfy-topic]'),
          'off by default (27a1): the wait at 2 min, and the two texts an alert would ever say');
        sw().click();
        await waitForAsync(async () => (await saved()).ntfy_on, 'alerts on');
        const topic = (await saved()).ntfy_topic;
        await waitFor(() => q('[data-ntfy-topic]')?.textContent === topic, 'the topic');
        await check(/^flint-[a-z2-7]{24}$/.test(topic), `turning alerts on makes this machine's random topic (${topic})`);
        await check(!!q('[data-ntfy-qr] svg path') && q('[data-ntfy-url]')?.textContent === 'ntfy.sh/' + topic, 'with a QR and the address to subscribe to (27a2)');
        // Milestone 65: the QR is for an iPhone (the web address and the + step) or an
        // Android (ntfy://, which subscribes in one scan).
        const qrLabel = () => q('[data-ntfy-qr] svg')?.getAttribute('aria-label') ?? '';
        await check(q('[data-phone="iphone"]')?.getAttribute('aria-checked') === 'true' && qrLabel() === `QR code for https://ntfy.sh/${topic}` && !!q('[data-ntfy-steps="iphone"]'), "the QR is the iPhone's by default: the topic's web address and the + step");
        q('[data-phone="android"]').click();
        await waitForAsync(async () => ((await window.backend.settings_get({})).ntfy_phone === 'android' ? true : null), 'Android saved');
        await waitFor(() => qrLabel().startsWith('QR code for ntfy://'), "Android's code");
        await check(qrLabel() === `QR code for ntfy://ntfy.sh/${topic}?display=Flint` && !!q('[data-ntfy-steps="android"]') && q('[data-ntfy-url]')?.textContent === 'ntfy.sh/' + topic, "Android's QR is ntfy:// with no + step, the address shown the same");
        q('[data-phone="iphone"]').click();
        await waitForAsync(async () => ((await window.backend.settings_get({})).ntfy_phone === 'iphone' ? true : null), 'iPhone saved again');
        await check(q('[data-ntfy-preview]')?.textContent.includes('An agent is waiting for your approval') && q('[data-ntfy-preview]')?.textContent.includes('High priority'), "and what the phone shows, the locked one high priority");
        await check(!!q('[data-alerts-wait-tip]'), 'at 2 min it suggests 5 or more');
        q('[data-alerts-use-wait]').click();
        await waitForAsync(async () => (await saved()).approval_wait === 5, 'the wait at 5 min');
        await waitFor(() => !q('[data-alerts-wait-tip]') && picked() === '5', 'the suggestion gone');
        await check(true, 'Use 5 min sets the wait and the suggestion goes');
        const server = q('[data-ntfy-server]');
        setValue(server, 'ntfy.home');
        await waitFor(() => q('[data-ntfy-server-error]'), 'the server error');
        server.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await sleep(200);
        await check((await saved()).ntfy_server === 'https://ntfy.sh', 'an address that is not one is refused and not saved (27a5)');
        setValue(server, 'http://127.0.0.1:9');
        server.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await waitForAsync(async () => (await saved()).ntfy_server === 'http://127.0.0.1:9', 'the own server saved');
        await check(!!q('[data-ntfy-http]'), 'a plain http:// server says what that means');
        q('[data-ntfy-test]').click();
        const failed = await waitFor(() => q('[data-ntfy-status="error"]'), 'the failed test', 20000);
        await check(/Last alert couldn't be sent · \d\d:\d\d · couldn't reach 127\.0\.0\.1:9/.test(failed.textContent) && failed.textContent.includes('Approvals are unaffected'), `a publish that fails says why, in Settings (27a4): ${failed.textContent}`);
        q('[data-ntfy-new-topic]').click();
        await waitFor(() => q('[data-ntfy-new-topic-confirm]'), 'the New topic confirmation');
        q('[data-ntfy-new-topic-go]').click();
        await waitForAsync(async () => (await saved()).ntfy_topic !== topic, 'a new topic');
        const fresh = (await saved()).ntfy_topic;
        await waitFor(() => q('[data-ntfy-topic]')?.textContent === fresh, 'the new topic shown');
        await check(/^flint-[a-z2-7]{24}$/.test(fresh) && !q('[data-ntfy-new-topic-confirm]'), 'New topic, confirmed, replaces the topic (27a6)');
        q('[data-approval-wait-min="30"]').click();
        await waitFor(() => q('[data-approval-wait-note]'), 'the 30-minute note');
        await check(q('[data-approval-wait-note]').textContent.includes('in the background'), 'at 30 minutes the wait notes that the program must wait that long');
        const back = await saved();
        await window.backend.settings_set({ ...back, ntfy_on: false, ntfy_server: 'https://ntfy.sh', approval_wait: 2 });
        await click('.nav-i', 'Access');
        await waitFor(() => q('[data-sudo-periods]'), 'Settings → Access');
        await check(!q('[data-approval-wait]'), 'Access no longer holds the approval wait (27b)');
      }

      await openAbout();
      await waitFor(() => q('[data-about-version]'), 'the About section from the status bar');
      await check(q('.nav-i.on')?.textContent.includes('About'), "the status bar version's About Flint opens Settings → About");
      await check(q('[data-about-version]').textContent.trim() === `Flint ${VERSION}`, `Settings → About shows the build's version (${q('[data-about-version]').textContent.trim()})`);
      await check([...qa('[data-about-libs] tr')].every((r) => r.cells[1].textContent.trim() !== '—') && /\d/.test(q('[data-about-libs]').textContent), 'About lists the linked libraries with their versions');
      await click('.nav-i', 'Vault');
      await waitFor(() => hasText('Known hosts'), 'the vault settings');
      await check(byText('td', `[127.0.0.1]:${PORT}`), 'known hosts are listed');
      // The open vault's counts, read from the open file, even with no cached key (the
      // keychain is off here): before, the page unlocked the vault again through the
      // keychain, which on macOS showed a Keychain dialog.
      await waitFor(() => /\d+ hosts? · .*format v\d/.test(text()), 'the vault counts');
      await check(hasText('3 hosts · 1 key · 0 credentials · '), `the vault page counts the open vault (${(text().match(/\d+ hosts?[^\n]*format v\d/) ?? ['none'])[0]})`);
      // Forget a known host here, then connect to it: the owner's walkthrough found the
      // host key card dead (no click, ↵ or esc) on this path.
      await setStep('forget a known host and trust it again');
      await click('button', 'Forget', byText('tr', `[127.0.0.1]:${PORT}`));
      await click('.modal button', 'Forget');
      await waitFor(() => !byText('td', `[127.0.0.1]:${PORT}`), 'the known host to be forgotten');
      await click('.rail-btn', 'Hosts');
      const tabsBefore = qa('.tab').length;
      for (const how of ['esc', 'a click']) {
        cmd('t', 'KeyT');
        await fill('[aria-label="Command palette"] input', 'local');
        await waitFor(() => q('[role="option"].hot')?.textContent.includes('local'), 'local hot');
        press('Enter', 'Enter');
        await waitFor(() => qa('.tab').length === tabsBefore + 1 && hasText('before connecting'), 'the host key prompt after a forget');
        await sleep(200);
        // A real ↵ submits the form only when the focus is on it; a synthetic one never
        // does, so this checks the focus and leaves the submit to the click below.
        // el.click() skips hit-testing; a mouse lands on whatever is on top. xterm's
        // layers were above the card, so a real click selected terminal text instead.
        const trustBtn = byText('button[type="submit"]', 'Trust and connect');
        const r = trustBtn.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        await check(trustBtn.contains(hit), `a click on Trust and connect lands on it (${hit?.tagName} ${hit?.className})`);
        await check(document.activeElement?.textContent.includes('Trust and connect'), `the host key card puts the focus on Trust and connect (${document.activeElement?.tagName} ${document.activeElement?.textContent.slice(0, 30)})`);
        if (how === 'esc') {
          press('Escape', 'Escape');
          await waitFor(() => !hasText('before connecting'), 'esc to cancel the host key prompt');
          await check(true, 'esc cancels the host key card after a forget');
        } else {
          await click('button[type="submit"]', 'Trust and connect');
          await waitFor(() => toolbarIs('ready'), 'the session after a click on Trust', 30000);
          await check(true, 'a click on Trust and connect trusts the key again after a forget');
        }
        q('.tab.on .tx').click();
        await waitFor(() => qa('.tab').length === tabsBefore, 'the extra tab to close');
      }
      await click('.rail-btn', 'Settings');
      await click('.nav-i', 'Vault');
      await waitFor(() => hasText('Known hosts'), 'the vault settings');
      await sleep(500);
      await check(byText('td', `[127.0.0.1]:${PORT}`), 'a key trusted in a session shows up in Known hosts');

      if (openTabs) {
        await click('.rail-btn', 'Hosts');
        await waitFor(() => activeTerm(), 'the session view');
        await check(termText().includes('kept-23'), 'a terminal keeps its scrollback across a visit to Settings');
        await sleep(600);
        await check(!termText().includes('winch-10'), 'coming back from Settings sends the shell no resize');
      }

      await setStep('app state: sidebar and groups');
      // The Hosts button toggles the sidebar when the Hosts view is already shown.
      if (!q('.sidebar')) await click('.rail-btn', 'Hosts');
      await click('.side-head .icon-btn[aria-label="New group"]');
      await fill('#ta', 'e2e-grp');
      await click('.modal button[type="submit"]');
      const grpRow = () => byText('.tree .ti[aria-expanded]', 'e2e-grp');
      await waitFor(grpRow, 'the new group in the tree');
      const uiState = () => window.backend.ui_state_get({});
      grpRow().click();
      await waitForAsync(async () => (await uiState()).collapsed.includes('e2e-grp'), 'the collapsed group to be stored');
      await check(grpRow().getAttribute('aria-expanded') === 'false', 'a collapsed group is stored for this vault');
      await click('.side-head .icon-btn[aria-label="Expand all groups"]');
      await waitForAsync(async () => (await uiState()).collapsed.length === 0, 'expand all to be stored');
      await check(qa('.tree .ti[aria-expanded="false"]').length === 0, 'Expand all opens every group');
      await click('.side-head .icon-btn[aria-label="Collapse all groups"]');
      await waitForAsync(async () => (await uiState()).collapsed.length === qa('.tree .ti[aria-expanded]').length, 'collapse all to be stored');
      await check(qa('.tree .ti[aria-expanded="true"]').length === 0, 'Collapse all closes every group');
      const resizer = await waitFor(() => q('.sidebar-resize'), 'the sidebar resize handle');
      resizer.focus();
      resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true }));
      await waitForAsync(async () => (await uiState()).sidebar_width === 280, 'the new sidebar width to be stored');
      await check(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w').trim() === '280px', 'the sidebar takes the new width');
      if (window.innerWidth >= 1040) {
        await click('.rail-btn', 'Hosts');
        await waitForAsync(async () => (await uiState()).sidebar_open === false, 'the closed sidebar to be stored');
        await check(!q('.sidebar'), 'the Hosts button closes the sidebar, and that is remembered');
        await click('.rail-btn', 'Settings');
        await click('.rail-btn', 'Hosts');
        await sleep(200);
        await check(!q('.sidebar') && (await uiState()).sidebar_open === false, 'coming back from Settings keeps the sidebar closed');
        await click('.rail-btn', 'Settings');
        // ⇧⌘H (Ctrl+Alt+Shift+H elsewhere), the Hosts button's shortcut.
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'H', code: 'KeyH', bubbles: true, cancelable: true,
          metaKey: isMac, ctrlKey: !isMac, shiftKey: true, altKey: !isMac }));
        await waitFor(() => document.querySelector('.app')?.dataset.view === 'hosts', 'the Hosts view from its shortcut');
        await sleep(200);
        await check(!q('.sidebar') && (await uiState()).sidebar_open === false, 'the Hosts shortcut from Settings keeps the sidebar closed');
        await click('.rail-btn', 'Hosts');
        await waitForAsync(async () => (await uiState()).sidebar_open === true, 'the open sidebar to be stored');
      } else {
        await log(`skip sidebar open/closed: the window is ${window.innerWidth} px, too narrow to dock it`);
      }

      await setStep('rdp hosts: type step, editor, glyphs, menu (milestone 29)');
      {
        if (!q('.sidebar')) await click('.rail-btn', 'Hosts');
        const key = (k, code, mods = {}) => (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, ...mods }));
        const cred = (name, user, keyName, password) => window.backend.cred_add({ name, set_name: true, user, set_user: true,
          key: keyName, set_key: !!keyName, password, set_password: !!password });
        await cred('domain-login', 'e2e', '', 'rdp-cred-pw');
        await cred('deploy', 'deploy', 'e2e-key', '');
        await click('.side-head .icon-btn[aria-label^="New host"]');
        await waitFor(() => q('[data-host-type-step]'), 'the type step');
        await check(q('.type-card[data-type="ssh"]')?.getAttribute('aria-checked') === 'true', 'New host asks the type first, SSH chosen');
        key('2', 'Digit2');
        await waitFor(() => q('.type-card[data-type="rdp"]')?.getAttribute('aria-checked') === 'true', 'RDP chosen');
        key('Enter', 'Enter');
        await waitFor(() => q('[data-rdp-editor]'), 'the RDP editor');
        await check(q('[data-type-badge="rdp"]'), '2 then ↵ opens the RDP editor with its fixed type badge');
        await check(!q('#hc') && !q('[data-sudo-field]') && !byText('.modal .flabel', 'Jump host') && !q('[data-host-tunnels]'),
          'the RDP editor has no initial command, sudo, jump host or tunnels');
        await check(!byText('.modal button', 'Test connection') && q('[data-test-reserved]'), 'the RDP editor keeps a place for Test connection, no button yet');
        await fill('#ra', 'win-e2e');
        await fill('#rp', '70000');
        await click('.modal button[type="submit"]', 'Add host');
        await waitFor(() => hasText('Enter an address'), 'the address error');
        await check(hasText('Use 1–65535.'), 'a missing address and a bad port are marked on their fields');
        await fill('#rh', '10.20.0.15');
        await fill('#rp', '');
        await fill('#ru', 'e2e');
        await fill('#rd', 'CORP');
        await fill('.modal input[aria-label="Password"]', 'rdp-host-pw-marker');
        await click('.modal button[type="submit"]', 'Add host');
        await waitFor(() => byText('.tree .ti', 'win-e2e'), 'win-e2e in the tree');
        const cat = await window.backend.catalog({});
        const win = cat.hosts.find((h) => h.alias === 'win-e2e');
        await check(win?.type === 'rdp' && win.port === 3389 && win.domain === 'CORP' && win.user === 'e2e' && win.has_password,
          `the RDP host is saved with port 3389 and its domain (${JSON.stringify(win)})`);
        await check(!JSON.stringify(cat).includes('rdp-host-pw-marker'), 'the catalog carries no RDP password (Principle 6)');
        await check(byText('.tree .ti', 'win-e2e').querySelector('[data-htype="rdp"]') && byText('.tree .ti', 'local').querySelector('[data-htype="ssh"]'),
          'the tree marks each host with its type');

        await setStep('rdp hosts: credential with a password only');
        const row = () => byText('.tree .ti', 'win-e2e');
        const menu = () => { const r = row().getBoundingClientRect(); row().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 })); };
        menu();
        await waitFor(() => q('[role="menu"]'), 'the context menu');
        const items = qa('[role="menu"] .mi').map((b) => b.textContent);
        await check(items.some((t) => t.startsWith('Connect')) && items.some((t) => t.startsWith('Copy address')) && !items.some((t) => t.includes('new tab')),
          `an RDP host's menu has Connect, Edit, Copy address and Delete, no new tab (${items.join(' | ')})`);
        await click('[role="menu"] .mi', 'Edit host');
        await waitFor(() => q('[data-rdp-editor]'), 'the RDP editor (edit)');
        await click('.modal .seg button', 'Credential');
        await click('button.select[aria-label="Credential"]');
        const deploy = await waitFor(() => byText('[role="listbox"] .mi', 'deploy'), 'the key-only credential');
        await check(deploy.getAttribute('aria-disabled') === 'true' && deploy.textContent.includes('Only has an SSH key'), 'a key-only credential is listed but not choosable');
        deploy.click();
        await sleep(60);
        await click('[role="listbox"] .mi', 'domain-login');
        await click('.modal button[type="submit"]', 'Save');
        await waitForAsync(async () => (await window.backend.catalog({})).hosts.find((h) => h.alias === 'win-e2e')?.credential === 'domain-login', 'the credential to be saved');
        const after = (await window.backend.catalog({})).hosts.find((h) => h.alias === 'win-e2e');
        await check(!after.has_password, 'switching to a credential removes the host\'s own password');

        await setStep('rdp hosts: audio and microphone (milestone 60)');
        await check(after.audio === 'local' && after.microphone === false, `a new RDP host plays its audio here, microphone off (${after.audio}, ${after.microphone})`);
        menu();
        await waitFor(() => q('[role="menu"]'), 'the context menu');
        await click('[role="menu"] .mi', 'Edit host');
        await waitFor(() => q('[data-rdp-audio]'), 'the Audio section');
        await check(q('[data-audio="local"]')?.getAttribute('aria-pressed') === 'true' && q('[data-microphone]')?.getAttribute('aria-checked') === 'false',
          'the Audio section shows On this computer and the microphone off (25d1)');
        await check(!q('[data-mic-permission]'), 'no permission notice while the microphone is off');
        q('[data-audio="remote"]').click();
        q('[data-microphone]').click();
        await sleep(60);
        await check(q('[data-audio="remote"]')?.getAttribute('aria-pressed') === 'true' && q('[data-microphone]')?.getAttribute('aria-checked') === 'true',
          'On the remote computer and the microphone switch take a click');
        await check(isMac ? !!q('[data-mic-permission]') : !q('[data-mic-permission]'), 'turning the microphone on shows macOS\'s permission notice on a Mac only (25d2)');
        await click('.modal button[type="submit"]', 'Save');
        await waitForAsync(async () => (await window.backend.catalog({})).hosts.find((h) => h.alias === 'win-e2e')?.microphone === true, 'the microphone to be saved');
        const sound = (await window.backend.catalog({})).hosts.find((h) => h.alias === 'win-e2e');
        await check(sound.audio === 'remote' && sound.microphone === true && sound.credential === 'domain-login', `the audio and the microphone are saved, nothing else changed (${JSON.stringify([sound.audio, sound.microphone, sound.credential])})`);
        menu();
        await waitFor(() => q('[role="menu"]'), 'the context menu');
        await click('[role="menu"] .mi', 'Edit host');
        await waitFor(() => q('[data-rdp-audio]'), 'the Audio section');
        await check(q('[data-audio="remote"]')?.getAttribute('aria-pressed') === 'true' && q('[data-microphone]')?.getAttribute('aria-checked') === 'true' && !q('[data-mic-permission]'),
          'opened again it shows what was saved, with no notice for a microphone already on');
        q('[data-audio="local"]').click();
        q('[data-microphone]').click();
        await sleep(60);
        await click('.modal button[type="submit"]', 'Save');
        await waitForAsync(async () => (await window.backend.catalog({})).hosts.find((h) => h.alias === 'win-e2e')?.microphone === false, 'the microphone off again');

        await setStep('rdp hosts: connect, palette');
        const tabsBefore = qa('.tab').length;
        row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await waitFor(() => q('[data-rdp-toolbar]'), 'the RDP tab');
        await check(qa('.tab').length === tabsBefore + 1 && q('.tab.on [data-htype="rdp"]'), 'opening an RDP host opens a remote desktop tab marked RDP');
        await click('.tab.on .tx');
        await waitFor(() => qa('.tab').length === tabsBefore, 'the RDP tab closed');
        key('k', 'KeyK', { metaKey: isMac, ctrlKey: !isMac, shiftKey: !isMac });
        await waitFor(() => q('[aria-label="Command palette"]'), 'the palette');
        await fill('[aria-label="Command palette"] input', 'win-e2e');
        const opt = await waitFor(() => byText('[role="option"]', 'win-e2e'), 'win-e2e in the palette');
        await check(opt.querySelector('[data-htype="rdp"]') && !byText('[role="option"]', 'win-e2e in a new pane'), 'the palette marks the RDP host and offers no pane for it');
        await fill('[aria-label="Command palette"] input', 'New RDP host');
        await waitFor(() => q('[role="option"].hot')?.textContent.includes('New RDP host'), 'New RDP host hot');
        key('Enter', 'Enter');
        await waitFor(() => q('[data-rdp-editor]'), 'the RDP editor from the palette');
        await check(!q('[data-host-type-step]'), 'New RDP host skips the type step');
        await click('.modal button', 'Cancel');
        await waitFor(() => !q('.modal'), 'the editor closed');
        key('k', 'KeyK', { metaKey: isMac, ctrlKey: !isMac, shiftKey: !isMac });
        await waitFor(() => q('[aria-label="Command palette"]'), 'the palette');
        await fill('[aria-label="Command palette"] input', 'New SSH host');
        await waitFor(() => q('[role="option"].hot')?.textContent.includes('New SSH host'), 'New SSH host hot');
        key('Enter', 'Enter');
        await waitFor(() => q('[data-type-badge="ssh"]'), 'the SSH editor from the palette');
        await check(q('#ha') && !q('[data-host-type-step]'), 'New SSH host skips the type step');
        await click('.modal button', 'Cancel');
        await waitFor(() => !q('.modal'), 'the editor closed');

        menu();
        await click('[role="menu"] .mi', 'Delete host');
        await click('.modal button', 'Delete host');
        await waitFor(() => !row(), 'win-e2e gone');
        await window.backend.cred_rm({ name: 'domain-login' });
        await window.backend.cred_rm({ name: 'deploy' });
        await check(true, 'an RDP host is deleted from its menu');
      }

      await setStep('rename the vault');
      await click('.rail-btn', 'Settings');
      await click('.nav-i', 'Vault');
      await click('button', 'Rename…');
      await fill('[aria-label="Vault name"]', 'E2E Renamed');
      await click('button[type="submit"]', 'Save');
      await waitFor(() => hasText('Renamed E2E Vault to E2E Renamed'), 'the rename notice');
      const recents = await window.backend.vault_recents({});
      await check(recents[0].name === 'E2E Renamed', 'the recent list shows the new name');
      await click('.rail-btn', 'Hosts');
      await check(q('.vault-btn .vault-name').textContent === 'E2E Renamed', 'the vault button shows the new name');

      {
        const r = q('.titlebar .tb-title').getBoundingClientRect();
        await check(Math.abs(r.left + r.width / 2 - window.innerWidth / 2) <= 1, 'the title is centred on the window');
      }
      await click('.rail-btn', 'Settings');
      await click('.nav-i', 'Vault');
      await waitFor(() => byText('button', 'Rename…'), 'the vault settings');
      await check(!hasText('Import from Tether'), 'Settings → Vault offers no Tether import (milestone 24)');

      await setStep('change the master password (milestone 40)');
      {
        const NEW_MASTER = 'gravel onion tundra quartz';
        const idBefore = (await window.backend.vault_recents({}))[0];
        const catalogBefore = await window.backend.catalog({});
        await click('button', 'Change master password…');
        await waitFor(() => q('.modal #cmp-current'), 'the change dialog');
        await fill('#cmp-new', 'monkey2026');
        await waitFor(() => q('[data-testid="strength-label"]')?.textContent === 'Weak', 'the estimate of a weak password', 5000);
        await check(q('[data-testid="strength-advice"]')?.textContent.includes('A remote vault will need Strong'), 'a weak password is shown as weak, with the remote vault\'s need');
        await check(q('.modal button[type="submit"]').disabled, 'nothing to submit without the current password and the confirmation');
        await fill('#cmp-new', NEW_MASTER);
        await waitFor(() => q('[data-testid="strength-label"]')?.textContent === 'Very strong', 'the estimate of a strong password', 5000);
        await fill('#cmp-new2', NEW_MASTER);
        await fill('#cmp-current', 'not-the-master-password');
        await click('.modal button[type="submit"]', 'Change password');
        await waitFor(() => hasText('The current master password is wrong.'), 'the wrong current password', 30000);
        await check(!!q('.modal #cmp-current'), 'a wrong current password keeps the dialog open');
        await fill('#cmp-current', MASTER);
        await click('.modal button[type="submit"]', 'Change password');
        await waitFor(() => !q('.modal #cmp-current') && hasText('Master password changed'), 'the change to finish', 60000);
        await check(true, 'the master password changes from Settings → Vault');
        const after = await window.backend.catalog({});
        await check(after.hosts.length === catalogBefore.hosts.length, 'the vault still reads, with every host');
        await check((await window.backend.vault_recents({}))[0].path === idBefore.path, 'the vault keeps its place in the list');
        // And back, so the steps below unlock with MASTER.
        await click('button', 'Change master password…');
        await waitFor(() => q('.modal #cmp-current'), 'the change dialog again');
        await fill('#cmp-current', NEW_MASTER);
        await fill('#cmp-new', MASTER);
        await fill('#cmp-new2', MASTER);
        await click('.modal button[type="submit"]', 'Change password');
        await waitFor(() => !q('.modal #cmp-current') && !hasText('The current master password is wrong.'), 'the change back to finish', 60000);
        await check(true, 'the new password is the vault\'s: it changes back with it');
      }

      await setStep('lock');
      // A session that must keep running under the lock screen (D-042).
      await click('.rail-btn', 'Hosts');
      await waitFor(() => byText('.tree .ti', 'local'), 'local in the tree');
      byText('.tree .ti', 'local').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await waitFor(() => toolbarIs('ready'), 'a session before locking', 30000);
      await runInTerminal('echo before-lock-$((1+1))', 'before-lock-2');
      const vaultPath = (await window.backend.vault_status({})).path;
      await click('.statusbar .sb-btn', 'Lock');
      await waitFor(() => q('.lock-screen [data-lock-reason="manual"]'), 'the lock screen');
      await check(hasText('Master password'), 'Lock shows the lock screen');
      await check(qa('.tab').length > 0 && !!q('.tab')?.closest('[inert]'), 'the tabs stay, behind the lock screen and out of reach');
      await check(hasText('keeps running') || hasText('keep running'), 'the lock screen says the sessions keep running');
      await check(q('[data-remember] input') && !q('[data-remember] input').checked, 'Remember on this computer is offered, unticked');
      {
        let refused = '';
        try { await window.backend.catalog({}); } catch (e) { refused = String(e?.message ?? e); }
        await check(refused.startsWith('locked'), 'a locked vault answers nothing');
        refused = '';
        try { await window.backend.vault_unlock({ path: vaultPath, password: '' }); } catch (e) { refused = String(e?.message ?? e); }
        await check(refused.startsWith('locked'), 'a vault locked in this run never reopens without its master password');
      }
      await fill('#pw', 'wrong-password');
      await click('button[type="submit"]', 'Unlock');
      await waitFor(() => hasText('Wrong password'), 'the wrong password message', 30000);
      await check(true, 'a wrong master password is refused');
      await waitFor(() => { const pw = q('#pw'); return pw && !pw.disabled && pw.selectionEnd === pw.value.length && pw.selectionStart === 0 && pw.value.length > 0 ? pw : null; }, 'the attempt selected');
      await check(q('#pw').value === 'wrong-password', 'the wrong attempt stays in the field, selected');
      await fill('#pw', MASTER);
      await click('button[type="submit"]', 'Unlock');
      {
        // Argon2id runs on a worker: another call answers while the unlock is still
        // deriving the key (an unlock on the UI thread would answer it afterwards).
        const t0 = performance.now();
        await window.backend.app_info({});
        const answered = performance.now() - t0;
        const stillUnlocking = !(byText('.tree .ti', 'local') || grpRow());
        log(`app_info answered in ${Math.round(answered)} ms during the unlock`);
        await check(stillUnlocking && answered < 300, 'the window answers while the vault unlocks');
      }
      await waitFor(() => byText('.tree .ti', 'local') || grpRow(), 'the unlocked tree', 30000);
      await check(true, 'the right master password unlocks the vault again');
      // The tree can show a moment before the lock screen leaves (seen on Windows): wait.
      const lockGone = () => !q('.lock-screen') && !q('.tab')?.closest('[inert]');
      try { await waitFor(lockGone, 'the lock screen to go', 5000); } catch {}
      await check(lockGone(), 'the lock screen is gone');
      await runInTerminal('echo after-lock-$((2+2))', 'after-lock-4');
      await check(true, 'the session that ran under the lock screen still works');

      await setStep('lock on screen lock and sleep');
      for (const kind of ['screen', 'sleep']) {
        await window.backend.e2e_system_event({ name: kind });
        await waitFor(() => q(`.lock-screen [data-lock-reason="${kind}"]`), `the lock screen after ${kind}`, 10000);
        await check(true, `the vault locks on ${kind === 'screen' ? 'a screen lock' : 'sleep'}`);
        await fill('#pw', MASTER);
        await click('button[type="submit"]', 'Unlock');
        await waitFor(() => !q('.lock-screen') && (byText('.tree .ti', 'local') || grpRow()), 'the unlocked tree', 30000);
      }
      await check(qa('.tab').length > 0, 'the tabs are still there after both locks');
      await waitFor(() => grpRow()?.getAttribute('aria-expanded') === 'false', 'the collapsed group after unlocking');
      await check(true, 'the vault opens with its groups collapsed as they were left');
      await check(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w').trim() === '280px', 'and with the sidebar width that was set');

      await setStep('window closed to the tray');
      await window.backend.e2e_close_window({});
      await waitFor(() => q('[data-window-lock]'), 'the window lock screen', 10000);
      await check(hasText('The vault is still unlocked'), 'closing the window locks it, the vault stays unlocked');
      await check(!!q('.tab')?.closest('[inert]'), 'the tabs are behind the window lock, out of reach');
      {
        const refusal = async (fn) => { try { await fn(); return 'answered'; } catch (e) { return String(e?.message ?? e); } };
        await check((await refusal(() => window.backend.catalog({}))).startsWith('locked'), 'a locked window reads nothing from the vault');
        const tab = q('[data-tab]')?.getAttribute('data-tab') ?? 'none';
        await check((await refusal(() => window.backend.session_input({ session: tab, data: 'x' }))).startsWith('locked'), 'a locked window types into no session');
        await check((await refusal(() => window.backend.vault_unlock({ path: vaultPath, password: '' }))).startsWith('locked'), 'a locked window does not reopen the vault without a password');
        const acc = await window.backend.access_state({});
        await check(acc.pending.length === 0 && acc.grants.length === 0, 'a locked window shows no grant and no caller');
        await check((await window.backend.window_state({})).locked, 'the core reports the window locked');
        const isMacKeys = (await window.backend.app_info({})).os === 'mac';
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true, cancelable: true, metaKey: isMacKeys, ctrlKey: !isMacKeys, shiftKey: !isMacKeys }));
        await sleep(300);
        await check(!q('[aria-label="Command palette"]'), 'a shortcut under the window lock opens nothing behind it');
      }
      await fill('#wpw', 'not-the-master-password');
      await click('button[type="submit"]', 'Open');
      await waitFor(() => hasText('Wrong password.'), 'the wrong password message', 30000);
      await check(!!q('[data-window-lock]'), 'a wrong password leaves the window locked');
      await fill('#wpw', MASTER);
      await click('button[type="submit"]', 'Open');
      await waitFor(() => !q('[data-window-lock]'), 'the window to open', 30000);
      await check(!q('.tab')?.closest('[inert]') && (byText('.tree .ti', 'local') || grpRow()), 'the master password opens the window on the same vault');
      await check(!q('[aria-label="Command palette"]'), 'and the shortcut typed under the lock was not kept for later');
      await runInTerminal('echo after-window-$((3+3))', 'after-window-6');
      await check(true, 'the session that ran behind the window lock still works');

      // Milestone 65 (D-138 (3)): a desktop with no tray asks once what ✕ does.
      await setStep('✕ with no tray asks once');
      await window.backend.e2e_set_tray({ tray: false });
      await window.backend.e2e_close_window({});
      await waitFor(() => q('[data-close-ask]'), 'the close question', 10000);
      await check(!q('[data-window-lock]'), 'with no answer the window stays open and asks');
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await waitFor(() => !q('[data-close-ask]'), 'the question to go on Esc', 5000);
      await check((await window.backend.settings_get({})).close_action === '', 'Esc keeps no answer');
      await window.backend.e2e_close_window({});
      await waitFor(() => q('[data-close-ask-keep]'), 'the close question again', 10000);
      await click('[data-close-ask-keep]', 'Keep running');
      await waitFor(() => q('[data-window-lock]'), 'the window lock after Keep running', 10000);
      await check((await window.backend.settings_get({})).close_action === 'background', 'Keep running is kept in the settings');
      await fill('#wpw', MASTER);
      await click('button[type="submit"]', 'Open');
      await waitFor(() => !q('[data-window-lock]'), 'the window to open', 30000);
      await window.backend.e2e_close_window({});
      await waitFor(() => q('[data-window-lock]'), 'the window lock with the answer kept', 10000);
      await check(!q('[data-close-ask]'), 'answered, a later ✕ hides the window without asking');
      await fill('#wpw', MASTER);
      await click('button[type="submit"]', 'Open');
      await waitFor(() => !q('[data-window-lock]'), 'the window to open', 30000);
      const openAccess = async () => {
        await click('.rail-btn', 'Settings');
        await click('.nav-i', 'Access');
        await waitFor(() => q('[data-sudo-periods]'), 'Settings → Access');
      };
      await openAccess();
      await waitFor(() => q('[data-close-action-row]'), "Access's row for closing the window", 10000);
      await check(q('[data-close="background"]')?.getAttribute('aria-checked') === 'true', 'Settings shows Keep running');
      await click('[data-close="quit"]', 'Quit');
      await waitForAsync(async () => ((await window.backend.settings_get({})).close_action === 'quit' ? true : null), 'Quit saved');
      await check(hasText('Flint quits'), 'the row says what Quit does');
      await click('[data-close="ask"]', 'Ask');
      await waitForAsync(async () => ((await window.backend.settings_get({})).close_action === '' ? true : null), 'Ask saved');
      await window.backend.e2e_set_tray({ tray: true });
      await click('.nav-i', 'Vault');
      await click('.nav-i', 'Access');
      await waitFor(() => q('[data-sudo-periods]'), 'Settings → Access');
      await sleep(500);
      await check(!q('[data-close-action-row]'), 'with a tray the row is not offered');
      await click('.rail-btn', 'Hosts');

      // Milestone 68 (ROADMAP §9): the unlock screen of a closed vault offers a remote
      // vault, and its Switch vault menu stays inside a short window. The headless
      // window cannot be resized (CF-111), so the page is told how tall it is.
      await setStep('the unlock screen in a short window');
      await click('.statusbar .sb-btn', 'Lock');
      await waitFor(() => q('.lock-screen [data-lock-reason="manual"]'), 'the lock screen');
      await click('.lock-screen button', 'Close vault');
      await waitFor(() => !q('.lock-screen') && q('form[aria-label="Unlock vault"]'), 'the unlock screen of the closed vault', 15000);
      {
        const height = Object.getOwnPropertyDescriptor(window, 'innerHeight');
        const setHeight = (h) => {
          if (h) Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => h });
          else if (height) Object.defineProperty(window, 'innerHeight', height);
          else delete window.innerHeight;
          window.dispatchEvent(new Event('resize'));
        };
        const menu = () => q('.menu[role="dialog"]');
        try {
          const footer = byText('form[aria-label="Unlock vault"] button', 'Switch vault').getBoundingClientRect();
          const short = Math.round(footer.bottom + 60);
          setHeight(short);
          await click('form[aria-label="Unlock vault"] button', 'Switch vault');
          const m = await waitFor(() => menu(), 'the Switch vault menu');
          await sleep(100);
          const r = m.getBoundingClientRect();
          const connect = byText('.menu .mi', 'Connect to a remote vault').getBoundingClientRect();
          log(`diag: short window ${short} px, menu ${Math.round(r.top)}..${Math.round(r.bottom)}, connect item bottom ${Math.round(connect.bottom)}`);
          await check(r.top >= 0 && r.bottom <= short && connect.bottom <= short, `in a short window the Switch vault menu stays inside it (${Math.round(r.top)}..${Math.round(r.bottom)} of ${short})`);
          setHeight(160);
          await waitFor(() => m.getBoundingClientRect().bottom <= 160, 'the menu inside a 160 px window', 5000);
          await check(m.getBoundingClientRect().top >= 0 && m.scrollHeight > m.clientHeight, 'a window shorter than the menu scrolls it, inside the window');
          m.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          await waitFor(() => !menu(), 'the menu to close on Esc', 5000);
        } finally {
          setHeight(null);
        }
      }
      await click('[data-unlock-connect]', 'Remote vault');
      await waitFor(() => q('form[aria-label="Connect to a remote vault"]'), 'the connect screen from the unlock screen', 10000);
      await check(true, 'the unlock screen opens Connect to a remote vault');
      await click('form[aria-label="Connect to a remote vault"] button', 'Back');
      await waitFor(() => q('form[aria-label="Unlock vault"]'), 'the unlock screen again', 10000);
      await fill('#pw', MASTER);
      await click('button[type="submit"]', 'Unlock');
      await waitFor(() => byText('.tree .ti', 'local') || grpRow(), 'the unlocked tree', 30000);
      await check(true, 'and the vault unlocks from it');
    }

    await log(`${passed} checks passed`);
    await window.backend.e2e_report({ ok: true, detail: '' });
  } catch (e) {
    await log('FAILED at ' + step + ': ' + e.message);
    await log('page text: ' + text().slice(0, 600).replace(/\n+/g, ' | '));
    await window.backend.e2e_report({ ok: false, detail: step + ': ' + e.message });
  }
  window.runtime.Quit();
})();
