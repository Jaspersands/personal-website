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
  const linkFor = s => links.find(l => l.getAttribute('href') === '#' + s.id) || null;
  const inView = new Set();   // sections currently crossing the spy band, so leaving one clears its link
  const spy = new IntersectionObserver(es => {
    es.forEach(e => { if (e.isIntersecting) inView.add(e.target); else inView.delete(e.target); });
    const cur = [...inView].map(linkFor).find(Boolean) || null;   // unlinked sections (Skills, Outside) highlight nothing
    links.forEach(l => l.classList.toggle('on', l === cur));
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main section[id]').forEach(s => spy.observe(s));

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

  /* ============ DEMO 3 — Shor on the simulated machine ============
     ft-algorithms data/results/shor, N = 35, p = 0.1%: share of runs landing
     on an ideal peak at each code distance, with cultivated and injected magic
     states. Measured on the simulated machine, not extrapolated.            */
  {
    const D = [9, 11, 13, 15, 17, 19];
    const cult = [0.006, 0.288, 0.703, 0.775, 0.794, 0.790];
    const inj = [0.003, 0.222, 0.549, 0.607, 0.612, null];   // d = 19 not run: the floor is reached
    const faults = [20.7, 2.48, 0.289, 0.033, 0.004, 0.0004];
    const NOISELESS = 0.79;
    const g = axes($('shor'), {
      xlab: 'code distance  d', ylab: 'peak probability',
      xticks: D.map((d, i) => [i / (D.length - 1), String(d)]),
      yticks: [[0, '0'], [.5, '0.5'], [1, '1']]
    });
    const X = i => L + (i / (D.length - 1)) * iw, Y = v => T + ih - v * ih;
    g.append(el('line', { x1: L, y1: Y(NOISELESS), x2: L + iw, y2: Y(NOISELESS), class: 'axis', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
    const nl = el('text', { x: L + iw - 2, y: Y(NOISELESS) - 4, 'text-anchor': 'end', class: 'tick' });
    nl.textContent = 'noiseless 0.79'; g.append(nl);
    const pts = vals => vals.map((v, i) => v == null ? null : [X(i), Y(v)]).filter(Boolean);
    g.append(line(pts(inj), 's-a', { 'stroke-dasharray': '4 3' }));
    g.append(line(pts(cult), 's-b'));
    legend(g, [['cultivated', 's-b'], ['injected', 's-a']], L + 8, T + 10);
    const rule = el('line', { class: 'axis', 'stroke-width': 1, 'stroke-dasharray': '2 2', y1: T, y2: T + ih });
    const mc = el('circle', { r: 3.5, class: 'm-b' });
    const mi = el('circle', { r: 3.5, class: 'm-a' });
    g.append(rule, mc, mi);
    const upd = () => {
      const d = +$('shd').value, i = D.indexOf(d), x = X(i);
      rule.setAttribute('x1', x); rule.setAttribute('x2', x);
      mc.setAttribute('cx', x); mc.setAttribute('cy', Y(cult[i]));
      const j = inj[i] == null ? i - 1 : i;
      mi.setAttribute('cx', X(j)); mi.setAttribute('cy', Y(inj[j]));
      $('shdv').textContent = d;
      $('sh-c').textContent = cult[i].toFixed(2);
      $('sh-i').textContent = inj[i] == null ? '≈ ' + inj[j].toFixed(2) : inj[i].toFixed(2);
      $('sh-f').textContent = faults[i] >= 1 ? faults[i].toFixed(1) : faults[i].toPrecision(1);
    };
    $('shd').oninput = upd; upd();
  }
})();
