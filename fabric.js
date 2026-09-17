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

  // 3x5 pixel font bitmaps for JASPER SANDS opener
  const FONT_3X5 = {
    J: [[1,1,1],[0,0,1],[0,0,1],[1,0,1],[0,1,0]],
    A: [[0,1,0],[1,0,1],[1,1,1],[1,0,1],[1,0,1]],
    S: [[0,1,1],[1,0,0],[1,1,0],[0,0,1],[1,1,0]],
    P: [[1,1,0],[1,0,1],[1,1,0],[1,0,0],[1,0,0]],
    E: [[1,1,1],[1,0,0],[1,1,0],[1,0,0],[1,1,1]],
    R: [[1,1,0],[1,0,1],[1,1,0],[1,0,1],[1,0,1]],
    N: [[1,0,1],[1,1,0],[1,0,1],[0,1,1],[1,0,1]],
    D: [[1,1,0],[1,0,1],[1,0,1],[1,0,1],[1,1,0]]
  };

  function getWordPixels(word, startR, startC) {
    const pixels = [];
    let c = startC;
    for (const char of word) {
      const glyph = FONT_3X5[char];
      if (glyph) {
        for (let r = 0; r < 5; r++) {
          for (let col = 0; col < 3; col++) {
            if (glyph[r][col]) pixels.push({ r: startR + r, c: c + col });
          }
        }
      }
      c += 4;
    }
    return pixels;
  }

  function getWordBoxes(word, startR, startC) {
    const boxes = [];
    let c = startC;
    for (const char of word) {
      const glyph = FONT_3X5[char];
      if (glyph) {
        for (let r = 0; r < 5; r++) {
          for (let col = 0; col < 3; col++) {
            if (glyph[r][col]) boxes.push({ r: startR + r, c: c + col });
          }
        }
      }
      c += 4;
    }
    return boxes;
  }

  function getWordSegments(word, startR, startC) {
    const segments = [];
    let c = startC;
    for (const char of word) {
      const glyph = FONT_3X5[char];
      if (glyph) {
        for (let r = 0; r < 5; r++) {
          for (let col = 0; col < 2; col++) {
            if (glyph[r][col] && glyph[r][col + 1]) {
              segments.push({ r1: startR + r, c1: c + col, r2: startR + r, c2: c + col + 1 });
            }
          }
        }
        for (let r = 0; r < 4; r++) {
          for (let col = 0; col < 3; col++) {
            if (glyph[r][col] && glyph[r + 1][col]) {
              segments.push({ r1: startR + r, c1: c + col, r2: startR + r + 1, c2: c + col });
            }
          }
        }
      }
      c += 4;
    }
    return segments;
  }

  const canvas = document.getElementById('fabric');
  const hero = document.querySelector('.hero') || document.querySelector('.ex-hero');
  const win = document.querySelector('.fabric-window') || document.querySelector('.ex-window');
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
    forceReduced: false, static: false, customD: null
  };

  let isTypingOpener = false;
  let openerTimer = null;
  let openerFadeStart = null;
  let openerBoxes = [];
  let openerSegments = [];
  let showMatchGraph = false;

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
    let d = S.customD;
    if (!d) {
      if (w < 760) d = C.D_PHONE;
      else if (w < 1100) d = C.D_TABLET;
      else d = C.D;
    }
    const cols = (w < 760) ? C.COLS_PHONE : C.COLS;
    const cell = (w < 760) ? C.CELL_PHONE : (w < 1100) ? C.CELL_TABLET : C.CELL;
    return { cell, d, cols, rows: C.ROWS };
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
  // Drops an in-flight opener without touching any session. Returns true if one was running,
  // so the caller can restart it once new sessions exist.
  function abortOpener() {
    const was = isTypingOpener || !!openerFadeStart;
    if (openerTimer) { clearTimeout(openerTimer); openerTimer = null; }
    isTypingOpener = false; openerFadeStart = null; openerBoxes = []; openerSegments = [];
    hero.classList.remove('hero--typing');
    return was;
  }
  function makeSessions() {
    abortOpener();                       // its timers hold the patch objects freed below
    for (const P of S.patches) P.s.free();
    const exp = S.engine.rawExports, d = S.L.d;
    S.patches = S.L.patches.map((q, i) => ({
      ...q, index: i, s: window.QECSessions.create(exp, d),
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
    if (S.engine && dChanged) {
      const openerWasRunning = isTypingOpener || !!openerFadeStart;
      makeSessions();
      if (reduced()) composeFrozen();
      else if (openerWasRunning) startOpeningSequence();
      else if (!S.running) start();
    }
    buildSprite();
    onScroll();
  }
  let manualZoom = false;
  function onScroll() {
    if (!manualZoom) {
      S.p = clamp(scrollY / Math.max(1, hero.offsetHeight), 0, 1);
      S.cell = FM.cellAt(S.p, S.cellMax, S.cellMin);
      const zs = $('hero-zoom-slider') || $('ex-zoom-slider');
      if (zs) zs.value = S.p;
      S.dirty = true; requestFrame();
    }
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
  function injectCursor(P, lx, ly, dt, t, sigma = C.CURSOR_SIGMA, lim = 3 * C.CURSOR_SIGMA) {
    let n = 0;
    const qs = P.s.qubits;
    // When zoomed out the pointer's footprint is widened in cells; scale the peak down by the
    // area ratio so the total error rate under the pointer stays what it is in the hero.
    const peak = C.CURSOR_PEAK * (C.CURSOR_SIGMA / sigma) ** 2;
    for (let i = 0; i < qs.length; i++) {
      const dist = Math.hypot((qs[i].x - lx) / 2, (qs[i].y - ly) / 2);
      if (dist > lim) continue;
      const k = HM.poisson(HM.gaussianRate(dist, sigma, peak) * dt);
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
    if (isHero(i) && isTypingOpener) return;
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
      if (isHero(i) && logical) {
        const b = $('hr-logic') || $('ex-logical');
        if (b) { b.classList.add('flare'); setTimeout(() => b.classList.remove('flare'), C.T_FLASH); }
      }
    }
    if (isHero(i)) updateReadout(P);
    P.nextRound = t + (isHero(i) ? C.ROUND_HERO : C.ROUND_OTHER) * (0.85 + 0.3 * Math.random());
  }

  function updateReadout(P) {
    if (!P) P = S.patches[S.L ? S.L.heroIndex : 0];
    if (!P) return;
    const d = S.L ? S.L.d : 27;
    const dVal = $('hr-d-val') || $('ex-d');
    if (dVal) dVal.textContent = d;
    document.querySelectorAll('#hero-d, #ex-d, .ex-d, .fabric-d').forEach(el => { el.textContent = d; });
    const np = $('hero-n-patches'); if (np && S.L) np.textContent = S.L.patches.length;
    const rEl = $('hr-rounds') || $('ex-rounds');
    if (rEl) rEl.textContent = P.rounds.toLocaleString();
    const pEl = $('hr-phys') || $('ex-phys');
    if (pEl) pEl.textContent = P.phys.toLocaleString();
    const lEl = $('hr-logic') || $('ex-logical');
    if (lEl) lEl.textContent = P.logical.toLocaleString();
  }


  /* ---------------- hybrid opener ---------------- */
  function startOpeningSequence() {
    stop();
    const H = S.patches[S.L.heroIndex];
    if (!H || H.s.d < 15 || reduced()) {
      start();
      return;
    }

    if (openerTimer) { clearTimeout(openerTimer); openerTimer = null; }
    isTypingOpener = true;
    openerFadeStart = null;
    openerBoxes = [];
    openerSegments = [];
    H.pending = [];
    H.lit.clear();
    H.anim = null;
    H.s.clear();

    hero.classList.add('hero--typing');
    const d = H.s.d;
    const midRow = Math.floor(d / 2);

    let boxesQueue = [];
    let pixelsQueue = [];
    let segmentsQueue = [];

    if (d >= 23) {
      const c1 = Math.max(1, Math.floor((d - 1 - 23) / 2));
      const c2 = Math.max(1, Math.floor((d - 1 - 19) / 2));
      let startR = Math.max(1, midRow - 5);
      if (startR + 11 >= d - 1) startR = Math.max(1, d - 13);

      boxesQueue = [...getWordBoxes('JASPER', startR, c1), ...getWordBoxes('SANDS', startR + 6, c2)];
      pixelsQueue = [...getWordPixels('JASPER', startR, c1), ...getWordPixels('SANDS', startR + 6, c2)];
      segmentsQueue = [...getWordSegments('JASPER', startR, c1), ...getWordSegments('SANDS', startR + 6, c2)];
    } else {
      const c = Math.max(1, Math.floor((d - 1 - 7) / 2));
      const startR = Math.max(1, midRow - 2);
      boxesQueue = getWordBoxes('JS', startR, c);
      pixelsQueue = getWordPixels('JS', startR, c);
      segmentsQueue = getWordSegments('JS', startR, c);
    }

    const totalSteps = Math.max(boxesQueue.length, pixelsQueue.length);
    if (totalSteps === 0) {
      isTypingOpener = false;
      hero.classList.remove('hero--typing');
      start();
      return;
    }

    let stepIdx = 0;
    const intervalMs = (d >= 23) ? 24 : 70;

    const stale = () => !isTypingOpener || S.patches[S.L.heroIndex] !== H;
    function typeNext() {
      if (stale()) return;
      const t = now();

      if (stepIdx < totalSteps) {
        if (stepIdx < boxesQueue.length) {
          const b = boxesQueue[stepIdx];
          openerBoxes.push({ r: b.r, c: b.c, t0: t });
        }
        if (stepIdx < pixelsQueue.length) {
          const p = pixelsQueue[stepIdx];
          const q = p.r * H.s.d + p.c;
          H.s.toggle(q, 'X');
          H.pending.push({ q, pauli: 'X', t0: t });
          H.phys++;
          refreshSyndrome(H, t);
        }

        const activeCoordSet = new Set(H.pending.map(e => e.q));
        openerSegments = segmentsQueue.filter(seg => {
          const q1 = seg.r1 * H.s.d + seg.c1;
          const q2 = seg.r2 * H.s.d + seg.c2;
          return activeCoordSet.has(q1) && activeCoordSet.has(q2);
        });

        stepIdx++;
        updateReadout(H);
        S.dirty = true;
        requestFrame();
        openerTimer = setTimeout(typeNext, intervalMs);
      } else {
        // Hold the completed name for 1600ms so the visitor can comfortably read it
        openerTimer = setTimeout(() => {
          if (stale()) return;
          isTypingOpener = false;
          openerFadeStart = now();
          hero.classList.remove('hero--typing');

          const { logical, cx, cz } = H.s.decode();
          const chains = HM.chainsFromCorrection(H.s, cx, cz);
          H.s.clear();
          H.rounds++; H.logical += logical;
          H.anim = { t0: now(), chains, errors: H.pending.slice(), lit: [...H.lit.keys()], logical };
          H.pending = [];
          H.lit.clear();
          S.animUntil = now() + C.T_CHAIN + C.T_HOLD + C.T_FADE;
          S.dirty = true;
          requestFrame();

          // Start ambient mode only after the MWPM erasure animation has completely finished
          setTimeout(() => {
            start();
          }, C.T_CHAIN + C.T_HOLD + C.T_FADE);
        }, 1600);
      }
    }

    openerTimer = setTimeout(typeNext, 350);
  }

  function replayOpener() {
    stop();
    if (openerTimer) { clearTimeout(openerTimer); openerTimer = null; }
    isTypingOpener = false;
    openerFadeStart = null;
    openerBoxes = [];
    openerSegments = [];
    hero.classList.remove('hero--typing');
    const H = S.patches[S.L ? S.L.heroIndex : 0];
    if (H) {
      H.pending = [];
      H.lit.clear();
      H.anim = null;
      H.s.clear();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    manualZoom = false;
    S.p = 0;
    S.cell = S.cellMax;
    const zs = $('hero-zoom-slider') || $('ex-zoom-slider');
    if (zs) zs.value = 0;
    S.dirty = true;
    requestFrame();
    startOpeningSequence();
  }

  function cancelOpener() {
    if (!isTypingOpener && !openerFadeStart) return;
    isTypingOpener = false;
    openerFadeStart = null;
    openerBoxes = [];
    openerSegments = [];
    hero.classList.remove('hero--typing');
    if (openerTimer) { clearTimeout(openerTimer); openerTimer = null; }
    const H = S.patches[S.L ? S.L.heroIndex : 0];
    if (H && H.pending.length > 0) {
      round(H, S.L.heroIndex, now(), cameraNow());
    }
    start();
  }

  function setDistance(newD) {
    stop();
    if (isTypingOpener) cancelOpener();
    newD = Math.max(15, Math.min(41, newD));
    if (newD % 2 === 0) newD += 1;
    if (S.L && S.L.d === newD) return;

    S.customD = newD;
    resize();
    replayOpener();
  }

  function triggerBurst(customCenter) {
    const H = S.patches[S.L ? S.L.heroIndex : 0];
    if (!H || reduced() || isTypingOpener) return;
    const t = now();
    const margin = Math.max(1, Math.floor(H.s.d * 0.15));
    const r = margin + Math.floor(Math.random() * (H.s.d - 2 * margin));
    const c = margin + Math.floor(Math.random() * (H.s.d - 2 * margin));
    const centerQ = r * H.s.d + c;
    const centerPt = H.s.qubits[centerQ];

    const radius = 2.4 * 2;
    let count = 0;
    for (let q = 0; q < H.s.numQubits && H.pending.length < C.MAX_PENDING; q++) {
      const qPt = H.s.qubits[q];
      const dist = Math.hypot(qPt.x - centerPt.x, qPt.y - centerPt.y);
      if (dist <= radius) {
        const rnd = Math.random();
        const p = (rnd < 0.65) ? 'X' : (rnd < 0.85) ? 'Z' : 'Y';
        H.s.toggle(q, p);
        H.pending.push({ q, pauli: p, t0: t });
        count++;
      }
    }
    if (count > 0) {
      H.phys += count;
      refreshSyndrome(H, t);
      updateReadout(H);
      S.dirty = true;
      requestFrame();
    }
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
    const hasPointer = (t - S.pointer.t < 400);
    let wx = 0, wy = 0, sigma = C.CURSOR_SIGMA, lim = 3 * sigma, reach = 2 * lim;
    if (hasPointer) {
      [wx, wy] = cam.toWorld(S.pointer.x, S.pointer.y);
      const screenR = Math.max(48, 2.4 * C.CURSOR_SIGMA * cam.cell);
      sigma = Math.max(C.CURSOR_SIGMA, screenR / (2.4 * cam.cell));
      lim = 3 * sigma;
      reach = 2 * lim; // in world units (half-cells)
    }
    const span = S.L.patchSpan;
    S.patches.forEach((P, i) => {
      let injected = injectRandom(P, HM.poisson(C.AMBIENT * dt), t);
      if (hasPointer && !isTypingOpener) {
        const touches = (wx >= P.x0 - reach && wx <= P.x0 + span + reach &&
                         wy >= P.y0 - reach && wy <= P.y0 + span + reach);
        if (touches) {
          injected += injectCursor(P, wx - P.x0, wy - P.y0, dt, t, sigma, lim);
        }
      }
      if (injected) { P.phys += injected; refreshSyndrome(P, t); if (patchRect(P, cam).visible) S.dirty = true; }
      if (t >= P.nextRound) round(P, i, t, cam);
    });
    if (!S.merge && t >= S.nextMerge) startMerge(t);
    if (hasPointer) S.dirty = true;
    if (S.dirty || t < S.animUntil) requestFrame();
    S.tickTimer = setTimeout(tick, C.TICK);
  }
  function start() {
    if (S.running || reduced() || S.static || !S.engine || document.hidden || isTypingOpener) return;
    S.running = true;
    S.lastTick = now();
    const t0 = now();
    S.patches.forEach((P, i) => {
      P.nextRound = t0 + (isHero(i) ? C.ROUND_HERO : C.ROUND_OTHER) * (0.85 + 0.3 * Math.random());
    });
    if (!S.nextMerge) S.nextMerge = t0 + 2500;
    clearTimeout(S.tickTimer);
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
    const typingHero = isHero(P.index) && isTypingOpener;

    if (!typingHero) {
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 1.8 * unit);
      glow.addColorStop(0, rgba(col, 0.25 * alpha)); glow.addColorStop(1, rgba(col, 0));
      g.fillStyle = glow; g.fillRect(cx - 1.8 * unit, cy - 1.8 * unit, 3.6 * unit, 3.6 * unit);
      g.fillStyle = rgba(col, 0.55 * alpha);
    } else {
      // During opener on hero patch: subtle background defect tint (alpha 0.08) so letters are 100% crisp and readable
      g.fillStyle = rgba(col, 0.08 * alpha);
    }

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
    const typingHero = isHero(P.index) && isTypingOpener;
    const r = (typingHero ? 5.2 : (3 + 2.5 * grow)) * k;
    const col = pauliColour(e.pauli);

    g.save();
    g.fillStyle = rgba(col, alpha);
    if (typingHero) {
      g.shadowColor = rgba(col, alpha);
      g.shadowBlur = 4 * k;
    }
    g.beginPath();
    g.arc(ox + q.x * unit, oy + q.y * unit, r, 0, 2 * Math.PI);
    g.fill();

    // Dual-core bright white center for active qubit gates during typing opener
    if (typingHero) {
      g.fillStyle = rgba([255, 255, 255], alpha * 0.92);
      g.shadowBlur = 0;
      g.beginPath();
      g.arc(ox + q.x * unit, oy + q.y * unit, 2.0 * k, 0, 2 * Math.PI);
      g.fill();
    }
    g.restore();
  }

  function drawChains(g, P, chains, unit, ox, oy, frac, alpha) {
    const k = clamp(unit / 28, 0.35, 1.2);
    g.save();
    g.lineWidth = 2.5 * k;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const ch of chains) {
      const pts = ch.qubits.map(q => [ox + P.s.qubits[q].x * unit, oy + P.s.qubits[q].y * unit]);
      const col = ch.type === 'X' ? S.colours.z : S.colours.x;
      g.strokeStyle = rgba(col, 0.95 * alpha);
      g.shadowColor = rgba(col, 0.8 * alpha);
      g.shadowBlur = 8 * k;
      if (pts.length === 1) {
        g.beginPath();
        g.arc(pts[0][0], pts[0][1], 5 * k, 0, 2 * Math.PI);
        g.stroke();
      } else {
        strokePartial(g, pts, frac);
      }
    }
    g.restore();
  }

  function drawDynamic(g, P, unit, ox, oy, t, d) {
    const heroP = isHero(P.index);

    // Opener syndrome boxes on hero patch (Hybrid 56x56 glowing syndrome tiles)
    if (heroP && openerBoxes.length > 0) {
      let boxAlpha = 0.38;
      if (openerFadeStart) {
        const fadeElapsed = t - openerFadeStart;
        boxAlpha = Math.max(0, 0.38 * (1 - fadeElapsed / C.T_FADE));
        if (fadeElapsed >= C.T_FADE) openerBoxes = [];
      }
      g.save();
      const cellPx = 2 * unit;
      openerBoxes.forEach(b => {
        const isX = (b.r + b.c) % 2 !== 0;
        const col = isX ? S.colours.x : S.colours.z;
        const bx = ox + 2 * b.c * unit;
        const by = oy + 2 * b.r * unit;
        g.fillStyle = rgba(col, boxAlpha);
        g.shadowColor = rgba(col, boxAlpha);
        g.shadowBlur = 4;
        if (g.roundRect) {
          g.beginPath();
          g.roundRect(bx + 2, by + 2, cellPx - 4, cellPx - 4, 4);
          g.fill();
        } else {
          g.fillRect(bx + 2, by + 2, cellPx - 4, cellPx - 4);
        }
      });
      g.restore();
    }

    // Current lit defect stabilizers
    for (const [idx, t0] of P.lit) drawLit(g, P, idx, unit, ox, oy, clamp((t - t0) / C.T_DEF, 0, 1), d);

    // Opener illuminated error lines on hero patch (continuous glowing Pauli chains)
    if (heroP && openerSegments.length > 0) {
      let segAlpha = 1;
      if (openerFadeStart) {
        const fadeElapsed = t - openerFadeStart;
        segAlpha = Math.max(0, 1 - fadeElapsed / C.T_FADE);
        if (fadeElapsed >= C.T_FADE) openerSegments = [];
      }
      const k = clamp(unit / 28, 0.35, 1.2);
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';

      // Outer glow and thick illuminated stroke
      g.strokeStyle = rgba(S.colours.x, segAlpha);
      g.lineWidth = 5.2 * k;
      g.shadowColor = rgba(S.colours.x, segAlpha);
      g.shadowBlur = 6 * k;
      g.beginPath();
      openerSegments.forEach(seg => {
        const x1 = ox + (2 * seg.c1 + 1) * unit;
        const y1 = oy + (2 * seg.r1 + 1) * unit;
        const x2 = ox + (2 * seg.c2 + 1) * unit;
        const y2 = oy + (2 * seg.r2 + 1) * unit;
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
      });
      g.stroke();

      // Bright white inner core
      g.strokeStyle = rgba([255, 255, 255], segAlpha * 0.95);
      g.lineWidth = 2.0 * k;
      g.shadowBlur = 0;
      g.beginPath();
      openerSegments.forEach(seg => {
        const x1 = ox + (2 * seg.c1 + 1) * unit;
        const y1 = oy + (2 * seg.r1 + 1) * unit;
        const x2 = ox + (2 * seg.c2 + 1) * unit;
        const y2 = oy + (2 * seg.r2 + 1) * unit;
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
      });
      g.stroke();
      g.restore();
    }

    // Pending errors (dual-core qubit gates during opener, or standard Pauli errors in ambient)
    let errAlpha = 1;
    if (heroP && openerFadeStart) {
      errAlpha = Math.max(0, 1 - (t - openerFadeStart) / C.T_FADE);
    }
    for (const e of P.pending) drawError(g, P, e, unit, ox, oy, clamp((t - e.t0) / C.T_ERR, 0, 1), errAlpha);

    // Frozen frame (reduced motion)
    if (P.frozen) {
      for (const idx of P.frozen.lit) drawLit(g, P, idx, unit, ox, oy, 1, d);
      for (const e of P.frozen.errors) drawError(g, P, e, unit, ox, oy, 1, 1);
      drawChains(g, P, P.frozen.chains, unit, ox, oy, 1, 1);
    }

    // Correction chains in animation
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

  // The graph MWPM matches on: for each stabilizer type, the complete graph on that type's
  // defects, weighted by the shortest error chain between them (Chebyshev distance in cells
  // on the rotated lattice), plus one edge per defect to the nearest boundary its chains
  // can terminate on (X errors, seen by Z stabilizers, end left/right; Z errors, seen by X
  // stabilizers, end top/bottom). Heavier edges are drawn fainter.
  function drawMatchGraph(g, cam) {
    if (!showMatchGraph || isTypingOpener) return;
    const H = S.patches[S.L ? S.L.heroIndex : 0];
    if (!H || H.lit.size < 1) return;
    const span = S.L.patchSpan;
    const defects = Array.from(H.lit.keys()).slice(0, 48).map(i => H.s.stabs[i]);
    const alphaFor = w => Math.max(0.05, Math.min(0.6, 0.6 / Math.max(1, w)));
    g.save();
    g.lineWidth = 1;
    for (const type of ['Z', 'X']) {
      const ds = defects.filter(st => st.type === type);
      const col = type === 'Z' ? S.colours.z : S.colours.x;
      g.setLineDash([2, 4]);
      for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
        const w = Math.max(Math.abs(ds[i].x - ds[j].x), Math.abs(ds[i].y - ds[j].y)) / 2;
        const [x1, y1] = cam.toScreen(H.x0 + ds[i].x, H.y0 + ds[i].y);
        const [x2, y2] = cam.toScreen(H.x0 + ds[j].x, H.y0 + ds[j].y);
        g.strokeStyle = rgba(col, alphaFor(w));
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
      g.setLineDash([]);
      for (const st of ds) {
        // boundary edge: Z-type defects terminate on the left/right edge, X-type on top/bottom
        let bx = st.x, by = st.y;
        if (type === 'Z') bx = st.x <= span - st.x ? 0 : span; else by = st.y <= span - st.y ? 0 : span;
        const w = Math.max(Math.abs(bx - st.x), Math.abs(by - st.y)) / 2;
        const [x1, y1] = cam.toScreen(H.x0 + st.x, H.y0 + st.y);
        const [x2, y2] = cam.toScreen(H.x0 + bx, H.y0 + by);
        g.strokeStyle = rgba(col, alphaFor(w));
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
    }
    g.restore();
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
    if (ph >= 0.35) {
      const midX = sx0 + ((x1 - x0) * unit) / 2;
      const midY = sy0 + ((y1 - y0) * unit) / 2;
      g.save();
      const text = 'LATTICE SURGERY · 2-QUBIT GATE';
      g.font = '600 9px "JetBrains Mono", monospace';
      const tm = g.measureText(text);
      const alpha = Math.min(1, ph);
      g.fillStyle = rgba(S.colours.bg, 0.92 * alpha);
      g.fillRect(midX - tm.width / 2 - 5, midY - 8, tm.width + 10, 16);
      g.strokeStyle = rgba(S.colours.accent, 0.7 * alpha);
      g.lineWidth = 1;
      g.strokeRect(midX - tm.width / 2 - 5, midY - 8, tm.width + 10, 16);
      g.fillStyle = rgba(S.colours.accent, alpha);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, midX, midY);
      g.restore();
    }
  }
  function drawHeat(g, cam, t) {
    if (isTypingOpener || t - S.pointer.t >= 400) return;
    const [wx, wy] = cam.toWorld(S.pointer.x, S.pointer.y);
    const r = Math.max(48, 2.4 * C.CURSOR_SIGMA * cam.cell);
    const reach = 2 * (3 * Math.max(C.CURSOR_SIGMA, r / (2.4 * cam.cell)));
    const nearFabric = (wx >= -reach && wx <= S.L.worldW + reach &&
                        wy >= -reach && wy <= S.L.worldH + reach);
    if (!nearFabric) return;
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
      if (cam.cell < C.DIRECT_MIN_CELL) {
        ctx.save();
        const heroPatch = isHero(P.index);
        ctx.fillStyle = rgba(heroPatch ? S.colours.accent : S.colours.fg3, heroPatch ? 0.95 : 0.45);
        ctx.font = '600 8.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(heroPatch ? `Q${P.index} (Hero)` : `Q${P.index}`, r.sx + r.size / 2, r.sy + r.size + 4);
        ctx.restore();
      }
      if (P.anim || t - P.flashAt < C.T_FLASH) S.liveAnims++;
      for (const e of P.pending) if (t - e.t0 < C.T_ERR) { S.liveAnims++; break; }
      for (const [, t0] of P.lit) if (t - t0 < C.T_DEF) { S.liveAnims++; break; }
    }
    drawMerge(ctx, cam, t);
    drawMatchGraph(ctx, cam);
    if (S.merge) S.liveAnims++;
    drawHeat(ctx, cam, t);
    drawFlashes(ctx, cam, t);
    ctx.globalAlpha = 1;
  }
  function requestFrame() {
    if (S.raf) return;
    S.raf = requestAnimationFrame(t => {
      S.raf = 0; render(t);
      if (S.dirty || S.liveAnims > 0 || isTypingOpener || openerFadeStart) requestFrame();
    });
  }

  /* ---------------- boot ---------------- */
  function markStatic() { S.static = true; hero.classList.add('static'); if (win) win.classList.add('static'); }
  function boot() {
    window.__fabric = {
      state: S, C, redraw: () => { S.dirty = true; requestFrame(); },
      setReduced(v) { S.forceReduced = !!v; onReduced(); },
      replay: replayOpener, setDistance
    };
    readColours(); resize();
    if (params.get('nowasm') === '1') { markStatic(); return; }
    window.QEC.load('assets/stabilizer_qec.wasm').then(engine => {
      S.engine = engine; makeSessions(); buildSprite();
      S.readyAt = now();
      if (reduced()) composeFrozen(); else startOpeningSequence();
      S.dirty = true; requestFrame();
    }).catch(err => { console.warn('fabric: engine unavailable', err); markStatic(); });

    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('scroll', () => { manualZoom = false; }, { passive: true });
    const zoomSlider = document.getElementById('hero-zoom-slider') || document.getElementById('ex-zoom-slider');
    const zoomHeroBtn = document.getElementById('zoom-hero-btn');
    const zoomFabricBtn = document.getElementById('zoom-fabric-btn');
    if (zoomSlider) {
      zoomSlider.addEventListener('input', e => {
        manualZoom = true;
        S.p = parseFloat(e.target.value);
        S.cell = FM.cellAt(S.p, S.cellMax, S.cellMin);
        S.dirty = true;
        requestFrame();
      });
    }
    if (zoomHeroBtn) {
      zoomHeroBtn.addEventListener('click', () => {
        manualZoom = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    if (zoomFabricBtn) {
      zoomFabricBtn.addEventListener('click', () => {
        manualZoom = false;
        const targetEl = win || document.querySelector('.fabric-window') || document.querySelector('.ex-window');
        if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Replay button & distance controls
    const replayBtn = document.getElementById('hr-replay');
    if (replayBtn) replayBtn.addEventListener('click', replayOpener);
    const dDecBtn = document.getElementById('hr-d-dec');
    if (dDecBtn) dDecBtn.addEventListener('click', () => setDistance(S.L.d - 2));
    const dIncBtn = document.getElementById('hr-d-inc');
    if (dIncBtn) dIncBtn.addEventListener('click', () => setDistance(S.L.d + 2));

    // Undocumented keys for anyone reading the source: r replay, [ ] distance, b burst, g matching graph
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'r' || e.key === 'R') {
        replayOpener();
      } else if (e.key === '[') {
        setDistance(S.L.d - 2);
      } else if (e.key === ']') {
        setDistance(S.L.d + 2);
      } else if (e.key === 'b' || e.key === 'B') {
        triggerBurst();
      } else if (e.key === 'g' || e.key === 'G') {
        showMatchGraph = !showMatchGraph;
        S.dirty = true;
        requestFrame();
      }
    });

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
