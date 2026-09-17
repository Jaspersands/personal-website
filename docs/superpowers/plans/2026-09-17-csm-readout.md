# Isolated-Mode CSM Readout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the thesis demo from `docs/superpowers/specs/2026-09-17-csm-readout-design.md`: a synthetic isolated-mode CSM generator, two trained CNNs (CSMClassifier; ChargeLineNet in compact and full sizes), a classical baseline, a dependency-free JS inference engine in a Web Worker, and the page panel under the thesis entry — replacing the auto-tuner.

**Architecture:** Python (`ml/`) owns data generation, training, evaluation, export. Browser code is UMD modules (`csm-gen.js`, `csm-decode.js`, `csm-nn.js`) tested in Node, plus `csm-worker.js` and `csm-view.js`. Weights ship as float16 blobs + JSON manifests in `assets/models/`. A golden fixture ties the JS engine to PyTorch outputs.

**Tech Stack:** Python 3 + PyTorch 2.8 (MPS) + NumPy; vanilla JS; Node ≥ 20 for tests; `python3 -m http.server 4173` preview.

## Global Constraints

- Branch `feature/surface-code-hero`; commit after each task; trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Every number printed on the page comes from `assets/models/csm-metrics.json` or a live measurement.
- Copy and caption verbatim from the spec §2. Paper citation: Vallabhapurapu et al., arXiv:2607.20871.
- The reservoir-coupled tuner (`dqd.js`, `tuner-view.js`, `tests/dqd.test.js`, its `index.html` article, its CSS) is removed in Task 8.
- Weight blob format: little-endian float16, layers concatenated in manifest order; manifest JSON `{name, input:[1,128,128], params, layers:[{id, type, ...}]}`. BatchNorm folded into conv at export.

---

### Task 1: Python generator + labels (`ml/csm_generator.py`)

- [ ] Implement `generate(rng, cls='clean'|'unstable'|'unclear'|'any') -> (img float32[128,128] in [0,1], label dict {n, lines:[{xs,ys,xe,ye}], clean, unstable, unclear})` per spec §4. Lines rendered as Gaussian ridges along a tilted path from start (bottom) to end (fade onset), ramp-faded, optional faint continuation; branching tiers; background, ripple, stripes, noise, contrast.
- [ ] `render_heatmap(label) -> float32[3,128,128]` (signed blobs σ=1.5; offset channels at end blobs).
- [ ] `ml/preview_generator.py` writes a 4×4 contact sheet PNG of random images per class to the scratchpad; eyeball against paper Fig. 12 / Fig. 4.
- [ ] Sanity tests in `ml/test_generator.py` (plain asserts, run with `python3 ml/test_generator.py`): label counts, coordinates within bounds, start below end, unstable/unclear flags set, images in [0,1].
- [ ] Commit.

### Task 2: Datasets, models, training (`ml/train_csm.py`)

- [ ] Pre-generate `ml/data/` as uint8 `.npy` memmaps: line corpus 40k train + 2k val (classes: clean 70 %, mildly degraded 30 % but countable); classifier corpus 30k train + 2k val balanced across clean/unstable/unclear (multi-label).
- [ ] Preprocess (standardise + LCN 9×9) in a shared `preprocess()` used by training, eval, export and mirrored in JS.
- [ ] Models: `CSMClassifier` ([16,32,64,128] stages, GAP, MLP 128→64→3); `ChargeLineNet(widths)` U-Net with `compact=[12,24,48]` and `full=[32,64,128]` (+2 bottleneck convs). Print parameter counts.
- [ ] Losses per spec §5; AdamW, cosine + warm-up, grad clip 1.0, horizontal flip augmentation (flip offsets' Δx sign).
- [ ] Train on MPS: classifier (10 epochs), compact (15), full (20). Save `ml/checkpoints/*.pt`. Log val loss and, for line nets, exact-count accuracy via `ml/decode.py`.
- [ ] Commit scripts (not data/checkpoints; add `ml/data/` and `ml/checkpoints/` to `.gitignore`).

### Task 3: Decoding + classical baseline (`ml/decode.py`, `csm-decode.js`)

- [ ] `decode_lines(heat[3,H,W], tau=0.3, corridor=6) -> lines` : NMS local maxima (3×3) on +heat (starts) and −heat (ends); for each end, predicted start = end + offset; snap to nearest start within `corridor` px; unpaired ends dropped; lines sorted by x.
- [ ] `classical_count(img) -> {count, profile}`: y-smoothing σ=6, x second-derivative-of-Gaussian σ=1.5, rectify, row-sum, peak-pick (prominence ≥ 0.25·max, min distance 4 px).
- [ ] JS port with identical numerics; `tests/csm-decode.test.js`: synthetic heatmaps with 0–7 lines decode exactly; classical counter counts a clean synthetic map of 3 well-separated lines correctly and over-counts a branched one (documented behaviour).
- [ ] Commit.

### Task 4: Evaluation + metrics (`ml/eval.py`)

- [ ] On the 2k held-out line set: exact and ±1 count accuracy for compact, full, classical; mean start/end localisation error (px). On the 2k held-out classifier set: per-class accuracy at τ=0.5, macro average.
- [ ] Write `assets/models/csm-metrics.json` `{generated, heldout: 2000, classifier:{clean,unstable,unclear,macro}, lines:{compact:{exact,pm1,params}, full:{…}, classical:{exact,pm1}}}`.
- [ ] Commit metrics.

### Task 5: Export + golden fixture (`ml/export_weights.py`)

- [ ] Fold BN into conv; write `assets/models/{csm-classifier,chargelinenet-compact,chargelinenet-full}.bin` (float16) + `.json` manifests; print sizes.
- [ ] Golden: pick a fixed synthetic image (seed 7), run preprocess + each model in PyTorch, write `tests/fixtures/csm-golden.json` with the input (as uint8 list), classifier probs, and downsampled heatmap stats plus the full heatmap for the compact model (float, 4 decimals) and the full model's (same).
- [ ] Commit weights, manifests, fixture (blobs are binary; ~3.4 MB total is acceptable for GitHub Pages).

### Task 6: JS inference engine (`csm-nn.js`, `csm-worker.js`)

- [ ] `CSMNN.preprocess(Float32Array img) -> Float32Array` identical to Python (standardise, 9×9 Gaussian LCN with σ=2, ε=1e-3).
- [ ] Ops on NCHW Float32Arrays: `conv2d` (kh×kw, same padding, bias), `relu`, `maxpool2`, `upsample2` (bilinear, align_corners=False like PyTorch), `concat`, `gap`, `linear`, `sigmoid`. Tight loops, channel-major.
- [ ] `CSMNN.loadModel(manifestUrl) -> model` (fetches .bin, decodes float16 → Float32Array per layer); `model.run(input) -> {probs} | {heat:Float32Array[3·128·128]}`; `model.params`.
- [ ] `tests/csm-nn.test.js`: hand-computed conv/pool/upsample checks; golden reproduction ≤ 1e-3 (heat) / 1e-4 (probs); timing printed.
- [ ] `csm-worker.js`: messages `{type:'load', name}`, `{type:'run', name, img}` → `{type:'result', name, out, ms}`.
- [ ] Commit.

### Task 7: JS generator (`csm-gen.js`)

- [ ] Port `generate()` with a seeded mulberry32 RNG; same parameter ranges; `injectJump(img, row, dx)` for the click interaction; `tests/csm-gen.test.js`: bounds, counts, class flags, jump changes the image below the row.
- [ ] Contact sheet check via a Node script writing PNG (pure-JS PNG encoder in the test script) → Read it.
- [ ] Commit.

### Task 8: Page panel (`csm-view.js`, `index.html`, `styles.css`)

- [ ] Remove the auto-tuner article, its scripts, `dqd.js`, `tuner-view.js`, `tests/dqd.test.js`, `.dqd-*` CSS.
- [ ] Thesis entry: add one sentence + `div.csm-demo` (map canvas 256×256 CSS, overlay canvas, heatmap thumbnail 96×96, classifier bars, readout, model toggle, caption).
- [ ] `csm-view.js`: on first intersection load classifier + compact in the worker; acquisition animation (rows revealed over ~2.5 s); then classify → gate → line net → decode → overlay + labels; classical count alongside; metrics printed from `csm-metrics.json`; toggle loads full on demand; click injects a jump; new device every ~8 s while visible; reduced motion static; hidden-tab pause.
- [ ] Verify in preview (see spec §8); commit.

### Task 9: Final verification + hand-off

- [ ] All Node tests + Python tests pass; console clean; light/dark; 1440/1024/390; timings recorded; memory note updated.
