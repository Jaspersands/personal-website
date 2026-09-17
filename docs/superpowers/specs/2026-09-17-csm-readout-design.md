# Isolated-mode charge-state readout (thesis demo)

**Date:** 2026-09-17
**Branch:** `feature/surface-code-hero`
**Status:** approved design (both networks, both sizes, placed under the thesis)

## 1. Purpose

Replace the reservoir-coupled auto-tuner (a toy) with a live, honest demonstration of the machine-learning pipeline Jasper's thesis continues: **Vallabhapurapu, Candido, Choudhary, Steinacker, Vahapoglu, Escott, Lim, Saraiva, Dumoulin Stuyck & Feng, "Machine Learning for Charge State Characterization of Isolated Double Quantum Dots", arXiv:2607.20871 (Diraq / UNSW, July 2026).** The paper's pipeline is two compact CNNs on 128×128 charge-stability maps (CSMs) from double dots operated in *isolated mode*; sub-1M-parameter models mean the real thing can run in a visitor's browser.

The demo sits in **Education → Columbia MS → Thesis**, not in Selected Work: it is context for the thesis, built on published work Jasper is continuing, not a claim of his own results.

## 2. What the visitor sees

A panel beside the thesis text:

1. **Acquisition.** A synthetic isolated-mode CSM is *measured* live — a raster scan filling row by row (~2.5 s). Axes: `P1 − P2` (detuning, x) and `ΔJ` (exchange gate, y), as in the paper's Fig. 1b. Near-vertical bright transition lines, sharp at the bottom and fading toward the top; honeycomb-like branching from parasitic dots above them; background gradients, scan-line and column ripple, trap stripes, noise.
2. **Quality gate.** `CSMClassifier` runs: three independent sigmoid probabilities — *clean / unstable / unclear* — drawn as bars. Unstable or unclear ⇒ "rejected — re-measure", as in the paper's pipeline.
3. **Line readout.** On clean maps `ChargeLineNet` runs: its signed heatmap (start points +, end points −) is shown as a thumbnail; decoded lines are overlaid with ▲ start and ▼ end markers, and the charge regions between lines are labelled `(N,0) … (0,N)`. Readout: `N = 4 electrons · 0.3 s`.
4. **Classical baseline** beside it: the column-profile matched-filter counter from the paper's Appendix J, with its count — it over-counts branching and misses faint lines. Held-out accuracies of all three (compact net, full net, classical) are printed from a metrics file the training run writes.
5. **Model size toggle:** `compact` (default) / `full` — the two ChargeLineNet variants, each labelled with its parameter count and the time it just took.
6. **One interaction:** click the map during or after acquisition to inject a charge jump (telegraph switch) mid-scan; the classifier flags it unstable and the pipeline rejects it.

A new device is acquired every ~8 s while the panel is on screen. Reduced motion: one analysed map, static.

**Caption (verbatim on the page):**
> Compact reimplementations of the two networks from Vallabhapurapu et al., arXiv:2607.20871 (Diraq/UNSW, 2026) — the work my thesis continues — trained here on synthetic maps only and running in your browser. The paper's models are trained and fine-tuned on 32 real SiMOS devices; the maps here come from a parameterised generator modelled on the paper's Appendix I.

## 3. Physics and phenomenology (what the generator must reproduce)

- **Isolated mode:** barriers to reservoir and sensor are raised, so the total electron number `N` is fixed; the only transitions are interdot transfers `(N1, N2) → (N1−1, N2+1)`. In a `P1−P2` vs `ΔJ` map they appear as `N` near-vertical lines; regions are labelled `(N,0), (N−1,1), …, (0,N)` left to right (paper Fig. 1b). Occupancy at a point = number of lines to its left.
- Lines are sharp where the interdot tunnel coupling gives a clean transition and **fade toward the top** as `J` changes the coupling (paper §I: lines "characteristically fade into the background"). The *start point* (sharp) and *end point* (blur onset) are the supervision targets.
- **Branching:** electrons loading into parasitic dots under the device gates produce honeycomb-like branches above the plunger-gate lines; these must not be counted.
- **Artefacts** (paper §II A, Fig. 4): charge instability = lines abruptly shifting/appearing/disappearing part-way across the scan (telegraph switching); sensor drift = slow vertical gradients; ripple, stripes, low SNR, obscuring background transitions.
- The generator is a parameterised *image* simulator, like the paper's own pre-training generator (Appendix I), not a device physics simulation — the copy says so.

## 4. Synthetic generator (`ml/csm_generator.py`, ported to `csm-gen.js`)

128×128 float images in [0, 1], plus labels. Sampled per image (seeded RNG in both languages; the JS port need not be bit-identical, only statistically equivalent):

| Element | Sampling |
|---|---|
| Line count `N` | 0–7 (uniform, weighted slightly toward 1–5) |
| Line x-positions | mean spacing `s ∈ [9, 20]` px, jitter ±20 %, centred with random offset |
| Tilt (lever arm) | common angle θ ∈ [−12°, 12°] plus per-line ±2° |
| Line profile | Gaussian ridge, width `w ∈ [0.9, 2.2]` px, peak contrast `c ∈ [0.35, 1.0]` |
| Start / end | start row `y0 ∈ [92, 124]` (sharp); fade begins at `y1 = y0 − L`, `L ∈ [30, 85]`; intensity falls as a smooth ramp over `[y1 − 8, y1 + 8]`; a faint (≤ 15 %) continuation may persist above |
| Branching | present with p = 0.65: from each line's end, two branches at ±(28–40°) joining neighbours into hexagon-like cells, contrast 0.3–0.8 of the line, one to three tiers |
| Background | vertical/horizontal gradient, vignetting, 1–3 diffuse Gaussian blobs, scan-line ripple (row-wise sinusoid, p = 0.5), column ripple (p = 0.3), 0–2 trap stripes (thin diagonal lines, p = 0.4) |
| Noise | Gaussian σ ∈ [0.02, 0.10] on the normalised image; optional salt (p = 0.2) |
| Contrast | random gain/offset; final clip to [0, 1] |

Class-specific variants:
- **clean**: as above with σ ≤ 0.07 and no obscuring structure.
- **unstable** (p = 1/3 of the classifier corpus): at 1–3 random rows, the whole line set shifts by Δx ∈ ±[3, 12] px for a band of rows, and/or one line exists only above or below a cut row.
- **unclear** (p = 1/3): σ ≥ 0.12, or a wide bright band/diagonal transition crossing the lines, or heavy stripes, or line contrast ≤ 0.15.

Labels: `N`, per-line `(x_start, y_start)`, `(x_end, y_end)`; classes as three independent booleans (an unstable image can also be unclear).

## 5. Networks (`ml/train_csm.py`)

Shared **preprocessing / stem**: per-image standardisation (zero mean, unit variance) followed by local contrast normalisation (subtract a 9×9 Gaussian-blurred local mean, divide by local std + ε) — a fixed, parameter-free stand-in for the paper's histogram-invariant stem; done identically in Python and JS.

**CSMClassifier** (one size): conv stem 3×3 → four stages [16, 32, 64, 128] of (3×3 conv, BN, ReLU) ×2 + 2×2 max-pool → global average pool → MLP 128→64→3 → sigmoids. 304,499 parameters. Loss: BCE-with-logits per class. Trained on a synthetic corpus balanced across clean / unstable / unclear (the paper trains this model on real data only; ours is synthetic and the caption says so).

**ChargeLineNet** (two sizes): U-Net, 3 encoder levels + bottleneck + 3 decoder levels with skip connections, bilinear ×2 upsampling, isotropic 3×3 convs (the paper's anisotropic multi-branch blocks are a documented simplification), final 1×1 conv → **3 channels**: signed heatmap (start +1 / end −1 Gaussians, σ = 1.5 px) and offset vectors (Δx, Δy) from each end point to its start, weighted by the end blob.
- **compact**: widths [12, 24, 48], bottleneck 48 — 170,787 parameters.
- **full**: widths [32, 64, 128], bottleneck 128 with two extra bottleneck convs — 1,505,411 parameters (the paper: 935,283).
- Loss: foreground-weighted MSE on the heatmap (weight 10 within blobs) + masked smooth-L1 on offsets at end blobs (paper Appendix D 2, simplified).
- Training: AdamW, cosine schedule with warm-up, gradient clipping, random horizontal flips; 40k synthetic images, 15 epochs compact / 20 epochs full on MPS. Held-out: 2,000 fresh images.

**Decoding** (`csm-decode.js`, mirrored in `ml/decode.py`): local maxima of the heatmap above +τ (starts) and below −τ (ends); for each end, follow its offset vector to a predicted start and snap to the nearest start blob within a corridor (paper Appendix F, simplified); surviving pairs are lines; `N` = number of lines; lines sorted by x give region labels.

**Classical baseline** (`csm-decode.js` + `ml/decode.py`): Gaussian smoothing along y (σ = 6), second-derivative-of-Gaussian matched filter across x (σ = 1.5), rectify, sum over rows, peak-pick with a fixed prominence threshold tuned on training images.

**Metrics** (`ml/eval.py` → `assets/models/csm-metrics.json`): exact line-count accuracy and ±1 accuracy for compact, full and classical on the held-out set; per-class accuracy for the classifier; parameter counts. The page prints these numbers; nothing on the page is typed by hand.

## 6. Inference in the browser (`csm-nn.js`, `csm-worker.js`)

- Weights exported with BatchNorm folded into the preceding conv; stored as one little-endian **float16** blob per model plus a JSON manifest of layers `{type, in, out, kh, kw, offset}`. Sizes (float16): classifier ≈ 0.6 MB, compact ≈ 0.35 MB, full ≈ 2.4 MB — the full model is fetched only when the visitor selects it.
- A dependency-free engine: `conv2d` (any kh×kw, stride 1, same padding), `relu`, `maxpool2`, `upsample2` (bilinear), `concat`, `gap`, `linear`, `sigmoid`, run on `Float32Array`s inside a **Web Worker** so acquisition animation never stalls. Expected ≈ 0.3 s (compact) and ≈ 2 s (full) per image on a laptop in plain JS; the measured time is shown.
- **Golden test:** `ml/export_weights.py` also writes `tests/fixtures/csm-golden.json` — one fixed synthetic input and the PyTorch outputs of each exported model; `tests/csm-nn.test.js` must reproduce them within 1e-3 (max abs error over the heatmap; probabilities within 1e-4).

## 7. Page integration

- `index.html`: inside the thesis `tl-item`, after the "Thesis." line, a `div.csm-demo` with the panel (canvas 128×128 displayed at 2×, overlay canvas, heatmap thumbnail, classifier bars, readout line, model toggle, caption). The auto-tuner article and its scripts are removed; `dqd.js`, `tuner-view.js`, `tests/dqd.test.js` are deleted (they remain in git history).
- `styles.css`: `.csm-*` rules; the timeline's left rail is kept, the demo spans the item's width, stacking on phones.
- Scripts (all `defer`): `csm-gen.js`, `csm-decode.js`, `csm-nn.js`, `csm-view.js` (+ `csm-worker.js` loaded by the view). Models fetched from `assets/models/` on first intersection.
- Copy in the thesis entry is expanded by one sentence linking the demo to the thesis and the paper; the caption in §2.

## 8. Testing

- Python (`ml/`): generator label sanity (lines within bounds, count matches), decoder on synthetic targets (recovers N exactly on noise-free heatmaps), classical baseline runs.
- Node: `tests/csm-gen.test.js` (JS generator: bounds, counts, class variants change the image), `tests/csm-decode.test.js` (decoding synthetic heatmaps with offsets; classical counter on a clean synthetic map), `tests/csm-nn.test.js` (golden outputs; conv/pool/upsample unit checks against hand-computed values).
- Preview: acquisition animates; clean map → count and labels; injected jump → "unstable, rejected"; toggle → full model runs and reports its time; reduced motion static; console clean; phone layout.

## 9. Out of scope

Real device data (none used); the paper's anisotropic branch blocks and its exact stem; fine-tuning; WebGL acceleration (JS worker is enough for the sizes chosen). The reservoir-coupled tuner is removed, not kept.
