# Living Surface Code Hero (A+) with whole-page variant (A++)

**Date:** 2026-09-15
**Branch:** `feature/surface-code-hero` (builds on commit `7d9ea09`, which implemented Plan A)
**Status:** approved design, pending implementation plan

## 1. Goal

Make jaspersands.com stand out to industry recruiters and peers with one quantum motif that is *true*: a full-bleed rotated surface code, decoded live by the author's own Rust MWPM decoder compiled to WebAssembly, where the visitor's cursor is the noise source and one logical qubit is at stake. Everything else on the page stays as it is on `main`: the clean, scannable single-page CV.

Three escalations over the current Plan A hero (a 9×9 SVG lattice in the right column with sparse scripted events):

| Axis | Plan A (now) | A+ |
|---|---|---|
| Scale | 9×9 square in the right column | Full-bleed, fills the hero viewport, bleeds past the edges |
| Responsiveness | Hover a dot to inject one error | Pointer is a heat source; noise blooms in its wake |
| Stakes | None | `rounds · physical errors · logical errors` readout; a chain across the width is a real logical error |
| Decoder | JS exact matching ≤10 defects, greedy above | The author's Rust blossom MWPM, via the real `.wasm` |

A++ is A+ with the lattice fixed behind the entire page instead of confined to the hero. It is a variant toggle, decided by eye once A+ exists.

## 2. Non-goals

- No second motif (no Bloch sphere, lever, circuit ribbon, audio). Plan C (`bloch.html`, `bloch.js`, `tests/bloch.test.js`, the nav toggle) is removed on this branch; `feature/bloch-hero` remains for reference.
- No content restructuring. No `dossier.html`. All sections stay on `index.html`.
- No build step, no bundler, no external JS libraries.
- No invented numbers anywhere on the page. Every figure shown is measured by the running simulator.

## 3. The engine: `stabilizer_qec.wasm`

Verified 2026-09-15 against the local clone at `~/Desktop/vibes/quantum-simulator-qec` (commit `5fd9fa0`, the file is tracked and matches the source):

- Bare C-ABI module, **no imports**; instantiates with `WebAssembly.instantiate(bytes, {})`.
- 214,548 bytes raw, **78,656 bytes gzipped** — GitHub Pages already serves it gzipped with `content-type: application/wasm`.
- Exports used by the hero:

| Export | Purpose |
|---|---|
| `wasm_seed(lo, hi)` | Seed the RNG once from `crypto.getRandomValues` |
| `wasm_create_session(d, 0)` → ptr | Rotated surface code, distance `d` (square, `d²` data qubits, `d²−1` stabilizers) |
| `wasm_get_data_qubit_count(ptr)`, `wasm_get_stabilizer_count(ptr)` | Sizes |
| `wasm_get_data_qubit_x/y(ptr, i)` | Data qubit `i` at odd coordinates in `[1, 2d−1]` |
| `wasm_get_stabilizer_x/y(ptr, i)`, `wasm_get_stabilizer_type(ptr, i)` | Stabilizer `i` at even coordinates; bulk faces inside `[2, 2d−2]`, boundary half-plaquettes at `0` or `2d`; type `1` = X, `0` = Z. X stabilizers index first (`0..num_x`), then Z |
| `wasm_toggle_error(ptr, q, type, 0)` | Flip an X (`type 0`) or Z (`type 1`) error on qubit `q`; Y = both |
| `wasm_get_syndrome(ptr)` → `*u8` | One byte per stabilizer, for rendering defects |
| `wasm_decode(ptr, 2)` → `u8` | Syndrome → exact MWPM (Edmonds' blossom) → fills correction buffers; **returns 1 if error ⊕ correction is a logical operator** |
| `wasm_get_correction_x/z_ptr(ptr)` → `*u8` | One byte per qubit |
| `wasm_clear_errors(ptr)` | Reset the Pauli frame after a round |
| `memory` | Linear memory; all pointer reads are copied out immediately (memory can grow and detach views) |

Boundary orientation in this engine (verified by probe): X half-plaquettes sit on the **left/right** edges, Z half-plaquettes on **top/bottom**. Therefore X-error chains terminate on the left/right boundaries — a chain of X errors from the left edge to the right edge commutes with every stabilizer, produces **no syndrome**, and is a logical X. `wasm_decode` reports it via the leftmost-column parity. Z chains run top-to-bottom analogously.

Measured decode cost (30 errors/round, exact MWPM): d=15 1.2 ms · d=21 1.6 ms · d=25 2.2 ms. One round every ~700 ms is ≈0.3 % of one core.

**Hosting:** copy the file to `assets/stabilizer_qec.wasm` in this repo, with the source commit hash recorded in the header comment of `engine.js`. No cross-origin dependency on qcompiler.jaspersands.com; version pinned. Not excluded by `.gitignore`.

**Loading:** `fetch` → `arrayBuffer` → `WebAssembly.instantiate` (not `instantiateStreaming`, so a wrong MIME type on some host can never break it). Starts as soon as `hero.js` runs; the lattice fades in over 600 ms when the engine is ready. First visit ≈150–300 ms; cached thereafter.

## 4. Architecture

Plain scripts, no modules, matching the existing site. Pure logic in UMD files so Node tests can `require` them.

```
index.html          hero markup (canvas, caption, readout); Plan C toggle removed
styles.css          full-bleed hero, text overlay fade, readout, [data-field] variants
engine.js    (UMD)  typed wrapper over the wasm exports; owns pointers and memory reads
hero-math.js (UMD)  pure helpers: fit(), gaussianRate(), poisson(), chainsFromCorrection()
hero.js      (IIFE) controller: sizing, canvas renderer, noise scheduler, rounds,
                    animation, pointer, readout, reduced-motion, visibility, fallback
surface-code.js     unchanged; still drives the d=5 keyboard-accessible band demo
script.js           unchanged
assets/stabilizer_qec.wasm
tests/engine.test.js, tests/hero-math.test.js   (node, no framework; surface-code.test.js stays)
```

Removed: `field.js`, `bloch.html`, `bloch.js`, `tests/bloch.test.js`.

Script order in `index.html`, all with `defer`: `surface-code.js`, `script.js`, `engine.js`, `hero-math.js`, `hero.js`. `hero.js` reads the `QEC` and `HeroMath` globals the two UMD files install; nothing else depends on them.

### 4.1 `engine.js`

```
QEC.load(url) → Promise<Engine>          fetch + instantiate + seed
engine.session(d) → Session              creates a session; frees any previous one
session.d, session.qubits: [{x,y}], session.stabs: [{x,y,type}]   read once at creation
session.toggle(q, pauli)                 pauli ∈ 'X' | 'Z' | 'Y'
session.syndrome() → Uint8Array          fresh copy
session.decode() → { logical: 0|1, cx: Uint8Array, cz: Uint8Array }   MWPM (decoder 2); copies out
session.clear()
session.free()
```

`engine.js` never touches the DOM. Every read from `memory.buffer` is copied into a fresh typed array before returning.

### 4.2 `hero-math.js` (pure)

- `fit(width, height, cell, dMax)` → `{ d, cell, originX, originY }`. `d` is the smallest odd integer with `(d−1)·cell ≥ max(width, height)`; if `d > dMax`, `cell` is increased so `d = dMax`. The square is centred on the box, so the long-axis boundaries land within one cell of the viewport edges and the short axis is cropped.
- `gaussianRate(dist, sigma, peak)` — per-qubit cursor noise rate.
- `poisson(lambda, rand)` — Knuth sampler for per-tick event counts.
- `chainsFromCorrection(session, cx, cz)` → `[{ type:'X'|'Z', qubits:[i…] }]`. Groups corrected qubits into connected chains, ordered end-to-end so a polyline can be drawn and animated. Two X-corrected qubits are adjacent when they share a **Z** stabilizer (X corrections repair Z defects); two Z-corrected qubits when they share an **X** stabilizer. Chains touching a boundary are ordered from the boundary inward; a lone corrected qubit is a one-element chain.

### 4.3 `hero.js` — controller

**Tunables** live in one constants block at the top of the file:

```
CELL          56 px (≤1100 px wide: 48; ≤760: 44)
D_MAX         31                    // 961 qubits; MWPM ≈3 ms
AMBIENT_RATE  0.6 errors/s over the whole lattice
CURSOR_PEAK   2.5 errors/s per qubit at the pointer; CURSOR_SIGMA 1.1 cells
              (integrates to ≈19 errors/s while the pointer moves, ≈13 per round)
PAULI_MIX     X .45 · Z .45 · Y .10
ROUND_MS      700 ± 15 % jitter
MAX_PENDING   60 uncorrected errors; beyond this new errors are dropped
TICK_MS       50                    // noise scheduler resolution
Durations     error-in 180 · defect-in 220 · chain-draw 350 · hold 250 · fade 300 · logical-flash 650 · lattice-fade-in 600 (ms)
```

**Lifecycle**

1. `DOMContentLoaded`: if `prefers-reduced-motion`, go to §4.6. Otherwise size the canvas, start `QEC.load('assets/stabilizer_qec.wasm')`.
2. Engine ready: `fit()` → `session(d)` → build the static layer → fade the lattice in → start the scheduler.
3. Engine failed (network, unsupported): §4.7 fallback.

**Scheduler (every `TICK_MS`, only while active)**

- Ambient: `poisson(AMBIENT_RATE · dt)` errors on uniformly random qubits.
- Cursor (while the pointer is over the field and has moved in the last 400 ms): for qubits within `3σ` of the pointer, `poisson(gaussianRate(dist) · dt)` each.
- Each error: draw a Pauli from `PAULI_MIX`, `session.toggle(q, p)`, record `{q, p, t0}` in `pending` for rendering. Drop if `pending.length ≥ MAX_PENDING`.
- If anything was injected this tick: `syndrome()` → mark lit stabilizers with `t0` if newly lit → `dirty = true`.
- `physicalErrors += injected`.

**Round (every `ROUND_MS`, jittered)**

`rounds += 1` on every round — a real code extracts syndromes on a fixed cadence whether or not anything happened. When `pending` is empty the decode is skipped (it would be the identity) and only the readout updates. Otherwise, synchronously and atomically within one task:

1. `{logical, cx, cz} = session.decode()`
2. `chains = chainsFromCorrection(session, cx, cz)`
3. `session.clear()` — the frame resets; from here the session is empty and the next round's `logical` flag refers only to that round.
4. `logicalErrors += logical`
5. Start animations: chains draw in, then chains + pending errors + defects fade; if `logical`, the flash. `pending = []`.
6. Update the readout.

Clearing after each round is what makes the logical counter honest: `wasm_decode` computes the flag from the *accumulated* frame, so without a reset a single logical error would be reported on every subsequent round.

**Pointer**

- `pointermove` on the hero → pointer position in lattice coordinates; `pointerleave`/`pointercancel` → inactive.
- Canvas gets `touch-action: pan-y`: horizontal finger drags reach us (and can cause a logical X), vertical drags scroll the page as normal. No `preventDefault`.
- A faint radial "heat" (accent at ≤6 % alpha, radius `2σ`) is drawn under the pointer so the cause–effect is visible. Tuned in preview; removable by one constant.

**Rendering (Canvas 2D, DPR-aware)**

- *Static layer*, drawn once into an offscreen canvas on init, resize, and theme change: checkerboard tiles (Z tiles `--z`, X tiles `--x`, ~7 % alpha; boundary half-plaquettes as semicircles like the band demo), hairline grid at ~50 % of `--rule`, data-qubit dots r = 3 px in `--fg-3` at 45 %.
- *Dynamic layer*, redrawn with `requestAnimationFrame` **only while `dirty` or an animation is in flight**; otherwise no frames run. Each frame: `drawImage(static)`, then pointer heat, lit stabilizers (tile at 55 % + soft radial glow), error dots (r → 5.5 px, filled `--x`/`--z`/`--y`, 180 ms ease-out), correction chains (1.5 px polylines in the defect-type colour, drawn with a growing dash over 350 ms, then fade), and the logical flash (full-canvas accent at 14 % → 0 over 650 ms).
- Colours are read from CSS custom properties on `.hero` (`--x`, `--z`, `--y`, `--accent`, `--bg`, `--fg-3`, `--rule`) on init and whenever `<html data-theme>` changes (`MutationObserver`), then the static layer is rebuilt.

**Sizing**

- Hero height: `clamp(30rem, 100vh − nav height, 52rem)` on desktop; on phones the hero is `min(100vh, 44rem)` with the text in the lower part.
- `fit()` runs on init and on `resize` (debounced 200 ms). If `d` changes, the session is recreated and pending state discarded; otherwise only the canvases resize.

**Readout and caption** (both inside the hero, mono, 0.6875 rem, stacked bottom-right on desktop with `max-width: 30rem` and right-aligned text; on phones they sit below the CTAs, left-aligned, full width)

- Readout: `rounds <b>1,284</b> · physical errors <b>391</b> · logical errors <b>0</b>`; numbers via `toLocaleString`; `aria-live="off"`. On a logical error the last number flares to `--accent` for 650 ms.
- Caption, with `d` filled in at runtime: *A distance-27 rotated surface code, decoded live by my Rust simulator compiled to WebAssembly. Move the pointer to add noise. A chain of errors across the whole width is a logical error — see if you can cause one.* followed by a link *Full simulator →* to `https://qcompiler.jaspersands.com/`.

### 4.4 Visibility and idle behaviour

- `IntersectionObserver` on the hero: scheduler and rounds pause below 5 % visibility and resume on re-entry, with no catch-up.
- `document.visibilitychange`: same.
- Between rounds with no pointer activity, CPU cost is the 50 ms tick's Poisson draw (microseconds). No animation frames run.

### 4.5 Text legibility

`.hero::before` is a gradient overlay above the canvas and below the text: on desktop, `--bg` at 92 % across the left ~45 % of the hero fading to 0 by ~65 %; on phones, vertical — transparent over the top ~40 %, reaching 90 % `--bg` under the text block. The lattice remains visible and interactive through the overlay at reduced contrast. Verified by screenshot in both themes.

### 4.6 Reduced motion

If `(prefers-reduced-motion: reduce)` matches: load the engine, fit, draw the static layer plus one fixed composed frame (two short chains with their defects, no animation), no scheduler, no pointer handling, readout hidden, caption without the "see if you can cause one" sentence. The media query is observed live and switches the mode without reload.

### 4.7 Fallback (engine unavailable)

The hero renders as the plain text hero from `main` (no canvas content); caption and readout are hidden via `.hero.static`. The page is fully usable. No JS decoder is kept for this case — one decoder, one truth.

### 4.8 Accessibility

- `<canvas role="img" aria-label="A distance-27 rotated surface code being decoded live. Move the pointer over it to add noise.">` (d filled at runtime).
- The hero adds no focusable elements beyond the caption link. The band demo remains the keyboard-operable lattice.
- Text contrast over the lattice meets AA via the overlay (checked in both themes).

## 5. A++ — whole-page variant

Toggle: `<body data-field="hero">` (default) or `data-field="page"`.

With `page`:
- The canvas is `position: fixed; inset: 0; z-index: 0` and covers the viewport; `fit()` uses the viewport, not the hero.
- `nav`, `main`, `footer` get `position: relative; z-index: 1` and a translucent background `color-mix(in srgb, var(--bg) 90%, transparent)` so the lattice shows through content at ~10 %. The `.band` section uses `--bg-2` mixed the same way.
- The hero overlay from §4.5 still applies inside the hero; elsewhere the section backgrounds do the dimming.
- Pointer tracking listens on `window` (content sits above the canvas), so noise follows the cursor while reading. Coordinates map 1:1 to the fixed canvas.
- The `IntersectionObserver` pause is disabled (the field is always on screen); `visibilitychange` pause remains.
- Readout and caption stay in the hero.

Cost: ~1 % of a core continuously while the tab is visible, versus ~0 for A+ once scrolled past. Decision is made by eye in the preview: if reading Experience with a faint lattice under it feels like a screensaver or hurts legibility, `hero` wins and the `page` CSS stays as a dormant, ten-line variant.

## 6. Copy changes on the page

- Hero lede: keep the Sydney sentence in the present tense as already edited on the branch.
- Band hint: already updated to "minimum-weight matching" (its Match button uses the JS exact matcher from `surface-code.js`, which is true for d=5).
- Footer/nav: remove the "Plan C (Bloch)" item.

## 7. Testing

**`tests/engine.test.js`** — Node, against the real `.wasm` (`require('../engine.js')`, load from `assets/`):

1. Geometry: `d²` qubits at odd coordinates in `[1, 2d−1]`; `d²−1` stabilizers; bulk at even coordinates in `[2, 2d−2]`; boundary at `0` or `2d`; X stabilizers indexed before Z.
2. Single X in the bulk → exactly two Z defects, diagonal neighbours. Single X on the left/right edge → exactly one Z defect. Single Z on the top/bottom edge → exactly one X defect. (Pins the boundary orientation the "break it" mechanic depends on.)
3. Full row of X from left edge to right edge → syndrome all zero, `decode().logical === 1`.
4. Row of X of length `⌊d/4⌋` from the left edge → `decode().logical === 0`; applying `cx` to the session yields an all-zero syndrome.
5. Property: at d=15, 300 random error sets at 3 % per qubit → after `decode()` and applying `cx`/`cz`, the syndrome is all zero every time.
6. `clear()` then `decode()` → `logical === 0` (frame reset works).
7. Timing sanity: one d=27 decode with 40 errors completes under 20 ms.

**`tests/hero-math.test.js`**:

1. `fit()`: `d` is odd, `(d−1)·cell ≥ max(w,h)`, `d ≤ dMax`, square centred.
2. `poisson()`: mean over 20 000 draws within 3 % of λ for λ ∈ {0.05, 1, 4}.
3. `chainsFromCorrection()`: two disjoint chains → two polylines with the right members and end-to-end order; a chain touching a boundary is ordered from the boundary; a lone corrected qubit is a one-element chain.

**Preview verification (before claiming done)**: 1440 / 1024 / 390 widths × light / dark; a horizontal scribble across the width produces the flash and increments the logical counter; a short scribble is corrected; `prefers-reduced-motion` emulation shows the static frame; hiding the tab stops the round counter; console has no errors; a Performance recording shows no rAF activity while idle; wasm request is ~79 KB. A++ toggled on and reviewed at the same sizes.

## 8. Performance budget

- `engine.js` + `hero-math.js` + `hero.js` ≤ 20 KB unminified.
- `.wasm` 79 KB gzipped, loaded async, cached.
- Idle (no pointer, between rounds): no animation frames.
- Round: ≤ 4 ms including decode, chain extraction, and readout update.
- Animation frame at 1440×900 @2× DPR: ≤ 2 ms.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Random-Pauli cursor noise is too easy to correct, so a scribble never breaks the code | Switch `PAULI_MIX` toward bit-flip (X-heavy) — a legitimate noise model; one constant |
| Too busy / too quiet | All rates and durations are constants tuned in the preview |
| Text legibility over the lattice | Overlay gradient (§4.5), verified per theme |
| Mobile scroll hijack | `touch-action: pan-y`, no `preventDefault` |
| Wasm blocked or slow | Fallback (§4.7); nothing else on the page depends on it |
| Engine version drift from the simulator repo | Commit hash recorded in `engine.js`; tests run against the checked-in file |

## 10. Delivery

1. Commit the spec.
2. Implementation plan via the writing-plans skill.
3. Implement on `feature/surface-code-hero` in small commits: engine + tests → hero-math + tests → renderer → scheduler/rounds → pointer/readout → reduced-motion/fallback/visibility → A++ variant → tuning by preview.
4. User reviews in the preview; picks `hero` or `page`.
5. Merge to `main`; GitHub Pages deploys.
