# Example page: D (double-dot auto-tuner) and E (scroll zoom-out to the fabric)

**Date:** 2026-09-15
**Branch:** `feature/surface-code-hero` (same branch as the A+ build, new files only — another session is building A+ in this working tree, so a separate branch is not safe)
**Status:** built autonomously overnight as an *example* for review; not the live site

## 1. Purpose

Show, in a working page, what directions D and E from the hero brainstorm feel like, so a decision can be made by eye. Everything lives in **new files only**. `index.html`, `styles.css`, `script.js`, `field.js`, `surface-code.js`, the Plan C files, and the A+ spec are untouched.

- **E** is the page's hero and spine: a full-bleed distance-27 surface code decoded live by the real engine; as the visitor scrolls, the camera pulls back and that one logical qubit becomes one patch in a lattice-surgery fabric, which then sits faintly behind the rest of the page.
- **D** is a second showpiece lower on the page, in the Selected Work slot: a simulated silicon double quantum dot with a real auto-tuning routine that finds the (1,1) charge state and holds it against drift the visitor causes.

## 2. Files

```
examples.html          the page (banner, nav, hero, fabric window, About, Work with D, footer)
examples.css           page styles; reuses the site's tokens and type
sessions.js    (UMD)   independent engine sessions built on the existing engine.js `rawExports`
                       (engine.js frees the previous session on each `session()` call; E needs one per patch)
dqd.js         (UMD)   pure: constant-interaction model, charge sensor, change-point detector, tuner state machine
fabric-math.js (UMD)   pure: scroll→scale mapping, camera world↔screen transforms, patch layout and containment
fabric.js      (IIFE)  E: patches, renderer, scheduler, cursor noise, merges
tuner-view.js  (IIFE)  D: canvas renderer + animation driver around dqd.js
assets/stabilizer_qec.wasm   copied from quantum-simulator-qec @ 5fd9fa0 (sha256 770cf1f7…)
tests/sessions.test.js, tests/dqd.test.js, tests/fabric-math.test.js   node, no framework
```

Script order (all `defer`): `engine.js` (existing), `hero-math.js` (existing; `poisson`, `gaussianRate`, `chainsFromCorrection` are reused), `sessions.js`, `dqd.js`, `fabric-math.js`, `fabric.js`, `tuner-view.js`.

A banner at the top of the page states it is an example exploring two directions and links back to `index.html`.

## 3. `sessions.js`

`engine.js` already exists on the branch (built for A+) and exposes `rawExports`. `sessions.js` builds independent sessions from those exports — `QECSessions.create(rawExports, d)` — with the same field names `hero-math.js` expects (`d, qubits, stabs, numQubits, numStabs`) plus `qubitAt`, `toggle`, `syndrome`, `decode`, `applyCorrection`, `clear`, `free`. E runs one session per patch. Every read from wasm memory is copied out.

## 4. E — the fabric

### 4.1 World

- A patch is a distance-`d` rotated surface code (`d` = 27 desktop, 21 tablet, 15 phone). Patches sit on a grid of `COLS × ROWS` (5 × 3 desktop, 3 × 3 phone) with a `GAP` of 6 cells between them (routing space). World units are cells; the hero patch is the centre one.
- Every patch has its own engine session. Ambient noise: Poisson, `0.6` errors/s per patch. Rounds: the hero patch every `700 ms`; the others every `1500 ms` (staggered). Each round is the same atomic decode → chains → clear as A+. Each patch keeps its own `rounds / physical / logical` counters; the hero's are shown in the readout.
- Cursor noise: the pointer maps through the camera to world coordinates; whichever patch contains it receives Gaussian-bump noise (`peak 2.5 /s per qubit, σ 1.1 cells`), scaled by the current zoom so a zoomed-out pointer is not a firehose.
- **Lattice surgery, illustrated:** every ~4 s a random pair of horizontally or vertically adjacent patches merges: the gap between them fills with stabilizer tiles over 500 ms, holds ~2.2 s with a faint accent tint, then splits. This is visual only — the engine does not simulate the merged code — and the caption says so.

### 4.2 Camera and scroll

- Fixed full-viewport canvas behind the page. Camera = world centre (always the hero patch centre) and `scale` = pixels per cell.
- Scroll progress `p = clamp(scrollY / heroHeight, 0, 1)`, eased with smoothstep. `scale = lerp(CELL, CELL_MIN, ease(p))` where `CELL` is the A+ cell size (56 px desktop) and `CELL_MIN` is chosen so that all `COLS` patches fit the viewport width with margins.
- At `p = 0` the hero patch fills the viewport, cropped exactly as A+. At `p = 1` the fabric is fully visible.
- Below the hero is a **window band** (`70vh`, transparent background) with a single caption; that is where the fabric is seen whole. Sections after it have translucent backgrounds (`color-mix(var(--bg) 90%, transparent)`) so the fabric shows through at ~10 %.
- Frames run only while the scroll position changes or an animation is in flight; otherwise none.

### 4.3 Rendering

- Patch tiles are drawn directly when the on-screen cell is ≥ 18 px (at most a couple of patches are visible then); below that, every patch is a scaled `drawImage` of one pre-rendered patch sprite. Errors, defects, chains, merge tiles, and the hero's logical flash are drawn on top as primitives. Off-screen patches are culled.
- Checkerboard tiles, hairline grid, qubit dots, error and defect styling, chain animation: as A+ §4.3.
- Theme colours from CSS variables; static sprite rebuilt on theme change.

### 4.4 Hero text, caption, readout

Same copy and layout as A+ (name, lede, CTAs, readout, caption), with the caption's link to the full simulator. The window band caption:

> One logical qubit among many. Each patch is a distance-27 surface code with its own decoder rounds. The merges between patches are lattice surgery — how logical gates are performed — illustrated here, not simulated.

### 4.5 Reduced motion / fallback

Reduced motion: static frame at `p`-driven zoom still follows scroll (it is position, not animation), but no noise, rounds, or merges. Engine unavailable: no canvas content, captions hidden; page remains usable.

## 5. D — the auto-tuner

### 5.1 Model (`dqd.js`, pure)

Constant-interaction model of a double quantum dot. For charges `(N1, N2)` and plunger voltages `(V1, V2)` in mV:

```
E(N1,N2) = ½·EC1·N1² + ½·EC2·N2² + ECm·N1·N2
         − N1·(a11·V1 + a12·V2) − N2·(a21·V1 + a22·V2)      [meV]
```

Parameters (typical for Si MOS double dots, stated in the caption as illustrative): `EC1 2.4, EC2 2.2, ECm 0.55 meV`; lever arms `a11 0.085, a22 0.080, a12 0.018, a21 0.015 meV/mV`; electron temperature `kT 0.015 meV` (~175 mK). Thermal occupation: `P(N1,N2) ∝ exp(−E/kT)` over `N ∈ [0, 7]²`, giving `⟨N1⟩, ⟨N2⟩`.

Charge sensor: `S = s1·⟨N1⟩ + s2·⟨N2⟩ + b·(V1 + V2) + noise`, with `s1 1.0, s2 0.6` (the sensor sits nearer dot 1, so the two dots' transitions have different step heights), small linear background `b 0.0015 /mV`, Gaussian noise `σ 0.05`.

Drift: offsets `(δ1, δ2)` added to `(V1, V2)` inside the model. Ambient: a slow random walk (`σ 0.15 mV/s`). Cursor: dragging on the diagram adds `0.35 mV` of offset per pixel of drag along each axis — "charge noise" the visitor causes.

Voltage window `[0, 140] mV` on both gates (~5 charge transitions per axis).

### 5.2 Tuner (`dqd.js`, pure state machine; one `step()` = one measurement)

Every measurement is a single call `S(V1, V2)`; the view animates at `150` measurements/s so a 100 mV sweep at 1 mV steps takes ~0.7 s.

- **Change-point detector** on a 1-D trace: a step at sample `i` when `|mean(x[i+1..i+w]) − mean(x[i−w+1..i])| > k·σ̂`, `w = 4`, `k = 4`, with `σ̂` the MAD-based noise estimate from first differences. Step height classifies the dot: near `s1` → dot 1, near `s2` → dot 2.
- `EMPTY` — sweep both gates down along the diagonal from the current point, 1 mV per step; count transitions passed; declare empty after `40 mV` with no step (longer than one charge period) or at the window floor.
- `LOAD1` — sweep `V1` up until the first dot-1 step, then advance a margin of `8 mV` → `N1 = 1`.
- `LOAD2` — sweep `V2` up until the first dot-2 step, then `8 mV` margin → `N2 = 1`. If a dot-1 step appears first (cross-coupling pushed dot 1 to 2 electrons), back `V1` off by the margin and continue.
- `CENTER` — from the current point sweep `−V1`, `+V1`, `−V2`, `+V2` until a step or 30 mV; set the point to the midpoint of each pair of walls → `LOCKED`. Records the lock level `S_lock`.
- `LOCKED` — every ~1.5 s, a short ±6 mV cross-check. A wall within 6 mV → `CENTER` (a re-centre). A sensor level change of more than half a dot-2 step → a transition has passed under the point → `EMPTY` (a full re-tune). Counters: `retunes`, `recentres`.

The tuner never reads the model's `(N1, N2)`; it only sees `S`. The view shows the model's true honeycomb faintly, labelled as hidden from the tuner.

### 5.3 View (`tuner-view.js`)

- Placed in Selected Work: text on the left (the framing below), a `~30 rem` square panel on the right (stacked on phones).
- Canvas heat map of the window: the true sensor signal at ~15 % (ground truth), honeycomb transition lines dashed at ~25 %, the tuner's measured samples drawn as bright pixels along its path (what it has actually seen), the path as a thin line, the current point as a ring, the target `(1,1)` cell outlined once locked.
- Readout under the canvas: `V1 · V2 (mV) · state · inferred (N1, N2) · retunes`. Status verbs in the mono style of the site's readouts: `emptying · loading dot 1 · loading dot 2 · centring · locked (1,1) · drift`.
- Pointer: `pointerdown` + drag adds offset (§5.1); a hint line says so. `touch-action: none` on the canvas only.
- Pauses when off-screen or the tab is hidden; reduced motion shows the locked end state without animation.

### 5.4 Framing copy

> **Auto-tuning a double quantum dot** · a toy of what my thesis automates
>
> A constant-interaction model of a silicon double quantum dot, read out through a simulated charge sensor. The tuner never sees the charge numbers, only the sensor. It empties both dots, adds one electron to each by counting charge transitions with a change-point detector, then centres the (1,1) operating point and holds it. Drag on the diagram to add charge noise and watch it re-tune. Parameters are illustrative; the thesis works on real devices at Diraq and UNSW.

## 6. Testing

- `tests/engine.test.js` — as A+ §7 (geometry, boundary orientation, full-row logical, short chain corrected, 300-round clearing property, clear resets, timing).
- `tests/dqd.test.js` — ground state at `(0,0)` for `V=(0,0)`; charge increases monotonically along each axis; a transition line's position matches the analytic value `V1 = (EC1(N1+½) + ECm·N2 − a12·V2)/a11` within 1 mV; change-point detector finds a synthetic step and ignores noise; the tuner locks in `(1,1)` from 50 random start points with drift off, within 2 000 measurements, and re-locks after an injected 20 mV offset.
- `tests/fabric-math.test.js` — scroll → scale mapping endpoints and monotonicity; world↔screen round-trip; patch containment for pointer mapping.
- Preview: 1440 / 1024 / 390, light and dark; scroll through the zoom; scribble across the hero for a logical error; watch a merge; watch D tune, drag it, watch it re-tune; console clean; wasm ≈ 79 KB.

## 7. Out of scope for the example

Name-in-errors intro, distance control, idle bursts, hidden keys (A+ additions 1–3) — they belong to the hero build, not to this comparison page.
