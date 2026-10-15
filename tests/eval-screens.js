// Screens without the streamer's ability bar, on the hand-labelled set: how often each is recognised, and how
// often an own-agent or spectating preview is marked uncertain (death screen or round result).
// Usage: node tests/eval-screens.js   (VAL=/path/to/labelled/set)
const fs = require('fs'); const path = require('path'); const jpeg = require('jpeg-js');
const D = require('../extension/detector.js');
const VAL = process.env.VAL || '/home/claude/val';
const EXT = path.join(__dirname, '../extension');
const meta = JSON.parse(fs.readFileSync(path.join(EXT, 'data/agents.json')));
const det = D.createDetector(meta, new Uint8Array(fs.readFileSync(path.join(EXT, 'data/icons.bin'))));
const spec = D.createSpectateCheck(meta, new Uint8Array(fs.readFileSync(path.join(EXT, 'data/portraits.bin'))));
const st = D.createStateCheck(JSON.parse(fs.readFileSync(path.join(EXT, 'data/states.json'))));
const labels = {}; for (const r of ['r1', 'r2', 'r3']) Object.assign(labels, JSON.parse(fs.readFileSync(path.join(VAL, `labels_${r}.json`))));
const SPECT = new Set(fs.readFileSync(path.join(__dirname, 'fixtures/spectating.txt'), 'utf8').split('\n').filter(Boolean));
const count = {}; const add = (k) => { count[k] = (count[k] || 0) + 1; };
for (const [f, l] of Object.entries(labels)) {
  const raw = jpeg.decode(fs.readFileSync(path.join(VAL, f)), { useTArray: true, formatAsRGBA: true });
  const gray = D.toGray(raw.data, raw.width, raw.height);
  const d = det.decide(det.detect(gray, raw.width, raw.height));
  const banner = st.banner(raw.data, raw.width, raw.height), dead = st.dead(raw.data, raw.width, raw.height);
  const group = !l.bar ? 'no bar' : SPECT.has(f) ? 'spectating' : 'own agent';
  add(group);
  if (d) {
    const spectating = spec.check(gray, raw.width, raw.height, d.agent, d.layout).spectating;
    const buy = banner && banner.kind === 'buy';
    if (spectating) add(group + ': recognised as spectating');
    else if (!buy && (dead || banner)) add(group + ': uncertain (death screen or round result)');
    else add(group + ': taken as own agent');
  } else {
    const screen = st.iconRow(gray, raw.width, raw.height, 'select') >= 0.58 ? 'agent select'
      : st.iconRow(gray, raw.width, raw.height, 'menu') >= 0.62 ? 'menus'
      : banner && banner.kind === 'buy' ? 'buy phase' : dead ? 'dead' : banner ? 'round over' : 'nothing';
    add(group + ': ' + screen);
  }
}
for (const k of Object.keys(count).sort()) console.log(k.padEnd(56), count[k]);
