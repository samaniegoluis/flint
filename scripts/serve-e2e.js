// The app's half of scripts/serve-e2e.sh: unlock the vault through the real unlock
// screen, then wait while the `flint` CLI works on it over the socket, and check
// that the window shows what the CLI changed without being reloaded. The shell adds
// a host named `e2e-stop` last; the page then reports and quits.
(async () => {
  const MASTER = '@@MASTER@@';
  const log = (m) => window.backend.e2e_log({ name: String(m) });
  // Hidden pages have throttled timers (CF-050); MessageChannel posts are not.
  const sleep = (ms) => new Promise((resolve) => {
    const end = performance.now() + ms;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { if (performance.now() >= end) resolve(); else ch.port2.postMessage(0); };
    ch.port2.postMessage(0);
  });
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
  const text = () => document.body.innerText;
  const hasText = (t) => text().includes(t);
  const q = (sel) => document.querySelector(sel);

  // The owner, for this run (milestone 12): answers every approval the CLI raises.
  // Requests naming "deny-me" are denied, "timeout-me" left unanswered, "scope-me"
  // allowed as the window proposes (that host, read and run, 1 hour); the rest are
  // allowed for the whole vault and every action until the vault locks. Allow takes
  // the master password: the run sets FLINT_PRESENCE=password.
  const setValue = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  (async () => {
    for (;;) {
      await sleep(50);
      const form = document.querySelector('[data-approval]');
      if (!form || form.dataset.e2eSeen) continue;
      form.dataset.e2eSeen = '1';
      const req = form.querySelector('[data-approval-request]')?.textContent ?? '';
      if (form.dataset.kind === 'sudo') {
        // `exec --sudo` (milestone 13): the exact argv, no grant to choose.
        const argv = [...form.querySelectorAll('[data-arg]')].map((e) => e.textContent);
        log((form.querySelector('[data-scope-all]') ? 'FAIL ' : 'ok   ') + 'a sudo request offers no grant to choose: ' + argv.join(' '));
        // Milestone 57: "periods-on"/"periods-off" turn *Allow sudo for a while* on or off
        // through the core (as Settings → Access's switch does) and deny the command.
        if (argv.includes('periods-on') || argv.includes('periods-off')) {
          const on = argv.includes('periods-on');
          if (on) log((form.querySelector('[data-root-periods]') ? 'FAIL ' : 'ok   ') + 'with Allow sudo for a while off, the root window offers each command only');
          const s = await window.backend.settings_get();
          await window.backend.settings_set({ ...s, sudo_periods: on });
          form.querySelector('[data-approval-deny]').click();
          log('ok   Allow sudo for a while turned ' + (on ? 'on' : 'off'));
          continue;
        }
        if (argv.includes('deny-me')) { form.querySelector('[data-approval-deny]').click(); log('ok   denied the sudo command'); continue; }
        const seg = form.querySelector('[data-root-periods]');
        // With the switch off (25e3) there is nothing to pick: allowed for this command.
        if (argv.includes('period-2m') && !seg) log('ok   the root window offers no period while Allow sudo for a while is off');
        if (argv.includes('period-2m') && seg) {
          const ok = (cond, what) => log((cond ? 'ok   ' : 'FAIL ') + what);
          // 25e4/25e5/26c2: Allow for, the warning every time, notices always on for root.
          ok(seg.querySelector('[aria-checked="true"]')?.dataset.rootPeriod === 'each' && !!form.querySelector('[data-sudo-once]') && !form.querySelector('[data-root-warning]'), 'the root window starts on Each command, with no warning');
          form.querySelector('[data-root-period="2m"]').click();
          await sleep(50);
          ok(/ and everything it starts can run commands as root on local for 2 min without asking you\.$/.test(form.querySelector('[data-root-warning]')?.textContent ?? ''), 'picking 2 min shows the warning: ' + (form.querySelector('[data-root-warning]')?.textContent ?? ''));
          const bell = form.querySelector('[data-root-notify]');
          ok(!!bell && bell.checked && bell.disabled && !form.querySelector('[data-grant-notify]'), 'and Notify me of each command, checked and disabled: always on for root');
          ok(!form.querySelector('[data-sudo-once]') && /^Allow root for 2 min/.test(form.querySelector('[data-approval-allow]').textContent), 'the button says Allow root for 2 min');
          // The period's notice (26a4) and its row in the grants, once it has run.
          (async () => {
            const toast = await waitFor(() => [...document.querySelectorAll('[data-toast]')].find((t) => !t.classList.contains('leaving') && / ran 2 commands as root on local$/.test(t.querySelector('.t-text')?.textContent ?? '')), 'the root notice', 60000).catch(() => null);
            ok(!!toast && toast.dataset.kind === 'root' && /^\d:\d\d left$/.test(toast.querySelector('[data-toast-side]')?.textContent ?? ''), 'the root notice says as root, counted in place, with its time left: ' + (toast?.textContent ?? 'none'));
            const st = await window.backend.access_state();
            const p = st.grants.find((g) => g.root);
            ok(!!p && p.hosts.join() === 'local' && !p.read && !p.exec && !p.write && p.notify && p.expires_ms - st.now_ms <= 120000, 'the period is a grant of its own: root, one host, 2 min at most, notifying');
          })();
        }
        const field = form.querySelector('[data-sudo-password]');
        if (argv.includes('typed-pw') || argv.includes('save-pw') || argv.includes('wrong-pw')) {
          if (!field) { log('FAIL the window asks for a sudo password it does not hold'); continue; }
          setValue(field, argv.includes('wrong-pw') ? 'not-the-sudo-password' : 'flint-e2e-login-pw');
          if (argv.includes('save-pw')) form.querySelector('[data-sudo-save]').click();
        } else {
          log((field ? 'FAIL ' : 'ok   ') + 'with a saved sudo password the window asks for none');
        }
        setValue(form.querySelector('#approval-pw'), MASTER);
        await sleep(30);
        form.querySelector('[data-approval-allow]').click();
        log('ok   allowed the sudo command ' + argv.join(' '));
        continue;
      }
      if (form.dataset.kind === 'token') {
        // `token create` (milestone 12b): the token, no scope or duration to pick.
        const name = form.querySelector('[data-token-name]')?.textContent ?? '';
        if (name.includes('deny-me')) { form.querySelector('[data-approval-deny]').click(); log('ok   denied the token ' + name); continue; }
        log((form.querySelector('[data-scope-all]') ? 'FAIL ' : 'ok   ') + 'a token request offers no grant to choose: ' + name);
        setValue(form.querySelector('#approval-pw'), MASTER);
        await sleep(30);
        form.querySelector('[data-approval-allow]').click();
        log('ok   allowed the token ' + name);
        continue;
      }
      if (form.dataset.kind === 'copy' && form.querySelector('[data-copy-ask]')?.dataset.direction === 'relay') {
        // A copy between two hosts (milestone 18): both hosts named, a grant for both.
        const title = form.querySelector('h2')?.textContent ?? '';
        const ask = form.querySelector('[data-copy-ask]');
        const from = form.querySelector('[data-copy-from]')?.textContent ?? '';
        const badge = ask.querySelector('.badge')?.textContent ?? '';
        log((/wants to copy files between two servers/.test(title) && ask.dataset.copyHost === 'local' && ask.dataset.copyToHost === 'tty' && from.endsWith('blob.bin') && badge === 'Server to server' ? 'ok   ' : 'FAIL ') + 'the approval window names both hosts of a copy between two');
        log((form.querySelector('[data-scope-hosts]') && form.querySelector('[data-scope-host]')?.checked && form.querySelector('[data-action="exec"]')?.checked ? 'ok   ' : 'FAIL ') + 'a copy between two hosts proposes a grant for both');
        // Design 16g3: the caller's grant from `exec local` already reaches local; tty is new.
        const chip = (alias) => form.querySelector(`[data-scope-chip="${alias}"]`);
        const tagOf = (alias) => chip(alias)?.nextElementSibling?.textContent ?? '';
        log((chip('local')?.dataset.allowed === 'yes' && /^already allowed · \d+ (min|h)/.test(tagOf('local')) && chip('tty')?.dataset.allowed === 'no' && tagOf('tty') === 'new — this grant adds it' ? 'ok   ' : 'FAIL ') + 'the window says which of the two hosts the grant adds: ' + tagOf('local') + ' / ' + tagOf('tty'));
      } else if (form.dataset.kind === 'copy') {
        // `flint cp` (milestone 16): a grant request that says what it copies where.
        const title = form.querySelector('h2')?.textContent ?? '';
        const from = form.querySelector('[data-copy-from]')?.textContent ?? '';
        const to = form.querySelector('[data-copy-to]')?.textContent ?? '';
        const up = form.querySelector('[data-copy-ask]')?.dataset.direction === 'upload';
        const local = up ? from : to;
        const remote = up ? to : from;
        const host = form.querySelector('[data-copy-ask]')?.dataset.copyHost ?? '';
        const badge = form.querySelector('[data-copy-ask] .badge')?.textContent ?? '';
        log((/wants to copy files (to|from) local/.test(title) && host === 'local' && /^(\/|[A-Za-z]:\/)/.test(local) && remote.length > 0 && !remote.startsWith('local:') && badge === (up ? 'Upload' : 'Download') ? 'ok   ' : 'FAIL ') + 'the approval window says copy files with the direction, the host and both paths');
        if (req.includes('--force')) log((form.querySelector('[data-copy-force]') ? 'ok   ' : 'FAIL ') + 'a copy with --force warns that it replaces files');
        log((form.querySelector('[data-scope-host]') && form.querySelector('[data-action="exec"]')?.checked ? 'ok   ' : 'FAIL ') + 'a copy proposes running commands on that host');
      }
      if (form.dataset.kind === 'tunnel') {
        // `flint tunnel up` (milestone 22): the tunnel, where it listens, what it reaches.
        const title = form.querySelector('h2')?.textContent ?? '';
        const ask = form.querySelector('[data-tunnel-ask]');
        log((/wants to open a tunnel through local/.test(title) && ask?.dataset.tunnelHost === 'local' && /^127\.0\.0\.1:\d+$/.test(ask?.dataset.tunnelLocal ?? '') && /^127\.0\.0\.1:\d+$/.test(ask?.dataset.tunnelDest ?? '') && form.querySelector('[data-action="exec"]')?.checked ? 'ok   ' : 'FAIL ') + 'the approval window names the tunnel, where it listens and what it reaches');
        if (ask?.dataset.portInUse) {
          // Design 16h2 (milestone 23): a port already taken has nothing to allow.
          const allow = form.querySelector('[data-approval-allow]');
          log((allow?.disabled && form.querySelector('[data-tunnel-port-in-use]') ? 'ok   ' : 'FAIL ') + 'the approval window says the port is in use and offers no Allow');
          // The test sshd holds it and runs as this user, so the window names it.
          const owner = form.querySelector('[data-port-owner]')?.textContent ?? '';
          log((/sshd/.test(owner) && /\(pid \d+\)/.test(form.querySelector('[data-tunnel-port-in-use]')?.textContent ?? '') ? 'ok   ' : 'FAIL ') + 'and names the program that holds it: ' + owner);
          form.querySelector('[data-approval-deny]').click();
          log('ok   denied: ' + req);
          continue;
        }
      }
      // Milestone 63: "alerts-on" turns phone alerts on through the core (as Settings →
      // Notifications does), pointed at the run's ntfy stub, sends a test, and denies.
      if (req.includes('alerts-on')) {
        const s = await window.backend.settings_get();
        const on = await window.backend.settings_set({ ...s, ntfy_on: true, ntfy_server: '@@NTFY@@', ntfy_topic: 'flint-from-the-page' });
        log((on.ntfy_on && /^flint-[a-z2-7]{24}$/.test(on.ntfy_topic) ? 'ok   ' : 'FAIL ') + 'turning alerts on makes a random topic, never the page\'s: ' + on.ntfy_topic);
        await window.backend.alerts_test();
        form.querySelector('[data-approval-deny]').click();
        log('ok   phone alerts turned on');
        continue;
      }
      if (req.includes('timeout-me')) { log('ok   left unanswered: ' + req); continue; }
      if (req.includes('long-cmd')) {
        // Milestone 15 (D-049): a command past 160 characters shows its first line, how
        // much is left, and the whole of it in a modal that Esc closes without denying.
        const more = form.querySelector('[data-approval-more]')?.textContent ?? '';
        log((/^\+\d[\d,.]* more characters$/.test(more) && !req.includes('long-cmd-end') ? 'ok   ' : 'FAIL ') + 'the approval window says how much of a long command is left: ' + more);
        form.querySelector('[data-approval-show-command]')?.click();
        const full = await waitFor(() => document.querySelector('[data-command-full]'), 'the full command', 5000).catch(() => null);
        log((full && full.textContent.includes('long-cmd-end') ? 'ok   ' : 'FAIL ') + 'Show full command opens the whole command');
        document.querySelector('[data-command-modal]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(150);
        log((!document.querySelector('[data-command-full]') && document.querySelector('[data-approval]') === form ? 'ok   ' : 'FAIL ') + 'Esc closes the full command and leaves the request waiting');
      }
      if (req.includes('deny-me')) {
        // A click beside the window is not an answer, and the countdown runs on the
        // page's clock (both found in the M12 walkthrough).
        const left = form.querySelector('[data-approval-countdown]')?.textContent ?? '';
        document.querySelector('.scrim')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await sleep(150);
        const still = document.querySelector('[data-approval]') === form;
        log((still ? 'ok   ' : 'FAIL ') + 'a click beside the approval window does not deny it');
        log((/in 0:0[1-9]|in 0:[1-9]\d|in [1-9]:\d\d/.test(left) ? 'ok   ' : 'FAIL ') + 'the countdown shows the time left: ' + left);
        form.querySelector('[data-approval-deny]').click();
        log('ok   denied: ' + req);
        continue;
      }
      if (req.includes('notice-one')) {
        // Milestone 56 (26c1): the grant's notice, starting from Settings' default (on).
        const box = form.querySelector('[data-grant-notify]');
        log((box && box.checked ? 'ok   ' : 'FAIL ') + 'the approval window offers Notify me of each command, ticked by default');
      }
      if (!req.includes('scope-me')) {
        form.querySelector('[data-scope-all]').click();
        await sleep(30);
        for (const a of ['read', 'exec', 'write']) {
          const box = form.querySelector(`[data-action="${a}"]`);
          if (!box.checked) { box.click(); await sleep(10); }
        }
        form.querySelector('[data-duration="lock"]').click();
      }
      await sleep(30);
      setValue(form.querySelector('#approval-pw'), MASTER);
      await sleep(30);
      form.querySelector('[data-approval-allow]').click();
      log('ok   allowed: ' + req);
    }
  })();
  const qa = (sel) => [...document.querySelectorAll(sel)];
  const byText = (sel, t) => qa(sel).find((el) => el.textContent.includes(t));
  let passed = 0;
  function check(cond, what) {
    if (!cond) throw new Error('check failed: ' + what);
    passed++;
    return log('ok   ' + what);
  }
  // The unlock screen's mount effect empties #pw and then focuses it (Unlock.tsx), so a
  // value set before that focus is cleared (ROADMAP §5, "serve-e2e is flaky on Linux":
  // the field was empty within 21 ms of typing). Type only once the field has the focus.
  async function typeMaster(what) {
    const pw = await waitFor(() => { const f = q('#pw'); return f && document.activeElement === f ? f : null; }, 'the focused password field of ' + what, 10000);
    setValue(pw, MASTER);
    return pw;
  }
  // Milestone 56: every notice text the toast stack shows, as it shows it.
  // Kept per toast: a notice updated in place keeps its toast (and its id).
  const notices = [];
  const history = new Map();
  new MutationObserver(() => {
    for (const el of document.querySelectorAll('[data-toast]')) {
      const v = el.querySelector('.t-text')?.textContent ?? '';
      if (!/ ran (a command|\d+ commands)/.test(v)) continue;
      const h = history.get(el.dataset.toast) ?? [];
      if (h[h.length - 1] !== v) { h.push(v); notices.push(v); }
      history.set(el.dataset.toast, h);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
  let step = 'unlock';
  try {
    await waitFor(() => q('#pw'), 'the unlock screen');
    // A timeline of the first unlock (ROADMAP §5, "serve-e2e is flaky on Linux"): which
    // vault the screen shows, the field, the button, and every change of them.
    const t0 = performance.now();
    const screenState = () => {
      const f = q('#pw');
      const b = byText('button[type="submit"]', 'Unlock');
      return `vault=${q('.lock-screen h1, h1')?.textContent ?? '?'} field=${f ? f.value.length : 'none'} button=${b ? (b.disabled ? 'disabled' : 'enabled') : 'none'} request=${!!q('[data-unlock-request]')}`;
    };
    let lastState = '';
    const watch = setInterval(() => {
      const st = screenState();
      if (st !== lastState) { log(`diag: unlock at ${Math.round(performance.now() - t0)} ms: ${st}`); lastState = st; }
    }, 20);
    // The CLI's first command asks for this unlock; Allow covers it only when it has
    // arrived, so wait for it (on Windows the window was ready first).
    await waitFor(() => q('[data-unlock-request]'), 'the request on the unlock screen');
    await typeMaster('the first unlock');
    log(`diag: unlock typed at ${Math.round(performance.now() - t0)} ms: ${screenState()}`);
    await sleep(30);
    log(`diag: unlock clicked at ${Math.round(performance.now() - t0)} ms: ${screenState()}`);
    byText('button[type="submit"]', 'Unlock').click();
    try {
      await waitFor(() => byText('.tree .ti', 'local-web'), 'the unlocked tree', 30000);
    } finally {
      clearInterval(watch);
      log(`diag: unlock ended at ${Math.round(performance.now() - t0)} ms: ${q('#pw') ? screenState() : 'no unlock screen'}`);
    }
    await check(true, 'the window unlocks the vault the CLI will use');
    await log('ready');
    // A timeline of what the CLI's changes tell the window (on Windows the rename
    // sometimes never shows): each event and what the window showed when it came.
    window.runtime.EventsOn('vault:changed', (e) => {
      log(`diag: vault:changed path=${e.path} name=${e.name}; window shows ${q('.vault-name')?.textContent ?? '?'} at ${q('.vault-path')?.textContent ?? '?'}`);
    });

    step = 'served changes';
    await waitFor(() => byText('.tree .ti', 'served-web'), 'the host the CLI added', 90000);
    await check(true, 'a host added by the CLI shows in the tree without a reload');
    // The shell gets to `vault rename` after every section below the first unlock: about
    // two minutes on Windows, so this ceiling is generous.
    await waitFor(() => q('.vault-name')?.textContent === 'Served Renamed', 'the name the CLI gave the vault', 300000);
    await check(true, 'a rename by the CLI shows in the window');

    step = 'locked by the CLI';
    await waitFor(() => q('.lock-screen [data-lock-reason="cli"]'), 'the lock screen after `flint vault lock`', 90000);
    await check(true, '`flint vault lock` locks the window');
    // Milestone 61: the request naming timeout-me is left unanswered; the CLI gives up
    // after the approval wait and the long command asks next.
    const banner = await waitFor(() => {
      const b = q('[data-unlock-request]');
      return b && /locked-long/.test(b.textContent) ? b : null;
    }, 'the unlock request of the long command', 90000);
    // The shell runs `flint vault unlock` only once this block has logged its last check.
    await check(/flint exec local -- echo locked-long/.test(banner.textContent), 'a command on the locked vault makes the window ask, naming it');
    {
      // The full command opens over the lock screen, not behind it (found in the
      // design 16e walkthrough: the lock screen sits at z-index 1000).
      q('[data-unlock-show-command]')?.click();
      const full = await waitFor(() => q('[data-command-full]'), 'the full command on the lock screen', 5000);
      const r = full.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(20, r.height / 2));
      await check(!!top?.closest('[data-command-modal]') && full.textContent.includes('locked-long-end'), 'Show full command on the lock screen shows the whole command, on top');
      q('[data-command-modal]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(150);
      await check(!q('[data-command-full]') && !!q('.lock-screen [data-unlock-request]'), 'Esc closes it and leaves the lock screen asking');
    }
    await typeMaster('the unlock a command asked for');
    await sleep(30);
    byText('button[type="submit"]', 'Unlock').click();
    await waitFor(() => !q('.lock-screen') && byText('.tree .ti', 'local-web'), 'the unlocked tree again', 30000);
    await check(!q('[data-unlock-request]'), 'unlocking answers the request');

    step = 'stop';
    // A screen lock sent on D-Bus (Linux check) locks the window here: unlock again.
    let relocks = 0;
    await waitFor(() => {
      const lock = q('.lock-screen [data-lock-reason]');
      // Typed only once the field has the focus, as typeMaster does (the mount effect).
      const pw = q('#pw');
      if (lock && pw && !pw.disabled && document.activeElement === pw) {
        relocks++;
        log('ok   the window locked (' + lock.getAttribute('data-lock-reason') + '); unlocking again');
        setValue(pw, MASTER);
        setTimeout(() => byText('button[type="submit"]', 'Unlock')?.click(), 30);
        return null;
      }
      return byText('.tree .ti', 'e2e-stop');
    }, 'the stop host', 90000);
    await check(!hasText('served-host-pw-marker'), 'no password the CLI sent reaches the page');

    step = 'tokens and activity';
    {
      const toks = (await window.backend.tokens_list()).tokens;
      const nightly = toks.find((t) => t.name === 'nightly');
      await check(nightly && nightly.status === 'revoked', 'the window lists the revoked token');
      await check(toks.every((t) => !('hash' in t) && !('secret' in t)), 'the token list carries no hash and no secret');
      await check(!toks.some((t) => t.name.includes('deny-me')), 'a denied token was never created');
      const log2 = (await window.backend.activity_log({ before: 0, limit: 500 })).entries;
      const viaToken = log2.filter((e) => e.via === 'token');
      await check(viaToken.some((e) => e.outcome === 'allowed' && e.command.includes('echo via-token')), 'the log has the exec a token ran');
      await check(viaToken.some((e) => e.outcome === 'denied' && e.host === 'tty'), 'and the one outside its scope, refused');
      await check(log2.some((e) => e.outcome === 'denied' && e.command.includes('deny-me')), 'the log has what the owner denied');
      await check(log2.some((e) => e.outcome === 'timeout'), 'and what nobody answered');
      // Milestone 63: the approval that timed out after a phone alert is marked; one denied
      // before alerts were on is not.
      await check(log2.some((e) => e.outcome === 'timeout' && e.alerted && e.command.includes('timeout-me')), 'the approval missed after an alert is marked alerted');
      {
        // The log is newest first: the oldest deny-me came before "alerts-on".
        const denied = log2.filter((e) => e.command.includes('deny-me'));
        await check(denied.length > 0 && denied[denied.length - 1].alerted === false, 'a request from before alerts were on is not');
      }
      {
        const st = await window.backend.alerts_status();
        await check(st.ok && st.at_ms > 0 && st.error === '', 'the last publish is reported ok: ' + JSON.stringify(st));
      }
      await check(log2.some((e) => e.action === 'token' && e.outcome === 'allowed' && e.command.includes("'nightly'")), 'and the token created, by name');
      await check(!log2.some((e) => e.action === 'read' && e.outcome === 'allowed'), 'no allowed read is logged');
      await check(log2.some((e) => e.action === 'read' && e.outcome === 'denied' && e.via === 'token'), 'a read refused for a bad token is');
      await check(viaToken.some((e) => e.outcome === 'denied' && e.command.includes('after-revoke') && e.caller.includes('(token nightly)') && e.token.length > 0), 'a revoked token is still named when refused');
      await check(!log2.some((e) => e.command.includes('flint_')), 'no token text is logged');
      // Milestone 56 (D-127 (3)): an allowed command's entry is completed when it ends.
      const ex3 = log2.find((e) => e.outcome === 'allowed' && e.command.includes('exit 3'));
      await check(ex3 && ex3.state === 'ended' && ex3.exit === 3 && ex3.result === '' && ex3.duration_ms >= 0, 'the log records an exec\'s exit status and duration when it ends');
      const late = log2.find((e) => e.outcome === 'allowed' && e.command.includes('sleep 5'));
      await check(late && late.state === 'ended' && late.result === 'timeout', 'and an exec Flint stopped, by its error code: ' + (late && late.result));
      await check(log2.some((e) => e.via === 'grant' && e.outcome === 'allowed' && e.grant.length > 0), 'an entry a grant allowed names the grant');
      await check(log2.filter((e) => e.outcome !== 'allowed').every((e) => e.state === ''), 'a refusal has no result: it never ran');
      if (log2.some((e) => e.action === 'sudo')) {
        const wrong = log2.find((e) => e.action === 'sudo' && e.command.includes('wrong-pw'));
        await check(wrong && wrong.state === 'ended' && wrong.result === 'sudo_password', 'a sudo password sudo refused is written back as such');
      }
      const long = log2.find((e) => e.command.includes('long-cmd-end'));
      await check(long && long.cut === 0 && long.command.length > 600, 'the log keeps a long command whole');
      const copies = log2.filter((e) => e.command.startsWith('flint cp'));
      await check(copies.some((e) => e.outcome === 'allowed' && e.action === 'exec' && e.host === 'local' && e.command.includes('blob.bin')), 'the log has every copy, under exec on its host');
      await check(copies.some((e) => e.outcome === 'allowed' && e.command.startsWith('flint cp -r ')), 'with -r when it copied a folder');
      await check(copies.some((e) => e.outcome === 'denied' && e.command.includes('deny-me.bin')), 'and the copy the owner denied');
      await check(copies.some((e) => e.outcome === 'allowed' && e.host === 'local → tty' && e.command.includes('again-relay.bin')), 'a copy between two hosts is logged under both: local → tty');
      const tunnels = log2.filter((e) => e.command.startsWith('flint tunnel'));
      await check(tunnels.some((e) => e.outcome === 'allowed' && e.action === 'exec' && e.host === 'local' && e.command === 'flint tunnel up local:fwd'), 'the log has every tunnel up, under exec on its host');
      await check(tunnels.some((e) => e.outcome === 'allowed' && e.command === 'flint tunnel down local:fwd'), 'and every tunnel down');
      await check(tunnels.some((e) => e.outcome === 'denied' && e.command === 'flint tunnel up local:deny-me'), 'and the tunnel the owner denied');
      await check(!tunnels.some((e) => e.command.startsWith('flint tunnel status') || e.command.startsWith('flint tunnel ls')), 'a tunnel status or list is a read: not logged');
      const sudoRows = log2.filter((e) => e.action === 'sudo');
      if (sudoRows.length > 0) {
        await check(sudoRows.some((e) => e.outcome === 'allowed' && e.via === 'window' && e.command.includes("--sudo -- 'sh' '-c'")), 'the log keeps a sudo command whole, each argument quoted');
        await check(sudoRows.some((e) => e.outcome === 'denied' && e.via === 'token'), 'and the token refused for sudo');
        await check(!log2.some((e) => e.command.includes('flint-e2e-login-pw') || e.command.includes('flint-sudo')), 'no sudo password or prompt in the log');
      }
      // The view: Settings → Access.
      byText('.rail-btn', 'Settings')?.click();
      await sleep(200);
      byText('.nav-i', 'Access')?.click();
      await waitFor(() => q('[data-activity] [data-activity-entry]'), 'the activity table', 10000);
      await check(qa('[data-activity] [data-activity-entry="denied"]').length > 0, 'Settings → Access shows the activity, refusals included');
      if (sudoRows.length > 0) await check(!!q('[data-activity] [data-activity-sudo]'), 'a sudo command is marked root in the activity');
      // Milestone 57 (25e1): Allow sudo for a while, off by default, says what off means.
      await check(q('[data-setting="sudo_periods"]')?.getAttribute('aria-checked') === 'false' && hasText('Off: every root command is approved on its own.'), 'Settings → Access has Allow sudo for a while, off, with its help line');
      {
        // Milestone 61 (D-134 (2)): the approval wait, 2 minutes by default; 30 adds a note.
        const picked = () => q('[data-approval-wait] [aria-checked="true"]')?.getAttribute('data-approval-wait-min');
        await check(qa('[data-approval-wait] [data-approval-wait-min]').map((b) => b.textContent).join(',') === '2 min,5 min,10 min,30 min' && picked() === '2' && !q('[data-approval-wait-note]'), 'Settings → Access has the approval wait, 2 minutes, no note');
        q('[data-approval-wait-min="30"]')?.click();
        await waitFor(() => picked() === '30', 'the approval wait at 30 minutes', 5000);
        const saved = await window.backend.settings_get();
        await check(saved.approval_wait === 30 && !!q('[data-approval-wait-note]')?.textContent.includes('in the background'), 'choosing 30 minutes is saved and notes that the program must wait that long');
        q('[data-approval-wait-min="2"]')?.click();
        await waitFor(() => picked() === '2', 'the approval wait back at 2 minutes', 5000);
        await check(!q('[data-approval-wait-note]') && (await window.backend.settings_get()).approval_wait === 2, 'back to 2 minutes, the note goes');
      }
      {
        // Milestone 15: an entry opens its detail with the whole command and the exact time.
        const row = qa('[data-activity] [data-activity-entry]').find((r) => r.textContent.includes('long-cmd'));
        await check(!!row, 'the long command is in the activity table');
        row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        const full = await waitFor(() => q('[data-command-full]'), 'the activity entry detail', 5000);
        await check(full.textContent.includes('long-cmd-end'), 'Enter on an entry opens the whole command');
        await check(/\d{1,2}:\d{2}:\d{2}/.test(q('[data-activity-when]')?.textContent ?? ''), 'with the exact time, seconds included');
        q('[data-command-modal] [data-autofocus]')?.click();
        await sleep(100);
        await check(!q('[data-command-full]'), 'Close closes it');
        // Retention: the vault keeps 90 days unless chosen; nothing here is older than 30.
        await check(q('[data-retention-days="90"]')?.getAttribute('aria-checked') === 'true', 'the activity log keeps 90 days by default');
        q('[data-retention-days="30"]')?.click();
        await waitFor(() => q('[data-retention-days="30"]')?.getAttribute('aria-checked') === 'true', 'the 30-day retention', 5000);
        await check((await window.backend.activity_retention()).days === 30, 'choosing 30 days keeps it in the vault');
        const after = (await window.backend.activity_log({ before: 0, limit: 500 })).entries;
        await check(after.length === log2.length, 'shortening it with nothing that old removes nothing');
        q('[data-retention-days="90"]')?.click();
        await waitFor(() => q('[data-retention-days="90"]')?.getAttribute('aria-checked') === 'true', 'the 90-day retention again', 5000);
        // Milestone 39: the log is this computer's, and it backs up as it is (the save
        // dialog is the OS's: its path goes straight to the RPC it leads to).
        await check(/never syncs/.test(q('[data-activity-where]')?.textContent ?? ''), 'Settings says the activity is kept on this computer and never syncs');
        await check(!!q('[data-activity-backup]'), 'Settings offers Back up activity');
        await window.backend.activity_backup({ path: '@@TMP@@/activity-backup.db' });
        await check(true, 'Back up activity writes the file');
        let refused = '';
        await window.backend.activity_backup({ path: 'relative.db' }).catch((err) => { refused = String(err); });
        await check(/absolute/.test(refused), 'a backup to a relative path is refused');
      }
      await check(!q('[data-token="nightly"]'), 'a revoked token is hidden until asked for');
      q('[data-tokens-ended]')?.click();
      await waitFor(() => q('[data-token="nightly"][data-token-status="revoked"]'), 'the revoked token row', 5000);
      await check(true, 'and listed as revoked when asked for');
    }

    // Milestone 56 (designs 26a1-26a3, 26b1, 26d1): the live notice of what a grant runs.
    // The shell starts one caller running three commands under one grant: echo, a
    // failing one (exit 5) and a sleep. Settings → Access is still open from above.
    step = 'grant notices';
    await check(q('[data-setting="notify_grants"]')?.getAttribute('aria-checked') === 'true', 'Settings → Access has Notify me of commands run under a grant, on');
    await log('waiting for grant notices');
    {
      const toastOf = (re) => qa('[data-toast]').find((t) => !t.classList.contains('leaving') && re.test(t.querySelector('.t-text')?.textContent ?? ''));
      const notice = await waitFor(() => toastOf(/ ran 3 commands on local$/), 'the notice of three commands', 120000);
      const said = notice.querySelector('.t-text').textContent;
      await check(!/notice-one|exit 5|sleep/.test(notices.join(' | ')), 'a notice names the program and the host, never the command: ' + said);
      // This notice's own texts, in the order its one toast showed them.
      const program = said.split(' ran ')[0];
      const mine = history.get(notice.dataset.toast) ?? [];
      await check(mine.join(' → ') === `${program} ran a command on local → ${program} ran 2 commands on local → ${program} ran 3 commands on local`, 'one notice for the grant, updated in place: ' + mine.join(' → '));
      await check(qa('[data-toast]:not(.leaving) .t-text').filter((t) => t.textContent.startsWith(program + ' ran ')).length === 1, 'one toast, not one per command');
      await check([...notice.querySelectorAll('[data-toast-action]')].map((b) => b.textContent).join(',') === 'View,Stop', 'the notice offers View and Stop');
      // View while the last command runs (26b1), then the run fills in live.
      notice.querySelector('[data-toast-action="0"]').click();
      const modal = await waitFor(() => q('[data-grant-activity]'), 'View', 5000);
      const grant = modal.dataset.grantActivity;
      const rows = () => qa('[data-grant-activity] [data-grant-row]');
      await waitFor(() => rows().length === 3, 'three rows in View', 10000);
      const resultOf = (r) => r.querySelector('[data-grant-row-result]')?.textContent ?? '';
      await check(rows()[0].dataset.grantRowState === 'running' && resultOf(rows()[0]) === 'running…' && /sleep 6/.test(rows()[0].textContent), 'View lists the newest first, running…');
      await check(rows().some((r) => resultOf(r) === 'exit 5') && rows().some((r) => resultOf(r) === 'exit 0'), 'and each ended command with its exit status');
      await waitFor(() => rows()[0]?.dataset.grantRowState === 'ended', 'the sleep to end in View', 20000);
      await check(resultOf(rows()[0]) === 'exit 0' && /\d\.\d s/.test(rows()[0].textContent), 'View fills in live: the running command ends with exit 0 and its duration');
      const failed = rows().find((r) => resultOf(r) === 'exit 5');
      failed.querySelector('.acc-h').click();
      const full = await waitFor(() => failed.querySelector('[data-grant-row-command]'), 'the exact command', 3000);
      await check(full.textContent === 'flint exec local -- exit 5', 'a row opens to the exact command');
      q('[data-grant-activity] [data-autofocus]').click();
      await sleep(150);
      await check(!q('[data-grant-activity]'), 'Close closes View');
      // The bell (26d1): this grant's notice off and on again, in the grants table.
      const bell = await waitFor(() => q(`[data-grant="${grant}"] [data-grant-bell="on"]`), "the grant's bell, on", 10000);
      bell.click();
      await waitFor(() => q(`[data-grant="${grant}"] [data-grant-bell="off"]`), 'the bell turned off', 5000);
      await check(!(await window.backend.access_state({})).grants.find((g) => g.id === grant).notify, 'the bell turns the grant\'s notice off');
      q(`[data-grant="${grant}"] [data-grant-bell="off"]`).click();
      await waitFor(() => q(`[data-grant="${grant}"] [data-grant-bell="on"]`), 'the bell turned on', 5000);
      await check(true, 'and on again');
      // Stop asks once inside the toast (26a3); Cancel puts it back; Stop grant revokes.
      const n2 = await waitFor(() => toastOf(/ ran 3 commands on local$/), 'the notice, still up', 5000);
      n2.querySelector('[data-toast-action="1"]').click();
      const ask = await waitFor(() => toastOf(/^Stop this grant\?/), 'the question', 3000);
      await check(/can't run more on local\.$/.test(ask.querySelector('.t-text')?.textContent ?? '') && [...ask.querySelectorAll('[data-toast-action]')].map((b) => b.textContent).join(',') === 'Cancel,Stop grant', 'Stop asks once, in the toast');
      ask.querySelector('[data-toast-action="0"]').click();
      await waitFor(() => toastOf(/ ran 3 commands on local$/), 'the notice back', 3000);
      await check(true, 'Cancel puts the notice back');
      toastOf(/ ran 3 commands on local$/).querySelector('[data-toast-action="1"]').click();
      (await waitFor(() => toastOf(/^Stop this grant\?/), 'the question again', 3000)).querySelector('[data-toast-action="1"]').click();
      let gone = false;
      for (let i = 0; i < 50 && !gone; i++) { gone = !(await window.backend.access_state({})).grants.some((g) => g.id === grant); if (!gone) await sleep(100); }
      await check(gone, 'Stop grant revokes the grant');
      await sleep(300);
      await check(!toastOf(/ ran 3 commands on local$|^Stop this grant/), 'and its notice goes');
    }
    await log('grant notices checked');

    // Milestone 50: quitting with a command of the CLI's still running. The shell
    // starts a long, silent `flint exec` once it is done; the app quits with it running
    // and must cut it after its grace, not wait for it (the Relaunch that hung).
    step = 'quitting with a running flint exec';
    await log('waiting for a long flint exec');
    const longFrom = Date.now();
    while ((await window.backend.cli_running()).count < 1) {
      if (Date.now() - longFrom > 300000) throw new Error("timed out waiting for the shell's long flint exec");
      await sleep(200);
    }
    await check(true, 'a running flint exec is counted for Relaunch\'s warning');

    await log(`${passed} checks passed`);
    await window.backend.e2e_report({ ok: true, detail: '' });
  } catch (e) {
    await log('FAILED at ' + step + ': ' + e.message);
    await log('page text: ' + text().slice(0, 600).replace(/\n+/g, ' | '));
    await window.backend.e2e_report({ ok: false, detail: step + ': ' + e.message });
  }
  window.runtime.Quit();
})();
