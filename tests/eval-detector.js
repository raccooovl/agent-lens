// Runs the detector on the hand-labelled preview set and reports accuracy and speed.
const fs = require('fs'); const path = require('path');
const jpeg = require('jpeg-js');
const D = require('../extension/detector.js');
const VAL = process.env.VAL || '/home/claude/val';
const OUTW = +(process.env.W || 1280), OUTH = Math.round(OUTW * 9 / 16);
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/data/agents.json')));
const bin = fs.readFileSync(path.join(__dirname, '../extension/data/icons.bin'));
const det = D.createDetector(meta, new Uint8Array(bin));
const labels = {};
for (const r of ['r1', 'r2', 'r3']) Object.assign(labels, JSON.parse(fs.readFileSync(path.join(VAL, `labels_${r}.json`))));
const out = {}; let t0 = Date.now(), detectMs = 0;
const files = Object.keys(labels).sort();
for (const f of files) {
  const raw = jpeg.decode(fs.readFileSync(path.join(VAL, f)), { useTArray: true, formatAsRGBA: true });
  let gray = D.toGray(raw.data, raw.width, raw.height), w = raw.width, h = raw.height;
  if (w !== OUTW) { gray = Uint8Array.from(D.areaResize(gray, w, h, OUTW, OUTH)); w = OUTW; h = OUTH; }
  const s = Date.now(); const res = det.detect(gray, w, h); detectMs += Date.now() - s;
  out[f] = { top: [res.top.id, res.top.score, res.top.layout], second: [res.second.id, res.second.score] };
}
fs.writeFileSync(process.env.OUT || '/tmp/claude-0/js-eval.json', JSON.stringify(out));
console.log(`frames ${files.length}, detect avg ${(detectMs / files.length).toFixed(0)} ms at ${OUTW}x${OUTH}, total ${(Date.now() - t0) / 1000}s`);
const ids = Object.fromEntries(meta.agents.map(a => [a.name.replace('/', ''), a.id]));
for (const rule of [[0.55, 0.05], [0.6, 0.05], [0.6, 0.06], [0.62, 0.06], [0.65, 0.06], [0.6, 0.08], [0.65, 0.08], [0.7, 0.08]]) {
  for (const [label, rounds] of [['all', ['r1', 'r2', 'r3']]]) {
    let bar = 0, ok = 0, wrong = 0, nob = 0, fp = 0;
    for (const f of files) {
      if (!rounds.includes(f.split('/')[1])) continue;
      const l = labels[f], p = out[f]; const m = p.top[1] - p.second[1];
      const g = p.top[1] >= rule[0] && m >= rule[1] ? p.top[0] : null;
      if (l.bar) { bar++; if (g === ids[l.agent]) ok++; else if (g) wrong++; } else { nob++; if (g) fp++; }
    }
    console.log(`min ${rule[0]} margin ${rule[1]} ${label}: bar ${bar} correct ${ok} (${(100 * ok / bar).toFixed(1)}%) wrong ${wrong} | no-bar ${nob} false ${fp}`);
  }
}
