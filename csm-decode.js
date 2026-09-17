/* csm-decode.js — decoding of ChargeLineNet heatmaps into transition lines,
   and the classical 'Profile' column-projection counter of Appendix J of
   arXiv:2607.20871. Mirrors ml/decode.py exactly; keep the two in step. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CSMDecode = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const OFFSET_SCALE = 64;

  // (y, x, value) of strict 3x3 local maxima of `a` (H x W) above tau, strongest first
  function peaks2d(a, H, W, tau, sign) {
    const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = sign * a[y * W + x];
      if (!(v > tau)) continue;
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dy && !dx) continue;
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
        if (sign * a[yy * W + xx] > v) { ok = false; break; }
      }
      if (ok) out.push({ y, x, v });
    }
    out.sort((p, q) => q.v - p.v);
    return out;
  }

  /* heat: Float32Array of 3*H*W (signed heatmap, dx, dy). Returns lines sorted
     by start x: [{xs, ys, xe, ye, score}]. Each end blob predicts its start via
     the offset field (divided by the blob height it was weighted with) and
     snaps to the nearest unused start blob. The snap distance is anisotropic,
     |dx| + wy*|dy| < corridor: the offset's x component is precise and is what
     tells neighbouring lines (>= 9 px apart) apart; its length component is not. */
  function decodeLines(heat, H, W, tau = 0.3, corridor = 20, wy = 0.35) {
    const HW = H * W, h = heat.subarray(0, HW);
    const starts = peaks2d(h, H, W, tau, 1), ends = peaks2d(h, H, W, tau, -1);
    const used = new Set(), lines = [];
    for (const e of ends) {
      const mag = Math.max(e.v, 0.2);
      const px = e.x + heat[HW + e.y * W + e.x] / mag * OFFSET_SCALE;
      const py = e.y + heat[2 * HW + e.y * W + e.x] / mag * OFFSET_SCALE;
      let best = -1, bd = corridor;
      starts.forEach((s, i) => { if (used.has(i)) return; const d = Math.abs(s.x - px) + wy * Math.abs(s.y - py); if (d < bd) { best = i; bd = d; } });
      if (best >= 0) { used.add(best); const s = starts[best]; lines.push({ xs: s.x, ys: s.y, xe: e.x, ye: e.y, score: Math.min(e.v, s.v) }); }
    }
    lines.sort((a, b) => a.xs - b.xs);
    return lines;
  }

  /* ---------------- classical baseline ---------------- */
  function gauss1d(sigma, deriv) {
    const r = Math.ceil(3 * sigma), n = 2 * r + 1, g = new Float64Array(n); let s = 0;
    for (let i = 0; i < n; i++) { const x = i - r; g[i] = Math.exp(-x * x / (2 * sigma * sigma)); s += g[i]; }
    for (let i = 0; i < n; i++) g[i] /= s;
    if (deriv === 2) for (let i = 0; i < n; i++) { const x = i - r; g[i] = g[i] * (x * x - sigma * sigma) / Math.pow(sigma, 4); }
    return g;
  }
  const refl = (i, n) => i < 0 ? -i : i >= n ? 2 * n - 2 - i : i;
  function convRows(img, H, W, k) {   // np.convolve semantics (kernel reversed) with reflect padding
    const r = (k.length - 1) >> 1, out = new Float32Array(H * W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0; for (let t = -r; t <= r; t++) s += k[r - t] * img[y * W + refl(x + t, W)];
      out[y * W + x] = s;
    }
    return out;
  }
  function convCols(img, H, W, k) {
    const r = (k.length - 1) >> 1, out = new Float32Array(H * W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0; for (let t = -r; t <= r; t++) s += k[r - t] * img[refl(y + t, H) * W + x];
      out[y * W + x] = s;
    }
    return out;
  }
  function percentile(arr, p) {
    const a = Float64Array.from(arr).sort(); const idx = (a.length - 1) * p / 100, lo = Math.floor(idx), hi = Math.ceil(idx);
    return a[lo] + (a[hi] - a[lo]) * (idx - lo);
  }
  /* Smooth along y, matched-filter (negative second derivative of a Gaussian)
     across x, rectify, sum over rows, flatten the background, pick peaks. */
  function classicalCount(img, H, W, opts = {}) {
    const sigmaY = opts.sigmaY ?? 6, sigmaX = opts.sigmaX ?? 1.5, prominence = opts.prominence ?? 0.25, minSep = opts.minSep ?? 4;
    const sm = convCols(img, H, W, gauss1d(sigmaY, 0));
    const resp = convRows(sm, H, W, gauss1d(sigmaX, 2));
    const profile = new Float64Array(W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = -resp[y * W + x]; if (v > 0) profile[x] += v; }
    const base = percentile(profile, 20);
    let max = 0; for (let x = 0; x < W; x++) { profile[x] = Math.max(0, profile[x] - base); if (profile[x] > max) max = profile[x]; }
    const thr = prominence * (max + 1e-9), peaks = [];
    for (let x = 1; x < W - 1; x++) {
      if (profile[x] > thr && profile[x] >= profile[x - 1] && profile[x] > profile[x + 1]) {
        if (!peaks.length || x - peaks[peaks.length - 1] >= minSep) peaks.push(x);
        else if (profile[x] > profile[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = x;
      }
    }
    return { count: peaks.length, peaks, profile };
  }

  return { OFFSET_SCALE, peaks2d, decodeLines, classicalCount };
});
