/**
 * tests/engine.test.js - Node test suite for engine.js and stabilizer_qec.wasm
 */
const fs = require('fs');
const path = require('path');
const QEC = require('../engine.js');

async function runTests() {
  console.log('Running engine.test.js...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
      throw new Error(message);
    }
  }

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      // already counted in assert or uncaught
      if (!err.message.includes('FAIL:')) {
        console.error(`  ✗ FAIL: ${name} -> ${err.message}`);
        failed++;
      }
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      if (!err.message.includes('FAIL:')) {
        console.error(`  ✗ FAIL: ${name} -> ${err.message}`);
        failed++;
      }
    }
  }

  const wasmPath = path.join(__dirname, '../assets/stabilizer_qec.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  const engine = await QEC.load(wasmBytes);

  // 1. Geometry
  test('Geometry: d^2 qubits at odd coords, d^2 - 1 stabs, bulk vs boundary coords, X stabs indexed before Z', () => {
    const d = 5;
    const session = engine.session(d);
    assert(session.numQubits === 25, `Expected 25 qubits, got ${session.numQubits}`);
    assert(session.numStabs === 24, `Expected 24 stabs, got ${session.numStabs}`);

    // All qubits must have odd coords in [1, 2d-1]
    session.qubits.forEach((q, i) => {
      assert(q.x % 2 === 1 && q.y % 2 === 1, `Qubit ${i} at (${q.x}, ${q.y}) must be odd`);
      assert(q.x >= 1 && q.x <= 2 * d - 1, `Qubit ${i} x out of range: ${q.x}`);
      assert(q.y >= 1 && q.y <= 2 * d - 1, `Qubit ${i} y out of range: ${q.y}`);
    });

    // All stabs must have even coords
    let seenZ = false;
    session.stabs.forEach((s, i) => {
      assert(s.x % 2 === 0 && s.y % 2 === 0, `Stab ${i} at (${s.x}, ${s.y}) must be even`);
      if (s.type === 'Z') seenZ = true;
      if (seenZ) {
        assert(s.type === 'Z', `X stab found after Z stab at index ${i}`);
      } else {
        assert(s.type === 'X', `Expected X stab at index ${i}`);
      }
    });

    session.free();
  });

  // 2. Boundary vs Bulk single-error syndrome trips
  test('Single X in bulk trips 2 Z-defects; single X on left/right trips 1 Z-defect; single Z on top/bottom trips 1 X-defect', () => {
    const d = 5;
    const session = engine.session(d);

    // Find a bulk qubit (x in [3, 2d-3], y in [3, 2d-3])
    const bulkIdx = session.qubits.findIndex(q => q.x >= 3 && q.x <= 2 * d - 3 && q.y >= 3 && q.y <= 2 * d - 3);
    assert(bulkIdx !== -1, 'Bulk qubit not found');
    session.toggle(bulkIdx, 'X');
    let syn = session.syndrome();
    let litZ = 0, litX = 0;
    session.stabs.forEach((s, i) => {
      if (syn[i] === 1) {
        if (s.type === 'Z') litZ++;
        else litX++;
      }
    });
    assert(litZ === 2 && litX === 0, `Bulk X error should trip exactly 2 Z-defects, got ${litZ} Z, ${litX} X`);
    session.clear();

    // Find a left-edge qubit (x === 1, y in [3, 2d-3])
    const leftIdx = session.qubits.findIndex(q => q.x === 1 && q.y >= 3 && q.y <= 2 * d - 3);
    assert(leftIdx !== -1, 'Left edge qubit not found');
    session.toggle(leftIdx, 'X');
    syn = session.syndrome();
    litZ = 0; litX = 0;
    session.stabs.forEach((s, i) => {
      if (syn[i] === 1) {
        if (s.type === 'Z') litZ++;
        else litX++;
      }
    });
    assert(litZ === 1 && litX === 0, `Left edge X error should trip exactly 1 Z-defect, got ${litZ} Z, ${litX} X`);
    session.clear();

    // Find a top-edge qubit (y === 1, x in [3, 2d-3])
    const topIdx = session.qubits.findIndex(q => q.y === 1 && q.x >= 3 && q.x <= 2 * d - 3);
    assert(topIdx !== -1, 'Top edge qubit not found');
    session.toggle(topIdx, 'Z');
    syn = session.syndrome();
    litZ = 0; litX = 0;
    session.stabs.forEach((s, i) => {
      if (syn[i] === 1) {
        if (s.type === 'Z') litZ++;
        else litX++;
      }
    });
    assert(litX === 1 && litZ === 0, `Top edge Z error should trip exactly 1 X-defect, got ${litX} X, ${litZ} Z`);
    session.free();
  });

  // 3. Full row of X from left to right -> 0 syndrome, logical === 1
  test('Full row of X from left edge to right edge produces 0 syndrome and logical === 1', () => {
    const d = 9;
    const session = engine.session(d);

    // Qubits in row y=1: x = 1, 3, 5, ..., 2d-1 (all d qubits)
    session.qubits.forEach((q, i) => {
      if (q.y === 1) {
        session.toggle(i, 'X');
      }
    });

    const syn = session.syndrome();
    const activeSyn = syn.filter(s => s === 1).length;
    assert(activeSyn === 0, `Full row of X should produce 0 syndrome defects, got ${activeSyn}`);

    const res = session.decode();
    assert(res.logical === 1, `Full row of X must produce logical === 1, got ${res.logical}`);
    session.free();
  });

  // 4. Short row of X of length floor(d/4) from left edge -> logical === 0, correction clears syndrome
  test('Short row of X from left edge produces logical === 0 and correction clears syndrome', () => {
    const d = 11;
    const session = engine.session(d);
    const len = Math.floor(d / 4);

    let flipped = 0;
    session.qubits.forEach((q, i) => {
      if (q.y === 3 && flipped < len) {
        session.toggle(i, 'X');
        flipped++;
      }
    });

    const res = session.decode();
    assert(res.logical === 0, `Short row should be corrected (logical === 0), got ${res.logical}`);

    // Apply correction
    for (let i = 0; i < session.numQubits; i++) {
      if (res.cx[i]) session.toggle(i, 'X');
      if (res.cz[i]) session.toggle(i, 'Z');
    }

    const postSyn = session.syndrome();
    const remainingDefects = postSyn.filter(s => s === 1).length;
    assert(remainingDefects === 0, `Correction must clear all defects, got ${remainingDefects}`);
    session.free();
  });

  // 5. Property: at d=15, 300 random error sets at 3% per qubit -> correction clears syndrome every time
  test('Property: at d=15, 300 random error sets at 3% are cleared by MWPM correction', () => {
    const d = 15;
    const session = engine.session(d);
    const p = 0.03;

    for (let trial = 0; trial < 300; trial++) {
      session.clear();
      // Inject random errors
      for (let i = 0; i < session.numQubits; i++) {
        if (Math.random() < p) session.toggle(i, 'X');
        if (Math.random() < p) session.toggle(i, 'Z');
      }

      const res = session.decode();
      // Apply correction
      for (let i = 0; i < session.numQubits; i++) {
        if (res.cx[i]) session.toggle(i, 'X');
        if (res.cz[i]) session.toggle(i, 'Z');
      }

      const syn = session.syndrome();
      const defects = syn.filter(s => s === 1).length;
      assert(defects === 0, `Trial ${trial}: syndrome not cleared (${defects} defects remaining)`);
    }
    session.free();
  });

  // 6. clear() resets frame and decode() returns logical === 0
  test('clear() resets frame and subsequent decode returns logical === 0', () => {
    const d = 7;
    const session = engine.session(d);

    // Create logical error
    session.qubits.forEach((q, i) => {
      if (q.y === 1) session.toggle(i, 'X');
    });
    assert(session.decode().logical === 1, 'Should have logical 1');

    session.clear();
    const res = session.decode();
    assert(res.logical === 0, `After clear, decode should return logical 0, got ${res.logical}`);
    session.free();
  });

  // 7. Timing sanity: d=27 decode with 40 errors completes under 20 ms
  test('Timing: d=27 decode with 40 errors completes under 20 ms', () => {
    const d = 27;
    const session = engine.session(d);

    // Inject 40 errors
    for (let k = 0; k < 40; k++) {
      const q = Math.floor(Math.random() * session.numQubits);
      session.toggle(q, Math.random() < 0.5 ? 'X' : 'Z');
    }

    const t0 = performance.now();
    session.decode();
    const dt = performance.now() - t0;
    assert(dt < 20, `d=27 decode took ${dt.toFixed(2)} ms (expected < 20 ms)`);
    session.free();
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
