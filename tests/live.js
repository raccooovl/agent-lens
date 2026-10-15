// Live checks on public twitch.tv (signed out): reads real VALORANT streams and saves what it decided,
// with crops of each preview, for a person to check.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const os = require('os');
const EXT = path.resolve(process.argv[2] || path.join(__dirname, '../extension'));
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; let current = '';
function check(name, ok, detail = '') { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + ' [' + current + '] ' + name + (detail ? ' :: ' + String(detail).slice(0, 400) : '')); }
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'al-live-' + Date.now()), {
    headless: false, executablePath: process.env.CHROMIUM_PATH, viewport: { width: 1500, height: 1000 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const errors = [];
  const tab = ctx.pages()[0] || await ctx.newPage();
  tab.on('pageerror', e => errors.push(e.message));
  sw.on('console', m => { if (m.type() === 'error') errors.push('worker: ' + m.text()); });
  const badges = () => tab.evaluate(() => [...document.querySelectorAll('agent-lens[data-al-kind="card"]')].map(h => {
    const card = h.closest('article'); const login = card.querySelector('a[data-a-target="preview-card-channel-link"]').getAttribute('href').slice(1);
    const b = h.shadowRoot.querySelector('.badge');
    return { login, text: b ? b.textContent : h.shadowRoot.querySelector('.reading') ? 'reading' : null };
  }));

  current = 'directory';
  const t0 = Date.now();
  await tab.goto('https://www.twitch.tv/directory/category/valorant', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await tab.waitForSelector('agent-lens[data-al-kind="card"]', { timeout: 30000 });
  let list = [];
  for (let i = 0; i < 120; i++) { list = await badges(); if (list.length && !list.some(b => b.text === 'reading')) break; await tab.waitForTimeout(500); }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  // Pills that name a screen (no agent) and "Agent?" maybes don't count as found agents.
  const PILL = /^(Spectating|In menus|Agent select|Dead|Round over|Buy phase|Pro match|Deathmatch)/;
  const found = list.filter(b => b.text && !PILL.test(b.text) && !/\?/.test(b.text));
  console.log('spectating (dead, watching a teammate):', list.filter(b => b.text && /^Spectating/.test(b.text)).map(b => b.login).join(', '));
  console.log('screens:', list.filter(b => b.text && PILL.test(b.text) && !/^Spectating/.test(b.text)).map(b => b.login + ' ' + b.text).join(', '));
  console.log('maybe:', list.filter(b => b.text && /\?/.test(b.text)).map(b => b.login + ' ' + b.text).join(', '));
  check(`read all ${list.length} live cards in ${secs}s`, list.length >= 20 && !list.some(b => b.text === 'reading'), secs);
  check('agents found on a good share of streams', found.length >= list.length * 0.4, `${found.length}/${list.length}`);
  fs.writeFileSync(path.join(OUT, 'live-decisions.json'), JSON.stringify({ at: new Date().toISOString(), list }, null, 1));
  // Save the same previews right away so a person can check each decision (see tests/review-sheet.py).
  const dir = path.join(OUT, 'live-previews'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  require('child_process').execSync(list.map(b => `curl -sS -m 20 -o ${dir}/${b.login}.jpg https://static-cdn.jtvnw.net/previews-ttv/live_user_${b.login}-1920x1080.jpg &`).join(' ') + ' wait', { shell: '/bin/bash' });
  const extraArticles = await tab.evaluate(() => [...document.querySelectorAll('article')].filter(a => !a.querySelector('agent-lens')).map(a => a.textContent.slice(0, 80)));
  console.log('articles without a badge spot:', JSON.stringify(extraArticles));
  await tab.screenshot({ path: path.join(OUT, 'live-directory-light.png') });

  current = 'filter';
  const bar = tab.locator('agent-lens[data-al-kind="bar"]');
  const top = found.map(b => b.text.replace(/[★\d–]+/g, '').trim()).sort((a, b, all = found.map(x => x.text.replace(/[★\d–]+/g, '').trim())) => all.filter(x => x === b).length - all.filter(x => x === a).length)[0];
  if (top) {
    await bar.locator('.chip', { hasText: new RegExp('^' + top) }).first().click(); await tab.waitForTimeout(500);
    const shown = await tab.evaluate(() => [...document.querySelectorAll('article')].filter(a => a.querySelector('agent-lens') && a.getClientRects().length > 0).length);
    const want = found.filter(b => b.text.replace(/[★\d–]+/g, '').trim() === top).length;
    check(`filtering to ${top} shows just those ${want} streams`, shown === want, `${shown} shown`);
    await tab.screenshot({ path: path.join(OUT, 'live-filter.png') });
    await bar.locator('.clear').click(); await tab.waitForTimeout(300);
  }

  current = 'dark';
  await tab.evaluate(() => { localStorage.setItem('twilight.theme', '1'); });
  await tab.reload({ waitUntil: 'domcontentloaded' }); await tab.waitForSelector('agent-lens[data-al-kind="bar"]', { timeout: 30000 }); await tab.waitForTimeout(3000);
  const dark = await tab.evaluate(() => document.documentElement.className);
  check('Twitch dark theme followed', /theme-dark/.test(dark) ? (await bar.evaluate(h => h.dataset.theme)) === 'dark' : true, dark);
  await tab.screenshot({ path: path.join(OUT, 'live-directory-dark.png') });

  current = 'sidebar';
  // No signed-out sidebar row may be playing VALORANT right now: point one row at a stream from the directory for a visual check.
  const pick = found[0];
  if (pick) {
    await tab.evaluate(login => {
      const row = document.querySelector('.side-nav-card'); if (!row) return;
      row.querySelector('a[href]').setAttribute('href', '/' + login);
      const g = row.querySelector('[data-a-target="side-nav-game-title"], .side-nav-card__metadata p'); if (g) g.textContent = 'VALORANT';
    }, pick.login);
    await tab.waitForTimeout(4000);
    console.log('sidebar anchor', await tab.evaluate(() => { const h = document.querySelector('agent-lens[data-al-kind="row"]'); if (!h) return null; const a = h.parentElement, r = a.getBoundingClientRect(), i = h.shadowRoot.querySelector('.side')?.getBoundingClientRect(); return { anchor: a.className, tag: a.tagName, r: [r.x, r.y, r.width, r.height].map(Math.round), face: i && [i.x, i.y, i.width, i.height].map(Math.round), overflow: getComputedStyle(a).overflow }; }));
    const side = await tab.evaluate(() => [...document.querySelectorAll('agent-lens[data-al-kind="row"]')].map(h => h.shadowRoot.querySelector('.side')?.getAttribute('aria-label')));
    check('sidebar row shows the agent', side.some(Boolean), JSON.stringify(side));
    await tab.screenshot({ path: path.join(OUT, 'live-sidebar.png'), clip: { x: 0, y: 50, width: 260, height: 200 } });
  }

  current = 'channel';
  if (pick) {
    await tab.goto('https://www.twitch.tv/' + pick.login, { waitUntil: 'domcontentloaded' }); await tab.waitForTimeout(6000);
    const popup = await ctx.newPage(); await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`); await tab.bringToFront(); await popup.evaluate(() => location.reload()); await popup.waitForTimeout(3000);
    const text = await popup.evaluate(() => document.getElementById('tab').textContent);
    check('popup names the channel and its agent', /Playing/.test(text), text);
    await popup.screenshot({ path: path.join(OUT, 'live-popup.png') });
    await popup.close();
  }
  current = 'errors';
  check('no extension errors', errors.filter(e => !/getLayoutMap/.test(e)).length === 0, errors.join(' | '));
  await ctx.close();
  console.log(`\n${results.filter(r => r.ok).length}/${results.length} live checks passed`);
})().catch(e => { console.error('LIVE FAILED', e); process.exit(2); });
