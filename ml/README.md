# ml/ — the thesis demo's networks

Compact reimplementations of the two CNNs of Vallabhapurapu et al.,
*Machine Learning for Charge State Characterization of Isolated Double Quantum
Dots*, arXiv:2607.20871 (Diraq / UNSW, 2026), trained on synthetic
isolated-mode charge-stability maps and exported for the browser engine
(`csm-nn.js`). Nothing here uses real device data.

```
python3 ml/test_generator.py                 # generator sanity checks
python3 ml/preview_generator.py sheet.png    # contact sheet to eyeball against the paper's Fig. 12 / Fig. 4
python3 ml/train_csm.py gen                  # ml/data/*.npz (40k line maps, 30k classifier maps + 2k held-out each)
python3 ml/train_csm.py classifier           # CSMClassifier      304k params, ~35 s/epoch on an M2 Pro (MPS)
python3 ml/train_csm.py compact              # ChargeLineNet      171k params
python3 ml/train_csm.py full                 # ChargeLineNet      1.5M params
python3 ml/eval.py                           # -> assets/models/csm-metrics.json (the numbers printed on the page)
python3 ml/export_weights.py                 # -> assets/models/*.json + *.bin (float16) and tests/fixtures/csm-golden.json
node tests/csm-nn.test.js                    # the JS engine must reproduce the PyTorch outputs
```

| file | role |
|---|---|
| `csm_generator.py` | parameterised image simulator (lines, fading, branching, artefacts, noise) + supervision targets; ported to `csm-gen.js` |
| `decode.py` | heatmap → lines (end-anchored offsets, snap to start blobs) and the classical column-profile counter; ported to `csm-decode.js` |
| `train_csm.py` | datasets, the fixed histogram-invariant stem, models, losses, training |
| `eval.py` | held-out metrics; the classical baseline's knobs are grid-searched on training data only |
| `export_weights.py` | BatchNorm folding, float16 export, golden fixture |

Simplifications relative to the paper (all stated on the page): isotropic 3×3
convolutions instead of the anisotropic multi-branch encoder; a fixed
standardise-and-LCN stem instead of the learned histogram-invariant stem;
synthetic training only (the paper fine-tunes on 32 real devices, and trains
its classifier on real data only).
