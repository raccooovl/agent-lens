'use strict';
// Store screenshots (1280x800, in all five languages) and promo images for Agent Lens.
// The screenshots come from a local stage: Twitch-like pages with made-up channels, the real extension, and
// hand-checked previews from tests/fixtures/previews that show no real faces. Nothing is loaded from twitch.tv.
// Run: npm install --no-save playwright, then node tools/store-assets.cjs [--lang=en,nl] [--skip-promo]
// (set CHROMIUM_PATH to use a specific Chromium). Writes store-assets/<language>/ and store-assets/promo/.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'store-assets');
const DOCS_IMG = path.join(ROOT, 'docs', 'img');   // the website gets JPEG copies of the English images
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
const LANGS = (arg('lang') || 'en,nl,de,es,pt_BR').split(',');
const W = 1280, H = 800, CAPTION = 64, STAGE_H = H - CAPTION;
const messages = require('./messages.cjs');
const msg = (key, lang) => messages.messages[key][messages.languages.indexOf(lang)];

// Made-up channels, four to a row in the directory. Each gets a hand-checked preview without a real face in it
// (no camera, or a drawn or VTuber avatar). Row 3 holds the screens without an agent, for the status pills.
const CHANNELS = [
  ['pixelharbor', 'PixelHarbor', 'r1_66xeni', 1240, 'Radiant grind, road to top 500', 'English'],
  ['mintyaim', 'mintyaim', 'r1_1artifact', 842, 'chill comp with chat | !crosshair', 'English'],
  ['inkblot_gg', 'Inkblot_GG', 'r1_sikyume', 615, 'ranked until Immortal 3', 'English'],
  ['quietpeak', 'QuietPeak', 'r11_panzermausitv', 388, 'unrated with friends', 'Deutsch'],
  ['sakuramochi_vt', 'SakuraMochi_VT', 'r1_hennie2001', 356, 'VTuber plays comp | !socials', 'English'],
  ['kaiyo_fps', 'kaiyo_fps', 'r2_stamp_on_dooor', 290, 'learning a new duelist today', 'Español'],
  ['lunarlurk', 'LunarLurk', 'r1_mspokee', 247, 'lineups and ranked', 'Português'],
  ['nebulanotes', 'NebulaNotes', 'r2_earendelxdfp', 221, 'comfy ranked night', 'English'],
  ['coldbrewclutch', 'ColdBrewClutch', 'r1_snowyy20_', 198, 'first game of the day', 'English'],
  ['kiteflyer', 'kiteflyer', 'r1_ajak0n', 164, 'queueing up, come hang out', 'English'],
  ['esportsdesk', 'EsportsDesk', 'r9_valorant_americas', 1530, 'watch party: playoffs day', 'English'],
  ['warmup_wally', 'warmup_wally', 'r1_rau_meat', 131, 'deathmatch warmup, then ranked', 'English'],
  ['fizzwick', 'Fizzwick', 'r3_zxc_k0t', 98, 'grinding to Ascendant', 'English'],
  ['tidepool', 'tidepool', 'r1_alexfr1x', 76, 'ranked + chill', 'Nederlands'],
  ['mosslight', 'Mosslight', 'r1_bakamarimmo', 54, 'late night games', 'English']
].map(([login, name, preview, viewers, title, tag]) => ({ login, name, preview, viewers, title, tag }));
const SIDEBAR = [
  { login: 'pixelharbor', name: 'PixelHarbor', game: 'VALORANT', viewers: 1240 },
  { login: 'bakeryhours', name: 'BakeryHours', game: 'Just Chatting', viewers: 3120 },
  { login: 'quietpeak', name: 'QuietPeak', game: 'VALORANT', viewers: 388 },
  { login: 'lunarlurk', name: 'LunarLurk', game: 'VALORANT', viewers: 247 },
  { login: 'trailmixtv', name: 'TrailmixTV', game: 'Minecraft', viewers: 512 }
];
const PREVIEW_OF = new Map(CHANNELS.map(c => [c.login, c.preview]));
const CHANNEL = 'mintyaim';   // the channel page shown with the toolbar popup
const FAVORITES = ['jett', 'clove'];
const COLORS = ['#9147ff', '#00a3a3', '#e05e2f', '#2f7be0', '#c2468b', '#4a9b3f', '#b8860b', '#6b5bd2'];

// Twitch-like wording around the extension, per language.
const STAGE = {
  en: { viewers: 'viewers', live: 'LIVE', followed: 'Followed channels', tabs: ['Live channels', 'Videos', 'Clips'], search: 'Search', nav: ['Following', 'Browse'], followers: '2.1M followers', tags: ['Shooter', 'FPS'], follow: 'Follow' },
  nl: { viewers: 'kijkers', live: 'LIVE', followed: 'Gevolgde kanalen', tabs: ['Livekanalen', "Video's", 'Clips'], search: 'Zoeken', nav: ['Volgend', 'Bladeren'], followers: '2,1 mln. volgers', tags: ['Shooter', 'FPS'], follow: 'Volgen' },
  de: { viewers: 'Zuschauer', live: 'LIVE', followed: 'Gefolgte Kanäle', tabs: ['Live-Kanäle', 'Videos', 'Clips'], search: 'Suchen', nav: ['Folge ich', 'Durchsuchen'], followers: '2,1 Mio. Follower', tags: ['Shooter', 'FPS'], follow: 'Folgen' },
  es: { viewers: 'espectadores', live: 'EN DIRECTO', followed: 'Canales seguidos', tabs: ['Canales en directo', 'Vídeos', 'Clips'], search: 'Buscar', nav: ['Siguiendo', 'Explorar'], followers: '2,1 M seguidores', tags: ['Shooter', 'FPS'], follow: 'Seguir' },
  pt_BR: { viewers: 'espectadores', live: 'AO VIVO', followed: 'Canais seguidos', tabs: ['Canais ao vivo', 'Vídeos', 'Clipes'], search: 'Buscar', nav: ['Seguindo', 'Navegar'], followers: '2,1 mi seguidores', tags: ['Tiro', 'FPS'], follow: 'Seguir' }
};
const viewerText = (n, lang) => {
  if (n < 1000) return `${n} ${STAGE[lang].viewers}`;
  const k = (Math.round(n / 100) / 10).toString();
  if (lang === 'en') return `${k}K ${STAGE.en.viewers}`;
  if (lang === 'nl') return `${k.replace('.', ',')}K ${STAGE.nl.viewers}`;
  if (lang === 'de') return `${n.toLocaleString('de-DE')} ${STAGE.de.viewers}`;
  return `${k.replace('.', ',')} mil ${STAGE[lang].viewers}`;
};

// Store screenshot captions. Kept short and plain, and without Riot names (Riot's fan-content policy, section 5).
const CAPTIONS = {
  en: ['See which agent every streamer is playing, right on the card', 'Filter by role or agent, with a count for each', 'Hover a card for both teams’ agents and the round score', 'No agent in sight? The card says why', 'Check what the stream you’re watching is playing'],
  nl: ['Zie direct op de kaart welke agent elke streamer speelt', 'Filter op rol of agent, met een telling per agent', 'Wijs een kaart aan voor de agents van beide teams en de stand', 'Geen agent te zien? De kaart zegt waarom', 'Zie wat de stream waar je naar kijkt nu speelt'],
  de: ['Sieh direkt auf der Karte, welchen Agenten jeder Streamer spielt', 'Filtere nach Rolle oder Agent, jeweils mit Anzahl', 'Fahr mit der Maus über eine Karte: beide Teams und der Stand', 'Kein Agent zu sehen? Die Karte sagt, warum', 'Sieh, was der Stream, den du schaust, gerade spielt'],
  es: ['Mira qué agente juega cada streamer, en su propia tarjeta', 'Filtra por rol o agente, con el número de cada uno', 'Pasa el ratón por una tarjeta para ver ambos equipos y el marcador', '¿No se ve ningún agente? La tarjeta dice por qué', 'Mira a qué juega el stream que estás viendo'],
  pt_BR: ['Veja qual agente cada streamer está jogando, direto no card', 'Filtre por função ou agente, com a contagem de cada um', 'Passe o mouse num card para ver os dois times e o placar', 'Nenhum agente à vista? O card diz por quê', 'Veja o que a live que você está assistindo está jogando']
};
const SHOT_NAMES = ['1-agents', '2-filter', '3-teams', '4-why', '5-popup'];
const STAGE_SHOT = path.join(os.tmpdir(), 'agent-lens-store-stage-en.png');   // the marquee's picture of the directory

const LENS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#ff4655" stroke-width="2.4"/><path d="M12 6.8 17.2 12 12 17.2 6.8 12Z" fill="#ff4655"/></svg>';
const fontData = file => 'data:font/woff2;base64,' + fs.readFileSync(path.join(SOURCE, 'fonts', file)).toString('base64');
const FONT_CSS = fs.readFileSync(path.join(SOURCE, 'fonts.css'), 'utf8')
  .replace('url(fonts/inter-latin-ext-wght-normal.woff2)', `url(${fontData('inter-latin-ext-wght-normal.woff2')})`)
  .replace('url(fonts/inter-latin-wght-normal.woff2)', `url(${fontData('inter-latin-wght-normal.woff2')})`);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const avatarUrl = login => `https://static-cdn.jtvnw.net/jtv_user_pictures/stage-${login}.svg`;
function avatarSvg(login) {
  const name = (CHANNELS.find(c => c.login === login) || SIDEBAR.find(c => c.login === login) || { name: login }).name;
  const color = COLORS[[...login].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/><text x="32" y="42" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#fff" text-anchor="middle">${esc(name[0].toUpperCase())}</text></svg>`;
}

// ---------- the stage ----------
const STAGE_CSS = `
${FONT_CSS}
html{--bg:#0e0e10;--bg2:#18181b;--side:#1f1f23;--text:#efeff1;--muted:#adadb8;--tag:#2f2f35;--line:#2a2a2e;--accent:#bf94ff}
html.tw-root--theme-light{--bg:#f7f7f8;--bg2:#ffffff;--side:#efeff1;--text:#0e0e10;--muted:#53535f;--tag:#e6e6ea;--line:#dedee3;--accent:#772ce8}
html{scrollbar-width:none} ::-webkit-scrollbar{display:none} *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 Inter,sans-serif}
.topnav{position:fixed;top:0;left:0;right:0;height:50px;z-index:5;display:flex;align-items:center;gap:22px;padding:0 20px;background:var(--bg2);box-shadow:0 1px 2px rgba(0,0,0,.4)}
.topnav b{font-size:17px;font-weight:600} .topnav .search{margin:0 auto;width:380px;height:36px;border-radius:6px;background:var(--side);color:var(--muted);display:flex;align-items:center;padding:0 12px;font-size:14px}
.topnav .me{width:30px;height:30px;border-radius:50%;background:#e05e2f}
#root{display:flex;padding-top:50px}
#side-nav{position:fixed;top:50px;bottom:0;left:0;width:240px;background:var(--side);padding:10px 0;overflow:hidden}
#side-nav h5{margin:4px 10px 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.2px}
.side-nav-card>a{display:flex;align-items:center;gap:10px;padding:5px 10px;text-decoration:none;color:inherit}
.side-nav-card__avatar{position:relative;width:30px;height:30px;flex:none} .side-nav-card__avatar img{width:30px;height:30px;border-radius:50%;display:block}
.side-nav-card__metadata{flex:1;min-width:0} .side-nav-card__metadata [data-a-target="side-nav-title"]{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.side-nav-card__metadata p{margin:0;color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-a-target="side-nav-live-status"]{display:flex;align-items:center;gap:5px;font-size:13px;white-space:nowrap} [data-a-target="side-nav-live-status"]::before{content:"";width:8px;height:8px;border-radius:50%;background:#eb0400}
main{margin-left:240px;flex:1;min-width:0;padding:26px 30px 40px;min-height:1800px}
.dir-head h1{margin:0;font-size:36px;font-weight:700;letter-spacing:-.5px} .dir-head .stats{margin:4px 0 0;color:var(--muted);font-size:14px}
.chips{display:flex;gap:6px;margin:8px 0 0} .tw-tag{border:0;border-radius:9999px;background:var(--tag);color:var(--text);font:600 12px Inter,sans-serif;padding:3px 9px}
.dir-tabs{display:flex;gap:22px;margin:18px 0 14px;border-bottom:1px solid var(--line);font-size:15px;font-weight:600}
.dir-tabs span{padding:8px 0;color:var(--muted)} .dir-tabs span:first-child{color:var(--accent);box-shadow:inset 0 -2px var(--accent)}
.tw-tower{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px 10px}
article{min-width:0} .preview-card-image-link{position:relative;display:block;aspect-ratio:16/9;border-radius:0;overflow:hidden;background:#26262c}
.preview-card-image-link img{display:block;width:100%;height:100%;object-fit:cover}
.live{position:absolute;top:10px;left:10px;background:#eb0400;color:#fff;font-weight:600;font-size:13px;padding:0 5px;border-radius:4px;text-transform:uppercase}
.tw-media-card-stat{position:absolute;bottom:10px;left:10px;background:rgba(0,0,0,.6);color:#fff;font-size:13px;padding:0 4px;border-radius:2px}
.meta{display:flex;gap:10px;margin-top:9px} .meta>img{width:40px;height:40px;border-radius:50%;flex:none}
.meta .text{min-width:0;flex:1} .meta a{color:inherit;text-decoration:none}
.meta h4{margin:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .meta p{margin:1px 0 4px;color:var(--muted);font-size:13px}
.player{position:relative;aspect-ratio:16/9;max-height:470px;background:#000;display:flex;justify-content:center} .player img{height:100%;display:block}
.channel-info-content{display:flex;gap:12px;align-items:flex-start;margin-top:16px} .channel-info-content>img{width:64px;height:64px;border-radius:50%;box-shadow:0 0 0 3px #eb0400}
.channel-info-content h1{margin:0;font-size:20px;font-weight:700} .channel-info-content p{margin:2px 0;font-size:14px}
.channel-info-content a{color:var(--accent);text-decoration:none;font-weight:600;font-size:14px}
.follow{margin-left:auto;background:#9147ff;color:#fff;border-radius:4px;padding:6px 14px;font-weight:600;font-size:13px}
.al-tooltip{position:fixed;z-index:20;background:#fff;color:#000;border:1px solid #767676;padding:3px 7px;font:12px/1.45 "Segoe UI",system-ui,sans-serif;white-space:pre-line;box-shadow:1px 2px 4px rgba(0,0,0,.35);max-width:420px}
`;
function frame(lang, theme, main, title = 'Twitch') {
  const s = STAGE[lang];
  const side = SIDEBAR.map(c => `<div class="side-nav-card"><a href="/${c.login}"><div class="side-nav-card__avatar"><img src="${avatarUrl(c.login)}" alt=""></div>
    <div class="side-nav-card__metadata"><div data-a-target="side-nav-title">${esc(c.name)}</div><p data-a-target="side-nav-game-title">${esc(c.game)}</p></div>
    <span data-a-target="side-nav-live-status">${esc(viewerText(c.viewers, lang).replace(' ' + s.viewers, ''))}</span></a></div>`).join('');
  return `<!doctype html><html class="tw-root--theme-${theme}" lang="${lang.replace('_', '-')}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STAGE_CSS}</style></head>
<body><div class="topnav"><b>${esc(s.nav[0])}</b><b>${esc(s.nav[1])}</b><div class="search">${esc(s.search)}</div><div class="me"></div></div>
<div id="root"><nav id="side-nav"><h5>${esc(s.followed)}</h5>${side}</nav>${main}</div></body></html>`;
}
function directoryPage(lang, theme) {
  const s = STAGE[lang];
  const cards = CHANNELS.map(c => `<div class="cell"><article>
    <a data-a-target="preview-card-image-link" class="preview-card-image-link" href="/${c.login}"><img alt="${esc(c.title)} - ${c.login}" src="https://static-cdn.jtvnw.net/previews-ttv/live_user_${c.login}-440x248.jpg">
      <div class="live">${esc(s.live)}</div><div class="tw-media-card-stat">${esc(viewerText(c.viewers, lang))}</div></a>
    <div class="meta"><img src="${avatarUrl(c.login)}" alt=""><div class="text"><a data-a-target="preview-card-channel-link" href="/${c.login}"><h4 title="${esc(c.title)}">${esc(c.title)}</h4><p title="${esc(c.name)}">${esc(c.name)}</p></a>
      <button class="tw-tag">${esc(c.tag)}</button></div></div></article></div>`).join('');
  const main = `<main><div class="dir-head"><h1>VALORANT</h1><p class="stats">${esc(viewerText(198400, lang))} · ${esc(s.followers)}</p>
    <div class="chips">${s.tags.map(t => `<button class="tw-tag">${esc(t)}</button>`).join('')}</div></div>
    <div class="dir-tabs">${s.tabs.map(t => `<span>${esc(t)}</span>`).join('')}</div>
    <div class="tw-tower">${cards}</div></main>`;
  return frame(lang, theme, main);
}
function channelPage(lang, theme, login) {
  const c = CHANNELS.find(ch => ch.login === login), s = STAGE[lang];
  const main = `<main><div class="player"><img src="https://static-cdn.jtvnw.net/previews-ttv/live_user_${c.login}-1280x720.jpg" alt=""></div>
    <div class="channel-info-content"><img src="${avatarUrl(c.login)}" alt=""><div><h1>${esc(c.name)}</h1><p>${esc(c.title)}</p>
      <a data-a-target="stream-game-link" href="/directory/category/valorant">VALORANT</a> <button class="tw-tag">${esc(c.tag)}</button></div>
      <span class="follow">${esc(s.follow)}</span></div></main>`;
  return frame(lang, theme, main, `${c.name} - Twitch`);
}

// ---------- the extension, fed from a local preview server ----------
const PREVIEW_HOST = 'https://static-cdn.jtvnw.net/previews-ttv/live_user_';
const previewFile = login => PREVIEW_OF.has(login) ? path.join(ROOT, 'tests/fixtures/previews', PREVIEW_OF.get(login) + '.jpg') : null;
const server = http.createServer((req, res) => {
  const m = /^\/previews-ttv\/live_user_([a-z0-9_]+)-\d+x\d+\.jpg/.exec(req.url);
  const file = m && previewFile(m[1]);
  if (file) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(fs.readFileSync(file)); }
  res.writeHead(404); res.end();
});
function prepareExtension(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-store-ext-'));
  fs.cpSync(SOURCE, dir, { recursive: true });
  const bg = path.join(dir, 'background.js'), code = fs.readFileSync(bg, 'utf8');
  if (!code.includes(PREVIEW_HOST)) throw new Error('preview URL not found in background.js');
  fs.writeFileSync(bg, code.replace(PREVIEW_HOST, `http://127.0.0.1:${port}/previews-ttv/live_user_`));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}
async function launch(ext, lang) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'al-store-profile-')), {
    headless: false, executablePath: process.env.CHROMIUM_PATH || undefined, viewport: { width: W, height: STAGE_H }, deviceScaleFactor: 1, colorScheme: 'dark',
    locale: lang.replace('_', '-'), args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--lang=${lang.replace('_', '-')}`]
  });
  const state = { theme: 'dark' };
  await ctx.route('https://www.twitch.tv/**', route => {
    if (route.request().resourceType() !== 'document') return route.abort();
    const { pathname } = new URL(route.request().url());
    const body = pathname.startsWith('/directory/category/valorant') ? directoryPage(lang, state.theme) : channelPage(lang, state.theme, CHANNEL);
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  await ctx.route('https://static-cdn.jtvnw.net/**', route => {
    const url = route.request().url();
    const avatar = /jtv_user_pictures\/stage-([a-z0-9_]+)\.svg$/.exec(url);
    if (avatar) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: avatarSvg(avatar[1]) });
    const preview = /previews-ttv\/live_user_([a-z0-9_]+)-/.exec(url), file = preview && previewFile(preview[1]);
    return file ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(file) }) : route.fulfill({ status: 404, body: '' });
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  return { ctx, sw, id: new URL(sw.url()).host, state };
}
// Waits until every card is read: no "reading" marker left, the same for two looks in a row.
async function waitRead(tab, ms = 90000) {
  const end = Date.now() + ms; let last = '';
  while (Date.now() < end) {
    const now = await tab.evaluate(() => JSON.stringify([...document.querySelectorAll('agent-lens[data-al-kind="card"]')].map(h => h.shadowRoot.querySelector('.reading') ? 'r' : h.shadowRoot.textContent)));
    if (!now.includes('"r"') && now === last && JSON.parse(now).filter(Boolean).length >= 8) return JSON.parse(now);
    last = now; await tab.waitForTimeout(1000);
  }
  throw new Error('cards were not read in time: ' + last);
}
// Scrolls so the Agent Lens bar sits just under the top bar, with as many cards below it as fit.
const toBar = tab => tab.evaluate(() => { const bar = document.querySelector('agent-lens[data-al-kind="bar"]'); scrollTo(0, bar.getBoundingClientRect().top + scrollY - 66); });
async function tooltip(tab, login) {
  // The badge's tooltip is the browser's own (a title attribute), which screenshots don't show; draw it the same way.
  await tab.evaluate(login => {
    const host = document.querySelector(`article a[href="/${login}"]`).closest('article').querySelector('agent-lens[data-al-kind="card"]');
    const badge = host.shadowRoot.querySelector('.badge'), box = badge.getBoundingClientRect();
    const tip = document.createElement('div'); tip.className = 'al-tooltip'; tip.textContent = badge.getAttribute('title');
    document.body.append(tip);
    tip.style.left = Math.min(box.left + 14, innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = (box.bottom + 18) + 'px';
  }, login);
}

// ---------- composing the final images ----------
async function render(page, file, width, height, html) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true });
}
const dataUrl = buffer => 'data:image/png;base64,' + buffer.toString('base64');
function shotHtml(caption, image, popup) {
  return `<!doctype html><meta charset="utf-8"><style>${FONT_CSS}
  body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#0e0e10;font-family:Inter,sans-serif}
  .cap{height:${CAPTION}px;display:flex;align-items:center;gap:14px;padding:0 28px;background:#141417;color:#fff;font-size:24px;font-weight:650;letter-spacing:-.2px;border-bottom:2px solid #ff4655}
  .cap svg{width:30px;height:30px;flex:none} .stage{position:relative;height:${STAGE_H}px}
  .stage>img{display:block} .popup{position:absolute;top:6px;right:18px;box-shadow:0 8px 28px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08)}
  </style><div class="cap">${LENS}<span>${esc(caption)}</span></div>
  <div class="stage"><img src="${dataUrl(image)}">${popup ? `<img class="popup" src="${dataUrl(popup)}">` : ''}</div>`;
}

async function screenshots(lang, browserForCompose) {
  const ext = prepareExtension(server.address().port);
  const { ctx, sw, id, state } = await launch(ext, lang);
  try {
    // The extension writes its defaults on first run; wait for that, or it can overwrite the settings set here.
    await sw.evaluate(async () => { for (let i = 0; i < 50 && !(await chrome.storage.local.get('agentLensSettings')).agentLensSettings; i++) await new Promise(r => setTimeout(r, 100)); });
    await sw.evaluate(favorites => chrome.storage.local.set({ agentLensSettings: { badges: true, scores: true, sidebar: true, quality: 'high', favorites, minViewers: 0 } }), FAVORITES);
    const tab = ctx.pages()[0] || await ctx.newPage();
    await tab.goto('https://www.twitch.tv/directory/category/valorant');
    await tab.waitForSelector('agent-lens[data-al-kind="bar"]', { timeout: 30000 });
    const read = await waitRead(tab);
    await toBar(tab); await tab.waitForTimeout(400);
    const raw = [];
    raw.push(await tab.screenshot());                                                              // 1: badges

    await tab.locator('agent-lens[data-al-kind="bar"] .chip', { hasText: msg('roleDuelist', lang) }).click();
    await tab.waitForTimeout(800); await toBar(tab); await tab.waitForTimeout(300);
    raw.push(await tab.screenshot());                                                              // 2: role filter
    await tab.locator('agent-lens[data-al-kind="bar"] .chip', { hasText: msg('roleDuelist', lang) }).click();

    state.theme = 'light';
    await tab.reload(); await waitRead(tab);
    await toBar(tab); await tab.waitForTimeout(400);
    await tooltip(tab, 'mintyaim');
    raw.push(await tab.screenshot());                                                              // 3: teams tooltip, light theme
    state.theme = 'dark';
    await tab.reload(); await waitRead(tab);
    await tab.evaluate(() => { const row = document.querySelectorAll('.tw-tower .cell')[8]; scrollTo(0, row.getBoundingClientRect().top + scrollY - 330); });
    await tab.waitForTimeout(500);
    raw.push(await tab.screenshot());                                                              // 4: status pills

    await tab.goto(`https://www.twitch.tv/${CHANNEL}`);
    await tab.waitForTimeout(1500);
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 372, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await tab.bringToFront(); await popup.evaluate(() => location.reload());
    await popup.waitForFunction(name => document.getElementById('tab').textContent.includes(name), CHANNELS.find(c => c.login === CHANNEL).name, { timeout: 30000 });
    await popup.waitForTimeout(500);
    // Chrome caps a toolbar popup at 600 px high and scrolls the rest.
    await popup.addStyleTag({ content: 'html{scrollbar-width:none} ::-webkit-scrollbar{display:none}' });
    const popupHeight = Math.min(600, await popup.evaluate(() => document.documentElement.scrollHeight));
    await popup.setViewportSize({ width: 372, height: popupHeight });
    const popupShot = await popup.screenshot();
    raw.push(await tab.screenshot());                                                              // 5: channel page + popup

    const compose = await browserForCompose.newPage();
    for (let i = 0; i < raw.length; i++) {
      await render(compose, path.join(OUT, lang, SHOT_NAMES[i] + '.png'), W, H, shotHtml(CAPTIONS[lang][i], raw[i], i === 4 ? popupShot : null));
      if (lang === 'en') await compose.screenshot({ path: path.join(DOCS_IMG, SHOT_NAMES[i] + '.jpg'), type: 'jpeg', quality: 82 });
    }
    await compose.close();
    if (lang === 'en') fs.writeFileSync(STAGE_SHOT, raw[0]);
    return read;
  } finally {
    await ctx.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
}

// ---------- promo images (Chrome can't localize these, so English with very little text) ----------
function smallTileHtml() {
  return `<!doctype html><meta charset="utf-8"><style>${FONT_CSS}
  body{margin:0;width:440px;height:280px;overflow:hidden;font-family:Inter,sans-serif;color:#fff;
    background:radial-gradient(circle at 18% 30%,#3a1820 0,#16161a 55%,#0e0e10 100%)}
  .wrap{display:flex;align-items:center;gap:22px;padding:0 34px;height:205px} svg{width:96px;height:96px;flex:none}
  h1{margin:0;font-size:44px;font-weight:750;letter-spacing:-1px;line-height:1} p{margin:10px 0 0;font-size:19px;color:#d3d3d9;font-weight:500;line-height:1.25}
  .row{display:flex;gap:8px;padding:0 34px}
  .pill{display:flex;align-items:center;gap:7px;height:30px;padding:0 12px 0 6px;border-radius:15px;background:rgba(14,14,16,.85);box-shadow:0 0 0 1px rgba(255,255,255,.14);font-size:15px;font-weight:650}
  .dot{width:20px;height:20px;border-radius:50%;background:#ff4655} .dot.b{background:#00b2a9} .dot.c{background:#8a63ff}
  .score{padding-left:7px;border-left:1px solid rgba(255,255,255,.3);color:#ffd37a}
  </style><div class="wrap">${LENS}<div><h1>Agent Lens</h1><p>See the agent on<br>every stream</p></div></div>
  <div class="row"><span class="pill"><span class="dot"></span><span class="score">11–9</span></span><span class="pill"><span class="dot b"></span><span class="score">5–7</span></span><span class="pill"><span class="dot c"></span><span class="score">8–8</span></span></div>`;
}
// Edge asks for a store logo of at least 300x300; drawn like the extension icon, so it stays sharp.
function logoHtml() {
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;width:300px;height:300px;background:transparent}
  div{width:300px;height:300px;border-radius:66px;background:#18181b;display:grid;place-items:center} svg{width:236px;height:236px}</style><div>${LENS}</div>`;
}
function marqueeHtml(stage) {
  return `<!doctype html><meta charset="utf-8"><style>${FONT_CSS}
  body{margin:0;width:1400px;height:560px;overflow:hidden;font-family:Inter,sans-serif;color:#fff;
    background:radial-gradient(circle at 12% 20%,#3a1820 0,#16161a 45%,#0e0e10 100%)}
  .text{position:absolute;left:72px;top:0;bottom:0;width:480px;display:flex;flex-direction:column;justify-content:center}
  .brand{display:flex;align-items:center;gap:20px} svg{width:78px;height:78px} h1{margin:0;font-size:68px;font-weight:750;letter-spacing:-1.5px}
  p{margin:22px 0 0;font-size:30px;line-height:1.3;color:#e6e6ea;font-weight:500}
  ul{list-style:none;padding:0;margin:28px 0 0;display:flex;flex-wrap:wrap;gap:10px}
  li{padding:7px 14px;border-radius:18px;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);font-size:17px;font-weight:600}
  .shot{position:absolute;left:600px;top:88px;width:860px;height:384px;border-radius:12px;overflow:hidden;box-shadow:0 22px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.1)}
  .shot img{position:absolute;left:-215px;top:-48px;width:1050px}
  </style><div class="text"><div class="brand">${LENS}<h1>Agent Lens</h1></div>
  <p>See which agent every streamer is playing, right on Twitch.</p>
  <ul><li>Filter by role or agent</li><li>Round score</li><li>Runs on your computer</li></ul></div>
  <div class="shot"><img src="${dataUrl(stage)}"></div>`;
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.mkdirSync(path.join(OUT, 'promo'), { recursive: true });
  fs.mkdirSync(DOCS_IMG, { recursive: true });
  const composer = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const lang of LANGS) {
      if (!STAGE[lang]) throw new Error('unknown language ' + lang);
      const read = await screenshots(lang, composer);
      console.log(`${lang}: 5 screenshots; cards read as ${read.map(r => r || '-').join(' | ')}`);
    }
    if (!process.argv.includes('--skip-promo')) {
      const stage = STAGE_SHOT;
      if (!fs.existsSync(stage)) throw new Error('run with English first: the marquee uses its first screenshot');
      const page = await composer.newPage();
      await render(page, path.join(OUT, 'promo', 'small-tile-440x280.png'), 440, 280, smallTileHtml());
      await render(page, path.join(OUT, 'promo', 'marquee-1400x560.png'), 1400, 560, marqueeHtml(fs.readFileSync(stage)));
      await page.screenshot({ path: path.join(DOCS_IMG, 'marquee.jpg'), type: 'jpeg', quality: 85 });
      fs.copyFileSync(path.join(SOURCE, 'icons', 'icon-128.png'), path.join(DOCS_IMG, 'icon-128.png'));
      await render(page, path.join(OUT, 'promo', 'logo-300x300.png'), 300, 300, logoHtml());
      console.log('promo: small tile, marquee and 300x300 logo');
    }
  } finally {
    await composer.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
