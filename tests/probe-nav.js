// Navigation cost on live twitch.tv: VALORANT directory (scrolled to load ~100 cards) -> another category
// (Twitch's own link) -> Back. Main-thread long tasks are summed for each step, with and without the extension.
// Usage: node tests/probe-nav.js [--no-extension]
const { chromium } = require('playwright'); const path = require('path'); const os = require('os');
const EXT = path.resolve(__dirname, '../extension');
const withExt = !process.argv.includes('--no-extension');
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'al-nav-' + Date.now()), {
    headless: false, executablePath: process.env.CHROMIUM_PATH, viewport: { width: 1500, height: 1000 },
    args: withExt ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : []
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const logs = []; page.on('console', m => { if (/\[AL\]/.test(m.text())) logs.push(m.text()); });
  await page.addInitScript(() => {
    window.__long = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  });
  const take = async () => page.evaluate(() => { const a = window.__long || []; window.__long = []; return { count: a.length, total: Math.round(a.reduce((x, y) => x + y, 0)), max: Math.round(Math.max(0, ...a)) }; });
  await page.goto('https://www.twitch.tv/directory/category/valorant', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('article', { timeout: 30000 });
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(1200); }
  await page.waitForTimeout(8000);
  const cards = await page.locator('article').count();
  console.log(withExt ? 'WITH extension' : 'WITHOUT extension', 'cards', cards, 'load+scroll', JSON.stringify(await take()));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(1000); await take();
  // Another category through Twitch's own navigation (a game link in the side bar or a category link).
  const link = page.locator('a[href^="/directory/category/"]:not([href*="valorant"])').first();
  let t0 = Date.now();
  if (await link.count()) await link.click(); else await page.evaluate(() => { history.pushState({}, '', '/directory/category/counter-strike'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(6000);
  console.log('to other category', page.url().replace('https://www.twitch.tv', ''), JSON.stringify(await take()));
  t0 = Date.now();
  await page.goBack(); await page.waitForSelector('article', { timeout: 30000 });
  const firstCard = Date.now() - t0;
  await page.waitForTimeout(6000);
  console.log('back to VALORANT: first card after', firstCard, 'ms', JSON.stringify(await take()), 'cards', await page.locator('article').count());
  await page.goForward(); await page.waitForTimeout(4000); await take();
  t0 = Date.now(); await page.goBack(); await page.waitForSelector('article', { timeout: 30000 });
  const second = Date.now() - t0; await page.waitForTimeout(6000);
  console.log('back again: first card after', second, 'ms', JSON.stringify(await take()));
  if (logs.length) console.log(logs.slice(-15).join('\n'));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
