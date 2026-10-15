// Back from a stream to the VALORANT directory on live twitch.tv, as a viewer does it: directory (scrolled, with
// a filter and a minimum viewer count), open a stream from it, watch for a while, then Back.
// Measures how long the page is frozen (longest gap between painted frames), main-thread long tasks, and when
// the directory's first card is on screen; --profile prints where the time went.
// Usage: node tests/probe-back.js [--no-extension] [--profile] [--agents=clove] [--min=20] [--watch=15]
const { chromium } = require('playwright'); const path = require('path'); const os = require('os');
const EXT = path.resolve(process.env.AL_EXT || path.join(__dirname, '../extension'));
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const withExt = !process.argv.includes('--no-extension');
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'al-back-' + Date.now()), {
    headless: false, executablePath: process.env.CHROMIUM_PATH, viewport: { width: 1500, height: 1000 },
    args: withExt ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'] : ['--autoplay-policy=no-user-gesture-required']
  });
  if (withExt) {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const agents = arg('agents', 'clove').split(',').filter(Boolean);
    await sw.evaluate(([agents, min]) => chrome.storage.local.set({ agentLensFilter: { roles: [], agents, mine: false }, agentLensSettings: { minViewers: min } }), [agents, Number(arg('min', '20'))]);
  }
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.addInitScript(() => {
    window.__long = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto('https://www.twitch.tv/directory/category/valorant?sort=VIEWER_COUNT', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('article', { timeout: 30000, state: 'attached' });
  // Load cards until there are --cards of them (a long session on the directory loads hundreds).
  const want = Number(arg('cards', '100'));
  for (let i = 0; i < 80; i++) {
    const n = await page.evaluate(() => { const s = document.querySelector('main .simplebar-scroll-content, main [data-simplebar] .simplebar-content-wrapper, .root-scrollable__wrapper .simplebar-scroll-content'); if (s) s.scrollTop = s.scrollHeight; return document.querySelectorAll('article').length; });
    if (n >= want) break;
    await page.mouse.move(700, 600); await page.mouse.wheel(0, 3000); await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(10000);
  const before = await page.evaluate(() => ({ cards: document.querySelectorAll('article').length, badges: document.querySelectorAll('agent-lens').length, hidden: document.querySelectorAll('[data-al-hidden]').length }));
  console.log(withExt ? 'WITH extension' : 'WITHOUT extension', JSON.stringify(before));
  // Open a stream the way a click does (through Twitch's router).
  const href = await page.evaluate(() => { const a = document.querySelector('article a[data-a-target="preview-card-image-link"], article a[href^="/"]'); a.click(); return a.getAttribute('href'); });
  await page.waitForTimeout(Number(arg('watch', '15')) * 1000);
  console.log('watching', href, page.url().replace('https://www.twitch.tv', ''));
  const cdp = process.argv.includes('--profile') ? await ctx.newCDPSession(page) : null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  // Frame gaps and first card on screen, measured in the page.
  await page.evaluate(() => {
    window.__long = []; const t0 = performance.now(); let last = t0; window.__gaps = []; window.__firstCard = null;
    const tick = now => {
      if (now - last > 100) window.__gaps.push([Math.round(last - t0), Math.round(now - last)]);
      last = now;
      if (window.__firstCard === null && location.pathname.startsWith('/directory')) {
        const a = [...document.querySelectorAll('article')].find(x => { const r = x.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < innerHeight; });
        if (a) window.__firstCard = Math.round(now - t0);
      }
      if (now - t0 < 15000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick); window.__t0 = t0;
    history.back();
  });
  await page.waitForTimeout(16000);
  const r = await page.evaluate(() => ({ firstCard: window.__firstCard, gaps: window.__gaps.filter(g => g[1] > 200), long: window.__long.map(([s, d]) => [Math.round(s - window.__t0), Math.round(d)]).filter(x => x[0] > -50),
    cards: document.querySelectorAll('article').length, visibleCards: [...document.querySelectorAll('article')].filter(a => a.getBoundingClientRect().height > 0).length }));
  const total = r.long.reduce((a, x) => a + x[1], 0), worst = Math.max(0, ...r.gaps.map(g => g[1]));
  console.log('back:', JSON.stringify({ firstCardMs: r.firstCard, longestFreezeMs: worst, longTaskMs: total, longTasks: r.long.length, cards: r.cards, visibleCards: r.visibleCards }));
  console.log('  freezes (at ms, for ms):', JSON.stringify(r.gaps.slice(0, 12)));
  console.log('  long tasks:', JSON.stringify(r.long.slice(0, 15)));
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = {}, byId = new Map(profile.nodes.map(n => [n.id, n])), byUrl = {};
    profile.samples.forEach((id, i) => {
      const n = byId.get(id), f = n.callFrame, d = profile.timeDeltas[i] || 0;
      const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop().slice(0, 40)}:${f.lineNumber}`; self[k] = (self[k] || 0) + d;
      const u = f.url.startsWith('chrome-extension') ? 'EXTENSION' : f.url ? 'twitch' : f.functionName || '(native)'; byUrl[u] = (byUrl[u] || 0) + d;
    });
    console.log('by source:', Object.entries(byUrl).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / 1000).toFixed(0)}ms`).join(', '));
    console.log(Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`).join('\n'));
  }
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
