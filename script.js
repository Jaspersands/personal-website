(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a = {}) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const $ = id => document.getElementById(id);
  const root = document.documentElement;

  /* ============ Theme ============ */
  $('theme').onclick = () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

  /* ============ Nav / progress / reveal / spy ============ */
  const nav = $('nav'), bar = $('progress');
  const onScroll = () => {
    nav.classList.toggle('stuck', scrollY > 8);
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('.rv').forEach(n => io.observe(n));

  const links = [...document.querySelectorAll('.nav .link')];
  const spy = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const href = '#' + e.target.id;
    if (!links.some(l => l.getAttribute('href') === href)) return;   // ignore unlinked sections
    links.forEach(l => l.classList.toggle('on', l.getAttribute('href') === href));
  }), { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main section[id]').forEach(s => spy.observe(s));

  /* ================================================================
     DEMO 1 — Rotated surface code, d = 5.
     Verified: 12 X + 12 Z stabilisers, weight 4 in the bulk and 2 on
     the boundary, every X/Z pair overlapping on an even number of
     qubits (i.e. they all commute), no uncovered data qubit.
     Z-type detects X errors, X-type detects Z, Y trips both.
     NOTE: colour comes from CSS classes, never from a transitioned
     var() — transitioning stroke on an SVG element whose value is a
     var() reference freezes the colour when the palette changes.
     ================================================================ */
  const D = 5, SP = 46, PAD = 40;
  const px = c => PAD + c * SP, py = r => PAD + r * SP;
  const svg = $('sc');
  const err = new Array(D * D).fill(0);          // 0=I 1=X 2=Z 3=Y
  const idx = (r, c) => r * D + c;
  const NAME = ['none', 'X', 'Z', 'Y'];

  const stabs = [];
  for (let r = 0; r < D - 1; r++) for (let c = 0; c < D - 1; c++) {
    stabs.push({
      type: (r + c) % 2 === 0 ? 'Z' : 'X',
      q: [idx(r, c), idx(r, c + 1), idx(r + 1, c), idx(r + 1, c + 1)],
      x: px(c) + SP / 2, y: py(r) + SP / 2, shape: 'face', r, c
    });
  }
  stabs.push(
    ...[0, 2].map(c => ({ type: 'X', q: [idx(0, c), idx(0, c + 1)], x: px(c) + SP / 2, y: py(0) - SP / 2.6, shape: 'top', c })),
    ...[1, 3].map(c => ({ type: 'X', q: [idx(D - 1, c), idx(D - 1, c + 1)], x: px(c) + SP / 2, y: py(D - 1) + SP / 2.6, shape: 'bottom', c })),
    ...[1, 3].map(r => ({ type: 'Z', q: [idx(r, 0), idx(r + 1, 0)], x: px(0) - SP / 2.6, y: py(r) + SP / 2, shape: 'left', r })),
    ...[0, 2].map(r => ({ type: 'Z', q: [idx(r, D - 1), idx(r + 1, D - 1)], x: px(D - 1) + SP / 2.6, y: py(r) + SP / 2, shape: 'right', r })
    ));
  $('sc-d').textContent = stabs.length + ' stab.';

  const fires = s => s.q.reduce((n, q) => {
    const e = err[q];
    return n + ((s.type === 'Z' ? (e === 1 || e === 3) : (e === 2 || e === 3)) ? 1 : 0);
  }, 0) % 2 === 1;

  const gPlaq = el('g'), gLink = el('g'), gMatch = el('g'), gDot = el('g');
  svg.append(gPlaq, gLink, gMatch, gDot);

  for (let r = 0; r < D; r++) for (let c = 0; c < D; c++) {
    if (c < D - 1) gLink.append(el('line', { x1: px(c), y1: py(r), x2: px(c + 1), y2: py(r), class: 'latt', 'stroke-width': 1 }));
    if (r < D - 1) gLink.append(el('line', { x1: px(c), y1: py(r), x2: px(c), y2: py(r + 1), class: 'latt', 'stroke-width': 1 }));
  }

  const plaqNodes = stabs.map(s => {
    const cls = 'plaq ' + (s.type === 'Z' ? 'z' : 'x');
    let node;
    if (s.shape === 'face') {
      node = el('rect', { x: px(s.c), y: py(s.r), width: SP, height: SP, class: cls });
    } else {
      const rr = SP / 2;
      const d = s.shape === 'top' ? `M ${px(s.c)} ${py(0)} A ${rr} ${rr} 0 0 1 ${px(s.c + 1)} ${py(0)} Z`
        : s.shape === 'bottom' ? `M ${px(s.c)} ${py(D - 1)} A ${rr} ${rr} 0 0 0 ${px(s.c + 1)} ${py(D - 1)} Z`
          : s.shape === 'left' ? `M ${px(0)} ${py(s.r)} A ${rr} ${rr} 0 0 0 ${px(0)} ${py(s.r + 1)} Z`
            : `M ${px(D - 1)} ${py(s.r)} A ${rr} ${rr} 0 0 1 ${px(D - 1)} ${py(s.r + 1)} Z`;
      node = el('path', { d, class: cls });
    }
    node.setAttribute('fill-opacity', .07);
    node.setAttribute('stroke-opacity', .35);
    node.setAttribute('stroke-width', 1);
    gPlaq.append(node);
    return node;
  });

  const dotNodes = [];
  for (let r = 0; r < D; r++) for (let c = 0; c < D; c++) {
    const i = idx(r, c);
    const g = el('g', { class: 'qdot', role: 'button', tabindex: '0' });
    const circle = el('circle', { cx: px(c), cy: py(r), r: 8, class: 'qd', 'stroke-width': 1 });
    const txt = el('text', { x: px(c), y: py(r) + 3, 'text-anchor': 'middle', class: 'qlbl' });
    g.append(circle, txt);
    const cycle = () => { err[i] = (err[i] + 1) % 4; draw(); };
    g.addEventListener('click', cycle);
    g.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); cycle(); }
    });
    gDot.append(g);
    dotNodes.push({ circle, txt, g, r, c });
  }

  let showMatch = false;

  function draw() {
    const lit = [];
    stabs.forEach((s, i) => {
      const on = fires(s);
      if (on) lit.push(s);
      plaqNodes[i].setAttribute('fill-opacity', on ? .55 : .07);
      plaqNodes[i].setAttribute('stroke-opacity', on ? 1 : .35);
      plaqNodes[i].setAttribute('stroke-width', on ? 1.5 : 1);
    });

    err.forEach((e, i) => {
      const { circle, txt, g, r, c } = dotNodes[i];
      circle.classList.remove('ex', 'ez', 'ey');
      if (e === 1) circle.classList.add('ex');
      else if (e === 2) circle.classList.add('ez');
      else if (e === 3) circle.classList.add('ey');
      txt.textContent = e ? NAME[e] : '';
      g.setAttribute('aria-label', `Qubit row ${r + 1} column ${c + 1}, error ${NAME[e]}`);
    });

    gMatch.replaceChildren();
    if (showMatch) {
      ['X', 'Z'].forEach(t => {
        const pool = lit.filter(s => s.type === t);
        const used = new Set();
        pool.forEach((a, i) => {
          if (used.has(i)) return;
          let best = -1, bd = Infinity;
          pool.forEach((b, j) => {
            if (j <= i || used.has(j)) return;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < bd) { bd = d; best = j; }
          });
          if (best >= 0) {
            used.add(i); used.add(best);
            const b = pool[best];
            gMatch.append(el('line', {
              x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'match ' + (t === 'Z' ? 'mz' : 'mx'),
              'stroke-width': 1.75, 'stroke-dasharray': '3 2', 'stroke-linecap': 'round'
            }));
          }
        });
      });
    }

    $('sc-e').textContent = err.filter(e => e).length;
    $('sc-s').textContent = lit.length;
  }

  $('sc-clear').onclick = () => { err.fill(0); draw(); };
  $('sc-rand').onclick = () => {
    const p = +$('sc-p').value / 100;
    for (let i = 0; i < err.length; i++) err[i] = Math.random() < p ? 1 + Math.floor(Math.random() * 3) : 0;
    draw();
  };
  $('sc-match').onclick = e => {
    showMatch = !showMatch;
    e.currentTarget.classList.toggle('on', showMatch);
    e.currentTarget.setAttribute('aria-pressed', String(showMatch));
    draw();
  };
  $('sc-p').oninput = e => { $('sc-pv').textContent = (e.target.value / 100).toFixed(2); };
  draw();

  /* ================================================================
     Plot helpers. Colour always via class, never a transitioned var().
     ================================================================ */
  const W = 300, H = 190, L = 38, R = 10, T = 12, B = 30;
  const iw = W - L - R, ih = H - T - B;

  function axes(target, { xlab, ylab, xticks, yticks }) {
    target.replaceChildren();
    const g = el('g');
    g.append(el('line', { x1: L, y1: T, x2: L, y2: T + ih, class: 'axis', 'stroke-width': 1 }));
    g.append(el('line', { x1: L, y1: T + ih, x2: L + iw, y2: T + ih, class: 'axis', 'stroke-width': 1 }));
    xticks.forEach(([v, lab]) => {
      const x = L + v * iw;
      g.append(el('line', { x1: x, y1: T, x2: x, y2: T + ih, class: 'gridline', 'stroke-width': 1 }));
      const t = el('text', { x, y: T + ih + 11, 'text-anchor': 'middle', class: 'tick' });
      t.textContent = lab; g.append(t);
    });
    yticks.forEach(([v, lab]) => {
      const y = T + ih - v * ih;
      g.append(el('line', { x1: L, y1: y, x2: L + iw, y2: y, class: 'gridline', 'stroke-width': 1 }));
      const t = el('text', { x: L - 5, y: y + 3, 'text-anchor': 'end', class: 'tick' });
      t.textContent = lab; g.append(t);
    });
    const xl = el('text', { x: L + iw / 2, y: H - 4, 'text-anchor': 'middle', class: 'lbl' });
    xl.textContent = xlab; g.append(xl);
    const yl = el('text', { x: 8, y: T + ih / 2, 'text-anchor': 'middle', class: 'lbl', transform: `rotate(-90 8 ${T + ih / 2})` });
    yl.textContent = ylab; g.append(yl);
    target.append(g);
    return g;
  }

  const dOf = pts => pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  const line = (pts, cls, extra = {}) => el('path', Object.assign({
    d: dOf(pts), fill: 'none', class: cls, 'stroke-width': 1.75,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round'
  }, extra));

  const legend = (g, items, x, y) => items.forEach(([lab, cls], i) => {
    const yy = y + i * 11;
    g.append(el('line', { x1: x, y1: yy, x2: x + 12, y2: yy, class: cls, 'stroke-width': 1.75 }));
    const t = el('text', { x: x + 16, y: yy + 3, class: 'lbl' });
    t.textContent = lab; g.append(t);
  });

  /* ============ DEMO 2 — query scaling ============ */
  {
    const g = axes($('scale'), {
      xlab: 'target precision  log₁₀(1/ε)', ylab: 'log₁₀ queries',
      xticks: [[0, '1'], [1 / 3, '2'], [2 / 3, '3'], [1, '4']],
      yticks: [[0, '1'], [1 / 7, '2'], [3 / 7, '4'], [5 / 7, '6'], [1, '8']]
    });
    const X = u => L + u * iw, Y = y => T + ih - ((y - 1) / 7) * ih;
    const pts = slope => Array.from({ length: 61 }, (_, i) => { const u = i / 60; return [X(u), Y(slope * (1 + 3 * u))]; });
    g.append(line(pts(2), 's-a', { 'stroke-dasharray': '4 3' }));
    g.append(line(pts(1), 's-b'));
    legend(g, [['classical  1/ε²', 's-a'], ['IQAE  1/ε', 's-b']], L + 8, T + 10);

    const rule = el('line', { class: 'axis', 'stroke-width': 1, 'stroke-dasharray': '2 2' });
    const mc = el('circle', { r: 3.5, class: 'm-a' });
    const mq = el('circle', { r: 3.5, class: 'm-b' });
    g.append(rule, mc, mq);

    const fmt = n => n >= 1e6 ? n.toExponential(1).replace('e+', '×10^') : Math.round(n).toLocaleString();
    const upd = () => {
      const e = +$('eps').value / 10, u = (e - 1) / 3, x = X(u);
      mc.setAttribute('cx', x); mc.setAttribute('cy', Y(2 * e));
      mq.setAttribute('cx', x); mq.setAttribute('cy', Y(e));
      rule.setAttribute('x1', x); rule.setAttribute('x2', x);
      rule.setAttribute('y1', Y(2 * e)); rule.setAttribute('y2', T + ih);
      $('epsv').textContent = '1e-' + e.toFixed(1);
      $('r-c').textContent = fmt(10 ** (2 * e));
      $('r-q').textContent = fmt(10 ** e);
      $('r-s').textContent = fmt(10 ** e) + '×';
    };
    $('eps').oninput = upd; upd();
  }

  /* ============ DEMO 3 — anneal schedule ============
     s(t) = 0.5 + 0.5·sign(u)·|u|^k with u = 2t-1.
     k = 1 is exactly linear; k > 1 flattens the sweep through s꜀,
     where the gap closes and adiabaticity is hardest to hold.      */
  {
    const g = axes($('sweep'), {
      xlab: 'normalized time  t', ylab: 's(t)',
      xticks: [[0, '0'], [.5, '0.5'], [1, '1']],
      yticks: [[0, '0'], [.5, 's꜀'], [1, '1']]
    });
    const X = t => L + t * iw, Y = s => T + ih - s * ih;
    g.append(el('rect', { x: L, y: Y(.55), width: iw, height: Y(.45) - Y(.55), class: 'critband' }));
    g.append(line(Array.from({ length: 81 }, (_, i) => { const t = i / 80; return [X(t), Y(t)]; }), 's-a', { 'stroke-dasharray': '4 3' }));
    const curve = line([[0, 0]], 's-b');
    g.append(curve);
    legend(g, [['linear', 's-a'], ['flattened', 's-b']], L + 8, T + 10);

    const s_of = (t, k) => { const u = 2 * t - 1; return .5 + .5 * Math.sign(u) * Math.abs(u) ** k; };
    const frac = k => { let n = 0; const N = 2000; for (let i = 0; i <= N; i++) if (Math.abs(s_of(i / N, k) - .5) <= .05) n++; return n / (N + 1); };
    const linShare = (frac(1) * 100).toFixed(0) + '%';

    const upd = () => {
      const k = +$('swk').value / 10;
      $('swkv').textContent = k.toFixed(1);
      curve.setAttribute('d', dOf(Array.from({ length: 161 }, (_, i) => { const t = i / 160; return [X(t), Y(s_of(t, k))]; })));
      $('sw-a').textContent = linShare;
      $('sw-b').textContent = (frac(k) * 100).toFixed(0) + '%';
    };
    $('swk').oninput = upd; upd();
  }

  /* ============ DEMO 4 — entanglement entropy across cuts ============
     product S=0 · GHZ S=1 · Ising at criticality (c=1/2) log law ·
     Haar volume law at the Page value min(l,n-l) - 1/(2 ln2).
     Bars are built once and only their geometry animates.          */
  {
    const N_Q = 12, MAXS = 6;
    const fam = {
      product: () => 0,
      ghz: () => 1,
      ising: l => Math.max(0, (0.5 / 3) * Math.log2((N_Q / Math.PI) * Math.sin(Math.PI * l / N_Q)) + 0.85),
      haar: l => Math.max(0, Math.min(l, N_Q - l) - 1 / (2 * Math.LN2))
    };
    const g = axes($('ent'), {
      xlab: 'cut position  ℓ', ylab: 'S(ℓ)  bits',
      xticks: [[0, '1'], [.5, '6'], [1, '11']],
      yticks: [[0, '0'], [.5, '3'], [1, '6']]
    });
    const bw = iw / (N_Q - 1);
    const bars = Array.from({ length: N_Q - 1 }, (_, i) => {
      const b = el('rect', { x: L + i * bw + bw * .18, y: T + ih, width: bw * .64, height: 0, class: 'bar' });
      g.append(b); return b;
    });
    const render = which => {
      const f = fam[which];
      const vals = bars.map((_, i) => f(i + 1));
      vals.forEach((v, i) => {
        const h = Math.max(0, Math.min(v / MAXS, 1)) * ih;
        bars[i].setAttribute('y', T + ih - h);
        bars[i].setAttribute('height', h);
      });
      const mx = Math.max(...vals);
      $('ent-max').textContent = mx.toFixed(2);
      const chi = Math.round(2 ** mx);
      $('ent-chi').textContent = chi >= 1000 ? chi.toExponential(1) : chi;
    };
    $('ent-ctl').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $('ent-ctl').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      render(b.dataset.s);
    });
    render('ising');
  }
})();
