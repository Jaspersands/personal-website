# CV

`cv.html` is the source of truth for **two** CVs: the two-page one the site links, and
a longer three-page cut kept for the record.

```bash
npm i -D playwright && npx playwright install chromium

node cv/build.mjs            # the CV -> assets/jaspersands_cv.pdf, stamps the ?v= key
node cv/build.mjs --full     # the long one -> assets/jaspersands_cv_3page.pdf
node cv/measure.mjs [--full] # page-break report + cv/preview[-3page]-N.png per page
```

## One file, two versions

Material that only belongs in the long CV is marked `data-t="3"`. Where the short cut
needs different words rather than none — a merged pair of bullets, a citation without
its publisher line — the replacement sits next to it marked `data-t="2"`. The two-page
build puts `class="two"` on `<html>`, which flips which set is visible and tightens the
vertical rhythm to match.

The two-page cut is the CV: it takes the plain filename and it is what the site links.
The long one is kept for the record as `jaspersands_cv_3page.pdf`, and `--full` builds
it. The class is still named `two` because `data-t` values name page counts, not which
variant is the default.

Two separate files would have been less work today and wrong by next month: the copy
you forget to update is the one that gets sent. Anything true of both versions is
written once, and the diff between them is visible in the source.

To check nothing leaks across, render both and confirm each shows only its own tier:

```js
[...document.querySelectorAll('[data-t]')]
  .filter(e => getComputedStyle(e).display !== 'none')
  .map(e => e.getAttribute('data-t'))   // ['2'] for the CV, ['3'] under --full
```

## Page-count guards

Unlike the résumé these are deliberately multi-page, so there is no one-page guard.
Instead each variant declares the count it is named for, and the build fails if the
render misses it or if the last page is under 12% full — a final page holding two
lines reads as an accident rather than a choice.

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

Break placement, not height, is what usually blocks an addition. The two-page cut
sits about 20px under the limit, and what fits is counterintuitive: a 38px "Other
work" line overflows to a third page while a 51px coursework line does not, because
the shorter one lands where it pushes the five-line Q-Search entry — which cannot
split — past the page-one break. Test an addition by rendering it, never by adding
its height to the flow.

It also lists the blocks whose last line is nearly empty. Those are the cheapest
place to buy a line back — a few words cut reclaims the whole line — and they are how
the long version got from four pages to three without dropping any content.

Page geometry lives in `build.mjs` (`MARGIN`, `CONTENT_W`, `PAGE_H`); `measure.mjs`
imports it, so change it in one place. Page numbers are drawn by Chromium into the
bottom margin via `footerTemplate`, so they cost no content space and the fill budget
is unaffected.

## The cache key

The `?v=` stamped into `index.html` hashes `cv.html` **and the variant identity**, not
the rendered PDF — Chromium writes a creation time into every render, so hashing the
output would churn the key on builds that changed nothing. The variant is in there
because hashing the source alone missed the day the two-page cut took over
`jaspersands_cv.pdf`: `cv.html` had not changed, so the key stayed put while the bytes
behind it became a different document.

## Keeping it consistent with the résumé and the site

The CV is a superset of `resume/resume.html` and the timeline in `index.html`. Dates,
titles, and figures appear in all three, so a change to one is a change to all three.
