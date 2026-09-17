"""Train CSMClassifier and ChargeLineNet (compact / full) on synthetic CSMs.

    python3 ml/train_csm.py gen            # write ml/data/*.npz
    python3 ml/train_csm.py classifier
    python3 ml/train_csm.py compact
    python3 ml/train_csm.py full

Architectures follow the spec (docs/superpowers/specs/2026-09-17-csm-readout-design.md):
compact reimplementations of the two networks of arXiv:2607.20871 with isotropic
3x3 convolutions and a fixed, parameter-free histogram-invariant stem.
"""
from __future__ import annotations

import math
import os
import sys
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(__file__))
from csm_generator import H, W, OFFSET_SCALE, generate, render_targets  # noqa: E402
from decode import decode_lines  # noqa: E402

DATA = os.path.join(os.path.dirname(__file__), "data")
CKPT = os.path.join(os.path.dirname(__file__), "checkpoints")
MAX_LINES = 8
DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cpu")


# ---------------------------------------------------------------------------
# data
# ---------------------------------------------------------------------------
def _pack(img, lab):
    lines = np.full((MAX_LINES, 4), np.nan, dtype=np.float32)
    for i, ln in enumerate(lab.lines[:MAX_LINES]):
        lines[i] = (ln.xs, ln.ys, ln.xe, ln.ye)
    flags = np.array([lab.clean, lab.unstable, lab.unclear], dtype=np.uint8)
    return (np.clip(np.round(img * 255), 0, 255).astype(np.uint8), lines, flags, lab.n)


def gen_split(name, n, classes, probs, seed):
    rng = np.random.default_rng(seed)
    imgs = np.zeros((n, H, W), np.uint8); lines = np.zeros((n, MAX_LINES, 4), np.float32)
    flags = np.zeros((n, 3), np.uint8); counts = np.zeros(n, np.int16)
    t0 = time.time()
    for i in range(n):
        cls = str(rng.choice(classes, p=probs))
        img, lab = generate(rng, cls)
        imgs[i], lines[i], flags[i], counts[i] = _pack(img, lab)
    np.savez(os.path.join(DATA, name + ".npz"), imgs=imgs, lines=lines, flags=flags, counts=counts)
    print(f"{name}: {n} images in {time.time() - t0:.0f}s")


def gen_all():
    os.makedirs(DATA, exist_ok=True)
    # line corpus: countable images only (clean + degraded)
    gen_split("lines_train", 40000, ["clean", "degraded"], [0.7, 0.3], 1)
    gen_split("lines_val", 2000, ["clean", "degraded"], [0.7, 0.3], 2)
    # classifier corpus: balanced over the three quality classes
    gen_split("cls_train", 30000, ["clean", "unstable", "unclear"], [1 / 3, 1 / 3, 1 / 3], 3)
    gen_split("cls_val", 2000, ["clean", "unstable", "unclear"], [1 / 3, 1 / 3, 1 / 3], 4)


class CSMData(torch.utils.data.Dataset):
    def __init__(self, name, task, augment):
        d = np.load(os.path.join(DATA, name + ".npz"))
        self.imgs, self.lines, self.flags, self.counts = d["imgs"], d["lines"], d["flags"], d["counts"]
        self.task, self.augment = task, augment

    def __len__(self):
        return len(self.imgs)

    def __getitem__(self, i):
        img = self.imgs[i].astype(np.float32) / 255.0
        flip = self.augment and np.random.random() < 0.5
        if flip:
            img = img[:, ::-1].copy()
        if self.task == "cls":
            return torch.from_numpy(img)[None], torch.from_numpy(self.flags[i].astype(np.float32))
        # line targets rendered on the fly (a 3x128x128 float target per image is too big to store)
        from csm_generator import Label, Line
        lab = Label(n=int(self.counts[i]))
        for row in self.lines[i]:
            if np.isnan(row[0]):
                break
            xs, ys, xe, ye = row
            if flip:
                xs, xe = W - 1 - xs, W - 1 - xe
            lab.lines.append(Line(float(xs), float(ys), float(xe), float(ye)))
        return torch.from_numpy(img)[None], torch.from_numpy(render_targets(lab))


# ---------------------------------------------------------------------------
# preprocessing stem (fixed, parameter-free): standardise + local contrast normalisation
# ---------------------------------------------------------------------------
def lcn_kernel(sigma=2.0, r=4):
    x = torch.arange(-r, r + 1, dtype=torch.float32)
    g = torch.exp(-x * x / (2 * sigma * sigma))
    g = g / g.sum()
    return (g[:, None] * g[None, :])[None, None]      # 1 x 1 x 9 x 9


_K = None


def preprocess_t(x: torch.Tensor) -> torch.Tensor:
    """x: B x 1 x H x W in [0,1] -> standardised + LCN. Mirrors preprocess() in
    csm_generator.py / CSMNN.preprocess in csm-nn.js (reflect padding, 9x9, sigma 2, eps 1e-3)."""
    global _K
    if _K is None or _K.device != x.device:
        _K = lcn_kernel().to(x.device)
    mu = x.mean(dim=(2, 3), keepdim=True); sd = x.std(dim=(2, 3), keepdim=True, unbiased=False)
    x = (x - mu) / (sd + 1e-6)
    pad = lambda t: F.pad(t, (4, 4, 4, 4), mode="reflect")
    lm = F.conv2d(pad(x), _K)
    lv = F.conv2d(pad((x - lm) ** 2), _K)
    return (x - lm) / torch.sqrt(lv + 1e-3)


# ---------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------
def cbr(cin, cout):
    return nn.Sequential(nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True))


class CSMClassifier(nn.Module):
    def __init__(self, widths=(16, 32, 64, 128)):
        super().__init__()
        layers, prev = [cbr(1, widths[0])], widths[0]
        for w in widths:
            layers += [cbr(prev, w), cbr(w, w), nn.MaxPool2d(2)]
            prev = w
        self.features = nn.Sequential(*layers)
        self.head = nn.Sequential(nn.Linear(prev, 64), nn.ReLU(inplace=True), nn.Linear(64, 3))

    def forward(self, x):
        f = self.features(preprocess_t(x))
        return self.head(f.mean(dim=(2, 3)))


class ChargeLineNet(nn.Module):
    """U-Net: 3 encoder levels, bottleneck at 16x16, 3 decoder levels with skips,
    1x1 head -> (signed heatmap, dx, dy)."""

    def __init__(self, widths=(12, 24, 48), extra_bneck=0):
        super().__init__()
        c1, c2, c3 = widths
        self.enc1 = nn.Sequential(cbr(1, c1), cbr(c1, c1))
        self.enc2 = nn.Sequential(cbr(c1, c2), cbr(c2, c2))
        self.enc3 = nn.Sequential(cbr(c2, c3), cbr(c3, c3))
        self.bneck = nn.Sequential(*([cbr(c3, c3), cbr(c3, c3)] + [cbr(c3, c3) for _ in range(extra_bneck)]))
        self.dec3 = nn.Sequential(cbr(c3 + c3, c3), cbr(c3, c3))
        self.dec2 = nn.Sequential(cbr(c3 + c2, c2), cbr(c2, c2))
        self.dec1 = nn.Sequential(cbr(c2 + c1, c1), cbr(c1, c1))
        self.head = nn.Conv2d(c1, 3, 1)

    def forward(self, x):
        x = preprocess_t(x)
        e1 = self.enc1(x)
        e2 = self.enc2(F.max_pool2d(e1, 2))
        e3 = self.enc3(F.max_pool2d(e2, 2))
        b = self.bneck(F.max_pool2d(e3, 2))
        up = lambda t: F.interpolate(t, scale_factor=2, mode="bilinear", align_corners=False)
        d3 = self.dec3(torch.cat([up(b), e3], 1))
        d2 = self.dec2(torch.cat([up(d3), e2], 1))
        d1 = self.dec1(torch.cat([up(d2), e1], 1))
        return self.head(d1)


MODELS = {
    "classifier": lambda: CSMClassifier(),
    "compact": lambda: ChargeLineNet((12, 24, 48), 0),
    "full": lambda: ChargeLineNet((32, 64, 128), 2),
}


def n_params(m):
    return sum(p.numel() for p in m.parameters())


# ---------------------------------------------------------------------------
# losses
# ---------------------------------------------------------------------------
def line_loss(pred, tgt):
    heat_t = tgt[:, 0:1]
    w = 1.0 + 9.0 * (heat_t.abs() > 0.05).float()            # foreground-weighted MSE
    l_heat = (w * (pred[:, 0:1] - heat_t) ** 2).mean()
    mask = (heat_t < -0.05).float()                            # offsets supervised at end blobs only
    l_off = (F.smooth_l1_loss(pred[:, 1:3], tgt[:, 1:3], reduction="none") * mask).sum() / (mask.sum() * 2 + 1.0)
    return l_heat + 0.5 * l_off, l_heat.item(), l_off.item()


def count_accuracy(model, ds, n=400):
    model.eval()
    exact = pm1 = 0
    with torch.no_grad():
        for i in range(0, n, 50):
            xb = torch.stack([ds[j][0] for j in range(i, min(i + 50, n))]).to(DEVICE)
            out = model(xb).cpu().numpy()
            for k in range(out.shape[0]):
                got = len(decode_lines(out[k]))
                truth = int(ds.counts[i + k])
                exact += got == truth; pm1 += abs(got - truth) <= 1
    model.train()
    return exact / n, pm1 / n


# ---------------------------------------------------------------------------
# training
# ---------------------------------------------------------------------------
def train(name, epochs=None, batch=64):
    os.makedirs(CKPT, exist_ok=True)
    task = "cls" if name == "classifier" else "lines"
    tr = CSMData("cls_train" if task == "cls" else "lines_train", task, augment=True)
    va = CSMData("cls_val" if task == "cls" else "lines_val", task, augment=False)
    dl = torch.utils.data.DataLoader(tr, batch_size=batch, shuffle=True, num_workers=4, drop_last=True, persistent_workers=True)
    model = MODELS[name]().to(DEVICE)
    print(f"{name}: {n_params(model):,} parameters, device {DEVICE}")
    epochs = epochs or {"classifier": 10, "compact": 15, "full": 20}[name]
    lr = {"classifier": 2e-3, "compact": 2e-3, "full": 1e-3}[name]
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    steps = epochs * len(dl); warm = len(dl)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / steps))))
    if task == "cls":
        pos = tr.flags.mean(axis=0); pos_weight = torch.tensor((1 - pos) / np.maximum(pos, 1e-3), dtype=torch.float32).to(DEVICE)
    best = -1.0
    for ep in range(epochs):
        model.train(); t0 = time.time(); tot = 0.0; nb = 0
        for xb, yb in dl:
            xb, yb = xb.to(DEVICE), yb.to(DEVICE)
            out = model(xb)
            if task == "cls":
                loss = F.binary_cross_entropy_with_logits(out, yb, pos_weight=pos_weight)
            else:
                loss, _, _ = line_loss(out, yb)
            opt.zero_grad(set_to_none=True); loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); tot += loss.item(); nb += 1
        # validation
        model.eval()
        with torch.no_grad():
            if task == "cls":
                xs = torch.from_numpy(va.imgs[:1000].astype(np.float32) / 255.0)[:, None].to(DEVICE)
                probs = torch.sigmoid(model(xs)).cpu().numpy()
                acc = ((probs > 0.5) == (va.flags[:1000] > 0)).mean(axis=0)
                score = float(acc.mean())
                msg = f"val acc clean/unstable/unclear = {acc[0]:.3f}/{acc[1]:.3f}/{acc[2]:.3f} macro {score:.3f}"
            else:
                exact, pm1 = count_accuracy(model, va, 400)
                score = exact
                msg = f"val exact-count {exact:.3f}  ±1 {pm1:.3f}"
        print(f"ep {ep + 1}/{epochs} loss {tot / nb:.4f}  {msg}  ({time.time() - t0:.0f}s)", flush=True)
        if score > best:
            best = score
            torch.save(model.state_dict(), os.path.join(CKPT, name + ".pt"))
    print(f"{name}: best {best:.3f} saved to {CKPT}/{name}.pt")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "gen":
        gen_all()
    else:
        train(cmd, epochs=int(sys.argv[2]) if len(sys.argv) > 2 else None)
