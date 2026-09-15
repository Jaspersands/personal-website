/**
 * tests/dqd.test.js
 *
 * Node test suite for dqd.js: constant-interaction model, charge sensor,
 * change-point detector, and the auto-tuner state machine.
 */
const assert = require('assert');
const DQD = require('../dqd.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
const p = DQD.defaultParams();

/* ---------------- model + sensor ---------------- */

test('ground state is (0,0) at zero gate voltage', () => {
  const o = DQD.occupation(p, 0, 0);
  assert.strictEqual(o.g1, 0); assert.strictEqual(o.g2, 0);
  assert.ok(o.N1 < 0.01 && o.N2 < 0.01);
});

test('charge on each dot is non-decreasing along its own gate', () => {
  for (const V2 of [0, 30, 70]) {
    let prev = -1;
    for (let V1 = 0; V1 <= p.vMax; V1 += 0.5) {
      const g = DQD.occupation(p, V1, V2).g1;
      assert.ok(g >= prev, `g1 dropped at V1=${V1}, V2=${V2}`); prev = g;
    }
  }
  for (const V1 of [0, 30, 70]) {
    let prev = -1;
    for (let V2 = 0; V2 <= p.vMax; V2 += 0.5) {
      const g = DQD.occupation(p, V1, V2).g2;
      assert.ok(g >= prev, `g2 dropped at V2=${V2}, V1=${V1}`); prev = g;
    }
  }
});

test('analytic transition lines match the ground state within 1 mV', () => {
  const V2 = 30, N2 = DQD.occupation(p, 0, V2).g2;
  for (let N1 = 0; N1 < 4; N1++) {
    const Vt = DQD.transitionV1(p, N1, N2, V2);
    if (Vt > p.vMax - 1) break;
    assert.strictEqual(DQD.occupation(p, Vt - 1, V2).g1, N1, `below line N1=${N1}`);
    assert.strictEqual(DQD.occupation(p, Vt + 1, V2).g1, N1 + 1, `above line N1=${N1}`);
  }
  const V1 = 22, N1 = DQD.occupation(p, V1, 0).g1;
  for (let N2 = 0; N2 < 4; N2++) {
    const Vt = DQD.transitionV2(p, N1, N2, V1);
    if (Vt > p.vMax - 1) break;
    assert.strictEqual(DQD.occupation(p, V1, Vt - 1).g2, N2);
    assert.strictEqual(DQD.occupation(p, V1, Vt + 1).g2, N2 + 1);
  }
});

test('the (1,1) cell exists inside the window and is roughly one charging period wide', () => {
  const V1 = 28, V2 = 30;
  const o = DQD.occupation(p, V1, V2);
  assert.strictEqual(o.g1, 1); assert.strictEqual(o.g2, 1);
  const left = DQD.transitionV1(p, 0, 1, V2), right = DQD.transitionV1(p, 1, 1, V2);
  assert.ok(right - left > 20 && right - left < 40, `width ${right - left}`);
});

test('sensor: dot-1 step ≈ s1, dot-2 step ≈ s2, noise ≈ sigma', () => {
  const rand = DQD.mulberry32(7);
  const dev = DQD.createDevice(p, rand);
  const mean = (V1, V2, n = 400) => { let s = 0; for (let i = 0; i < n; i++) s += dev.measure(V1, V2); return s / n; };
  const V2 = 30, t1 = DQD.transitionV1(p, 0, 1, V2);
  const step1 = mean(t1 + 2, V2) - mean(t1 - 2, V2);
  assert.ok(Math.abs(step1 - p.s1) < 0.05, `dot-1 step ${step1}`);
  const V1 = 28, t2 = DQD.transitionV2(p, 1, 0, V1);
  const step2 = mean(V1, t2 + 2) - mean(V1, t2 - 2);
  assert.ok(Math.abs(step2 - p.s2) < 0.05, `dot-2 step ${step2}`);
  const xs = Array.from({ length: 2000 }, () => dev.measure(28, 30));
  const m = xs.reduce((a, b) => a + b) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  assert.ok(Math.abs(sd - p.sigma) < 0.01, `noise sd ${sd}`);
});

test('device offset shifts the honeycomb: truth() and measure() use drifted voltages', () => {
  const dev = DQD.createDevice(p, DQD.mulberry32(1));
  const before = dev.truth(28, 30);
  dev.nudge(30, 0);
  const after = dev.truth(28, 30);
  assert.strictEqual(before.g1, 1);
  assert.strictEqual(after.g1, 2);
  assert.strictEqual(dev.offset.d1, 30);
});

test('drift is a random walk with the configured scale', () => {
  const dev = DQD.createDevice(p, DQD.mulberry32(3), { driftSigma: 1 });
  let sq = 0; const N = 2000;
  for (let i = 0; i < N; i++) { dev.offset.d1 = 0; dev.drift(1); sq += dev.offset.d1 ** 2; }
  const rms = Math.sqrt(sq / N);
  assert.ok(Math.abs(rms - 1) < 0.1, `rms ${rms}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
