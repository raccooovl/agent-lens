'use strict';
// Logic tests for Agent Lens: the detector on known previews, the score reader, the service worker and the texts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const jpeg = require('jpeg-js');
const EXT = path.resolve(__dirname, '../extension');
const D = require(path.join(EXT, 'detector.js'));
const meta = JSON.parse(fs.readFileSync(path.join(EXT, 'data/agents.json')));
const bin = new Uint8Array(fs.readFileSync(path.join(EXT, 'data/icons.bin')));
const digits = JSON.parse(fs.readFileSync(path.join(EXT, 'data/digits.json')));
const portraits = new Uint8Array(fs.readFileSync(path.join(EXT, 'data/portraits.bin')));
// Previews of dead players watching a teammate: the bar shows the teammate's agent (checked by hand).
const SPECTATING = { live_cloudey: 'jett', r2_earendelxdfp: 'jett', r1_will1us: 'clove', r3_zxc_k0t: 'tejo' };
const PREVIEWS = { r1_66xeni: 'jett', r1_1artifact: 'clove', r2_nats: 'cypher', r1_neehji: 'deadlock', r1_battlesage_: 'sage', r1_sikyume: 'reyna', r1_emmyuh: 'omen',
  r1_hiko: 'sova', r1_gotarii: 'fade', r1_sinatraa: 'raze', r1_hennie2001: 'neon', r1_ahhdigital: 'astra', r1_mspokee: 'viper', r2_stamp_on_dooor: 'waylay',
  r1_ajak0n: null, r1_alexfr1x: null, r1_bakamarimmo: null };
const SCORES = { r1_1artifact: [4, 1], r1_battlesage_: [0, 0], r1_hiko: [0, 2], r1_emmyuh: [1, 2], r1_ahhdigital: [0, 2], r1_gotarii: [2, 0], r1_hennie2001: [0, 2], r1_66xeni: [5, 4] };
const decoded = {};
function load(name) {
  if (!decoded[name]) { const raw = jpeg.decode(fs.readFileSync(path.join(__dirname, 'fixtures/previews', name + '.jpg')), { useTArray: true, formatAsRGBA: true }); decoded[name] = raw; }
  return decoded[name];
}
function resized(raw, W) {
  const H = W * 9 / 16, out = new Uint8ClampedArray(W * H * 4);
  for (let c = 0; c < 4; c++) {
    const ch = new Float32Array(raw.width * raw.height); for (let i = 0; i < ch.length; i++) ch[i] = raw.data[i * 4 + c];
    const r = D.areaResize(ch, raw.width, raw.height, W, H); for (let i = 0; i < W * H; i++) out[i * 4 + c] = r[i];
  }
  return { data: out, width: W, height: H };
}

test('agent data: 29 agents, four icons each, a role and a colour, pictures present', () => {
  assert.equal(meta.agents.length, 29);
  for (const a of meta.agents) {
    assert.equal(a.icons.length, 4, a.name);
    assert.ok(['Duelist', 'Initiator', 'Controller', 'Sentinel'].includes(a.role), a.name);
    assert.match(a.color, /^#[0-9a-f]{6}$/i);
    assert.ok(fs.existsSync(path.join(EXT, `img/agents/${a.id}.webp`)), a.id);
  }
  assert.equal(bin.length, meta.agents.length * 4 * meta.size * meta.size);
});

for (const W of [1920, 1280]) {
  test(`detector names the right agent on known previews at ${W} wide, and nothing on non-gameplay`, () => {
    const det = D.createDetector(meta, bin);
    for (const [name, want] of Object.entries(PREVIEWS)) {
      const raw = W === 1920 ? load(name) : resized(load(name), W);
      const decision = det.decide(det.detect(D.toGray(raw.data, raw.width, raw.height), raw.width, raw.height));
      assert.equal(decision ? decision.agent : null, want, name);
    }
  });
}

test('spectating: the teammate picture bottom-left is found (also stretched or partly covered), and never on own-agent previews', () => {
  const det = D.createDetector(meta, bin), spec = D.createSpectateCheck(meta, portraits);
  for (const [name, watching] of Object.entries(SPECTATING)) {
    const raw = load(name), gray = D.toGray(raw.data, raw.width, raw.height);
    const d = det.decide(det.detect(gray, raw.width, raw.height));
    assert.equal(d && d.agent, watching, name);
    assert.equal(spec.check(gray, raw.width, raw.height, d.agent, d.layout).spectating, true, name);
  }
  for (const [name, want] of Object.entries(PREVIEWS)) {
    if (!want) continue;
    const raw = load(name), gray = D.toGray(raw.data, raw.width, raw.height);
    const d = det.decide(det.detect(gray, raw.width, raw.height));
    assert.equal(spec.check(gray, raw.width, raw.height, d.agent, d.layout).spectating, false, name);
  }
});

test('stretched 4:3 resolutions are recognised with their layout', () => {
  const det = D.createDetector(meta, bin), raw = load('r2_nats');
  const decision = det.decide(det.detect(D.toGray(raw.data, raw.width, raw.height), raw.width, raw.height));
  assert.equal(decision.agent, 'cypher');
  assert.ok(Math.abs(decision.layout.s - 4 / 3) < 0.01);
});

test('round score reader: reads most scores and never a wrong one', () => {
  const det = D.createDetector(meta, bin), reader = D.createScoreReader(digits);
  let read = 0;
  for (const [name, want] of Object.entries(SCORES)) {
    const raw = load(name);
    const decision = det.decide(det.detect(D.toGray(raw.data, raw.width, raw.height), raw.width, raw.height));
    const score = reader.read(raw.data, raw.width, raw.height, decision && decision.layout);
    if (score) { read++; assert.deepEqual([score.left, score.right], want, name); }
  }
  assert.ok(read >= 6, `read ${read}`);
});

test('screens: agent select, menus, round banners and the combat report are told apart from gameplay', () => {
  const st = D.createStateCheck(JSON.parse(fs.readFileSync(path.join(EXT, 'data/states.json'))));
  const look = name => {
    const raw = load(name), gray = D.toGray(raw.data, raw.width, raw.height);
    const b = st.banner(raw.data, raw.width, raw.height);
    return { select: st.iconRow(gray, raw.width, raw.height, 'select'), menu: st.iconRow(gray, raw.width, raw.height, 'menu'), banner: b && b.kind, dead: Boolean(st.dead(raw.data, raw.width, raw.height)) };
  };
  assert.ok(look('r1_snowyy20_').select >= 0.9, 'agent select');
  assert.ok(look('r1_ajak0n').menu >= 0.9, 'lobby');
  const flawless = look('r3_grimm'); assert.equal(flawless.banner, 'result');
  const defeat = look('r4_mymiikyu'); assert.equal(defeat.banner, 'result'); assert.equal(defeat.dead, true);   // French, red
  assert.equal(look('r1_battlesage_').banner, 'buy');
  assert.equal(look('r1_emmyuh').dead, true);
  // Plain gameplay: none of them.
  for (const name of ['r1_66xeni', 'r1_1artifact', 'r1_gotarii', 'r1_hiko', 'r2_nats', 'r2_stamp_on_dooor']) {
    const s = look(name);
    assert.ok(s.select < 0.5 && s.menu < 0.5 && !s.banner && !s.dead, name + ' ' + JSON.stringify(s));
  }
});

test('regions: reading only the parts of the picture each check uses gives the same results as the whole picture', () => {
  const det = D.createDetector(meta, bin), spec = D.createSpectateCheck(meta, portraits), reader = D.createScoreReader(digits);
  const st = D.createStateCheck(JSON.parse(fs.readFileSync(path.join(EXT, 'data/states.json'))));
  const only = (raw, names) => {
    const rgba = new Uint8ClampedArray(raw.data.length), kx = raw.width / 1920, ky = raw.height / 1080;
    for (const n of names) {
      const [a, b, c, d] = D.REGIONS[n];
      for (let y = Math.floor(b * ky); y < Math.min(raw.height, Math.ceil(d * ky)); y++) {
        const i0 = (y * raw.width + Math.floor(a * kx)) * 4, i1 = (y * raw.width + Math.min(raw.width, Math.ceil(c * kx))) * 4;
        rgba.set(raw.data.subarray(i0, i1), i0);
      }
    }
    return rgba;
  };
  const run = (rgba, w, h) => {
    const gray = D.toGray(rgba, w, h), d = det.decide(det.detect(gray, w, h));
    return JSON.stringify({ agent: d && d.agent, layout: d && d.layout, score: reader.read(rgba, w, h, d && d.layout),
      spect: d ? spec.check(gray, w, h, d.agent, d.layout).score.toFixed(4) : null,
      menu: st.iconRow(gray, w, h, 'menu').toFixed(4), select: st.iconRow(gray, w, h, 'select').toFixed(4),
      banner: st.banner(rgba, w, h), dead: st.dead(rgba, w, h) });
  };
  const names = Object.keys(D.REGIONS);
  for (const name of [...Object.keys(PREVIEWS), ...Object.keys(SPECTATING), 'r1_snowyy20_', 'r3_grimm', 'r4_mymiikyu']) {
    for (const W of [1920, 1280]) {
      const raw = W === 1920 ? load(name) : resized(load(name), W);
      assert.equal(run(only(raw, names), raw.width, raw.height), run(raw.data, raw.width, raw.height), name + ' ' + W);
    }
  }
});

test('teams: both sides\' agents from the top-bar portraits; a duo reads as one team, opponents mirrored', () => {
  const det = D.createDetector(meta, bin), tr = D.createTeamReader(meta, portraits);
  const M = require(path.join(EXT, 'match.js'));
  const read = name => {
    const raw = load(name), gray = D.toGray(raw.data, raw.width, raw.height);
    const d = det.decide(det.detect(gray, raw.width, raw.height));
    const t = tr.read(gray, raw.width, raw.height, d && d.layout);
    return { own: d && d.agent, left: t.left.filter(Boolean).map(x => x.agent), right: t.right.filter(Boolean).map(x => x.agent),
      score: D.createScoreReader(digits).read(raw.data, raw.width, raw.height, d && d.layout) };
  };
  const a = read('r1_1artifact');
  assert.ok(a.left.includes('clove') && a.left.length >= 4 && a.right.length >= 4, JSON.stringify(a));
  for (const t of [a]) for (const side of [t.left, t.right]) assert.equal(new Set(side).size, side.length);
  // Escalation / team deathmatch top bar: no portraits there, none read.
  const tdm = read('r1_66xeni'); assert.ok(tdm.left.length + tdm.right.length === 0, JSON.stringify(tdm));
  const asResult = t => ({ comp: { left: t.left, right: t.right, at: 1000 }, score: t.score, scoreAt: t.score ? 1000 : undefined });
  const p = read('r11_panzermausitv'), z = read('r11_zoovieh');
  assert.equal(M.relation(asResult(p), asResult(z), 1000), 'team', JSON.stringify([p, z]));
  const s1 = read('r8_subroza'), s2 = read('r8_zekken');
  assert.equal(M.relation(asResult(s1), asResult(s2), 1000), 'opponents', JSON.stringify([s1, s2]));
  // Unrelated streams don't match.
  for (const [x, y] of [['r1_1artifact', 'r11_panzermausitv'], ['r8_subroza', 'r11_zoovieh'], ['r1_1artifact', 'r8_zekken']]) assert.equal(M.relation(asResult(read(x)), asResult(read(y)), 1000), null, x + ' ' + y);
});

test('match: groups, sides, and the rules that keep popular-agent lookalikes apart', () => {
  const M = require(path.join(EXT, 'match.js'));
  const r = (left, right, score, at = 1000) => ({ comp: { left, right, at }, score, scoreAt: score ? at : undefined });
  const A = ['jett', 'sova', 'omen', 'killjoy', 'skye'], B = ['raze', 'fade', 'viper', 'cypher', 'neon'];
  const g = M.groups({ x: r(A, B, { left: 5, right: 3 }), y: r(A, B, { left: 5, right: 3 }), z: r(B, A, { left: 3, right: 5 }), w: r(['clove', 'iso', 'reyna'], ['sage', 'yoru'], null) }, 1000);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].map(m => m.login + ':' + m.side), ['x:team', 'y:team', 'z:opponents']);
  // Same agents, different score: a different match.
  assert.equal(M.relation(r(A, B, { left: 5, right: 3 }), r(A, B, { left: 9, right: 1 }), 1000), null);
  // A later picture may be a round on, never behind.
  assert.equal(M.relation(r(A, B, { left: 5, right: 3 }, 1000), r(A, B, { left: 6, right: 3 }, 1000 + 100000), 1000 + 100000), 'team');
  assert.equal(M.relation(r(A, B, { left: 5, right: 3 }, 1000 + 100000), r(A, B, { left: 6, right: 3 }, 1000), 1000 + 100000), null);
  // No scores: only near-identical comps.
  assert.equal(M.relation(r(A, B.slice(0, 3), null), r(A, B.slice(0, 3), null), 1000), null);
  assert.equal(M.relation(r(A, B.slice(0, 4), null), r(A, B.slice(0, 4), null), 1000), 'team');
  // Both teams seen in full that differ: not the same match.
  assert.equal(M.relation(r(A, B, null), r(A, [...B.slice(0, 4), 'sage'], null), 1000), null);
  // Old comps aren't compared.
  assert.equal(M.relation(r(A, B, { left: 1, right: 1 }, 0), r(A, B, { left: 1, right: 1 }, 0), 11 * 60 * 1000), null);
});

test('broadcast: an official broadcast\'s player cards are recognised, and nothing else is', () => {
  const st = D.createStateCheck(JSON.parse(fs.readFileSync(path.join(EXT, 'data/states.json'))));
  const raw = load('r9_valorant_americas');
  assert.equal(st.broadcast(raw.data, raw.width, raw.height), true);
  const small = resized(raw, 1280); assert.equal(st.broadcast(small.data, small.width, small.height), true);
  for (const name of [...Object.keys(PREVIEWS), ...Object.keys(SPECTATING), 'r1_snowyy20_', 'r3_grimm', 'r4_mymiikyu', 'r11_panzermausitv', 'r8_subroza']) {
    const x = load(name); assert.equal(st.broadcast(x.data, x.width, x.height), false, name);
  }
});

test('map and mode at agent select, and deathmatch clocks', () => {
  const st = D.createStateCheck(JSON.parse(fs.readFileSync(path.join(EXT, 'data/states.json'))));
  const sc = D.createScoreReader(digits), det = D.createDetector(meta, bin);
  const sel = load('r1_snowyy20_'), g = D.toGray(sel.data, sel.width, sel.height);
  assert.deepEqual(st.readSelect(sel.data, g, sel.width, sel.height), { map: 'bind', mode: 'competitive' });
  const small = resized(sel, 1280), gs = D.toGray(small.data, small.width, small.height);
  assert.equal(st.readSelect(small.data, gs, small.width, small.height).map, 'bind');   // the small mode line needs full HD
  // Deathmatch (no ability bar) and team deathmatch run a clock of several minutes; rounds never do.
  for (const name of ['r1_rau_meat', 'r1_66xeni']) { const r = load(name); assert.ok(sc.minutes(r.data, r.width, r.height, null) >= 2, name); }
  for (const name of ['r1_1artifact', 'r1_hiko', 'r1_gotarii', 'r2_nats', 'r1_battlesage_', 'r3_grimm', 'r11_panzermausitv']) {
    const r = load(name), d = det.decide(det.detect(D.toGray(r.data, r.width, r.height), r.width, r.height));
    const m = sc.minutes(r.data, r.width, r.height, d && d.layout); assert.ok(m === null || m < 2, name + ' ' + m);
  }
});

// ---- Service worker, with Chrome and image decoding stubbed ----
function worker({ images = {}, ages = {}, now = { t: 1_800_000_000_000 }, useKernel = true } = {}) {
  const local = {}, session = {}, sent = [], fetched = [];
  const listeners = [], removed = [];
  const chrome = {
    runtime: { id: 'agent-lens', getURL: p => 'ext://' + p, onMessage: { addListener: f => listeners.push(f) }, onInstalled: { addListener() {} } },
    storage: {
      local: { async get(k) { return { [k]: local[k] }; }, async set(v) { Object.assign(local, v); } },
      session: { async get(k) { return { [k]: session[k] }; }, async set(v) { Object.assign(session, v); } },
      onChanged: { addListener() {} }
    },
    tabs: { async sendMessage(tabId, message) { sent.push({ tabId, message }); }, onRemoved: { addListener: f => { removed.push(f); } } }
  };
  async function fetchStub(url) {
    if (url.startsWith('ext://')) {
      const file = path.join(EXT, url.slice(6));
      const buf = fs.readFileSync(file);
      return { ok: true, json: async () => JSON.parse(buf), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
    }
    fetched.push(url);
    const [, login, size] = /live_user_([a-z0-9_]+)-(\d+x\d+)\.jpg$/.exec(url);
    const pick = images[login] && typeof images[login] === 'object' ? images[login][size] : images[login];
    const headers = { get: k => (k === 'cache-control' ? 'public, max-age=300' : k === 'age' ? String(ages[size] || 0) : null) };
    if (pick === 'offline') return { ok: true, redirected: true, url: 'https://static-cdn.jtvnw.net/ttv-static/404_preview-1920x1080.jpg' };
    if (pick === 'error' || pick === undefined) return { ok: false, status: 500, url };
    return { ok: true, redirected: false, url, headers, blob: async () => ({ name: pick }) };
  }
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now.t])); } static now() { return now.t; } }
  const context = vm.createContext({
    chrome, fetch: fetchStub, Date: FakeDate, WebAssembly: useKernel ? WebAssembly : undefined, console, setTimeout, clearTimeout, Promise, Math, JSON, Map, Set, Array, Uint8Array, Uint8ClampedArray, Float32Array, Float64Array, Int32Array, Number, String, Object, RegExp, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    createImageBitmap: async blob => { const raw = load(blob.name); return { width: raw.width, height: raw.height, raw, close() {} }; },
    OffscreenCanvas: class { constructor() {} getContext() { let bmp; return { drawImage(b) { bmp = b; }, getImageData(x, y, w, h) {
      const out = new Uint8ClampedArray(w * h * 4), W = bmp.raw.width;
      for (let r = 0; r < h; r++) out.set(bmp.raw.data.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
      return { data: out };
    } }; } }
  });
  context.self = context;
  context.importScripts = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), context, { filename: f }); };
  vm.runInContext(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  const plain = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const message = (payload, sender = { id: 'agent-lens', url: 'https://www.twitch.tv/directory/category/valorant', tab: { id: 5 } }) =>
    new Promise(resolve => { const done = v => resolve(plain(v)); const keep = listeners[0](payload, sender, done); if (!keep) setTimeout(() => resolve(undefined), 0); });
  const settle = async () => { for (let i = 0; i < 200 && (sent.length < (settle.want || 0)); i++) await new Promise(r => setTimeout(r, 20)); };
  return { message, sent, fetched, local, session, now, settle, removed };
}

test('worker: reads requested streams once, answers the tab, and caches for the session', async () => {
  const w = worker({ images: { aaa: 'r1_66xeni', bbb: 'r1_ajak0n', ccc: 'offline' } });
  const first = await w.message({ type: 'AL_WANT', logins: ['AAA', 'bbb', 'ccc', 'bad login', '../x'] });
  assert.equal(first.ok, true);
  assert.deepEqual([...first.queued].sort(), ['aaa', 'bbb', 'ccc']);
  w.settle.want = 3; await w.settle();
  const byLogin = Object.fromEntries(w.sent.map(s => [s.message.login, JSON.parse(JSON.stringify(s.message.result))]));
  assert.equal(byLogin.aaa.status, 'agent'); assert.equal(byLogin.aaa.agent, 'jett'); assert.deepEqual(byLogin.aaa.score, { left: 5, right: 4 });
  assert.equal(byLogin.bbb.status, 'none');
  assert.equal(byLogin.ccc.status, 'offline');
  assert.ok(w.sent.every(s => s.tabId === 5));
  assert.ok(w.fetched.every(u => /^https:\/\/static-cdn\.jtvnw\.net\/previews-ttv\/live_user_[a-z0-9_]+-(640x360|1920x1080|1280x720)\.jpg$/.test(u)), w.fetched.join());
  assert.equal(w.fetched.filter(u => u.includes('_aaa-')).length, 2);   // quick check, then the agent in the first big frame
  assert.equal(w.fetched.filter(u => u.includes('_bbb-')).length, 1);   // the lobby: the quick check was enough
  const again = await w.message({ type: 'AL_WANT', logins: ['aaa'] });
  assert.deepEqual([...again.queued], []);
  assert.equal(again.results.aaa.agent, 'jett');
  await new Promise(r => setTimeout(r, 600));
  assert.ok(w.session.agentLensResults && w.session.agentLensResults.aaa);
});

test('worker: keeps the agent between rounds for a while, then lets it go', async () => {
  const images = { aaa: 'r1_66xeni' };
  const w = worker({ images });
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 1; await w.settle();
  images.aaa = 'r1_alexfr1x';                     // in a match, no ability bar
  w.now.t += 5 * 60 * 1000;
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 2; await w.settle();
  const later = w.sent[1].message.result;
  assert.equal(later.status, 'earlier'); assert.equal(later.agent, 'jett'); assert.equal(later.score, null);
  w.now.t += 50 * 60 * 1000;
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 3; await w.settle();
  assert.equal(w.sent[2].message.result.status, 'none');
});

test('worker: menus or agent select end the match: the old agent is dropped and the screen named', async () => {
  const images = { aaa: 'r1_66xeni' };
  const w = worker({ images });
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 1; await w.settle();
  images.aaa = 'r1_ajak0n';                       // the lobby
  w.now.t += 5 * 60 * 1000;
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 2; await w.settle();
  const r = JSON.parse(JSON.stringify(w.sent[1].message.result));
  assert.equal(r.status, 'none'); assert.equal(r.agent, undefined); assert.equal(r.screen, 'menu');
});

test('worker: a bar on a death screen is only a "maybe"; it confirms a known agent or is a watched teammate', async () => {
  const images = { aaa: 'r1_emmyuh' };            // Omen bar with the combat report showing
  const w = worker({ images });
  const step = async (image, n, minutes = 5) => { images.aaa = image; w.now.t += minutes * 60 * 1000; await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = n; await w.settle(); return JSON.parse(JSON.stringify(w.sent[n - 1].message.result)); };
  let r = await step('r1_emmyuh', 1, 0);
  assert.equal(r.status, 'maybe'); assert.equal(r.maybe, 'omen'); assert.equal(r.agent, undefined); assert.equal(r.screen, 'dead');
  assert.equal(w.fetched.length, 3);              // quick check, then uncertain: a second size was read too
  r = await step('r1_mspokee', 2);                // Viper at 1-1, clearly the streamer's own bar
  assert.equal(r.status, 'agent'); assert.equal(r.agent, 'viper');
  r = await step('r1_emmyuh', 3);                 // Omen at 1-2 on a death screen: watching a teammate
  assert.equal(r.status, 'spectating'); assert.equal(r.agent, 'viper'); assert.equal(r.watching, 'omen');
});

test('worker: in the buy phase the bar is the streamer\'s own, even with last round\'s combat report open', async () => {
  const w = worker({ images: { aaa: 'r1_ahhdigital' } });   // BUY PHASE banner, combat report, Astra
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 1; await w.settle();
  const r = w.sent[0].message.result;
  assert.equal(r.status, 'agent'); assert.equal(r.agent, 'astra'); assert.equal(r.screen, 'buy');
  assert.equal(w.fetched.length, 2);              // quick check, then 1280x720
});

test('worker: two uncertain sightings of one agent, minutes apart, are enough without clearer ones', async () => {
  const images = { aaa: 'r1_emmyuh' };
  const w = worker({ images });
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 1; await w.settle();
  assert.equal(w.sent[0].message.result.agent, undefined);
  w.now.t += 5 * 60 * 1000;
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 2; await w.settle();
  assert.equal(w.sent[1].message.result.agent, 'omen'); assert.equal(w.sent[1].message.result.status, 'agent');
});

test('worker: a spectating preview never becomes the streamer\'s agent; their own agent stays', async () => {
  const images = { aaa: 'live_cloudey' };
  const w = worker({ images });
  const step = async (image, n) => { images.aaa = image; w.now.t += 5 * 60 * 1000; await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = n; await w.settle(); return JSON.parse(JSON.stringify(w.sent[n - 1].message.result)); };
  let r = await step('live_cloudey', 1);
  assert.equal(r.status, 'spectating'); assert.equal(r.agent, undefined); assert.equal(r.watching, 'jett');
  r = await step('r1_1artifact', 2);
  assert.equal(r.status, 'agent'); assert.equal(r.agent, 'clove');
  r = await step('live_cloudey', 3);
  assert.equal(r.status, 'spectating'); assert.equal(r.agent, 'clove'); assert.equal(r.watching, 'jett');
});

test('worker: the agent seen most in a match wins; a new match (lower round) starts over', async () => {
  const images = {};
  const w = worker({ images });
  const step = async (image, n) => { images.aaa = image; w.now.t += 5 * 60 * 1000; await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = n; await w.settle(); return JSON.parse(JSON.stringify(w.sent[n - 1].message.result)); };
  await step('r1_1artifact', 1);                 // Clove, round 6
  await step('r1_1artifact', 2);                 // Clove again
  let r = await step('r1_66xeni', 3);            // Jett, round 10: an unrecognised spectate, say
  assert.equal(r.agent, 'clove');
  r = await step('r1_battlesage_', 4);           // Sage at 0-0: a new match
  assert.equal(r.agent, 'sage');
  assert.equal(r.sightings.length, 1);
});

test('worker: standard quality uses 1280x720 previews; errors retry after a minute', async () => {
  const w = worker({ images: { aaa: 'error' } });
  w.local.agentLensSettings = { quality: 'standard' };
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 1; await w.settle();
  assert.match(w.fetched[0], /-640x360\.jpg$/);
  assert.equal(w.sent[0].message.result.status, 'error');
  assert.deepEqual([...(await w.message({ type: 'AL_WANT', logins: ['aaa'] })).queued], []);
  w.now.t += 61 * 1000;
  assert.deepEqual([...(await w.message({ type: 'AL_WANT', logins: ['aaa'] })).queued], ['aaa']);
});

test('worker: when one frame shows no ability bar (dead, between rounds), another size\'s frame is read', async () => {
  const w = worker({ images: { aaa: { '640x360': 'r1_66xeni', '1280x720': 'r1_alexfr1x', '1920x1080': 'r1_66xeni', '1600x900': 'r1_alexfr1x' } }, ages: { '1280x720': 200, '1920x1080': 20 } });
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 1; await w.settle();
  const r = w.sent[0].message.result;
  assert.equal(r.status, 'agent'); assert.equal(r.agent, 'jett');
  assert.deepEqual(w.fetched.map(u => /-(\d+x\d+)\.jpg$/.exec(u)[1]), ['640x360', '1280x720', '1920x1080']);
});

test('worker: in a match without the bar (quick check says so) it reads the big pictures, and looks again in a minute', async () => {
  // r1_emmyuh: death screen with a bar; the quick check sees a match and goes on to 1280x720 and full HD.
  const w = worker({ images: { aaa: 'r1_emmyuh' }, ages: { '640x360': 0, '1280x720': 100, '1920x1080': 100 } });
  const ask = async () => [...(await w.message({ type: 'AL_WANT', logins: ['aaa'] })).queued];
  const t0 = w.now.t;
  await ask(); w.settle.want = 1; await w.settle();
  assert.deepEqual(w.fetched.map(u => /-(\d+x\d+)\.jpg$/.exec(u)[1]), ['640x360', '1280x720', '1920x1080']);
  assert.equal(w.sent[0].message.result.idle, 0);
  assert.equal(w.sent[0].message.result.status, 'maybe');
  w.now.t = t0 + 30 * 1000; assert.deepEqual(await ask(), []);
  w.now.t = t0 + 61 * 1000; assert.deepEqual(await ask(), ['aaa']); w.settle.want = 2; await w.settle();
  // Known "maybe" now: no quick check; the pictures still current aren't fetched again: only 1600x900 is new.
  assert.deepEqual(w.fetched.slice(3).map(u => /-(\d+x\d+)\.jpg$/.exec(u)[1]), ['1600x900']);
});

test('worker: quick check: menus and other content cost one small picture, and are looked at less and less often', async () => {
  const w = worker({ images: { m: 'r1_ajak0n', o: 'r1_bakamarimmo' }, ages: { '640x360': 250 } });
  const ask = async l => [...(await w.message({ type: 'AL_WANT', logins: [l] })).queued];
  const t0 = w.now.t;
  await ask('m'); await ask('o'); w.settle.want = 2; await w.settle();
  assert.deepEqual(w.fetched.map(u => /-(\d+x\d+)\.jpg$/.exec(u)[1]), ['640x360', '640x360']);
  const m = () => JSON.parse(JSON.stringify(w.sent.filter(x => x.message.login === 'm').pop().message.result));
  assert.equal(m().screen, 'menu'); assert.equal(m().idle, 1);
  // 1 minute, then 2, 4 ... up to 15.
  w.now.t = t0 + 61 * 1000; assert.deepEqual(await ask('m'), ['m']); w.settle.want = 3; await w.settle();
  assert.equal(m().idle, 2); assert.equal(w.fetched.length, 3);
  w.now.t = t0 + 150 * 1000; assert.deepEqual(await ask('m'), []);
  w.now.t = t0 + 61 * 1000 + 121 * 1000; assert.deepEqual(await ask('m'), ['m']); w.settle.want = 4; await w.settle();
  assert.equal(m().idle, 3);
  assert.ok(w.fetched.every(u => u.endsWith('-640x360.jpg')));
});

test('worker: agent select goes straight to full HD for map and mode; a match resets the back-off', async () => {
  const images = { aaa: 'r1_snowyy20_' };
  const w = worker({ images });
  await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = 1; await w.settle();
  assert.deepEqual(w.fetched.map(u => /-(\d+x\d+)\.jpg$/.exec(u)[1]), ['640x360', '1920x1080']);
  const r = w.sent[0].message.result;
  assert.equal(r.match.map, 'bind'); assert.equal(r.match.mode, 'competitive'); assert.equal(r.idle, 0);
});

test('worker: 1280x720 first; full HD only for a score it couldn\'t read (sharper previews on)', async () => {
  const w = worker({ images: { aaa: 'r1_66xeni', bbb: 'r1_sikyume' } });   // Jett 5-4 readable; Reyna, no score
  await w.message({ type: 'AL_WANT', logins: ['aaa', 'bbb'] }); w.settle.want = 2; await w.settle();
  const sizes = login => w.fetched.filter(u => u.includes(`_${login}-`)).map(u => /-(\d+x\d+)\.jpg$/.exec(u)[1]);
  assert.deepEqual(sizes('aaa'), ['640x360', '1280x720']);
  assert.deepEqual(sizes('bbb'), ['640x360', '1280x720', '1920x1080']);
  const s = worker({ images: { bbb: 'r1_sikyume' } }); s.local.agentLensSettings = { quality: 'standard' };
  await s.message({ type: 'AL_WANT', logins: ['bbb'] }); s.settle.want = 1; await s.settle();
  assert.deepEqual(s.fetched.map(u => /-(\d+x\d+)\.jpg$/.exec(u)[1]), ['640x360', '1280x720']);
});

test('worker: streams on screen are read first, and a closed tab\'s queued work is dropped', async () => {
  const images = Object.fromEntries(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'].map(l => [l, 'r1_66xeni']));
  const w = worker({ images });
  await w.message({ type: 'AL_WANT', logins: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'], visible: ['a6', 'a7'] });
  w.removed.forEach(f => f(5));                    // the tab closes while three are being read
  await new Promise(r => setTimeout(r, 1500));
  const read = w.fetched.map(u => /live_user_(\w+?)-/.exec(u)[1]);
  assert.deepEqual([...new Set(read)].sort(), ['a1', 'a6', 'a7']);   // the two on screen, then the first of the rest
});

test('worker: the WebAssembly kernel loads and gives the same results as plain JavaScript', async () => {
  for (const useKernel of [true, false]) {
    const w = worker({ images: { aaa: 'r1_1artifact', bbb: 'r2_nats', ccc: 'live_cloudey' }, useKernel });
    await w.message({ type: 'AL_WANT', logins: ['aaa', 'bbb', 'ccc'] }); w.settle.want = 3; await w.settle();
    const status = await w.message({ type: 'AL_STATUS' });
    assert.equal(status.kernel, useKernel);
    const by = Object.fromEntries(w.sent.map(x => [x.message.login, x.message.result]));
    assert.equal(by.aaa.agent, 'clove'); assert.equal(by.bbb.agent, 'cypher'); assert.equal(by.ccc.status, 'spectating');
  }
});

test('worker: a broadcast gets the "Pro match" screen and no agent; matches carry both teams', async () => {
  const w = worker({ images: { vct: 'r9_valorant_americas', pz: 'r11_panzermausitv', zv: 'r11_zoovieh' } });
  await w.message({ type: 'AL_WANT', logins: ['vct', 'pz', 'zv'] }); w.settle.want = 3; await w.settle();
  const by = Object.fromEntries(w.sent.map(x => [x.message.login, JSON.parse(JSON.stringify(x.message.result))]));
  assert.equal(by.vct.status, 'none'); assert.equal(by.vct.screen, 'broadcast'); assert.equal(by.vct.agent, undefined);
  assert.ok(by.pz.comp && by.pz.comp.left.length >= 3 && by.pz.comp.right.length >= 3, JSON.stringify(by.pz.comp));
  const M = require(path.join(EXT, 'match.js'));
  const groups = M.groups({ pz: by.pz, zv: by.zv }, w.now.t);
  assert.deepEqual(groups.map(g => g.map(m => m.login)), [['pz', 'zv']]);
});

test('worker: map and mode from agent select are kept for the match; deathmatch gets its own pill', async () => {
  const images = { aaa: 'r1_snowyy20_', dm: 'r1_rau_meat' };
  const w = worker({ images });
  const step = async (image, n) => { images.aaa = image; w.now.t += 5 * 60 * 1000; await w.message({ type: 'AL_WANT', logins: ['aaa'] }); w.settle.want = n; await w.settle(); return JSON.parse(JSON.stringify(w.sent.filter(x => x.message.login === 'aaa')[n - 1].message.result)); };
  let r = await step('r1_snowyy20_', 1);
  assert.equal(r.screen, 'select'); assert.equal(r.match.map, 'bind'); assert.equal(r.match.mode, 'competitive');
  r = await step('r1_battlesage_', 2);            // in the match (0-0)
  assert.equal(r.agent, 'sage'); assert.equal(r.match.map, 'bind');
  r = await step('r1_ajak0n', 3);                 // back in the lobby: match over
  assert.equal(r.match, undefined);
  await w.message({ type: 'AL_WANT', logins: ['dm'] }); w.settle.want = 4; await w.settle();
  const dm = JSON.parse(JSON.stringify(w.sent.find(x => x.message.login === 'dm').message.result));
  assert.equal(dm.screen, 'deathmatch'); assert.equal(dm.match.mode, 'deathmatch'); assert.equal(dm.agent, undefined);
});

test('worker: only Twitch pages of this extension may ask', async () => {
  const w = worker();
  assert.deepEqual(await w.message({ type: 'AL_WANT', logins: ['aaa'] }, { id: 'agent-lens', url: 'https://evil.example/', tab: { id: 1 } }), { ok: false });
  assert.deepEqual(await w.message({ type: 'AL_WANT', logins: ['aaa'] }, { id: 'other', url: 'https://www.twitch.tv/', tab: { id: 1 } }), { ok: false });
});

test('texts: every message used exists in all five languages with matching placeholders', () => {
  const { languages, messages } = require('../tools/messages.cjs');
  const code = ['content.js', 'popup.js', 'popup.html', 'manifest.json'].map(f => fs.readFileSync(path.join(EXT, f), 'utf8')).join('\n');
  const used = new Set([...code.matchAll(/\bt\('([A-Za-z0-9_]+)'/g), ...code.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g), ...code.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(m => m[1]));
  for (const m of code.matchAll(/\btp\('([A-Za-z0-9_]+)'/g)) { used.add(m[1] + '_one'); used.add(m[1] + '_other'); }
  for (const m of code.matchAll(/(?:ROLE|SCREEN)_TEXT = \{([^}]+)\}/g)) for (const k of m[1].matchAll(/'([a-zA-Z]+)'/g)) used.add(k[1]);
  for (const key of used) assert.ok(messages[key], 'missing message ' + key);
  for (const lang of languages) {
    const file = JSON.parse(fs.readFileSync(path.join(EXT, '_locales', lang, 'messages.json')));
    for (const key of used) assert.ok(file[key] && file[key].message, `${lang}: ${key}`);
  }
});

test('manifest: only storage permission and preview-image access; no files exposed to websites', () => {
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json')));
  assert.deepEqual(m.permissions, ['storage']);
  assert.deepEqual(m.host_permissions, ['https://static-cdn.jtvnw.net/previews-ttv/*']);
  assert.equal(m.web_accessible_resources, undefined);
  assert.deepEqual(m.content_scripts[0].matches, ['https://www.twitch.tv/*']);
});
