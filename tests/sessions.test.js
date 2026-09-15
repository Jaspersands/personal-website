/**
 * tests/sessions.test.js
 *
 * Node test suite for sessions.js against the real assets/stabilizer_qec.wasm
 * (loaded through engine.js, sessions built from engine.rawExports).
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const QEC = require('../engine.js');
const QECSessions = require('../sessions.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
const bytes = fs.readFileSync(path.join(__dirname, '..', 'assets', 'stabilizer_qec.wasm'));

(async () => {
  const engine = await QEC.load(bytes);
  const make = d => QECSessions.create(engine.rawExports, d);

  await test('geometry: d² qubits at odd coords, d²−1 stabilizers, X first', () => {
    for (const d of [5, 9, 15]) {
      const s = make(d);
      assert.strictEqual(s.numQubits, d * d);
      assert.strictEqual(s.qubits.length, d * d);
      assert.strictEqual(s.stabs.length, d * d - 1);
      assert.strictEqual(s.numStabs, d * d - 1);
      s.qubits.forEach((q, i) => {
        assert.strictEqual(q.x, 2 * (i % d) + 1);
        assert.strictEqual(q.y, 2 * Math.floor(i / d) + 1);
      });
      let seenZ = false;
      s.stabs.forEach(st => {
        assert.ok(st.x % 2 === 0 && st.y % 2 === 0);
        assert.ok(st.x >= 0 && st.x <= 2 * d && st.y >= 0 && st.y <= 2 * d);
        if (st.type === 'Z') seenZ = true; else assert.ok(!seenZ, 'X stabilizers must be indexed before Z');
      });
      assert.strictEqual(s.qubitAt(2, 3), 3 * d + 2);
      s.free();
    }
  });

  await test('boundary orientation: X half-plaquettes left/right, Z top/bottom', () => {
    const d = 9, s = make(d);
    const lr = s.stabs.filter(st => st.x === 0 || st.x === 2 * d);
    const tb = s.stabs.filter(st => st.y === 0 || st.y === 2 * d);
    assert.ok(lr.length > 0 && lr.every(st => st.type === 'X'));
    assert.ok(tb.length > 0 && tb.every(st => st.type === 'Z'));
    s.free();
  });

  await test('single X in the bulk lights exactly two diagonal Z stabilizers', () => {
    const d = 9, s = make(d);
    s.toggle(s.qubitAt(4, 4), 'X');
    const syn = s.syndrome();
    const lit = [...syn].map((v, i) => v ? s.stabs[i] : null).filter(Boolean);
    assert.strictEqual(lit.length, 2);
    assert.ok(lit.every(st => st.type === 'Z'));
    assert.strictEqual(Math.abs(lit[0].x - lit[1].x), 2);
    assert.strictEqual(Math.abs(lit[0].y - lit[1].y), 2);
    s.free();
  });

  await test('single X on the left edge lights exactly one Z stabilizer (chains terminate left/right)', () => {
    const d = 9, s = make(d);
    s.toggle(s.qubitAt(0, 4), 'X');
    assert.strictEqual([...s.syndrome()].filter(v => v).length, 1);
    s.free();
  });

  await test('single Z on the top edge lights exactly one X stabilizer', () => {
    const d = 9, s = make(d);
    s.toggle(s.qubitAt(4, 0), 'Z');
    const syn = s.syndrome();
    const lit = [...syn].map((v, i) => v ? s.stabs[i] : null).filter(Boolean);
    assert.strictEqual(lit.length, 1);
    assert.strictEqual(lit[0].type, 'X');
    s.free();
  });

  await test('full row of X from left to right: no syndrome, logical error', () => {
    const d = 9, s = make(d);
    for (let c = 0; c < d; c++) s.toggle(s.qubitAt(c, 4), 'X');
    assert.ok([...s.syndrome()].every(v => v === 0));
    assert.strictEqual(s.decode().logical, 1);
    s.free();
  });

  await test('short chain from the left edge is corrected, no logical error', () => {
    const d = 15, s = make(d);
    for (let c = 0; c < Math.floor(d / 4); c++) s.toggle(s.qubitAt(c, 7), 'X');
    const r = s.decode();
    assert.strictEqual(r.logical, 0);
    s.applyCorrection(r.cx, r.cz);
    assert.ok([...s.syndrome()].every(v => v === 0));
    s.free();
  });

  await test('property: correction always clears the syndrome (300 random rounds, d=15, p=3%)', () => {
    const d = 15, s = make(d);
    for (let k = 0; k < 300; k++) {
      s.clear();
      for (let q = 0; q < s.numQubits; q++) if (Math.random() < 0.03) s.toggle(q, ['X', 'Z', 'Y'][Math.floor(Math.random() * 3)]);
      const r = s.decode();
      s.applyCorrection(r.cx, r.cz);
      assert.ok([...s.syndrome()].every(v => v === 0), `round ${k} left a syndrome`);
    }
    s.free();
  });

  await test('clear() resets the frame so decode() reports no logical error', () => {
    const d = 9, s = make(d);
    for (let c = 0; c < d; c++) s.toggle(s.qubitAt(c, 2), 'X');
    assert.strictEqual(s.decode().logical, 1);
    s.clear();
    assert.strictEqual(s.decode().logical, 0);
    s.free();
  });

  await test('two sessions are independent', () => {
    const a = make(5), b = make(5);
    a.toggle(12, 'X');
    assert.ok([...a.syndrome()].some(v => v));
    assert.ok([...b.syndrome()].every(v => v === 0));
    b.toggle(3, 'Z');
    assert.strictEqual([...a.syndrome()].filter(v => v).length, 2);
    a.free(); b.free();
  });

  await test('timing: d=27 decode with 40 errors under 20 ms', () => {
    const s = make(27);
    for (let e = 0; e < 40; e++) s.toggle(Math.floor(Math.random() * s.numQubits), Math.random() < .5 ? 'X' : 'Z');
    const t0 = performance.now(); s.decode(); const dt = performance.now() - t0;
    assert.ok(dt < 20, `took ${dt.toFixed(1)} ms`);
    s.free();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
