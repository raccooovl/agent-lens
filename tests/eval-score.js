const fs = require('fs'); const path = require('path'); const jpeg = require('jpeg-js');
const D = require(process.env.DET || '../extension/detector.js');
const VAL = '/home/claude/val';
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/data/agents.json')));
const det = D.createDetector(meta, new Uint8Array(fs.readFileSync(path.join(__dirname, '../extension/data/icons.bin'))));
const reader = D.createScoreReader(JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/data/digits.json'))));
const truth = [];
for (const [r, file] of [['r1', 'truth_score.json'], ['r2', 'truth_score_r2.json']]) {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(VAL, file))))) truth.push([`img/${r}/${k}.jpg`, v.length === 3 ? [v[0], v[2]] : v]);
}
function resizeRGBA(src, w, h, W, H) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let c = 0; c < 4; c++) {
    const ch = new Float32Array(w * h); for (let i = 0; i < w * h; i++) ch[i] = src[i * 4 + c];
    const r = D.areaResize(ch, w, h, W, H); for (let i = 0; i < W * H; i++) out[i * 4 + c] = r[i];
  }
  return out;
}
for (const W of [1920, 1280]) {
  const H = W * 9 / 16; let read = 0, wrong = 0, n = 0;
  for (const [f, v] of truth) {
    if (!fs.existsSync(path.join(VAL, f))) continue;
    const raw = jpeg.decode(fs.readFileSync(path.join(VAL, f)), { useTArray: true, formatAsRGBA: true });
    const rgba = W === raw.width ? raw.data : resizeRGBA(raw.data, raw.width, raw.height, W, H);
    const gray = D.toGray(rgba, W, H); const d = det.decide(det.detect(gray, W, H));
    const s = reader.read(rgba, W, H, d && d.layout); n++;
    if (s) { read++; if (s.left !== v[0] || s.right !== v[1]) { wrong++; console.log('WRONG', W, f, v, s); } }
  }
  console.log(`${W}: read ${read}/${n}, wrong ${wrong}`);
}
