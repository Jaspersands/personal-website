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
    NMAX: 7, vMin: -40, vMax: 140,                   // electrons per dot, mV window
    offsetMax: 35                                    // |charge-noise offset| clamp, mV
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
        dev.nudge(s * gauss(rand), s * gauss(rand));
      },
      // Offsets are clamped: charge noise moves a honeycomb by millivolts, not by a window.
      nudge(dV1, dV2) {
        const lim = p.offsetMax ?? Infinity, c = v => Math.min(lim, Math.max(-lim, v));
        dev.offset.d1 = c(dev.offset.d1 + dV1); dev.offset.d2 = c(dev.offset.d2 + dV2);
      }
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

  function createDetector({ w = 4, k = 5, sigma }) {
    const det = { trace: [], armedAt: -1, blankUntil: -1, reset() { det.trace.length = 0; det.armedAt = -1; det.blankUntil = -1; } };
    det.push = x => {
      const t = det.trace; t.push(x);
      const i = t.length - 1 - w;                          // newest position with a complete after-window
      if (det.armedAt < 0) {
        if (i < det.blankUntil) return null;               // before-window still straddles the last edge
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
      det.armedAt = -1; det.blankUntil = at + w;
      return { i: at, height: best };
    };
    return det;
  }

  // The sensor sits nearer dot 1, so its transitions are the taller steps.
  const classifyStep = (p, h) =>
    Math.abs(Math.abs(h) - p.s1) <= Math.abs(Math.abs(h) - p.s2) ? 'dot1' : 'dot2';

  /* ---------------- auto-tuner ----------------
     One step() is one measurement of the sensor at the current gate voltages.
     The tuner only ever sees the sensor value, never the charge numbers.

       calibrate  measure the noise floor at the starting point
       empty      sweep both gates down until the trace has been flat for
                  longer than a charging period — the dots are empty
       load1      sweep V1 up to the first step: one electron in dot 1
       load2      sweep V2 up to the first dot-2 step: one electron in dot 2
       centre     find the four walls of the (1,1) cell and go to the middle
       settle     record the sensor level at the operating point
       locked     monitor; a level shift means a transition passed under the
                  point (re-tune from empty); a periodic ±probe finds a wall
                  creeping close (re-centre) */
  function createTuner(device, opts = {}) {
    const p = device.p;
    const o = Object.assign({ step: 1, calibN: 32, flatMV: 40, wallMax: 30, checkEvery: 225, checkSpan: 6, w: 4, k: 5, start: null }, opts);
    const clampV = v => Math.min(p.vMax, Math.max(p.vMin, v));
    const t = {
      V1: o.start ? o.start.V1 : 100, V2: o.start ? o.start.V2 : 110,
      state: 'calibrate', sigma: null, N1: null, N2: null, lockLevel: null, walls: null,
      samples: [], events: [], measurements: 0, retunes: 0, recentres: 0, locks: 0
    };
    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let det = null, calib = [], flat = 0, lockBuf = [], idle = 0;
    let sweep = null;   // centring: { origin:{V1,V2}, di, dist, walls:[] }
    let probe = null;   // check:    { origin:{V1,V2}, di, k, sum, near }

    const emit = e => t.events.push(e);
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const newDet = () => createDetector({ w: o.w, k: o.k, sigma: t.sigma });
    const measure = () => {
      const S = device.measure(t.V1, t.V2); t.measurements++;
      t.samples.push({ V1: t.V1, V2: t.V2, S }); if (t.samples.length > 4000) t.samples.shift();
      return S;
    };
    const go = s => { t.state = s; det = newDet(); flat = 0; };
    const retune = () => { t.retunes++; t.N1 = null; t.N2 = null; t.walls = null; go('empty'); };

    const steps = {
      calibrate() {
        calib.push(measure());
        if (calib.length >= o.calibN) {
          const m = mean(calib);
          t.sigma = Math.max(1e-3, Math.sqrt(mean(calib.map(x => (x - m) ** 2))));
          calib = []; emit('calibrated'); go('empty');
        }
      },
      empty() {
        t.V1 = clampV(t.V1 - o.step); t.V2 = clampV(t.V2 - o.step);
        const r = det.push(measure());
        if (r) { emit('step:' + classifyStep(p, r.height)); flat = 0; } else flat += o.step;
        if (flat >= o.flatMV || (t.V1 <= p.vMin && t.V2 <= p.vMin)) { t.N1 = 0; t.N2 = 0; emit('empty'); go('load1'); }
      },
      load1() {
        t.V1 = clampV(t.V1 + o.step);
        const r = det.push(measure());
        if (r) { t.N1 = 1; emit('loaded:dot1'); go('load2'); }
        else if (t.V1 >= p.vMax) { emit('lost'); retune(); }
      },
      load2() {
        t.V2 = clampV(t.V2 + o.step);
        const r = det.push(measure());
        if (r) {
          if (classifyStep(p, r.height) === 'dot2') { t.N2 = 1; emit('loaded:dot2'); sweep = null; go('centre'); }
          else { t.V1 = clampV(t.V1 - 2 * o.w * o.step); emit('backoff:dot1'); det = newDet(); }
        } else if (t.V2 >= p.vMax) { emit('lost'); retune(); }
      },
      centre() {
        if (!sweep) sweep = { origin: { V1: t.V1, V2: t.V2 }, di: 0, dist: 0, walls: [] };
        const [dx, dy] = DIRS[sweep.di];
        sweep.dist += o.step;
        t.V1 = clampV(sweep.origin.V1 + dx * sweep.dist); t.V2 = clampV(sweep.origin.V2 + dy * sweep.dist);
        const r = det.push(measure());
        const atEdge = (dx && (t.V1 <= p.vMin || t.V1 >= p.vMax)) || (dy && (t.V2 <= p.vMin || t.V2 >= p.vMax));
        let wall = null;
        if (r) wall = (r.i + 1) * o.step;                  // the step lies between samples i and i+1
        else if (sweep.dist >= o.wallMax || atEdge) wall = sweep.dist;
        if (wall === null) return;
        sweep.walls.push(wall); sweep.di++; sweep.dist = 0;
        det = newDet();
        if (sweep.di < 4) return;
        const [L, R, D, U] = sweep.walls, org = sweep.origin;
        t.V1 = clampV(org.V1 + (R - L) / 2); t.V2 = clampV(org.V2 + (U - D) / 2);
        t.walls = { left: org.V1 - L, right: org.V1 + R, down: org.V2 - D, up: org.V2 + U };
        sweep = null; lockBuf = []; emit('centred'); go('settle');
      },
      settle() {
        lockBuf.push(measure());
        if (lockBuf.length >= 8) { t.lockLevel = mean(lockBuf); lockBuf = []; idle = 0; t.locks++; emit('locked'); go('locked'); }
      },
      locked() {
        idle++;
        lockBuf.push(measure()); if (lockBuf.length > 8) lockBuf.shift();
        if (lockBuf.length === 8 && Math.abs(mean(lockBuf) - t.lockLevel) > 0.5 * p.s2) { emit('drift'); lockBuf = []; retune(); return; }
        if (idle % o.checkEvery === 0) { probe = { origin: { V1: t.V1, V2: t.V2 }, di: 0, k: 0, sum: 0, near: false }; go('check'); }
      },
      check() {
        const [dx, dy] = DIRS[probe.di];
        t.V1 = clampV(probe.origin.V1 + dx * o.checkSpan); t.V2 = clampV(probe.origin.V2 + dy * o.checkSpan);
        probe.sum += measure(); probe.k++;
        if (probe.k < 4) return;
        if (Math.abs(probe.sum / 4 - t.lockLevel) > 0.5 * p.s2) probe.near = true;
        probe.di++; probe.k = 0; probe.sum = 0;
        if (probe.di < 4) return;
        t.V1 = probe.origin.V1; t.V2 = probe.origin.V2;
        if (probe.near) { t.recentres++; emit('wall-near'); sweep = null; go('centre'); }
        else { lockBuf = []; go('locked'); }
        probe = null;
      }
    };
    t.step = () => { steps[t.state](); };
    return t;
  }

  return { defaultParams, energy, occupation, transitionV1, transitionV2, mulberry32, gauss, createDevice,
           stepDiff, createDetector, classifyStep, createTuner };
});
