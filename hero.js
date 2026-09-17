/**
 * hero.js - Controller for the living surface code hero (Plan A+)
 *
 * Drives full-bleed Canvas 2D rotated surface code via stabilizer_qec.wasm
 * and HeroMath. Cursor acts as a heat source; rounds extract syndromes and
 * execute exact MWPM decoding in WebAssembly; logical errors trigger full-canvas flare.
 *
 * Additions:
 * 1. Opening sequence: "JASPER" / "SANDS" typed in Pauli-X errors, erased live by MWPM.
 * 2. Interactive distance controls: d = 5..41 [−] [+] and keyboard shortcuts [ / ].
 * 3. Correlated cosmic-ray / TLS bursts (idle after 20s or on 'b' key).
 * 4. Peer matching graph debug overlay ('g' key).
 */
(() => {
  'use strict';

  // Tunable constants
  const CELL_DESKTOP = 56;
  const CELL_TABLET = 48;
  const CELL_MOBILE = 44;
  const D_MIN = 5;
  const D_MAX = 41;
  const AMBIENT_RATE = 0.8;          // errors/sec across whole lattice
  const CURSOR_PEAK = 3.2;           // errors/sec per qubit at pointer center
  const CURSOR_SIGMA = 1.2;          // cells
  const PAULI_X_WEIGHT = 0.45;
  const PAULI_Z_WEIGHT = 0.45;       // remainder 0.10 is Y
  const ROUND_BASE_MS = 700;
  const ROUND_JITTER = 0.15;
  const MAX_PENDING = 80;
  const TICK_MS = 50;
  const IDLE_BURST_MS = 20000;       // 20s of inactivity triggers a burst

  // Animation durations (ms)
  const DUR_ERROR_IN = 180;
  const DUR_DEFECT_IN = 220;
  const DUR_CHAIN_DRAW = 350;
  const DUR_CHAIN_HOLD = 250;
  const DUR_CHAIN_FADE = 300;
  const DUR_LOGICAL_FLASH = 650;
  const DUR_LATTICE_FADE_IN = 600;

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
            if (glyph[r][col]) {
              pixels.push({ r: startR + r, c: c + col });
            }
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
            if (glyph[r][col]) {
              boxes.push({ r: startR + r, c: c + col });
            }
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

  // DOM elements
  const heroEl = document.querySelector('.hero');
  const canvas = document.querySelector('canvas.field');
  const readoutEl = document.getElementById('hero-readout');
  const dValEl = document.getElementById('hr-d-val');
  const dDecBtn = document.getElementById('hr-d-dec');
  const dIncBtn = document.getElementById('hr-d-inc');
  const roundsValEl = document.getElementById('hr-rounds');
  const physValEl = document.getElementById('hr-phys');
  const logicValEl = document.getElementById('hr-logic');
  const captionEl = document.querySelector('.hero-caption');
  const replayBtn = document.getElementById('hr-replay');

  if (!heroEl || !canvas) return;

  const ctx = canvas.getContext('2d');
  const staticCanvas = document.createElement('canvas');
  const staticCtx = staticCanvas.getContext('2d');

  // State
  let engine = null;
  let session = null;
  let fitGeom = null;
  let dpr = 1;
  let width = 0;
  let height = 0;
  let isPageMode = false;
  let isVisible = true;
  let isReducedMotion = false;
  let customD = null;
  let rafId = null;
  let tickTimer = null;
  let roundTimer = null;

  // Opener & idle burst state (Hybrid: 56x56 syndrome boxes + illuminated error chains)
  let isTypingOpener = false;
  let openerTimer = null;
  let openerFadeStart = null;
  let openerBoxes = [];      // [{ r, c, t0 }]
  let openerSegments = [];   // [{ r1, c1, r2, c2 }]
  let lastBurstTime = performance.now();
  let showMatchGraph = false;

  // Statistics
  let roundsCount = 0;
  let physicalErrorsCount = 0;
  let logicalErrorsCount = 0;

  // Active items
  let pendingErrors = []; // { q, pauli, t0 }
  let activeDefects = new Map(); // stabIdx -> { t0, type, stab }
  let activeChains = []; // { type, qubits: [q...], t0, drawDur, totalDur }
  let flashState = null; // { t0, duration }
  let pointer = { x: -9999, y: -9999, active: false, lastMove: performance.now() };
  let dirty = true;

  // Theme palette
  let palette = {};

  function updatePalette() {
    const s = getComputedStyle(document.documentElement);
    palette = {
      x: s.getPropertyValue('--x').trim() || '#2255aa',
      z: s.getPropertyValue('--z').trim() || '#0d7d6c',
      y: s.getPropertyValue('--y').trim() || '#a85a00',
      accent: s.getPropertyValue('--accent').trim() || '#0d7d6c',
      bg: s.getPropertyValue('--bg').trim() || '#ffffff',
      fg3: s.getPropertyValue('--fg-3').trim() || '#888888',
      rule: s.getPropertyValue('--rule').trim() || 'rgba(0,0,0,0.1)'
    };
  }

  function getBaseCell(w) {
    if (w <= 760) return CELL_MOBILE;
    if (w <= 1100) return CELL_TABLET;
    return CELL_DESKTOP;
  }

  function qubitPixel(q) {
    const coord = session.qubits[q];
    return {
      x: fitGeom.originX + ((coord.x - 1) / 2) * fitGeom.cell,
      y: fitGeom.originY + ((coord.y - 1) / 2) * fitGeom.cell
    };
  }

  function stabPixel(st) {
    return {
      x: fitGeom.originX + ((st.x - 1) / 2) * fitGeom.cell,
      y: fitGeom.originY + ((st.y - 1) / 2) * fitGeom.cell
    };
  }

  /**
   * Path geometry for a stabilizer (face or boundary semicircle).
   */
  function pathStabilizer(c2d, st) {
    const cell = fitGeom.cell;
    const originX = fitGeom.originX;
    const originY = fitGeom.originY;
    const span = fitGeom.span;
    const rr = cell / 2;
    const d = session.d;

    c2d.beginPath();
    if (st.y === 0) {
      // Top boundary semicircle
      const px = originX + ((st.x - 1) / 2) * cell;
      c2d.arc(px, originY, rr, Math.PI, 0, true);
      c2d.closePath();
    } else if (st.y === 2 * d) {
      // Bottom boundary semicircle
      const px = originX + ((st.x - 1) / 2) * cell;
      c2d.arc(px, originY + span, rr, 0, Math.PI, false);
      c2d.closePath();
    } else if (st.x === 0) {
      // Left boundary semicircle
      const py = originY + ((st.y - 1) / 2) * cell;
      c2d.arc(originX, py, rr, 0.5 * Math.PI, 1.5 * Math.PI, false);
      c2d.closePath();
    } else if (st.x === 2 * d) {
      // Right boundary semicircle
      const py = originY + ((st.y - 1) / 2) * cell;
      c2d.arc(originX + span, py, rr, 1.5 * Math.PI, 0.5 * Math.PI, false);
      c2d.closePath();
    } else {
      // Bulk square face
      const px = originX + ((st.x - 1) / 2) * cell;
      const py = originY + ((st.y - 1) / 2) * cell;
      c2d.rect(px - rr, py - rr, cell, cell);
    }
  }

  /**
   * Rebuilds the offscreen static layer canvas.
   */
  function buildStaticLayer() {
    if (!session || !fitGeom) return;
    staticCanvas.width = width * dpr;
    staticCanvas.height = height * dpr;
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    staticCtx.clearRect(0, 0, width, height);

    // 1. Stabilizer tiles
    for (let i = 0; i < session.numStabs; i++) {
      const st = session.stabs[i];
      pathStabilizer(staticCtx, st);
      staticCtx.fillStyle = (st.type === 'X') ? palette.x : palette.z;
      staticCtx.globalAlpha = 0.12;
      staticCtx.fill();
      staticCtx.strokeStyle = (st.type === 'X') ? palette.x : palette.z;
      staticCtx.globalAlpha = 0.40;
      staticCtx.lineWidth = 1;
      staticCtx.stroke();
    }

    // 2. Hairline lattice grid
    staticCtx.strokeStyle = palette.rule;
    staticCtx.globalAlpha = 0.55;
    staticCtx.lineWidth = 1;
    staticCtx.beginPath();
    const d = session.d;
    const originX = fitGeom.originX;
    const originY = fitGeom.originY;
    const cell = fitGeom.cell;

    for (let r = 0; r < d; r++) {
      const y = originY + r * cell;
      staticCtx.moveTo(originX, y);
      staticCtx.lineTo(originX + (d - 1) * cell, y);
    }
    for (let c = 0; c < d; c++) {
      const x = originX + c * cell;
      staticCtx.moveTo(x, originY);
      staticCtx.lineTo(x, originY + (d - 1) * cell);
    }
    staticCtx.stroke();

    // 3. Data qubit dots
    staticCtx.fillStyle = palette.fg3;
    staticCtx.globalAlpha = 0.65;
    for (let i = 0; i < session.numQubits; i++) {
      const pt = qubitPixel(i);
      staticCtx.beginPath();
      staticCtx.arc(pt.x, pt.y, 3.5, 0, 2 * Math.PI);
      staticCtx.fill();
    }
    staticCtx.globalAlpha = 1;
  }

  function resize() {
    isPageMode = document.body.getAttribute('data-field') === 'page';
    const rect = isPageMode ? { width: window.innerWidth, height: window.innerHeight } : heroEl.getBoundingClientRect();
    width = Math.max(300, Math.floor(rect.width));
    height = Math.max(300, Math.floor(rect.height));
    dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const baseCell = getBaseCell(width);
    const prevD = fitGeom ? fitGeom.d : 0;
    fitGeom = window.HeroMath.fit(width, height, baseCell, D_MAX);

    if (customD) {
      fitGeom.d = customD;
      fitGeom.span = (customD - 1) * fitGeom.cell;
      fitGeom.originX = (width - fitGeom.span) / 2;
      fitGeom.originY = (height - fitGeom.span) / 2;
    }

    if (engine && fitGeom.d !== prevD) {
      if (session) session.free();
      session = engine.session(fitGeom.d);
      pendingErrors = [];
      activeDefects.clear();
      activeChains = [];
      updateCaption();
    }

    buildStaticLayer();
    dirty = true;
    requestFrame();
  }

  function setDistance(newD) {
    if (isTypingOpener) cancelOpener();
    newD = Math.max(D_MIN, Math.min(D_MAX, newD));
    if (newD % 2 === 0) newD += 1;
    if (session && session.d === newD) return;

    customD = newD;
    if (session) session.free();
    session = engine.session(newD);

    const baseCell = getBaseCell(width);
    fitGeom = window.HeroMath.fit(width, height, baseCell, D_MAX);
    fitGeom.d = newD;
    fitGeom.span = (newD - 1) * fitGeom.cell;
    fitGeom.originX = (width - fitGeom.span) / 2;
    fitGeom.originY = (height - fitGeom.span) / 2;

    pendingErrors = [];
    activeDefects.clear();
    activeChains = [];
    flashState = null;

    buildStaticLayer();
    updateCaption();
    updateReadout();
    dirty = true;
    requestFrame();
  }

  function updateCaption() {
    if (!captionEl || !session) return;
    const d = session.d;
    if (isReducedMotion) {
      captionEl.innerHTML = `A distance-${d} rotated surface code, decoded live by my Rust simulator compiled to WebAssembly. <a href="https://qcompiler.jaspersands.com/" target="_blank" rel="noopener">Full simulator →</a>`;
    } else {
      captionEl.innerHTML = `A distance-${d} rotated surface code, decoded live by my Rust simulator compiled to WebAssembly. Move the pointer to add noise. A chain of errors across the whole width is a logical error — see if you can cause one. Hotkeys: <code>r</code> replay opener, <code>[</code> and <code>]</code> distance, <code>b</code> burst, <code>g</code> matching graph. <a href="https://qcompiler.jaspersands.com/" target="_blank" rel="noopener">Full simulator →</a>`;
    }
  }

  function updateReadout() {
    if (dValEl && session) dValEl.textContent = session.d;
    if (roundsValEl) roundsValEl.textContent = roundsCount.toLocaleString();
    if (physValEl) physValEl.textContent = physicalErrorsCount.toLocaleString();
    if (logicValEl) logicValEl.textContent = logicalErrorsCount.toLocaleString();
  }

  /**
   * Periodic noise scheduler.
   */
  function tickNoise() {
    if (!session || !isVisible || isReducedMotion || isTypingOpener) return;
    const dt = TICK_MS / 1000;
    const now = performance.now();
    let injected = 0;

    // Ambient noise
    const ambLambda = AMBIENT_RATE * dt;
    const ambEvents = window.HeroMath.poisson(ambLambda);
    for (let k = 0; k < ambEvents && pendingErrors.length < MAX_PENDING; k++) {
      const q = Math.floor(Math.random() * session.numQubits);
      injectError(q, now);
      injected++;
    }

    // Cursor noise
    if (pointer.active && (now - pointer.lastMove < 400)) {
      const sigmaPx = CURSOR_SIGMA * fitGeom.cell;
      const maxDistPx = 3.5 * sigmaPx;

      for (let q = 0; q < session.numQubits && pendingErrors.length < MAX_PENDING; q++) {
        const pt = qubitPixel(q);
        const distPx = Math.hypot(pt.x - pointer.x, pt.y - pointer.y);
        if (distPx <= maxDistPx) {
          const rate = window.HeroMath.gaussianRate(distPx / fitGeom.cell, CURSOR_SIGMA, CURSOR_PEAK);
          const cursorEvents = window.HeroMath.poisson(rate * dt);
          for (let e = 0; e < cursorEvents && pendingErrors.length < MAX_PENDING; e++) {
            injectError(q, now);
            injected++;
          }
        }
      }
    }

    // Idle burst after 20s of inactivity
    if (!pointer.active && (now - pointer.lastMove >= IDLE_BURST_MS) && (now - lastBurstTime >= IDLE_BURST_MS)) {
      triggerBurst();
    }

    if (injected > 0) {
      physicalErrorsCount += injected;
      updateSyndromes(now);
      updateReadout();
      dirty = true;
      requestFrame();
    }
  }

  function injectError(q, now) {
    const rnd = Math.random();
    let pauli = 'X';
    if (rnd < PAULI_X_WEIGHT) pauli = 'X';
    else if (rnd < PAULI_X_WEIGHT + PAULI_Z_WEIGHT) pauli = 'Z';
    else pauli = 'Y';

    session.toggle(q, pauli);
    pendingErrors.push({ q, pauli, t0: now });
  }

  function updateSyndromes(now) {
    const syn = session.syndrome();
    for (let i = 0; i < session.numStabs; i++) {
      if (syn[i] === 1) {
        if (!activeDefects.has(i)) {
          const st = session.stabs[i];
          activeDefects.set(i, { t0: now, type: st.type, stab: st });
        }
      } else {
        activeDefects.delete(i);
      }
    }
  }

  /**
   * Triggers a localized correlated burst of errors (e.g. cosmic ray or TLS defect).
   */
  function triggerBurst(customCenter) {
    if (!session || isReducedMotion || isTypingOpener) return;
    const now = performance.now();
    lastBurstTime = now;

    let centerPt;
    if (customCenter) {
      centerPt = customCenter;
    } else if (pointer.active) {
      centerPt = { x: pointer.x, y: pointer.y };
    } else {
      // Pick random center qubit, biased towards bulk
      const margin = Math.max(1, Math.floor(session.d * 0.15));
      const r = margin + Math.floor(Math.random() * (session.d - 2 * margin));
      const c = margin + Math.floor(Math.random() * (session.d - 2 * margin));
      centerPt = qubitPixel(r * session.d + c);
    }

    const radiusPx = 2.4 * fitGeom.cell;
    let burstCount = 0;

    for (let q = 0; q < session.numQubits && pendingErrors.length < MAX_PENDING; q++) {
      const pt = qubitPixel(q);
      const dist = Math.hypot(pt.x - centerPt.x, pt.y - centerPt.y);
      if (dist <= radiusPx) {
        const rnd = Math.random();
        let pauli = 'X';
        if (rnd < 0.65) pauli = 'X';
        else if (rnd < 0.85) pauli = 'Z';
        else pauli = 'Y';

        session.toggle(q, pauli);
        pendingErrors.push({ q, pauli, t0: now });
        burstCount++;
      }
    }

    if (burstCount > 0) {
      physicalErrorsCount += burstCount;
      updateSyndromes(now);
      updateReadout();
      dirty = true;
      requestFrame();
    }
  }

  /**
   * Periodic decode round.
   */
  function triggerRound() {
    if (!session || !isVisible || isReducedMotion) {
      scheduleNextRound();
      return;
    }

    roundsCount++;
    const now = performance.now();

    if (pendingErrors.length > 0) {
      // Decode with Edmonds' blossom MWPM
      const res = session.decode(2);
      const chains = window.HeroMath.chainsFromCorrection(session, res.cx, res.cz);

      // Reset Pauli frame so each round stands alone
      session.clear();

      if (res.logical === 1) {
        logicalErrorsCount++;
        flashState = { t0: now, duration: DUR_LOGICAL_FLASH };
        if (logicValEl) {
          logicValEl.classList.add('flash');
          setTimeout(() => logicValEl && logicValEl.classList.remove('flash'), DUR_LOGICAL_FLASH);
        }
      }

      // Add chains for drawing
      chains.forEach(ch => {
        activeChains.push({
          type: ch.type,
          qubits: ch.qubits,
          t0: now,
          drawDur: DUR_CHAIN_DRAW,
          totalDur: DUR_CHAIN_DRAW + DUR_CHAIN_HOLD + DUR_CHAIN_FADE
        });
      });

      // Clear pending errors and fade defects
      pendingErrors = [];
      activeDefects.clear();
      dirty = true;
      requestFrame();
    }

    updateReadout();
    scheduleNextRound();
  }

  function scheduleNextRound() {
    if (roundTimer) clearTimeout(roundTimer);
    const jitter = (Math.random() * 2 - 1) * ROUND_JITTER * ROUND_BASE_MS;
    const ms = Math.max(200, ROUND_BASE_MS + jitter);
    roundTimer = setTimeout(triggerRound, ms);
  }

  function replayOpener() {
    if (openerTimer) { clearTimeout(openerTimer); openerTimer = null; }
    isTypingOpener = false;
    openerFadeStart = null;
    openerBoxes = [];
    openerSegments = [];
    pendingErrors = [];
    activeDefects.clear();
    activeChains = [];
    if (session) session.clear();
    dirty = true;
    requestFrame();
    startOpeningSequence();
  }

  /**
   * Opening Sequence: types JASPER SANDS (or JS) in the Hybrid Quantum Diagnostic style:
   * - 56x56 glowing syndrome stabilizer box tiles
   * - Continuous illuminated Pauli error strings connecting qubit gates along strokes
   * - Dual-core qubit gate nodes at active intersections
   *
   * Plays completely without early mouse interruption, holds for 1.6s, then MWPM clears it.
   */
  function startOpeningSequence() {
    if (!session || session.d < 15 || isReducedMotion) {
      startScheduler();
      return;
    }

    if (openerTimer) { clearTimeout(openerTimer); openerTimer = null; }
    isTypingOpener = true;
    openerFadeStart = null;
    openerBoxes = [];
    openerSegments = [];
    pendingErrors = [];
    activeDefects.clear();
    activeChains = [];
    session.clear();

    heroEl.classList.add('hero--typing');
    const d = session.d;

    const topRow = Math.max(0, Math.floor(-fitGeom.originY / fitGeom.cell));
    const bottomRow = Math.min(d - 1, Math.ceil((height - fitGeom.originY) / fitGeom.cell));
    const midRow = Math.floor((topRow + bottomRow) / 2);

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
      heroEl.classList.remove('hero--typing');
      startScheduler();
      return;
    }

    let stepIdx = 0;
    // Deliberate rhythmic typing: 24ms per step (~2.4s total) on desktop, 70ms on mobile (~1.1s)
    const intervalMs = (d >= 23) ? 24 : 70;

    function typeNext() {
      if (!isTypingOpener) return;
      const now = performance.now();

      if (stepIdx < totalSteps) {
        if (stepIdx < boxesQueue.length) {
          const b = boxesQueue[stepIdx];
          openerBoxes.push({ r: b.r, c: b.c, t0: now });
        }

        if (stepIdx < pixelsQueue.length) {
          const p = pixelsQueue[stepIdx];
          const q = p.r * session.d + p.c;
          session.toggle(q, 'X');
          pendingErrors.push({ q, pauli: 'X', t0: now });
          physicalErrorsCount++;
          updateSyndromes(now);
        }

        const activeCoordSet = new Set(pendingErrors.map(e => e.q));
        openerSegments = segmentsQueue.filter(seg => {
          const q1 = seg.r1 * session.d + seg.c1;
          const q2 = seg.r2 * session.d + seg.c2;
          return activeCoordSet.has(q1) && activeCoordSet.has(q2);
        });

        stepIdx++;
        updateReadout();
        dirty = true;
        requestFrame();
        openerTimer = setTimeout(typeNext, intervalMs);
      } else {
        // Hold the completed name for 1600ms so the user can comfortably read it
        openerTimer = setTimeout(() => {
          if (!isTypingOpener) return;
          isTypingOpener = false;
          openerFadeStart = performance.now();
          heroEl.classList.remove('hero--typing');
          triggerRound();
          startScheduler();
        }, 1600);
      }
    }

    openerTimer = setTimeout(typeNext, 350);
  }

  function cancelOpener() {
    if (!isTypingOpener && !openerFadeStart) return;
    isTypingOpener = false;
    openerFadeStart = null;
    openerBoxes = [];
    openerSegments = [];
    heroEl.classList.remove('hero--typing');
    if (openerTimer) { clearTimeout(openerTimer); openerTimer = null; }
    if (pendingErrors.length > 0) {
      triggerRound();
    }
    startScheduler();
  }

  /**
   * Main animation rendering loop.
   */
  function render(now) {
    rafId = null;
    let keepAnimating = false;

    // Prune finished chains
    activeChains = activeChains.filter(ch => now - ch.t0 < ch.totalDur);
    if (activeChains.length > 0) keepAnimating = true;

    // Flash state
    let flashAlpha = 0;
    if (flashState) {
      const elapsed = now - flashState.t0;
      if (elapsed < flashState.duration) {
        flashAlpha = 0.14 * (1 - elapsed / flashState.duration);
        keepAnimating = true;
      } else {
        flashState = null;
      }
    }

    if (pointer.active && now - pointer.lastMove < 400) {
      keepAnimating = true;
    }
    if (pendingErrors.length > 0 || activeDefects.size > 0 || isTypingOpener || openerBoxes.length > 0 || openerSegments.length > 0 || openerFadeStart) {
      keepAnimating = true;
    }

    // 1. Draw static layer
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(staticCanvas, 0, 0, width, height);

    // 2. Matching graph overlay ('g' key debug)
    if (showMatchGraph && activeDefects.size > 1) {
      ctx.save();
      ctx.strokeStyle = palette.fg3;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.globalAlpha = 0.35;
      const defectList = Array.from(activeDefects.values());
      for (let i = 0; i < Math.min(16, defectList.length); i++) {
        for (let j = i + 1; j < Math.min(16, defectList.length); j++) {
          if (defectList[i].type === defectList[j].type) {
            const p1 = stabPixel(defectList[i].stab);
            const p2 = stabPixel(defectList[j].stab);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    // 3. Pointer heat glow
    if (pointer.active && fitGeom && !isTypingOpener) {
      const gradR = CURSOR_SIGMA * fitGeom.cell * 2.2;
      const grad = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, gradR);
      grad.addColorStop(0, palette.accent);
      grad.addColorStop(1, 'transparent');
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, gradR, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // 3.5. Opener Syndrome Boxes (Hybrid: 56x56 glowing syndrome tiles)
    if (openerBoxes.length > 0) {
      let boxAlpha = 0.38;
      if (openerFadeStart) {
        const fadeElapsed = now - openerFadeStart;
        boxAlpha *= Math.max(0, 1 - fadeElapsed / DUR_CHAIN_FADE);
        if (fadeElapsed >= DUR_CHAIN_FADE) openerBoxes = [];
      }
      ctx.save();
      openerBoxes.forEach(b => {
        const bx = fitGeom.originX + b.c * fitGeom.cell;
        const by = fitGeom.originY + b.r * fitGeom.cell;
        const cell = fitGeom.cell;
        const isX = (b.r + b.c) % 2 !== 0;
        const col = isX ? palette.x : palette.z;

        ctx.globalAlpha = boxAlpha;
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 4;

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(bx + 2, by + 2, cell - 4, cell - 4, 4);
        } else {
          ctx.rect(bx + 2, by + 2, cell - 4, cell - 4);
        }
        ctx.fill();
      });
      ctx.restore();
    }

    // 4. Lit defect stabilizers
    activeDefects.forEach(defect => {
      const st = defect.stab;
      pathStabilizer(ctx, st);
      ctx.save();
      const col = (defect.type === 'X') ? palette.x : palette.z;
      ctx.fillStyle = col;
      if (isTypingOpener) {
        ctx.globalAlpha = 0.08;
        ctx.shadowBlur = 0;
      } else {
        ctx.globalAlpha = 0.55;
        ctx.shadowColor = col;
        ctx.shadowBlur = 10;
      }
      ctx.fill();
      ctx.restore();
    });

    // 4.5. Opener Connecting Error Strings (Hybrid: continuous illuminated Pauli chains)
    if (openerSegments.length > 0) {
      let segAlpha = 1;
      if (openerFadeStart) {
        const fadeElapsed = now - openerFadeStart;
        segAlpha = Math.max(0, 1 - fadeElapsed / DUR_CHAIN_FADE);
        if (fadeElapsed >= DUR_CHAIN_FADE) openerSegments = [];
      }
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Outer glow & stroke
      ctx.strokeStyle = palette.x;
      ctx.lineWidth = 5.2;
      ctx.shadowColor = palette.x;
      ctx.shadowBlur = 6;
      ctx.globalAlpha = segAlpha;
      ctx.beginPath();
      openerSegments.forEach(seg => {
        const x1 = fitGeom.originX + seg.c1 * fitGeom.cell;
        const y1 = fitGeom.originY + seg.r1 * fitGeom.cell;
        const x2 = fitGeom.originX + seg.c2 * fitGeom.cell;
        const y2 = fitGeom.originY + seg.r2 * fitGeom.cell;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      });
      ctx.stroke();

      // Inner bright core
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.0;
      ctx.shadowBlur = 0;
      ctx.globalAlpha = segAlpha * 0.92;
      ctx.beginPath();
      openerSegments.forEach(seg => {
        const x1 = fitGeom.originX + seg.c1 * fitGeom.cell;
        const y1 = fitGeom.originY + seg.r1 * fitGeom.cell;
        const x2 = fitGeom.originX + seg.c2 * fitGeom.cell;
        const y2 = fitGeom.originY + seg.r2 * fitGeom.cell;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      });
      ctx.stroke();
      ctx.restore();
    }

    // 5. Pending error dots (qubit gates)
    pendingErrors.forEach(err => {
      const pt = qubitPixel(err.q);
      const col = (err.pauli === 'X') ? palette.x : (err.pauli === 'Z' ? palette.z : palette.y);
      const progress = Math.min(1, (now - err.t0) / DUR_ERROR_IN);
      const r = isTypingOpener ? 5.2 : (3 + 2.5 * progress);
      let dotAlpha = 1;
      if (openerFadeStart) {
        const fadeElapsed = now - openerFadeStart;
        dotAlpha = Math.max(0, 1 - fadeElapsed / DUR_CHAIN_FADE);
      }
      ctx.save();
      ctx.globalAlpha = dotAlpha;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = isTypingOpener ? 4 : 6;
      ctx.fill();

      if (isTypingOpener) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.0, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = dotAlpha * 0.92;
        ctx.fill();
      }

      ctx.restore();
    });

    // 6. Correction chains
    activeChains.forEach(ch => {
      if (ch.qubits.length < 1) return;
      const elapsed = now - ch.t0;
      let alpha = 1;
      if (elapsed > ch.drawDur + DUR_CHAIN_HOLD) {
        const fadeElapsed = elapsed - (ch.drawDur + DUR_CHAIN_HOLD);
        alpha = Math.max(0, 1 - fadeElapsed / DUR_CHAIN_FADE);
      }
      const drawProgress = Math.min(1, elapsed / ch.drawDur);
      const col = (ch.type === 'X') ? palette.z : palette.x; // Defect color repaired

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (ch.qubits.length === 1) {
        // Flash a halo circle on lone qubit
        const pt = qubitPixel(ch.qubits[0]);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 7 * drawProgress, 0, 2 * Math.PI);
        ctx.stroke();
      } else {
        // Draw polyline connecting qubits in order
        const pts = ch.qubits.map(qubitPixel);
        let totalLen = 0;
        const segLens = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
          segLens.push(l);
          totalLen += l;
        }

        const targetLen = totalLen * drawProgress;
        let drawn = 0;

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);

        for (let i = 0; i < pts.length - 1; i++) {
          const segL = segLens[i];
          if (drawn + segL <= targetLen) {
            ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
            drawn += segL;
          } else {
            const rem = targetLen - drawn;
            const frac = segL > 0 ? rem / segL : 0;
            const curX = pts[i].x + (pts[i + 1].x - pts[i].x) * frac;
            const curY = pts[i].y + (pts[i + 1].y - pts[i].y) * frac;
            ctx.lineTo(curX, curY);
            break;
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    });

    // 7. Logical error flash
    if (flashAlpha > 0) {
      ctx.save();
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = flashAlpha;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    if (keepAnimating) {
      requestFrame();
    } else {
      dirty = false;
    }
  }

  function requestFrame() {
    if (!rafId && !isReducedMotion) {
      rafId = requestAnimationFrame(render);
    }
  }

  // Pointer event listeners
  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (isPageMode || (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height)) {
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
      pointer.lastMove = performance.now();
      dirty = true;
      requestFrame();
    } else {
      if (pointer.active) {
        pointer.active = false;
        dirty = true;
        requestFrame();
      }
    }
  }

  function onPointerLeave() {
    pointer.active = false;
    dirty = true;
    requestFrame();
  }

  function setupPointerTracking() {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    window.addEventListener('pointercancel', onPointerLeave, { passive: true });
  }

  function setupControlsAndHotkeys() {
    if (dDecBtn) dDecBtn.addEventListener('click', () => setDistance((session ? session.d : 27) - 2));
    if (dIncBtn) dIncBtn.addEventListener('click', () => setDistance((session ? session.d : 27) + 2));

    if (replayBtn) {
      replayBtn.addEventListener('click', replayOpener);
    }

    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'r' || e.key === 'R') {
        replayOpener();
      } else if (e.key === '[') {
        setDistance((session ? session.d : 27) - 2);
      } else if (e.key === ']') {
        setDistance((session ? session.d : 27) + 2);
      } else if (e.key === 'b' || e.key === 'B') {
        triggerBurst();
      } else if (e.key === 'g' || e.key === 'G') {
        showMatchGraph = !showMatchGraph;
        dirty = true;
        requestFrame();
      }
    });
  }

  // Reduced motion mode
  function applyReducedMotion(matches) {
    isReducedMotion = matches;
    if (isReducedMotion) {
      if (openerTimer) clearTimeout(openerTimer);
      if (tickTimer) clearInterval(tickTimer);
      if (roundTimer) clearTimeout(roundTimer);
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (readoutEl) readoutEl.style.display = 'none';

      // Draw composed static frame
      if (session && fitGeom) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(staticCanvas, 0, 0, width, height);
      }
    } else {
      if (readoutEl) readoutEl.style.display = '';
      startScheduler();
      requestFrame();
    }
    updateCaption();
  }

  function startScheduler() {
    if (isReducedMotion) return;
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tickNoise, TICK_MS);
    scheduleNextRound();
  }

  function stopScheduler() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (roundTimer) { clearTimeout(roundTimer); roundTimer = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // Visibility & Intersection
  function onVisibilityChange() {
    if (document.hidden) {
      isVisible = false;
      stopScheduler();
    } else {
      isVisible = true;
      if (!isTypingOpener) startScheduler();
    }
  }

  // Initialization
  async function init() {
    updatePalette();

    const mediaReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    isReducedMotion = mediaReduced.matches;
    mediaReduced.addEventListener('change', e => applyReducedMotion(e.matches));

    // Watch for theme attribute changes
    new MutationObserver(() => {
      updatePalette();
      buildStaticLayer();
      dirty = true;
      requestFrame();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Sizing & Resize
    let resizeTimeout = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(resize, 150);
    });

    try {
      engine = await window.QEC.load('assets/stabilizer_qec.wasm');
      resize();
      setupPointerTracking();
      setupControlsAndHotkeys();

      // IntersectionObserver on hero (unless page mode)
      if (!isPageMode) {
        const io = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              isVisible = true;
              if (!isTypingOpener) startScheduler();
            } else {
              isVisible = false;
              stopScheduler();
            }
          });
        }, { threshold: 0.05 });
        io.observe(heroEl);
      }

      document.addEventListener('visibilitychange', onVisibilityChange);

      // Fade canvas in
      canvas.style.transition = `opacity ${DUR_LATTICE_FADE_IN}ms ease-out`;
      canvas.style.opacity = '1';

      if (!isReducedMotion) {
        startOpeningSequence();
      } else {
        applyReducedMotion(true);
      }
    } catch (err) {
      console.warn('Surface code engine fallback:', err);
      heroEl.classList.add('static');
      if (captionEl) captionEl.style.display = 'none';
      if (readoutEl) readoutEl.style.display = 'none';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
