/* tuner-view.js — D: renders the double-dot auto-tuner from dqd.js onto
   canvas#dqd and canvas#dqd-sensor-trace, driven at an observable measurement rate.

   Layers on 2D canvas:
     - Ground truth charge-stability honeycomb (hidden physical reality)
     - Target (1,1) single-electron qubit operating cell
     - Measured samples (what the tuner has actually observed)
     - Recent voltage path
     - Cell walls discovered by boundary scans
     - Operating point crosshair & ring

   1D canvas:
     - Real-time charge sensor oscilloscope trace S(t)
     - Highlights change-point step detections as electrons are loaded into each dot */
(() => {
  'use strict';

  const canvas = document.getElementById('dqd');
  if (!canvas || !window.DQD) return;
  const traceCanvas = document.getElementById('dqd-sensor-trace');
  const DQD = window.DQD, $ = id => document.getElementById(id);

  const p = DQD.defaultParams();
  const device = DQD.createDevice(p, Math.random, { driftSigma: 0.15 });
  const tuner = DQD.createTuner(device, {
    start: { V1: 85 + 40 * Math.random(), V2: 90 + 40 * Math.random() }
  });
  const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------- speeds ---------------- */
  const SPEEDS = [
    { rate: 75, label: 'Speed: 1×' },
    { rate: 150, label: 'Speed: 2×' },
    { rate: 35, label: 'Speed: 0.5×' }
  ];
  let speedIdx = 0;
  let RATE = SPEEDS[0].rate;
  const MAX_STEPS = 24;
  const PATH_LEN = 500;

  /* ---------------- geometry ---------------- */
  const W = 480, H = 400, M = { l: 44, r: 14, t: 14, b: 32 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b, span = p.vMax - p.vMin;
  const X = v => M.l + (v - p.vMin) / span * pw;
  const Y = v => M.t + ph - (v - p.vMin) / span * ph;
  const pxPerMV = pw / span;
  const Smax = p.s1 * 4 + p.s2 * 4 + p.b * 2 * p.vMax;

  // 1D trace geometry
  const TW = 480, TH = 70, TM = { l: 44, r: 14, t: 10, b: 18 };
  const tpw = TW - TM.l - TM.r, tph = TH - TM.t - TM.b;

  let dpr = 1, ctx = canvas.getContext('2d');
  let tctx = traceCanvas ? traceCanvas.getContext('2d') : null;

  function setupCanvases() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (traceCanvas && tctx) {
      traceCanvas.width = Math.round(TW * dpr);
      traceCanvas.height = Math.round(TH * dpr);
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /* ---------------- colours ---------------- */
  const hexToRgb = h => {
    if (!h) return [136, 136, 136];
    h = h.trim();
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    if (isNaN(n)) return [136, 136, 136];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  let col = null;
  function readColours() {
    const cs = getComputedStyle(document.documentElement);
    const get = n => hexToRgb(cs.getPropertyValue(n) || '#888');
    col = {
      fg: get('--fg'),
      fg2: get('--fg-2'),
      fg3: get('--fg-3'),
      rule: get('--rule'),
      accent: get('--accent'),
      bg: get('--bg'),
      x: get('--x'),
      z: get('--z')
    };
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /* ---------------- truth layer ---------------- */
  const N = 121; // 1.5 mV resolution across the 180 mV span; rebuilt at most once per frame
  const truth = document.createElement('canvas');
  truth.width = N; truth.height = N;
  const truthCtx = truth.getContext('2d');
  let truthOffset = { d1: NaN, d2: NaN };
  let cellCentres = [];

  function buildTruth() {
    const img = truthCtx.createImageData(N, N);
    const g1 = new Int8Array(N * N), g2 = new Int8Array(N * N), S = new Float32Array(N * N);
    const centresMap = new Map();

    for (let j = 0; j < N; j++) {
      const V2 = p.vMin + (j / (N - 1)) * span;
      for (let i = 0; i < N; i++) {
        const V1 = p.vMin + (i / (N - 1)) * span;
        const o = device.truth(V1, V2);
        const k = j * N + i;
        g1[k] = o.g1; g2[k] = o.g2;
        S[k] = p.s1 * o.g1 + p.s2 * o.g2 + p.b * (V1 + V2);

        if (o.g1 <= 3 && o.g2 <= 3) {
          const key = `${o.g1},${o.g2}`;
          let c = centresMap.get(key);
          if (!c) { c = { sumV1: 0, sumV2: 0, count: 0, g1: o.g1, g2: o.g2 }; centresMap.set(key, c); }
          c.sumV1 += V1;
          c.sumV2 += V2;
          c.count++;
        }
      }
    }

    cellCentres = [];
    for (const c of centresMap.values()) {
      if (c.count >= 12) {
        cellCentres.push({ g1: c.g1, g2: c.g2, v1: c.sumV1 / c.count, v2: c.sumV2 / c.count });
      }
    }

    const [fr, fgc, fb] = col.fg;
    const [ar, ag, ab] = col.accent;

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const o = 4 * ((N - 1 - j) * N + i); // flip V2 upwards
        const edge = (i + 1 < N && (g1[k + 1] !== g1[k] || g2[k + 1] !== g2[k])) ||
                     (j + 1 < N && (g1[k + N] !== g1[k] || g2[k + N] !== g2[k]));

        if (edge) {
          img.data[o] = ar;
          img.data[o + 1] = ag;
          img.data[o + 2] = ab;
          img.data[o + 3] = 96; // transition lines: visible, but the measured trail must read brighter
        } else {
          const isTargetCell = (g1[k] === 1 && g2[k] === 1);
          if (isTargetCell) {
            img.data[o] = ar;
            img.data[o + 1] = ag;
            img.data[o + 2] = ab;
            img.data[o + 3] = 28; // warm tint inside (1,1)
          } else {
            const normS = Math.min(1, Math.max(0, S[k] / Smax));
            const a = 0.04 + 0.16 * normS;
            img.data[o] = fr;
            img.data[o + 1] = fgc;
            img.data[o + 2] = fb;
            img.data[o + 3] = Math.round(255 * a);
          }
        }
      }
    }
    truthCtx.putImageData(img, 0, 0);
    truthOffset = { d1: device.offset.d1, d2: device.offset.d2 };
  }

  function truthStale() {
    return Math.abs(device.offset.d1 - truthOffset.d1) > 0.4 ||
           Math.abs(device.offset.d2 - truthOffset.d2) > 0.4;
  }

  /* ---------------- measured layer ---------------- */
  const seen = document.createElement('canvas');
  seen.width = Math.round(pw * 2); seen.height = Math.round(ph * 2);
  const sctx = seen.getContext('2d');
  let paintedTotal = 0;

  function paintNew() {
    const fresh = Math.min(tuner.samples.length, tuner.measurements - paintedTotal);
    if (fresh > 0) paintSeen(tuner.samples.length - fresh);
    paintedTotal = tuner.measurements;
  }

  function paintSeen(fromIndex) {
    const s = tuner.samples;
    for (let i = fromIndex; i < s.length; i++) {
      const q = s[i];
      const normS = Math.max(0, Math.min(1, q.S / Smax));
      const a = 0.35 + 0.65 * normS;
      sctx.fillStyle = rgba(col.fg, a);
      const px = (X(q.V1) - M.l) * 2;
      const py = (Y(q.V2) - M.t) * 2;
      sctx.fillRect(px - 1.5, py - 1.5, 3, 3);
    }
  }

  function clearSeen() {
    sctx.clearRect(0, 0, seen.width, seen.height);
    paintedTotal = tuner.measurements;
  }

  /* ---------------- 1D sensor trace buffer ----------------
     One entry per measurement (not per frame), so the trace is the signal the
     detector saw. Edge markers sit on the measurement pair the detector
     confirmed (tuner.lastEdge), not on the frame the event was consumed. */
  const TRACE_MAX = 150;
  const traceSamples = []; // { S, m, edge: null | 'dot1' | 'dot2' }
  let traceRecorded = 0, lastEdgeSeen = null, lastStepFlash = 0;

  function recordMeasurements() {
    const total = tuner.measurements, win = tuner.samples;
    const fresh = Math.min(win.length, total - traceRecorded);
    for (let k = win.length - fresh; k < win.length; k++) {
      traceSamples.push({ S: win[k].S, m: total - (win.length - 1 - k), edge: null });
    }
    traceRecorded = total;
    while (traceSamples.length > TRACE_MAX) traceSamples.shift();
    const e = tuner.lastEdge;
    if (e && e !== lastEdgeSeen) {
      lastEdgeSeen = e;
      const hit = traceSamples.find(x => x.m === e.m);
      if (hit) hit.edge = e.dot;
      lastStepFlash = performance.now() + 1200;
      const ind = $('dqd-trace-step-indicator');
      if (ind) { ind.textContent = '⚡ Edge confirmed: ' + (e.dot === 'dot1' ? 'dot 1' : 'dot 2') + ' (Δ' + e.height.toFixed(2) + ')'; ind.classList.add('hit'); }
    }
  }
  function resetTrace() { traceSamples.length = 0; traceRecorded = tuner.measurements; lastEdgeSeen = tuner.lastEdge; }

  /* ---------------- draw 2D charge stability diagram ---------------- */
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Plot area clip
    ctx.save();
    ctx.beginPath();
    ctx.rect(M.l, M.t, pw, ph);
    ctx.clip();

    // Ground truth honeycomb
    ctx.drawImage(truth, M.l, M.t, pw, ph);

    // Charge cell labels
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of cellCentres) {
      const cx = X(c.v1), cy = Y(c.v2);
      if (cx < M.l + 16 || cx > M.l + pw - 16 || cy < M.t + 14 || cy > M.t + ph - 14) continue;
      const isTarget = (c.g1 === 1 && c.g2 === 1);
      if (isTarget) {
        ctx.fillStyle = rgba(col.accent, 0.14);
        ctx.fillRect(cx - 28, cy - 16, 56, 32);
        ctx.strokeStyle = rgba(col.accent, 0.55);
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - 28, cy - 16, 56, 32);

        ctx.fillStyle = rgba(col.accent, 1);
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText('(1, 1)', cx, cy - 5);
        ctx.font = '7.5px "JetBrains Mono", monospace';
        ctx.fillText('TARGET', cx, cy + 7);
      } else {
        ctx.fillStyle = rgba(col.fg3, 0.55);
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText(`(${c.g1}, ${c.g2})`, cx, cy);
      }
    }
    ctx.restore();

    // Measured samples (bright trail)
    ctx.drawImage(seen, M.l, M.t, pw, ph);

    // Recent tuner path
    const s = tuner.samples, n = s.length, from = Math.max(0, n - PATH_LEN);
    if (n - from > 1) {
      ctx.strokeStyle = rgba(col.accent, 0.65);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(X(s[from].V1), Y(s[from].V2));
      for (let i = from + 1; i < n; i++) ctx.lineTo(X(s[i].V1), Y(s[i].V2));
      ctx.stroke();
    }

    // Walls of (1,1) cell once measured by tuner
    if (tuner.walls) {
      const w = tuner.walls;
      ctx.strokeStyle = rgba(col.accent, 0.85);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(X(w.left), Y(w.up), X(w.right) - X(w.left), Y(w.down) - Y(w.up));
      ctx.setLineDash([]);
    }

    // Operating point crosshair & ring
    const opX = X(tuner.V1), opY = Y(tuner.V2);
    ctx.strokeStyle = rgba(col.accent, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(opX - 12, opY); ctx.lineTo(opX + 12, opY);
    ctx.moveTo(opX, opY - 12); ctx.lineTo(opX, opY + 12);
    ctx.stroke();

    ctx.strokeStyle = rgba(col.accent, 1);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(opX, opY, 6, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = rgba(col.fg, 1);
    ctx.beginPath();
    ctx.arc(opX, opY, 2, 0, 2 * Math.PI);
    ctx.fill();

    ctx.restore(); // end clip

    // Axes & grid frame
    ctx.strokeStyle = rgba(col.rule, 1);
    ctx.lineWidth = 1;
    ctx.strokeRect(M.l + 0.5, M.t + 0.5, pw - 1, ph - 1);

    ctx.fillStyle = rgba(col.fg3, 1);
    ctx.font = '9.5px "JetBrains Mono", monospace';

    // V1 ticks
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = Math.ceil(p.vMin / 20) * 20; v <= p.vMax; v += 20) {
      ctx.fillText(String(v), X(v), M.t + ph + 4);
      ctx.fillRect(X(v), M.t + ph, 1, 3);
    }

    // V2 ticks
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(p.vMin / 20) * 20; v <= p.vMax; v += 20) {
      ctx.fillText(String(v), M.l - 5, Y(v));
      ctx.fillRect(M.l - 3, Y(v), 3, 1);
    }

    // Axis titles
    ctx.fillStyle = rgba(col.fg2, 1);
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('Plunger Voltage V₁ (mV)', M.l + pw / 2, H - 2);

    ctx.save();
    ctx.translate(11, M.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'top';
    ctx.fillText('Plunger Voltage V₂ (mV)', 0, 0);
    ctx.restore();
  }

  /* ---------------- draw 1D sensor oscilloscope trace ---------------- */
  function drawTrace() {
    if (!traceCanvas || !tctx) return;
    tctx.clearRect(0, 0, TW, TH);

    // Background & baseline grid
    tctx.save();
    tctx.strokeStyle = rgba(col.rule, 0.85);
    tctx.lineWidth = 1;
    tctx.strokeRect(TM.l + 0.5, TM.t + 0.5, tpw - 1, tph - 1);

    // Autoscaled axis: the empty sweep starts high in the honeycomb, the lock sits near 1.6.
    let sMax = 2.2;
    for (const smp of traceSamples) if (smp.S > sMax) sMax = smp.S;
    sMax = Math.ceil(sMax * 1.08 * 2) / 2;
    const traceY = sVal => TM.t + tph - (sVal / sMax) * tph;
    tctx.setLineDash([3, 3]);
    tctx.strokeStyle = rgba(col.rule, 0.55);
    tctx.fillStyle = rgba(col.fg3, 0.8);
    tctx.font = '8px "JetBrains Mono", monospace';
    tctx.textAlign = 'right';
    tctx.textBaseline = 'middle';
    const tickStep = sMax > 4 ? 2 : 1;
    for (let lvl = 0; lvl <= sMax + 1e-9; lvl += tickStep) {
      const y = traceY(lvl);
      if (lvl > 0) { tctx.beginPath(); tctx.moveTo(TM.l, y); tctx.lineTo(TM.l + tpw, y); tctx.stroke(); }
      tctx.fillText(lvl.toFixed(1), TM.l - 4, y);
    }
    tctx.setLineDash([]);

    // Plot sensor trace
    const n = traceSamples.length;
    if (n > 1) {
      tctx.save();
      tctx.beginPath();
      tctx.rect(TM.l, TM.t, tpw, tph);
      tctx.clip();

      tctx.strokeStyle = rgba(col.accent, 0.9);
      tctx.lineWidth = 1.5;
      tctx.beginPath();

      for (let i = 0; i < n; i++) {
        const smp = traceSamples[i];
        const x = TM.l + (i / (TRACE_MAX - 1)) * tpw;
        const y = Math.max(TM.t + 2, Math.min(TM.t + tph - 2, traceY(smp.S)));
        if (i === 0) tctx.moveTo(x, y);
        else tctx.lineTo(x, y);
      }
      tctx.stroke();

      // Change-point edge markers, on the measurement pair the detector confirmed
      for (let i = 0; i < n; i++) {
        const smp = traceSamples[i];
        if (smp.edge) {
          const x = TM.l + ((i + 0.5) / (TRACE_MAX - 1)) * tpw;
          tctx.strokeStyle = rgba(col.accent, 1);
          tctx.setLineDash([2, 2]);
          tctx.beginPath();
          tctx.moveTo(x, TM.t);
          tctx.lineTo(x, TM.t + tph);
          tctx.stroke();
          tctx.setLineDash([]);

          tctx.fillStyle = rgba(col.accent, 1);
          tctx.font = 'bold 7.5px "JetBrains Mono", monospace';
          tctx.textAlign = 'center';
          tctx.fillText(smp.edge === 'dot1' ? '▲ DOT 1' : '▲ DOT 2', x, TM.t + 9);
        }
      }

      // Live head dot
      const lastSmp = traceSamples[n - 1];
      const headX = TM.l + ((n - 1) / (TRACE_MAX - 1)) * tpw;
      const headY = Math.max(TM.t + 2, Math.min(TM.t + tph - 2, traceY(lastSmp.S)));
      tctx.fillStyle = rgba(col.accent, 1);
      tctx.beginPath();
      tctx.arc(headX, headY, 3, 0, 2 * Math.PI);
      tctx.fill();

      tctx.restore();
    }

    tctx.restore();
  }

  /* ---------------- UI status & readouts ---------------- */
  const STATUS_DESCS = {
    calibrate: 'Calibrating charge sensor baseline and measuring noise floor (σ)...',
    empty: 'Step 1: Sweeping gate voltages (V₁, V₂) down to empty both dots → Target: (0, 0)',
    load1: 'Step 2: Sweeping V₁ plunger up until sensor detects 1st electron entering Dot 1 → Target: (1, 0)',
    load2: 'Step 3: Sweeping V₂ plunger up until sensor detects 1st electron entering Dot 2 → Target: (1, 1)',
    centre: 'Step 4: Probing in 4 directions to map cell walls and locate geometric center of (1, 1)',
    settle: 'Verifying sensor stability at operating point...',
    locked: '✓ Step 5: Locked at (1, 1) single-electron qubit operating point · Monitoring for charge noise',
    check: 'Periodic drift check: Probing ±6 mV to confirm cell walls haven’t crept close...'
  };

  const STEP_INDEX = {
    empty: 1,
    load1: 2,
    load2: 3,
    centre: 4,
    settle: 5,
    locked: 5,
    check: 5
  };

  let flareText = '', flareUntil = 0;
  function flare(text, duration = 1500) {
    flareText = text;
    flareUntil = performance.now() + duration;
    updateReadout();
  }

  function updateReadout() {
    if ($('dqd-v1')) $('dqd-v1').textContent = tuner.V1.toFixed(1);
    if ($('dqd-v2')) $('dqd-v2').textContent = tuner.V2.toFixed(1);
    if ($('dqd-n')) $('dqd-n').textContent = `(${tuner.N1 ?? '?'}, ${tuner.N2 ?? '?'})`;
    if ($('dqd-retunes')) $('dqd-retunes').textContent = tuner.retunes;
    if ($('dqd-recentres')) $('dqd-recentres').textContent = tuner.recentres;
    if ($('dqd-offset')) {
      const d1 = device.offset.d1 >= 0 ? `+${device.offset.d1.toFixed(1)}` : device.offset.d1.toFixed(1);
      const d2 = device.offset.d2 >= 0 ? `+${device.offset.d2.toFixed(1)}` : device.offset.d2.toFixed(1);
      $('dqd-offset').textContent = `${d1}, ${d2}`;
    }

    const curS = tuner.samples.length ? tuner.samples[tuner.samples.length - 1].S : device.measure(tuner.V1, tuner.V2);
    if ($('dqd-sensor')) $('dqd-sensor').textContent = curS.toFixed(2);

    // Status description banner
    const descEl = $('dqd-status-desc');
    if (descEl) {
      const isFlaring = performance.now() < flareUntil;
      if (isFlaring) {
        descEl.textContent = flareText;
        descEl.classList.add('flaring');
      } else {
        descEl.textContent = STATUS_DESCS[tuner.state] || tuner.state;
        descEl.classList.remove('flaring');
      }
    }

    // Step indicators
    const curIdx = STEP_INDEX[tuner.state] || 1;
    const stepIds = ['step-empty', 'step-load1', 'step-load2', 'step-centre', 'step-locked'];
    stepIds.forEach((id, idx) => {
      const el = $(id);
      if (!el) return;
      const num = idx + 1;
      if (num < curIdx) {
        el.classList.add('completed');
        el.classList.remove('active');
      } else if (num === curIdx) {
        el.classList.remove('completed');
        el.classList.add('active');
      } else {
        el.classList.remove('completed', 'active');
      }
    });

    // Trace indicator timeout
    if (performance.now() > lastStepFlash) {
      const ind = $('dqd-trace-step-indicator');
      if (ind && ind.classList.contains('hit')) {
        ind.textContent = 'detector: monitoring';
        ind.classList.remove('hit');
      }
    }
  }

  function consumeEvents() {
    let lastStepEvent = null;
    while (tuner.events.length) {
      const e = tuner.events.shift();
      if (e.startsWith('step:')) lastStepEvent = e;
      else if (e === 'drift') {
        flare('⚡ Electrostatic drift detected! Charge shifted — initiating autonomous re-tuning...', 2200);
        clearSeen();
      } else if (e === 'wall-near') {
        flare('⚠️ Cell wall crept within 6 mV — re-centring operating point...', 2000);
      } else if (e === 'lost') {
        flare('⚠️ Operating point lost — re-starting search from empty...', 2000);
        clearSeen();
      } else if (e === 'locked') {
        flare('✓ Successfully locked into (1, 1) single-electron target state!', 1800);
      }
    }
    return lastStepEvent;
  }

  /* ---------------- driver loop ---------------- */
  let hasAutoStarted = false;
  let running = false;
  let raf = 0;
  let poll = 0;
  let last = 0;
  let carry = 0;

  const onScreen = () => {
    const r = canvas.getBoundingClientRect();
    return r.width > 0 && r.bottom > 10 && r.top < window.innerHeight - 10;
  };

  function startTuning() {
    if (reducedMQ.matches) return;
    if (!running) {
      running = true;
      last = 0;
      if (!raf) raf = requestAnimationFrame(frame);
    }
  }

  function frame(t) {
    raf = 0;
    if (!running) return;
    if (!onScreen()) {
      running = false;
      poll = setTimeout(checkAutoStart, 250);
      return;
    }

    if (!last || t < last) last = t;
    const dt = Math.max(0, Math.min(0.1, (t - last) / 1000 || 0));
    last = t;
    device.drift(dt);

    carry += RATE * dt;
    let steps = Math.min(MAX_STEPS, Math.floor(carry));
    carry -= steps;

    while (steps-- > 0) { tuner.step(); consumeEvents(); }
    recordMeasurements();

    paintNew();
    if (truthStale()) buildTruth();
    draw();
    drawTrace();
    updateReadout();

    raf = requestAnimationFrame(frame);
  }

  function checkAutoStart() {
    clearTimeout(poll);
    poll = 0;
    if (reducedMQ.matches) return;
    if (document.hidden) {
      poll = setTimeout(checkAutoStart, 500);
      return;
    }

    if (onScreen()) {
      if (!hasAutoStarted) {
        hasAutoStarted = true;
        tuner.reset({ V1: 85 + 40 * Math.random(), V2: 90 + 40 * Math.random() });
        clearSeen();
        resetTrace();
        flare('Auto-tuner activated: sweeping gate voltages to find empty (0,0)...', 2000);
      }
      startTuning();
    } else {
      poll = setTimeout(checkAutoStart, 250);
    }
  }

  /* ---------------- drag to inject drift ---------------- */
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (reducedMQ.matches) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    drag = { x: e.clientX, y: e.clientY };
    canvas.classList.add('grabbing');
  });

  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    const k = (r.width / W) * pxPerMV;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };

    if (isFinite(dx) && isFinite(dy) && k > 0) {
      device.nudge(-dx / k, dy / k);          // the frame loop rebuilds the truth layer when it is stale
      hasAutoStarted = true;
      startTuning();
      if (!running) { buildTruth(); draw(); updateReadout(); }
    }
  });

  const endDrag = () => {
    drag = null;
    canvas.classList.remove('grabbing');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* ---------------- interactive controls ---------------- */
  const resetBtn = $('dqd-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      hasAutoStarted = true;
      const startV1 = 85 + 40 * Math.random();
      const startV2 = 90 + 40 * Math.random();
      tuner.reset({ V1: startV1, V2: startV2 });
      clearSeen();
      resetTrace();
      flare('↺ Restarting auto-tuner search pipeline from arbitrary voltages...', 2000);
      startTuning();
      draw();
      drawTrace();
      updateReadout();
    });
  }

  const driftBtn = $('dqd-drift-btn');
  if (driftBtn) {
    driftBtn.addEventListener('click', () => {
      hasAutoStarted = true;
      // Nudge by 18 - 26 mV in random direction to reliably challenge the operating point
      const d1 = (Math.random() > 0.5 ? 1 : -1) * (18 + 8 * Math.random());
      const d2 = (Math.random() > 0.5 ? 1 : -1) * (18 + 8 * Math.random());
      device.nudge(d1, d2);
      flare(`⚡ Electrostatic noise injected! Offset shifted by (${d1.toFixed(1)}, ${d2.toFixed(1)}) mV. Tuner recovering...`, 2500);
      startTuning();
      draw();
      updateReadout();
    });
  }

  const speedBtn = $('dqd-speed-btn');
  if (speedBtn) {
    speedBtn.addEventListener('click', () => {
      speedIdx = (speedIdx + 1) % SPEEDS.length;
      RATE = SPEEDS[speedIdx].rate;
      speedBtn.textContent = SPEEDS[speedIdx].label;
    });
  }

  /* ---------------- boot ---------------- */
  readColours();
  setupCanvases();
  buildTruth();

  new MutationObserver(() => {
    readColours();
    buildTruth();
    sctx.clearRect(0, 0, seen.width, seen.height);
    paintSeen(0);
    paintedTotal = tuner.measurements;
    draw();
    drawTrace();
    updateReadout();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  if (reducedMQ.matches) {
    while (tuner.state !== 'locked' && tuner.measurements < 2500) tuner.step();
    tuner.events.length = 0;
    paintNew();
    recordMeasurements();
    draw();
    drawTrace();
    updateReadout();
    canvas.style.cursor = 'default';
  } else {
    draw();
    drawTrace();
    updateReadout();

    // IntersectionObserver to auto-start when user reaches the section
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            checkAutoStart();
          } else {
            running = false;
          }
        });
      }, { threshold: 0.15 });
      io.observe(canvas);
    }

    document.addEventListener('visibilitychange', checkAutoStart);
    window.addEventListener('scroll', () => { if (!running) checkAutoStart(); }, { passive: true });
    window.addEventListener('resize', () => { setupCanvases(); buildTruth(); draw(); drawTrace(); });
  }

  // Debug & verification handle
  window.__tuner = {
    tuner,
    device,
    draw,
    drawTrace,
    isRunning: () => running,
    bootVisibility: document.visibilityState,
    trace: () => traceSamples.map(x => ({ m: x.m, S: +x.S.toFixed(3), edge: x.edge })),
    advance(n) {
      for (let i = 0; i < n; i++) { tuner.step(); consumeEvents(); }
      paintNew();
      recordMeasurements();
      if (truthStale()) buildTruth();
      draw();
      drawTrace();
      updateReadout();
    }
  };
})();
