/**
 * tests/bloch.test.js
 *
 * Standalone Node.js test suite for bloch.js (no framework required).
 * Verifies:
 *   1. Slerp endpoints: t=0 returns v0, t=1 returns v1
 *   2. Unit-length preservation: ||slerp(v0, v1, t)|| == 1 for all t in [0, 1]
 *   3. Great circle geometry: intermediate angles match t * angle(v0, v1)
 *   4. Projection bounds: orthographic projection stays within unit disk
 */

const bloch = require('../bloch.js');
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

console.log('Running bloch.test.js...\n');

// 1. Slerp Endpoints
test('Slerp matches endpoints at t=0 and t=1', () => {
  const v0 = bloch.normalize([1, 0, 0]);
  const v1 = bloch.normalize([0, 1, 0]);

  const at0 = bloch.slerp(v0, v1, 0);
  assert(Math.abs(at0[0] - v0[0]) < 1e-6);
  assert(Math.abs(at0[1] - v0[1]) < 1e-6);
  assert(Math.abs(at0[2] - v0[2]) < 1e-6);

  const at1 = bloch.slerp(v0, v1, 1);
  assert(Math.abs(at1[0] - v1[0]) < 1e-6);
  assert(Math.abs(at1[1] - v1[1]) < 1e-6);
  assert(Math.abs(at1[2] - v1[2]) < 1e-6);
});

// 2. Unit-Length Preservation
test('Slerp preserves unit length across 100 random pairs and intervals', () => {
  for (let i = 0; i < 100; i++) {
    const v0 = bloch.normalize([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    const v1 = bloch.normalize([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    const t = Math.random();

    const vt = bloch.slerp(v0, v1, t);
    const len = Math.hypot(vt[0], vt[1], vt[2]);
    assert(
      Math.abs(len - 1.0) < 1e-5,
      `Length deviated from 1: ${len}`
    );
  }
});

// 3. Great-Circle Angle Proportion
test('Intermediate point at t=0.5 bisects angle between v0 and v1', () => {
  const v0 = [1, 0, 0];
  const v1 = [0, 1, 0];
  const mid = bloch.slerp(v0, v1, 0.5);

  const expectedMid = [Math.SQRT1_2, Math.SQRT1_2, 0];
  assert(Math.abs(mid[0] - expectedMid[0]) < 1e-6);
  assert(Math.abs(mid[1] - expectedMid[1]) < 1e-6);
  assert(Math.abs(mid[2] - 0) < 1e-6);
});

// 4. Projection Sanity
test('Orthographic projection maps unit sphere points within unit disk', () => {
  for (let yaw = 0; yaw <= Math.PI * 2; yaw += 0.5) {
    for (let pitch = -0.5; pitch <= 0.5; pitch += 0.25) {
      for (let i = 0; i < 50; i++) {
        const v = bloch.normalize([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
        const proj = bloch.projectPoint(v, yaw, pitch);
        const r = Math.hypot(proj[0], proj[1]);
        assert(
          r <= 1.0001,
          `Projected radius ${r} exceeded 1.0`
        );
      }
    }
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
