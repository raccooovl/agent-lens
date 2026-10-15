// Accuracy of the streamer's own agent on the hand-labelled set, counting spectating previews separately.
const fs = require('fs'); const path = require('path'); const jpeg = require('jpeg-js');
const D = require('../extension/detector.js');
const VAL = process.env.VAL || '/home/claude/val';
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/data/agents.json')));
const det = D.createDetector(meta, new Uint8Array(fs.readFileSync(path.join(__dirname, '../extension/data/icons.bin'))));
const spec = D.createSpectateCheck(meta, new Uint8Array(fs.readFileSync(path.join(__dirname, '../extension/data/portraits.bin'))));
const labels = {}; for (const r of ['r1', 'r2', 'r3']) Object.assign(labels, JSON.parse(fs.readFileSync(path.join(VAL, `labels_${r}.json`))));
// Spectating previews found by eye (teammate picture bottom-left).
const SPECT = new Set(fs.readFileSync(path.join(__dirname, 'fixtures/spectating.txt'), 'utf8').split('\n').filter(Boolean));
const ids = Object.fromEntries(meta.agents.map(a => [a.name.replace('/', ''), a.id]));
for (const W of (process.env.WIDTHS || "1920,1600,1280").split(",").map(Number)) {
  const H = W * 9 / 16; let own = 0, ownOk = 0, ownWrong = 0, sp = 0, spFlag = 0, spAsOwn = 0, nob = 0, fp = 0;
  for (const [f, l] of Object.entries(labels)) {
    const raw = jpeg.decode(fs.readFileSync(path.join(VAL, f)), { useTArray: true, formatAsRGBA: true });
    let gray = D.toGray(raw.data, raw.width, raw.height);
    if (W !== raw.width) gray = Uint8Array.from(D.areaResize(gray, raw.width, raw.height, W, H));
    const d = det.decide(det.detect(gray, W, H));
    const watching = d ? spec.check(gray, W, H, d.agent, d.layout).spectating : false;
    const ownGuess = d && !watching ? d.agent : null;
    if (!l.bar) { nob++; if (ownGuess) fp++; continue; }
    if (SPECT.has(f)) { sp++; if (watching) spFlag++; if (ownGuess) spAsOwn++; continue; }
    own++; if (ownGuess === ids[l.agent]) ownOk++; else if (ownGuess) ownWrong++;
  }
  console.log(`${W}: own-agent previews ${own}: correct ${ownOk} (${(100 * ownOk / own).toFixed(1)}%), wrong ${ownWrong} | spectating ${sp}: flagged ${spFlag}, mistaken for own ${spAsOwn} | no bar ${nob}: agent named ${fp}`);
}
