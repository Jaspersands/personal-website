# CV

`cv.html` is the source of truth for the CV, a two-page document. `assets/jaspersands_cv.pdf`,
the file the site links, is generated from it.

```bash
npm i -D playwright && npx playwright install chromium

node cv/build.mjs     # -> assets/jaspersands_cv.pdf, stamps the ?v= key in index.html
node cv/measure.mjs   # page-break report + cv/preview-N.png per page
```

## Page-count guards

Unlike the résumé this is deliberately two pages, so there is no one-page guard.
Instead the build fails if the render is not two pages or if the last page is under
12% full — a final page holding two lines reads as an accident rather than a choice.

That count is read back out of the rendered PDF, not estimated from flow height.
Every `.entry` sets `break-inside: avoid`, so an entry that would straddle a break is
pushed whole onto the next page and leaves dead space behind. Dividing flow height by
page height ignores that, which is how a "two-page" CV once shipped with a third page
holding a single line.

`measure.mjs` walks the same break rule and shows where the cost lands:

```
flow 1855px -> paginated 1895px across 2 page(s); 40px lost at breaks
  page 1: 96% full
  page 2: 98% full
```

Break placement, not height, is what usually blocks an addition. The CV
sits about 20px under the limit, and what fits is counterintuitive: a 38px "Other
work" line overflows to a third page while a 51px coursework line does not, because
the shorter one lands where it pushes the five-line Q-Search entry — which cannot
split — past the page-one break. Test an addition by rendering it, never by adding
its height to the flow.

It also lists the blocks whose last line is nearly empty. Those are the cheapest
place to buy a line back: a few words cut reclaims the whole line.

Page geometry lives in `build.mjs` (`MARGIN`, `CONTENT_W`, `PAGE_H`); `measure.mjs`
imports it, so change it in one place. Page numbers are drawn by Chromium into the
bottom margin via `footerTemplate`, so they cost no content space and the fill budget
is unaffected.

## The cache key

The `?v=` stamped into `index.html` hashes `cv.html`, not the rendered PDF — Chromium
writes a creation time into every render, so hashing the output would churn the key on
builds that changed nothing.

## Keeping it consistent with the résumé and the site

The CV is a superset of `resume/resume.html` and the timeline in `index.html`. Dates,
titles, and figures appear in all three, so a change to one is a change to all three.
