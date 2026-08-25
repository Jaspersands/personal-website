# CV

`cv.html` is the source of truth for **two** CVs: the full three-page one the site
links, and a two-page cut.

```bash
npm i -D playwright && npx playwright install chromium

node cv/build.mjs            # -> assets/jaspersands_cv.pdf, stamps the site's ?v= key
node cv/build.mjs --two      # -> assets/jaspersands_cv_2page.pdf
node cv/measure.mjs [--two]  # page-break report + cv/preview[-2page]-N.png per page
```

## One file, two versions

Material that only belongs in the long CV is marked `data-t="3"`. Where the short cut
needs different words rather than none — a merged pair of bullets, a citation without
its publisher line — the replacement sits next to it marked `data-t="2"`. `--two` puts
`class="two"` on `<html>`, which flips which set is visible and tightens the vertical
rhythm to match.

Two separate files would have been less work today and wrong by next month: the copy
you forget to update is the one that gets sent. Anything true of both versions is
written once, and the diff between them is visible in the source.

To check nothing leaks across, render both and confirm each shows only its own tier:

```js
[...document.querySelectorAll('[data-t]')]
  .filter(e => getComputedStyle(e).display !== 'none')
  .map(e => e.getAttribute('data-t'))   // ['3'] for the full CV, ['2'] for --two
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
flow 1894px -> paginated 1892px across 2 page(s); -2px lost at breaks
  page 1: 100% full
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
imports it, so change it in one place.

## Keeping it consistent with the résumé and the site

The CV is a superset of `resume/resume.html` and the timeline in `index.html`. Dates,
titles, and figures appear in all three, so a change to one is a change to all three.
The `?v=` cache key stamped into `index.html` is a hash of `cv.html`, not of the PDF —
Chromium writes a creation timestamp into every render, so hashing the output would
churn the key on builds that changed nothing.
