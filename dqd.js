/* dqd.js — constant-interaction model of a double quantum dot, a simulated
   charge sensor, a change-point detector, and an auto-tuner. Pure: no DOM.

   Energy of the charge configuration (N1, N2) at plunger voltages (V1, V2), in meV:
     E = ½·EC1·N1² + ½·EC2·N2² + ECm·N1·N2
         − N1·(a11·V1 + a12·V2) − N2·(a21·V1 + a22·V2)
   The ground state over integer (N1, N2) traces the familiar honeycomb; a
   Boltzmann average at kT smooths each transition. The sensor sees a weighted
   sum of the two occupations plus a small linear background and noise. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DQD = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const defaultParams = () => ({
    EC1: 2.4, EC2: 2.2, ECm: 0.55,                   // meV
    a11: 0.085, a22: 0.080, a12: 0.018, a21: 0.015,  // meV per mV (lever arms)
    kT: 0.015,                                       // meV, ~175 mK
    s1: 1.0, s2: 0.6, b: 0.0015, sigma: 0.05,        // charge-sensor response
    NMAX: 7, vMin: 0, vMax: 140                      // electrons per dot, mV window
  });

  const energy = (p, N1, N2, V1, V2) =>
    0.5 * p.EC1 * N1 * N1 + 0.5 * p.EC2 * N2 * N2 + p.ECm * N1 * N2
    - N1 * (p.a11 * V1 + p.a12 * V2) - N2 * (p.a21 * V1 + p.a22 * V2);

  function occupation(p, V1, V2) {
    let g1 = 0, g2 = 0, Emin = Infinity;
    for (let n1 = 0; n1 <= p.NMAX; n1++) for (let n2 = 0; n2 <= p.NMAX; n2++) {
      const E = energy(p, n1, n2, V1, V2);
      if (E < Emin) { Emin = E; g1 = n1; g2 = n2; }
    }
    // Thermal average over the ground state and its neighbours (kT ≪ EC).
    let Z = 0, N1 = 0, N2 = 0;
    for (let n1 = Math.max(0, g1 - 1); n1 <= Math.min(p.NMAX, g1 + 1); n1++)
      for (let n2 = Math.max(0, g2 - 1); n2 <= Math.min(p.NMAX, g2 + 1); n2++) {
        const w = Math.exp(-(energy(p, n1, n2, V1, V2) - Emin) / p.kT);
        Z += w; N1 += w * n1; N2 += w * n2;
      }
    return { N1: N1 / Z, N2: N2 / Z, g1, g2 };
  }

  // Voltage at which (N1,N2) and (N1+1,N2) are degenerate, and likewise for dot 2.
  const transitionV1 = (p, N1, N2, V2) => (p.EC1 * (N1 + 0.5) + p.ECm * N2 - p.a12 * V2) / p.a11;
  const transitionV2 = (p, N1, N2, V1) => (p.EC2 * (N2 + 0.5) + p.ECm * N1 - p.a21 * V1) / p.a22;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const gauss = rand => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  function createDevice(p, rand = Math.random, opts = {}) {
    const driftSigma = opts.driftSigma ?? 0.15; // mV per sqrt(second)
    const dev = {
      p, offset: { d1: 0, d2: 0 },
      truth(V1, V2) { return occupation(p, V1 + dev.offset.d1, V2 + dev.offset.d2); },
      measure(V1, V2) {
        const o = dev.truth(V1, V2);
        return p.s1 * o.N1 + p.s2 * o.N2 + p.b * (V1 + V2) + p.sigma * gauss(rand);
      },
      drift(dt) {
        const s = driftSigma * Math.sqrt(dt);
        dev.offset.d1 += s * gauss(rand); dev.offset.d2 += s * gauss(rand);
      },
      nudge(dV1, dV2) { dev.offset.d1 += dV1; dev.offset.d2 += dV2; }
    };
    return dev;
  }

  /* ---------------- change-point detection on a 1-D sensor trace ----------------
     A step at sample i is the difference between the mean of the w samples
     after i and the mean of the w samples up to and including i. The detector
     arms when that difference first exceeds k·sigma and confirms 2w samples
     later, reporting the position and full height of the largest straddling
     difference — by then the after-window has cleared the edge. */
  function stepDiff(trace, i, w) {
    if (i - w + 1 < 0 || i + w >= trace.length) return null;
    let a = 0, b = 0;
    for (let j = i - w + 1; j <= i; j++) a += trace[j];
    for (let j = i + 1; j <= i + w; j++) b += trace[j];
    return (b - a) / w;
  }

  function createDetector({ w = 4, k = 4, sigma }) {
    const det = { trace: [], armedAt: -1, reset() { det.trace.length = 0; det.armedAt = -1; } };
    det.push = x => {
      const t = det.trace; t.push(x);
      const i = t.length - 1 - w;                          // newest position with a complete after-window
      if (det.armedAt < 0) {
        const d = stepDiff(t, i, w);
        if (d !== null && Math.abs(d) > k * sigma) det.armedAt = i;
        return null;
      }
      if (t.length - 1 < det.armedAt + 2 * w) return null; // wait for the after-window to clear the edge
      let best = 0, at = det.armedAt;
      for (let j = det.armedAt; j <= det.armedAt + w; j++) {
        const d = stepDiff(t, j, w);
        if (d !== null && Math.abs(d) > Math.abs(best)) { best = d; at = j; }
      }
      det.armedAt = -1;
      return { i: at, height: best };
    };
    return det;
  }

  // The sensor sits nearer dot 1, so its transitions are the taller steps.
  const classifyStep = (p, h) =>
    Math.abs(Math.abs(h) - p.s1) <= Math.abs(Math.abs(h) - p.s2) ? 'dot1' : 'dot2';

  return { defaultParams, energy, occupation, transitionV1, transitionV2, mulberry32, gauss, createDevice,
           stepDiff, createDetector, classifyStep };
});
