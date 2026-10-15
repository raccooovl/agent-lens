// Adds the agent select word templates (map names and modes) to extension/data/states.json, from the labelled
// box crops in tools/state-refs/select-boxes/. Usage: node tools/build-words.cjs [--eval]   (needs jpeg-js)
// --eval: leave-one-out check: each box read with templates built from the others.
const fs = require('fs'), path = require('path'), jpeg = require('jpeg-js');
const D = require('../extension/detector.js');
const DATA = path.join(__dirname, '../extension/data/states.json');
const DIR = path.join(__dirname, 'state-refs/select-boxes');
const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
const MAPS = { '劫境之地': 'bind', '晶蝕之地': 'corrode' };
const MODES = { COMPETITIVE: 'competitive', 'COMPÉTITION': 'competitive', COMPETITIVO: 'competitive', '競技模式': 'competitive', UNRATED: 'unrated', SWIFTPLAY: 'swiftplay' };
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
delete data.words;
const st = D.createStateCheck(data);
// Each crop is the picture's area x 0-640, y 120-230 at full HD: put it back in a blank full-HD picture.
function vectors(item) {
  const raw = jpeg.decode(fs.readFileSync(path.join(DIR, item.file)), { useTArray: true, formatAsRGBA: true });
  const rgba = new Uint8ClampedArray(1920 * 1080 * 4);
  for (let y = 0; y < raw.height; y++) rgba.set(raw.data.subarray(y * raw.width * 4, (y + 1) * raw.width * 4), ((120 + y) * 1920) * 4);
  return st.selectWords(rgba, 1920, 1080, item.stretch || 1);
}
const items = labels.map(item => ({ ...item, vec: vectors(item) })).filter(x => x.vec);
function build(list) {
  const words = [];
  for (const [line, key, table] of [['name', 'map', null], ['mode', 'mode', MODES]]) {
    const byText = new Map();
    for (const it of list) { const text = it[key]; if (!it.vec[line]) continue; if (!byText.has(text)) byText.set(text, []); byText.get(text).push(it.vec[line]); }
    for (const [text, vecs] of byText) {
      const avg = new Float32Array(vecs[0].length); vecs.forEach(v => v.forEach((x, i) => { avg[i] += x / vecs.length; }));
      let n = 0; avg.forEach(x => { n += x * x; }); n = Math.sqrt(n) || 1;
      const value = table ? table[text] : (MAPS[text] || text.toLowerCase());
      // Stored as signed bytes (x 127), base64.
      const q = Int8Array.from(avg, x => Math.max(-127, Math.min(127, Math.round(x / n * 127))));
      words.push({ line, text, value, vec: Buffer.from(q.buffer).toString('base64') });
    }
  }
  return words;
}
if (process.argv.includes('--eval')) {
  let ok = 0, wrong = 0, none = 0; const notes = [];
  for (let i = 0; i < items.length; i++) {
    const words = build(items.filter((_, j) => j !== i));
    const check = D.createStateCheck({ ...data, words: words.map(w => ({ ...w })) });
    const it = items[i];
    for (const [line, key, table] of [['name', 'map', null], ['mode', 'mode', MODES]]) {
      const want = table ? table[it[key]] : (MAPS[it[key]] || it[key].toLowerCase());
      if (!words.some(w => w.line === line && w.value === want)) { notes.push(`${it.file} ${line}: ${it[key]} has no other example`); continue; }
      const got = check.matchWord(line, it.vec[line]);
      if (got === want) ok++; else if (got) { wrong++; notes.push(`${it.file} ${line}: ${got} instead of ${want}`); } else { none++; notes.push(`${it.file} ${line}: not read (${want})`); }
    }
  }
  console.log(`leave-one-out: ${ok} right, ${wrong} wrong, ${none} not read`); console.log(notes.join('\n'));
} else {
  data.words = build(items);
  fs.writeFileSync(DATA, JSON.stringify(data, null, 0));
  console.log(`${data.words.length} words from ${items.length} boxes -> ${DATA}`);
}
