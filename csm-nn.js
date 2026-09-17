/* csm-nn.js — a dependency-free CNN inference engine for the CSM models
   exported by ml/export_weights.py (float16 blob + JSON manifest, BatchNorm
   folded into the convolutions). Runs the classifier (encoder + GAP + MLP)
   and the ChargeLineNet U-Net on Float32Arrays in NCHW layout, in plain JS,
   inside a Web Worker on the page. Numerics mirror PyTorch: zero-padded
   'same' convolutions, 2x2 max-pooling, bilinear x2 upsampling with
   align_corners=False, and the fixed preprocessing stem of train_csm.py. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CSMNN = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /* ---------------- float16 ---------------- */
  function decodeFloat16(u16) {
    const out = new Float32Array(u16.length);
    for (let i = 0; i < u16.length; i++) {
      const h = u16[i], s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
      if (e === 0) out[i] = s * Math.pow(2, -14) * (f / 1024);
      else if (e === 31) out[i] = f ? NaN : s * Infinity;
      else out[i] = s * Math.pow(2, e - 15) * (1 + f / 1024);
    }
    return out;
  }

  /* ---------------- preprocessing stem ----------------
     Per-image standardisation, then local contrast normalisation with a 9x9
     Gaussian (sigma 2), reflect padding, eps 1e-3 — as preprocess_t() in
     ml/train_csm.py. */
  const LCN_R = 4, LCN_K = (() => {
    const k = new Float32Array(2 * LCN_R + 1); let s = 0;
    for (let i = -LCN_R; i <= LCN_R; i++) { k[i + LCN_R] = Math.exp(-i * i / 8); s += k[i + LCN_R]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    return k;
  })();
  const refl = (i, n) => i < 0 ? -i : i >= n ? 2 * n - 2 - i : i;
  function blurSep(x, H, W) {
    const tmp = new Float32Array(H * W), out = new Float32Array(H * W);
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      let s = 0; for (let t = -LCN_R; t <= LCN_R; t++) s += LCN_K[t + LCN_R] * x[y * W + refl(xx + t, W)];
      tmp[y * W + xx] = s;
    }
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      let s = 0; for (let t = -LCN_R; t <= LCN_R; t++) s += LCN_K[t + LCN_R] * tmp[refl(y + t, H) * W + xx];
      out[y * W + xx] = s;
    }
    return out;
  }
  function preprocess(img, H, W) {
    const n = H * W, x = new Float32Array(n);
    let mu = 0; for (let i = 0; i < n; i++) mu += img[i]; mu /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (img[i] - mu) * (img[i] - mu); v /= n;
    const sd = Math.sqrt(v) + 1e-6;
    for (let i = 0; i < n; i++) x[i] = (img[i] - mu) / sd;
    const lm = blurSep(x, H, W);
    const d2 = new Float32Array(n); for (let i = 0; i < n; i++) d2[i] = (x[i] - lm[i]) * (x[i] - lm[i]);
    const lv = blurSep(d2, H, W);
    const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = (x[i] - lm[i]) / Math.sqrt(lv[i] + 1e-3);
    return out;
  }

  /* ---------------- ops (NCHW, Float32Array) ---------------- */
  function conv2d(x, C, H, W, w, b, cout, k, relu) {
    const p = (k - 1) >> 1, out = new Float32Array(cout * H * W), HW = H * W;
    for (let co = 0; co < cout; co++) {
      const ob = co * HW, bias = b[co];
      for (let i = 0; i < HW; i++) out[ob + i] = bias;
      for (let ci = 0; ci < C; ci++) {
        const ib = ci * HW;
        for (let ky = 0; ky < k; ky++) {
          const dy = ky - p, y0 = Math.max(0, -dy), y1 = Math.min(H, H - dy);
          for (let kx = 0; kx < k; kx++) {
            const dx = kx - p, x0 = Math.max(0, -dx), x1 = Math.min(W, W - dx);
            const wv = w[((co * C + ci) * k + ky) * k + kx];
            if (wv === 0) continue;
            for (let y = y0; y < y1; y++) {
              const orow = ob + y * W, irow = ib + (y + dy) * W + dx;
              for (let xx = x0; xx < x1; xx++) out[orow + xx] += wv * x[irow + xx];
            }
          }
        }
      }
      if (relu) for (let i = ob; i < ob + HW; i++) if (out[i] < 0) out[i] = 0;
    }
    return out;
  }
  function maxpool2(x, C, H, W) {
    const h = H >> 1, w = W >> 1, out = new Float32Array(C * h * w);
    for (let c = 0; c < C; c++) for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const i = c * H * W + 2 * y * W + 2 * xx;
      const m = Math.max(x[i], x[i + 1], x[i + W], x[i + W + 1]);
      out[c * h * w + y * w + xx] = m;
    }
    return out;
  }
  function upsample2(x, C, H, W) {
    const H2 = 2 * H, W2 = 2 * W, out = new Float32Array(C * H2 * W2);
    // align_corners=False: src = max(0, (dst + 0.5) / 2 - 0.5)
    const y0a = new Int32Array(H2), y1a = new Int32Array(H2), fya = new Float32Array(H2);
    for (let y = 0; y < H2; y++) { const s = Math.max(0, (y + 0.5) / 2 - 0.5), i = Math.min(H - 1, Math.floor(s)); y0a[y] = i; y1a[y] = Math.min(H - 1, i + 1); fya[y] = s - i; }
    const x0a = new Int32Array(W2), x1a = new Int32Array(W2), fxa = new Float32Array(W2);
    for (let xx = 0; xx < W2; xx++) { const s = Math.max(0, (xx + 0.5) / 2 - 0.5), i = Math.min(W - 1, Math.floor(s)); x0a[xx] = i; x1a[xx] = Math.min(W - 1, i + 1); fxa[xx] = s - i; }
    for (let c = 0; c < C; c++) {
      const ib = c * H * W, ob = c * H2 * W2;
      for (let y = 0; y < H2; y++) {
        const r0 = ib + y0a[y] * W, r1 = ib + y1a[y] * W, fy = fya[y], orow = ob + y * W2;
        for (let xx = 0; xx < W2; xx++) {
          const fx = fxa[xx], x0 = x0a[xx], x1 = x1a[xx];
          const top = x[r0 + x0] * (1 - fx) + x[r0 + x1] * fx, bot = x[r1 + x0] * (1 - fx) + x[r1 + x1] * fx;
          out[orow + xx] = top * (1 - fy) + bot * fy;
        }
      }
    }
    return out;
  }
  function concat(a, Ca, b, Cb, H, W) {
    const out = new Float32Array((Ca + Cb) * H * W);
    out.set(a, 0); out.set(b, Ca * H * W);
    return out;
  }
  function gap(x, C, H, W) {
    const out = new Float32Array(C), HW = H * W;
    for (let c = 0; c < C; c++) { let s = 0; for (let i = 0; i < HW; i++) s += x[c * HW + i]; out[c] = s / HW; }
    return out;
  }
  function linear(x, w, b, cout, cin, relu) {
    const out = new Float32Array(cout);
    for (let o = 0; o < cout; o++) { let s = b[o]; for (let i = 0; i < cin; i++) s += w[o * cin + i] * x[i]; out[o] = relu && s < 0 ? 0 : s; }
    return out;
  }
  const sigmoid = v => 1 / (1 + Math.exp(-v));

  /* ---------------- models ---------------- */
  function buildModel(manifest, weights) {
    const L = {};
    for (const e of manifest.layers) L[e.name] = { ...e, w: weights.subarray(e.w_off, e.w_off + e.w_len), b: weights.subarray(e.b_off, e.b_off + e.b_len) };
    const H = manifest.input[1], W = manifest.input[2];
    const conv = (name, x, C, h, w) => { const e = L[name]; return [conv2d(x, C, h, w, e.w, e.b, e.cout, e.k, e.relu), e.cout]; };

    function runClassifier(img) {
      let x = preprocess(img, H, W), C = 1, h = H, w = W;
      [x, C] = conv('stem', x, C, h, w);
      for (let s = 1; s <= 4; s++) {
        [x, C] = conv(`s${s}.0`, x, C, h, w); [x, C] = conv(`s${s}.1`, x, C, h, w);
        x = maxpool2(x, C, h, w); h >>= 1; w >>= 1;
      }
      const g = gap(x, C, h, w);
      const f1 = linear(g, L.fc1.w, L.fc1.b, L.fc1.cout, L.fc1.cin, true);
      const logits = linear(f1, L.fc2.w, L.fc2.b, L.fc2.cout, L.fc2.cin, false);
      return { probs: Array.from(logits, sigmoid) };
    }

    function runUNet(img) {
      const bn = manifest.bneck_convs || 2;
      let x = preprocess(img, H, W), C = 1;
      let e1, C1, e2, C2, e3, C3;
      [x, C] = conv('enc1.0', x, C, H, W); [e1, C1] = conv('enc1.1', x, C, H, W);
      x = maxpool2(e1, C1, H, W); const H2 = H >> 1, W2 = W >> 1;
      [x, C] = conv('enc2.0', x, C1, H2, W2); [e2, C2] = conv('enc2.1', x, C, H2, W2);
      x = maxpool2(e2, C2, H2, W2); const H3 = H2 >> 1, W3 = W2 >> 1;
      [x, C] = conv('enc3.0', x, C2, H3, W3); [e3, C3] = conv('enc3.1', x, C, H3, W3);
      x = maxpool2(e3, C3, H3, W3); const H4 = H3 >> 1, W4 = W3 >> 1; C = C3;
      for (let i = 0; i < bn; i++) [x, C] = conv(`bneck.${i}`, x, C, H4, W4);
      x = concat(upsample2(x, C, H4, W4), C, e3, C3, H3, W3); C += C3;
      [x, C] = conv('dec3.0', x, C, H3, W3); [x, C] = conv('dec3.1', x, C, H3, W3);
      x = concat(upsample2(x, C, H3, W3), C, e2, C2, H2, W2); C += C2;
      [x, C] = conv('dec2.0', x, C, H2, W2); [x, C] = conv('dec2.1', x, C, H2, W2);
      x = concat(upsample2(x, C, H2, W2), C, e1, C1, H, W); C += C1;
      [x, C] = conv('dec1.0', x, C, H, W); [x, C] = conv('dec1.1', x, C, H, W);
      [x, C] = conv('head', x, C, H, W);
      return { heat: x, channels: C, H, W };
    }

    return {
      name: manifest.name, kind: manifest.kind, params: manifest.params, H, W,
      run: manifest.kind === 'classifier' ? runClassifier : runUNet
    };
  }

  async function loadModel(manifestUrl) {
    const manifest = await (await fetch(manifestUrl)).json();
    const binUrl = manifestUrl.replace(/\.json$/, '.bin');
    const buf = await (await fetch(binUrl)).arrayBuffer();
    return buildModel(manifest, decodeFloat16(new Uint16Array(buf)));
  }

  return { decodeFloat16, preprocess, conv2d, maxpool2, upsample2, concat, gap, linear, sigmoid, buildModel, loadModel };
});
