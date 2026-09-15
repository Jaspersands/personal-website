/* field.js - Living Surface Code Hero Controller (Plan A) */
(() => {
  'use strict';

  const svg = document.querySelector('.hero .field'), hero = document.querySelector('.hero');
  if (!svg || !hero || !window.SC) return;

  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a = {}) => {
    const e = document.createElementNS(NS, n);
    for (const k in a) e.setAttribute(k, a[k]);
    return e;
  };

  const D = window.innerWidth < 760 ? 5 : window.innerWidth < 1100 ? 7 : 9;
  const lat = window.SC.lattice(D);
  let errors = new Array(lat.numQubits).fill(0);

  const SP = D === 9 ? 60 : D === 7 ? 68 : 52, PAD = 36;
  const px = c => PAD + c * SP, py = r => PAD + r * SP;
  const dim = PAD * 2 + (D - 1) * SP;

  svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
  svg.replaceChildren();

  const gPlaq = el('g'), gLink = el('g'), gMatch = el('g'), gDot = el('g');
  svg.append(gPlaq, gLink, gMatch, gDot);

  for (let r = 0; r < D; r++) {
    for (let c = 0; c < D; c++) {
      if (c < D - 1) gLink.append(el('line', { x1: px(c), y1: py(r), x2: px(c + 1), y2: py(r), class: 'latt', 'stroke-width': 1 }));
      if (r < D - 1) gLink.append(el('line', { x1: px(c), y1: py(r), x2: px(c), y2: py(r + 1), class: 'latt', 'stroke-width': 1 }));
    }
  }

  const rr = SP / 2;
  const plaqNodes = lat.stabilizers.map(s => {
    const cls = 'plaq ' + (s.type === 'Z' ? 'z' : 'x');
    let node;
    if (s.shape === 'face') {
      node = el('rect', { x: px(s.c), y: py(s.r), width: SP, height: SP, class: cls });
    } else {
      const d = s.shape === 'top' ? `M ${px(s.c)} ${py(0)} A ${rr} ${rr} 0 0 1 ${px(s.c + 1)} ${py(0)} Z`
        : s.shape === 'bottom' ? `M ${px(s.c)} ${py(D - 1)} A ${rr} ${rr} 0 0 0 ${px(s.c + 1)} ${py(D - 1)} Z`
        : s.shape === 'left' ? `M ${px(0)} ${py(s.r)} A ${rr} ${rr} 0 0 0 ${px(0)} ${py(s.r + 1)} Z`
        : `M ${px(D - 1)} ${py(s.r)} A ${rr} ${rr} 0 0 1 ${px(D - 1)} ${py(s.r + 1)} Z`;
      node = el('path', { d, class: cls });
    }
    node.setAttribute('fill-opacity', '0.06');
    node.setAttribute('stroke-opacity', '0.35');
    node.setAttribute('stroke-width', '1');
    gPlaq.append(node);
    return node;
  });

  const cooldowns = new Map(), CHARS = ['', 'X', 'Z', 'Y'], dotNodes = [];
  for (let r = 0; r < D; r++) {
    for (let c = 0; c < D; c++) {
      const qId = lat.idx(r, c);
      const g = el('g', { class: 'qdot-hero' });
      const circle = el('circle', { cx: px(c), cy: py(r), r: D === 9 ? 6.5 : 7.5, class: 'qd', 'stroke-width': 1 });
      const txt = el('text', { x: px(c), y: py(r) + 3, 'text-anchor': 'middle', class: 'qlbl' });
      g.append(circle, txt);

      g.addEventListener('pointerenter', () => {
        const now = Date.now();
        if (now - (cooldowns.get(qId) || 0) < 600) return;
        cooldowns.set(qId, now);
        if (errors.filter(e => e > 0).length < 5) {
          errors[qId] = errors[qId] === 1 ? 0 : 1;
          render();
          schedDecode();
        }
      });

      g.addEventListener('click', e => {
        e.stopPropagation();
        errors[qId] = (errors[qId] + 1) % 4;
        render();
        schedDecode();
      });

      gDot.append(g);
      dotNodes.push({ circle, txt });
    }
  }

  function render() {
    const syn = window.SC.syndrome(lat, errors);
    const lit = new Set(syn.litIds);
    lat.stabilizers.forEach((s, i) => {
      const on = lit.has(s.id);
      plaqNodes[i].setAttribute('fill-opacity', on ? '0.62' : '0.06');
      plaqNodes[i].setAttribute('stroke-opacity', on ? '1' : '0.35');
      plaqNodes[i].setAttribute('stroke-width', on ? '1.75' : '1');
    });
    errors.forEach((e, i) => {
      const { circle, txt } = dotNodes[i];
      circle.classList.remove('ex', 'ez', 'ey');
      if (e === 1) circle.classList.add('ex');
      else if (e === 2) circle.classList.add('ez');
      else if (e === 3) circle.classList.add('ey');
      txt.textContent = CHARS[e];
    });
  }

  let decTimer = null, isDecoding = false;
  function schedDecode() {
    if (!errors.some(e => e > 0) || isDecoding || decTimer) return;
    decTimer = setTimeout(execDecode, 1200 * (0.7 + Math.random() * 0.6));
  }

  function execDecode() {
    decTimer = null;
    if (!errors.some(e => e > 0)) return;
    isDecoding = true;

    const syn = window.SC.syndrome(lat, errors);
    if (!syn.litIds.length) { isDecoding = false; return; }

    const mZ = window.SC.match(lat, syn.litZ, 'Z');
    const mX = window.SC.match(lat, syn.litX, 'X');
    gMatch.replaceChildren();

    const pairs = [...mZ.pairs.map(p => ({ ...p, t: 'Z' })), ...mX.pairs.map(p => ({ ...p, t: 'X' }))];
    pairs.forEach(p => {
      const sA = lat.stabilizers[p.a];
      let x1 = px(sA.cx), y1 = py(sA.cy), x2, y2;
      if (p.b === -1) {
        if (sA.shape === 'top') { x2 = x1; y2 = py(0) - SP / 2; }
        else if (sA.shape === 'bottom') { x2 = x1; y2 = py(D - 1) + SP / 2; }
        else if (sA.shape === 'left') { x2 = px(0) - SP / 2; y2 = y1; }
        else if (sA.shape === 'right') { x2 = px(D - 1) + SP / 2; y2 = y1; }
        else {
          const m = Math.min(sA.r, D - 2 - sA.r, sA.c, D - 2 - sA.c);
          x2 = (m === sA.c) ? px(0) - 8 : (m === D - 2 - sA.c) ? px(D - 1) + 8 : x1;
          y2 = (m === sA.r) ? py(0) - 8 : (m === D - 2 - sA.r) ? py(D - 1) + 8 : y1;
        }
      } else {
        const sB = lat.stabilizers[p.b];
        x2 = px(sB.cx); y2 = py(sB.cy);
      }
      const len = Math.hypot(x2 - x1, y2 - y1);
      const line = el('line', {
        x1, y1, x2, y2, class: 'match ' + (p.t === 'Z' ? 'mz' : 'mx'),
        'stroke-width': 2, 'stroke-dasharray': `${len} ${len}`, 'stroke-dashoffset': len
      });
      gMatch.append(line);
      requestAnimationFrame(() => {
        line.style.transition = 'stroke-dashoffset 400ms ease-out';
        line.setAttribute('stroke-dashoffset', '0');
      });
    });

    setTimeout(() => {
      const flipsZ = window.SC.correctionPath(mZ);
      const flipsX = window.SC.correctionPath(mX);
      [...flipsZ, ...flipsX].forEach(q => dotNodes[q].circle.classList.add('flash-correct'));

      setTimeout(() => {
        errors = window.SC.applyCorrection(errors, flipsZ, 'Z');
        errors = window.SC.applyCorrection(errors, flipsX, 'X');
        gMatch.replaceChildren();
        [...flipsZ, ...flipsX].forEach(q => dotNodes[q].circle.classList.remove('flash-correct'));
        render();
        isDecoding = false;
      }, 250);
    }, 900);
  }

  let pTimer = null, isPaused = false;
  function schedPoisson() {
    if (isPaused) return;
    pTimer = setTimeout(() => {
      if (!isPaused && errors.filter(e => e > 0).length < 5) {
        const qId = Math.floor(Math.random() * lat.numQubits);
        const r = Math.random();
        errors[qId] = r < 0.45 ? 1 : r < 0.9 ? 2 : 3;
        render();
        schedDecode();
      }
      schedPoisson();
    }, -Math.log(Math.max(1e-6, Math.random())) * 1800);
  }

  new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        if (isPaused) { isPaused = false; schedPoisson(); schedDecode(); }
      } else {
        isPaused = true;
        clearTimeout(pTimer); clearTimeout(decTimer); decTimer = null;
      }
    });
  }, { threshold: 0.05 }).observe(hero);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      isPaused = true;
      clearTimeout(pTimer); clearTimeout(decTimer); decTimer = null;
    } else {
      isPaused = false;
      schedPoisson(); schedDecode();
    }
  });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    isPaused = true;
    errors[Math.floor(lat.numQubits / 2)] = 1;
    render();
  } else {
    render();
    setTimeout(schedPoisson, 1000);
  }
})();
