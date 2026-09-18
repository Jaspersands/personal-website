/**
 * tests/hero-math.test.js - Node test suite for hero-math.js
 */
const fs = require('fs');
const path = require('path');
const QEC = require('../engine.js');
const HeroMath = require('../hero-math.js');

async function runTests() {
  console.log('Running hero-math.test.js...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
      throw new Error('FAIL: ' + message);   // the prefix tells test() this failure is already counted
    }
  }

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      if (!err.message.includes('FAIL:')) {
        console.error(`  ✗ FAIL: ${name} -> ${err.message}`);
        failed++;
      }
    }
  }

  // 1. fit()
  test('fit(): d is odd, (d - 1) * cell >= max(w, h), d <= dMax, centered origin', () => {
    const cases = [
      { w: 1440, h: 700, cell: 56, dMax: 31 },
      { w: 768, h: 600, cell: 48, dMax: 31 },
      { w: 390, h: 700, cell: 44, dMax: 31 },
      { w: 2560, h: 1440, cell: 56, dMax: 31 }
    ];

    cases.forEach(({ w, h, cell, dMax }) => {
      const res = HeroMath.fit(w, h, cell, dMax);
      assert(res.d % 2 === 1, `d must be odd, got ${res.d}`);
      assert(res.d <= dMax, `d (${res.d}) must be <= dMax (${dMax})`);
      const maxDim = Math.max(w, h);
      assert((res.d - 1) * res.cell >= maxDim, `(d - 1) * cell must cover maxDim: ${(res.d - 1) * res.cell} < ${maxDim}`);
      assert(Math.abs(res.originX - (w - res.span) / 2) < 1e-6, 'originX not centered');
      assert(Math.abs(res.originY - (h - res.span) / 2) < 1e-6, 'originY not centered');
    });
  });

  // 2. poisson() — seeded draws, tolerance of five standard errors of the mean
  test('poisson(): empirical mean over 50,000 draws is within tolerance of lambda', () => {
    const lambdas = [0.05, 1.0, 4.0];
    const N = 50000;
    let seed = 20260918;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

    lambdas.forEach(lambda => {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum += HeroMath.poisson(lambda, rand);
      }
      const mean = sum / N;
      const relDiff = Math.abs(mean - lambda) / lambda;
      const tol = 5 * Math.sqrt(1 / (lambda * N));
      assert(relDiff < tol, `poisson(${lambda}) mean was ${mean.toFixed(4)}, rel diff ${relDiff.toFixed(4)} >= ${tol.toFixed(4)}`);
    });
  });

  // 3. chainsFromCorrection()
  const wasmPath = path.join(__dirname, '../assets/stabilizer_qec.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  const engine = await QEC.load(wasmBytes);

  test('chainsFromCorrection(): lone qubit is 1-element chain; boundary chain starts at boundary; disjoint chains separate', () => {
    const d = 5;
    const session = engine.session(d);

    // Case A: Lone qubit
    const cxLone = new Uint8Array(25);
    cxLone[12] = 1; // Center qubit (x=3, y=3)
    const chainsLone = HeroMath.chainsFromCorrection(session, cxLone, new Uint8Array(25));
    assert(chainsLone.length === 1, `Expected 1 chain, got ${chainsLone.length}`);
    assert(chainsLone[0].type === 'X', 'Expected type X');
    assert(chainsLone[0].qubits.length === 1 && chainsLone[0].qubits[0] === 12, 'Lone chain should contain [12]');

    // Case B: Chain touching boundary
    // In row y=1: qubit 0 (x=1, boundary), qubit 1 (x=3), qubit 2 (x=5)
    const cxRow = new Uint8Array(25);
    cxRow[0] = 1;
    cxRow[1] = 1;
    cxRow[2] = 1;
    const chainsRow = HeroMath.chainsFromCorrection(session, cxRow, new Uint8Array(25));
    assert(chainsRow.length === 1, `Expected 1 chain for row, got ${chainsRow.length}`);
    assert(chainsRow[0].qubits[0] === 0, `Chain touching boundary should start at boundary (0), got ${chainsRow[0].qubits[0]}`);
    assert(chainsRow[0].qubits[1] === 1 && chainsRow[0].qubits[2] === 2, 'Chain should follow sequential connectivity');

    // Case C: Disjoint chains of X and Z
    const czCol = new Uint8Array(25);
    // In col x=1: qubit 0 (y=1), qubit 5 (y=3), qubit 10 (y=5)
    czCol[0] = 1;
    czCol[5] = 1;
    const chainsMixed = HeroMath.chainsFromCorrection(session, cxLone, czCol);
    assert(chainsMixed.length === 2, `Expected 2 chains (1 X, 1 Z), got ${chainsMixed.length}`);
    const xCh = chainsMixed.find(c => c.type === 'X');
    const zCh = chainsMixed.find(c => c.type === 'Z');
    assert(xCh && xCh.qubits.length === 1, 'X chain should have 1 qubit');
    assert(zCh && zCh.qubits.length === 2, 'Z chain should have 2 qubits');

    session.free();
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
