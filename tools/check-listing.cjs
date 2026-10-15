'use strict';
// Checks the store listing before it's pasted into the Chrome Web Store and Edge Add-ons dashboards:
// store limits, Riot's required "Legal Jibber Jabber" notice everywhere the project is shared, keyword
// repetition, Edge search terms without Riot names, and the size of every store image.
// Run: node tools/check-listing.cjs   (exits with 1 and lists the problems if anything is off)
const fs = require('node:fs');
const path = require('node:path');
const { languages, messages } = require('./messages.cjs');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const problems = [], notes = [];
// Riot's policy, section 6: this exact notice, naming the project, wherever it's shared.
const NOTICE = 'Agent Lens was created under Riot Games\' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.';
const AGENTS = JSON.parse(read('extension/data/agents.json')).agents.map(agent => agent.name.toLowerCase());

// Name and summary come from the package.
for (const [key, limit] of [['extName', 75], ['extDescription', 132]])
  messages[key].forEach((value, i) => { if ([...value].length > limit) problems.push(`${key} [${languages[i]}]: ${[...value].length} characters, the store limit is ${limit}`); });

// One section per language in STORE-LISTING.md.
const listing = read('STORE-LISTING.md');
const sections = new Map([...listing.matchAll(/^## .+\((\w+)\)\s*$([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map(m => [m[1], m[2]]));
for (const language of languages) {
  const section = sections.get(language);
  if (!section) { problems.push(`STORE-LISTING.md: no section for ${language}`); continue; }
  const description = (/### Detailed description\s*([\s\S]*?)(?=^### |(?![\s\S]))/m.exec(section) || [])[1]?.replace(/\n---\s*$/, '').trim() || '';
  const terms = [...((/### Edge search terms\s*([\s\S]*?)(?=^### |^---|(?![\s\S]))/m.exec(section) || [])[1] || '').matchAll(/^- (.+)$/gm)].map(m => m[1].trim());
  const where = `STORE-LISTING.md [${language}]`;
  if (description.length < 250 || description.length > 10000) problems.push(`${where}: description is ${description.length} characters; Edge needs 250 to 10,000`);
  if (!description.includes(NOTICE)) problems.push(`${where}: description lacks Riot's notice`);
  // Chrome's spam policy names repeating a keyword more than five times; keep VALORANT to a few natural uses.
  const valorant = (description.replace(NOTICE, '').match(/valorant/gi) || []).length;
  if (valorant > 3) problems.push(`${where}: VALORANT appears ${valorant} times in the description; keep it to 3 or fewer`);
  if (!terms.length) problems.push(`${where}: no Edge search terms`);
  if (terms.length > 7) problems.push(`${where}: ${terms.length} Edge search terms; the limit is 7`);
  const words = terms.join(' ').split(/\s+/).filter(Boolean).length;
  if (words > 21) problems.push(`${where}: Edge search terms have ${words} words; the limit is 21`);
  for (const term of terms) {
    if ([...term].length > 30) problems.push(`${where}: search term "${term}" is over 30 characters`);
    // Riot's policy, section 5: its names may not be used as keywords or search tags.
    const riotName = ['valorant', 'riot', ...AGENTS].find(name => new RegExp(`\\b${name}\\b`, 'i').test(term));
    if (riotName) problems.push(`${where}: search term "${term}" uses the Riot name "${riotName}"`);
  }
  notes.push(`${language}: ${description.length} characters, VALORANT ×${valorant}, ${terms.length} search terms (${words} words)`);
}

// The notice must also be on the project's own pages.
for (const file of ['README.md', 'docs/index.html', 'docs/privacy.html'])
  if (!fs.existsSync(path.join(ROOT, file))) problems.push(`${file}: missing`);
  else if (!read(file).replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '\'').replace(/\s+/g, ' ').includes(NOTICE)) problems.push(`${file}: lacks Riot's notice`);

// Store images, with their exact sizes.
function pngSize(file) {
  const data = fs.readFileSync(file);
  if (data.toString('ascii', 1, 4) !== 'PNG') return null;
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}
const images = [
  ...languages.flatMap(language => ['1-agents', '2-filter', '3-teams', '4-why', '5-popup'].map(name => [`store-assets/${language}/${name}.png`, 1280, 800])),
  ['store-assets/promo/small-tile-440x280.png', 440, 280], ['store-assets/promo/marquee-1400x560.png', 1400, 560], ['store-assets/promo/logo-300x300.png', 300, 300]
];
for (const [file, width, height] of images) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { problems.push(`${file}: missing (run node tools/store-assets.cjs)`); continue; }
  const size = pngSize(full);
  if (!size || size[0] !== width || size[1] !== height) problems.push(`${file}: ${size ? size.join('x') : 'not a PNG'}, should be ${width}x${height}`);
}

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(notes.join('\n') + `\nStore listing OK: ${languages.length} languages, ${images.length} images, Riot notice in place.`);
