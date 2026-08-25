// Renders cv.html to assets/jaspersands_cv.pdf, and stamps index.html's CV link
// with a hash of the source so a replaced PDF is not served stale for four hours.
//
//   npm i -D playwright && npx playwright install chromium
//   node cv/build.mjs
//
// Unlike the résumé this is deliberately multi-page, so there is no one-page
// guard. It reports the page count instead, and fails on a near-empty last page.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, 'cv.html');
const out = resolve(here, '..', 'assets', 'jaspersands_cv.pdf');

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
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const page = await openCV(browser);

  await page.pdf({
    path: out,
    format: 'Letter',
    printBackground: true,
    margin: {
      top: `${MARGIN.top}in`, bottom: `${MARGIN.bottom}in`,
      left: `${MARGIN.left}in`, right: `${MARGIN.right}in`,
    },
  });

  const height = await contentHeight(page);
  await browser.close();

  const pages = Math.ceil(height / PAGE_H);
  const lastPageFill = ((height % PAGE_H) || PAGE_H) / PAGE_H;
  console.log(
    `wrote ${out} — ${height.toFixed(0)}px, ${pages} page(s), ` +
    `last page ${(lastPageFill * 100).toFixed(0)}% full`
  );
  // A final page holding a couple of lines looks like an accident.
  if (pages > 1 && lastPageFill < 0.12) {
    console.error(
      `ERROR: last page is only ${(lastPageFill * 100).toFixed(0)}% full. ` +
      `Trim to ${pages - 1} pages or add enough to justify the ${pages}th.`
    );
    process.exit(1);
  }

  const idx = resolve(here, '..', 'index.html');
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
