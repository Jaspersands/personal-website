/**
 * tests/csm-nn.test.js — the JS inference engine against reference
 * implementations, known values, and (when present) the PyTorch golden fixture
 * written by ml/export_weights.py.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const NN = require('../csm-nn.js');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); passed++; } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; } }
const rnd = (seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; })(42);
const randArr = n => Float32Array.from({ length: n }, () => rnd() * 2 - 1);
const close = (a, b, tol, what) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tol) throw new Error(`${what}: index ${i}: ${a[i]} vs ${b[i]}`); };

test('float16 decode: known bit patterns', () => {
  const v = NN.decodeFloat16(new Uint16Array([0x3C00, 0xC000, 0x3800, 0x0001, 0x7BFF, 0x0000]));
  assert.deepStrictEqual(Array.from(v.slice(0, 3)), [1, -2, 0.5]);
  assert.ok(Math.abs(v[3] - 5.960464477539063e-8) < 1e-12);
  assert.ok(Math.abs(v[4] - 65504) < 1e-6);
  assert.strictEqual(v[5], 0);
});

test('conv2d matches a naive reference (3x3 and 1x1, with and without relu)', () => {
  const C = 2, H = 5, W = 6, cout = 3;
  const x = randArr(C * H * W);
  for (const k of [3, 1]) for (const relu of [false, true]) {
    const w = randArr(cout * C * k * k), b = randArr(cout), p = (k - 1) >> 1;
    const ref = new Float32Array(cout * H * W);
    for (let co = 0; co < cout; co++) for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      let s = b[co];
      for (let ci = 0; ci < C; ci++) for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) {
        const yy = y + ky - p, xq = xx + kx - p;
        if (yy < 0 || yy >= H || xq < 0 || xq >= W) continue;
        s += w[((co * C + ci) * k + ky) * k + kx] * x[ci * H * W + yy * W + xq];
      }
      ref[co * H * W + y * W + xx] = relu ? Math.max(0, s) : s;
    }
    close(NN.conv2d(x, C, H, W, w, b, cout, k, relu), ref, 1e-5, `k=${k} relu=${relu}`);
  }
});

test('maxpool2 takes the max of each 2x2 block per channel', () => {
  const x = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, /* channel 2 */ -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12, -13, -14, -15, -16]);
  assert.deepStrictEqual(Array.from(NN.maxpool2(x, 2, 4, 4)), [6, 8, 14, 16, -1, -3, -9, -11]);
});

test('upsample2 is PyTorch bilinear with align_corners=False', () => {
  const out = NN.upsample2(Float32Array.from([1, 2, 3, 4]), 1, 2, 2);
  const exp = [1, 1.25, 1.75, 2, 1.5, 1.75, 2.25, 2.5, 2.5, 2.75, 3.25, 3.5, 3, 3.25, 3.75, 4];
  close(out, Float32Array.from(exp), 1e-6, 'upsample');
});

test('concat, gap and linear', () => {
  const c = NN.concat(Float32Array.from([1, 2, 3, 4]), 1, Float32Array.from([5, 6, 7, 8]), 1, 2, 2);
  assert.deepStrictEqual(Array.from(c), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(Array.from(NN.gap(c, 2, 2, 2)), [2.5, 6.5]);
  const l = NN.linear(Float32Array.from([1, 2]), Float32Array.from([1, 1, -1, 0]), Float32Array.from([0.5, 0.5]), 2, 2, true);
  assert.deepStrictEqual(Array.from(l), [3.5, 0]);
});

test('preprocess is zero-mean-ish and invariant to gain and offset', () => {
  const H = 32, W = 32, img = new Float32Array(H * W);
  for (let i = 0; i < img.length; i++) img[i] = 0.3 + 0.4 * rnd() + (i % W > 15 ? 0.2 : 0);
  const a = NN.preprocess(img, H, W);
  const scaled = img.map(v => 0.5 * v + 0.2);
  const b = NN.preprocess(scaled, H, W);
  close(a, b, 1e-4, 'affine invariance');
  let m = 0; for (const v of a) m += v; m /= a.length;
  assert.ok(Math.abs(m) < 0.2, `mean ${m}`);
});

test('buildModel runs a tiny U-Net and classifier end to end with the right shapes', () => {
  const layers = [], blob = [];
  let off = 0;
  const add = (name, cout, cin, k, relu) => {
    const wl = cout * cin * k * k; layers.push({ name, type: k ? 'conv' : 'linear', cout, cin, k: k || 1, relu, w_off: off, w_len: wl, b_off: off + wl, b_len: cout });
    blob.push(randArr(wl).map(v => v * 0.3), randArr(cout)); off += wl + cout;
  };
  add('enc1.0', 2, 1, 3, true); add('enc1.1', 2, 2, 3, true); add('enc2.0', 3, 2, 3, true); add('enc2.1', 3, 3, 3, true);
  add('enc3.0', 4, 3, 3, true); add('enc3.1', 4, 4, 3, true); add('bneck.0', 4, 4, 3, true); add('bneck.1', 4, 4, 3, true);
  add('dec3.0', 4, 8, 3, true); add('dec3.1', 4, 4, 3, true); add('dec2.0', 3, 7, 3, true); add('dec2.1', 3, 3, 3, true);
  add('dec1.0', 2, 5, 3, true); add('dec1.1', 2, 2, 3, true); add('head', 3, 2, 1, false);
  const w = new Float32Array(off); let o = 0; for (const p of blob) { w.set(p, o); o += p.length; }
  const m = NN.buildModel({ name: 't', kind: 'unet', input: [1, 16, 16], params: off, layers, bneck_convs: 2 }, w);
  const img = new Float32Array(256).map(() => rnd());
  const out = m.run(img);
  assert.strictEqual(out.channels, 3); assert.strictEqual(out.heat.length, 3 * 256);
  assert.ok(out.heat.every(Number.isFinite));
});

/* ---------------- golden fixture (PyTorch outputs) ---------------- */
const fixture = path.join(__dirname, 'fixtures', 'csm-golden.json');
const models = path.join(__dirname, '..', 'assets', 'models');
if (fs.existsSync(fixture) && fs.existsSync(path.join(models, 'compact.json'))) {
  const fx = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const img = Float32Array.from(fx.image, v => v / 255);
  const load = name => NN.buildModel(JSON.parse(fs.readFileSync(path.join(models, name + '.json'), 'utf8')),
    NN.decodeFloat16(new Uint16Array(fs.readFileSync(path.join(models, name + '.bin')).buffer.slice(0))));
  test('golden: classifier probabilities match PyTorch within 2e-3', () => {
    const t0 = performance.now(); const { probs } = load('classifier').run(img); const ms = performance.now() - t0;
    close(Float32Array.from(probs), Float32Array.from(fx.classifier), 2e-3, 'probs');
    console.log(`      probs ${probs.map(p => p.toFixed(3)).join(' / ')} in ${ms.toFixed(0)} ms`);
  });
  for (const name of ['compact', 'full']) {
    if (!fx[name] || !fs.existsSync(path.join(models, name + '.json'))) continue;
    test(`golden: ${name} heatmap matches PyTorch within 5e-3 (max abs)`, () => {
      const m = load(name); const t0 = performance.now(); const out = m.run(img); const ms = performance.now() - t0;
      const ref = Float32Array.from(fx[name].heat);
      let maxErr = 0; for (let i = 0; i < ref.length; i++) maxErr = Math.max(maxErr, Math.abs(out.heat[i] - ref[i]));
      const sub = []; for (let c = 1; c < 3; c++) for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) sub.push(out.heat[c * 16384 + y * 128 + x]);
      let maxOff = 0; fx[name].offsets_sub8.forEach((v, i) => { maxOff = Math.max(maxOff, Math.abs(sub[i] - v)); });
      console.log(`      ${m.params.toLocaleString()} params, ${ms.toFixed(0)} ms, max |Δheat| ${maxErr.toExponential(2)}, max |Δoffset| ${maxOff.toExponential(2)}`);
      assert.ok(maxErr < 5e-3, `heat max error ${maxErr}`);
      assert.ok(maxOff < 1e-2, `offset max error ${maxOff}`);
    });
  }
} else {
  console.log('  (golden fixture not present yet — export the models to enable it)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
