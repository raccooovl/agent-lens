// Browser checks for Agent Lens with the real extension, captured Twitch markup and known preview images.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os');
const http = require('http');
const SOURCE = path.resolve(process.argv[2] || path.join(__dirname, '../extension'));
// The extension's service worker fetches previews itself, out of reach of Playwright's routing, so the tests
// run a copy that fetches from a local server with the same paths as Twitch's image server.
const PREVIEW_HOST = 'https://static-cdn.jtvnw.net/previews-ttv/live_user_';
let EXT = '';
function prepareExtension(port) {
  EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'al-ext-'));
  fs.cpSync(SOURCE, EXT, { recursive: true });
  const bg = path.join(EXT, 'background.js'), source = fs.readFileSync(bg, 'utf8');
  if (!source.includes(PREVIEW_HOST)) throw new Error('preview URL not found in background.js');
  fs.writeFileSync(bg, source.replace(PREVIEW_HOST, `http://127.0.0.1:${port}/previews-ttv/live_user_`));
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json')));
  manifest.host_permissions.push('http://127.0.0.1/*');
  fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(manifest));
}
const FX = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const MAIN = FX('valorant-directory.html');
const NAV = FX('nav.html')
  .replace(/(href="\/aspen"[\s\S]*?side-nav-card__metadata[^>]*>\s*<p[^>]*title=")Overwatch("[^>]*>)Overwatch/, '$1VALORANT$2VALORANT')
  .replace(/(href="\/buddha"[\s\S]*?side-nav-card__metadata[^>]*>\s*<p[^>]*title=")Grand Theft Auto V("[^>]*>)Grand Theft Auto V/, '$1VALORANT$2VALORANT');
const PREVIEWS = [
  ['r1_66xeni', 'jett'], ['r1_1artifact', 'clove'], ['r2_nats', 'cypher'], ['r1_neehji', 'deadlock'], ['r1_battlesage_', 'sage'],
  ['r1_sikyume', 'reyna'], ['r1_emmyuh', 'omen'], ['r1_hiko', 'sova'], ['r1_gotarii', 'fade'], ['r1_sinatraa', 'raze'],
  ['r1_hennie2001', 'neon'], ['r1_ahhdigital', 'astra'], ['r1_mspokee', 'viper'], ['r2_stamp_on_dooor', 'waylay'],
  ['r1_ajak0n', null], ['r1_alexfr1x', null], ['r1_bakamarimmo', null], ['live_cloudey', null], ['r1_snowyy20_', null], ['r3_grimm', 'sage'],
  ['r11_panzermausitv', 'sage'], ['r11_zoovieh', 'miks'], ['r9_valorant_americas', null], ['r1_rau_meat', null]
];
// Screens without the ability bar that get a pill naming them.
const PILLS = { r1_ajak0n: 'In menus', r1_snowyy20_: 'Agent select', r9_valorant_americas: 'Pro match', r1_rau_meat: 'Deathmatch' };
const DUO = ['r11_panzermausitv', 'r11_zoovieh'];   // two streams in the same match (same team, 8-5)
// Bars seen only on a death or round-end screen: shown as "Agent?" (r1_emmyuh: combat report; r3_grimm: FLAWLESS).
const MAYBE = new Set(['r1_emmyuh', 'r3_grimm']);
const SPECTATE_FILE = 'live_cloudey';   // dead and watching a teammate (Jett): must not be called Jett
const SCORES = { r1_1artifact: [4, 1], r1_battlesage_: [0, 0], r1_hiko: [0, 2], r1_emmyuh: [1, 2], r1_ahhdigital: [0, 2], r1_gotarii: [2, 0], r1_hennie2001: [0, 2] };
const LOGINS = [...new Set([...MAIN.matchAll(/previews-ttv\/live_user_([a-z0-9_]+)/g)].map(m => m[1]))];
const OFFLINE = 'xuro_tv';
const MAP = new Map(LOGINS.map((login, i) => [login, PREVIEWS[i % PREVIEWS.length]]));
MAP.set('aspen', ['r1_66xeni', 'jett']); MAP.set('buddha', ['r1_ajak0n', null]);
const expected = login => login === OFFLINE ? null : MAP.get(login)[1];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const results = []; let current = '';
function check(name, ok, detail = '') { results.push({ group: current, name, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + ' [' + current + '] ' + name + (ok || !detail ? '' : ' :: ' + String(detail).slice(0, 500))); }
function page(main, theme, title = 'Twitch') {
  return `<!doctype html><html class="tw-root--theme-${theme}"><head><title>${title}</title><style>#side-nav{width:240px;flex:0 0 240px} body{margin:0;font-family:Inter,sans-serif}</style></head><body><div id="root" style="display:flex">${NAV}${main}</div></body></html>`;
}
async function launch(lang = 'en', options = {}) {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'al-e2e-' + lang + '-' + Date.now()), {
    headless: false, executablePath: process.env.CHROMIUM_PATH || undefined, viewport: { width: 1500, height: 1000 }, locale: lang === 'en' ? 'en-US' : lang,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${lang}`]
  });
  const state = { theme: options.theme || 'light', previewRequests: [] };
  await ctx.route('https://www.twitch.tv/**', route => {
    if (route.request().resourceType() !== 'document') return route.abort();
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/directory/category/valorant')) return route.fulfill({ status: 200, contentType: 'text/html', body: page(MAIN, state.theme) });
    return route.fulfill({ status: 200, contentType: 'text/html', body: page('<main style="flex:1"><div class="channel-info-content"><h1>Aspen</h1></div></main>', state.theme, 'Aspen - Twitch') });
  });
  await ctx.route('https://static-cdn.jtvnw.net/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  server.state = state;
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  return { ctx, sw, id: new URL(sw.url()).host, state };
}

const server = http.createServer((req, res) => {
  const m = /^\/previews-ttv\/live_user_([a-z0-9_]+)-(\d+)x(\d+)\.jpg/.exec(req.url);
  if (m) {
    server.state?.previewRequests.push({ login: m[1], size: `${m[2]}x${m[3]}`, referer: req.headers.referer || '', cookie: req.headers.cookie || '' });
    if (m[1] === OFFLINE) { res.writeHead(302, { location: '/ttv-static/404_preview-1920x1080.jpg' }); return res.end(); }
    const pick = MAP.get(m[1]);
    if (pick) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(fs.readFileSync(path.join(__dirname, 'fixtures/previews', pick[0] + '.jpg'))); }
  }
  res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  prepareExtension(server.address().port);
  const { ctx, sw, id, state } = await launch('en');
  const errors = [];
  const tab = ctx.pages()[0] || await ctx.newPage();
  tab.on('pageerror', e => errors.push('page: ' + e.message));
  tab.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  sw.on('console', m => { if (m.type() === 'error') errors.push('worker: ' + m.text()); });
  const badges = () => tab.evaluate(() => Object.fromEntries([...document.querySelectorAll('agent-lens[data-al-kind="card"]')].map(h => {
    const card = h.closest('article'); const login = card.querySelector('a[data-a-target="preview-card-channel-link"]').getAttribute('href').slice(1);
    const b = h.shadowRoot.querySelector('.badge');
    return [login, b ? { text: b.textContent, cls: b.className, title: b.getAttribute('title') } : h.shadowRoot.querySelector('.reading') ? 'reading' : null];
  })));
  const bar = () => tab.locator('agent-lens[data-al-kind="bar"]');
  const barInfo = () => bar().evaluate(h => ({ status: h.shadowRoot.querySelector('.status')?.textContent, chips: [...h.shadowRoot.querySelectorAll('.chip')].map(c => c.textContent + (c.getAttribute('aria-pressed') === 'true' ? '*' : '')) }));
  const shownLogins = () => tab.evaluate(() => [...document.querySelectorAll('article')].filter(a => a.getClientRects().length > 0).map(a => a.querySelector('a[data-a-target="preview-card-channel-link"]')?.getAttribute('href')?.slice(1)).filter(Boolean));
  const waitRead = async (n, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { const b = await badges(); if (Object.values(b).filter(v => v && v !== 'reading').length >= n && !Object.values(b).includes('reading')) return b; await tab.waitForTimeout(500); } return badges(); };

  current = 'detection';
  await tab.goto('https://www.twitch.tv/directory/category/valorant');
  await tab.waitForSelector('agent-lens[data-al-kind="card"]', { timeout: 15000 });
  check('a badge spot on every live VALORANT card', (await tab.locator('agent-lens[data-al-kind="card"]').count()) === LOGINS.length, await tab.locator('agent-lens[data-al-kind="card"]').count());
  const sawReading = Object.values(await badges()).includes('reading');
  check('cards show a reading marker while their preview is analysed', sawReading);
  const expectedAgents = LOGINS.filter(l => expected(l)).length;
  const b1 = await waitRead(expectedAgents);
  const meta = JSON.parse(fs.readFileSync(path.join(EXT, 'data/agents.json')));
  const nameOf = id => meta.agents.find(a => a.id === id)?.name;
  const wrong = [], missing = [], extra = [], pills = [];
  const spectators = LOGINS.filter(l => l !== OFFLINE && MAP.get(l)[0] === SPECTATE_FILE);
  for (const login of LOGINS) {
    const want = expected(login), got = b1[login];
    if (spectators.includes(login)) continue;
    const file = login === OFFLINE ? null : MAP.get(login)[0];
    const wantText = want && (MAYBE.has(file) ? nameOf(want) + '?' : nameOf(want));
    if (want && !got) missing.push(login);
    else if (want && got && got.text.replace(/\d+–\d+$/, '') !== wantText) wrong.push(`${login}: ${got.text} (want ${wantText})`);
    else if (!want && PILLS[file]) { if (!got || got.text !== PILLS[file]) pills.push(`${login}: ${got && got.text} (want ${PILLS[file]})`); }
    else if (!want && got) extra.push(`${login}: ${got.text}`);
  }
  check('every gameplay preview gets its correct agent (incl. stretched 4:3 HUDs); death and round-end screens only an "Agent?"', !wrong.length && !missing.length, JSON.stringify({ wrong, missing }));
  check('menus, agent select, official broadcasts and deathmatch get a pill saying so', !pills.length && LOGINS.some(l => l !== OFFLINE && PILLS[MAP.get(l)[0]]), pills.join(', '));
  check('Deathmatch, blank screens, other games and offline channels get nothing', !extra.length, extra.join(', '));
  check('a dead streamer watching a teammate shows "Spectating", not the teammate\'s agent', spectators.length > 0 && spectators.every(l => b1[l] && /^Spectating/.test(b1[l].text) && /watching a teammate \(Jett\)/.test(b1[l].title)), JSON.stringify(spectators.map(l => b1[l])));
  const scoreWrong = [];
  let scoresShown = 0;
  for (const login of LOGINS) {
    const got = b1[login]; const file = MAP.get(login)[0];
    const m = got && /(\d+)–(\d+)$/.exec(got.text);
    if (m) { scoresShown++; if (SCORES[file] && (SCORES[file][0] !== +m[1] || SCORES[file][1] !== +m[2])) scoreWrong.push(`${login} ${got.text} want ${SCORES[file]}`); }
  }
  {
    const duo = LOGINS.filter(l => l !== OFFLINE && DUO.includes(MAP.get(l)[0]));
    const names = await tab.evaluate(ls => ls.map(l => document.querySelector(`a[data-a-target="preview-card-channel-link"][href="/${l}"] p[title]`)?.getAttribute('title') || l), duo);
    const info = await barInfo();
    const chip = info.chips.find(c => names.every(n => c.includes(n)));
    check('streams in the same match are linked: a "Same match" chip, and the badge tooltip names the other stream', duo.length === 2 && chip && duo.every((l, i) => (b1[l].title || '').includes('In the same match as ' + names[1 - i])),
      JSON.stringify({ duo, names, chips: info.chips.slice(-10), titles: duo.map(l => b1[l] && b1[l].title) }));
    check('the badge tooltip lists both teams\' agents', duo.every(l => /Team: .+\nAgainst: /.test(b1[l].title || '')), duo.map(l => b1[l] && b1[l].title).join(' || '));
    check('map and mode from agent select become filter chips', info.chips.some(c => /^Bind\d/.test(c)) && info.chips.some(c => /^Competitive\d/.test(c)), JSON.stringify(info.chips));
    if (chip) {
      await bar().evaluate((h, text) => [...h.shadowRoot.querySelectorAll('.chip')].find(c => c.textContent === text).click(), chip);
      await tab.waitForTimeout(400);
      const shown = await shownLogins();
      check('picking that match shows just those two streams', shown.length === 2 && duo.every(l => shown.includes(l)), JSON.stringify(shown));
      await bar().evaluate(h => h.shadowRoot.querySelector('.clear').click()); await tab.waitForTimeout(300);
    }
  }
  check('round scores read where visible, never wrong', scoresShown >= 8 && !scoreWrong.length, JSON.stringify({ scoresShown, scoreWrong }));
  check('badge tooltip names streamer and agent', /is playing Jett/.test(Object.values(b1).find(v => v && /^Jett/.test(v.text))?.title || ''), JSON.stringify(Object.values(b1).find(v => v && /^Jett/.test(v.text))));
  const reqs = state.previewRequests;
  {
    const per = new Map(); for (const r of reqs) per.set(r.login, [...(per.get(r.login) || []), r.size]);
    check('previews fetched without referrer or cookies: a quick 640x360 look first, bigger pictures only for streams in a match',
      reqs.length >= LOGINS.length && reqs.every(r => !r.referer && !r.cookie) && [...per.values()].every(s => s[0] === '640x360' && s.length <= 3 && s.slice(1).every(x => ['1280x720', '1920x1080'].includes(x))),
      JSON.stringify({ n: reqs.length, streams: per.size, first: reqs[0] }));
  }
  const geo = await tab.evaluate(() => { const h = [...document.querySelectorAll('agent-lens[data-al-kind="card"]')].find(x => x.shadowRoot.querySelector('.badge')); const img = h.parentElement.getBoundingClientRect(), r = h.shadowRoot.querySelector('.badge').getBoundingClientRect(); return { bottom: Math.round(img.bottom - r.bottom), right: Math.round(img.right - r.right) }; });
  check('badge sits in the bottom-right corner of the thumbnail (clear of LIVE, viewers and Twitch Snooze)', geo.bottom >= 4 && geo.bottom <= 12 && geo.right >= 4 && geo.right <= 12, JSON.stringify(geo));
  await tab.screenshot({ path: path.join(__dirname, 'shots/e2e-directory.png') });

  current = 'filter';
  let info = await barInfo();
  check('bar counts identified streams', /^\d+ of 30 streams identified/.test(info.status), info.status);
  check('bar has four role chips and a chip per agent present', info.chips.slice(0, 4).join('|') === 'Duelists|Initiators|Controllers|Sentinels' && info.chips.some(c => /^Jett\d/.test(c)), info.chips.join(' | '));
  await bar().locator('.chip', { hasText: 'Controllers' }).click(); await tab.waitForTimeout(300);
  let shown = await shownLogins();
  const ctrl = meta.agents.filter(a => a.role === 'Controller').map(a => a.id);
  check('role chip shows only that role', shown.length > 0 && shown.every(l => ctrl.includes(expected(l))), shown.map(l => l + ':' + expected(l)).join(','));
  await bar().locator('.chip', { hasText: 'Controllers' }).click(); await tab.waitForTimeout(200);
  await bar().locator('.chip', { hasText: /^Jett/ }).click(); await tab.waitForTimeout(300);
  shown = await shownLogins();
  check('agent chip shows only that agent', shown.length >= 1 && shown.every(l => expected(l) === 'jett'), shown.join(','));
  {
    // Twitch adds cards as the (now short) list scrolls: with a filter on, a new card must never flash up.
    const seenNew = await tab.evaluate(() => new Promise(resolve => {
      const tower = document.querySelector('.tw-tower'), cell = [...tower.children].reverse().find(c => c.querySelector('article')).cloneNode(true);
      cell.querySelectorAll('agent-lens').forEach(h => h.remove());
      cell.removeAttribute('data-al-pass'); cell.removeAttribute('data-al-hidden');
      const a = cell.querySelector('a[data-a-target="preview-card-channel-link"]'); a.setAttribute('href', '/brandnewstreamer');
      const frames = [];
      tower.append(cell);
      frames.push(cell.querySelector('article').getClientRects().length > 0);      // the moment it's added
      let n = 0; (function tick() { frames.push(cell.querySelector('article').getClientRects().length > 0); if (++n < 30) requestAnimationFrame(tick); else resolve(frames); })();
    }));
    check('with a filter on, a card Twitch adds never shows before it is checked (no flicker)', seenNew.every(v => v === false), JSON.stringify(seenNew));
  }
  info = await barInfo();
  check('status says how many are shown, and the chip is pressed', /Showing \d+ stream/.test(info.status) && info.chips.some(c => /^Jett\d+\*$/.test(c)), JSON.stringify(info));
  await bar().locator('.chip', { hasText: /^Sova/ }).click(); await tab.waitForTimeout(300);
  shown = await shownLogins();
  check('two agents combine', shown.some(l => expected(l) === 'sova') && shown.some(l => expected(l) === 'jett') && shown.every(l => ['jett', 'sova'].includes(expected(l))), shown.join(','));
  await tab.reload(); await tab.waitForSelector('agent-lens[data-al-kind="bar"]'); await tab.waitForTimeout(1500);
  shown = await shownLogins();
  check('filter is remembered after reload (results come from cache)', shown.length >= 1 && shown.every(l => ['jett', 'sova'].includes(expected(l))), shown.join(','));
  await bar().locator('.clear').click(); await tab.waitForTimeout(300);
  check('Clear shows every stream again', (await shownLogins()).length === LOGINS.length);
  await bar().locator('.chip', { hasText: 'Sentinels' }).click(); await bar().locator('.chip', { hasText: /^Phoenix/ }).count();
  await bar().locator('.chip', { hasText: /^Jett/ }).click(); await tab.waitForTimeout(300);
  info = await barInfo();
  const empty = await bar().evaluate(h => h.shadowRoot.querySelector('.empty')?.textContent || '');
  check('impossible filter explains itself', /Nobody on this page/.test(empty) && (await shownLogins()).length === 0, empty);
  await bar().locator('.clear').click(); await tab.waitForTimeout(200);

  current = 'favourites';
  await sw.evaluate(() => chrome.storage.local.get('agentLensSettings').then(r => chrome.storage.local.set({ agentLensSettings: { ...r.agentLensSettings, favorites: ['jett', 'omen'] } })));
  await tab.waitForTimeout(500);
  const b2 = await badges();
  check('your agents get a star on their badges', Object.values(b2).filter(v => v && /fav/.test(v.cls)).every(v => /^★?(Jett|Omen)/.test(v.text.replace('★', ''))) && Object.values(b2).some(v => v && /fav/.test(v.cls)), JSON.stringify(Object.values(b2).filter(v => v && /fav/.test(v.cls))));
  await bar().locator('.chip.star').click(); await tab.waitForTimeout(300);
  shown = await shownLogins();
  check('"My agents" chip filters to them', shown.length > 0 && shown.every(l => ['jett', 'omen'].includes(expected(l))), shown.join(','));
  await bar().locator('.clear').click(); await tab.waitForTimeout(200);

  current = 'settings';
  const setSetting = patch => sw.evaluate(patch => chrome.storage.local.get('agentLensSettings').then(r => chrome.storage.local.set({ agentLensSettings: { ...r.agentLensSettings, ...patch } })), patch);
  await setSetting({ scores: false }); await tab.waitForTimeout(400);
  check('scores can be turned off', Object.values(await badges()).every(v => !v || !/\d+–\d+/.test(v.text)));
  await setSetting({ badges: false }); await tab.waitForTimeout(400);
  check('badges can be turned off', Object.values(await badges()).every(v => !v));
  await setSetting({ badges: true, scores: true }); await tab.waitForTimeout(400);
  check('and back on', Object.values(await badges()).filter(Boolean).length >= expectedAgents);

  current = 'sidebar';
  const side = await tab.evaluate(() => [...document.querySelectorAll('agent-lens[data-al-kind="row"]')].map(h => ({ login: h.closest('.side-nav-card').querySelector('a').getAttribute('href').slice(1), label: h.shadowRoot.querySelector('.side')?.getAttribute('aria-label') || null })));
  check('sidebar rows playing VALORANT get a spot, others not', side.length === 2 && side.map(s => s.login).sort().join() === 'aspen,buddha', JSON.stringify(side));
  await tab.waitForTimeout(300);
  check('a VALORANT sidebar row shows the agent on the avatar', /Playing Jett/.test(JSON.stringify(await tab.evaluate(() => [...document.querySelectorAll('agent-lens[data-al-kind="row"]')].map(h => h.shadowRoot.querySelector('.side')?.getAttribute('aria-label'))))));

  current = 'popup';
  const popup = await ctx.newPage(); popup.on('pageerror', e => errors.push('popup: ' + e.message));
  await popup.setViewportSize({ width: 372, height: 640 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  {
    const status = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'AL_STATUS' }));
    check('the WebAssembly matching kernel runs in the extension', status && status.kernel === true, JSON.stringify(status));
  }
  await tab.bringToFront(); await popup.evaluate(() => location.reload()); await popup.waitForTimeout(1500);
  const pop = await popup.evaluate(() => ({ tab: document.getElementById('tab').textContent, picks: document.querySelectorAll('.pick').length, pressed: [...document.querySelectorAll('.pick[aria-pressed="true"]')].map(b => b.title), switches: [...document.querySelectorAll('.switch')].map(s => s.textContent + ':' + s.querySelector('input').checked), font: getComputedStyle(document.body).fontFamily }));
  check('popup: page summary for the directory', /of 30 VALORANT streams on this page identified/.test(pop.tab), pop.tab);
  check('popup: 29 agents to pick, your agents pressed', pop.picks === meta.agents.length && pop.pressed.sort().join() === 'Jett,Omen', JSON.stringify(pop.pressed));
  check('popup: four settings in the right state', pop.switches.length === 4 && pop.switches.every(s => s.endsWith(':true')), pop.switches.join(' | '));
  await popup.locator('.pick[title="Sova"]').click(); await popup.waitForTimeout(300);
  check('picking an agent saves it', (await sw.evaluate(() => chrome.storage.local.get('agentLensSettings').then(r => r.agentLensSettings.favorites))).includes('sova'));
  await popup.locator('.switch', { hasText: 'Round score' }).locator('input').click(); await popup.waitForTimeout(300);
  check('switch saves the setting', (await sw.evaluate(() => chrome.storage.local.get('agentLensSettings').then(r => r.agentLensSettings.scores))) === false);
  await popup.locator('.switch', { hasText: 'Round score' }).locator('input').click(); await popup.waitForTimeout(300);
  check('and switching back saves again', (await sw.evaluate(() => chrome.storage.local.get('agentLensSettings').then(r => r.agentLensSettings.scores))) === true);
  await popup.screenshot({ path: path.join(__dirname, 'shots/e2e-popup-directory.png') });
  await tab.goto('https://www.twitch.tv/aspen'); await tab.waitForTimeout(1500);
  await tab.bringToFront(); await popup.evaluate(() => location.reload()); await popup.waitForTimeout(2500);
  const chTab = await popup.evaluate(() => document.getElementById('tab').textContent);
  check('popup: channel page shows what that streamer is playing', /Aspen/.test(chTab) && /Playing Jett/.test(chTab), chTab);
  await popup.screenshot({ path: path.join(__dirname, 'shots/e2e-popup-channel.png') });
  await popup.close();

  current = 'theme';
  state.theme = 'dark';
  await tab.goto('https://www.twitch.tv/directory/category/valorant'); await tab.waitForSelector('agent-lens[data-al-kind="bar"]'); await tab.waitForTimeout(1500);
  check('bar follows Twitch dark theme', (await bar().evaluate(h => h.dataset.theme)) === 'dark');
  await tab.screenshot({ path: path.join(__dirname, 'shots/e2e-directory-dark.png') });

  current = 'errors';
  check('no errors from the extension', errors.filter(e => !/getLayoutMap|Failed to load resource/.test(e)).length === 0, errors.join(' | '));
  await ctx.close();

  // Dutch
  current = 'dutch';
  const nl = await launch('nl');
  const nlTab = nl.ctx.pages()[0] || await nl.ctx.newPage();
  await nlTab.goto('https://www.twitch.tv/directory/category/valorant'); await nlTab.waitForSelector('agent-lens[data-al-kind="bar"]'); await nlTab.waitForTimeout(8000);
  const nlInfo = await nlTab.locator('agent-lens[data-al-kind="bar"]').evaluate(h => ({ status: h.shadowRoot.querySelector('.status')?.textContent, chips: [...h.shadowRoot.querySelectorAll('.chip')].slice(0, 4).map(c => c.textContent) }));
  check('Dutch bar text', /streams herkend/.test(nlInfo.status) && nlInfo.chips[0] === 'Duelists', JSON.stringify(nlInfo));
  await nl.ctx.close();

  // Minimum viewers (250): smaller streams are never downloaded.
  current = 'min viewers';
  const mv = await launch('en');
  await mv.sw.evaluate(() => chrome.storage.local.set({ agentLensSettings: { badges: true, scores: true, sidebar: true, quality: 'high', favorites: [], minViewers: 250 } }));
  const mvTab = mv.ctx.pages()[0] || await mv.ctx.newPage();
  await mvTab.goto('https://www.twitch.tv/directory/category/valorant'); await mvTab.waitForSelector('agent-lens[data-al-kind="bar"]'); await mvTab.waitForTimeout(12000);
  const cardsMv = await mvTab.evaluate(() => [...document.querySelectorAll('article')].map(a => ({
    login: a.querySelector('a[data-a-target="preview-card-channel-link"]')?.getAttribute('href')?.slice(1),
    viewers: a.querySelector('.tw-media-card-stat')?.textContent || '',
    badge: a.querySelector('agent-lens')?.shadowRoot.querySelector('.badge, .reading') ? true : false })).filter(c => c.login));
  const count = text => { const m = /([\d.,]+)\s*(K)?/.exec(text); return m ? Math.round(parseFloat(m[1].replace(',', '')) * (m[2] ? 1000 : 1)) : null; };
  const small = cardsMv.filter(c => count(c.viewers) !== null && count(c.viewers) < 250), bigOnes = cardsMv.filter(c => count(c.viewers) >= 250);
  const fetchedMv = new Set(mv.state.previewRequests.map(r => r.login));
  check('streams under the minimum viewers get no badge and are never downloaded', small.length > 3 && small.every(c => !c.badge && !fetchedMv.has(c.login)),
    JSON.stringify({ small: small.length, wrong: small.filter(c => c.badge || fetchedMv.has(c.login)).map(c => c.login + ' ' + c.viewers) }));
  check('streams above it are read as usual', bigOnes.length > 0 && bigOnes.filter(c => c.login !== OFFLINE).every(c => fetchedMv.has(c.login)), JSON.stringify(bigOnes.map(c => c.login + ' ' + c.viewers)));
  const mvStatus = await mvTab.locator('agent-lens[data-al-kind="bar"]').evaluate(h => h.shadowRoot.querySelector('.status')?.textContent);
  check('the bar says how many were skipped', new RegExp(`${small.length} under 250 viewers skipped`).test(mvStatus), mvStatus);
  // The same setting in the bar: back to all streams, and the small ones are read too.
  const picker = await mvTab.locator('agent-lens[data-al-kind="bar"]').evaluate(h => { const s = h.shadowRoot.querySelector('select.minv'); return s && { value: s.value, options: [...s.options].map(o => o.textContent) }; });
  check('the directory bar has the minimum-viewers picker, set like the popup', picker && picker.value === '250' && picker.options[0] === 'All', JSON.stringify(picker));
  await mvTab.locator('agent-lens[data-al-kind="bar"]').evaluate(h => { const s = h.shadowRoot.querySelector('select.minv'); s.value = '0'; s.dispatchEvent(new Event('change')); s.blur(); });
  await mvTab.waitForTimeout(8000);
  const stored = await mv.sw.evaluate(() => chrome.storage.local.get('agentLensSettings').then(r => r.agentLensSettings.minViewers));
  const fetchedAfter = new Set(mv.state.previewRequests.map(r => r.login));
  check('picking "All" in the bar saves it and reads the smaller streams too', stored === 0 && small.every(c => fetchedAfter.has(c.login)), JSON.stringify({ stored, missing: small.filter(c => !fetchedAfter.has(c.login)).map(c => c.login) }));

  // While filtering, Twitch's "load more" area is moved out of view when loading more can't help: hidden cards
  // would otherwise make Twitch load page after page (and rebuild them all on Back).
  current = 'loading pause';
  await mv.sw.evaluate(() => chrome.storage.local.set({ agentLensSettings: { badges: true, scores: true, sidebar: true, quality: 'high', favorites: [], minViewers: 250 }, agentLensFilter: { roles: [], agents: ['jett'], mine: false } }));
  const pauseState = () => mvTab.evaluate(() => {
    const area = document.querySelector('.tw-tower ~ .scrollable-trigger__wrapper > .scrollable-trigger__trigger-area'), host = document.querySelector('agent-lens[data-al-kind="bar"]');
    return { paused: document.documentElement.hasAttribute('data-al-noload'), areaTop: area ? Math.round(area.getBoundingClientRect().top) : null, cards: document.querySelectorAll('article').length,
      status: host?.shadowRoot.querySelector('.status')?.textContent || '', more: !!host?.shadowRoot.querySelector('button.more') };
  });
  await mvTab.goto('https://www.twitch.tv/directory/category/valorant?sort=VIEWER_COUNT'); await mvTab.waitForSelector('agent-lens[data-al-kind="bar"]'); await mvTab.waitForTimeout(2500);
  let ps = await pauseState();
  check('sorted by viewers with the last card under the minimum: no more loading, and the bar says why', ps.paused && ps.areaTop < -50000 && /the rest are under 250 viewers, not loaded/.test(ps.status) && !ps.more, JSON.stringify(ps));
  await mvTab.goto('https://www.twitch.tv/directory/category/valorant'); await mvTab.waitForSelector('agent-lens[data-al-kind="bar"]'); await mvTab.waitForTimeout(2500);
  ps = await pauseState();
  check('other sort orders keep loading while the page is small', !ps.paused && ps.areaTop > 0, JSON.stringify(ps));
  // Twitch loads up to 300 cards (copies of small streams, never downloaded).
  await mvTab.evaluate(() => {
    const tower = document.querySelector('.tw-tower'), cells = [...tower.children].filter(c => c.querySelector('article'));
    const src = cells.find(c => /^\d{1,2}\s/.test(c.querySelector('.tw-media-card-stat')?.textContent || '')) || cells[cells.length - 1];
    for (let i = cells.length; i < 300; i++) {
      const cell = src.cloneNode(true); cell.querySelectorAll('agent-lens').forEach(h => h.remove()); cell.removeAttribute('data-al-pass'); cell.removeAttribute('data-al-hidden');
      cell.querySelectorAll('a[href]').forEach(a => { if (/^\/[a-z0-9_]+$/.test(a.getAttribute('href'))) a.setAttribute('href', '/copy' + i); });
      tower.append(cell);
    }
    window.__scrolls = 0; document.addEventListener('scroll', () => window.__scrolls++, true);
  });
  await mvTab.waitForTimeout(2500);
  ps = await pauseState();
  check('after 300 streams loading pauses, with a "Load more" button', ps.cards === 300 && ps.paused && ps.areaTop < -50000 && /loading paused at 300 streams/.test(ps.status) && ps.more, JSON.stringify(ps));
  await mvTab.locator('agent-lens[data-al-kind="bar"]').evaluate(h => h.shadowRoot.querySelector('button.more').click()); await mvTab.waitForTimeout(500);
  ps = await pauseState();
  const scrolls = await mvTab.evaluate(() => window.__scrolls);
  check('"Load more" lets Twitch load again (its load-more area back in view, a scroll check sent)', !ps.paused && ps.areaTop > -50000 && scrolls > 0 && !ps.more && !/paused/.test(ps.status), JSON.stringify({ ...ps, scrolls }));
  await mvTab.locator('agent-lens[data-al-kind="bar"]').evaluate(h => h.shadowRoot.querySelector('.clear:not(.more)').click()); await mvTab.waitForTimeout(500);
  ps = await pauseState();
  check('no filter, no pause', !ps.paused, JSON.stringify(ps));
  await mv.ctx.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILED', e); process.exit(2); });
