/* fabric-math.js — pure geometry for the lattice-surgery fabric (E). World
   units are engine half-cells: a patch spans 0..2d, a cell is 2 units, and a
   qubit at engine (x, y) inside patch k sits at world (x0 + x, y0 + y). */
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
    const heroIndex = hero.row * cols + hero.col;
    const h = patches[heroIndex];
    return {
      d, cols, rows, gap, patchSpan, pitch, patches, hero, heroIndex,
      worldW: cols * pitch - 2 * gap, worldH: rows * pitch - 2 * gap,
      centre: { x: h.x0 + d, y: h.y0 + d }
    };
  }

  // cellMax: the hero cell size. cellMin: the largest cell (px) at which the
  // whole fabric fits 92 % of the viewport on both axes.
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

  // Adjacent patch pairs [a, b] with a < b, for lattice-surgery merges.
  function neighbours(L) {
    const pairs = [];
    L.patches.forEach((q, i) => {
      if (q.col + 1 < L.cols) pairs.push([i, i + 1]);
      if (q.row + 1 < L.rows) pairs.push([i, i + L.cols]);
    });
    return pairs;
  }

  return { layout, scaleFor, ease, cellAt, camera, patchAt, neighbours };
});
