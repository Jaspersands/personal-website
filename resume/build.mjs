// Renders resume.html to assets/jaspersands_resume.pdf.
//
//   npm i -D playwright && npx playwright install chromium
//   node resume/build.mjs
//
// The résumé is a strict one-pager: this fails the build rather than quietly
// shipping two pages.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, 'resume.html');
const out = resolve(here, '..', 'assets', 'jaspersands_resume.pdf');

// Page geometry. measure.mjs mirrors these — keep them in sync.
export const DPI = 96;
export const MARGIN = { top: 0.45, bottom: 0.38, left: 0.55, right: 0.55 }; // inches
export const CONTENT_W = (8.5 - MARGIN.left - MARGIN.right) * DPI;
export const CONTENT_H = (11 - MARGIN.top - MARGIN.bottom) * DPI;

// Prefer a local install; fall back to a global one.
export async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const require = createRequire(import.meta.url);
    const globalRoot = require('node:child_process')
      .execSync('npm root -g', { encoding: 'utf8' })
      .trim();
    const mod = await import(`${globalRoot}/playwright/index.js`);
    return (mod.default ?? mod).chromium;
  }
}

// scrollHeight gets clamped up to the window height, which hides overflow, so
// lay out at exact print width in a viewport tall enough to never clamp.
export async function contentHeight(page) {
  return page.evaluate(() => {
    const r = document.body.getBoundingClientRect();
    return r.bottom + parseFloat(getComputedStyle(document.body).marginBottom || 0);
  });
}

export async function openResume(browser) {
  const page = await browser.newPage({
    viewport: { width: Math.round(CONTENT_W), height: 3000 },
  });
  await page.goto('file://' + src, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  return page;
}

// Running this file directly builds the PDF; measure.mjs imports the helpers.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const page = await openResume(browser);

  await page.pdf({
    path: out,
    format: 'Letter',
    printBackground: true,
    margin: {
      top: `${MARGIN.top}in`,
      bottom: `${MARGIN.bottom}in`,
      left: `${MARGIN.left}in`,
      right: `${MARGIN.right}in`,
    },
  });

  const height = await contentHeight(page);
  await browser.close();

  const pct = (height / CONTENT_H) * 100;
  console.log(
    `wrote ${out} — ${height.toFixed(0)}px / ${CONTENT_H.toFixed(0)}px (${pct.toFixed(1)}% of one page)`
  );
  if (height > CONTENT_H) {
    console.error(
      `ERROR: content overflows one page by ${Math.round(height - CONTENT_H)}px. Trim before shipping.`
    );
    process.exit(1);
  }
}
