/**
 * tests/surface-code.test.js
 *
 * Standalone Node.js test suite for surface-code.js (no framework required).
 * Verifies:
 *   1. Stabilizer counts: d^2 - 1 for d in [3, 5, 7, 9]
 *   2. Commutation: every X/Z pair overlaps on an even number of qubits
 *   3. Coverage: every data qubit is covered by stabilizers
 *   4. Single-error syndromes: correct defect patterns
 *   5. Matching optimality: exact MWPM cost <= greedy cost
 *   6. Syndrome clearing property: correction always yields empty syndrome
 *      across 500 random error patterns for d=5, 7, 9
 */

const SC = require('../surface-code.js');
const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('Running surface-code.test.js...\n');

// 1. Stabilizer Counts
test('Stabilizer count matches d^2 - 1 for d=3, 5, 7, 9', () => {
  [3, 5, 7, 9].forEach(d => {
    const lat = SC.lattice(d);
    const expected = d * d - 1;
    assert.strictEqual(
      lat.stabilizers.length,
      expected,
      `d=${d} expected ${expected} stabilizers, got ${lat.stabilizers.length}`
    );
  });
});

// 2. Commutation Check
test('Every X and Z stabilizer pair commutes (overlaps on 0 or 2 qubits)', () => {
  [3, 5, 7, 9].forEach(d => {
    const lat = SC.lattice(d);
    const xStabs = lat.stabilizers.filter(s => s.type === 'X');
    const zStabs = lat.stabilizers.filter(s => s.type === 'Z');

    xStabs.forEach(xs => {
      zStabs.forEach(zs => {
        const overlap = xs.q.filter(q => zs.q.includes(q)).length;
        assert(
          overlap === 0 || overlap === 2,
          `d=${d} stabilizer X #${xs.id} and Z #${zs.id} overlap on ${overlap} qubits (must be 0 or 2)`
        );
      });
    });
  });
});

// 3. Qubit Coverage
test('Every data qubit is covered by at least one X and one Z stabilizer', () => {
  [3, 5, 7, 9].forEach(d => {
    const lat = SC.lattice(d);
    for (let q = 0; q < lat.numQubits; q++) {
      const xCount = lat.qubitStabs[q].X.length;
      const zCount = lat.qubitStabs[q].Z.length;
      assert(xCount >= 1, `d=${d} qubit ${q} has ${xCount} X stabilizers (must be >= 1)`);
      assert(zCount >= 1, `d=${d} qubit ${q} has ${zCount} Z stabilizers (must be >= 1)`);
    }
  });
});

// 4. Single-Error Syndromes
test('Single X error trips 1 or 2 Z-stabilizers, 0 X-stabilizers', () => {
  const lat = SC.lattice(5);
  for (let q = 0; q < lat.numQubits; q++) {
    const errs = new Array(lat.numQubits).fill(0);
    errs[q] = 1; // Pauli X
    const syn = SC.syndrome(lat, errs);
    assert.strictEqual(syn.litX.length, 0, `X error on qubit ${q} tripped X stabilizers`);
    assert(syn.litZ.length === 1 || syn.litZ.length === 2, `X error on qubit ${q} tripped ${syn.litZ.length} Z stabilizers`);
  }
});

test('Single Z error trips 1 or 2 X-stabilizers, 0 Z-stabilizers', () => {
  const lat = SC.lattice(5);
  for (let q = 0; q < lat.numQubits; q++) {
    const errs = new Array(lat.numQubits).fill(0);
    errs[q] = 2; // Pauli Z
    const syn = SC.syndrome(lat, errs);
    assert.strictEqual(syn.litZ.length, 0, `Z error on qubit ${q} tripped Z stabilizers`);
    assert(syn.litX.length === 1 || syn.litX.length === 2, `Z error on qubit ${q} tripped ${syn.litX.length} X stabilizers`);
  }
});

// 5. Matching Optimality: Exact Cost <= Greedy Cost
test('Exact MWPM cost is <= Greedy cost across random defect patterns', () => {
  const lat = SC.lattice(5);
  for (let trial = 0; trial < 100; trial++) {
    const errs = new Array(lat.numQubits).fill(0);
    for (let q = 0; q < lat.numQubits; q++) {
      if (Math.random() < 0.12) errs[q] = Math.floor(Math.random() * 4);
    }
    const syn = SC.syndrome(lat, errs);
    ['Z', 'X'].forEach(type => {
      const defects = (type === 'Z') ? syn.litZ : syn.litX;
      if (defects.length > 0 && defects.length <= 10) {
        const graph = lat.graphs[type];
        const exact = SC.matchExact(graph, defects.map(d => d.id));
        const greedy = SC.matchGreedy(graph, defects.map(d => d.id));
        assert(
          exact.cost <= greedy.cost,
          `Exact cost ${exact.cost} was greater than greedy cost ${greedy.cost}`
        );
      }
    });
  }
});

// 6. Correction-Clears-Syndrome Property Test across 500 random patterns
test('Correction completely clears syndrome across 500 random error patterns at d=5, 7, 9', () => {
  const distances = [5, 7, 9];
  let totalTrials = 0;

  distances.forEach(d => {
    const lat = SC.lattice(d);
    const trialsForD = (d === 9) ? 100 : 200; // 200 + 200 + 100 = 500 total

    for (let t = 0; t < trialsForD; t++) {
      totalTrials++;
      const p = 0.08 + Math.random() * 0.08; // 8% to 16% error rate
      const errs = new Array(lat.numQubits).fill(0);
      for (let q = 0; q < lat.numQubits; q++) {
        if (Math.random() < p) {
          errs[q] = 1 + Math.floor(Math.random() * 3); // X, Z, or Y
        }
      }

      // Initial syndrome
      const syn = SC.syndrome(lat, errs);

      // Match Z defects (from X/Y errors)
      const matchZ = SC.match(lat, syn.litZ, 'Z');
      const flipsX = SC.correctionPath(matchZ);
      let correctedErrs = SC.applyCorrection(errs, flipsX, 'Z');

      // Match X defects (from Z/Y errors)
      const syn2 = SC.syndrome(lat, correctedErrs);
      const matchX = SC.match(lat, syn2.litX, 'X');
      const flipsZ = SC.correctionPath(matchX);
      correctedErrs = SC.applyCorrection(correctedErrs, flipsZ, 'X');

      // Final syndrome MUST be completely empty!
      const finalSyn = SC.syndrome(lat, correctedErrs);
      assert.strictEqual(
        finalSyn.litIds.length,
        0,
        `d=${d} trial #${t} failed: ${finalSyn.litIds.length} defects remained uncorrected!`
      );
    }
  });

  assert.strictEqual(totalTrials, 500, `Expected 500 total trials, ran ${totalTrials}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
