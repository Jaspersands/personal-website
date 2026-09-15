/**
 * hero-math.js - Pure mathematical and geometric helpers for the hero surface code
 *
 * Provides:
 *   HeroMath.fit(width, height, cell, dMax)
 *   HeroMath.gaussianRate(dist, sigma, peak)
 *   HeroMath.poisson(lambda, rand)
 *   HeroMath.chainsFromCorrection(session, cx, cz)
 */
((root, factory) => {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HeroMath = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /**
   * Fits a square rotated surface code of odd distance d to a viewport.
   * Sizes to the longer dimension so the two boundaries on the long axis
   * land at or near the viewport edges, with the shorter dimension cropped.
   */
  function fit(width, height, cell = 56, dMax = 31) {
    const maxDim = Math.max(width, height);
    // Find smallest odd d >= 3 such that (d - 1) * cell >= maxDim
    let d = Math.ceil(maxDim / cell) + 1;
    if (d % 2 === 0) d += 1;
    if (d < 3) d = 3;

    let activeCell = cell;
    if (d > dMax) {
      d = dMax;
      activeCell = Math.ceil(maxDim / (dMax - 1));
    }

    const span = (d - 1) * activeCell;
    const originX = (width - span) / 2;
    const originY = (height - span) / 2;

    return {
      d,
      cell: activeCell,
      originX,
      originY,
      span
    };
  }

  /**
   * Per-qubit cursor noise rate via Gaussian kernel.
   * dist: Euclidean distance in cell units from cursor
   */
  function gaussianRate(dist, sigma = 1.1, peak = 2.5) {
    if (dist > 3.5 * sigma) return 0;
    return peak * Math.exp(-(dist * dist) / (2 * sigma * sigma));
  }

  /**
   * Discrete Poisson random variable sampler (Knuth).
   */
  function poisson(lambda, rand = Math.random) {
    if (lambda <= 0) return 0;
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1.0;
    do {
      k++;
      p *= rand();
    } while (p > L);
    return k - 1;
  }

  /**
   * Helper to check if two qubits share a stabilizer of given type
   * and are adjacent on the Manhattan grid.
   */
  function areQubitsAdjacent(session, u, v, stabType) {
    const qu = session.qubits[u];
    const qv = session.qubits[v];
    if (Math.abs(qu.x - qv.x) + Math.abs(qu.y - qv.y) !== 2) return false;

    for (let i = 0; i < session.numStabs; i++) {
      const st = session.stabs[i];
      if (st.type === stabType &&
          Math.abs(st.x - qu.x) === 1 && Math.abs(st.y - qu.y) === 1 &&
          Math.abs(st.x - qv.x) === 1 && Math.abs(st.y - qv.y) === 1) {
        return true;
      }
    }
    return false;
  }

  /**
   * Decomposes flipped qubits into ordered polyline chains for animation.
   * X corrections connect through Z stabilizers; Z corrections connect through X stabilizers.
   * Ordered end-to-end; chains touching a boundary start at the boundary.
   */
  function chainsFromCorrection(session, cx, cz) {
    const result = [];
    const d = session.d;
    const maxCoord = 2 * d - 1;

    function processType(type, mask) {
      const stabType = (type === 'X') ? 'Z' : 'X';
      const active = [];
      for (let i = 0; i < session.numQubits; i++) {
        if (mask[i]) active.push(i);
      }
      if (active.length === 0) return;

      // Build adjacency list for active qubits
      const adj = new Map();
      active.forEach(q => adj.set(q, []));

      for (let i = 0; i < active.length; i++) {
        const u = active[i];
        for (let j = i + 1; j < active.length; j++) {
          const v = active[j];
          if (areQubitsAdjacent(session, u, v, stabType)) {
            adj.get(u).push(v);
            adj.get(v).push(u);
          }
        }
      }

      // Check boundary proximity
      function isBoundary(q) {
        const coord = session.qubits[q];
        if (type === 'X') {
          // X chains terminate on left (x=1) or right (x=maxCoord) boundaries
          return coord.x === 1 || coord.x === maxCoord;
        } else {
          // Z chains terminate on top (y=1) or bottom (y=maxCoord) boundaries
          return coord.y === 1 || coord.y === maxCoord;
        }
      }

      // Extract connected components and order each chain
      const visited = new Set();

      active.forEach(startNode => {
        if (visited.has(startNode)) return;

        // BFS to gather component members
        const comp = [];
        const queue = [startNode];
        visited.add(startNode);

        while (queue.length > 0) {
          const curr = queue.shift();
          comp.push(curr);
          const neighbors = adj.get(curr) || [];
          neighbors.forEach(nbr => {
            if (!visited.has(nbr)) {
              visited.add(nbr);
              queue.push(nbr);
            }
          });
        }

        if (comp.length === 1) {
          result.push({ type, qubits: comp });
          return;
        }

        // For components of length >= 2, determine optimal start node:
        // 1. Degree 1 node that touches a boundary
        // 2. Any degree 1 node (path endpoint)
        // 3. Node touching a boundary
        // 4. Any node
        let start = comp[0];
        const degree1Nodes = comp.filter(q => (adj.get(q) || []).length === 1);
        const boundaryNodes = comp.filter(q => isBoundary(q));
        const boundaryDegree1 = degree1Nodes.filter(q => isBoundary(q));

        if (boundaryDegree1.length > 0) {
          start = boundaryDegree1[0];
        } else if (degree1Nodes.length > 0) {
          start = degree1Nodes[0];
        } else if (boundaryNodes.length > 0) {
          start = boundaryNodes[0];
        }

        // Traverse greedily to build ordered path
        const ordered = [start];
        const pathVisited = new Set([start]);
        let curr = start;

        while (ordered.length < comp.length) {
          const nbrs = (adj.get(curr) || []).filter(n => !pathVisited.has(n));
          if (nbrs.length > 0) {
            // If any neighbor is degree 1 or boundary, prioritize or take next
            const next = nbrs[0];
            pathVisited.add(next);
            ordered.push(next);
            curr = next;
          } else {
            // Find any unvisited node connected to any in the path
            const unvisited = comp.find(n => !pathVisited.has(n));
            if (unvisited) {
              pathVisited.add(unvisited);
              ordered.push(unvisited);
              curr = unvisited;
            } else {
              break;
            }
          }
        }

        result.push({ type, qubits: ordered });
      });
    }

    if (cx) processType('X', cx);
    if (cz) processType('Z', cz);

    return result;
  }

  return {
    fit,
    gaussianRate,
    poisson,
    chainsFromCorrection
  };
});
