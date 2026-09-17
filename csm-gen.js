/* csm-gen.js — synthetic isolated-mode charge-stability maps in the browser.
   A port of ml/csm_generator.py (same parameter ranges, same phenomenology:
   near-vertical plunger-gate transition lines, sharp at the bottom and fading
   toward the top, honeycomb-like branching from parasitic dots, background
   structure, scan artefacts, noise). A parameterised image simulator modelled
   on Appendix I of arXiv:2607.20871, not a device-physics simulation.
   Images are Float32Array(H*W) in [0,1], row 0 at the top. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CSMGen = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const H = 128, W = 128;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const makeRng = seed => {
    const r = mulberry32(seed);
    const rng = { random: r, uniform: (a, b) => a + (b - a) * r(), int: (a, b) => a + Math.floor(r() * (b - a)) };
    rng.gauss = () => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    rng.choiceP = (items, p) => { let x = r(); for (let i = 0; i < items.length; i++) { if ((x -= p[i]) <= 0) return items[i]; } return items[items.length - 1]; };
    return rng;
  };

  /* ---------------- drawing ---------------- */
  function drawSegment(img, x1, y1, x2, y2, amp1, amp2, width) {
    if (y1 === y2) return;
    const ya = Math.min(y1, y2), yb = Math.max(y1, y2);
    const r0 = Math.max(0, Math.floor(ya)), r1 = Math.min(H - 1, Math.ceil(yb));
    if (r1 < r0) return;
    const slope = Math.abs((x2 - x1) / (y2 - y1)), w = width * Math.sqrt(1 + slope * slope), inv = 1 / (2 * w * w);
    for (let y = r0; y <= r1; y++) {
      let t = (y - y1) / (y2 - y1); t = Math.min(1, Math.max(0, t));
      const xc = x1 + (x2 - x1) * t, amp = amp1 + (amp2 - amp1) * t;
      const lo = Math.max(0, Math.floor(xc - 4 * w)), hi = Math.min(W - 1, Math.ceil(xc + 4 * w));
      for (let x = lo; x <= hi; x++) img[y * W + x] += amp * Math.exp(-(x - xc) * (x - xc) * inv);
    }
  }
  function gaussBlob(img, cx, cy, sx, sy, amp) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[y * W + x] += amp * Math.exp(-(x - cx) * (x - cx) / (2 * sx * sx) - (y - cy) * (y - cy) / (2 * sy * sy));
  }
  const refl = (i, n) => i < 0 ? -i : i >= n ? 2 * n - 2 - i : i;
  function blur(img, sigma) {
    const r = Math.ceil(3 * sigma), k = new Float32Array(2 * r + 1); let s = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const tmp = new Float32Array(H * W), out = new Float32Array(H * W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let t = -r; t <= r; t++) a += k[t + r] * img[y * W + refl(x + t, W)]; tmp[y * W + x] = a; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let t = -r; t <= r; t++) a += k[t + r] * tmp[refl(y + t, H) * W + x]; out[y * W + x] = a; }
    return out;
  }

  /* ---------------- geometry ---------------- */
  function sampleLines(rng, n) {
    const theta = rng.uniform(-12, 12) * Math.PI / 180;
    const y0 = rng.uniform(92, 124), L = rng.uniform(30, 85), drift = Math.tan(theta) * L, margin = 5;
    let spacing = rng.uniform(9, 20);
    if (n > 1) spacing = Math.min(spacing, (W - 2 * margin - Math.abs(drift) - 2) / (n - 1));
    const total = spacing * Math.max(n - 1, 0);
    const lo = margin + Math.max(0, -drift), hi = W - margin - total - Math.max(0, drift);
    const xLeft = hi > lo ? rng.uniform(lo, hi) : (lo + hi) / 2;
    const lines = [];
    for (let i = 0; i < n; i++) {
      let xs = xLeft + i * spacing + rng.uniform(-0.15, 0.15) * spacing;
      const ti = theta + rng.uniform(-2, 2) * Math.PI / 180, ys = y0 + rng.uniform(-3, 3);
      const ye = Math.max(6, ys - L + rng.uniform(-6, 6));
      let xe = xs + Math.tan(ti) * (ys - ye);
      xs = Math.min(W - 3, Math.max(2, xs)); xe = Math.min(W - 3, Math.max(2, xe));
      lines.push({ xs, ys, xe, ye });
    }
    return { lines, theta, spacing };
  }
  function drawLines(img, lines, contrast, width, rng, faintTail) {
    for (const ln of lines) {
      drawSegment(img, ln.xs, ln.ys, ln.xe, ln.ye, contrast, 0.45 * contrast, width);
      const tx = (ln.xe - ln.xs) / Math.max(ln.ys - ln.ye, 1e-6), yf = Math.max(0, ln.ye - 8);
      drawSegment(img, ln.xe, ln.ye, ln.xe + tx * (ln.ye - yf), yf, 0.45 * contrast, 0, width * 1.2);
      drawSegment(img, ln.xs, Math.min(H - 1, ln.ys + 3), ln.xs - tx * 6, ln.ys - 6, 0.25 * contrast, 0, width);
      if (faintTail) drawSegment(img, ln.xe + tx * (ln.ye - yf), yf, ln.xe + tx * ln.ye, 0, 0.12 * contrast, 0.05 * contrast, width * 1.6);
    }
  }
  function drawBranching(img, lines, spacing, contrast, width, rng) {
    if (!lines.length) return;
    const tiers = rng.int(1, 4), phi = rng.uniform(28, 40) * Math.PI / 180;
    let amp = contrast * rng.uniform(0.3, 0.8);
    const wb = width * rng.uniform(0.9, 1.4);
    let ends = lines.map(l => [l.xe, l.ye]);
    for (let t = 0; t < tiers; t++) {
      const rise = spacing / 2 / Math.tan(phi), verts = [];
      ends.forEach(([x, y], i) => {
        if (i === 0) drawSegment(img, x, y, x - spacing / 2, y - rise, amp, 0.5 * amp, wb);
        if (i === ends.length - 1) drawSegment(img, x, y, x + spacing / 2, y - rise, amp, 0.5 * amp, wb);
        if (i + 1 < ends.length) {
          const [x2, y2] = ends[i + 1], vx = (x + x2) / 2, vy = (y + y2) / 2 - rise;
          drawSegment(img, x, y, vx, vy, amp, 0.8 * amp, wb); drawSegment(img, x2, y2, vx, vy, amp, 0.8 * amp, wb);
          verts.push([vx, vy]);
        }
      });
      if (!verts.length) break;
      const stem = rng.uniform(6, 14);
      ends = verts.map(([vx, vy]) => { drawSegment(img, vx, vy, vx, vy - stem, 0.8 * amp, 0.7 * amp, wb); return [vx, vy - stem]; });
      amp *= rng.uniform(0.55, 0.85);
      if (ends.length && ends[0][1] < 6) break;
    }
  }
  function background(img, rng, strength) {
    const gx = rng.uniform(-0.15, 0.15) * strength, gy = rng.uniform(-0.2, 0.2) * strength, v = rng.uniform(0, 0.3) * strength;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / W - 0.5, w = y / H - 0.5;
      img[y * W + x] += gx * u + gy * w - v * (u * u + w * w) * 2;
    }
    const nb = rng.int(1, 4);
    for (let i = 0; i < nb; i++) gaussBlob(img, rng.uniform(0, W), rng.uniform(0, H), rng.uniform(15, 40), rng.uniform(15, 40), rng.uniform(-0.15, 0.15) * strength);
    if (rng.random() < 0.5) { const a = rng.uniform(0.03, 0.08) * strength, per = rng.uniform(2, 8), ph = rng.uniform(0, 6.28); for (let y = 0; y < H; y++) { const rowAmp = a * Math.sin(2 * Math.PI * y / per + ph) * (1 + 0.3 * rng.gauss()); for (let x = 0; x < W; x++) img[y * W + x] += rowAmp; } }
    if (rng.random() < 0.3) { const a = rng.uniform(0.02, 0.06) * strength, per = rng.uniform(3, 12), ph = rng.uniform(0, 6.28); for (let x = 0; x < W; x++) { const c = a * Math.sin(2 * Math.PI * x / per + ph); for (let y = 0; y < H; y++) img[y * W + x] += c; } }
    if (rng.random() < 0.35) { const a = rng.uniform(0.04, 0.12) * strength, per = rng.uniform(18, 45), ph = rng.uniform(0, 6.28); for (let y = 0; y < H; y++) { const c = a * Math.sin(2 * Math.PI * y / per + ph); for (let x = 0; x < W; x++) img[y * W + x] += c; } }
    if (rng.random() < 0.4) { const ns = rng.int(1, 3); for (let i = 0; i < ns; i++) { const ang = rng.uniform(-70, 70) * Math.PI / 180, x0 = rng.uniform(0, W), y0 = rng.uniform(0, H), L = 200; drawSegment(img, x0 - Math.sin(ang) * L, y0 - Math.cos(ang) * L, x0 + Math.sin(ang) * L, y0 + Math.cos(ang) * L, rng.uniform(0.08, 0.3) * strength, rng.uniform(0.08, 0.3) * strength, rng.uniform(0.8, 1.6)); } }
  }
  function finish(img, rng, sigma, salt) {
    const gain = rng.uniform(0.8, 1.2), off = rng.uniform(0.1, 0.3), saltV = rng.uniform(0.3, 0.8);
    for (let i = 0; i < H * W; i++) {
      let v = img[i] + sigma * rng.gauss();
      if (salt && rng.random() < 0.002) v += saltV;
      v = off + gain * v;
      img[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    return img;
  }

  /* ---------------- generate ---------------- */
  function generate(rng, cls = 'clean') {
    const n = rng.choiceP([0, 1, 2, 3, 4, 5, 6, 7], [0.06, 0.16, 0.18, 0.18, 0.16, 0.12, 0.08, 0.06]);
    const { lines, spacing } = sampleLines(rng, n);
    const label = { n, lines, clean: cls === 'clean', unstable: cls === 'unstable', unclear: cls === 'unclear', cls };
    let img = new Float32Array(H * W);
    let contrast = rng.uniform(0.35, 1.0);
    const width = rng.uniform(0.9, 2.2);
    if (cls === 'unclear' && rng.random() < 0.5) contrast = rng.uniform(0.05, 0.16);
    const bgStrength = cls === 'clean' ? 1 : rng.uniform(1, 1.8);
    background(img, rng, bgStrength);

    if (cls === 'unstable') {
      const nJumps = rng.int(1, 4), cuts = []; for (let i = 0; i < nJumps; i++) cuts.push(rng.uniform(15, 115)); cuts.sort((a, b) => a - b);
      const base = img; img = new Float32Array(H * W);
      const segs = []; let prev = 0, dx = 0;
      for (const c of cuts) { segs.push([prev, c, dx]); prev = c; dx += (rng.random() < 0.5 ? -1 : 1) * rng.uniform(3, 12); }
      segs.push([prev, H, dx]);
      const drop = (n > 0 && rng.random() < 0.5) ? rng.int(0, n) : -1, dropRow = rng.uniform(30, 100);
      for (const [lo, hi, sdx] of segs) {
        const part = new Float32Array(H * W);
        let shifted = lines.map(l => ({ xs: l.xs + sdx, ys: l.ys, xe: l.xe + sdx, ye: l.ye }));
        if (drop >= 0) shifted = shifted.filter((l, i) => !(i === drop && hi > dropRow));
        drawLines(part, shifted, contrast, width, rng, rng.random() < 0.4);
        if (rng.random() < 0.65) drawBranching(part, shifted, spacing, contrast, width, rng);
        const r0 = Math.floor(lo), r1 = Math.floor(hi);
        for (let i = r0 * W; i < r1 * W; i++) img[i] += part[i];
      }
      for (let i = 0; i < H * W; i++) img[i] += base[i];
      label.jumps = cuts;
    } else {
      drawLines(img, lines, contrast, width, rng, rng.random() < 0.4);
      if (rng.random() < 0.65) drawBranching(img, lines, spacing, contrast, width, rng);
    }

    if (cls === 'unclear') {
      const mode = rng.int(0, 4);
      if (mode === 0) { const ang = rng.uniform(-60, 60) * Math.PI / 180, x0 = rng.uniform(20, W - 20), y0 = rng.uniform(20, H - 20); drawSegment(img, x0 - Math.sin(ang) * 200, y0 - Math.cos(ang) * 200, x0 + Math.sin(ang) * 200, y0 + Math.cos(ang) * 200, rng.uniform(0.35, 0.7), rng.uniform(0.35, 0.7), rng.uniform(6, 14)); }
      else if (mode === 1) { const ns = rng.int(6, 14); for (let i = 0; i < ns; i++) { const ang = rng.uniform(-80, 80) * Math.PI / 180, x0 = rng.uniform(0, W), y0 = rng.uniform(0, H); drawSegment(img, x0 - Math.sin(ang) * 200, y0 - Math.cos(ang) * 200, x0 + Math.sin(ang) * 200, y0 + Math.cos(ang) * 200, rng.uniform(0.2, 0.45), rng.uniform(0.2, 0.45), rng.uniform(0.8, 2.5)); } }
      else if (mode === 2) img = blur(img, rng.uniform(2, 3.5));
      const sigma = (mode === 3 || contrast < 0.2) ? rng.uniform(0.12, 0.25) : rng.uniform(0.06, 0.14);
      return { img: finish(img, rng, sigma, rng.random() < 0.3), label };
    }
    const sigma = cls === 'degraded' ? rng.uniform(0.06, 0.11) : cls === 'unstable' ? rng.uniform(0.03, 0.09) : rng.uniform(0.02, 0.07);
    return { img: finish(img, rng, sigma, rng.random() < 0.2), label };
  }

  /* A charge jump injected after the fact: everything below `row` shifts by dx
     pixels (telegraph switching mid-scan), what the click on the page does. */
  function injectJump(img, row, dx) {
    const out = new Float32Array(img);
    for (let y = row; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = x - dx;
      out[y * W + x] = (sx >= 0 && sx < W) ? img[y * W + sx] : img[y * W + Math.min(W - 1, Math.max(0, sx))];
    }
    return out;
  }

  return { H, W, makeRng, generate, injectJump };
});
