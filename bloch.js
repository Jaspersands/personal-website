/* bloch.js - Minimal Bloch Sphere Hero Controller (Plan C) */
((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function dot(u, v) { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; }
  function cross(u, v) {
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  }

  function slerp(v0, v1, t) {
    const c = Math.max(-1, Math.min(1, dot(v0, v1)));
    if (c > 0.9995) {
      return normalize([v0[0] + t * (v1[0] - v0[0]), v0[1] + t * (v1[1] - v0[1]), v0[2] + t * (v1[2] - v0[2])]);
    }
    const o = Math.acos(c), s = Math.sin(o);
    const a = Math.sin((1 - t) * o) / s, b = Math.sin(t * o) / s;
    return [a * v0[0] + b * v1[0], a * v0[1] + b * v1[1], a * v0[2] + b * v1[2]];
  }

  function projectPoint(v, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const x1 = v[0] * cy - v[1] * sy, y1 = v[0] * sy + v[1] * cy, z1 = v[2];
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    return [x1, -(y1 * sp + z1 * cp), y1 * cp - z1 * sp];
  }

  const exports = { normalize, dot, cross, slerp, projectPoint };
  if (typeof document === 'undefined') return exports;

  const canvas = document.getElementById('bloch-canvas');
  const heroEl = document.querySelector('.hero');
  if (!canvas || !heroEl) return exports;

  const ctx = canvas.getContext('2d'), root = document.documentElement;
  const TILT = 0.349, YAW_S = (2 * Math.PI) / 90000, PREC_S = (2 * Math.PI) / 12000;
  const THETA = 0.96, FPS = 1000 / 30;

  let colors = {};
  function updatePalette() {
    const s = getComputedStyle(root);
    colors = {
      rule: s.getPropertyValue('--rule').trim() || '#e5e1d7',
      accent: s.getPropertyValue('--accent').trim() || '#8a3218',
      fg2: s.getPropertyValue('--fg-2').trim() || '#55534b'
    };
  }
  updatePalette();
  new MutationObserver(updatePalette).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  let W = 0, H = 0, R = 0, cx = 0, cy = 0;
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width || 320; H = r.height || 320;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2; R = (Math.min(W, H) / 2) * 0.76;
  }
  window.addEventListener('resize', resize);
  resize();

  let tGlanceY = 0, tGlanceP = 0, glanceY = 0, glanceP = 0;
  heroEl.addEventListener('mousemove', e => {
    const r = heroEl.getBoundingClientRect();
    tGlanceY = ((e.clientX - r.left) / r.width - 0.5) * 0.209;
    tGlanceP = -((e.clientY - r.top) / r.height - 0.5) * 0.105;
  });
  heroEl.addEventListener('mouseleave', () => { tGlanceY = 0; tGlanceP = 0; });

  let isGate = false, gateStart = 0, gateV0 = [0,0,1], gateV1 = [0,0,1];
  let nextGate = Date.now() + 9000 + Math.random() * 5000;
  const trail = [];

  function pickTarget() {
    const th = (0.2 + Math.random() * 0.6) * Math.PI, ph = Math.random() * 2 * Math.PI;
    return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
  }

  let isPaused = false, lastTime = 0;
  function render(time) {
    if (isPaused) return;
    requestAnimationFrame(render);
    if (time - lastTime < FPS) return;
    lastTime = time - ((time - lastTime) % FPS);

    const now = Date.now();
    glanceY += (tGlanceY - glanceY) * 0.08;
    glanceP += (tGlanceP - glanceP) * 0.08;
    const yaw = now * YAW_S + glanceY, pitch = TILT + glanceP;

    let v;
    if (isGate) {
      const p = Math.min(1, (now - gateStart) / 900);
      v = slerp(gateV0, gateV1, 0.5 - 0.5 * Math.cos(Math.PI * p));
      if (p >= 1) { isGate = false; nextGate = now + 9000 + Math.random() * 5000; }
    } else {
      const ph = now * PREC_S;
      v = [Math.sin(THETA) * Math.cos(ph), Math.sin(THETA) * Math.sin(ph), Math.cos(THETA)];
      if (now >= nextGate) { isGate = true; gateStart = now; gateV0 = v.slice(); gateV1 = pickTarget(); }
    }

    ctx.clearRect(0, 0, W, H);

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = colors.rule;
    ctx.lineWidth = 1;
    ctx.stroke();

    drawRing(yaw, pitch, a => [Math.cos(a), Math.sin(a), 0]);
    drawRing(yaw, pitch, a => [Math.cos(a), 0, Math.sin(a)]);
    drawRing(yaw, pitch, a => [0, Math.cos(a), Math.sin(a)]);

    const zT = projectPoint([0, 0, 1.18], yaw, pitch);
    const zB = projectPoint([0, 0, -1.18], yaw, pitch);
    ctx.beginPath();
    ctx.moveTo(cx + zB[0] * R, cy + zB[1] * R);
    ctx.lineTo(cx + zT[0] * R, cy + zT[1] * R);
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '500 13px Newsreader, Georgia, serif';
    ctx.fillStyle = colors.fg2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('|0⟩', cx + zT[0] * R, cy + zT[1] * R - 4);
    ctx.textBaseline = 'top';
    ctx.fillText('|1⟩', cx + zB[0] * R, cy + zB[1] * R + 4);

    const pT = projectPoint(v, yaw, pitch);
    const pO = projectPoint([0, 0, 0], yaw, pitch);
    const pD = projectPoint([v[0], v[1], 0], yaw, pitch);
    const tx = cx + pT[0] * R, ty = cy + pT[1] * R;

    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(cx + pD[0] * R, cy + pD[1] * R);
    ctx.lineTo(cx + pO[0] * R, cy + pO[1] * R);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.setLineDash([]);

    trail.push({ x: tx, y: ty, t: now });
    while (trail.length && now - trail[0].t > 1500) trail.shift();
    if (trail.length > 1) {
      for (let i = 1; i < trail.length; i++) {
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1;
        ctx.globalAlpha = (1 - (now - trail[i].t) / 1500) * 0.35;
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(cx + pO[0] * R, cy + pO[1] * R);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.75;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent;
    ctx.fill();
  }

  function drawRing(yaw, pitch, ptFn) {
    let prev = null;
    for (let i = 0; i <= 64; i++) {
      const p = projectPoint(ptFn((i / 64) * Math.PI * 2), yaw, pitch);
      const px = cx + p[0] * R, py = cy + p[1] * R;
      if (prev) {
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(px, py);
        ctx.strokeStyle = colors.rule;
        ctx.lineWidth = 1;
        ctx.globalAlpha = p[2] > 0 ? 0.75 : 0.22;
        ctx.stroke();
      }
      prev = { x: px, y: py };
    }
    ctx.globalAlpha = 1;
  }

  new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        if (isPaused) { isPaused = false; lastTime = performance.now(); requestAnimationFrame(render); }
      } else { isPaused = true; }
    });
  }, { threshold: 0.05 }).observe(heroEl);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) isPaused = true;
    else { isPaused = false; lastTime = performance.now(); requestAnimationFrame(render); }
  });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    isPaused = true;
    render(performance.now());
  } else {
    requestAnimationFrame(render);
  }

  return exports;
});
