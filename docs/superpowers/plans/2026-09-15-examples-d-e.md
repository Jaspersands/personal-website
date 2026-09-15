# D + E Example Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `examples.html`, a standalone page showing E (full-bleed surface code hero that zooms out on scroll into a lattice-surgery fabric, decoded live by the real Rust/WASM engine) and D (a simulated double quantum dot with a real auto-tuning routine), touching no existing site files.

**Architecture:** Pure logic in UMD modules tested with plain Node (`sessions.js`, `dqd.js`, `fabric-math.js`; the existing `engine.js` and `hero-math.js` are reused untouched); browser-only IIFEs for rendering (`fabric.js`, `tuner-view.js`); one HTML page + one stylesheet reusing the site's design tokens. The wasm at `assets/stabilizer_qec.wasm` is the only decoder.

**Tech Stack:** Vanilla JS (no build, no modules), Canvas 2D, WebAssembly (bare C-ABI, no imports), Node ≥ 20 for tests, `python3 -m http.server 4173` for preview (`.claude/launch.json` → `site`).

## Global Constraints

- New files only. Do not modify `index.html`, `styles.css`, `script.js`, `engine.js`, `hero.js`, `hero-math.js`, `surface-code.js`, or existing tests (the A+ session owns them and has uncommitted edits in the tree).
- Branch: `feature/surface-code-hero` (shared with the concurrent A+ build — commit only your own new files, never `git add -A`). Commit after every task with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- UMD pattern for testable modules, matching `surface-code.js`:
  ```js
  (function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.NAME = factory();
  })(typeof globalThis !== 'undefined' ? globalThis : this, () => { /* ... */ return API; });
  ```
- Tests: `node tests/<name>.test.js`, no framework, `assert` from Node, same `test(name, fn)` helper shape as `tests/surface-code.test.js` (prints ✓/✗, exits 1 on failure).
- Wasm facts (verified): no imports; `wasm_toggle_error(ptr,q,type,0)` with type `0`=X, `1`=Z; stabilizer type `1`=X, `0`=Z, X indexed first; data qubits at odd coords in `[1,2d−1]`, index `i` → `x=2(i mod d)+1`, `y=2⌊i/d⌋+1`; X half-plaquettes on left/right (`x=0` or `2d`), Z on top/bottom; `wasm_decode(ptr,2)` = exact MWPM, returns `1` on logical error; instantiate with `WebAssembly.instantiate(bytes, {})`.
- Copy in the spec §4.4 and §5.4 is used verbatim.
- Every number shown on the page is produced by the running code; no hard-coded figures.

---

### Task 1: `sessions.js` — independent engine sessions with tests

`engine.js` and `hero-math.js` already exist on the branch (built by the A+ work) and must not be modified. `engine.session(d)` frees the previous session, so E cannot use it for 15 patches. `sessions.js` creates sessions from `engine.rawExports`.

**Files:**
- Create: `sessions.js`
- Test: `tests/sessions.test.js`

**Interfaces:**
- Consumes: `QEC.load(bytesOrUrl) → Promise<{rawExports, session}>` from `engine.js`.
- Produces (global `QECSessions` / `module.exports`): `QECSessions.create(exp, d) → session` with
  `d`, `numQubits`, `numStabs`, `qubits: [{x,y}]`, `stabs: [{x,y,type:'X'|'Z'}]`, `qubitAt(col,row)`,
  `toggle(q, 'X'|'Z'|'Y')`, `syndrome() → Uint8Array` (copy), `decode() → {logical, cx, cz}` (copies, MWPM = decoder 2),
  `applyCorrection(cx, cz)`, `clear()`, `free()`.

- [ ] **Step 1: Write the failing tests** — `tests/sessions.test.js`, identical in content to the engine tests listed in the spec §6, but constructed as `const s = QECSessions.create(engine.rawExports, d)`. Tests: geometry (d² qubits at odd coords, d²−1 stabilizers, X indexed first, `qubitAt`), boundary orientation (X half-plaquettes left/right, Z top/bottom), single bulk X → two diagonal Z defects, left-edge X → one Z defect, top-edge Z → one X defect, full row of X → no syndrome and `logical === 1`, short left-edge chain → `logical === 0` and correction clears the syndrome, 300 random rounds at d=15 p=3 % always cleared, `clear()` resets `logical`, **two sessions are independent** (toggle in one, the other stays quiet — the property engine.js cannot provide), d=27 decode with 40 errors < 20 ms.

- [ ] **Step 2: Run** — `node tests/sessions.test.js` → `Cannot find module '../sessions.js'`.

- [ ] **Step 3: Implement**

```js
/* sessions.js — independent sessions over the QEC wasm exports (engine.rawExports).
   engine.js frees its previous session on every session() call; the fabric needs
   one live session per patch, so sessions are created here instead. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QECSessions = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const PAULI = { X: [0], Z: [1], Y: [0, 1] };
  function create(w, d) {
    const ptr = w.wasm_create_session(d, 0);
    const numQubits = w.wasm_get_data_qubit_count(ptr), numStabs = w.wasm_get_stabilizer_count(ptr);
    const qubits = Array.from({ length: numQubits }, (_, i) => ({ x: w.wasm_get_data_qubit_x(ptr, i), y: w.wasm_get_data_qubit_y(ptr, i) }));
    const stabs = Array.from({ length: numStabs }, (_, i) => ({
      x: w.wasm_get_stabilizer_x(ptr, i), y: w.wasm_get_stabilizer_y(ptr, i),
      type: w.wasm_get_stabilizer_type(ptr, i) === 1 ? 'X' : 'Z' }));
    let freed = false;
    const s = {
      d, ptr, numQubits, numStabs, qubits, stabs,
      qubitAt: (col, row) => row * d + col,
      toggle(q, pauli) { for (const t of PAULI[pauli]) w.wasm_toggle_error(ptr, q, t, 0); },
      syndrome() { return new Uint8Array(w.memory.buffer, w.wasm_get_syndrome(ptr), numStabs).slice(); },
      decode() {
        const logical = w.wasm_decode(ptr, 2);
        const cx = new Uint8Array(w.memory.buffer, w.wasm_get_correction_x_ptr(ptr), numQubits).slice();
        const cz = new Uint8Array(w.memory.buffer, w.wasm_get_correction_z_ptr(ptr), numQubits).slice();
        return { logical, cx, cz };
      },
      applyCorrection(cx, cz) {
        for (let q = 0; q < numQubits; q++) { if (cx[q]) w.wasm_toggle_error(ptr, q, 0, 0); if (cz[q]) w.wasm_toggle_error(ptr, q, 1, 0); }
      },
      clear() { w.wasm_clear_errors(ptr); },
      free() { if (!freed) { freed = true; w.wasm_free_session(ptr); } }
    };
    return s;
  }
  return { create };
});
```

- [ ] **Step 4: Run** — 11 passed.

- [ ] **Step 5: Commit** — `git add sessions.js tests/sessions.test.js && git commit -m "Add sessions.js: independent QEC sessions for the fabric"`

---

### Task 2: `dqd.js` — constant-interaction model, sensor, device

**Files:**
- Create: `dqd.js`
- Test: `tests/dqd.test.js`

**Interfaces:**
- Produces (global `DQD` / `module.exports`):
  - `DQD.defaultParams() → {EC1,EC2,ECm,a11,a12,a21,a22,kT,s1,s2,b,sigma,NMAX,vMin,vMax}`
  - `DQD.energy(p, N1, N2, V1, V2) → meV`
  - `DQD.occupation(p, V1, V2) → {N1, N2, g1, g2}` — thermal averages and ground-state integers
  - `DQD.transitionV1(p, N1, N2, V2) → V1` where `(N1,N2)` and `(N1+1,N2)` are degenerate; `DQD.transitionV2(p, N1, N2, V1) → V2` likewise for dot 2
  - `DQD.mulberry32(seed) → () => [0,1)` and `DQD.gauss(rand) → N(0,1)`
  - `DQD.createDevice(p, rand) → device` with `device.offset = {d1, d2}` (mV), `device.measure(V1, V2) → S`, `device.truth(V1, V2) → occupation at the drifted voltages`, `device.drift(dtSeconds)` (random walk, `driftSigma` mV/√s, default 0.15), `device.nudge(dV1, dV2)`.

- [ ] **Step 1: Write the failing tests** (`tests/dqd.test.js`, first block)

```js
const assert = require('assert');
const DQD = require('../dqd.js');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
const p = DQD.defaultParams();

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
```

End the file (for now) with:
```js
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/dqd.test.js` — Expected: `Cannot find module '../dqd.js'`.

- [ ] **Step 3: Implement the model, sensor, and device in `dqd.js`**

```js
/* dqd.js — constant-interaction model of a double quantum dot, a simulated
   charge sensor, a change-point detector, and an auto-tuner. Pure: no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DQD = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const defaultParams = () => ({
    EC1: 2.4, EC2: 2.2, ECm: 0.55,            // meV
    a11: 0.085, a22: 0.080, a12: 0.018, a21: 0.015, // meV per mV (lever arms)
    kT: 0.015,                                 // meV, ~175 mK
    s1: 1.0, s2: 0.6, b: 0.0015, sigma: 0.05,  // charge-sensor response
    NMAX: 7, vMin: 0, vMax: 140                // electrons per dot, mV window
  });

  const energy = (p, N1, N2, V1, V2) =>
    0.5 * p.EC1 * N1 * N1 + 0.5 * p.EC2 * N2 * N2 + p.ECm * N1 * N2
    - N1 * (p.a11 * V1 + p.a12 * V2) - N2 * (p.a21 * V1 + p.a22 * V2);

  function occupation(p, V1, V2) {
    let g1 = 0, g2 = 0, Emin = Infinity;
    for (let n1 = 0; n1 <= p.NMAX; n1++) for (let n2 = 0; n2 <= p.NMAX; n2++) {
      const E = energy(p, n1, n2, V1, V2);
      if (E < Emin) { Emin = E; g1 = n1; g2 = n2; }
    }
    // Thermal average over the ground state and its neighbours (kT ≪ EC).
    let Z = 0, N1 = 0, N2 = 0;
    for (let n1 = Math.max(0, g1 - 1); n1 <= Math.min(p.NMAX, g1 + 1); n1++)
      for (let n2 = Math.max(0, g2 - 1); n2 <= Math.min(p.NMAX, g2 + 1); n2++) {
        const w = Math.exp(-(energy(p, n1, n2, V1, V2) - Emin) / p.kT);
        Z += w; N1 += w * n1; N2 += w * n2;
      }
    return { N1: N1 / Z, N2: N2 / Z, g1, g2 };
  }

  const transitionV1 = (p, N1, N2, V2) => (p.EC1 * (N1 + 0.5) + p.ECm * N2 - p.a12 * V2) / p.a11;
  const transitionV2 = (p, N1, N2, V1) => (p.EC2 * (N2 + 0.5) + p.ECm * N1 - p.a21 * V1) / p.a22;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const gauss = rand => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  function createDevice(p, rand = Math.random, opts = {}) {
    const driftSigma = opts.driftSigma ?? 0.15; // mV per sqrt(second)
    const dev = {
      p, offset: { d1: 0, d2: 0 },
      truth(V1, V2) { return occupation(p, V1 + dev.offset.d1, V2 + dev.offset.d2); },
      measure(V1, V2) {
        const o = dev.truth(V1, V2);
        return p.s1 * o.N1 + p.s2 * o.N2 + p.b * (V1 + V2) + p.sigma * gauss(rand);
      },
      drift(dt) {
        const s = driftSigma * Math.sqrt(dt);
        dev.offset.d1 += s * gauss(rand); dev.offset.d2 += s * gauss(rand);
      },
      nudge(dV1, dV2) { dev.offset.d1 += dV1; dev.offset.d2 += dV2; }
    };
    return dev;
  }

  return { defaultParams, energy, occupation, transitionV1, transitionV2, mulberry32, gauss, createDevice };
});
```

- [ ] **Step 4: Run tests** — `node tests/dqd.test.js` → 7 passed.

- [ ] **Step 5: Commit**

```bash
git add dqd.js tests/dqd.test.js
git commit -m "Add the double-dot constant-interaction model and charge sensor"
```

---

### Task 3: `dqd.js` — change-point detector

**Files:**
- Modify: `dqd.js` (add to the factory and the returned API)
- Test: `tests/dqd.test.js` (append before the summary lines)

**Interfaces:**
- `DQD.stepDiff(trace, i, w) → number|null` — `mean(trace[i+1..i+w]) − mean(trace[i−w+1..i])`, or `null` if either window is incomplete.
- `DQD.createDetector({w=4, k=4, sigma}) → det` with `det.push(x) → null | {i, height}`; it returns a confirmed step once, `2w` samples after the first exceedance, with `height` the maximum-magnitude windowed difference over the straddling positions and `i` its position (the step lies between `trace[i]` and `trace[i+1]`). `det.trace` is the samples pushed so far; `det.reset()` clears it.
- `DQD.classifyStep(p, height) → 'dot1' | 'dot2'` — nearer to `s1` or `s2` in absolute value.

- [ ] **Step 1: Write the failing tests**

```js
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

test('classifyStep tells the two dots apart by step height', () => {
  assert.strictEqual(DQD.classifyStep(p, 0.95), 'dot1');
  assert.strictEqual(DQD.classifyStep(p, -0.62), 'dot2');
});
```

- [ ] **Step 2: Run** — expected failures: `DQD.stepDiff is not a function`.

- [ ] **Step 3: Implement**

```js
  function stepDiff(trace, i, w) {
    if (i - w + 1 < 0 || i + w >= trace.length) return null;
    let a = 0, b = 0;
    for (let j = i - w + 1; j <= i; j++) a += trace[j];
    for (let j = i + 1; j <= i + w; j++) b += trace[j];
    return (b - a) / w;
  }

  function createDetector({ w = 4, k = 4, sigma }) {
    const det = { trace: [], armedAt: -1, reset() { det.trace.length = 0; det.armedAt = -1; } };
    det.push = x => {
      const t = det.trace; t.push(x);
      const i = t.length - 1 - w;                      // newest position with a complete after-window
      if (det.armedAt < 0) {
        const d = stepDiff(t, i, w);
        if (d !== null && Math.abs(d) > k * sigma) det.armedAt = i;
        return null;
      }
      if (t.length - 1 < det.armedAt + 2 * w) return null;   // wait for the after-window to clear the edge
      let best = 0, at = det.armedAt;
      for (let j = det.armedAt; j <= det.armedAt + w; j++) {
        const d = stepDiff(t, j, w);
        if (d !== null && Math.abs(d) > Math.abs(best)) { best = d; at = j; }
      }
      det.armedAt = -1;
      return { i: at, height: best };
    };
    return det;
  }

  const classifyStep = (p, h) => Math.abs(Math.abs(h) - p.s1) <= Math.abs(Math.abs(h) - p.s2) ? 'dot1' : 'dot2';
```
Add `stepDiff, createDetector, classifyStep` to the returned object.

- [ ] **Step 4: Run** — `node tests/dqd.test.js` → 10 passed.

- [ ] **Step 5: Commit** — `git commit -am "Add the change-point detector for charge-sensor traces"`

---
### Task 4: `dqd.js` — the auto-tuner state machine

**Files:**
- Modify: `dqd.js` (add `createTuner` to the factory and API)
- Test: `tests/dqd.test.js` (append before the summary lines)

**Interfaces:**
- `DQD.createTuner(device, opts) → tuner`. `opts`: `{start:{V1,V2}, step=1, calibN=16, flatMV=40, wallMax=30, checkEvery=225, checkSpan=6, w=4, k=4}`.
- `tuner.step()` performs exactly one measurement (`device.measure`) and advances the machine.
- Readable state: `tuner.state ∈ 'calibrate'|'empty'|'load1'|'load2'|'centre'|'settle'|'locked'|'check'`, `tuner.V1`, `tuner.V2`, `tuner.N1`, `tuner.N2` (inferred, `null` until known), `tuner.sigma`, `tuner.lockLevel`, `tuner.walls` (`{left,right,down,up}` in mV after centring), `tuner.samples` (last ≤4000 `{V1,V2,S}`), `tuner.events` (strings, consumer shifts them), `tuner.measurements`, `tuner.retunes`, `tuner.recentres`, `tuner.locks`.
- Events emitted: `calibrated`, `step:dot1`, `step:dot2`, `empty`, `loaded:dot1`, `loaded:dot2`, `backoff:dot1`, `lost`, `centred`, `locked`, `drift`, `wall-near`.
- The tuner never calls `device.truth()`.

- [ ] **Step 1: Write the failing tests**

```js
function runUntil(tuner, pred, max) { while (!pred() && tuner.measurements < max) tuner.step(); }

test('tuner locks in (1,1) from 50 random starts within 2000 measurements', () => {
  for (let seed = 0; seed < 50; seed++) {
    const rand = DQD.mulberry32(100 + seed);
    const dev = DQD.createDevice(p, rand, { driftSigma: 0 });
    const start = { V1: 20 + 110 * rand(), V2: 20 + 110 * rand() };
    const t = DQD.createTuner(dev, { start });
    runUntil(t, () => t.state === 'locked', 2000);
    assert.strictEqual(t.state, 'locked', `seed ${seed} ended in ${t.state} after ${t.measurements}`);
    const o = dev.truth(t.V1, t.V2);
    assert.ok(o.g1 === 1 && o.g2 === 1, `seed ${seed} locked in (${o.g1},${o.g2}) at ${t.V1.toFixed(1)},${t.V2.toFixed(1)}`);
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
  assert.ok(t.events.includes('drift'), 'drift event');
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
  assert.strictEqual(t.recentres, 1);
  assert.strictEqual(t.retunes, 0);
  runUntil(t, () => t.state === 'locked', 3000);
  const o = dev.truth(t.V1, t.V2);
  assert.ok(o.g1 === 1 && o.g2 === 1);
});
```

- [ ] **Step 2: Run** — expected: `DQD.createTuner is not a function`.

- [ ] **Step 3: Implement `createTuner`**

```js
  function createTuner(device, opts = {}) {
    const p = device.p;
    const o = Object.assign({ step: 1, calibN: 16, flatMV: 40, wallMax: 30, checkEvery: 225, checkSpan: 6, w: 4, k: 4, start: null }, opts);
    const clampV = v => Math.min(p.vMax, Math.max(p.vMin, v));
    const t = {
      V1: o.start ? o.start.V1 : 100, V2: o.start ? o.start.V2 : 110,
      state: 'calibrate', sigma: null, N1: null, N2: null, lockLevel: null, walls: null,
      samples: [], events: [], measurements: 0, retunes: 0, recentres: 0, locks: 0
    };
    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let det = null, calib = [], flat = 0, lockBuf = [], idle = 0;
    let sweep = null;   // centring: { origin:{V1,V2}, di, dist, walls:[] }
    let probe = null;   // check:    { origin:{V1,V2}, di, k, sum, near }

    const emit = e => t.events.push(e);
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const measure = () => {
      const S = device.measure(t.V1, t.V2); t.measurements++;
      t.samples.push({ V1: t.V1, V2: t.V2, S }); if (t.samples.length > 4000) t.samples.shift();
      return S;
    };
    const go = s => { t.state = s; det = createDetector({ w: o.w, k: o.k, sigma: t.sigma }); flat = 0; };
    const retune = () => { t.retunes++; go('empty'); };

    const steps = {
      calibrate() {
        calib.push(measure());
        if (calib.length >= o.calibN) {
          const m = mean(calib);
          t.sigma = Math.max(1e-3, Math.sqrt(mean(calib.map(x => (x - m) ** 2))));
          calib = []; emit('calibrated'); go('empty');
        }
      },
      empty() {
        t.V1 = clampV(t.V1 - o.step); t.V2 = clampV(t.V2 - o.step);
        const r = det.push(measure());
        if (r) { emit('step:' + classifyStep(p, r.height)); flat = 0; } else flat += o.step;
        if (flat >= o.flatMV || (t.V1 <= p.vMin && t.V2 <= p.vMin)) { t.N1 = 0; t.N2 = 0; emit('empty'); go('load1'); }
      },
      load1() {
        t.V1 = clampV(t.V1 + o.step);
        const r = det.push(measure());
        if (r) { t.N1 = 1; emit('loaded:dot1'); go('load2'); }
        else if (t.V1 >= p.vMax) { emit('lost'); retune(); }
      },
      load2() {
        t.V2 = clampV(t.V2 + o.step);
        const r = det.push(measure());
        if (r) {
          if (classifyStep(p, r.height) === 'dot2') { t.N2 = 1; emit('loaded:dot2'); sweep = null; go('centre'); }
          else { t.V1 = clampV(t.V1 - 2 * o.w * o.step); emit('backoff:dot1'); det = createDetector({ w: o.w, k: o.k, sigma: t.sigma }); }
        } else if (t.V2 >= p.vMax) { emit('lost'); retune(); }
      },
      centre() {
        if (!sweep) sweep = { origin: { V1: t.V1, V2: t.V2 }, di: 0, dist: 0, walls: [] };
        const [dx, dy] = DIRS[sweep.di];
        sweep.dist += o.step;
        t.V1 = clampV(sweep.origin.V1 + dx * sweep.dist); t.V2 = clampV(sweep.origin.V2 + dy * sweep.dist);
        const r = det.push(measure());
        const atEdge = (dx && (t.V1 <= p.vMin || t.V1 >= p.vMax)) || (dy && (t.V2 <= p.vMin || t.V2 >= p.vMax));
        let wall = null;
        if (r) wall = (r.i + 1) * o.step;                 // the step lies between samples i and i+1
        else if (sweep.dist >= o.wallMax || atEdge) wall = sweep.dist;
        if (wall === null) return;
        sweep.walls.push(wall); sweep.di++; sweep.dist = 0;
        det = createDetector({ w: o.w, k: o.k, sigma: t.sigma });
        if (sweep.di < 4) return;
        const [L, R, D, U] = sweep.walls, org = sweep.origin;
        t.V1 = clampV(org.V1 + (R - L) / 2); t.V2 = clampV(org.V2 + (U - D) / 2);
        t.walls = { left: org.V1 - L, right: org.V1 + R, down: org.V2 - D, up: org.V2 + U };
        sweep = null; lockBuf = []; emit('centred'); go('settle');
      },
      settle() {
        lockBuf.push(measure());
        if (lockBuf.length >= 8) { t.lockLevel = mean(lockBuf); lockBuf = []; idle = 0; t.locks++; emit('locked'); go('locked'); }
      },
      locked() {
        idle++;
        lockBuf.push(measure()); if (lockBuf.length > 8) lockBuf.shift();
        if (lockBuf.length === 8 && Math.abs(mean(lockBuf) - t.lockLevel) > 0.5 * p.s2) { emit('drift'); lockBuf = []; retune(); return; }
        if (idle % o.checkEvery === 0) { probe = { origin: { V1: t.V1, V2: t.V2 }, di: 0, k: 0, sum: 0, near: false }; go('check'); }
      },
      check() {
        const [dx, dy] = DIRS[probe.di];
        t.V1 = clampV(probe.origin.V1 + dx * o.checkSpan); t.V2 = clampV(probe.origin.V2 + dy * o.checkSpan);
        probe.sum += measure(); probe.k++;
        if (probe.k < 4) return;
        if (Math.abs(probe.sum / 4 - t.lockLevel) > 0.5 * p.s2) probe.near = true;
        probe.di++; probe.k = 0; probe.sum = 0;
        if (probe.di < 4) return;
        t.V1 = probe.origin.V1; t.V2 = probe.origin.V2;
        if (probe.near) { t.recentres++; emit('wall-near'); sweep = null; go('centre'); }
        else { lockBuf = []; go('locked'); }
        probe = null;
      }
    };
    t.step = () => { steps[t.state](); };
    return t;
  }
```
Add `createTuner` to the returned object.

- [ ] **Step 4: Run** — `node tests/dqd.test.js` → 13 passed. If the 50-start test fails for particular seeds, print the event log for that seed and fix the machine — do not loosen the assertion.

- [ ] **Step 5: Commit** — `git commit -am "Add the double-dot auto-tuner state machine"`

---

### Task 5: `fabric-math.js` — camera, scroll mapping, layout

**Files:**
- Create: `fabric-math.js`
- Test: `tests/fabric-math.test.js`

**Interfaces:**
- `FabricMath.layout({d, cols, rows, gap}) → {patchSpan, pitch, patches:[{col,row,x0,y0}], hero:{col,row}, worldW, worldH, centre:{x,y}}` — world units are *half-cells* to match the engine coordinates (a qubit at engine `(x,y)` in patch `k` sits at world `(patches[k].x0 + x, patches[k].y0 + y)`). `patchSpan = 2d` (a patch spans engine coords `0..2d`), `pitch = patchSpan + 2·gap`. The hero patch is `{col: ⌊cols/2⌋, row: ⌊rows/2⌋}`; `centre` is its centre in world units.
- `FabricMath.scaleFor({viewW, viewH, cellPx, layout}) → {cellMax, cellMin}` — `cellMax = cellPx`; `cellMin` = the largest cell size (px per **cell** = 2 world units) such that `cols` patches plus gaps fit `0.92·viewW` and `rows` fit `0.92·viewH`.
- `FabricMath.ease(p) → smoothstep`, `FabricMath.cellAt(p, cellMax, cellMin) → lerp(cellMax, cellMin, ease(p))`.
- `FabricMath.camera({viewW, viewH, cell, centre}) → {toScreen(wx,wy) → [sx,sy], toWorld(sx,sy) → [wx,wy], cell}` — `px per world unit = cell / 2`, `centre` maps to the viewport centre.
- `FabricMath.patchAt(layout, wx, wy) → index|−1` (inside the patch's `0..2d` square).

- [ ] **Step 1: Write the failing tests**

```js
const assert = require('assert');
const FM = require('../fabric-math.js');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); passed++; } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; } }

test('layout places patches on a pitch of span + 2·gap and centres on the hero patch', () => {
  const L = FM.layout({ d: 9, cols: 5, rows: 3, gap: 6 });
  assert.strictEqual(L.patchSpan, 18);
  assert.strictEqual(L.pitch, 30);
  assert.strictEqual(L.patches.length, 15);
  assert.deepStrictEqual(L.hero, { col: 2, row: 1 });
  const h = L.patches.find(q => q.col === 2 && q.row === 1);
  assert.deepStrictEqual(L.centre, { x: h.x0 + 9, y: h.y0 + 9 });
  assert.strictEqual(L.patches[1].x0 - L.patches[0].x0, 30);
});

test('scaleFor: cellMin fits every column and row with margins; cellMax is the hero cell', () => {
  const L = FM.layout({ d: 27, cols: 5, rows: 3, gap: 6 });
  const { cellMax, cellMin } = FM.scaleFor({ viewW: 1440, viewH: 900, cellPx: 56, layout: L });
  assert.strictEqual(cellMax, 56);
  const worldWcells = (L.pitch * 5 - 2 * 6) / 2, worldHcells = (L.pitch * 3 - 2 * 6) / 2;
  assert.ok(worldWcells * cellMin <= 0.92 * 1440 + 1e-9);
  assert.ok(worldHcells * cellMin <= 0.92 * 900 + 1e-9);
  assert.ok(worldWcells * cellMin > 0.9 * 1440 || worldHcells * cellMin > 0.9 * 900, 'one axis is tight');
});

test('cellAt is monotone from cellMax to cellMin', () => {
  let prev = Infinity;
  for (let p = 0; p <= 1.0001; p += 0.05) { const c = FM.cellAt(p, 56, 10); assert.ok(c <= prev); prev = c; }
  assert.strictEqual(FM.cellAt(0, 56, 10), 56);
  assert.strictEqual(FM.cellAt(1, 56, 10), 10);
});

test('camera round-trips and maps the centre to the viewport centre', () => {
  const cam = FM.camera({ viewW: 800, viewH: 600, cell: 40, centre: { x: 100, y: 50 } });
  assert.deepStrictEqual(cam.toScreen(100, 50), [400, 300]);
  assert.deepStrictEqual(cam.toScreen(102, 50), [440, 300]);   // 2 world units = 1 cell = 40 px
  const [wx, wy] = cam.toWorld(440, 340);
  assert.ok(Math.abs(wx - 102) < 1e-9 && Math.abs(wy - 52) < 1e-9);
});

test('patchAt finds the patch under a world point and −1 in the gaps', () => {
  const L = FM.layout({ d: 9, cols: 3, rows: 3, gap: 6 });
  const h = L.patches.find(q => q.col === 1 && q.row === 1);
  assert.strictEqual(FM.patchAt(L, h.x0 + 1, h.y0 + 1), L.patches.indexOf(h));
  assert.strictEqual(FM.patchAt(L, h.x0 + 18 + 3, h.y0 + 1), -1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run** — expected: `Cannot find module '../fabric-math.js'`.

- [ ] **Step 3: Implement**

```js
/* fabric-math.js — pure geometry for the lattice-surgery fabric (E). World
   units are engine half-cells: a patch spans 0..2d, a cell is 2 units. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FabricMath = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function layout({ d, cols, rows, gap }) {
    const patchSpan = 2 * d, pitch = patchSpan + 2 * gap, patches = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++)
      patches.push({ col, row, x0: col * pitch, y0: row * pitch });
    const hero = { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
    const h = patches[hero.row * cols + hero.col];
    return { d, cols, rows, gap, patchSpan, pitch, patches, hero,
      worldW: cols * pitch - 2 * gap, worldH: rows * pitch - 2 * gap,
      centre: { x: h.x0 + d, y: h.y0 + d } };
  }

  function scaleFor({ viewW, viewH, cellPx, layout: L }) {
    const cellsW = L.worldW / 2, cellsH = L.worldH / 2;
    const cellMin = Math.min(0.92 * viewW / cellsW, 0.92 * viewH / cellsH, cellPx);
    return { cellMax: cellPx, cellMin };
  }

  const ease = p => { p = Math.min(1, Math.max(0, p)); return p * p * (3 - 2 * p); };
  const cellAt = (p, cellMax, cellMin) => cellMax + (cellMin - cellMax) * ease(p);

  function camera({ viewW, viewH, cell, centre }) {
    const k = cell / 2, cx = viewW / 2, cy = viewH / 2;
    return {
      cell,
      toScreen: (wx, wy) => [cx + (wx - centre.x) * k, cy + (wy - centre.y) * k],
      toWorld: (sx, sy) => [centre.x + (sx - cx) / k, centre.y + (sy - cy) / k]
    };
  }

  function patchAt(L, wx, wy) {
    for (let i = 0; i < L.patches.length; i++) {
      const q = L.patches[i];
      if (wx >= q.x0 && wx <= q.x0 + L.patchSpan && wy >= q.y0 && wy <= q.y0 + L.patchSpan) return i;
    }
    return -1;
  }

  return { layout, scaleFor, ease, cellAt, camera, patchAt };
});
```

- [ ] **Step 4: Run** — 5 passed.

- [ ] **Step 5: Commit** — `git add fabric-math.js tests/fabric-math.test.js && git commit -m "Add fabric-math: layout, scroll-to-scale mapping, camera"`

---
### Task 6: `examples.html` + `examples.css` — page skeleton

**Files:**
- Create: `examples.html`, `examples.css`

**Interfaces:**
- Produces DOM ids/classes consumed by later tasks: `canvas#fabric` (fixed, full viewport), `header.ex-hero` (with `data-hero-height` measured at runtime), `#ex-readout` (`b#ex-rounds`, `b#ex-phys`, `b#ex-logical`), `#ex-caption` (contains `span#ex-d`), `section.ex-window` with `#ex-window-caption`, `section#work` containing `canvas#dqd`, `#dqd-readout` (`b#dqd-v1`, `b#dqd-v2`, `b#dqd-state`, `b#dqd-n`, `b#dqd-retunes`), `p#dqd-hint`.
- Loads `styles.css` **then** `examples.css`; loads scripts in the order `engine.js`, `hero-math.js`, `sessions.js`, `dqd.js`, `fabric-math.js`, `fabric.js`, `tuner-view.js` (all `defer`). Does **not** load `script.js`, `hero.js`, `surface-code.js`, or `assets/wasm-data.js`.
- Uses no `.rv` class (its reveal depends on `script.js`). Uses `.ex-hero`, never `.hero` (owned by A+ styles).
- Inline theme script identical to `index.html`'s, plus a tiny inline theme toggle handler (same `localStorage` key `theme`).

- [ ] **Step 1: Write `examples.html`**

Sections, in order, all inside `.wrap` where the site does: `.ex-banner` (text: *Example page — exploring two directions: E, a scroll zoom-out from one logical qubit to a lattice-surgery fabric, and D, an auto-tuner for a double quantum dot. Not the live site.* with a link *← Back to the site* → `index.html`); `nav.nav` (mark + About / Work / Contact + theme button `#theme`); `header.ex-hero#top` with the A+ hero copy (eyebrow, `h1`, lede, CTAs), `p#ex-readout` (`rounds <b id="ex-rounds">0</b> · physical errors <b id="ex-phys">0</b> · logical errors <b id="ex-logical">0</b>`), `p#ex-caption` (spec §4.4 A+ caption with `<span id="ex-d">27</span>` and the simulator link); `section.ex-window` with `p#ex-window-caption` (spec §4.4 window caption); `main#main` → `section.section#about` (the site's About prose), `section.section#work` with one `article.piece.ex-piece` (framing copy from spec §5.4 on the left; `div.demo` on the right with `.demo-head` (`Charge stability · double dot` / `sensor signal`), `canvas#dqd` (`width=480 height=480`), `#dqd-readout`, `p#dqd-hint` "Drag on the diagram to add charge noise."), `section.section#contact` (the site's contact paragraph and addresses); `footer`.
- `canvas#fabric` is the first child of `body` after the skip link, `aria-hidden="true"` (the hero caption is the accessible description).

- [ ] **Step 2: Write `examples.css`**

```css
/* examples.css — layered over styles.css. Only .ex-* and #dqd* selectors. */
canvas#fabric { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; display: block; }
.ex-banner { position: relative; z-index: 2; font-size: .8125rem; padding: .5rem 0; background: var(--accent); color: var(--bg); }
.ex-banner .wrap { display: flex; gap: 1rem; justify-content: space-between; flex-wrap: wrap; }
.ex-banner a { text-decoration: underline; }
.nav { z-index: 50; }
.ex-hero { position: relative; z-index: 1; min-height: clamp(30rem, calc(100vh - 3.75rem), 52rem); display: grid; align-items: center; }
.ex-hero::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg, color-mix(in srgb, var(--bg) 92%, transparent) 0 45%, transparent 65%); }
.ex-hero .wrap { position: relative; width: 100%; }
.ex-hero .ex-content { max-width: 34rem; }
.ex-hero h1 { font-family: var(--serif); font-size: clamp(2.75rem, 6vw, 4rem); font-weight: 500; line-height: 1.02; letter-spacing: -.02em; margin-bottom: 1.25rem; }
.ex-hero .lede { font-size: 1.0625rem; line-height: 1.62; color: var(--fg-2); margin-bottom: 2rem; }
.ex-hero .lede strong { color: var(--fg); font-weight: 500; }
.ex-meta { position: absolute; right: 2.5rem; bottom: 1.5rem; max-width: 30rem; text-align: right;
  font-family: var(--mono); font-size: .6875rem; color: var(--fg-3); line-height: 1.5; }
.ex-meta b { color: var(--fg); font-weight: 500; }
.ex-meta b.flare { color: var(--accent); }
.ex-meta a { color: var(--accent); }
.ex-window { position: relative; z-index: 1; min-height: 70vh; display: grid; align-items: end; }
.ex-window p { font-family: var(--mono); font-size: .6875rem; color: var(--fg-3); max-width: 34rem; margin: 0 auto 2rem; padding: 0 2.5rem; text-align: center; }
main, footer { position: relative; z-index: 1; }
main .section, footer { background: color-mix(in srgb, var(--bg) 90%, transparent); }
.ex-piece { grid-template-columns: 1fr 30rem; }
.ex-piece canvas { width: 100%; height: auto; display: block; touch-action: none; cursor: crosshair; }
#dqd-readout { display: flex; flex-wrap: wrap; gap: .25rem 1.25rem; margin-top: .75rem; font-family: var(--mono); font-size: .6875rem; color: var(--fg-3); }
#dqd-readout b { color: var(--fg); font-weight: 500; }
@media (max-width: 960px) {
  .ex-hero::before { background: linear-gradient(180deg, transparent 0 40%, color-mix(in srgb, var(--bg) 90%, transparent) 60%); }
  .ex-meta { position: static; text-align: left; max-width: none; margin-top: 2rem; }
  .ex-piece { grid-template-columns: 1fr; }
}
@media (max-width: 560px) { .ex-meta { margin-top: 1.5rem; } }
```

- [ ] **Step 3: Verify in the preview** — open `http://localhost:4173/examples.html`; screenshot at 1440 px and 390 px; `read_console_messages` shows no errors (scripts that don't exist yet must not be referenced until their tasks — add each `<script>` tag in the task that creates the file).

- [ ] **Step 4: Commit** — `git add examples.html examples.css && git commit -m "Add the D+E example page skeleton"`

---

### Task 7: `fabric.js` — patches, sprite, camera, scroll zoom (static)

**Files:**
- Create: `fabric.js`
- Modify: `examples.html` (add `<script src="sessions.js" defer>`, `fabric-math.js`, `fabric.js`)

**Interfaces:**
- Consumes: `QEC.load(url)` → `{rawExports}`; `QECSessions.create(exp, d)`; `FabricMath.layout/scaleFor/cellAt/camera/patchAt`; CSS vars on `documentElement`.
- Produces: `window.__fabric` = `{ patches, camera(), redraw(), state }` for verification via `javascript_tool` only.

Module shape:
```js
(() => {
  'use strict';
  const C = { CELL: 56, CELL_TABLET: 48, CELL_PHONE: 44, D: 27, D_TABLET: 21, D_PHONE: 15, COLS: 5, ROWS: 3, COLS_PHONE: 3, GAP: 6,
              AMBIENT: 0.6, CURSOR_PEAK: 2.5, CURSOR_SIGMA: 1.1, PAULI: [['X', .45], ['Z', .45], ['Y', .10]], MAX_PENDING: 60,
              ROUND_HERO: 700, ROUND_OTHER: 1500, TICK: 50, MERGE_EVERY: 4000, MERGE_IN: 500, MERGE_HOLD: 2200,
              T_ERR: 180, T_DEF: 220, T_CHAIN: 350, T_HOLD: 250, T_FADE: 300, T_FLASH: 650, T_FADEIN: 600,
              SPRITE_CELL: 24, DIRECT_MIN_CELL: 18 };
  const canvas = document.getElementById('fabric'), hero = document.querySelector('.ex-hero');
  if (!canvas || !hero) return;
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // state
  let engine = null, L = null, patches = [], cellMax = C.CELL, cellMin = 10, cell = C.CELL, colours = null, sprite = null, dpr = 1, W = 0, H = 0;
  let dirty = true, raf = 0, animUntil = 0, lastTick = 0, running = false;
  // ... functions: readColours(), buildSprite(), resize(), onScroll(), cameraNow(), drawPatchStatic(q, cam), render(now), requestFrame(), boot()
})();
```

Key functions:
- `readColours()` → `{x, z, y, accent, bg, fg3, rule}` from `getComputedStyle(document.documentElement).getPropertyValue('--x')` etc.
- `buildSprite()` — offscreen canvas of `(2d·SPRITE_CELL/2 + pad)` px per side at `dpr`: for each stab draw a tile (bulk: square of one cell centred at `(x/2, y/2)` cells; boundary: semicircle facing inward), Z in `colours.z` at 7 % alpha, X in `colours.x` at 7 %; hairline grid through qubit rows/cols at `colours.rule` 50 %; qubit dots r = 3 px scaled, `colours.fg3` 45 %.
- `drawPatchStatic(q, cam)` — screen rect from `cam.toScreen(q.x0, q.y0)` and `cam.toScreen(q.x0 + 2d, q.y0 + 2d)`; cull if outside; if `cam.cell ≥ DIRECT_MIN_CELL` draw primitives with the current `cell`, else `drawImage(sprite, …)`.
- `resize()` — `W = innerWidth, H = innerHeight, dpr = devicePixelRatio`; canvas backing store `W·dpr × H·dpr`; pick `CELL/D/COLS` by width; `L = FabricMath.layout(...)`; `({cellMax, cellMin} = FabricMath.scaleFor(...))`; rebuild sessions only if `d` changed; `buildSprite(); dirty = true`.
- `onScroll()` — `p = clamp(scrollY / hero.offsetHeight, 0, 1)`; `cell = FabricMath.cellAt(p, cellMax, cellMin)`; `dirty = true; requestFrame()`.
- `render()` — clear; `cam = FabricMath.camera({viewW: W, viewH: H, cell, centre: L.centre})`; draw every patch static (Task 8 adds dynamics on top). Fade-in: global alpha `min(1, (now − readyAt)/T_FADEIN)`.
- `requestFrame()` — `if (!raf) raf = requestAnimationFrame(t => { raf = 0; render(t); if (dirty || t < animUntil) requestFrame(); })`; `render` sets `dirty = false` after drawing.
- `boot()` — `resize()`; `QEC.load('assets/stabilizer_qec.wasm').then(e => { engine = e; makeSessions(); readyAt = performance.now(); requestFrame(); }).catch(() => hero.classList.add('static'))`; listeners: `scroll` (passive), `resize` (debounced 200 ms), `MutationObserver` on `documentElement` `data-theme` → `readColours(); buildSprite(); dirty = true; requestFrame()`.
- `makeSessions()` — `patches = L.patches.map(q => ({...q, s: QECSessions.create(engine.rawExports, L.d), pending: [], lit: new Map(), chains: [], flashAt: 0, rounds: 0, phys: 0, logical: 0, nextRound: …}))` freeing old sessions first.

- [ ] **Step 1: Implement the module as above.**
- [ ] **Step 2: Verify in the preview** — at 1440×900: hero shows a d=27 patch filling the viewport (cell 56 px), cropped top/bottom; scroll to the window band → the 5×3 fabric is fully visible with 6-cell gaps; scroll back up → zooms in; light/dark toggle recolours; `javascript_tool`: `__fabric.patches.length === 15`; no console errors; `read_network_requests` shows `stabilizer_qec.wasm` once.
- [ ] **Step 3: Commit** — `git add fabric.js examples.html && git commit -m "Add the fabric: patches, sprite, camera, scroll zoom-out"`

---

### Task 8: `fabric.js` — noise, rounds, chains, cursor, readout, logical flash

**Files:**
- Modify: `fabric.js`

**Interfaces:**
- Consumes: `HeroMath.poisson(λ, rand)`, `HeroMath.gaussianRate(dist, σ, peak)`, `HeroMath.chainsFromCorrection(session, cx, cz)` (returns `[{type, qubits:[…]}]`).

Behaviour (per spec §4.1, matching the A+ round):
- `tick()` every `C.TICK` ms via `setTimeout` chain (not rAF) while `running`: for each patch, `k = poisson(C.AMBIENT · dt)` errors on random qubits; for the patch under the pointer (via `FabricMath.patchAt(L, ...cam.toWorld(px, py))`), for each qubit within `3σ` cells of the pointer (cell distance = `hypot((qx − wx)/2, (qy − wy)/2)`), `poisson(gaussianRate(dist) · dt · zoomFactor)` with `zoomFactor = cell / cellMax`; each error: pick a Pauli from `C.PAULI`, `s.toggle(q, pauli)`, push `{q, pauli, t0: now}` to `pending` unless `pending.length ≥ C.MAX_PENDING`; `phys += injected`. After injections in a patch: `syn = s.syndrome()`; for each lit index not yet in `lit`, `lit.set(i, now)`; `dirty = true`.
- `round(patch, now)` when `now ≥ patch.nextRound`: `rounds++`; if `pending.length`: `{logical, cx, cz} = s.decode()`; `chains = HeroMath.chainsFromCorrection(s, cx, cz)`; `s.clear()`; `logical += logical`; set `patch.anim = {t0: now, chains, errors: pending, lit: [...lit.keys()]}`; `pending = []; lit.clear()`; if `logical` → `patch.flashAt = now`; `animUntil = max(animUntil, now + T_CHAIN + T_HOLD + T_FADE + T_FLASH)`; `nextRound = now + (hero ? ROUND_HERO : ROUND_OTHER) · jitter(±15 %)`; hero → update readout (`toLocaleString`), flare `#ex-logical` for `T_FLASH` on a logical error.
- Dynamic drawing in `render()` after statics, per visible patch: lit tiles (55 % alpha + radial glow radius 0.9 cell at 25 %), pending error dots (r grows 3→5.5 px·(cell/56) over `T_ERR`, colour by Pauli), animating chains (polyline through `qubits` screen positions, line width `1.5·cell/56`, dash grows over `T_CHAIN`, holds `T_HOLD`, fades over `T_FADE` together with that round's error dots and lit tiles), flash (full-canvas `accent` at `14 % · (1 − t/T_FLASH)`).
- Pointer: `pointermove` on `window` → store `{px, py, t}`; considered active if moved within 400 ms; `pointerleave` on `document` → inactive. `canvas` has `touch-action: pan-y`.
- `visibilitychange` → stop/start the tick chain; scrolling past the window band does **not** pause (the fabric stays visible under content).

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify** — scribble across the hero width: chains draw, then a logical error flashes and `#ex-logical` increments; a short scribble is corrected without a logical error; readout counts rise; zoomed out, hovering a far patch adds errors there; `javascript_tool` after 10 s idle: `__fabric.state.frames` stops increasing between rounds (no idle frames); console clean.
- [ ] **Step 3: Commit** — `git commit -am "Fabric: live noise, MWPM rounds, chains, cursor noise, readout"` (only `fabric.js`).

---

### Task 9: `fabric.js` — lattice-surgery merges, reduced motion, fallback

**Files:**
- Modify: `fabric.js`

- Merges: every `C.MERGE_EVERY` (±20 %), pick a random adjacent pair (same row & adjacent col, or same col & adjacent row), skip if either is already merging. `merge = {a, b, t0}`; phases: in (`MERGE_IN`), hold (`MERGE_HOLD`), out (`MERGE_IN`). Draw: the gap rectangle between the two patch edges filled with a checkerboard of tiles matching the patches' pattern (alternate Z/X per cell using `(col+row) % 2`), alpha rising 0→7 % (in), 7 % + accent tint 6 % (hold), falling (out). `animUntil` extended while merging.
- Reduced motion (`reduced.matches`, observed live): tick chain and merges off; a fixed composed frame (2 short chains per hero patch drawn once from a seeded decode); scroll zoom still follows position.
- Fallback: `QEC.load` rejection → `hero.classList.add('static')`; CSS `.ex-hero.static .ex-meta, .ex-window.static p { display: none }` (add these two lines to `examples.css` — created in Task 6, so it is this task's file to modify).

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify** — watch two merges at the window band; emulate reduced motion (`javascript_tool` can't; use `resize_window` colorScheme only — so verify by temporarily forcing `reduced = {matches: true}` via `__fabric.state.forceReduced = true; __fabric.redraw()` and screenshot); block the wasm (`__fabric` not needed: load `examples.html?nowasm=1`, which makes `fabric.js` skip `QEC.load`) → captions hidden, page usable.
- [ ] **Step 3: Commit** — `git add fabric.js examples.css && git commit -m "Fabric: lattice-surgery merges, reduced motion, fallback"`

---

### Task 10: `tuner-view.js` — D renderer and driver

**Files:**
- Create: `tuner-view.js`
- Modify: `examples.html` (add `<script src="dqd.js" defer>`, `<script src="tuner-view.js" defer>`)

**Interfaces:**
- Consumes: `DQD.defaultParams/createDevice/createTuner/occupation/transitionV1/transitionV2`.
- Constants: `RATE = 150` measurements/s; `DRAG_MV_PER_PX = 0.35`; heat map resolution `N = 140` (one model evaluation per mV per axis, cached until the offset changes).

Behaviour:
- Build `device = DQD.createDevice(p, Math.random)`, `tuner = DQD.createTuner(device, {start: {V1: 80 + 50·rand, V2: 80 + 50·rand}})`.
- Ground-truth layer: offscreen canvas `N × N` computed from `device.truth(V1, V2)` → sensor mean `s1·N1 + s2·N2 + b·(V1+V2)` mapped to 15 % alpha greys (light theme: darker = higher); recomputed when `device.offset` changes by more than 0.5 mV since the last build (debounced to once per frame). Honeycomb: dashed lines at 25 % from `transitionV1/transitionV2` for `N ∈ 0..5` (draw as polylines over `V2`/`V1` in 5 mV steps because of cross-coupling).
- Measured layer: persistent offscreen canvas; each new `tuner.samples` entry paints a 2 px dot at `(V1, V2)` in `fg` with alpha from `S` (0.3–1.0). Cleared on `drift` (full re-tune) so the old scan doesn't lie about the shifted honeycomb.
- Foreground: path of the last 600 samples as a 1 px line (`fg-3` 60 %), current point as a 5 px ring in `accent`, the `(1,1)` cell outline once `tuner.walls` exists (accent 70 %, 1 px), axis ticks every 20 mV in mono 9 px, labels `V₁ (mV)` / `V₂ (mV)`.
- Driver: rAF loop while visible (IntersectionObserver on the canvas) and tab visible; each frame: `n = round(RATE · dt)` steps (cap 20); `device.drift(dt)`; consume `tuner.events` for status; update `#dqd-readout`: `V1`/`V2` to 1 decimal, state verb map `{calibrate:'calibrating', empty:'emptying', load1:'loading dot 1', load2:'loading dot 2', centre:'centring', settle:'settling', locked:'locked (1,1)', check:'checking'}`, inferred `(N1, N2)` or `(?, ?)`, `retunes` (retunes + recentres shown as `retunes · recentres`).
- Drag: `pointerdown` → capture; `pointermove` → `device.nudge(dx·DRAG_MV_PER_PX, −dy·DRAG_MV_PER_PX)` (canvas y is inverted relative to V2); mark ground truth dirty.
- Reduced motion: run the tuner to `locked` synchronously at load (≤2000 steps), draw once, no loop, drag disabled.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify** — the tuner runs: diagonal sweep down, up along V1, up along V2, cross sweeps, lock; the ring sits inside the `(1,1)` cell of the faint honeycomb; readout says `locked (1,1)`; drag 40 px → honeycomb shifts, `drift` → re-tune → locks again with `retunes` incremented; drag 12 px → `wall-near` → recentre; console clean; stacked layout at 390 px.
- [ ] **Step 3: Commit** — `git add tuner-view.js examples.html && git commit -m "Add the double-dot auto-tuner view"`

---

### Task 11: Final verification and hand-off

- [ ] Run all tests: `node tests/sessions.test.js && node tests/dqd.test.js && node tests/fabric-math.test.js` → all pass.
- [ ] Preview matrix: 1440×900, 1024×768, 390×844 × light/dark; screenshots of hero, window band, D panel; `read_console_messages` empty of errors; `read_network_requests` for `.wasm` (one request, ~79 KB gzip is a server property — note size only).
- [ ] Idle cost check: `javascript_tool` — sample `__fabric.state.frames` twice 3 s apart with no pointer movement and no scrolling → difference ≤ number of rounds elapsed × frames per round animation (< 200).
- [ ] `git status` shows only the other session's pre-existing modifications plus nothing of ours uncommitted.
- [ ] Write the hand-off summary for the user: what to open (`examples.html`), what to try (scroll, scribble, drag), what's real vs illustrated, and the decision points.
