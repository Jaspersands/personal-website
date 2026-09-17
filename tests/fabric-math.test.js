/**
 * tests/fabric-math.test.js — layout, scroll→scale mapping, camera, containment.
 */
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
  assert.strictEqual(L.heroIndex, L.patches.indexOf(h));
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
  assert.strictEqual(FM.cellAt(-1, 56, 10), 56);
  assert.strictEqual(FM.cellAt(2, 56, 10), 10);
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
  assert.strictEqual(FM.patchAt(L, -5, -5), -1);
});

test('neighbours lists horizontally and vertically adjacent patch pairs once each', () => {
  const L = FM.layout({ d: 9, cols: 3, rows: 2, gap: 6 });
  const pairs = FM.neighbours(L);
  // 3x2 grid: 2 horizontal pairs per row × 2 rows + 3 vertical pairs = 7
  assert.strictEqual(pairs.length, 7);
  pairs.forEach(([a, b]) => assert.ok(a < b));
  assert.ok(pairs.some(([a, b]) => L.patches[a].row === L.patches[b].row && L.patches[b].col - L.patches[a].col === 1));
  assert.ok(pairs.some(([a, b]) => L.patches[a].col === L.patches[b].col && L.patches[b].row - L.patches[a].row === 1));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
