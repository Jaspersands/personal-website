# CV

`cv.html` is the source of truth. `assets/jaspersands_cv.pdf` — the file the site
links — is generated from it.

```bash
npm i -D playwright && npx playwright install chromium

node cv/build.mjs      # -> assets/jaspersands_cv.pdf, stamps the site's ?v= cache key
node cv/measure.mjs    # page-break report + cv/preview-N.png per page
```

## Three pages

Unlike the résumé this is deliberately multi-page, so there is no one-page guard.
`build.mjs` instead **exits non-zero when the last page is under 12% full**, because a
final page holding two lines reads as an accident rather than a choice.

Page count is not just flow height over page height. Every `.entry` sets
`break-inside: avoid`, so an entry that would straddle a break is pushed whole onto
the next page and leaves dead space behind. `measure.mjs` walks that same rule and
reports where each break lands and how much it costs:

```
flow 2732px -> paginated 2776px across 3 page(s); 44px lost at breaks
  page 1: 98% full
  page 2: 98% full
  page 3: 91% full
```

It also lists the blocks whose last line is nearly empty. Those are the cheapest
place to buy a line back — a few words cut reclaims the whole line — and they are how
this got from four pages to three without dropping any content.

Page geometry lives in `build.mjs` (`MARGIN`, `CONTENT_W`, `PAGE_H`); `measure.mjs`
imports it, so change it in one place.

## Keeping it consistent with the résumé and the site

The CV is a superset of `resume/resume.html` and the timeline in `index.html`. Dates,
titles, and figures appear in all three, so a change to one is a change to all three.
The `?v=` cache key stamped into `index.html` is a hash of `cv.html`, not of the PDF —
Chromium writes a creation timestamp into every render, so hashing the output would
churn the key on builds that changed nothing.
