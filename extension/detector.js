// Agent Lens detector: reads which VALORANT agent a stream shows from a still preview image.
// It compares the four ability icons in the bottom-centre HUD with the official icons,
// at the few HUD layouts players actually use (normal, and 4:3 or 5:4 resolutions stretched to 16:9).
// Pure JavaScript, no dependencies; runs in the service worker and in Node for tests.
(function (root) {
  'use strict';

  // HUD geometry measured on 1920x1080 frames: the ability icons sit on a 48 px canvas,
  // 113 px apart, centred on x = 960 and y = 1004.
  const FRAME = { cx: 960, cy: 1004, canvas: 48, spacing: 113 };
  // u: game picture scale inside the stream (streamers sometimes shrink it for overlays);
  // s: horizontal stretch from playing at 4:3, 5:4 or 16:10 on a 16:9 stream;
  // anchor: where a shrunk game picture sits (bottom-centre, top-left or centred).
  const LAYOUTS = [
    { u: 1, s: 1, anchor: 'bottom' }, { u: 1, s: 4 / 3, anchor: 'bottom' }, { u: 1, s: 1.11, anchor: 'bottom' }, { u: 1, s: 1.22, anchor: 'bottom' },
    { u: 0.96, s: 1, anchor: 'bottom' }, { u: 0.92, s: 1, anchor: 'bottom' },
    { u: 0.96, s: 1, anchor: 'center' }, { u: 0.92, s: 1, anchor: 'center' },
    { u: 0.96, s: 1, anchor: 'topleft' }, { u: 0.92, s: 1, anchor: 'topleft' }
  ];
  function slotCentre(layout, slot) {
    const { u, s, anchor } = layout;
    const dx = (slot - 1.5) * FRAME.spacing * u * s;
    if (anchor === 'topleft') return [FRAME.cx * u + dx, FRAME.cy * u];
    if (anchor === 'center') return [FRAME.cx + dx, 540 + (FRAME.cy - 540) * u];
    return [FRAME.cx + dx, 1080 - (1080 - FRAME.cy) * u];
  }
  const WORK_CANVAS = 20;      // template size the search runs at, in pixels
  const BAND = { x0: 480, x1: 1440, y0: 880, y1: 1072 };
  const JITTER = 9;            // frame pixels searched around each expected icon centre
  // Two-step search: a quick look at half detail everywhere, then full detail for the likeliest agents and layouts.
  const COARSE = 0.5;
  const ROUGH = { gate: 0.40, window: 0.25, agents: 6, layouts: 3 };

  // A reusable work buffer, so the hot loops don't allocate on every preview.
  let scratchBuf = new Float32Array(1024);
  function scratch(n) { if (scratchBuf.length < n) scratchBuf = new Float32Array(n); return scratchBuf; }
  function areaResize(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh);
    if (sw === 2 * dw && sh === 2 * dh) {            // exact halving: plain 2x2 averages
      for (let y = 0; y < dh; y++) {
        const r0 = 2 * y * sw, r1 = r0 + sw;
        for (let x = 0; x < dw; x++) out[y * dw + x] = (src[r0 + 2 * x] + src[r0 + 2 * x + 1] + src[r1 + 2 * x] + src[r1 + 2 * x + 1]) / 4;
      }
      return out;
    }
    const fx = sw / dw, fy = sh / dh;
    for (let y = 0; y < dh; y++) {
      const sy0 = y * fy, sy1 = sy0 + fy;
      const iy0 = Math.floor(sy0), iy1 = Math.min(sh, Math.ceil(sy1));
      for (let x = 0; x < dw; x++) {
        const sx0 = x * fx, sx1 = sx0 + fx;
        const ix0 = Math.floor(sx0), ix1 = Math.min(sw, Math.ceil(sx1));
        let sum = 0, area = 0;
        for (let yy = iy0; yy < iy1; yy++) {
          const wy = Math.min(yy + 1, sy1) - Math.max(yy, sy0);
          if (wy <= 0) continue;
          const row = yy * sw;
          for (let xx = ix0; xx < ix1; xx++) {
            const wx = Math.min(xx + 1, sx1) - Math.max(xx, sx0);
            if (wx <= 0) continue;
            sum += src[row + xx] * wx * wy; area += wx * wy;
          }
        }
        out[y * dw + x] = area ? sum / area : 0;
      }
    }
    return out;
  }

  // Grey levels from RGBA pixels, weighted like the human eye (and OpenCV).
  function toGray(rgba, width, height) {
    const out = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
    return out;
  }

  const PERMS = [];
  (function permute(prefix, rest) {
    if (!rest.length) { PERMS.push(prefix); return; }
    rest.forEach((v, i) => permute(prefix.concat(v), rest.slice(0, i).concat(rest.slice(i + 1))));
  })([], [0, 1, 2, 3]);

  // Optional WebAssembly kernel (data/kernel.wasm): the template comparisons four at a time. Memory layout:
  // [0, 16K) patch, [16K, 32K) template indexes, [32K, 64K) results, then the templates of each size.
  const K_PATCH = 0, K_IDX = 16384, K_OUT = 32768, K_TEMPLATES = 65536;
  function kernelMemory(kernel) {
    let top = K_TEMPLATES;
    return {
      alloc(bytes) {
        const at = top; top = (top + bytes + 15) & ~15;
        const need = top - kernel.memory.buffer.byteLength;
        if (need > 0) kernel.memory.grow(Math.ceil(need / 65536));
        return at;
      },
      f32: () => new Float32Array(kernel.memory.buffer), f64: () => new Float64Array(kernel.memory.buffer), i32: () => new Int32Array(kernel.memory.buffer)
    };
  }
  function createDetector(meta, bin, options = {}) {
    const kernel = options.kernel || null, kmem = kernel ? kernelMemory(kernel) : null;
    const N = meta.size;
    const bytes = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
    const agents = meta.agents.map(a => ({ id: a.id, name: a.name, role: a.role }));
    const icons = [];
    meta.agents.forEach((a, ai) => {
      for (const icon of a.icons) {
        const alpha = new Float32Array(N * N);
        for (let i = 0; i < N * N; i++) alpha[i] = bytes[icon.offset + i] / 255;
        icons.push({ agent: ai, slot: icon.slot, alpha });
      }
    });
    const templateCache = new Map();

    function templates(tw, th) {
      const key = tw + 'x' + th;
      if (templateCache.has(key)) return templateCache.get(key);
      const n = tw * th, packed = new Float32Array(icons.length * n), norms = new Float64Array(icons.length);
      icons.forEach((icon, i) => {
        const t = areaResize(icon.alpha, N, N, tw, th);
        let mean = 0; for (let j = 0; j < t.length; j++) mean += t[j]; mean /= t.length;
        let norm = 0; for (let j = 0; j < t.length; j++) { t[j] -= mean; norm += t[j] * t[j]; }
        packed.set(t, i * n); norms[i] = Math.sqrt(norm);
      });
      const set = { packed, norms, n };
      if (kernel) {
        // Copy into the kernel's memory, each template zero-padded to a multiple of four values.
        const n4 = (n + 3) & ~3; set.n4 = n4;
        set.ptr = kmem.alloc(icons.length * n4 * 4); set.normsPtr = kmem.alloc(icons.length * 8);
        const f32 = kmem.f32(), f64 = kmem.f64();
        for (let i = 0; i < icons.length; i++) f32.set(packed.subarray(i * n, i * n + n), set.ptr / 4 + i * n4);
        f64.set(norms, set.normsPtr / 8);
      }
      templateCache.set(key, set);
      return set;
    }

    // A working image with summed-area tables for fast patch means and variances.
    function prepare(img, bw, bh) {
      const W1 = bw + 1;
      const S = new Float64Array(W1 * (bh + 1)), Q = new Float64Array(W1 * (bh + 1));
      for (let y = 0; y < bh; y++) {
        let rs = 0, rq = 0;
        for (let x = 0; x < bw; x++) {
          const v = img[y * bw + x]; rs += v; rq += v * v;
          S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + rs;
          Q[(y + 1) * W1 + x + 1] = Q[y * W1 + x + 1] + rq;
        }
      }
      return { img, bw, bh, W1, S, Q };
    }
    // For each slot (a corner where an icon should be) and each listed template: the best correlation within
    // `radius` of that corner. Patch-major: each candidate patch is measured and copied once, then compared
    // with all templates (a small matrix product, the part a faster kernel can take over).
    function bestScores(P, set, tw, th, corners, radius, tIdx) {
      const { img, bw, bh, W1, S, Q } = P, n = tw * th, T = tIdx.length;
      if (kernel && set.n4 * 4 <= K_IDX - K_PATCH && T * 4 <= K_OUT - K_IDX && corners.length * T * 8 <= K_TEMPLATES - K_OUT) return bestScoresKernel(P, set, tw, th, corners, radius, tIdx);
      const out = new Float64Array(corners.length * T).fill(-1);
      const patch = scratch(n), packed = set.packed, norms = set.norms;
      for (let c = 0; c < corners.length; c++) {
        const [x0, y0] = corners[c], row = c * T;
        for (let dy = -radius; dy <= radius; dy++) {
          const py = y0 + dy; if (py < 0 || py + th > bh) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const px = x0 + dx; if (px < 0 || px + tw > bw) continue;
            const a = py * W1 + px, b = a + tw, cc = (py + th) * W1 + px, d = cc + tw;
            const sum = S[d] - S[b] - S[cc] + S[a], sq = Q[d] - Q[b] - Q[cc] + Q[a];
            const varp = sq - sum * sum / n;
            if (varp < n * 4) continue;              // flat patch: nothing drawn here
            for (let yy = 0, k = 0; yy < th; yy++) { const ro = (py + yy) * bw + px; for (let xx = 0; xx < tw; xx++) patch[k++] = img[ro + xx]; }
            const sd = Math.sqrt(varp);
            for (let j = 0; j < T; j++) {
              const t = tIdx[j], base = t * n;
              let dot = 0;
              for (let i = 0; i < n; i++) dot += patch[i] * packed[base + i];
              const ncc = dot / (sd * norms[t]);
              if (ncc > out[row + j]) out[row + j] = ncc;
            }
          }
        }
      }
      return out;
    }
    function bestScoresKernel(P, set, tw, th, corners, radius, tIdx) {
      const { img, bw, bh, W1, S, Q } = P, n = tw * th, T = tIdx.length, n4 = set.n4;
      const f32 = kmem.f32(), f64 = kmem.f64();
      kmem.i32().set(tIdx, K_IDX / 4);
      f64.fill(-1, K_OUT / 8, K_OUT / 8 + corners.length * T);
      f32.fill(0, K_PATCH / 4 + n, K_PATCH / 4 + n4);
      for (let c = 0; c < corners.length; c++) {
        const [x0, y0] = corners[c], outAt = K_OUT + c * T * 8;
        for (let dy = -radius; dy <= radius; dy++) {
          const py = y0 + dy; if (py < 0 || py + th > bh) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const px = x0 + dx; if (px < 0 || px + tw > bw) continue;
            const a = py * W1 + px, b = a + tw, cc = (py + th) * W1 + px, d = cc + tw;
            const sum = S[d] - S[b] - S[cc] + S[a], sq = Q[d] - Q[b] - Q[cc] + Q[a];
            const varp = sq - sum * sum / n;
            if (varp < n * 4) continue;              // flat patch: nothing drawn here
            for (let yy = 0, k = K_PATCH / 4; yy < th; yy++) { const ro = (py + yy) * bw + px; f32.set(img.subarray(ro, ro + tw), k); k += tw; }
            kernel.update(K_PATCH, n4, set.ptr, set.normsPtr, K_IDX, T, Math.sqrt(varp), outAt);
          }
        }
      }
      return f64.slice(K_OUT / 8, K_OUT / 8 + corners.length * T);
    }
    // Best way to place an agent's four icons in the four slots (each slot used once); the score
    // is the mean of the three best placed icons, as one icon may be greyed out or covered.
    function assign(m) {
      let bestScore = -1;
      for (const perm of PERMS) {
        const v = [m[0][perm[0]], m[1][perm[1]], m[2][perm[2]], m[3][perm[3]]].sort((p, q) => q - p);
        const sc = (v[0] + v[1] + v[2]) / 3;
        if (sc > bestScore) bestScore = sc;
      }
      return bestScore;
    }
    const iconsOf = agents.map((_, ai) => icons.map((icon, t) => (icon.agent === ai ? t : -1)).filter(t => t >= 0));
    // Scores of the given agents at one layout, on one working image (f: its scale against the fine image).
    function scoreLayout(P, layout, f, agentList, toWork, jitter) {
      const th = Math.max(4, Math.round(WORK_CANVAS * f * layout.u)), tw = Math.max(4, Math.round(WORK_CANVAS * f * layout.u * layout.s));
      const set = templates(tw, th);
      const corners = [0, 1, 2, 3].map(slot => {
        const [fx, fy] = slotCentre(layout, slot); const [wx, wy] = toWork(fx, fy);
        return [Math.round(wx * f - tw / 2), Math.round(wy * f - th / 2)];
      });
      const radius = Math.max(1, Math.round(jitter * f));
      const tIdx = []; for (const ai of agentList) for (const t of iconsOf[ai]) tIdx.push(t);
      const scores = bestScores(P, set, tw, th, corners, radius, tIdx), T = tIdx.length;
      let j = 0;
      return agentList.map(ai => {
        const m = iconsOf[ai].map(() => { const row = [0, 1, 2, 3].map(c => scores[c * T + j]); j++; return row; });
        return m.length < 4 ? -1 : assign(m);
      });
    }

    // gray: Uint8Array of width*height grey levels of a 16:9 frame (any size from 960x540 up).
    // Only the bottom band of the picture is read.
    function detect(gray, width, height) {
      const k = width / 1920;
      const r = WORK_CANVAS / (FRAME.canvas * k);
      const sx = Math.round(BAND.x0 * k), sy = Math.round(BAND.y0 * height / 1080);
      const sw = Math.round((BAND.x1 - BAND.x0) * k), sh = Math.round((BAND.y1 - BAND.y0) * height / 1080);
      // Copy the band, then shrink it to working size.
      const band = new Float32Array(sw * sh);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) band[y * sw + x] = gray[(sy + y) * width + sx + x];
      const bw = Math.round(sw * r), bh = Math.round(sh * r);
      const fine = prepare(areaResize(band, sw, sh, bw, bh), bw, bh);
      const cw = Math.round(bw * COARSE), ch = Math.round(bh * COARSE);
      const coarse = prepare(areaResize(fine.img, bw, bh, cw, ch), cw, ch);
      const toWork = (fx, fy) => [(fx - BAND.x0) * k * r, (fy - BAND.y0) * (height / 1080) * r];
      const jitter = Math.max(2, Math.round(JITTER * k * r));
      const all = agents.map((_, i) => i);

      // 1. A quick look at half detail at every layout, for every agent.
      const rough = LAYOUTS.map(layout => scoreLayout(coarse, layout, COARSE, all, toWork, jitter));
      let roughBest = -1;
      for (const row of rough) for (const v of row) if (v > roughBest) roughBest = v;
      const best = new Float32Array(agents.length).fill(-1);
      const bestLayout = new Array(agents.length).fill(null);
      // 2. Full detail only where the quick look found something like an ability bar.
      if (roughBest >= ROUGH.gate) {
        // The best few layouts, and at each the agents scoring highest there (always several, so the
        // runner-up score that the decision's margin is measured against is a real one).
        const layoutTop = rough.map((row, li) => ({ li, v: Math.max(...row) })).filter(l => l.v >= roughBest - ROUGH.window)
          .sort((p, q) => q.v - p.v).slice(0, ROUGH.layouts).sort((p, q) => p.li - q.li);
        const byLayout = new Map(layoutTop.map(({ li }) => [li, rough[li].map((v, ai) => ({ v, ai })).sort((p, q) => q.v - p.v).slice(0, ROUGH.agents).map(x => x.ai)]));
        for (const [li, set] of byLayout) {
          const list = set;
          const scores = scoreLayout(fine, LAYOUTS[li], 1, list, toWork, jitter);
          list.forEach((ai, j) => { if (scores[j] > best[ai]) { best[ai] = scores[j]; bestLayout[ai] = LAYOUTS[li]; } });
          // Layouts are tried in order of how common they are: stop at the first clear-cut answer.
          const sorted = Array.from(best).sort((p, q) => q - p);
          if (sorted[0] >= 0.75 && sorted[0] - sorted[1] >= 0.15) break;
        }
      }
      const ranked = agents.map((a, i) => ({ id: a.id, name: a.name, role: a.role, score: best[i], layout: bestLayout[i] }))
        .sort((p, q) => q.score - p.score);
      return { top: ranked[0], second: ranked[1], ranked };
    }

    // The decision rule, calibrated on 321 hand-checked previews (no wrong agents at these settings).
    function decide(result, rule = { min: 0.62, margin: 0.06 }) {
      const { top, second } = result;
      const margin = top.score - second.score;
      return top.score >= rule.min && margin >= rule.margin
        ? { agent: top.id, name: top.name, role: top.role, confidence: top.score, margin, layout: top.layout } : null;
    }

    return { detect, decide, agents };
  }


  // ---- Round score (the two numbers either side of the round timer) ----
  // Glyphs are cut out of each score box and compared with digit shapes taken from Valorant's HUD font.
  function frameToStream(layout, X, Y) {
    const { u, s, anchor } = layout || { u: 1, s: 1, anchor: 'bottom' };
    if (anchor === 'topleft') return [960 * u + (X - 960) * u * s, Y * u];
    if (anchor === 'center') return [960 + (X - 960) * u * s, 540 + (Y - 540) * u];
    return [960 + (X - 960) * u * s, 1080 - (1080 - Y) * u];
  }
  // Minimum (or maximum) over a (2r+1)x(2r+1) square, clamped at the edges. Van Herk/Gil-Werman:
  // three comparisons per pixel whatever the radius.
  function minFilter(src, w, h, r, max) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const k = 2 * r + 1, pad = max ? -Infinity : Infinity;
    const longest = Math.max(w, h), padded = Math.ceil((longest + 2 * r) / k) * k;
    const line = new Float32Array(padded), g = new Float32Array(padded), hh = new Float32Array(padded);
    // One line (row or column) at a time: copy in with padding, then block-wise prefix and suffix extremes.
    function run(input, output, start, step, len) {
      const n = Math.ceil((len + 2 * r) / k) * k;
      line.fill(pad, 0, n);
      for (let i = 0, p = start; i < len; i++, p += step) line[i + r] = input[p];
      for (let b0 = 0; b0 < n; b0 += k) {
        let m = line[b0]; g[b0] = m;
        for (let i = b0 + 1; i < b0 + k; i++) { const v = line[i]; m = max ? (v > m ? v : m) : (v < m ? v : m); g[i] = m; }
        m = line[b0 + k - 1]; hh[b0 + k - 1] = m;
        for (let i = b0 + k - 2; i >= b0; i--) { const v = line[i]; m = max ? (v > m ? v : m) : (v < m ? v : m); hh[i] = m; }
      }
      for (let i = 0, p = start; i < len; i++, p += step) { const a = hh[i], c = g[i + 2 * r]; output[p] = max ? (a > c ? a : c) : (a < c ? a : c); }
    }
    for (let y = 0; y < h; y++) run(src, tmp, y * w, 1, w);
    for (let x = 0; x < w; x++) run(tmp, out, x, w, h);
    return out;
  }
  function bilinear(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / dh - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
      for (let x = 0; x < dw; x++) {
        const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sw / dw - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
        out[y * dw + x] = (src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx) * (1 - wy) + (src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx) * wy;
      }
    }
    return out;
  }
  function createScoreReader(digitMeta) {
    const TW = digitMeta.w, TH = digitMeta.h;
    const templates = Object.entries(digitMeta.digits).map(([d, values]) => {
      const t = Float32Array.from(values); let m = 0; t.forEach(v => { m += v; }); m /= t.length;
      let n = 0; for (let i = 0; i < t.length; i++) { t[i] -= m; n += t[i] * t[i]; }
      return { d, t, n: Math.sqrt(n) };
    });
    function glyphs(rgba, width, height, cx, cy, halfW, halfH, scale) {
      const x0 = Math.max(0, Math.round(cx - halfW)), x1 = Math.min(width, Math.round(cx + halfW));
      const y0 = Math.max(0, Math.round(cy - halfH)), y1 = Math.min(height, Math.round(cy + halfH));
      const nw = x1 - x0, nh = y1 - y0; if (nw < 6 || nh < 6) return [];
      let v = new Float32Array(nw * nh), sat = new Float32Array(nw * nh);
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const j = ((y0 + y) * width + x0 + x) * 4, r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        v[y * nw + x] = mx; sat[y * nw + x] = mx ? 255 * (mx - mn) / mx : 0;
      }
      // Small previews: enlarge the box to full-HD size so thin strokes survive the thresholds.
      let w = nw, h = nh;
      if (scale < 0.95) {
        w = Math.round(nw / scale); h = Math.round(nh / scale);
        v = bilinear(v, nw, nh, w, h); sat = bilinear(sat, nw, nh, w, h); scale = 1;
      }
      // Bright, colourless strokes that stand out from their surroundings (a white top-hat).
      const rad = Math.max(2, Math.round(7 * scale));
      const opened = minFilter(minFilter(v, w, h, rad, false), w, h, rad, true);
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < mask.length; i++) mask[i] = v[i] - opened[i] >= 35 && v[i] >= 170 && sat[i] < 70 ? 1 : 0;
      const label = new Int32Array(w * h), comps = [];
      let next = 0;
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i] || label[i]) continue;
        next++; const stack = [i]; label[i] = next;
        let minx = w, maxx = 0, miny = h, maxy = 0, area = 0; const pixels = [];
        while (stack.length) {
          const p = stack.pop(), px = p % w, py = (p - px) / w; pixels.push(p); area++;
          if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx; if (mask[q] && !label[q]) { label[q] = next; stack.push(q); }
          }
        }
        const gw = maxx - minx + 1, gh = maxy - miny + 1;
        if (gh >= 15 * scale && gh <= 34 * scale && gw >= 3 * scale && gw <= 26 * scale && area >= 25 * scale * scale)
          comps.push({ minx, miny, gw, gh, id: next });
      }
      comps.sort((a, b) => a.minx - b.minx);
      return comps.map(c => {
        const cw = Math.max(c.gw, Math.round(c.gh * TW / TH));
        const canvas = new Float32Array(cw * c.gh), off = Math.floor((cw - c.gw) / 2);
        for (let y = 0; y < c.gh; y++) for (let x = 0; x < c.gw; x++)
          if (label[(c.miny + y) * w + c.minx + x] === c.id) canvas[y * cw + off + x] = 1;
        return areaResize(canvas, cw, c.gh, TW, TH);
      });
    }
    function classify(g) {
      let m = 0; g.forEach(v => { m += v; }); m /= g.length;
      let n = 0; const z = new Float32Array(g.length); for (let i = 0; i < g.length; i++) { z[i] = g[i] - m; n += z[i] * z[i]; }
      n = Math.sqrt(n) || 1; let best = null;
      for (const t of templates) {
        let dot = 0; for (let i = 0; i < z.length; i++) dot += z[i] * t.t[i];
        const sc = dot / (n * t.n);
        if (!best || sc > best.score) best = { d: t.d, score: sc };
      }
      return best;
    }
    function number(rgba, width, height, cx, cy, scale, stretch) {
      const gs = glyphs(rgba, width, height, cx, cy, 28 * scale * stretch, 25 * scale, scale);
      if (!gs.length || gs.length > 2) return null;
      const ds = gs.map(classify);
      const confidence = Math.min(...ds.map(d => d.score));
      return confidence >= 0.6 ? Number(ds.map(d => d.d).join('')) : null;
    }
    // rgba: Uint8ClampedArray of a 16:9 frame; layout: from the agent detector (null for the default HUD).
    function read(rgba, width, height, layout) {
      const k = width / 1920, L = layout || { u: 1, s: 1, anchor: 'bottom' };
      const scale = k * L.u;
      const [lx, ly] = frameToStream(L, 822, 49), [rx] = frameToStream(L, 1098, 49);
      const left = number(rgba, width, height, lx * k, ly * height / 1080, scale, L.s);
      const right = number(rgba, width, height, rx * k, ly * height / 1080, scale, L.s);
      if (left === null || right === null || left > 30 || right > 30) return null;
      return { left, right };
    }
    // The match timer, as minutes (null when unreadable). Rounds never show more than 1:40, so 2 or more
    // means a deathmatch-style mode (team deathmatch, deathmatch), whose clock runs from 9-10 minutes.
    // Standard HUD timer at y 45; team deathmatch puts it lower (y 65) under its "STAGE" line.
    function minutes(rgba, width, height, layout) {
      const k = width / 1920, L = layout || { u: 1, s: 1, anchor: 'bottom' }, scale = k * L.u;
      for (const Y of [45, 65]) {
        const [cx, cy] = frameToStream(L, 960, Y);
        const gs = glyphs(rgba, width, height, cx * k, cy * height / 1080, 62 * scale * L.s, 22 * scale, scale);
        if (gs.length !== 3) continue;
        const ds = gs.map(classify);
        if (Math.min(...ds.map(d => d.score)) < 0.6) continue;
        const m = Number(ds[0].d), sec = Number(ds[1].d + ds[2].d);
        if (sec < 60) return m;
      }
      return null;
    }
    return { read, minutes };
  }


  // ---- Spectating ----
  // After dying, a player watches a teammate: the ability bar then shows the teammate's agent, and the
  // teammate's picture appears bottom-left (x 31-111, y 795-875 on a 1920x1080 picture). Finding that
  // picture means the bar isn't the streamer's own agent.
  const SPECTATE = { x: 31, y: 795, size: 80, pad: 14, sizes: [76, 80, 84], threshold: 0.68 };
  function leftToStream(layout, X, Y) {
    const { u, s, anchor } = layout || { u: 1, s: 1, anchor: 'bottom' };
    const dx = (X - 960 / s) * s;   // left-aligned HUD in a stretched picture sits at X*s from the edge
    if (anchor === 'topleft') return [960 * u + dx * u, Y * u];
    if (anchor === 'center') return [960 + dx * u, 540 + (Y - 540) * u];
    return [960 + dx * u, 1080 - (1080 - Y) * u];
  }
  function createSpectateCheck(meta, bin) {
    const N = meta.portraitSize, bytes = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
    const byId = new Map(meta.agents.map(a => [a.id, a]));
    const cache = new Map();
    function template(agent, tw, th) {
      const key = agent.id + '|' + tw + 'x' + th;
      if (cache.has(key)) return cache.get(key);
      const g = new Float32Array(N * N), a = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) { g[i] = bytes[agent.portrait + i]; a[i] = bytes[agent.portrait + N * N + i] / 255; }
      const gs = areaResize(g, N, N, tw, th), as = areaResize(a, N, N, tw, th);
      const mask = new Uint8Array(tw * th); let n = 0, mean = 0;
      for (let i = 0; i < mask.length; i++) if (as[i] >= 0.5) { mask[i] = 1; n++; mean += gs[i]; }
      mean /= n || 1;
      const t = new Float32Array(tw * th); let norm = 0;
      for (let i = 0; i < t.length; i++) if (mask[i]) { t[i] = gs[i] - mean; norm += t[i] * t[i]; }
      const out = { t, mask, n, norm: Math.sqrt(norm) };
      cache.set(key, out);
      return out;
    }
    // gray: grey levels of the whole picture; agentId: the agent the ability bar shows; layout: from the detector.
    function check(gray, width, height, agentId, layout) {
      const agent = byId.get(agentId);
      if (!agent || agent.portrait === undefined) return { spectating: false, score: 0 };
      const L = layout || { u: 1, s: 1, anchor: 'bottom' };
      const kx = width / 1920, ky = height / 1080;
      const q = Math.min(1, 40 / (SPECTATE.size * L.u * ky));
      const big = SPECTATE.sizes[SPECTATE.sizes.length - 1];
      const [fx0, fy0] = leftToStream(L, SPECTATE.x - SPECTATE.pad, SPECTATE.y - SPECTATE.pad);
      const [fx1, fy1] = leftToStream(L, SPECTATE.x + big + SPECTATE.pad, SPECTATE.y + big + SPECTATE.pad);
      const X0 = Math.max(0, Math.round(fx0 * kx)), Y0 = Math.max(0, Math.round(fy0 * ky));
      const X1 = Math.min(width, Math.round(fx1 * kx)), Y1 = Math.min(height, Math.round(fy1 * ky));
      const sw = X1 - X0, sh = Y1 - Y0;
      if (sw < 8 || sh < 8) return { spectating: false, score: 0 };
      const region = new Float32Array(sw * sh);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) region[y * sw + x] = gray[(Y0 + y) * width + X0 + x];
      const rw = Math.max(1, Math.round(sw * q)), rh = Math.max(1, Math.round(sh * q));
      const img = areaResize(region, sw, sh, rw, rh);
      let best = -1;
      for (const size of SPECTATE.sizes) {
        const th = Math.round(size * L.u * ky * q), tw = Math.round(size * L.u * L.s * kx * q);
        if (tw >= rw || th >= rh || th < 8) continue;
        const tpl = template(agent, tw, th);
        for (let py = 0; py + th <= rh; py++) for (let px = 0; px + tw <= rw; px++) {
          let sum = 0, sq = 0, dot = 0;
          for (let yy = 0; yy < th; yy++) {
            const ro = (py + yy) * rw + px, to = yy * tw;
            for (let xx = 0; xx < tw; xx++) {
              if (!tpl.mask[to + xx]) continue;
              const v = img[ro + xx]; sum += v; sq += v * v; dot += v * tpl.t[to + xx];
            }
          }
          const varp = sq - sum * sum / tpl.n;
          if (varp < tpl.n * 4) continue;
          const ncc = dot / (Math.sqrt(varp) * tpl.norm);
          if (ncc > best) best = ncc;
        }
      }
      return { spectating: best >= SPECTATE.threshold, score: best };
    }
    return { check };
  }

  // ---- Team comps (top of the game display) ----
  // Each team's agent portraits sit in five slots on either side of the round timer: the streamer's team on
  // the left (green), the other team on the right (red). A dead player's portrait disappears and the others
  // close up towards the middle, so slot 1 is always next to the timer.
  const TEAM = { y: 49, size: 40, left: [728, 662, 596, 530, 465], right: [1193, 1258, 1326, 1392, 1457], jitter: 6, work: 20 };
  const TEAM_RULE = { min: 0.74, margin: 0.15 };
  function createTeamReader(meta, bin) {
    const N = meta.portraitSize, bytes = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
    const list = meta.agents.filter(a => a.portrait !== undefined);
    const cache = new Map();
    function template(agent, tw, th, mirror) {
      const key = agent.id + '|' + tw + 'x' + th + (mirror ? 'm' : '');
      if (cache.has(key)) return cache.get(key);
      const g = new Float32Array(N * N), a = new Float32Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const src = y * N + (mirror ? N - 1 - x : x);
        g[y * N + x] = bytes[agent.portrait + src]; a[y * N + x] = bytes[agent.portrait + N * N + src] / 255;
      }
      const gs = areaResize(g, N, N, tw, th), as = areaResize(a, N, N, tw, th);
      const idx = []; let mean = 0;
      for (let i = 0; i < tw * th; i++) if (as[i] >= 0.5) { idx.push(i); mean += gs[i]; }
      mean /= idx.length || 1;
      const t = new Float32Array(idx.length), offs = new Int32Array(idx.length); let norm = 0;
      idx.forEach((i, k) => { t[k] = gs[i] - mean; norm += t[k] * t[k]; offs[k] = i; });
      const out = { t, offs, tw, norm: Math.sqrt(norm) };
      cache.set(key, out);
      return out;
    }
    // Offsets of a template's pixels inside a search window `ww` wide, cached.
    function offsets(tpl, ww) {
      if (tpl.ww !== ww) { tpl.ww = ww; tpl.at = Int32Array.from(tpl.offs, o => ((o / tpl.tw) | 0) * ww + (o % tpl.tw)); }
      return tpl.at;
    }
    // Best agent for one slot: its centre (cx, cy) and size in stream pixels, horizontal stretch s.
    function slot(gray, width, height, cx, cy, size, s, jitter, mirror) {
      const th = TEAM.work, tw = Math.max(8, Math.round(TEAM.work * s));
      const q = TEAM.work / size;                              // stream pixels -> working pixels
      const J = Math.max(2, Math.round(jitter * q));
      const half = size / 2;
      const x0 = Math.round(cx - half * s - J / q), x1 = Math.round(cx + half * s + J / q);
      const y0 = Math.round(cy - half - J / q), y1 = Math.round(cy + half + J / q);
      if (x0 < 0 || y0 < 0 || x1 > width || y1 > height) return null;
      const rw = x1 - x0, rh = y1 - y0, region = new Float32Array(rw * rh);
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) region[y * rw + x] = gray[(y0 + y) * width + x0 + x];
      const ww = tw + 2 * J, wh = th + 2 * J, img = areaResize(region, rw, rh, ww, wh);
      let a = -1, b = -1, ai = -1;
      list.forEach((agent, i) => {
        const tpl = template(agent, tw, th, mirror), n = tpl.t.length, at = offsets(tpl, ww), t = tpl.t;
        let best = -1;
        for (let py = 0; py + th <= wh; py++) for (let px = 0; px + tw <= ww; px++) {
          const base = py * ww + px;
          let sum = 0, sq = 0, dot = 0;
          for (let k = 0; k < n; k++) { const v = img[base + at[k]]; sum += v; sq += v * v; dot += v * t[k]; }
          const varp = sq - sum * sum / n; if (varp < n * 16) continue;
          const ncc = dot / (Math.sqrt(varp) * tpl.norm);
          if (ncc > best) best = ncc;
        }
        if (best > a) { b = a; a = best; ai = i; } else if (best > b) b = best;
      });
      return ai >= 0 && a >= TEAM_RULE.min && a - b >= TEAM_RULE.margin ? { agent: list[ai].id, score: a, margin: a - b } : null;
    }
    // A team can't have the same agent twice: a repeat means one of them is misread, so drop both.
    function unique(slots) {
      const seen = new Map(); slots.forEach(s => { if (s) seen.set(s.agent, (seen.get(s.agent) || 0) + 1); });
      return slots.map(s => (s && seen.get(s.agent) > 1 ? null : s));
    }
    // gray: grey levels of the picture; layout: from the agent detector (null for the default HUD).
    // Returns per side the five slots (slot 1 next to the timer), each { agent, score, margin } when
    // recognised, else null. The right-hand team's portraits face the other way.
    function read(gray, width, height, layout) {
      const L = layout || { u: 1, s: 1, anchor: 'bottom' };
      const kx = width / 1920, ky = height / 1080, size = TEAM.size * L.u * ky;
      const side = (xs, mirror) => unique(xs.map(X => {
        const [fx, fy] = frameToStream(L, X, TEAM.y);
        return slot(gray, width, height, fx * kx, fy * ky, size, L.s, TEAM.jitter * L.u * ky, mirror);
      }));
      return { left: side(TEAM.left, false), right: side(TEAM.right, true) };
    }
    return { read };
  }

  // ---- Screens without the streamer's ability bar ----
  // Recognised so a card can say why it shows no agent, and so a bar seen on a round-end or death screen
  // (which may belong to the teammate being watched) isn't taken as the streamer's own agent.
  //   menu:   the game client's top navigation bar (seven icons and the settings gear), any language
  //   select: the four role filter buttons above the agent grid on the agent select screen
  //   banner: the big centred round banner (round won or lost, clutch, buy phase, match point...)
  //   dead:   the combat report shown after dying, recognised by the red strip with the killer's name
  const STRETCHES = [1, 1.11, 1.22, 4 / 3];
  const STATE_RULES = { menu: 0.62, select: 0.62 };
  function createStateCheck(data) {
    const groups = {};
    for (const [name, group] of Object.entries(data)) {
      if (!group.icons) continue;
      const n = group.size / 2;
      groups[name] = {
        size: group.size, need: group.need,
        icons: group.icons.map(icon => {
          const t = Float32Array.from(icon.t); let mean = 0; t.forEach(v => { mean += v; }); mean /= t.length;
          let norm = 0; for (let i = 0; i < t.length; i++) { t[i] -= mean; norm += t[i] * t[i]; }
          return { x: icon.x, y: icon.y, anchor: icon.anchor, t, n, norm: Math.sqrt(norm) };
        })
      };
    }
    // How well a row of icons is found at its usual place: mean of the best `need` icon correlations.
    function iconRow(gray, width, height, group, stretches = STRETCHES) {
      const kx = width / 1920, ky = height / 1080;
      let best = -1;
      for (const s of stretches) {
        const scores = group.icons.map(icon => {
          const n = icon.n, X = icon.anchor === 'right' ? 1920 - (1920 - icon.x) * s : icon.x * s;
          // Search ±12 px sideways and ±4 px (just inside the picture) up and down, at half size.
          const JX = 12, JY = Math.min(4, icon.y - group.size / 2);
          const sideX = n + JX, sideY = n + JY;
          const x0 = Math.round((X - (group.size / 2 + JX) * s) * kx), x1 = Math.round((X + (group.size / 2 + JX) * s) * kx);
          const y0 = Math.round((icon.y - group.size / 2 - JY) * ky), y1 = Math.round((icon.y + group.size / 2 + JY) * ky);
          if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 - x0 < 4 || y1 - y0 < 4) return -1;
          const rw = x1 - x0, rh = y1 - y0, region = new Float32Array(rw * rh);
          for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) region[y * rw + x] = gray[(y0 + y) * width + x0 + x];
          const img = areaResize(region, rw, rh, sideX, sideY);
          let bestIcon = -1;
          for (let py = 0; py + n <= sideY; py++) for (let px = 0; px + n <= sideX; px++) {
            let sum = 0, sq = 0, dot = 0;
            for (let yy = 0; yy < n; yy++) {
              const ro = (py + yy) * sideX + px, to = yy * n;
              for (let xx = 0; xx < n; xx++) { const v = img[ro + xx]; sum += v; sq += v * v; dot += v * icon.t[to + xx]; }
            }
            const m = n * n, varp = sq - sum * sum / m; if (varp < m * 25) continue;
            const ncc = dot / (Math.sqrt(varp) * icon.norm);
            if (ncc > bestIcon) bestIcon = ncc;
          }
          return bestIcon;
        }).sort((p, q) => q - p);
        let mean = 0; for (let i = 0; i < group.need; i++) mean += scores[i]; mean /= group.need;
        if (mean > best) best = mean;
        if (best >= 0.8) break;      // clear-cut at the usual (unstretched) layout: no need to try the others
      }
      return best;
    }

    // The round banner: at least three large white letters on one line, centred on the middle of the picture.
    function banner(rgba, width, height) {
      const kx = width / 1920, ky = height / 1080, q = 0.5;
      const X0 = Math.round(560 * kx), X1 = Math.round(1360 * kx), Y0 = Math.round(110 * ky), Y1 = Math.round(380 * ky);
      const sw = X1 - X0, sh = Y1 - Y0;
      const v = new Float32Array(sw * sh), sat = new Float32Array(sw * sh);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const j = ((Y0 + y) * width + X0 + x) * 4, r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        v[y * sw + x] = mx; sat[y * sw + x] = mx ? 255 * (mx - mn) / mx : 0;
      }
      const w = Math.round(sw / kx * q), h = Math.round(sh / ky * q);      // half of full-HD size
      const V = areaResize(v, sw, sh, w, h), S = areaResize(sat, sw, sh, w, h);
      const opened = minFilter(minFilter(V, w, h, 8, false), w, h, 8, true);
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < mask.length; i++) mask[i] = V[i] - opened[i] >= 30 && V[i] >= 175 && S[i] < 70 ? 1 : 0;
      const comps = components(mask, w, h).filter(c => c.h >= 21 && c.h <= 44 && c.w >= 3 && c.w <= 48 && c.area >= c.h * 2);
      let best = null;
      for (const c of comps) {
        const line = comps.filter(o => Math.abs(o.y0 - c.y0) <= 4 && Math.abs(o.y1 - c.y1) <= 4);
        if (line.length < 3) continue;
        const minx = Math.min(...line.map(o => o.x0)), maxx = Math.max(...line.map(o => o.x1));
        const centre = X0 / kx + (minx + maxx + 1) / 2 / q;      // in 1920-wide picture pixels
        if (Math.abs(centre - 960) > 26 || (maxx - minx) / q < 150) continue;
        if (!best || line.length > best.letters) best = { letters: line.length, top: Y0 / ky + c.y0 / q, height: c.h / q, left: minx, right: maxx };
      }
      if (!best) return null;
      return { letters: best.letters, kind: smallLineAbove(rgba, width, height, best.top) ? 'buy' : 'result' };
    }
    // Buy-phase banners (BUY PHASE, MATCH POINT, LAST ROUND...) have a small "ROUND 3 ////// ATTACKERS" line above
    // the big words; round results (FLAWLESS, CLUTCH, LOST...) don't. Looked for at full size.
    function smallLineAbove(rgba, width, height, top) {
      const kx = width / 1920, ky = height / 1080;
      const X0 = Math.round(800 * kx), X1 = Math.round(1120 * kx), Y0 = Math.round((top - 30) * ky), Y1 = Math.round((top - 3) * ky);
      const w = X1 - X0, h = Y1 - Y0; if (w < 20 || h < 6 || Y0 < 0) return false;
      const v = new Float32Array(w * h), sat = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const j = ((Y0 + y) * width + X0 + x) * 4, r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b); v[y * w + x] = mx; sat[y * w + x] = mx ? 255 * (mx - mn) / mx : 0;
      }
      const rad = Math.max(2, Math.round(4 * ky));
      const opened = minFilter(minFilter(v, w, h, rad, false), w, h, rad, true);
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < mask.length; i++) mask[i] = v[i] - opened[i] >= 14 && v[i] >= 120 && sat[i] < 80 ? 1 : 0;
      const small = components(mask, w, h).filter(c => c.h >= 4 * ky && c.h <= 17 * ky && c.w <= 18 * kx);   // Latin or CJK
      // Most marks on one baseline, spread over at least 120 px.
      for (const c of small) {
        const line = small.filter(o => Math.abs(o.y0 + o.y1 - c.y0 - c.y1) <= Math.max(2, 6 * ky));
        if (line.length < 6) continue;
        const xs = line.map(o => (o.x0 + o.x1) / 2 / kx);
        if (Math.max(...xs) - Math.min(...xs) >= 80) return true;
      }
      return false;
    }

    // The combat report after dying: a red strip with the killer's name across the whole panel, right side.
    function dead(rgba, width, height) {
      const kx = width / 1920, ky = height / 1080;
      const xa = Math.round(1530 * kx), xb = Math.round(1885 * kx), Y0 = Math.round(330 * ky), Y1 = Math.round(820 * ky);
      const red = (x, y) => { const j = (y * width + x) * 4, r = rgba[j], g = rgba[j + 1], b = rgba[j + 2]; return r >= 170 && r - g >= 90 && r - b >= 70; };
      let run = 0;
      for (let y = Y0; y <= Y1; y++) {
        let n = 0; for (let x = xa; x < xb; x++) if (red(x, y)) n++;
        if (y < Y1 && n >= 0.6 * (xb - xa)) { run++; continue; }
        const rows = run / ky; run = 0;
        if (rows < 17 || rows > 30) continue;
        // The strip ends at the panel's right edge (x 1899), not further.
        const mid = y - Math.ceil(rows * ky / 2);
        let edge = -1; for (let x = Math.round(1860 * kx); x < Math.min(width, Math.round(1919 * kx)); x++) if (red(x, mid)) edge = x;
        if (edge / kx >= 1888 && edge / kx <= 1910) return { top: (y - rows * ky) / ky };
      }
      return null;
    }

    // An official broadcast (VCT and other Riot-run events): five player cards down each side, each with a thin
    // coloured health bar, 106 px apart. Grey (dead) or short (hurt) bars are fine; six of the ten are enough.
    function broadcast(rgba, width, height) {
      const kx = width / 1920, ky = height / 1080;
      const colourful = (x0, x1, y) => {
        const Y = Math.round(y * ky), X0 = Math.round(x0 * kx), X1 = Math.round(x1 * kx); let n = 0;
        if (Y < 0 || Y >= height) return 0;
        for (let x = X0; x < X1; x++) {
          const j = (Y * width + x) * 4, r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx > 110 && mx - mn > 0.45 * mx) n++;
        }
        return n / Math.max(1, X1 - X0);
      };
      let cards = 0, left = 0, right = 0;
      for (const [x0, x1, side] of [[90, 320, 'l'], [1600, 1850, 'r']]) {
        for (const Y of [590, 696, 802, 908, 1014]) {
          let best = 0, at = Y;
          for (let y = Y - 5; y <= Y + 5; y++) { const f = colourful(x0, x1, y); if (f > best) { best = f; at = y; } }
          // A thin bar: not part of a big coloured area above or below.
          if (best >= 0.35 && colourful(x0, x1, at - 14) < 0.5 && colourful(x0, x1, at + 14) < 0.5) { cards++; if (side === 'l') left++; else right++; }
        }
      }
      return cards >= 6 && left >= 2 && right >= 2;
    }

    // Agent select: the map and mode written in the box above the agent grid ("LOTUS / COMPETITIVE"). Each line's
    // white letters are cut out, fitted to a fixed size (which also undoes a stretched resolution) and
    // compared with the words seen before (data/states.json "words": Latin names and some translations).
    const WORD = { x0: 112, x1: 362, name: [133, 171, 96, 24], mode: [172, 191, 96, 12] };
    function selectWords(rgba, width, height, s = 1) {
      const kx = width / 1920, ky = height / 1080;
      const X0 = Math.round(WORD.x0 * s * kx), X1 = Math.min(width, Math.round(WORD.x1 * s * kx));
      const out = {};
      for (const key of ['name', 'mode']) {
        const [y0, y1, tw, th] = WORD[key], Y0 = Math.round(y0 * ky), Y1 = Math.round(y1 * ky);
        const nw = X1 - X0, nh = Y1 - Y0; if (nw < 10 || nh < 4) return null;
        let v = new Float32Array(nw * nh), sat = new Float32Array(nw * nh);
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
          const j = ((Y0 + y) * width + X0 + x) * 4, r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b); v[y * nw + x] = mx; sat[y * nw + x] = mx ? 255 * (mx - mn) / mx : 0;
        }
        // Work at full-HD size, unstretched.
        const w = Math.round((WORD.x1 - WORD.x0)), h = y1 - y0;
        v = (nw === w && nh === h) ? v : bilinear(v, nw, nh, w, h); sat = (nw === w && nh === h) ? sat : bilinear(sat, nw, nh, w, h);
        const opened = minFilter(minFilter(v, w, h, 5, false), w, h, 5, true);
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < mask.length; i++) mask[i] = v[i] - opened[i] >= 35 && v[i] >= 165 && sat[i] < 70 ? 1 : 0;
        // Letters: blobs of text height, in one run from the left margin (map art can have bright bits too).
        const [hmin, hmax] = key === 'name' ? [16, 38] : [5, 17];
        const cand = components(mask, w, h).filter(c => c.area >= 6 && c.h >= hmin && c.h <= hmax).sort((a, b) => a.x0 - b.x0);
        const comps = [];
        for (const c of cand) {
          if (!comps.length) { if (c.x0 <= 30) comps.push(c); continue; }
          if (c.x0 - Math.max(...comps.map(o => o.x1)) > 22) break;
          comps.push(c);
        }
        if (!comps.length) return null;
        const bx0 = Math.min(...comps.map(c => c.x0)), bx1 = Math.max(...comps.map(c => c.x1)), by0 = Math.min(...comps.map(c => c.y0)), by1 = Math.max(...comps.map(c => c.y1));
        const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1; if (bw < 12 || bh < 4) return null;
        const crop = new Float32Array(bw * bh);
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) crop[y * bw + x] = mask[(by0 + y) * w + bx0 + x];
        const vec = areaResize(crop, bw, bh, tw, th);
        let m = 0; vec.forEach(x => { m += x; }); m /= vec.length;
        let n = 0; for (let i = 0; i < vec.length; i++) { vec[i] -= m; n += vec[i] * vec[i]; }
        n = Math.sqrt(n) || 1; for (let i = 0; i < vec.length; i++) vec[i] /= n;
        out[key] = vec;
      }
      return out;
    }
    const fromBase64 = b64 => { const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'); const out = new Float32Array(bin.length); for (let i = 0; i < bin.length; i++) { const c = bin.charCodeAt(i); out[i] = (c > 127 ? c - 256 : c) / 127; } return out; };
    const words = (data.words || []).map(w => ({ ...w, vec: typeof w.vec === 'string' ? fromBase64(w.vec) : Float32Array.from(w.vec) }));
    function readSelect(rgba, gray, width, height) {
      // The stretch the agent select screen is drawn at.
      let best = { score: -2, s: 1 };
      for (const s of STRETCHES) { const sc = iconRow(gray, width, height, groups.select, [s]); if (sc > best.score) best = { score: sc, s }; }
      const vecs = selectWords(rgba, width, height, best.s);
      if (!vecs) return {};
      return { map: vecs.name ? matchWord('name', vecs.name) : null, mode: vecs.mode ? matchWord('mode', vecs.mode) : null };
    }
    function matchWord(key, vec) {
      {
        let a = null, b = -2;
        for (const w of words) {
          if (w.line !== key || w.vec.length !== vec.length) continue;
          let dot = 0; for (let i = 0; i < vec.length; i++) dot += vec[i] * w.vec[i];
          if (!a || dot > a.score) { if (a && a.value !== w.value) b = Math.max(b, a.score); a = { value: w.value, score: dot }; }
          else if (w.value !== a.value) b = Math.max(b, dot);
        }
        // Map names: close matches only. Modes: a different mode scores below 0.2 (calibrated on 22 boxes).
        const [min, margin] = key === 'name' ? [0.65, 0.08] : [0.5, 0.2];
        return a && a.score >= min && a.score - b >= margin ? a.value : null;
      }
    }

    function check(gray, rgba, width, height) {
      const menu = iconRow(gray, width, height, groups.menu), select = iconRow(gray, width, height, groups.select);
      return { menu, select, banner: banner(rgba, width, height), dead: dead(rgba, width, height),
        isMenu: menu >= STATE_RULES.menu, isSelect: select >= STATE_RULES.select };
    }
    return { check, iconRow: (gray, w, h, name) => iconRow(gray, w, h, groups[name]), banner, dead, broadcast, selectWords, readSelect, matchWord };
  }
  function components(mask, w, h) {
    const label = new Int32Array(w * h), out = [];
    let next = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || label[i]) continue;
      next++; const stack = [i]; label[i] = next;
      let x0 = w, x1 = 0, y0 = h, y1 = 0, area = 0;
      while (stack.length) {
        const p = stack.pop(), px = p % w, py = (p - px) / w; area++;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx; if (mask[q] && !label[q]) { label[q] = next; stack.push(q); }
        }
      }
      out.push({ x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
    }
    return out;
  }

  // Parts of a 1920x1080 picture each check reads (x0, y0, x1, y1), so callers can copy just those pixels.
  const REGIONS = {
    band: [470, 870, 1450, 1080],      // ability bar, all layouts
    score: [680, 0, 1240, 140],        // round score
    spectate: [0, 690, 280, 1010],     // teammate picture when spectating
    menu: [0, 0, 1920, 64],            // client navigation bar
    select: [0, 130, 640, 320],        // agent select filter buttons and the map/mode box above them
    banner: [560, 70, 1360, 390],      // round banner
    dead: [1480, 320, 1920, 830],      // combat report
    team: [240, 0, 1680, 110],         // team portraits, all layouts
    cardsL: [80, 570, 330, 1030],      // broadcast player cards
    cardsR: [1590, 570, 1860, 1030]
  };
  const api = { createDetector, createScoreReader, createSpectateCheck, createStateCheck, createTeamReader, toGray, areaResize, LAYOUTS, REGIONS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgentLensDetector = api;
})(typeof self !== 'undefined' ? self : this);
