"""Export trained checkpoints for the browser engine (csm-nn.js).

    python3 ml/export_weights.py            # all three models + golden fixture

Format: assets/models/<name>.json manifest + <name>.bin (little-endian float16).
BatchNorm is folded into the preceding convolution.  Layers are listed in the
canonical order the JS engine expects for each architecture; each entry gives
the weight/bias offsets (in elements) into the blob.  Conv weights are stored
in PyTorch order [cout][cin][kh][kw], biases [cout].
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import torch
import torch.nn as nn

sys.path.insert(0, os.path.dirname(__file__))
from csm_generator import generate  # noqa: E402
from decode import classical_count, decode_lines  # noqa: E402
from train_csm import CKPT, MODELS, n_params  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "models")
FIX = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tests", "fixtures")


def fold(conv: nn.Conv2d, bn: nn.BatchNorm2d | None):
    w = conv.weight.detach().cpu().numpy().astype(np.float64)
    b = conv.bias.detach().cpu().numpy().astype(np.float64) if conv.bias is not None else np.zeros(w.shape[0])
    if bn is not None:
        g = bn.weight.detach().cpu().numpy(); beta = bn.bias.detach().cpu().numpy()
        mu = bn.running_mean.cpu().numpy(); var = bn.running_var.cpu().numpy()
        s = g / np.sqrt(var + bn.eps)
        w = w * s[:, None, None, None]
        b = beta + (b - mu) * s
    return w.astype(np.float32), b.astype(np.float32)


def cbr_entries(seq: nn.Sequential, prefix: str):
    """A Sequential of cbr blocks (Conv, BN, ReLU) -> list of (name, w, b, relu)."""
    out = []
    for i, block in enumerate(seq):
        if isinstance(block, nn.Sequential):
            conv, bn = block[0], block[1]
            w, b = fold(conv, bn)
            out.append((f"{prefix}.{i}", w, b, True))
    return out


def export(name: str):
    model = MODELS[name]()
    model.load_state_dict(torch.load(os.path.join(CKPT, name + ".pt"), map_location="cpu"))
    model.eval()
    entries = []
    if name == "classifier":
        feats = list(model.features)
        stages, cur = [], []
        # features = [stem, (cbr, cbr, pool) x 4]
        stem = feats[0]
        w, b = fold(stem[0], stem[1]); entries.append(("stem", w, b, True))
        idx = 1
        for s in range(4):
            for j in range(2):
                blk = feats[idx]; idx += 1
                w, b = fold(blk[0], blk[1]); entries.append((f"s{s + 1}.{j}", w, b, True))
            idx += 1  # pool
        fc1, fc2 = model.head[0], model.head[2]
        entries.append(("fc1", fc1.weight.detach().numpy(), fc1.bias.detach().numpy(), True))
        entries.append(("fc2", fc2.weight.detach().numpy(), fc2.bias.detach().numpy(), False))
        kind, meta = "classifier", {"widths": [16, 32, 64, 128]}
    else:
        for part in ("enc1", "enc2", "enc3", "bneck", "dec3", "dec2", "dec1"):
            entries += cbr_entries(getattr(model, part), part)
        entries.append(("head", model.head.weight.detach().numpy(), model.head.bias.detach().numpy(), False))
        kind = "unet"
        meta = {"widths": [model.enc1[0][0].out_channels, model.enc2[0][0].out_channels, model.enc3[0][0].out_channels],
                "bneck_convs": len(model.bneck)}

    blob = []
    layers = []
    off = 0
    for (lname, w, b, relu) in entries:
        w = np.asarray(w, np.float32); b = np.asarray(b, np.float32)
        entry = {"name": lname, "type": "linear" if w.ndim == 2 else "conv", "cout": int(w.shape[0]), "cin": int(w.shape[1]),
                 "k": int(w.shape[2]) if w.ndim == 4 else 1, "relu": bool(relu), "w_off": off, "w_len": int(w.size)}
        blob.append(w.ravel()); off += w.size
        entry["b_off"] = off; entry["b_len"] = int(b.size)
        blob.append(b.ravel()); off += b.size
        layers.append(entry)
    flat = np.concatenate(blob).astype(np.float16)
    os.makedirs(OUT, exist_ok=True)
    flat.tofile(os.path.join(OUT, name + ".bin"))
    manifest = {"name": name, "kind": kind, "input": [1, 128, 128], "params": n_params(model), "elements": int(flat.size),
                "dtype": "float16", "layers": layers, **meta}
    json.dump(manifest, open(os.path.join(OUT, name + ".json"), "w"))
    print(f"{name}: {len(layers)} layers, {flat.size:,} elements, {flat.size * 2 / 1e6:.2f} MB")
    return model


def golden(models: dict):
    rng = np.random.default_rng(7)
    img, lab = generate(rng, "clean")
    q8 = np.clip(np.round(img * 255), 0, 255).astype(np.uint8)
    x = torch.from_numpy(q8.astype(np.float32) / 255.0)[None, None]   # exactly what the JS engine receives
    fx = {"image": q8.ravel().tolist(), "n": lab.n,
          "lines_true": [[ln.xs, ln.ys, ln.xe, ln.ye] for ln in lab.lines]}
    cc, prof = classical_count(q8.astype(np.float32) / 255.0)
    fx["classical"] = {"count": int(cc), "profile": [round(float(v), 4) for v in prof]}
    with torch.no_grad():
        probs = torch.sigmoid(models["classifier"](x))[0].numpy()
        fx["classifier"] = [round(float(p), 6) for p in probs]
        for name in ("compact", "full"):
            out = models[name](x)[0].numpy()
            fx[name] = {"heat": [round(float(v), 4) for v in out[0].ravel()],
                        "offsets_sub8": [round(float(v), 4) for v in out[1:, ::8, ::8].ravel()],
                        "lines": decode_lines(out)}
    os.makedirs(FIX, exist_ok=True)
    json.dump(fx, open(os.path.join(FIX, "csm-golden.json"), "w"))
    print("golden fixture written; n =", lab.n)


if __name__ == "__main__":
    names = sys.argv[1:] or ["classifier", "compact", "full"]
    ms = {n: export(n) for n in names}
    if all(n in ms for n in ("classifier", "compact", "full")):
        golden(ms)
    else:
        print("golden fixture skipped (needs all three models)")
