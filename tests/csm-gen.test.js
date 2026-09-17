/**
 * tests/csm-gen.test.js — the browser generator: bounds, labels, class variants,
 * the injected jump, and a contact-sheet PNG (scratch path in argv[2]) for eyeballing.
 */
const assert = require('assert');
const fs = require('fs');
const zlib = require('zlib');
const G = require('../csm-gen.js');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); passed++; } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; } }
const { H, W } = G;

test('images are in [0,1] with correct size; labels consistent; endpoints inside the map', () => {
  const rng = G.makeRng(1);
  for (let i = 0; i < 400; i++) {
    const cls = ['clean', 'degraded', 'unstable', 'unclear'][i % 4];
    const { img, label } = G.generate(rng, cls);
    assert.strictEqual(img.length, H * W);
    for (const v of img) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v));
    assert.strictEqual(label.n, label.lines.length);
    for (const l of label.lines) {
      assert.ok(l.xs >= 0 && l.xs < W && l.xe >= 0 && l.xe < W);
      assert.ok(l.ye >= 0 && l.ye < l.ys && l.ys < H && l.ys - l.ye >= 20);
    }
    assert.strictEqual(label.clean, cls === 'clean'); assert.strictEqual(label.unstable, cls === 'unstable'); assert.strictEqual(label.unclear, cls === 'unclear');
  }
});

test('the line-count distribution and mean brightness are in the expected ranges', () => {
  const rng = G.makeRng(2); const counts = new Array(8).fill(0); let mean = 0;
  for (let i = 0; i < 500; i++) { const { img, label } = G.generate(rng, 'clean'); counts[label.n]++; let s = 0; for (const v of img) s += v; mean += s / img.length; }
  mean /= 500;
  assert.ok(counts[0] > 5 && counts[7] > 5, `count histogram ${counts}`);
  assert.ok(mean > 0.12 && mean < 0.45, `mean brightness ${mean}`);
});

test('a clean map is brighter along its lines than beside them', () => {
  const rng = G.makeRng(3); let hits = 0, tot = 0;
  for (let i = 0; i < 50; i++) {
    const { img, label } = G.generate(rng, 'clean');
    for (const l of label.lines) {
      const y = Math.round((l.ys + l.ye) / 2), x = Math.round(l.xs + (l.xe - l.xs) * 0.5);
      const on = img[y * W + x], off = (img[y * W + Math.max(0, x - 5)] + img[y * W + Math.min(W - 1, x + 5)]) / 2;
      tot++; if (on > off + 0.05) hits++;
    }
  }
  assert.ok(hits / tot > 0.85, `on-line brighter in ${hits}/${tot}`);
});

test('injectJump shifts rows below the cut and leaves rows above untouched', () => {
  const rng = G.makeRng(4); const { img } = G.generate(rng, 'clean');
  const out = G.injectJump(img, 64, 6);
  for (let i = 0; i < 64 * W; i++) assert.strictEqual(out[i], img[i]);
  let diff = 0; for (let y = 64; y < H; y++) for (let x = 6; x < W; x++) if (out[y * W + x] !== img[y * W + x - 6]) diff++;
  assert.strictEqual(diff, 0);
});

/* ---------------- contact sheet ---------------- */
function png(width, height, rgb) {
  const crc32 = (buf) => { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
if (process.argv[2]) {
  const cols = 6, classes = ['clean', 'degraded', 'unstable', 'unclear'], S = 128, gap = 4;
  const width = cols * (S + gap), height = classes.length * (S + gap), rgb = Buffer.alloc(width * height * 3, 30);
  const rng = G.makeRng(11);
  classes.forEach((cls, r) => { for (let c = 0; c < cols; c++) {
    const { img, label } = G.generate(rng, cls);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = Math.round(img[y * S + x] * 255), o = ((r * (S + gap) + y) * width + c * (S + gap) + x) * 3; rgb[o] = rgb[o + 1] = rgb[o + 2] = v; }
    for (const l of label.lines) { for (const [px, py, col] of [[l.xs, l.ys, [80, 220, 120]], [l.xe, l.ye, [230, 150, 60]]]) { const X = Math.round(px), Y = Math.round(py); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = X + dx, yy = Y + dy; if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue; const o = ((r * (S + gap) + yy) * width + c * (S + gap) + xx) * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2]; } } }
  } });
  fs.writeFileSync(process.argv[2], png(width, height, rgb));
  console.log('  contact sheet written to', process.argv[2]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
