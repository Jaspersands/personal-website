/* csm-view.js — the thesis demo: a synthetic isolated-mode charge-stability
   map is acquired row by row, screened by CSMClassifier, and (if clean) read
   out by ChargeLineNet — compact reimplementations of the two networks of
   Vallabhapurapu et al., arXiv:2607.20871, trained on synthetic maps and run
   in a Web Worker in the visitor's browser. A classical column-profile
   counter (the paper's Appendix J baseline) runs alongside for contrast. */
(() => {
  'use strict';
  const root = document.getElementById('csm-demo');
  if (!root || !window.CSMGen || !window.CSMDecode) return;
  const $ = id => document.getElementById(id);
  const map = $('csm-map'), overlay = $('csm-overlay'), heatC = $('csm-heat');
  const stageEl = $('csm-stage'), readoutEl = $('csm-readout'), metricsEl = $('csm-metrics');
  const bars = { clean: $('csm-bar-clean'), unstable: $('csm-bar-unstable'), unclear: $('csm-bar-unclear') };
  const G = window.CSMGen, D = window.CSMDecode, H = G.H, W = G.W;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T = { ACQUIRE: 2500, HOLD_OK: 4500, HOLD_REJECT: 2600, JUMP_DX: [6, 11] };
  const CLASS_MIX = [['clean', .55], ['degraded', .15], ['unstable', .15], ['unclear', .15]];
  const MODEL_URLS = { classifier: 'assets/models/classifier.json', compact: 'assets/models/compact.json', full: 'assets/models/full.json' };

  /* ---------------- colours ---------------- */
  const hexToRgb = h => { h = h.trim().replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  let col = {};
  function readColours() {
    const cs = getComputedStyle(document.documentElement), get = n => hexToRgb(cs.getPropertyValue(n) || '#888');
    col = { fg: get('--fg'), fg3: get('--fg-3'), accent: get('--accent'), x: get('--x'), z: get('--z'), bg: get('--bg') };
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /* ---------------- worker ---------------- */
  const worker = new Worker('csm-worker.js');
  const pending = new Map(); let nextId = 1;
  const loaded = new Set(), loading = new Map();
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'loaded') { loaded.add(m.name); const r = loading.get(m.name); if (r) { r.resolve(m); loading.delete(m.name); } }
    else if (m.type === 'error' && m.id == null) { const r = loading.get(m.name); if (r) { r.reject(new Error(m.message)); loading.delete(m.name); } }
    else if (m.type === 'result' || m.type === 'error') { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m); } }
  };
  worker.onerror = e => { for (const [, r] of loading) r.reject(new Error(e.message || 'worker error')); loading.clear(); for (const [, p] of pending) p.reject(new Error(e.message || 'worker error')); pending.clear(); };
  const load = name => loaded.has(name) ? Promise.resolve() : (loading.has(name) ? loading.get(name).promise : (() => {
    let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    loading.set(name, { promise, resolve, reject }); worker.postMessage({ type: 'load', name, url: MODEL_URLS[name] }); return promise;
  })());
  const run = (name, img) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); const copy = new Float32Array(img); worker.postMessage({ type: 'run', name, id, img: copy }, [copy.buffer]); });

  /* ---------------- state ---------------- */
  const S = { rng: G.makeRng((Date.now() & 0xffff) ^ 0x5eed), img: null, label: null, revealed: 0, model: 'compact', cycle: 0, timer: 0, raf: 0, running: false, params: {}, result: null, busy: false };
  const dpr = Math.min(2, devicePixelRatio || 1);
  const mctx = map.getContext('2d'), octx = overlay.getContext('2d'), hctx = heatC.getContext('2d');
  overlay.width = 256 * dpr; overlay.height = 256 * dpr;

  /* ---------------- drawing ---------------- */
  const mapImage = mctx.createImageData(W, H);
  function drawMap(rows) {
    const d = mapImage.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (y < rows) { const v = Math.round(S.img[y * W + x] * 255); d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; }
      else { d[i] = 12; d[i + 1] = 12; d[i + 2] = 12; d[i + 3] = 255; }
    }
    mctx.putImageData(mapImage, 0, 0);
  }
  function drawScanline(rows) {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, 256, 256);
    if (rows < H) { octx.fillStyle = rgba(col.accent, 0.8); octx.fillRect(0, rows * 2 - 1, 256, 2); }
  }
  function drawOverlay(lines, n) {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, 256, 256);
    octx.lineWidth = 1.25; octx.font = '10px "JetBrains Mono", ui-monospace, monospace'; octx.textAlign = 'center'; octx.textBaseline = 'middle';
    for (const l of lines) {
      octx.strokeStyle = rgba(col.accent, 0.9); octx.beginPath(); octx.moveTo(l.xs * 2, l.ys * 2); octx.lineTo(l.xe * 2, l.ye * 2); octx.stroke();
      octx.fillStyle = 'rgb(80,220,120)'; octx.beginPath(); octx.moveTo(l.xs * 2, l.ys * 2 + 5); octx.lineTo(l.xs * 2 - 5, l.ys * 2 + 12); octx.lineTo(l.xs * 2 + 5, l.ys * 2 + 12); octx.closePath(); octx.fill();
      octx.fillStyle = 'rgb(230,150,60)'; octx.beginPath(); octx.moveTo(l.xe * 2, l.ye * 2 - 5); octx.lineTo(l.xe * 2 - 5, l.ye * 2 - 12); octx.lineTo(l.xe * 2 + 5, l.ye * 2 - 12); octx.closePath(); octx.fill();
    }
    // charge regions between lines: (N,0) ... (0,N) left to right (paper Fig. 1b)
    if (n > 0 && n <= 8) {
      const xs = lines.map(l => (l.xs + l.xe) / 2 * 2);
      const edges = [0, ...xs, 256];
      for (let k = 0; k <= n; k++) {
        const cx = (edges[k] + edges[k + 1]) / 2, label = `(${n - k},${k})`;
        if (edges[k + 1] - edges[k] < 22) continue;
        octx.fillStyle = 'rgba(0,0,0,0.55)'; octx.fillRect(cx - 17, 232, 34, 14);
        octx.fillStyle = 'rgba(255,255,255,0.92)'; octx.fillText(label, cx, 239);
      }
    }
  }
  const heatImage = hctx.createImageData(W, H);
  function drawHeat(heat) {
    const d = heatImage.data;
    for (let i = 0; i < W * H; i++) {
      const v = Math.max(-1, Math.min(1, heat[i])), o = i * 4;
      const g = 18 + Math.round(Math.abs(v) * 40);
      if (v >= 0) { d[o] = g + Math.round(v * 60); d[o + 1] = g + Math.round(v * 200); d[o + 2] = g + Math.round(v * 100); }
      else { d[o] = g + Math.round(-v * 220); d[o + 1] = g + Math.round(-v * 130); d[o + 2] = g + Math.round(-v * 40); }
      d[o + 3] = 255;
    }
    hctx.putImageData(heatImage, 0, 0);
  }
  function clearHeat() { hctx.fillStyle = '#121212'; hctx.fillRect(0, 0, W, H); }
  function setBars(p) {
    for (const k of ['clean', 'unstable', 'unclear']) {
      const v = p ? p[k] : 0, row = bars[k].closest('.csm-bar');
      bars[k].style.width = `${(v * 100).toFixed(0)}%`;
      row.classList.toggle('on', !!p && v >= 0.5);
      row.querySelector('.csm-bar-val').textContent = p ? v.toFixed(2) : '·';
    }
  }
  const stage = (text, cls) => { stageEl.textContent = text; stageEl.className = 'csm-stage' + (cls ? ' ' + cls : ''); };

  /* ---------------- pipeline ---------------- */
  function newDevice() {
    const cls = S.rng.choiceP(CLASS_MIX.map(c => c[0]), CLASS_MIX.map(c => c[1]));
    const { img, label } = G.generate(S.rng, cls);
    S.img = img; S.label = label; S.result = null; S.cycle++;
    drawOverlay([], 0); clearHeat(); setBars(null); readoutEl.textContent = '';
  }
  function acquire() {
    return new Promise(resolve => {
      const t0 = performance.now(); const cycle = S.cycle;
      const step = t => {
        if (cycle !== S.cycle || !S.running) return resolve(false);
        S.revealed = reduced ? H : Math.min(H, Math.floor((t - t0) / T.ACQUIRE * H));
        drawMap(S.revealed); drawScanline(S.revealed);
        if (S.revealed < H) S.raf = requestAnimationFrame(step); else resolve(true);
      };
      stage('acquiring · sweeping P1 − P2 against ΔJ', 'acquiring');
      S.raf = requestAnimationFrame(step);
    });
  }
  async function analyse() {
    const cycle = S.cycle, img = S.img;
    stage('CSMClassifier · screening quality', 'thinking');
    await load('classifier');
    const c = await run('classifier', img);
    if (cycle !== S.cycle) return;
    const probs = { clean: c.out.probs[0], unstable: c.out.probs[1], unclear: c.out.probs[2] };
    setBars(probs);
    const classical = D.classicalCount(img, H, W);
    if (probs.unstable >= 0.5 || probs.unclear >= 0.5 || probs.clean < 0.5) {
      const why = probs.unstable >= 0.5 ? 'unstable — charge jumped mid-scan' : probs.unclear >= 0.5 ? 'unclear — lines not countable' : 'not clean';
      stage(`rejected · ${why} · re-measure`, 'reject');
      readoutEl.innerHTML = `classifier ${c.ms.toFixed(0)} ms · classical counter would report <b>${classical.count}</b>`;
      S.result = { rejected: true };
      return;
    }
    stage(`ChargeLineNet (${S.model}) · locating transition lines`, 'thinking');
    await load(S.model);
    if (cycle !== S.cycle) return;
    const r = await run(S.model, img);
    if (cycle !== S.cycle) return;
    const lines = D.decodeLines(r.out.heat, H, W);
    drawHeat(r.out.heat); drawOverlay(lines, lines.length);
    const n = lines.length;
    stage(`clean · ${n} transition line${n === 1 ? '' : 's'} → N = ${n} electron${n === 1 ? '' : 's'}`, 'ok');
    readoutEl.innerHTML = `ChargeLineNet <b>N = ${n}</b> in ${r.ms.toFixed(0)} ms (${(S.params[S.model] || 0).toLocaleString()} params) · classical profile counter <b>${classical.count}</b> · classifier ${c.ms.toFixed(0)} ms`;
    S.result = { n, lines, classical: classical.count };
  }
  async function cycleOnce() {
    newDevice();
    const ok = await acquire();
    if (!ok) return;
    try { await analyse(); } catch (err) { stage('model unavailable — ' + err.message, 'reject'); S.running = false; return; }
    if (!S.running || reduced) return;
    const hold = S.result && S.result.rejected ? T.HOLD_REJECT : T.HOLD_OK;
    S.timer = setTimeout(() => { if (S.running) cycleOnce(); }, hold);
  }
  function start() { if (S.running) return; S.running = true; cycleOnce(); }
  function stop() { S.running = false; clearTimeout(S.timer); cancelAnimationFrame(S.raf); }

  /* ---------------- interactions ---------------- */
  overlay.addEventListener('click', async e => {
    if (!S.img || reduced) return;
    const rect = overlay.getBoundingClientRect();
    const row = Math.max(8, Math.min(H - 8, Math.floor((e.clientY - rect.top) / rect.height * H)));
    const dx = (S.rng.random() < 0.5 ? -1 : 1) * Math.round(S.rng.uniform(T.JUMP_DX[0], T.JUMP_DX[1]));
    S.img = G.injectJump(S.img, row, dx); S.label = { ...S.label, unstable: true };
    clearTimeout(S.timer); cancelAnimationFrame(S.raf); S.cycle++;
    S.revealed = H; drawMap(H); drawScanline(H); drawOverlay([], 0); clearHeat();
    stage(`charge jump injected at row ${row} (${dx > 0 ? '+' : ''}${dx} px) · re-analysing`, 'thinking');
    try { await analyse(); } catch (err) { stage('model unavailable — ' + err.message, 'reject'); return; }
    if (S.running) S.timer = setTimeout(() => { if (S.running) cycleOnce(); }, T.HOLD_OK);
  });
  root.querySelectorAll('[data-model]').forEach(btn => btn.addEventListener('click', async () => {
    const name = btn.dataset.model; if (name === S.model) return;
    root.querySelectorAll('[data-model]').forEach(b => b.classList.toggle('on', b === btn));
    S.model = name;
    if (!loaded.has(name)) { stage(`loading the ${name} model…`, 'thinking'); await load(name); }
    if (S.img && S.result && !S.result.rejected) { clearTimeout(S.timer); S.cycle++; try { await analyse(); } catch (e) { /* stage set below */ } if (S.running) S.timer = setTimeout(() => { if (S.running) cycleOnce(); }, T.HOLD_OK); }
  }));

  /* ---------------- boot ---------------- */
  readColours();
  new MutationObserver(readColours).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  worker.addEventListener('message', e => { if (e.data.type === 'loaded') { S.params[e.data.name] = e.data.params; const b = root.querySelector(`[data-model="${e.data.name}"]`); if (b) b.textContent = `${e.data.name} · ${(e.data.params / 1000).toFixed(0)}k`; } });
  fetch('assets/models/csm-metrics.json').then(r => r.json()).then(m => {
    const pct = v => (v * 100).toFixed(1) + ' %';
    metricsEl.innerHTML = `Held-out synthetic maps (${m.heldout.toLocaleString()}): exact line count — compact <b>${pct(m.lines.compact.exact)}</b>, full <b>${pct(m.lines.full.exact)}</b>, classical counter <b>${pct(m.lines.classical.exact)}</b> · classifier macro accuracy <b>${pct(m.classifier.macro)}</b>.`;
  }).catch(() => { metricsEl.textContent = ''; });
  clearHeat(); setBars(null);
  const onScreen = () => { const r = root.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  let poll = 0;
  const loop = () => { clearTimeout(poll); if (document.hidden || !onScreen()) { stop(); poll = setTimeout(loop, 500); } else { start(); poll = setTimeout(loop, 1000); } };
  if (reduced) { S.running = true; cycleOnce(); }
  else { loop(); addEventListener('scroll', () => { if (!S.running) loop(); }, { passive: true }); document.addEventListener('visibilitychange', loop); }
  // debug/verification handle: run one device synchronously (no acquisition animation)
  window.__csm = { S, run, load, newDevice, analyse, async once(cls) {
    stop(); if (cls) { const { img, label } = G.generate(S.rng, cls); S.img = img; S.label = label; S.result = null; S.cycle++; drawOverlay([], 0); clearHeat(); setBars(null); } else newDevice();
    S.revealed = H; drawMap(H); drawScanline(H); await analyse(); return S.result;
  } };
})();
