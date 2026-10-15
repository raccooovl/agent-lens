// Agent Lens service worker: fetches the public preview image of Valorant streams you can see on Twitch,
// reads the agent (and round score) from it on this computer, and tells the Twitch tab.
'use strict';
importScripts('detector.js');

const SETTINGS_KEY = 'agentLensSettings';
const CACHE_KEY = 'agentLensResults';
const DEFAULTS = { badges: true, scores: true, sidebar: true, quality: 'high', favorites: [], minViewers: 0 };
const RECHECK_MS = 4.5 * 60 * 1000;      // Twitch refreshes preview images about every five minutes
const KEEP_AGENT_MS = 45 * 60 * 1000;    // an agent stays the same for a whole match
const RETRY_ERROR_MS = 60 * 1000;
const RETRY_NONE_MS = 60 * 1000;         // no ability bar in the frame (dead, between rounds): look again soon
const FRAME_MS = 5 * 60 * 1000;          // how long Twitch's CDN keeps one preview frame per size
// Twitch's CDN keeps a separate frame for every image size, each taken at a different moment. When one frame
// shows no ability bar (the streamer is dead, in the buy phase screen, a replay...), another size often does.
// 1280x720 first: the agent reads as well there (97.8% vs 98.3% on the labelled set, never wrong) at half the
// data. Full HD comes second, when the first picture shows no clear own bar or (sharper previews on) no score.
const FRAME_SIZES = { high: ['1280x720', '1920x1080', '1600x900'], standard: ['1280x720', '1152x648'] };
const FRAMES_PER_CHECK = 2;
const STATE_SELECT = 0.58, STATE_MENU = 0.62;
// Quick check: a 640x360 picture (about 45 KB) first for streams whose agent isn't known. On 95 same-moment
// pairs it agreed with full HD on menus, agent select and broadcasts every time, and on the agent 94 times
// (never another agent); scores and the combat report need the bigger pictures.
const QUICK = '640x360';
// Back-off: streams showing no match (menus, other content, a broadcast) are looked at less and less often.
const IDLE_MAX_MS = 15 * 60 * 1000;   // icon-row scores: game screens stay below 0.41, these screens reach 0.62-1
const FETCH_CONCURRENCY = 3;
const LOGIN = /^[a-z0-9_]{1,25}$/;

let engine = null;
const engineReady = (async () => {
  const url = path => chrome.runtime.getURL(path);
  const [meta, bin, portraits, digits, states] = await Promise.all([
    fetch(url('data/agents.json')).then(r => r.json()),
    fetch(url('data/icons.bin')).then(r => r.arrayBuffer()),
    fetch(url('data/portraits.bin')).then(r => r.arrayBuffer()),
    fetch(url('data/digits.json')).then(r => r.json()),
    fetch(url('data/states.json')).then(r => r.json())
  ]);
  // The WebAssembly kernel makes matching about four times faster; without it the same work runs in JavaScript.
  let kernel = null;
  try {
    const bytes = await fetch(url('data/kernel.wasm')).then(r => r.arrayBuffer());
    kernel = (await WebAssembly.instantiate(bytes, {})).instance.exports;
  } catch (_) { kernel = null; }
  engine = {
    kernel: Boolean(kernel),
    detector: AgentLensDetector.createDetector(meta, new Uint8Array(bin), { kernel }),
    spectate: AgentLensDetector.createSpectateCheck(meta, new Uint8Array(portraits)),
    score: AgentLensDetector.createScoreReader(digits),
    states: AgentLensDetector.createStateCheck(states),
    teams: AgentLensDetector.createTeamReader(meta, new Uint8Array(portraits)),
    agents: new Map(meta.agents.map(a => [a.id, a]))
  };
  return engine;
})();

// ---- Results, kept for the browser session only ----
const results = new Map();
let cacheLoaded = null, saveTimer = null;
function loadCache() {
  cacheLoaded ||= chrome.storage.session.get(CACHE_KEY).then(stored => {
    const now = Date.now();
    for (const [login, result] of Object.entries(stored[CACHE_KEY] || {})) {
      if (LOGIN.test(login) && result && now - result.checkedAt < KEEP_AGENT_MS) results.set(login, result);
    }
  }).catch(() => {});
  return cacheLoaded;
}
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const now = Date.now(), out = {};
    for (const [login, result] of results) if (now - result.checkedAt < KEEP_AGENT_MS) out[login] = result;
    chrome.storage.session.set({ [CACHE_KEY]: out }).catch(() => {});
  }, 500);
}
async function settings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULTS, ...(stored[SETTINGS_KEY] || {}) };
}

// ---- Queue ----
// Streams on screen first (in reading order), then a stream known to play one of your agents, then the rest.
// Work for a tab that closed, or that moved to another page, is dropped.
const queue = new Map();      // login -> { prio, seq, tabs: Set of tab ids }
const tabPage = new Map();    // tab id -> page it last asked from
let active = 0, seq = 0;
let detecting = Promise.resolve();
let favorites = new Set();
chrome.storage.local.get(SETTINGS_KEY).then(s => { favorites = new Set(((s[SETTINGS_KEY] || {}).favorites) || []); }).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) favorites = new Set(((changes[SETTINGS_KEY].newValue || {}).favorites) || []);
});

function fresh(result, now = Date.now()) {
  if (!result) return false;
  if (Number.isFinite(result.nextAt)) return now < result.nextAt;
  return now - result.checkedAt < (result.status === 'error' ? RETRY_ERROR_MS : RECHECK_MS);
}
function want(login, tabId, prio) {
  const known = results.get(login);
  if (known && known.agent && favorites.has(known.agent)) prio -= 0.5;
  const entry = queue.get(login);
  if (entry) { entry.prio = Math.min(entry.prio, prio); if (tabId !== undefined) entry.tabs.add(tabId); }
  else queue.set(login, { prio, seq: seq++, tabs: new Set(tabId !== undefined ? [tabId] : []) });
}
function forgetTab(tabId, keep = new Set()) {
  for (const [login, entry] of queue) {
    if (keep.has(login) || !entry.tabs.delete(tabId)) continue;
    if (!entry.tabs.size) queue.delete(login);
  }
}
chrome.tabs.onRemoved.addListener(tabId => { forgetTab(tabId); tabPage.delete(tabId); });
function next() {
  let best = null;
  for (const [login, e] of queue) if (!best || e.prio < best.e.prio || (e.prio === best.e.prio && e.seq < best.e.seq)) best = { login, e };
  if (best) queue.delete(best.login);
  return best;
}
function pump() {
  while (active < FETCH_CONCURRENCY && queue.size) {
    const { login, e } = next();
    active++;
    analyse(login, e.tabs).catch(() => {}).finally(() => { active--; pump(); });
  }
}

// A decoded preview. Its pixels are copied out of the canvas only for the parts a check reads (the ability
// bar, the score...), into buffers kept per picture size and reused (checks run one at a time).
async function decode(blob) {
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width, height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, height, ctx };
}
const pools = new Map();
function pixels(frame) {
  const { width, height, ctx } = frame, key = width + 'x' + height;
  if (!pools.has(key)) { if (pools.size > 3) pools.clear(); pools.set(key, { rgba: new Uint8ClampedArray(width * height * 4), gray: new Uint8Array(width * height) }); }
  const { rgba, gray } = pools.get(key), loaded = new Set();
  const kx = width / 1920, ky = height / 1080;
  function need(...names) {
    for (const name of names) {
      if (loaded.has(name)) continue;
      loaded.add(name);
      const [a, b, c, d] = AgentLensDetector.REGIONS[name];
      const x0 = Math.max(0, Math.floor(a * kx)), y0 = Math.max(0, Math.floor(b * ky));
      const x1 = Math.min(width, Math.ceil(c * kx)), y1 = Math.min(height, Math.ceil(d * ky));
      const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) continue;
      const data = ctx.getImageData(x0, y0, w, h).data;
      for (let y = 0; y < h; y++) {
        const src = y * w * 4, dst = ((y0 + y) * width + x0) * 4;
        rgba.set(data.subarray(src, src + w * 4), dst);
        for (let x = 0, j = src, i = (y0 + y) * width + x0; x < w; x++, j += 4, i++) gray[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000;
      }
    }
  }
  return { width, height, rgba, gray, need };
}

// Which agent the streamer plays: the one seen most often in this match (a player can't switch mid-match),
// so a preview taken while they spectate a teammate, if not recognised as such, doesn't win on its own.
// Sightings on a round-result or death screen (`weak`: the bar there may be a watched teammate's) only
// count when there are no others, and then only when two of them, taken at different moments, agree.
function ownAgent(sightings) {
  const strong = sightings.filter(s => !s.weak);
  const pool = strong.length ? strong : sightings;
  const counts = new Map();
  pool.forEach((s, i) => { const c = counts.get(s.agent) || { n: 0, last: -1 }; c.n++; c.last = i; counts.set(s.agent, c); });
  let best = null;
  for (const [agent, c] of counts) if (!best || c.n > best.n || (c.n === best.n && c.last > best.last)) best = { agent, ...c };
  if (!best) return null;
  if (!strong.length) {
    // Uncertain sightings only: need two of the same agent at least a minute apart (two image sizes
    // fetched fresh at the same moment can be the same snapshot).
    const times = sightings.filter(s => s.agent === best.agent).map(s => s.at);
    if (Math.max(...times) - Math.min(...times) < 60 * 1000) return null;
  }
  return best.agent;
}
// Both teams' agents over the match: dead players drop out of the top bar, so later pictures add to earlier
// ones. Left is the streamer's side of the top bar. A team can't hold more than five, or the same agent twice:
// if a newer picture disagrees that much, it wins.
function mergeComp(comp, team, at) {
  const side = (old, now) => {
    const seen = now.filter(Boolean);
    const merged = [...new Set([...seen, ...(old || [])])];
    return merged.length > 5 ? seen : merged;
  };
  const left = side(comp && comp.left, team.left), right = side(comp && comp.right, team.right);
  if (!left.length && !right.length) return comp;
  return { left, right, at: Math.max(at, comp ? comp.at : 0) };
}

// frames: what each preview frame read in this check showed, oldest first
// ({ decision, round, spectating, weak, screen, at }).
function nextResult(previous, frames, now) {
  let sightings = (previous && Array.isArray(previous.sightings) ? previous.sightings : []).filter(s => now - s.at < KEEP_AGENT_MS);
  let comp = previous && previous.comp && now - previous.comp.at < KEEP_AGENT_MS ? previous.comp : null;
  // Map and mode, from agent select (or a deathmatch clock), kept for that match.
  let match = previous && previous.match && now - previous.match.at < KEEP_AGENT_MS ? previous.match : null;
  for (const found of frames) {
    // Menus or agent select: the match the agent was seen in is over.
    if (found.screen === 'menu' || found.screen === 'select' || found.screen === 'broadcast') {
      sightings = sightings.filter(s => s.at > found.at);
      if (comp && comp.at < found.at) comp = null;
      // Agent select pictures from the last few minutes (two image sizes) add up; anything else is the old match.
      const sameSelect = match && match.select && found.screen === 'select' && found.at - match.at < 3 * 60 * 1000;
      if (match && match.at < found.at && !sameSelect) match = null;
      if (found.screen === 'select' && (found.map || found.mode || sameSelect)) {
        match = { map: found.map || (sameSelect ? match.map : null), mode: found.mode || (sameSelect ? match.mode : null), at: Math.max(found.at, match ? match.at : 0), select: true };
      }
      continue;
    }
    const round = found.round ? found.round.left + found.round.right : null;
    const lastRound = [...sightings].reverse().find(s => s.round !== null);
    if (round !== null && lastRound && round < lastRound.round && found.at >= lastRound.at) {   // a new match started
      sightings = []; comp = null;
      if (match && match.at < lastRound.at) match = null;
    }
    if (found.team) comp = mergeComp(comp, found.team, found.at);
    if (found.mode === 'deathmatch') match = { map: match ? match.map : null, mode: 'deathmatch', at: Math.max(found.at, match ? match.at : 0) };
    if (match && match.select) match = { ...match, select: false };   // in the match now: agent select is over
    if (found.decision && !found.spectating) {
      const sighting = { agent: found.decision.agent, at: found.at, round, ...(found.weak ? { weak: true } : {}) };
      sightings = [...sightings, sighting].sort((a, b) => a.at - b.at).slice(-12);
    }
  }
  const agent = ownAgent(sightings);
  // Show the most telling frame: the streamer's own bar, then spectating, then an uncertain bar, then the newest.
  const strong = f => f.decision && !f.spectating && !f.weak;
  const shown = frames.find(strong) || frames.find(f => f.decision && f.spectating)
    || frames.find(f => f.decision) || frames[frames.length - 1] || {};
  const seenAt = agent ? Math.max(...sightings.filter(s => s.agent === agent).map(s => s.at)) : undefined;
  // The newest readable score (the full-HD picture may have been read just for it).
  const scored = [...frames].reverse().find(f => f.round);
  const score = shown.round || (scored || {}).round || null;
  const scoreAt = shown.round ? shown.at : scored ? scored.at : undefined;
  const base = { checkedAt: now, sightings, ...(agent ? { agent, seenAt } : {}), ...(shown.screen ? { screen: shown.screen } : {}),
    ...(comp ? { comp } : {}), ...(score ? { scoreAt } : {}), ...(match ? { match } : {}) };
  if (shown.decision && shown.spectating) return { ...base, status: 'spectating', watching: shown.decision.agent, score };
  if (shown.decision && !shown.weak) return { ...base, status: 'agent', score };
  if (shown.decision) {
    // A bar on a round-result or death screen: the streamer's own agent if it matches, else probably
    // the teammate they're watching.
    if (agent === shown.decision.agent) return { ...base, status: 'agent', score };
    if (agent) return { ...base, status: 'spectating', watching: shown.decision.agent, score };
    return { ...base, status: 'maybe', maybe: shown.decision.agent, score };      // shown with a question mark
  }
  return agent ? { ...base, status: 'earlier', score } : { ...base, status: 'none', score };
}

// Seconds the CDN will keep serving this frame (max-age minus age), so we know when a new one is out.
function frameLeftMs(response) {
  const maxAge = Number((/max-age=(\d+)/.exec(response.headers.get('cache-control') || '') || [])[1]);
  const age = Number(response.headers.get('age')) || 0;
  const left = Number.isFinite(maxAge) && maxAge > 0 ? (maxAge - age) * 1000 : FRAME_MS;
  return Math.min(FRAME_MS, Math.max(0, left));
}

// What one preview shows. Screens: 'select' (agent select), 'menu', 'dead' (combat report),
// 'roundEnd' (round won/lost banner), 'buy' (buy phase banner).
function read(engine, frame, triage = false) {
  const { detector, spectate, score, states, teams } = engine;
  // One detection at a time: each one is tens of milliseconds of work.
  const job = detecting.then(() => {
    const { width, height, rgba, gray, need } = pixels(frame);
    // An official broadcast (VCT...): the ability bar there is the observed player's, not the streamer's.
    need('cardsL', 'cardsR');
    if (states.broadcast(rgba, width, height)) return { decision: null, round: null, screen: 'broadcast' };
    need('band');
    const decision = detector.decide(detector.detect(gray, width, height));
    // Both teams' agents from the portraits at the top; only read in a match.
    const comp = layout => { need('team'); const t = teams.read(gray, width, height, layout); return { left: t.left.map(x => x && x.agent), right: t.right.map(x => x && x.agent) }; };
    // In the buy phase everyone is alive, even with last round's combat report still open.
    const screenOf = (banner, dead) => (banner && banner.kind === 'buy' ? 'buy' : dead ? 'dead' : banner ? 'roundEnd' : null);
    if (decision) {
      need('score', 'spectate', 'banner', 'dead');
      const round = score.read(rgba, width, height, decision.layout);
      const spectating = spectate.check(gray, width, height, decision.agent, decision.layout).spectating;
      const banner = states.banner(rgba, width, height), dead = states.dead(rgba, width, height);
      // A bar under a round result, or with the combat report open outside the buy phase, may be a watched teammate's.
      const buy = Boolean(banner && banner.kind === 'buy');
      const weak = !spectating && !buy && Boolean(dead || banner);
      const long = score.minutes(rgba, width, height, decision.layout);
      return { decision, round, spectating, weak, screen: screenOf(banner, dead), team: comp(decision.layout), ...(long >= 2 ? { mode: 'deathmatch' } : {}) };
    }
    need('menu');
    if (states.iconRow(gray, width, height, 'menu') >= STATE_MENU) return { decision: null, round: null, screen: 'menu' };
    need('select');
    if (states.iconRow(gray, width, height, 'select') >= STATE_SELECT) {
      // The map and mode written above the agent grid, when recognised.
      const { map, mode } = states.readSelect(rgba, gray, width, height);
      return { decision: null, round: null, screen: 'select', ...(map ? { map } : {}), ...(mode ? { mode } : {}) };
    }
    need('dead', 'banner', 'score');
    // Deathmatch: no ability bar, and a match clock of several minutes.
    const long = score.minutes(rgba, width, height, null);
    if (long >= 2) return { decision: null, round: null, screen: 'deathmatch', mode: 'deathmatch' };
    const screen = screenOf(states.banner(rgba, width, height), states.dead(rgba, width, height));
    if (!screen && triage) {
      // Quick check: team portraits at the top mean a match is on (the streamer may be dead, the HUD covered...).
      const t = comp(null), portraits = t.left.filter(Boolean).length + t.right.filter(Boolean).length;
      return { decision: null, round: null, screen: null, inMatch: portraits >= 2 };
    }
    return { decision: null, round: screen ? score.read(rgba, width, height, null) : null, screen, ...(screen ? { team: comp(null) } : {}) };
  });
  detecting = job.catch(() => {});   // one failed preview mustn't stop the ones after it
  return job;
}

async function fetchFrame(login, size) {
  const response = await fetch(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-${size}.jpg`, {
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
  });
  // Twitch answers offline channels with a placeholder image.
  if (response.redirected || /404_preview/.test(response.url)) return { status: 'offline' };
  if (!response.ok) return { status: 'error' };
  return { left: frameLeftMs(response), frame: await decode(await response.blob()) };
}

async function analyse(login, tabs = new Set()) {
  const [engine, options] = await Promise.all([engineReady, settings()]);
  let sizes = FRAME_SIZES[options.quality === 'standard' ? 'standard' : 'high'];
  const previous = results.get(login);
  const now = Date.now();
  // Frames already read stay the same until the CDN replaces them; skip those.
  const readUntil = {};
  for (const [size, until] of Object.entries((previous && previous.frames) || {})) if ((sizes.includes(size) || size === QUICK) && until > now) readUntil[size] = until;
  let result;
  try {
    const frames = [];
    let done = false;
    // Quick check, unless the stream was just seen in a match.
    const known = previous && (previous.agent || previous.status === 'agent' || previous.status === 'spectating' || previous.status === 'maybe');
    if (!known && !readUntil[QUICK]) {
      const got = await fetchFrame(login, QUICK);
      if (got.status) { result = { status: got.status, checkedAt: now }; done = true; }
      else {
        readUntil[QUICK] = now + got.left;
        const found = await read(engine, got.frame, true);
        const at = now - (FRAME_MS - got.left);
        if (found.screen === 'menu' || found.screen === 'broadcast' || (!found.decision && !found.screen && !found.inMatch)) { frames.push({ ...found, at }); done = true; }
        else if (found.screen === 'select' && options.quality !== 'standard') sizes = ['1920x1080', ...sizes.filter(x => x !== '1920x1080')];   // map and mode read best at full HD
      }
    }
    const unread = sizes.filter(size => !readUntil[size]);
    if (!done && !unread.length && !frames.length) result = { ...previous, checkedAt: now };
    else if (!done) {
      for (const size of unread.slice(0, FRAMES_PER_CHECK)) {
        const got = await fetchFrame(login, size);
        if (got.status === 'offline') { result = { status: 'offline', checkedAt: now }; break; }
        if (got.status) { if (!frames.length) result = { status: 'error', checkedAt: now }; break; }
        readUntil[size] = now + got.left;
        const found = await read(engine, got.frame);
        frames.push({ ...found, at: now - (FRAME_MS - got.left) });
        // The streamer's own bar: done, unless sharper previews are on and the score wasn't readable here,
        // in which case the full-HD picture (another moment) is read for it.
        if (found.decision && !found.spectating && !found.weak && (found.round || options.quality === 'standard' || size === '1920x1080' || readUntil['1920x1080'])) break;
        if (found.screen === 'select' && found.map && found.mode) break;
      }
    }
    // Between rounds, in menus or behind an overlay, the agent seen earlier in this match is kept.
    if (!result) result = nextResult(previous, frames.sort((a, b) => a.at - b.at), now);
    if (result.status !== 'offline' && result.status !== 'error') {
      const seen = {};
      for (const [size, until] of Object.entries(readUntil)) seen[size] = until;
      // Back-off: count checks in a row that showed no match at all.
      const inMatch = frames.some(f => f.decision || f.inMatch || ['dead', 'roundEnd', 'buy', 'deathmatch', 'select'].includes(f.screen));
      const idle = inMatch || !frames.length ? (frames.length ? 0 : (previous && previous.idle) || 0) : ((previous && previous.idle) || 0) + 1;
      const all = [...sizes, ...(known ? [] : [QUICK])];
      const newFrame = Math.min(...all.map(size => seen[size] || now)) + 2000;
      const wait = result.status === 'agent' || result.status === 'spectating' ? RECHECK_MS
        : idle > 0 ? Math.min(IDLE_MAX_MS, RETRY_NONE_MS * 2 ** (idle - 1)) : RETRY_NONE_MS;
      // An idle stream is looked at again only once a new quick picture is out, so each look costs ~45 KB.
      const quickNew = idle > 0 && seen[QUICK] ? seen[QUICK] + 2000 : 0;
      result = { ...result, frames: seen, idle, nextAt: Math.max(now + wait, quickNew, all.every(size => seen[size]) ? newFrame : 0) };
    }
  } catch (_) {
    result = { status: 'error', checkedAt: now, ...(previous && previous.agent ? { agent: previous.agent, seenAt: previous.seenAt, sightings: previous.sightings } : {}) };
  }
  results.set(login, result);
  saveCache();
  for (const tabId of tabs) chrome.tabs.sendMessage(tabId, { type: 'AL_RESULT', login, result }).catch(() => {});
  return result;
}

// Agent pictures for Twitch pages, sent as data URLs so no extension file has to be exposed to websites.
let assetCache = null;
function toDataUrl(buffer, type) {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}
function assets() {
  assetCache ||= (async () => {
    const meta = await fetch(chrome.runtime.getURL('data/agents.json')).then(r => r.json());
    const file = path => fetch(chrome.runtime.getURL(path)).then(r => r.arrayBuffer());
    const faces = {}, roles = {};
    await Promise.all(meta.agents.map(async a => { faces[a.id] = toDataUrl(await file(`img/agents/${a.id}.webp`), 'image/webp'); }));
    await Promise.all(['duelist', 'initiator', 'controller', 'sentinel'].map(async r => { roles[r] = toDataUrl(await file(`img/roles/${r}.png`), 'image/png'); }));
    return { agents: meta.agents.map(({ id, name, role, color, colors }) => ({ id, name, role, color, colors })), faces, roles };
  })();
  assetCache.catch(() => { assetCache = null; });
  return assetCache;
}

// ---- Messages from Twitch tabs and the popup ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'AL_WANT') {
    const tabId = sender.tab && sender.tab.id;
    const fromTwitch = sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith('https://www.twitch.tv/');
    if (!fromTwitch) { sendResponse({ ok: false }); return false; }
    loadCache().then(() => {
      const now = Date.now(), reply = {};
      const logins = Array.isArray(message.logins) ? message.logins.slice(0, 120).map(l => String(l).toLowerCase()) : [];
      const onScreen = new Set(Array.isArray(message.visible) ? message.visible.slice(0, 120).map(l => String(l).toLowerCase()) : []);
      // A tab on another page no longer needs what it asked for on the last one.
      const page = String(sender.url).split('#')[0];
      if (tabId !== undefined && tabPage.get(tabId) !== page) { forgetTab(tabId, new Set(logins)); tabPage.set(tabId, page); }
      const asked = [];
      logins.forEach((login, i) => {
        if (!LOGIN.test(login)) return;
        const known = results.get(login);
        if (known) reply[login] = known;
        // On screen first, in the order sent (top to bottom); then the rest of the page.
        if (!fresh(known, now)) { want(login, tabId, (onScreen.has(login) ? 0 : 1) + i / 1000); asked.push(login); }
      });
      pump();
      sendResponse({ ok: true, results: reply, queued: asked });
    });
    return true;
  }
  if (message.type === 'AL_ASSETS') {
    assets().then(data => sendResponse({ ok: true, ...data }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === 'AL_STATUS') {
    sendResponse({ ok: true, pending: queue.size + active, known: results.size, kernel: Boolean(engine && engine.kernel) });
    return false;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULTS });
});
