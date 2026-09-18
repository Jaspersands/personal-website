// Dev helper: reports how much of the single page the résumé fills and writes
// resume/preview.png (gitignored) for eyeballing the layout.
//
//   node resume/measure.mjs

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, openResume, contentHeight, CONTENT_H } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await openResume(browser);

const h = await contentHeight(page);
const slack = CONTENT_H - h;
console.log(
  `content ${h.toFixed(1)}px / budget ${CONTENT_H.toFixed(0)}px -> ${((h / CONTENT_H) * 100).toFixed(1)}%` +
  `  (slack ${slack.toFixed(0)}px, ~${(slack / 12).toFixed(1)} lines)`
);

await page.screenshot({ path: resolve(here, 'preview.png'), fullPage: true });
await browser.close();
