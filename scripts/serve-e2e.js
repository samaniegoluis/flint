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
        if (argv.includes('deny-me')) { form.querySelector('[data-approval-deny]').click(); log('ok   denied the sudo command'); continue; }
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
  let step = 'unlock';
  try {
    await waitFor(() => q('#pw'), 'the unlock screen');
    const pw = q('#pw');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(pw, MASTER);
    pw.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(30);
    byText('button[type="submit"]', 'Unlock').click();
    await waitFor(() => byText('.tree .ti', 'local-web'), 'the unlocked tree', 30000);
    await check(true, 'the window unlocks the vault the CLI will use');
    await log('ready');

    step = 'served changes';
    await waitFor(() => byText('.tree .ti', 'served-web'), 'the host the CLI added', 90000);
    await check(true, 'a host added by the CLI shows in the tree without a reload');
    await waitFor(() => q('.vault-name')?.textContent === 'Served Renamed', 'the name the CLI gave the vault', 120000);
    await check(true, 'a rename by the CLI shows in the window');

    step = 'locked by the CLI';
    await waitFor(() => q('.lock-screen [data-lock-reason="cli"]'), 'the lock screen after `flint vault lock`', 90000);
    await check(true, '`flint vault lock` locks the window');
    const banner = await waitFor(() => q('[data-unlock-request]'), 'the unlock request of a command', 90000);
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
    {
      const pw = q('#pw');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(pw, MASTER);
      pw.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(30);
      byText('button[type="submit"]', 'Unlock').click();
    }
    await waitFor(() => !q('.lock-screen') && byText('.tree .ti', 'local-web'), 'the unlocked tree again', 30000);
    await check(!q('[data-unlock-request]'), 'unlocking answers the request');

    step = 'stop';
    // A screen lock sent on D-Bus (Linux check) locks the window here: unlock again.
    let relocks = 0;
    await waitFor(() => {
      const lock = q('.lock-screen [data-lock-reason]');
      if (lock && !q('#pw')?.disabled) {
        relocks++;
        log('ok   the window locked (' + lock.getAttribute('data-lock-reason') + '); unlocking again');
        const pw = q('#pw');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(pw, MASTER);
        pw.dispatchEvent(new Event('input', { bubbles: true }));
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
      await check(log2.some((e) => e.action === 'token' && e.outcome === 'allowed' && e.command.includes("'nightly'")), 'and the token created, by name');
      await check(!log2.some((e) => e.action === 'read' && e.outcome === 'allowed'), 'no allowed read is logged');
      await check(log2.some((e) => e.action === 'read' && e.outcome === 'denied' && e.via === 'token'), 'a read refused for a bad token is');
      await check(viaToken.some((e) => e.outcome === 'denied' && e.command.includes('after-revoke') && e.caller.includes('(token nightly)') && e.token.length > 0), 'a revoked token is still named when refused');
      await check(!log2.some((e) => e.command.includes('flint_')), 'no token text is logged');
      const long = log2.find((e) => e.command.includes('long-cmd-end'));
      await check(long && long.cut === 0 && long.command.length > 600, 'the log keeps a long command whole');
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
      }
      await check(!q('[data-token="nightly"]'), 'a revoked token is hidden until asked for');
      q('[data-tokens-ended]')?.click();
      await waitFor(() => q('[data-token="nightly"][data-token-status="revoked"]'), 'the revoked token row', 5000);
      await check(true, 'and listed as revoked when asked for');
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
