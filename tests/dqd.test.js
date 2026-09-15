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

test('the window floor is empty even at the maximum offset', () => {
  const o = DQD.occupation(p, p.vMin + p.offsetMax, p.vMin + p.offsetMax);
  assert.strictEqual(o.g1, 0); assert.strictEqual(o.g2, 0);
});

test('nudge clamps the offset to ±offsetMax', () => {
  const dev = DQD.createDevice(p, DQD.mulberry32(4));
  dev.nudge(100, -100);
  assert.strictEqual(dev.offset.d1, p.offsetMax); assert.strictEqual(dev.offset.d2, -p.offsetMax);
});

test('drift is a random walk with the configured scale', () => {
  const dev = DQD.createDevice(p, DQD.mulberry32(3), { driftSigma: 1 });
  let sq = 0; const N = 2000;
  for (let i = 0; i < N; i++) { dev.offset.d1 = 0; dev.drift(1); sq += dev.offset.d1 ** 2; }
  const rms = Math.sqrt(sq / N);
  assert.ok(Math.abs(rms - 1) < 0.1, `rms ${rms}`);
});

/* ---------------- change-point detector ---------------- */

test('stepDiff needs complete windows and measures a clean step', () => {
  const tr = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
  assert.strictEqual(DQD.stepDiff(tr, 2, 4), null);
  assert.strictEqual(DQD.stepDiff(tr, 4, 4), 1);
  assert.ok(Math.abs(DQD.stepDiff(tr, 5, 4) - 0.75) < 1e-9);
});

test('detector confirms a step at the right place with the full height, and not on noise', () => {
  const rand = DQD.mulberry32(11), sigma = 0.05;
  const det = DQD.createDetector({ w: 4, k: 4, sigma });
  let found = null;
  for (let i = 0; i < 60; i++) {
    const x = (i >= 30 ? 0.6 : 0) + sigma * DQD.gauss(rand);
    const r = det.push(x);
    if (r) { assert.strictEqual(found, null, 'reported twice'); found = r; }
  }
  assert.ok(found, 'no step found');
  assert.ok(Math.abs(found.i - 29) <= 1, `position ${found.i}`);
  assert.ok(Math.abs(found.height - 0.6) < 0.1, `height ${found.height}`);
  const quiet = DQD.createDetector({ w: 4, k: 4, sigma });
  for (let i = 0; i < 2000; i++) assert.strictEqual(quiet.push(sigma * DQD.gauss(rand)), null);
});

test('detector does not re-report the same edge once confirmed', () => {
  const det = DQD.createDetector({ w: 4, k: 5, sigma: 0.05 });
  let reports = 0;
  for (let i = 0; i < 40; i++) if (det.push(i >= 20 ? 1 : 0)) reports++;
  assert.strictEqual(reports, 1);
});

test('classifyStep tells the two dots apart by step height', () => {
  assert.strictEqual(DQD.classifyStep(p, 0.95), 'dot1');
  assert.strictEqual(DQD.classifyStep(p, -0.62), 'dot2');
});

/* ---------------- auto-tuner ---------------- */

function runUntil(tuner, pred, max) { while (!pred() && tuner.measurements < max) tuner.step(); }

test('tuner locks in (1,1) from 50 random starts within 2000 measurements', () => {
  for (let seed = 0; seed < 50; seed++) {
    const rand = DQD.mulberry32(100 + seed);
    const dev = DQD.createDevice(p, rand, { driftSigma: 0 });
    const start = { V1: 20 + 110 * rand(), V2: 20 + 110 * rand() };
    const t = DQD.createTuner(dev, { start });
    runUntil(t, () => t.state === 'locked', 2000);
    assert.strictEqual(t.state, 'locked', `seed ${seed} ended in ${t.state} after ${t.measurements} (events: ${t.events.join(' ')})`);
    const o = dev.truth(t.V1, t.V2);
    assert.ok(o.g1 === 1 && o.g2 === 1, `seed ${seed} locked in (${o.g1},${o.g2}) at ${t.V1.toFixed(1)},${t.V2.toFixed(1)} (events: ${t.events.join(' ')})`);
    assert.strictEqual(t.N1, 1); assert.strictEqual(t.N2, 1);
    assert.ok(t.walls.right - t.walls.left > 20, 'walls found');
  }
});

test('a 20 mV offset is detected as drift and the tuner re-locks in (1,1)', () => {
  const rand = DQD.mulberry32(5);
  const dev = DQD.createDevice(p, rand, { driftSigma: 0 });
  const t = DQD.createTuner(dev, { start: { V1: 90, V2: 100 } });
  runUntil(t, () => t.state === 'locked', 2000);
  dev.nudge(20, 0);
  runUntil(t, () => t.state !== 'locked', 500);
  assert.ok(t.events.includes('drift'), `drift event (events: ${t.events.join(' ')})`);
  runUntil(t, () => t.state === 'locked', 4000);
  const o = dev.truth(t.V1, t.V2);
  assert.ok(o.g1 === 1 && o.g2 === 1, `re-locked in (${o.g1},${o.g2})`);
  assert.strictEqual(t.retunes, 1);
});

test('a small offset that brings a wall within 6 mV triggers a re-centre, not a re-tune', () => {
  const rand = DQD.mulberry32(9);
  const dev = DQD.createDevice(p, rand, { driftSigma: 0 });
  const t = DQD.createTuner(dev, { start: { V1: 60, V2: 70 } });
  runUntil(t, () => t.state === 'locked', 2000);
  const half = (t.walls.right - t.walls.left) / 2;
  dev.nudge(half - 4, 0);                       // right wall now ~4 mV away
  runUntil(t, () => t.recentres > 0, 1500);
  assert.strictEqual(t.recentres, 1, `recentres (events: ${t.events.join(' ')})`);
  assert.strictEqual(t.retunes, 0);
  runUntil(t, () => t.state === 'locked', 3000);
  const o = dev.truth(t.V1, t.V2);
  assert.ok(o.g1 === 1 && o.g2 === 1, `after recentre: (${o.g1},${o.g2})`);
});

test('an offset that lands during the check phase is a re-tune, not a re-centre in the wrong cell', () => {
  const rand = DQD.mulberry32(21);
  const dev = DQD.createDevice(p, rand, { driftSigma: 0 });
  const t = DQD.createTuner(dev, { start: { V1: 70, V2: 80 } });
  runUntil(t, () => t.state === 'locked', 2000);
  runUntil(t, () => t.state === 'check', 1000);
  assert.strictEqual(t.state, 'check');
  dev.nudge(-22, -13);
  runUntil(t, () => t.retunes > 0 || t.recentres > 0, 1000);
  assert.strictEqual(t.retunes, 1, `expected a re-tune (events: ${t.events.join(' ')})`);
  runUntil(t, () => t.state === 'locked', 4000);
  const o = dev.truth(t.V1, t.V2);
  assert.ok(o.g1 === 1 && o.g2 === 1, `re-locked in (${o.g1},${o.g2})`);
});

test('the tuner never reads the ground truth', () => {
  const dev = DQD.createDevice(p, DQD.mulberry32(2), { driftSigma: 0 });
  let calls = 0; const truth = dev.truth; dev.truth = (a, b) => { calls++; return truth(a, b); };
  const measureCalls = { n: 0 }; const measure = dev.measure; dev.measure = (a, b) => { measureCalls.n++; return measure(a, b); };
  const t = DQD.createTuner(dev, { start: { V1: 70, V2: 60 } });
  runUntil(t, () => t.state === 'locked', 2000);
  // measure() calls truth() internally once per measurement; nothing else may.
  assert.strictEqual(calls, measureCalls.n);
  assert.strictEqual(t.measurements, measureCalls.n);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
