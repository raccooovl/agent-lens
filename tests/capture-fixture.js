// Captures the live VALORANT directory markup (no scripts, no third-party images) as a test fixture.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const b = await chromium.launch({ headless: false, executablePath: process.env.CHROMIUM_PATH });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await p.goto('https://www.twitch.tv/directory/category/valorant', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('article img[src*="previews-ttv"]', { timeout: 30000 }); await p.waitForTimeout(3000);
  const html = await p.evaluate(() => {
    const main = document.querySelector('main').cloneNode(true);
    main.querySelectorAll('script,style,iframe,video').forEach(n => n.remove());
    main.querySelectorAll('img').forEach(img => { const s = img.getAttribute('src') || ''; img.removeAttribute('srcset'); if (!/previews-ttv/.test(s)) img.setAttribute('src', 'data:,'); });
    return main.outerHTML;
  });
  fs.writeFileSync(path.join(__dirname, 'fixtures/valorant-directory.html'), html);
  console.log(html.length, (html.match(/previews-ttv/g) || []).length);
  await b.close();
})();
