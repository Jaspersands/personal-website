/**
 * surface-code.js - Pure logic module for rotated surface codes
 *
 * Provides:
 *   SC.lattice(d): builds rotated surface code geometry for odd d (5, 7, 9...)
 *   SC.syndrome(lattice, errors): detects active defect plaquettes
 *   SC.match(lattice, defects, type): exact MWPM (≤10 defects) with greedy fallback
 *   SC.correctionPath(matches): extracts data qubits to flip
 *   SC.applyCorrection(errors, correctionQubits, type): applies correction
 */
((root, factory) => {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SC = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /**
   * Build rotated surface code lattice of code distance d (d must be odd >= 3).
   */
  function lattice(d) {
    if (d % 2 === 0 || d < 3) throw new Error('Distance d must be odd and >= 3');

    const numQubits = d * d;
    const idx = (r, c) => r * d + c;

    const qubits = [];
    for (let r = 0; r < d; r++) {
      for (let c = 0; c < d; c++) {
        qubits.push({ id: idx(r, c), r, c });
      }
    }

    const stabilizers = [];
    let stabId = 0;

    // 1. Bulk (face) stabilizers: (d-1) x (d-1)
    for (let r = 0; r < d - 1; r++) {
      for (let c = 0; c < d - 1; c++) {
        const type = (r + c) % 2 === 0 ? 'Z' : 'X';
        const q = [idx(r, c), idx(r, c + 1), idx(r + 1, c), idx(r + 1, c + 1)];
        stabilizers.push({
          id: stabId++,
          type,
          shape: 'face',
          r,
          c,
          cx: c + 0.5,
          cy: r + 0.5,
          q
        });
      }
    }

    // 2. Boundary half-plaquettes:
    // Top boundary (X): even columns in row -1
    for (let c = 0; c < d - 1; c += 2) {
      stabilizers.push({
        id: stabId++,
        type: 'X',
        shape: 'top',
        r: -1,
        c,
        cx: c + 0.5,
        cy: -0.38,
        q: [idx(0, c), idx(0, c + 1)]
      });
    }

    // Bottom boundary (X): odd columns in row d-1
    for (let c = 1; c < d - 1; c += 2) {
      stabilizers.push({
        id: stabId++,
        type: 'X',
        shape: 'bottom',
        r: d - 1,
        c,
        cx: c + 0.5,
        cy: (d - 1) + 0.38,
        q: [idx(d - 1, c), idx(d - 1, c + 1)]
      });
    }

    // Left boundary (Z): odd rows in col -1
    for (let r = 1; r < d - 1; r += 2) {
      stabilizers.push({
        id: stabId++,
        type: 'Z',
        shape: 'left',
        r,
        c: -1,
        cx: -0.38,
        cy: r + 0.5,
        q: [idx(r, 0), idx(r + 1, 0)]
      });
    }

    // Right boundary (Z): even rows in col d-1
    for (let r = 0; r < d - 1; r += 2) {
      stabilizers.push({
        id: stabId++,
        type: 'Z',
        shape: 'right',
        r,
        c: d - 1,
        cx: (d - 1) + 0.38,
        cy: r + 0.5,
        q: [idx(r, d - 1), idx(r + 1, d - 1)]
      });
    }

    // Map each qubit to its containing stabilizers
    const qubitStabs = Array.from({ length: numQubits }, () => ({ X: [], Z: [] }));
    stabilizers.forEach(s => {
      s.q.forEach(qId => {
        qubitStabs[qId][s.type].push(s.id);
      });
    });

    // Build syndrome defect graph for exact graph distance
    const graphs = {
      X: buildDefectGraph(stabilizers.filter(s => s.type === 'X'), qubitStabs, 'X'),
      Z: buildDefectGraph(stabilizers.filter(s => s.type === 'Z'), qubitStabs, 'Z')
    };

    return {
      d,
      numQubits,
      qubits,
      stabilizers,
      qubitStabs,
      graphs,
      idx
    };
  }

  /**
   * Constructs the dual defect graph for a specific syndrome type (X or Z).
   * Vertices are stabilizers of that type, plus a boundary vertex -1.
   * Edges are weighted by 1 (flipping one data qubit).
   */
  function buildDefectGraph(stabsOfType, qubitStabs, type) {
    const adj = new Map(); // stabId -> array of { neighborId, qubit }
    const stabsById = new Map();
    stabsOfType.forEach(s => {
      stabsById.set(s.id, s);
      adj.set(s.id, []);
    });
    adj.set(-1, []); // -1 is the virtual boundary vertex

    qubitStabs.forEach((qs, qId) => {
      const list = qs[type];
      if (list.length === 2) {
        const [s1, s2] = list;
        adj.get(s1).push({ to: s2, q: qId });
        adj.get(s2).push({ to: s1, q: qId });
      } else if (list.length === 1) {
        const s = list[0];
        adj.get(s).push({ to: -1, q: qId });
        adj.get(-1).push({ to: s, q: qId });
      }
    });

    // Precompute all-pairs shortest paths via BFS
    const distances = new Map(); // "u:v" -> distance
    const paths = new Map();     // "u:v" -> array of qubits

    const allNodes = [...stabsById.keys(), -1];
    allNodes.forEach(start => {
      const queue = [start];
      const dist = new Map();
      const parentEdge = new Map(); // node -> { from, q }
      dist.set(start, 0);

      while (queue.length > 0) {
        const u = queue.shift();
        const d = dist.get(u);
        const edges = adj.get(u) || [];
        for (const edge of edges) {
          if (!dist.has(edge.to)) {
            dist.set(edge.to, d + 1);
            parentEdge.set(edge.to, { from: u, q: edge.q });
            queue.push(edge.to);
          }
        }
      }

      allNodes.forEach(target => {
        if (dist.has(target)) {
          const key = `${start}:${target}`;
          distances.set(key, dist.get(target));

          // Reconstruct path of qubits
          const qPath = [];
          let curr = target;
          while (curr !== start && parentEdge.has(curr)) {
            const pe = parentEdge.get(curr);
            qPath.push(pe.q);
            curr = pe.from;
          }
          paths.set(key, qPath);
        }
      });
    });

    return {
      stabsById,
      distances,
      paths,
      getDist(u, v) {
        return distances.get(`${u}:${v}`) ?? Infinity;
      },
      getPath(u, v) {
        return paths.get(`${u}:${v}`) || [];
      }
    };
  }

  /**
   * Computes which stabilizers fire given an array of Pauli errors.
   * Error representation: 0=I, 1=X, 2=Z, 3=Y
   * Returns:
   *   litIds: array of stabilizer IDs that fired
   *   litZ: array of Z-stabilizers that fired (detecting X/Y errors)
   *   litX: array of X-stabilizers that fired (detecting Z/Y errors)
   */
  function syndrome(lat, errors) {
    const litIds = [];
    const litZ = [];
    const litX = [];

    lat.stabilizers.forEach(s => {
      let antiCount = 0;
      for (const q of s.q) {
        const e = errors[q];
        if (s.type === 'Z' && (e === 1 || e === 3)) antiCount++;
        else if (s.type === 'X' && (e === 2 || e === 3)) antiCount++;
      }
      if (antiCount % 2 === 1) {
        litIds.push(s.id);
        if (s.type === 'Z') litZ.push(s);
        else litX.push(s);
      }
    });

    return { litIds, litZ, litX };
  }

  /**
   * Solves Minimum-Weight Perfect Matching on defects of a single type.
   * If defects.length <= 12, computes exact global minimum via branch-and-bound.
   * If defects.length > 12, uses greedy matching fallback.
   */
  function match(lat, defects, type) {
    if (!defects || defects.length === 0) return { pairs: [], cost: 0 };

    const graph = lat.graphs[type];
    const defectIds = defects.map(d => (typeof d === 'object' ? d.id : d));

    // d=5 has 12 stabilizers of each type, so this cutoff makes the band demo exact always.
    if (defectIds.length <= 12) {
      return matchExact(graph, defectIds);
    } else {
      return matchGreedy(graph, defectIds);
    }
  }

  /**
   * Exact branch-and-bound MWPM for <= 10 defects.
   * Each defect can pair with another defect, or with the boundary (-1).
   */
  function matchExact(graph, defectIds) {
    const n = defectIds.length;
    let bestCost = Infinity;
    let bestPairs = [];

    function solve(unpaired, currentCost, currentPairs) {
      if (currentCost >= bestCost) return; // Prune branch
      if (unpaired.length === 0) {
        bestCost = currentCost;
        bestPairs = currentPairs.slice();
        return;
      }

      // Pick first defect
      const u = unpaired[0];
      const rest = unpaired.slice(1);

      // Option A: Pair u with the boundary (-1)
      const bDist = graph.getDist(u, -1);
      const bPair = { a: u, b: -1, cost: bDist, qubits: graph.getPath(u, -1) };
      solve(rest, currentCost + bDist, currentPairs.concat([bPair]));

      // Option B: Pair u with any other defect in rest
      for (let i = 0; i < rest.length; i++) {
        const v = rest[i];
        const dist = graph.getDist(u, v);
        const pair = { a: u, b: v, cost: dist, qubits: graph.getPath(u, v) };
        const nextRest = rest.slice(0, i).concat(rest.slice(i + 1));
        solve(nextRest, currentCost + dist, currentPairs.concat([pair]));
      }
    }

    solve(defectIds, 0, []);
    return { pairs: bestPairs, cost: bestCost };
  }

  /**
   * Greedy matching fallback for > 10 defects.
   */
  function matchGreedy(graph, defectIds) {
    const unpaired = new Set(defectIds);
    const pairs = [];
    let totalCost = 0;

    while (unpaired.size > 0) {
      let bestDist = Infinity;
      let bestPair = null;

      const arr = Array.from(unpaired);
      for (let i = 0; i < arr.length; i++) {
        const u = arr[i];
        // Check boundary
        const bDist = graph.getDist(u, -1);
        if (bDist < bestDist) {
          bestDist = bDist;
          bestPair = { a: u, b: -1, cost: bDist, qubits: graph.getPath(u, -1) };
        }
        // Check pairing with other defects
        for (let j = i + 1; j < arr.length; j++) {
          const v = arr[j];
          const dist = graph.getDist(u, v);
          if (dist < bestDist) {
            bestDist = dist;
            bestPair = { a: u, b: v, cost: dist, qubits: graph.getPath(u, v) };
          }
        }
      }

      if (!bestPair) break;
      pairs.push(bestPair);
      totalCost += bestPair.cost;
      unpaired.delete(bestPair.a);
      if (bestPair.b !== -1) unpaired.delete(bestPair.b);
    }

    return { pairs, cost: totalCost };
  }

  /**
   * Collect all data qubit flips required by the matches.
   */
  function correctionPath(matches) {
    const flipCount = new Map();
    if (!matches || !matches.pairs) return [];

    matches.pairs.forEach(p => {
      (p.qubits || []).forEach(q => {
        flipCount.set(q, (flipCount.get(q) || 0) + 1);
      });
    });

    // An even number of flips on the same qubit cancels out (Z + Z = I, X + X = I)
    const netFlips = [];
    flipCount.forEach((count, q) => {
      if (count % 2 === 1) netFlips.push(q);
    });
    return netFlips;
  }

  /**
   * Applies the Pauli correction to an error array.
   * type 'Z' stabilizers detect X errors -> correct with X flip (bit 1)
   * type 'X' stabilizers detect Z errors -> correct with Z flip (bit 2)
   */
  function applyCorrection(errors, correctionQubits, type) {
    const newErrors = errors.slice();
    const flipMask = (type === 'Z') ? 1 : 2; // Z defects need X flips; X defects need Z flips

    correctionQubits.forEach(q => {
      newErrors[q] = newErrors[q] ^ flipMask;
    });
    return newErrors;
  }

  return {
    lattice,
    syndrome,
    match,
    matchExact,
    matchGreedy,
    correctionPath,
    applyCorrection
  };
});
