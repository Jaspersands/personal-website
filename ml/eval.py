"""Held-out evaluation -> assets/models/csm-metrics.json

    python3 ml/eval.py

Line networks: exact and ±1 line-count accuracy and endpoint localisation on
lines_val (2,000 fresh synthetic maps). Classical counter: the same, after a
small grid search over its knobs on a 1,000-image sample of *training* data
(as in Appendix J of arXiv:2607.20871, the baseline is tuned, never on the
held-out set). Classifier: per-class accuracy at tau = 0.5 on cls_val.
Every number printed on the page comes from this file.
"""
from __future__ import annotations

import itertools
import json
import os
import sys
import time

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(__file__))
from decode import classical_count, decode_lines  # noqa: E402
from train_csm import CKPT, DATA, DEVICE, MODELS, n_params  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "models", "csm-metrics.json")


def load_model(name):
    m = MODELS[name]()
    m.load_state_dict(torch.load(os.path.join(CKPT, name + ".pt"), map_location="cpu"))
    return m.to(DEVICE).eval()


def eval_lines(name, imgs, counts, lines_gt):
    model = load_model(name)
    exact = pm1 = 0; errs = []
    t0 = time.time()
    with torch.no_grad():
        for i in range(0, len(imgs), 50):
            xb = torch.from_numpy(imgs[i:i + 50].astype(np.float32) / 255.0)[:, None].to(DEVICE)
            out = model(xb).cpu().numpy()
            for k in range(out.shape[0]):
                got = decode_lines(out[k]); truth = int(counts[i + k])
                exact += len(got) == truth; pm1 += abs(len(got) - truth) <= 1
                if len(got) == truth and truth:
                    gt = sorted([r for r in lines_gt[i + k] if not np.isnan(r[0])], key=lambda r: r[0])
                    for g, t in zip(got, gt):
                        errs.append(np.hypot(g["xs"] - t[0], g["ys"] - t[1])); errs.append(np.hypot(g["xe"] - t[2], g["ye"] - t[3]))
    n = len(imgs)
    return {"exact": exact / n, "pm1": pm1 / n, "endpoint_px": float(np.mean(errs)) if errs else None,
            "params": n_params(model), "eval_seconds": round(time.time() - t0, 1)}


def tune_classical(imgs, counts):
    grid = {"sigma_y": [4, 6, 10], "sigma_x": [1.0, 1.5, 2.5], "prominence": [0.15, 0.25, 0.35, 0.5], "min_sep": [3, 4, 6]}
    best, best_acc = None, -1
    for combo in itertools.product(*grid.values()):
        kw = dict(zip(grid.keys(), combo))
        acc = np.mean([classical_count(imgs[i].astype(np.float32) / 255.0, **kw)[0] == int(counts[i]) for i in range(len(imgs))])
        if acc > best_acc:
            best, best_acc = kw, acc
    return best, float(best_acc)


def eval_classical(imgs, counts, kw):
    exact = pm1 = 0
    for i in range(len(imgs)):
        got = classical_count(imgs[i].astype(np.float32) / 255.0, **kw)[0]
        exact += got == int(counts[i]); pm1 += abs(got - int(counts[i])) <= 1
    return {"exact": exact / len(imgs), "pm1": pm1 / len(imgs), "knobs": kw}


def eval_classifier(imgs, flags):
    model = load_model("classifier")
    with torch.no_grad():
        probs = []
        for i in range(0, len(imgs), 100):
            xb = torch.from_numpy(imgs[i:i + 100].astype(np.float32) / 255.0)[:, None].to(DEVICE)
            probs.append(torch.sigmoid(model(xb)).cpu().numpy())
    probs = np.concatenate(probs)
    acc = ((probs > 0.5) == (flags > 0)).mean(axis=0)
    return {"clean": float(acc[0]), "unstable": float(acc[1]), "unclear": float(acc[2]), "macro": float(acc.mean()), "params": n_params(model)}


if __name__ == "__main__":
    lv = np.load(os.path.join(DATA, "lines_val.npz")); lt = np.load(os.path.join(DATA, "lines_train.npz"))
    cv = np.load(os.path.join(DATA, "cls_val.npz"))
    metrics = {"generated": time.strftime("%Y-%m-%d"), "heldout": int(len(lv["imgs"])), "lines": {}, "classifier": None}
    names = [n for n in ("compact", "full") if os.path.exists(os.path.join(CKPT, n + ".pt"))]
    for name in names:
        metrics["lines"][name] = eval_lines(name, lv["imgs"], lv["counts"], lv["lines"])
        print(name, metrics["lines"][name])
    knobs, tune_acc = tune_classical(lt["imgs"][:1000], lt["counts"][:1000])
    print("classical knobs", knobs, "train-sample accuracy", round(tune_acc, 3))
    metrics["lines"]["classical"] = eval_classical(lv["imgs"], lv["counts"], knobs)
    print("classical", metrics["lines"]["classical"])
    metrics["classifier"] = eval_classifier(cv["imgs"], cv["flags"])
    print("classifier", metrics["classifier"])
    json.dump(metrics, open(OUT, "w"), indent=1)
    print("wrote", OUT)
