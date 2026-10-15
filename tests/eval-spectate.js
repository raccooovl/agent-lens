const fs = require('fs'); const path = require('path'); const jpeg = require('jpeg-js');
const D = require('../extension/detector.js');
const VAL = '/home/claude/val';
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/data/agents.json')));
const det = D.createDetector(meta, new Uint8Array(fs.readFileSync(path.join(__dirname, '../extension/data/icons.bin'))));
const spec = D.createSpectateCheck(meta, new Uint8Array(fs.readFileSync(path.join(__dirname, '../extension/data/portraits.bin'))));
const labels = {}; for (const r of ['r1', 'r2', 'r3']) Object.assign(labels, JSON.parse(fs.readFileSync(path.join(VAL, `labels_${r}.json`))));
const W = +(process.env.W || 1920), H = W * 9 / 16; const out = []; let ms = 0;
for (const [f, l] of Object.entries(labels).sort()) {
  if (!l.bar) continue;
  const raw = jpeg.decode(fs.readFileSync(path.join(VAL, f)), { useTArray: true, formatAsRGBA: true });
  let gray = D.toGray(raw.data, raw.width, raw.height);
  if (W !== raw.width) gray = Uint8Array.from(D.areaResize(gray, raw.width, raw.height, W, H));
  const d = det.decide(det.detect(gray, W, H));
  if (!d) continue;
  const t = Date.now(); const s = spec.check(gray, W, H, d.agent, d.layout); ms += Date.now() - t;
  out.push([s.score, f, d.agent, s.spectating]);
}
out.sort((a, b) => b[0] - a[0]);
console.log(`checked ${out.length}, avg ${(ms / out.length).toFixed(1)} ms, spectating ${out.filter(o => o[3]).length}`);
for (const o of out.slice(0, 40)) console.log(o[0].toFixed(3), o[1], o[2], o[3]);
