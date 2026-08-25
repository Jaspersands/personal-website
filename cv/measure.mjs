// Dev helper for editing cv.html. Reports where the page breaks actually land, how
// full each page is, and which blocks end on a nearly empty line, then writes one
// preview PNG per page.
//
//   node cv/measure.mjs
//
// Flow height alone understates the page count: an entry carrying break-inside:avoid
// is pushed whole onto the next page, so the real cost of a break is the dead space
// it leaves behind. This walks the same rule Chromium applies.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, openCV, PAGE_H, CONTENT_W } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await openCV(browser);

const items = await page.evaluate(() =>
  [...document.body.children].map(el => ({
    top: el.getBoundingClientRect().top,
    bottom: el.getBoundingClientRect().bottom,
    // An h2 must not be left stranded at the foot of a page without its first entry.
    keepNext: el.tagName === 'H2',
    text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 56),
  })));

const flow = items[items.length - 1].bottom;
let pageNo = 1, offset = 0, waste = 0;
const cuts = [0], breaks = [];
for (let i = 0; i < items.length; i++) {
  const it = items[i];
  const end = it.keepNext && items[i + 1] ? items[i + 1].bottom : it.bottom;
  if (end - offset > PAGE_H * pageNo) {
    const dead = PAGE_H * pageNo - (it.top - offset);
    cuts.push(it.top);
    breaks.push({ pageNo, dead, before: it.text });
    offset -= dead;
    waste += dead;
    pageNo++;
  }
}
cuts.push(flow);
const paginated = flow - offset;

console.log(`flow ${flow.toFixed(0)}px -> paginated ${paginated.toFixed(0)}px across ` +
  `${Math.ceil(paginated / PAGE_H)} page(s); ${waste.toFixed(0)}px lost at breaks`);
for (let i = 0; i < cuts.length - 1; i++) {
  const fill = (cuts[i + 1] - cuts[i]) / PAGE_H;
  console.log(`  page ${i + 1}: ${(fill * 100).toFixed(0)}% full`);
}
for (const b of breaks) {
  console.log(`  break after page ${b.pageNo}: ${b.dead.toFixed(0)}px dead before "${b.before}"`);
}

// Blocks whose last line is nearly empty are the cheapest place to buy a line back:
// a few words cut reclaims the whole line.
const orphans = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('li, .note, .skill')) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = [];
    for (const r of range.getClientRects()) {
      if (r.height <= 2) continue;
      const hit = lines.find(l => Math.abs(l.top - r.top) < 4);
      if (hit) hit.right = Math.max(hit.right, r.right);
      else lines.push({ top: r.top, right: r.right });
    }
    if (lines.length < 2) continue;
    const box = el.getBoundingClientRect();
    const last = lines.reduce((a, b) => (b.top > a.top ? b : a), lines[0]);
    out.push({
      fill: (last.right - box.left) / box.width,
      lineH: box.height / lines.length,
      text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 66),
    });
  }
  return out.sort((a, b) => a.fill - b.fill).slice(0, 10);
});

console.log('\nblocks ending on a nearly empty line (cheapest trims first):');
for (const o of orphans) {
  console.log(`  ${(o.fill * 100).toFixed(0).padStart(3)}% full, saves ${o.lineH.toFixed(0)}px  ${o.text}`);
}

await page.setViewportSize({ width: Math.round(CONTENT_W), height: Math.ceil(flow) + 20 });
for (let i = 0; i < cuts.length - 1; i++) {
  await page.screenshot({
    path: resolve(here, `preview-${i + 1}.png`),
    clip: { x: 0, y: cuts[i], width: CONTENT_W, height: cuts[i + 1] - cuts[i] },
  });
}
console.log(`\nwrote cv/preview-1..${cuts.length - 1}.png`);

await browser.close();
