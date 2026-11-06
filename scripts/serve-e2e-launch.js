// The page of the Flint that `flint` starts when it finds the app closed
// (scripts/serve-e2e.sh, D-042): it must open on the unlock screen of the vault the
// command asked for, naming the command. It unlocks, then waits for the CLI to add
// `e2e-stop-2` and quits.
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
  async function waitFor(fn, what, ms = 30000) {
    const start = Date.now();
    for (;;) {
      let v;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - start > ms) throw new Error('timed out waiting for ' + what);
      await sleep(50);
    }
  }
  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => [...document.querySelectorAll(sel)];
  const byText = (sel, t) => qa(sel).find((el) => el.textContent.includes(t));
  let step = 'unlock request';
  try {
    const banner = await waitFor(() => q('[data-unlock-request]'), 'the unlock request on the unlock screen');
    // `flint vault unlock` may ask again before this page looks, naming itself.
    if (!/flint (host list|vault unlock)/.test(banner.textContent)) throw new Error('the request does not name the command: ' + banner.textContent);
    if (!q('h1')?.textContent.includes('Served Renamed')) throw new Error('the unlock screen is not for the vault the command asked for');
    await log('ok   the started app asks for the vault, naming the command');
    const pw = q('#pw');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(pw, MASTER);
    pw.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(30);
    byText('button[type="submit"]', 'Unlock').click();
    step = 'unlocked';
    await waitFor(() => byText('.tree .ti', 'e2e-stop'), 'the unlocked tree');
    await waitFor(() => byText('.tree .ti', 'e2e-stop-2'), 'the host the CLI adds last', 90000);
    await log('ok   the CLI worked through the app it started');
    await window.backend.e2e_report({ ok: true, detail: '' });
  } catch (e) {
    await log('FAILED at ' + step + ': ' + e.message);
    await window.backend.e2e_report({ ok: false, detail: step + ': ' + e.message });
  }
  window.runtime.Quit();
})();
