# Résumé

`resume.html` is the source of truth. `assets/jaspersands_resume.pdf` — the file the
site links — is generated from it.

```bash
npm i -D playwright docx && npx playwright install chromium

node resume/build.mjs        # -> assets/jaspersands_resume.pdf
node resume/build-docx.mjs   # -> resume/jaspersands_resume.docx (editable in Pages/Word)
node resume/measure.mjs      # page-fill report + resume/preview.png
```

## One page

This résumé is deliberately one page; the CV (`cv/cv.html` -> `assets/jaspersands_cv.pdf`)
carries the long-form record. `build.mjs` measures the laid-out height against the
printable area and **exits non-zero if the content spills over**, so overflow can't
ship silently. `measure.mjs` prints the same number plus the remaining slack, which
is the useful one while editing:

```
content 969.1px / budget 976px -> 99.3%  (slack 7px, ~0.6 lines)
```

There is very little room left. Adding a line means taking one out somewhere else —
the cheapest wins are bullets that wrap only a few words past a line boundary.

Page geometry lives in `build.mjs` (`MARGIN`, `CONTENT_W`, `CONTENT_H`); `measure.mjs`
and `build-docx.mjs` import or mirror it, so change it in one place.

## The .docx

`build-docx.mjs` re-emits the same content as a Word file, because Pages can open
`.docx` but nothing here can write Apple's `.pages` format. It is a convenience
export for hand-editing, not the source of truth — edits made there do not flow
back into `resume.html`.
