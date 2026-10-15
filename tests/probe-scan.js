// Page-side cost on a big VALORANT directory: the captured directory multiplied to 150 cards, previews served
// locally. Measures main-thread long tasks while the cards are read, and when Twitch replaces all cards (as on
// Back), plus how many previews are fetched again.
// Usage: node tests/probe-scan.js [--no-extension] [--profile] [--copies=5] [--filter=clove] [--away=300]
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const os = require('os'); const http = require('http');
const SOURCE = path.resolve(__dirname, '../extension'), FIX = path.join(__dirname, 'fixtures');
const withExt = !process.argv.includes('--no-extension');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const COPIES = Number(arg('copies', '5')), FILTER = arg('filter', ''), AWAY = Number(arg('away', '300'));
const MAIN = fs.readFileSync(path.join(FIX, 'valorant-directory.html'), 'utf8'), NAV = fs.readFileSync(path.join(FIX, 'nav.html'), 'utf8');
const previews = fs.readdirSync(path.join(FIX, 'previews')).filter(f => f.endsWith('.jpg'));
const logins = [...new Set([...MAIN.matchAll(/previews-ttv\/live_user_([a-z0-9_]+)/g)].map(m => m[1]))];
// Copies of the directory, each with its own logins.
const big = Array.from({ length: COPIES }, (_, k) => k).map(k => logins.reduce((html, l) => html.split(l).join(k ? `${l}x${k}` : l), MAIN)).join('\n');
let fetched = 0;
const server = http.createServer((req, res) => {
  const m = /live_user_([a-z0-9_]+)-/.exec(req.url);
  if (m) { fetched++; const f = previews[[...m[1]].reduce((a, c) => a + c.charCodeAt(0), 0) % previews.length]; res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=300', age: '0' }); return res.end(fs.readFileSync(path.join(FIX, 'previews', f))); }
  res.writeHead(404); res.end();
});
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'al-probe-')); fs.cpSync(SOURCE, EXT, { recursive: true });
  const bg = path.join(EXT, 'background.js'); fs.writeFileSync(bg, fs.readFileSync(bg, 'utf8').replace('https://static-cdn.jtvnw.net/previews-ttv/live_user_', `http://127.0.0.1:${port}/previews-ttv/live_user_`));
  const man = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'))); man.host_permissions.push('http://127.0.0.1/*'); fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(man));
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'al-probe-p-' + Date.now()), { headless: false, executablePath: process.env.CHROMIUM_PATH, viewport: { width: 1500, height: 1000 },
    args: withExt ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [] });
  const html = `<!doctype html><html class="tw-root--theme-dark"><head><title>Twitch</title></head><body><div id="root" style="display:flex">${NAV}<main id="m" style="flex:1">${big}</main></div></body></html>`;
  await ctx.route('https://www.twitch.tv/**', r => r.request().resourceType() === 'document' ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.abort());
  await ctx.route('https://static-cdn.jtvnw.net/**', r => r.abort());
  if (withExt) { const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); await sw.evaluate(f => chrome.storage.local.set({ agentLensDebug: true, ...(f ? { agentLensFilter: { roles: [], agents: f.split(','), mine: false } } : {}) }), FILTER); }
  const page = ctx.pages()[0] || await ctx.newPage();
  const scans = []; page.on('console', m => { const x = /\[AL\] scan ([\d.]+) ms/.exec(m.text()); if (x) scans.push(+x[1]); });
  await page.addInitScript(() => { window.__long = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true }); });
  const take = () => page.evaluate(() => { const a = window.__long; window.__long = []; return { longTasks: a.length, totalMs: Math.round(a.reduce((x, y) => x + y, 0)), maxMs: Math.round(Math.max(0, ...a)) }; });
  const scanStats = () => { const a = scans.splice(0); return { scans: a.length, scanMs: Math.round(a.reduce((x, y) => x + y, 0)), slowest: Math.round(Math.max(0, ...a)) }; };
  await page.goto('https://www.twitch.tv/directory/category/valorant');
  await page.waitForTimeout(20000);
  console.log(withExt ? 'WITH extension' : 'WITHOUT extension', 'cards', await page.locator('article').count(), 'previews fetched', fetched);
  console.log('first read', JSON.stringify({ ...(await take()), ...scanStats() }));
  const cdp = process.argv.includes('--profile') ? await ctx.newCDPSession(page) : null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  for (let i = 0; i < 2; i++) {
    const before = fetched;
    // Twitch on Back: the page's cards are thrown away and built again.
    await page.evaluate(away => { const m = document.getElementById('m'); const html = m.innerHTML; m.innerHTML = ''; setTimeout(() => { m.innerHTML = html; }, away); }, AWAY);
    await page.waitForTimeout(AWAY + 6000);
    console.log('cards rebuilt', JSON.stringify({ ...(await take()), ...scanStats(), refetched: fetched - before }));
  }
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = {}, byId = new Map(profile.nodes.map(n => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id), f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self[k] = (self[k] || 0) + (profile.timeDeltas[i] || 0); });
    console.log(Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`).join('\n'));
  }
  await ctx.close(); server.close();
});
