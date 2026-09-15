/* fabric.js — E: one logical qubit that zooms out, on scroll, into a
   lattice-surgery fabric. Every patch is a distance-d rotated surface code
   with its own engine session, decoded by the real MWPM in the wasm. Merges
   between patches are illustrated, not simulated.

   Pure geometry lives in fabric-math.js; sessions come from sessions.js;
   poisson / gaussianRate / chainsFromCorrection from hero-math.js. */
(() => {
  'use strict';

  const C = {
    CELL: 56, CELL_TABLET: 48, CELL_PHONE: 44,        // hero cell size, px
    D: 27, D_TABLET: 21, D_PHONE: 15,                  // code distance per breakpoint
    COLS: 5, ROWS: 3, COLS_PHONE: 3, GAP: 6,           // fabric grid; gap in cells
    AMBIENT: 0.6,                                      // errors / s / patch
    CURSOR_PEAK: 8, CURSOR_SIGMA: 1.1,                 // errors / s / qubit at the pointer; cells
    PAULI: [['X', .45], ['Z', .45], ['Y', .10]],       // ambient noise: depolarising
    CURSOR_PAULI: [['X', .80], ['Z', .15], ['Y', .05]], // pointer noise: bit-flip biased, so a sweep can build a chain
    MAX_PENDING: 120,
    ROUND_HERO: 1100, ROUND_OTHER: 1500, TICK: 50,     // ms; hero rounds are long enough for one sweep to land in one round
    MERGE_EVERY: 4000, MERGE_IN: 500, MERGE_HOLD: 2200,
    T_ERR: 180, T_DEF: 220, T_CHAIN: 350, T_HOLD: 250, T_FADE: 300, T_FLASH: 650, T_FADEIN: 600,
    SPRITE_CELL: 24, DIRECT_MIN_CELL: 18,              // sprite resolution; direct-draw threshold
    HEAT_ALPHA: 0.06
  };

  const canvas = document.getElementById('fabric');
  const hero = document.querySelector('.ex-hero');
  const win = document.querySelector('.ex-window');
  if (!canvas || !hero || !window.QEC || !window.QECSessions || !window.FabricMath || !window.HeroMath) return;
  const FM = window.FabricMath, HM = window.HeroMath;
  const ctx = canvas.getContext('2d');
  const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const params = new URLSearchParams(location.search);
  const $ = id => document.getElementById(id);

  const S = {
    engine: null, L: null, patches: [], geom: null, pairs: [],
    cellMax: C.CELL, cellMin: 10, cell: C.CELL, p: 0,
    colours: null, sprite: null, dpr: 1, W: 0, H: 0,
    dirty: true, raf: 0, animUntil: 0, liveAnims: 0, frames: 0, running: false, readyAt: 0,
    pointer: { x: 0, y: 0, t: -Infinity }, merge: null, nextMerge: 0, tickTimer: 0, lastTick: 0,
    forceReduced: false, static: false
  };
  const reduced = () => S.forceReduced || reducedMQ.matches;
  const now = () => performance.now();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------------- colours ---------------- */
  const hexToRgb = h => {
    h = h.trim(); if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  function readColours() {
    const cs = getComputedStyle(document.documentElement);
    const get = n => hexToRgb(cs.getPropertyValue(n) || '#888');
    S.colours = { x: get('--x'), z: get('--z'), y: get('--y'), accent: get('--accent'), bg: get('--bg'), fg: get('--fg'), fg3: get('--fg-3'), rule: get('--rule') };
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /* ---------------- geometry helpers ---------------- */
  function pickConfig() {
    const w = innerWidth;
    if (w < 760) return { cell: C.CELL_PHONE, d: C.D_PHONE, cols: C.COLS_PHONE, rows: C.ROWS };
    if (w < 1100) return { cell: C.CELL_TABLET, d: C.D_TABLET, cols: C.COLS, rows: C.ROWS };
    return { cell: C.CELL, d: C.D, cols: C.COLS, rows: C.ROWS };
  }
  const cameraNow = () => FM.camera({ viewW: S.W, viewH: S.H, cell: S.cell, centre: S.L.centre });
  const isHero = i => i === S.L.heroIndex;
  function patchRect(P, cam) {
    const [sx, sy] = cam.toScreen(P.x0, P.y0);
    const size = S.L.patchSpan * cam.cell / 2;
    return { sx, sy, size, visible: !(sx + size < 0 || sy + size < 0 || sx > S.W || sy > S.H) };
  }

  /* ---------------- static layer ---------------- */
  // Draws tiles, grid and qubit dots for one patch; unit = px per world unit, (ox, oy) = patch origin in px.
  function drawStaticPatch(g, geom, unit, ox, oy, d) {
    const k = clamp(unit / 28, 0.35, 1.2);
    const span = 2 * d;
    const col = S.colours;
    for (const st of geom.stabs) {
      const cx = ox + st.x * unit, cy = oy + st.y * unit;
      g.fillStyle = rgba(st.type === 'Z' ? col.z : col.x, 0.075);
      if (st.x > 0 && st.x < span && st.y > 0 && st.y < span) {
        g.fillRect(cx - unit, cy - unit, 2 * unit, 2 * unit);
      } else {
        g.beginPath();
        if (st.x === 0) g.arc(cx, cy, unit, -Math.PI / 2, Math.PI / 2);
        else if (st.x === span) g.arc(cx, cy, unit, Math.PI / 2, 3 * Math.PI / 2);
        else if (st.y === 0) g.arc(cx, cy, unit, 0, Math.PI);
        else g.arc(cx, cy, unit, Math.PI, 2 * Math.PI);
        g.closePath(); g.fill();
      }
    }
    g.strokeStyle = rgba(col.rule, 0.5); g.lineWidth = Math.max(0.5, k);
    g.beginPath();
    for (let i = 0; i < d; i++) {
      const v = (2 * i + 1) * unit;
      g.moveTo(ox + v, oy + unit); g.lineTo(ox + v, oy + (span - 1) * unit);
      g.moveTo(ox + unit, oy + v); g.lineTo(ox + (span - 1) * unit, oy + v);
    }
    g.stroke();
    g.fillStyle = rgba(col.fg3, 0.45);
    const r = Math.max(0.8, 3 * k);
    for (const q of geom.qubits) { g.beginPath(); g.arc(ox + q.x * unit, oy + q.y * unit, r, 0, 2 * Math.PI); g.fill(); }
  }

  function buildSprite() {
    if (!S.geom) return;
    const d = S.L.d, unit = C.SPRITE_CELL / 2, size = d * C.SPRITE_CELL;
    const off = document.createElement('canvas');
    off.width = Math.round(size * S.dpr); off.height = Math.round(size * S.dpr);
    const g = off.getContext('2d'); g.scale(S.dpr, S.dpr);
    drawStaticPatch(g, S.geom, unit, 0, 0, d);
    S.sprite = off;
  }

  /* ---------------- sessions ---------------- */
  function makeSessions() {
    for (const P of S.patches) P.s.free();
    const exp = S.engine.rawExports, d = S.L.d;
    S.patches = S.L.patches.map((q, i) => ({
      ...q, s: window.QECSessions.create(exp, d),
      pending: [], lit: new Map(), anim: null, frozen: null, flashAt: -Infinity,
      rounds: 0, phys: 0, logical: 0,
      nextRound: now() + (isHero(i) ? C.ROUND_HERO : C.ROUND_OTHER) * (0.3 + Math.random())
    }));
    S.geom = { qubits: S.patches[0].s.qubits, stabs: S.patches[0].s.stabs };
    S.pairs = FM.neighbours(S.L);
    document.querySelectorAll('#ex-d, .ex-d').forEach(el => { el.textContent = d; });
    updateReadout(S.patches[S.L.heroIndex]);
  }

  /* ---------------- sizing / scroll ---------------- */
  function resize() {
    S.W = innerWidth; S.H = innerHeight; S.dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(S.W * S.dpr); canvas.height = Math.round(S.H * S.dpr);
    const cfg = pickConfig();
    const dChanged = !S.L || S.L.d !== cfg.d || S.L.cols !== cfg.cols;
    S.L = FM.layout({ d: cfg.d, cols: cfg.cols, rows: cfg.rows, gap: C.GAP });
    // The hero patch must cover the viewport's longer axis, as in A+.
    const cellPx = Math.max(cfg.cell, Math.max(S.W, hero.offsetHeight || S.H) / (cfg.d - 1));
    ({ cellMax: S.cellMax, cellMin: S.cellMin } = FM.scaleFor({ viewW: S.W, viewH: S.H, cellPx, layout: S.L }));
    if (S.engine && dChanged) { makeSessions(); if (reduced()) composeFrozen(); }
    buildSprite();
    onScroll();
  }
  function onScroll() {
    S.p = clamp(scrollY / Math.max(1, hero.offsetHeight), 0, 1);
    S.cell = FM.cellAt(S.p, S.cellMax, S.cellMin);
    S.dirty = true; requestFrame();
  }

  /* ---------------- noise ---------------- */
  const pickPauli = (mix = C.PAULI) => { let r = Math.random(); for (const [p, w] of mix) { if ((r -= w) <= 0) return p; } return 'X'; };
  function inject(P, q, t, mix) {
    if (P.pending.length >= C.MAX_PENDING) return 0;
    const pauli = pickPauli(mix);
    P.s.toggle(q, pauli); P.pending.push({ q, pauli, t0: t });
    return 1;
  }
  function injectRandom(P, k, t) { let n = 0; for (let i = 0; i < k; i++) n += inject(P, Math.floor(Math.random() * P.s.numQubits), t); return n; }
  function injectCursor(P, lx, ly, dt, t) {
    const lim = 3 * C.CURSOR_SIGMA, zoom = S.cell / S.cellMax; let n = 0;
    const qs = P.s.qubits;
    for (let i = 0; i < qs.length; i++) {
      const dist = Math.hypot((qs[i].x - lx) / 2, (qs[i].y - ly) / 2);
      if (dist > lim) continue;
      const k = HM.poisson(HM.gaussianRate(dist, C.CURSOR_SIGMA, C.CURSOR_PEAK) * dt * zoom);
      for (let j = 0; j < k; j++) n += inject(P, i, t, C.CURSOR_PAULI);
    }
    return n;
  }
  function refreshSyndrome(P, t) {
    const syn = P.s.syndrome();
    for (let i = 0; i < syn.length; i++) {
      if (syn[i]) { if (!P.lit.has(i)) P.lit.set(i, t); }
      else if (P.lit.has(i)) P.lit.delete(i);
    }
  }

  /* ---------------- rounds ---------------- */
  function round(P, i, t, cam) {
    P.rounds++;
    if (P.pending.length) {
      const { logical, cx, cz } = P.s.decode();
      const chains = HM.chainsFromCorrection(P.s, cx, cz);
      P.s.clear();
      P.logical += logical;
      P.anim = { t0: t, chains, errors: P.pending, lit: [...P.lit.keys()], logical };
      P.pending = []; P.lit = new Map();
      if (logical) P.flashAt = t;
      if (patchRect(P, cam).visible) S.animUntil = Math.max(S.animUntil, t + C.T_CHAIN + C.T_HOLD + C.T_FADE + (logical ? C.T_FLASH : 0));
      S.dirty = true;
      if (isHero(i) && logical) { const b = $('ex-logical'); b.classList.add('flare'); setTimeout(() => b.classList.remove('flare'), C.T_FLASH); }
    }
    if (isHero(i)) updateReadout(P);
    P.nextRound = t + (isHero(i) ? C.ROUND_HERO : C.ROUND_OTHER) * (0.85 + 0.3 * Math.random());
  }
  function updateReadout(P) {
    $('ex-rounds').textContent = P.rounds.toLocaleString();
    $('ex-phys').textContent = P.phys.toLocaleString();
    $('ex-logical').textContent = P.logical.toLocaleString();
  }

  /* ---------------- merges (illustrated) ---------------- */
  function startMerge(t) {
    if (!S.pairs.length) return;
    const [a, b] = S.pairs[Math.floor(Math.random() * S.pairs.length)];
    S.merge = { a, b, t0: t };
    S.nextMerge = t + C.MERGE_EVERY * (0.8 + 0.4 * Math.random()) + 2 * C.MERGE_IN + C.MERGE_HOLD;
    S.animUntil = Math.max(S.animUntil, t + 2 * C.MERGE_IN + C.MERGE_HOLD);
  }
  function mergePhase(t) {
    if (!S.merge) return 0;
    const dt = t - S.merge.t0;
    if (dt < C.MERGE_IN) return dt / C.MERGE_IN;
    if (dt < C.MERGE_IN + C.MERGE_HOLD) return 1;
    if (dt < 2 * C.MERGE_IN + C.MERGE_HOLD) return 1 - (dt - C.MERGE_IN - C.MERGE_HOLD) / C.MERGE_IN;
    S.merge = null; return 0;
  }

  /* ---------------- scheduler ---------------- */
  function tick() {
    if (!S.running) return;
    const t = now(), dt = Math.min(0.2, (t - S.lastTick) / 1000); S.lastTick = t;
    const cam = cameraNow();
    let hot = -1, wx = 0, wy = 0;
    if (t - S.pointer.t < 400) { [wx, wy] = cam.toWorld(S.pointer.x, S.pointer.y); hot = FM.patchAt(S.L, wx, wy); }
    S.patches.forEach((P, i) => {
      let injected = injectRandom(P, HM.poisson(C.AMBIENT * dt), t);
      if (i === hot) injected += injectCursor(P, wx - P.x0, wy - P.y0, dt, t);
      if (injected) { P.phys += injected; refreshSyndrome(P, t); if (patchRect(P, cam).visible) S.dirty = true; }
      if (t >= P.nextRound) round(P, i, t, cam);
    });
    if (!S.merge && t >= S.nextMerge) startMerge(t);
    if (hot >= 0 && patchRect(S.patches[hot], cam).visible) S.dirty = true;
    if (S.dirty || t < S.animUntil) requestFrame();
    S.tickTimer = setTimeout(tick, C.TICK);
  }
  function start() {
    if (S.running || reduced() || S.static || !S.engine || document.hidden) return;
    S.running = true; S.lastTick = now();
    if (!S.nextMerge) S.nextMerge = now() + 2500;
    S.tickTimer = setTimeout(tick, C.TICK);
  }
  function stop() { S.running = false; clearTimeout(S.tickTimer); }

  /* ---------------- reduced motion: one composed frame ---------------- */
  function composeFrozen() {
    const P = S.patches[S.L.heroIndex], d = S.L.d, s = P.s;
    s.clear(); P.pending = []; P.lit = new Map();
    const r0 = Math.floor(d / 2), c0 = Math.floor(d / 3);
    for (let c = c0; c < c0 + 3; c++) inject(P, s.qubitAt(c, r0), 0);
    for (let r = r0 - 6; r < r0 - 3; r++) inject(P, s.qubitAt(c0 + Math.floor(d / 2), r), 0);
    refreshSyndrome(P, 0);
    const { cx, cz } = s.decode();
    P.frozen = { chains: HM.chainsFromCorrection(s, cx, cz), errors: P.pending, lit: [...P.lit.keys()] };
    s.clear(); P.pending = []; P.lit = new Map();
  }

  /* ---------------- dynamic drawing ---------------- */
  function pauliColour(p) { return p === 'X' ? S.colours.x : p === 'Z' ? S.colours.z : S.colours.y; }
  function strokePartial(g, pts, frac) {
    if (pts.length < 2) return;
    let total = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); total += l; }
    let left = total * frac;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length && left > 0; i++) {
      const l = seg[i - 1];
      if (left >= l) { g.lineTo(pts[i][0], pts[i][1]); left -= l; }
      else { const f = left / l; g.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f); left = 0; }
    }
    g.stroke();
  }
  function drawLit(g, P, idx, unit, ox, oy, alpha, d) {
    const st = P.s.stabs[idx], col = st.type === 'Z' ? S.colours.z : S.colours.x;
    const cx = ox + st.x * unit, cy = oy + st.y * unit, span = 2 * d;
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 1.8 * unit);
    glow.addColorStop(0, rgba(col, 0.25 * alpha)); glow.addColorStop(1, rgba(col, 0));
    g.fillStyle = glow; g.fillRect(cx - 1.8 * unit, cy - 1.8 * unit, 3.6 * unit, 3.6 * unit);
    g.fillStyle = rgba(col, 0.55 * alpha);
    if (st.x > 0 && st.x < span && st.y > 0 && st.y < span) g.fillRect(cx - unit, cy - unit, 2 * unit, 2 * unit);
    else {
      g.beginPath();
      if (st.x === 0) g.arc(cx, cy, unit, -Math.PI / 2, Math.PI / 2);
      else if (st.x === span) g.arc(cx, cy, unit, Math.PI / 2, 3 * Math.PI / 2);
      else if (st.y === 0) g.arc(cx, cy, unit, 0, Math.PI);
      else g.arc(cx, cy, unit, Math.PI, 2 * Math.PI);
      g.closePath(); g.fill();
    }
  }
  function drawError(g, P, e, unit, ox, oy, grow, alpha) {
    const q = P.s.qubits[e.q], k = clamp(unit / 28, 0.35, 1.2);
    const r = (3 + 2.5 * grow) * k;
    g.fillStyle = rgba(pauliColour(e.pauli), alpha);
    g.beginPath(); g.arc(ox + q.x * unit, oy + q.y * unit, r, 0, 2 * Math.PI); g.fill();
  }
  function drawChains(g, P, chains, unit, ox, oy, frac, alpha) {
    const k = clamp(unit / 28, 0.35, 1.2);
    g.lineWidth = 1.5 * k; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const ch of chains) {
      const pts = ch.qubits.map(q => [ox + P.s.qubits[q].x * unit, oy + P.s.qubits[q].y * unit]);
      g.strokeStyle = rgba(ch.type === 'X' ? S.colours.z : S.colours.x, 0.9 * alpha);
      if (pts.length === 1) { g.beginPath(); g.arc(pts[0][0], pts[0][1], 4 * k, 0, 2 * Math.PI); g.stroke(); }
      else strokePartial(g, pts, frac);
    }
  }
  function drawDynamic(g, P, unit, ox, oy, t, d) {
    // current (undecoded) errors and defects
    for (const [idx, t0] of P.lit) drawLit(g, P, idx, unit, ox, oy, clamp((t - t0) / C.T_DEF, 0, 1), d);
    for (const e of P.pending) drawError(g, P, e, unit, ox, oy, clamp((t - e.t0) / C.T_ERR, 0, 1), 1);
    // frozen frame (reduced motion)
    if (P.frozen) {
      for (const idx of P.frozen.lit) drawLit(g, P, idx, unit, ox, oy, 1, d);
      for (const e of P.frozen.errors) drawError(g, P, e, unit, ox, oy, 1, 1);
      drawChains(g, P, P.frozen.chains, unit, ox, oy, 1, 1);
    }
    // the round in progress: chains draw in, hold, then everything fades
    const a = P.anim;
    if (a) {
      const dt = t - a.t0, total = C.T_CHAIN + C.T_HOLD + C.T_FADE;
      if (dt >= total) { P.anim = null; return; }
      const frac = clamp(dt / C.T_CHAIN, 0, 1);
      const alpha = dt < C.T_CHAIN + C.T_HOLD ? 1 : 1 - (dt - C.T_CHAIN - C.T_HOLD) / C.T_FADE;
      for (const idx of a.lit) drawLit(g, P, idx, unit, ox, oy, alpha, d);
      for (const e of a.errors) drawError(g, P, e, unit, ox, oy, 1, alpha);
      drawChains(g, P, a.chains, unit, ox, oy, frac, alpha);
    }
  }
  function drawMerge(g, cam, t) {
    const ph = mergePhase(t);
    if (!S.merge || ph <= 0) return;
    const A = S.patches[S.merge.a], B = S.patches[S.merge.b], span = S.L.patchSpan, unit = cam.cell / 2;
    const horiz = A.row === B.row;
    const x0 = horiz ? A.x0 + span : A.x0, x1 = horiz ? B.x0 : A.x0 + span;
    const y0 = horiz ? A.y0 : A.y0 + span, y1 = horiz ? A.y0 + span : B.y0;
    const [sx0, sy0] = cam.toScreen(x0, y0);
    for (let gx = x0; gx < x1; gx += 2) for (let gy = y0; gy < y1; gy += 2) {
      const z = ((gx / 2 + gy / 2) % 2 + 2) % 2 === 0;
      g.fillStyle = rgba(z ? S.colours.z : S.colours.x, 0.075 * ph);
      g.fillRect(sx0 + (gx - x0) * unit, sy0 + (gy - y0) * unit, 2 * unit, 2 * unit);
    }
    if (ph >= 1) {
      g.fillStyle = rgba(S.colours.accent, 0.06);
      g.fillRect(sx0, sy0, (x1 - x0) * unit, (y1 - y0) * unit);
    }
  }
  function drawHeat(g, cam, t) {
    if (t - S.pointer.t >= 400) return;
    const [wx, wy] = cam.toWorld(S.pointer.x, S.pointer.y);
    if (FM.patchAt(S.L, wx, wy) < 0) return;
    const r = Math.max(40, 2 * C.CURSOR_SIGMA * cam.cell);
    const grad = g.createRadialGradient(S.pointer.x, S.pointer.y, 0, S.pointer.x, S.pointer.y, r);
    grad.addColorStop(0, rgba(S.colours.accent, C.HEAT_ALPHA)); grad.addColorStop(1, rgba(S.colours.accent, 0));
    g.fillStyle = grad; g.fillRect(S.pointer.x - r, S.pointer.y - r, 2 * r, 2 * r);
  }
  function drawFlashes(g, cam, t) {
    S.patches.forEach((P, i) => {
      const dt = t - P.flashAt;
      if (dt < 0 || dt >= C.T_FLASH) return;
      const a = 0.14 * (1 - dt / C.T_FLASH);
      g.fillStyle = rgba(S.colours.accent, a);
      if (isHero(i)) g.fillRect(0, 0, S.W, S.H);
      else { const r = patchRect(P, cam); g.fillRect(r.sx, r.sy, r.size, r.size); }
    });
  }

  /* ---------------- render ---------------- */
  function render(t) {
    S.frames++;
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, S.W, S.H);
    S.dirty = false;
    if (!S.geom || S.static) return;
    const cam = cameraNow(), unit = cam.cell / 2, d = S.L.d;
    const fade = clamp((t - S.readyAt) / C.T_FADEIN, 0, 1);
    if (fade < 1) S.dirty = true;
    ctx.globalAlpha = fade;
    S.liveAnims = 0;
    for (const P of S.patches) {
      const r = patchRect(P, cam);
      // Off-screen rounds still expire, so their animations never pin the frame loop.
      if (P.anim && t - P.anim.t0 >= C.T_CHAIN + C.T_HOLD + C.T_FADE) P.anim = null;
      if (!r.visible) continue;
      if (cam.cell >= C.DIRECT_MIN_CELL) drawStaticPatch(ctx, S.geom, unit, r.sx, r.sy, d);
      else ctx.drawImage(S.sprite, r.sx, r.sy, r.size, r.size);
      drawDynamic(ctx, P, unit, r.sx, r.sy, t, d);
      if (P.anim || t - P.flashAt < C.T_FLASH) S.liveAnims++;
      for (const e of P.pending) if (t - e.t0 < C.T_ERR) { S.liveAnims++; break; }
      for (const [, t0] of P.lit) if (t - t0 < C.T_DEF) { S.liveAnims++; break; }
    }
    drawMerge(ctx, cam, t);
    if (S.merge) S.liveAnims++;
    drawHeat(ctx, cam, t);
    drawFlashes(ctx, cam, t);
    ctx.globalAlpha = 1;
  }
  function requestFrame() {
    if (S.raf) return;
    S.raf = requestAnimationFrame(t => {
      S.raf = 0; render(t);
      if (S.dirty || S.liveAnims > 0) requestFrame();
    });
  }

  /* ---------------- boot ---------------- */
  function markStatic() { S.static = true; hero.classList.add('static'); if (win) win.classList.add('static'); }
  function boot() {
    window.__fabric = { state: S, C, redraw: () => { S.dirty = true; requestFrame(); }, setReduced(v) { S.forceReduced = !!v; onReduced(); } };
    readColours(); resize();
    if (params.get('nowasm') === '1') { markStatic(); return; }
    window.QEC.load('assets/stabilizer_qec.wasm').then(engine => {
      S.engine = engine; makeSessions(); buildSprite();
      S.readyAt = now();
      if (reduced()) composeFrozen(); else start();
      S.dirty = true; requestFrame();
    }).catch(err => { console.warn('fabric: engine unavailable', err); markStatic(); });

    addEventListener('scroll', onScroll, { passive: true });
    let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 200); });
    addEventListener('pointermove', e => { S.pointer = { x: e.clientX, y: e.clientY, t: now() }; }, { passive: true });
    document.addEventListener('pointerleave', () => { S.pointer.t = -Infinity; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    new MutationObserver(() => { readColours(); buildSprite(); S.dirty = true; requestFrame(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    function onReduced() {
      if (!S.engine) return;
      if (reduced()) { stop(); S.patches.forEach(P => { P.anim = null; P.frozen = null; }); composeFrozen(); }
      else { S.patches.forEach(P => { P.frozen = null; }); start(); }
      S.dirty = true; requestFrame();
    }
    reducedMQ.addEventListener ? reducedMQ.addEventListener('change', onReduced) : reducedMQ.addListener(onReduced);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
