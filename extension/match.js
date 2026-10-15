// Agent Lens: which streams are in the same match, from what each stream's preview showed: both teams' agents
// (the portraits at the top of the game display) and the round score. Used by the Twitch page script; pure
// functions, also loaded by the tests.
(function (root) {
  'use strict';
  const RECENT_MS = 10 * 60 * 1000;     // team comps older than this aren't compared
  const APART_MS = 6 * 60 * 1000;       // two streams' comps must be seen within this of each other
  const ROUND_MS = 90 * 1000;           // a round takes at least about this long

  const known = side => (side || []).filter(Boolean);
  // 'team' (same side), 'opponents', or null. Calibrated on 1,009 live previews in 8 rounds of captures: every
  // pair it accepted was checked by eye. A shared agent or two is common (popular agents), so it takes three
  // or more on each side, agreeing scores, and no team seen in full on both streams that differs.
  function relation(a, b, now = Date.now()) {
    const ca = a && a.comp, cb = b && b.comp;
    if (!ca || !cb || now - ca.at > RECENT_MS || now - cb.at > RECENT_MS || Math.abs(ca.at - cb.at) > APART_MS) return null;
    const La = known(ca.left), Ra = known(ca.right), Lb = known(cb.left), Rb = known(cb.right);
    if (La.length + Ra.length < 4 || Lb.length + Rb.length < 4) return null;
    let best = null;
    for (const [kind, X2, Y2] of [['team', Lb, Rb], ['opponents', Rb, Lb]]) {
      const o1 = La.filter(x => X2.includes(x)).length, o2 = Ra.filter(x => Y2.includes(x)).length;
      if (o1 < 3 || o2 < 3) continue;
      const full = (p, q) => p.length === 5 && q.length === 5 && p.some(x => !q.includes(x));
      if (full(La, X2) || full(Ra, Y2)) continue;
      if (a.score && b.score && Number.isFinite(a.scoreAt) && Number.isFinite(b.scoreAt)) {
        // The later picture may be a round or two further on; never behind.
        const sb = kind === 'team' ? b.score : { left: b.score.right, right: b.score.left };
        const [early, late] = a.scoreAt <= b.scoreAt ? [a.score, sb] : [sb, a.score];
        const dl = late.left - early.left, dr = late.right - early.right;
        if (dl < 0 || dr < 0 || dl + dr > 1 + Math.floor(Math.abs(a.scoreAt - b.scoreAt) / ROUND_MS)) continue;
      } else if (o1 + o2 < 9) continue;   // without both scores, only near-identical comps count
      if (!best || o1 + o2 > best.overlap) best = { kind, overlap: o1 + o2 };
    }
    return best && best.kind;
  }

  // results: Map or object of login -> result. Returns groups of logins in the same match, each member with
  // its side relative to the group's first member ('team' or 'opponents'), largest groups first.
  function groups(results, now = Date.now()) {
    const entries = (results instanceof Map ? [...results.entries()] : Object.entries(results || {}))
      .filter(([, r]) => r && r.comp && now - r.comp.at <= RECENT_MS);
    const parent = new Map(entries.map(([l]) => [l, l]));
    const find = l => { while (parent.get(l) !== l) { parent.set(l, parent.get(parent.get(l))); l = parent.get(l); } return l; };
    const edges = [];
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const kind = relation(entries[i][1], entries[j][1], now);
      if (kind) { edges.push([entries[i][0], entries[j][0], kind]); parent.set(find(entries[i][0]), find(entries[j][0])); }
    }
    const byRoot = new Map();
    for (const [l] of entries) { const r = find(l); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(l); }
    const out = [];
    for (const members of byRoot.values()) {
      if (members.length < 2) continue;
      members.sort();
      // Side of each member relative to the first, through the links found.
      const side = new Map([[members[0], 'team']]), queue = [members[0]];
      while (queue.length) {
        const cur = queue.shift();
        for (const [x, y, kind] of edges) {
          const other = x === cur ? y : y === cur ? x : null;
          if (!other || side.has(other)) continue;
          side.set(other, kind === 'team' ? side.get(cur) : side.get(cur) === 'team' ? 'opponents' : 'team');
          queue.push(other);
        }
      }
      out.push(members.map(login => ({ login, side: side.get(login) || 'team' })));
    }
    return out.sort((a, b) => b.length - a.length);
  }

  const api = { relation, groups };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgentLensMatch = api;
})(typeof self !== 'undefined' ? self : this);
