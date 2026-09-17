/**
 * tests/opening-font.test.js - Test suite for the 3x5 pixel font name typing sequence
 */
const fs = require('fs');
const path = require('path');
const QEC = require('../engine.js');

const FONT = {
  J: [
    [1, 1, 1],
    [0, 0, 1],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 0]
  ],
  A: [
    [0, 1, 0],
    [1, 0, 1],
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1]
  ],
  S: [
    [0, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 1, 0]
  ],
  P: [
    [1, 1, 0],
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 0],
    [1, 0, 0]
  ],
  E: [
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 0],
    [1, 1, 1]
  ],
  R: [
    [1, 1, 0],
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 1],
    [1, 0, 1]
  ],
  N: [
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 1],
    [0, 1, 1],
    [1, 0, 1]
  ],
  D: [
    [1, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 0]
  ]
};

function getWordPixels(word, startR, startC) {
  const pixels = [];
  let c = startC;
  for (const char of word) {
    const glyph = FONT[char];
    if (glyph) {
      for (let r = 0; r < 5; r++) {
        for (let col = 0; col < 3; col++) {
          if (glyph[r][col]) {
            pixels.push({ r: startR + r, c: c + col });
          }
        }
      }
    }
    c += 4; // 3 width + 1 spacing
  }
  return pixels;
}

async function runTests() {
  console.log('Running opening-font.test.js...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
      throw new Error(message);
    }
  }

  const wasmPath = path.join(__dirname, '../assets/stabilizer_qec.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  const engine = await QEC.load(wasmBytes);

  // Test 1: d=27 JASPER SANDS fits within lattice bounds and doesn't touch left/right boundaries
  try {
    const d = 27;
    const line1 = getWordPixels('JASPER', 8, 2);
    const line2 = getWordPixels('SANDS', 14, 4);
    const allPixels = [...line1, ...line2];

    assert(allPixels.length > 50, `Expected > 50 pixels, got ${allPixels.length}`);

    allPixels.forEach(p => {
      assert(p.r >= 0 && p.r < d, `Row ${p.r} out of bounds for d=${d}`);
      assert(p.c > 0 && p.c < d - 1, `Col ${p.c} touches boundary for d=${d}`);
    });

    console.log(`  ✓ d=27 JASPER SANDS (${allPixels.length} pixels) stays within internal lattice bounds`);
    passed++;

    // Test 2: d=27 JASPER SANDS decodes cleanly with 0 logical errors and clears all syndromes
    const s = engine.session(d);
    allPixels.forEach(p => {
      const q = p.r * d + p.c;
      s.toggle(q, 'X');
    });

    const syn = s.syndrome();
    const litCount = syn.filter(x => x === 1).length;
    assert(litCount > 0, `Expected active syndromes, got ${litCount}`);

    const res = s.decode(2);
    assert(res.logical === 0, `Expected logical === 0, got ${res.logical}`);

    // Apply correction
    for (let i = 0; i < s.numQubits; i++) {
      if (res.cx[i]) s.toggle(i, 'X');
      if (res.cz[i]) s.toggle(i, 'Z');
    }

    const postSyn = s.syndrome();
    const remainingDefects = postSyn.filter(x => x === 1).length;
    assert(remainingDefects === 0, `Expected 0 defects after correction, got ${remainingDefects}`);

    console.log(`  ✓ d=27 JASPER SANDS decodes cleanly with exact MWPM (0 logical errors, 0 defects remaining)`);
    passed++;
    s.free();
  } catch (err) {
    console.error('  ✗ FAIL d=27 test:', err.message);
    failed++;
  }

  // Test 3: d=15 JS mobile pattern fits and decodes cleanly
  try {
    const d = 15;
    const jsPixels = getWordPixels('JS', 5, 4);
    jsPixels.forEach(p => {
      assert(p.r >= 0 && p.r < d, `Row ${p.r} out of bounds for d=${d}`);
      assert(p.c > 0 && p.c < d - 1, `Col ${p.c} touches boundary for d=${d}`);
    });

    const s = engine.session(d);
    jsPixels.forEach(p => {
      const q = p.r * d + p.c;
      s.toggle(q, 'X');
    });

    const res = s.decode(2);
    assert(res.logical === 0, `Expected logical === 0 for JS on d=15, got ${res.logical}`);

    for (let i = 0; i < s.numQubits; i++) {
      if (res.cx[i]) s.toggle(i, 'X');
      if (res.cz[i]) s.toggle(i, 'Z');
    }

    const postSyn = s.syndrome();
    const remainingDefects = postSyn.filter(x => x === 1).length;
    assert(remainingDefects === 0, `Expected 0 defects after correction, got ${remainingDefects}`);

    console.log(`  ✓ d=15 JS mobile glyph decodes cleanly with exact MWPM`);
    passed++;
    s.free();
  } catch (err) {
    console.error('  ✗ FAIL d=15 test:', err.message);
    failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
