const { chromium } = require('playwright'); const path = require('path'); const os = require('os');
const EXT = path.resolve(__dirname, '../extension');
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'al-probe-' + Date.now()), {
    headless: false, executablePath: process.env.CHROMIUM_PATH, viewport: { width: 1500, height: 1000 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const swLogs = []; sw.on('console', m => swLogs.push(m.type() + ' ' + m.text()));
  const page = ctx.pages()[0] || await ctx.newPage();
  const logs = []; page.on('console', m => { if (/agent|lens|error/i.test(m.text())) logs.push(m.type() + ' ' + m.text().slice(0, 200)); });
  page.on('pageerror', e => logs.push('PAGEERR ' + e.message));
  await page.goto('https://www.twitch.tv/directory/category/valorant', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('article', { timeout: 30000 }); 
  for (const wait of [3000, 6000, 10000, 15000]) {
    await page.waitForTimeout(wait);
    const info = await page.evaluate(() => ({
      cards: document.querySelectorAll('article').length,
      hosts: document.querySelectorAll('agent-lens[data-al-kind="card"]').length,
      badges: [...document.querySelectorAll('agent-lens[data-al-kind="card"]')].map(h => h.shadowRoot.querySelector('.badge')?.textContent || (h.shadowRoot.querySelector('.reading') ? '…' : '-')),
      bar: document.querySelector('agent-lens[data-al-kind="bar"]')?.shadowRoot.querySelector('.status')?.textContent,
      side: document.querySelectorAll('agent-lens[data-al-kind="row"]').length
    }));
    console.log(wait, JSON.stringify(info));
  }
  await page.screenshot({ path: path.join(__dirname, 'shots/probe-directory.png') });
  console.log('page logs', logs.slice(0, 10)); console.log('sw logs', swLogs.slice(0, 10));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
