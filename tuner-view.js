/* tuner-view.js — D: renders the double-dot auto-tuner from dqd.js onto
   canvas#dqd and drives it at a fixed measurement rate.

   Layers, back to front: the model's true sensor signal (faint; the tuner
   never sees it), the true charge-transition lines (faint), everything the
   tuner has actually measured (bright pixels), its recent path, the walls of
   the (1,1) cell once found, and the current operating point. */
(() => {
  'use strict';

  const RATE = 150;               // measurements per second
  const MAX_STEPS = 24;           // per frame, so a stalled tab does not jump
  const GRID_MV = 1.5;            // resolution of the truth map, mV
  const PATH_LEN = 600;           // samples of path to draw
  const canvas = document.getElementById('dqd');
  if (!canvas || !window.DQD) return;
  const DQD = window.DQD, $ = id => document.getElementById(id);

  const p = DQD.defaultParams();
  const device = DQD.createDevice(p, Math.random);
  const tuner = DQD.createTuner(device, { start: { V1: 80 + 50 * Math.random(), V2: 80 + 50 * Math.random() } });
  const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------- geometry ---------------- */
  const W = 480, H = 480, M = { l: 40, r: 10, t: 10, b: 34 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b, span = p.vMax - p.vMin;
  const X = v => M.l + (v - p.vMin) / span * pw;
  const Y = v => M.t + ph - (v - p.vMin) / span * ph;
  const pxPerMV = pw / span;
  const Smax = p.s1 * 5 + p.s2 * 5 + p.b * 2 * p.vMax;

  let dpr = 1, ctx = canvas.getContext('2d');
  function setupCanvas() {
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- colours ---------------- */
  const hexToRgb = h => {
    h = h.trim(); if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  let col = null;
  function readColours() {
    const cs = getComputedStyle(document.documentElement);
    const get = n => hexToRgb(cs.getPropertyValue(n) || '#888');
    col = { fg: get('--fg'), fg2: get('--fg-2'), fg3: get('--fg-3'), rule: get('--rule'), accent: get('--accent'), bg: get('--bg'), x: get('--x'), z: get('--z') };
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /* ---------------- truth layer (recomputed when the honeycomb moves) ---------------- */
  const truth = document.createElement('canvas');
  const N = Math.ceil(span / GRID_MV) + 1;
  truth.width = N; truth.height = N;
  const tctx = truth.getContext('2d');
  let truthOffset = { d1: NaN, d2: NaN }, truthTimer = 0;
  function buildTruth() {
    const img = tctx.createImageData(N, N);
    const g1 = new Int8Array(N * N), g2 = new Int8Array(N * N), S = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const V1 = p.vMin + i * GRID_MV, V2 = p.vMin + j * GRID_MV;
      const o = device.truth(V1, V2), k = j * N + i;
      g1[k] = o.g1; g2[k] = o.g2;
      S[k] = p.s1 * o.g1 + p.s2 * o.g2 + p.b * (V1 + V2);
    }
    const [fr, fgc, fb] = col.fg, [ar, ag, ab] = col.accent;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, o = 4 * ((N - 1 - j) * N + i);       // flip: V2 up = canvas up
      const edge = (i + 1 < N && (g1[k + 1] !== g1[k] || g2[k + 1] !== g2[k])) ||
                   (j + 1 < N && (g1[k + N] !== g1[k] || g2[k + N] !== g2[k]));
      const a = 0.05 + 0.16 * Math.min(1, S[k] / Smax);
      img.data[o] = fr; img.data[o + 1] = fgc; img.data[o + 2] = fb; img.data[o + 3] = Math.round(255 * a);
      if (edge) { img.data[o] = ar; img.data[o + 1] = ag; img.data[o + 2] = ab; img.data[o + 3] = Math.round(255 * 0.38); }
    }
    tctx.putImageData(img, 0, 0);
    truthOffset = { d1: device.offset.d1, d2: device.offset.d2 };
  }
  function truthStale() { return Math.abs(device.offset.d1 - truthOffset.d1) > 0.5 || Math.abs(device.offset.d2 - truthOffset.d2) > 0.5; }

  /* ---------------- measured layer (what the tuner has actually seen) ---------------- */
  const seen = document.createElement('canvas');
  seen.width = Math.round(pw * 2); seen.height = Math.round(ph * 2);
  const sctx = seen.getContext('2d');
  let paintedTotal = 0;   // tuner.measurements is monotonic; samples is a rolling window of the last 4000
  function paintNew() {
    const fresh = Math.min(tuner.samples.length, tuner.measurements - paintedTotal);
    if (fresh > 0) paintSeen(tuner.samples.length - fresh);
    paintedTotal = tuner.measurements;
  }
  function paintSeen(fromIndex) {
    const s = tuner.samples;
    for (let i = fromIndex; i < s.length; i++) {
      const q = s[i], a = 0.25 + 0.75 * Math.max(0, Math.min(1, q.S / Smax));
      sctx.fillStyle = rgba(col.fg, a);
      sctx.fillRect((X(q.V1) - M.l) * 2 - 1.5, (Y(q.V2) - M.t) * 2 - 1.5, 3, 3);
    }
  }
  function clearSeen() { sctx.clearRect(0, 0, seen.width, seen.height); paintedTotal = tuner.measurements; }

  /* ---------------- draw ---------------- */
  const VERB = { calibrate: 'calibrating', empty: 'emptying the dots', load1: 'loading dot 1', load2: 'loading dot 2', centre: 'centring in (1,1)', settle: 'settling', locked: 'locked (1,1)', check: 'probing for drift' };
  let flareUntil = 0, flareText = '';
  function draw() {
    ctx.clearRect(0, 0, W, H);
    // plot area
    ctx.save(); ctx.beginPath(); ctx.rect(M.l, M.t, pw, ph); ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(truth, M.l, M.t, pw, ph);
    ctx.drawImage(seen, M.l, M.t, pw, ph);
    // path
    const s = tuner.samples, n = s.length, from = Math.max(0, n - PATH_LEN);
    if (n - from > 1) {
      ctx.strokeStyle = rgba(col.fg3, 0.55); ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(X(s[from].V1), Y(s[from].V2));
      for (let i = from + 1; i < n; i++) ctx.lineTo(X(s[i].V1), Y(s[i].V2));
      ctx.stroke();
    }
    // walls of the (1,1) cell
    if (tuner.walls) {
      const w = tuner.walls;
      ctx.strokeStyle = rgba(col.accent, 0.7); ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.strokeRect(X(w.left), Y(w.up), X(w.right) - X(w.left), Y(w.down) - Y(w.up));
      ctx.setLineDash([]);
    }
    // operating point
    ctx.strokeStyle = rgba(col.accent, 1); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(tuner.V1), Y(tuner.V2), 5, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = rgba(col.accent, 0.9);
    ctx.beginPath(); ctx.arc(X(tuner.V1), Y(tuner.V2), 1.5, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
    // axes
    ctx.strokeStyle = rgba(col.rule, 1); ctx.lineWidth = 1;
    ctx.strokeRect(M.l + 0.5, M.t + 0.5, pw - 1, ph - 1);
    ctx.fillStyle = rgba(col.fg3, 1); ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = Math.ceil(p.vMin / 20) * 20; v <= p.vMax; v += 20) {
      ctx.fillText(String(v), X(v), M.t + ph + 4);
      ctx.fillRect(X(v), M.t + ph, 1, 2);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(p.vMin / 20) * 20; v <= p.vMax; v += 20) {
      ctx.fillText(String(v), M.l - 5, Y(v));
      ctx.fillRect(M.l - 2, Y(v), 2, 1);
    }
    ctx.fillStyle = rgba(col.fg2, 1); ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('V₁ (mV)', M.l + pw / 2, H - 2);
    ctx.save(); ctx.translate(9, M.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top'; ctx.fillText('V₂ (mV)', 0, 0); ctx.restore();
  }
  function updateReadout() {
    $('dqd-v1').textContent = tuner.V1.toFixed(1);
    $('dqd-v2').textContent = tuner.V2.toFixed(1);
    const st = $('dqd-state');
    const flaring = performance.now() < flareUntil;
    st.textContent = flaring ? flareText : (VERB[tuner.state] || tuner.state);
    st.style.color = flaring ? rgba(col.accent, 1) : '';
    $('dqd-n').textContent = `(${tuner.N1 ?? '?'}, ${tuner.N2 ?? '?'})`;
    $('dqd-retunes').textContent = tuner.retunes;
    $('dqd-recentres').textContent = tuner.recentres;
  }
  function consumeEvents() {
    while (tuner.events.length) {
      const e = tuner.events.shift();
      if (e === 'drift') { flareText = 'drift — re-tuning'; flareUntil = performance.now() + 1200; clearSeen(); }
      else if (e === 'wall-near') { flareText = 'wall near — re-centring'; flareUntil = performance.now() + 1200; }
      else if (e === 'lost') { flareText = 'lost — restarting'; flareUntil = performance.now() + 1200; clearSeen(); }
      else if (e === 'locked') { flareText = 'locked (1,1)'; flareUntil = performance.now() + 600; }
    }
  }

  /* ---------------- driver ----------------
     A frame loop while the canvas is on screen; a slow poll while it is not.
     The on-screen test is a bounding-rect check rather than an
     IntersectionObserver, which proved unreliable after programmatic scrolls. */
  let running = false, raf = 0, poll = 0, last = 0, carry = 0;
  const onScreen = () => { const r = canvas.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };
  function loop() {
    clearTimeout(poll); poll = 0;
    if (reducedMQ.matches) { running = false; return; }
    // Keep polling while hidden or off-screen: some hosts never fire visibilitychange.
    if (document.hidden || !onScreen()) { running = false; poll = setTimeout(loop, document.hidden ? 500 : 250); return; }
    if (!running) { running = true; last = performance.now(); }
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame(t) {
    raf = 0;
    if (!running) return;
    if (!onScreen()) { running = false; poll = setTimeout(loop, 250); return; }
    const dt = Math.min(0.25, (t - last) / 1000 || 0); last = t;
    device.drift(dt);
    carry += RATE * dt;
    let steps = Math.min(MAX_STEPS, Math.floor(carry)); carry -= steps;
    while (steps-- > 0) tuner.step();
    paintNew();
    consumeEvents();
    if (truthStale() && !truthTimer) truthTimer = setTimeout(() => { truthTimer = 0; buildTruth(); }, 120);
    draw(); updateReadout();
    raf = requestAnimationFrame(frame);
  }

  /* ---------------- drag = charge noise ---------------- */
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (reducedMQ.matches) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events have no pointer to capture */ }
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect(), k = (r.width / W) * pxPerMV;   // CSS px per mV
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
    // Dragging the honeycomb right means transitions occur at higher applied V1: the offset falls.
    device.nudge(-dx / k, dy / k);
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

  /* ---------------- boot ---------------- */
  readColours(); setupCanvas(); buildTruth();
  new MutationObserver(() => { readColours(); buildTruth(); sctx.clearRect(0, 0, seen.width, seen.height); paintSeen(0); paintedTotal = tuner.measurements; draw(); updateReadout(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (reducedMQ.matches) {
    while (tuner.state !== 'locked' && tuner.measurements < 2500) tuner.step();
    tuner.events.length = 0; paintNew(); draw(); updateReadout();
    canvas.style.cursor = 'default';
  } else {
    draw(); updateReadout();
    loop();
    document.addEventListener('visibilitychange', loop);
    addEventListener('scroll', () => { if (!running) loop(); }, { passive: true });
  }
  // Debug handle: advance(n) steps the tuner synchronously (used for verification in hidden panes).
  window.__tuner = {
    tuner, device, draw, isRunning: () => running, bootVisibility: document.visibilityState,
    advance(n) { for (let i = 0; i < n; i++) tuner.step(); paintNew(); consumeEvents(); if (truthStale()) buildTruth(); draw(); updateReadout(); }
  };
})();
