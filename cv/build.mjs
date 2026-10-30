// Renders cv.html to assets/jaspersands_cv.pdf, and stamps index.html's CV link
// with a hash of the source so a replaced PDF is not served stale for four hours.
//
//   npm i -D playwright && npx playwright install chromium
//   node cv/build.mjs          # the two-page CV -> assets/jaspersands_cv.pdf
//
// Unlike the résumé this is deliberately two pages, so there is no one-page guard.
// The build fails if the render is not exactly two pages, or if the last page is too
// empty to look deliberate.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, 'cv.html');

export const PDF = 'jaspersands_cv.pdf';
export const PAGES = 2;

export const DPI = 96;
export const MARGIN = { top: 0.55, bottom: 0.5, left: 0.7, right: 0.7 }; // inches
export const CONTENT_W = (8.5 - MARGIN.left - MARGIN.right) * DPI;
export const PAGE_H = (11 - MARGIN.top - MARGIN.bottom) * DPI;

export async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const require = createRequire(import.meta.url);
    const root = require('node:child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
    const mod = await import(`${root}/playwright/index.js`);
    return (mod.default ?? mod).chromium;
  }
}

// Real page count, read back out of the rendered file. Flow height over page height
// undercounts: every .entry sets break-inside:avoid, so one that would straddle a
// break is pushed whole onto the next page and leaves dead space behind. Estimating
// it is how a "two-page" CV shipped with a third page holding one line.
export function pdfPageCount(buf) {
  const s = buf.toString('latin1');
  const count = s.match(/\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/);
  if (count) return Number(count[1]);
  return (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

export async function contentHeight(page) {
  return page.evaluate(() => {
    const r = document.body.getBoundingClientRect();
    return r.bottom + parseFloat(getComputedStyle(document.body).marginBottom || 0);
  });
}

export async function openCV(browser) {
  const page = await browser.newPage({
    viewport: { width: Math.round(CONTENT_W), height: 3000 },
  });
  await page.goto('file://' + src, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  return page;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const out = resolve(here, '..', 'assets', PDF);

  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const page = await openCV(browser);

  const buf = await page.pdf({
    path: out,
    format: 'Letter',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;padding:0 0.7in;font:8.5pt \'Liberation Serif\',\'Times New Roman\',serif;' +
      'color:#444;display:flex;justify-content:space-between;">' +
      '<span>Jasper Sands</span>' +
      '<span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    margin: {
      top: `${MARGIN.top}in`, bottom: `${MARGIN.bottom}in`,
      left: `${MARGIN.left}in`, right: `${MARGIN.right}in`,
    },
  });

  const height = await contentHeight(page);
  await browser.close();

  const pages = pdfPageCount(buf);
  const lastPageFill = (height - (pages - 1) * PAGE_H) / PAGE_H;
  console.log(
    `wrote ${out} — ${height.toFixed(0)}px of flow, ${pages} rendered page(s), ` +
    `last page ${(Math.max(lastPageFill, 0) * 100).toFixed(0)}% full`
  );
  if (pages !== PAGES) {
    console.error(
      `ERROR: the CV is ${PAGES} pages but rendered ${pages}. ` +
      `Run cv/measure.mjs to see where the breaks fall.`
    );
    process.exit(1);
  }
  // A final page holding a couple of lines looks like an accident.
  if (pages > 1 && lastPageFill < 0.12) {
    console.error(`ERROR: last page is only ${(lastPageFill * 100).toFixed(0)}% full.`);
    process.exit(1);
  }

  const idx = resolve(here, '..', 'index.html');
  // Hash the source, not the PDF: Chromium writes a creation time into every render.
  const hash = createHash('sha256').update(readFileSync(src)).digest('hex').slice(0, 8);
  const html = readFileSync(idx, 'utf8');
  const re = /(href="assets\/jaspersands_cv\.pdf)(\?v=[^"]*)?"/;
  if (!re.test(html)) {
    console.error('ERROR: no CV link found in index.html; cache key not stamped.');
    process.exit(1);
  }
  const stamped = html.replace(re, `$1?v=${hash}"`);
  if (stamped !== html) {
    writeFileSync(idx, stamped);
    console.log(`stamped index.html CV link with ?v=${hash}`);
  } else {
    console.log(`index.html already at ?v=${hash}`);
  }
}
