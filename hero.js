/**
 * hero.js - Controller for the living surface code hero (Plan A+)
 *
 * Drives full-bleed Canvas 2D rotated surface code via stabilizer_qec.wasm
 * and HeroMath. Cursor acts as a heat source; rounds extract syndromes and
 * execute exact MWPM decoding in WebAssembly; logical errors trigger full-canvas flare.
 */
(() => {
  'use strict';

  // Tunable constants
  const CELL_DESKTOP = 56;
  const CELL_TABLET = 48;
  const CELL_MOBILE = 44;
  const D_MAX = 31;
  const AMBIENT_RATE = 0.6;          // errors/sec across whole lattice
  const CURSOR_PEAK = 2.5;           // errors/sec per qubit at pointer center
  const CURSOR_SIGMA = 1.1;          // cells
  const PAULI_X_WEIGHT = 0.45;
  const PAULI_Z_WEIGHT = 0.45;       // remainder 0.10 is Y
  const ROUND_BASE_MS = 700;
  const ROUND_JITTER = 0.15;
  const MAX_PENDING = 60;
  const TICK_MS = 50;

  // Animation durations (ms)
  const DUR_ERROR_IN = 180;
  const DUR_DEFECT_IN = 220;
  const DUR_CHAIN_DRAW = 350;
  const DUR_CHAIN_HOLD = 250;
  const DUR_CHAIN_FADE = 300;
  const DUR_LOGICAL_FLASH = 650;
  const DUR_LATTICE_FADE_IN = 600;

  // DOM elements
  const heroEl = document.querySelector('.hero');
  const canvas = document.querySelector('canvas.field');
  const readoutEl = document.getElementById('hero-readout');
  const roundsValEl = document.getElementById('hr-rounds');
  const physValEl = document.getElementById('hr-phys');
  const logicValEl = document.getElementById('hr-logic');
  const captionEl = document.querySelector('.hero-caption');

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
  let rafId = null;
  let tickTimer = null;
  let roundTimer = null;

  // Statistics
  let roundsCount = 0;
  let physicalErrorsCount = 0;
  let logicalErrorsCount = 0;

  // Active items
  let pendingErrors = []; // { q, pauli, t0 }
  let activeDefects = new Map(); // stabIdx -> { t0, type, x, y }
  let activeChains = []; // { type, qubits: [q...], t0, duration }
  let flashState = null; // { t0, duration }
  let pointer = { x: -9999, y: -9999, active: false, lastMove: 0 };
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
      staticCtx.globalAlpha = 0.07;
      staticCtx.fill();
      staticCtx.strokeStyle = (st.type === 'X') ? palette.x : palette.z;
      staticCtx.globalAlpha = 0.25;
      staticCtx.lineWidth = 1;
      staticCtx.stroke();
    }

    // 2. Hairline lattice grid
    staticCtx.strokeStyle = palette.rule;
    staticCtx.globalAlpha = 0.5;
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
    staticCtx.globalAlpha = 0.45;
    for (let i = 0; i < session.numQubits; i++) {
      const pt = qubitPixel(i);
      staticCtx.beginPath();
      staticCtx.arc(pt.x, pt.y, 3, 0, 2 * Math.PI);
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

  function updateCaption() {
    if (!captionEl || !session) return;
    const d = session.d;
    if (isReducedMotion) {
      captionEl.innerHTML = `A distance-${d} rotated surface code, decoded live by my Rust simulator compiled to WebAssembly. <a href="https://qcompiler.jaspersands.com/" target="_blank" rel="noopener">Full simulator →</a>`;
    } else {
      captionEl.innerHTML = `A distance-${d} rotated surface code, decoded live by my Rust simulator compiled to WebAssembly. Move the pointer to add noise. A chain of errors across the whole width is a logical error — see if you can cause one. <a href="https://qcompiler.jaspersands.com/" target="_blank" rel="noopener">Full simulator →</a>`;
    }
  }

  function updateReadout() {
    if (roundsValEl) roundsValEl.textContent = roundsCount.toLocaleString();
    if (physValEl) physValEl.textContent = physicalErrorsCount.toLocaleString();
    if (logicValEl) logicValEl.textContent = logicalErrorsCount.toLocaleString();
  }

  /**
   * Periodic noise scheduler.
   */
  function tickNoise() {
    if (!session || !isVisible || isReducedMotion) return;
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
    if (pendingErrors.length > 0 || activeDefects.size > 0) {
      keepAnimating = true;
    }

    // 1. Draw static layer
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(staticCanvas, 0, 0, width, height);

    // 2. Pointer heat glow
    if (pointer.active && fitGeom) {
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

    // 3. Lit defect stabilizers
    activeDefects.forEach(defect => {
      const st = defect.stab;
      pathStabilizer(ctx, st);
      ctx.save();
      const col = (defect.type === 'X') ? palette.x : palette.z;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.55;
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();
    });

    // 4. Pending error dots
    pendingErrors.forEach(err => {
      const pt = qubitPixel(err.q);
      const col = (err.pauli === 'X') ? palette.x : (err.pauli === 'Z' ? palette.z : palette.y);
      const progress = Math.min(1, (now - err.t0) / DUR_ERROR_IN);
      const r = 3 + 2.5 * progress;
      ctx.save();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.restore();
    });

    // 5. Correction chains
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

    // 6. Logical error flash
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
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    pointer.active = true;
    pointer.lastMove = performance.now();
    dirty = true;
    requestFrame();
  }

  function onPointerLeave() {
    pointer.active = false;
    dirty = true;
    requestFrame();
  }

  function setupPointerTracking() {
    const target = isPageMode ? window : heroEl;
    target.addEventListener('pointermove', onPointerMove, { passive: true });
    target.addEventListener('pointerleave', onPointerLeave, { passive: true });
    target.addEventListener('pointercancel', onPointerLeave, { passive: true });
  }

  // Reduced motion mode
  function applyReducedMotion(matches) {
    isReducedMotion = matches;
    if (isReducedMotion) {
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
      startScheduler();
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

      // IntersectionObserver on hero (unless page mode)
      if (!isPageMode) {
        const io = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              isVisible = true;
              startScheduler();
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
        startScheduler();
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
