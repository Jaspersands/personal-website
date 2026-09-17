"""Synthetic isolated-mode charge-stability maps (CSMs).

A parameterised *image* simulator in the spirit of Appendix I of
Vallabhapurapu et al., arXiv:2607.20871 — not a device-physics simulation.
It draws the near-vertical plunger-gate transition lines of an isolated
double dot (sharp at the bottom of the scan, fading toward the top), the
honeycomb-like branching from parasitic dots above them, background
structure, scan artefacts and measurement noise, and returns exact
start/end coordinates for supervision.

Conventions
-----------
Images are float32 arrays of shape (H, W) = (128, 128) in [0, 1] with row 0 at
the top.  x is the detuning axis (P1 - P2), y the exchange-gate axis (dJ).
A transition line runs from its *start* (bottom, sharp) to its *end* (the
blur-onset point, above which it fades out).

The same parameter ranges are ported to csm-gen.js; the two need not be
bit-identical, only statistically equivalent.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

H = W = 128
SIGMA_BLOB = 1.5          # heatmap blob radius, px
OFFSET_SCALE = 64.0       # offsets are regressed in units of 64 px


@dataclass
class Line:
    xs: float  # start x (bottom, sharp)
    ys: float
    xe: float  # end x (fade onset)
    ye: float


@dataclass
class Label:
    n: int
    lines: list[Line] = field(default_factory=list)
    clean: bool = True
    unstable: bool = False
    unclear: bool = False


# ---------------------------------------------------------------------------
# drawing helpers
# ---------------------------------------------------------------------------
_X = np.arange(W, dtype=np.float32)[None, :]
_Y = np.arange(H, dtype=np.float32)[:, None]


def _draw_segment(img: np.ndarray, x1: float, y1: float, x2: float, y2: float,
                  amp1: float, amp2: float, width: float) -> None:
    """Add a Gaussian-profile ridge from (x1, y1) to (x2, y2), amplitude
    interpolating amp1 -> amp2 along it.  Segments are near-vertical to
    moderately tilted, so the profile is taken across x per row."""
    if y1 == y2:
        return
    ya, yb = sorted((y1, y2))
    r0, r1 = max(0, int(math.floor(ya))), min(H - 1, int(math.ceil(yb)))
    if r1 < r0:
        return
    rows = np.arange(r0, r1 + 1, dtype=np.float32)
    t = (rows - y1) / (y2 - y1)
    t = np.clip(t, 0.0, 1.0)
    xc = x1 + (x2 - x1) * t
    amp = amp1 + (amp2 - amp1) * t
    slope = abs((x2 - x1) / (y2 - y1))
    w = width * math.sqrt(1.0 + slope * slope)
    prof = np.exp(-((_X - xc[:, None]) ** 2) / (2.0 * w * w))
    img[r0:r1 + 1, :] += amp[:, None] * prof


def _gauss_blob(img: np.ndarray, cx: float, cy: float, sx: float, sy: float, amp: float) -> None:
    img += amp * np.exp(-((_X - cx) ** 2) / (2 * sx * sx) - ((_Y - cy) ** 2) / (2 * sy * sy))


def _blur(img: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur (no scipy dependency at generation time)."""
    if sigma <= 0:
        return img
    r = int(math.ceil(3 * sigma))
    k = np.exp(-(np.arange(-r, r + 1) ** 2) / (2 * sigma * sigma)).astype(np.float32)
    k /= k.sum()
    pad = np.pad(img, ((r, r), (r, r)), mode="reflect")
    tmp = np.apply_along_axis(lambda m: np.convolve(m, k, mode="valid"), 1, pad)
    out = np.apply_along_axis(lambda m: np.convolve(m, k, mode="valid"), 0, tmp)
    return out.astype(np.float32)


# ---------------------------------------------------------------------------
# generator
# ---------------------------------------------------------------------------
def _sample_lines(rng: np.random.Generator, n: int) -> tuple[list[Line], float, float]:
    """Line geometry: common tilt, spacing with jitter, start/end rows."""
    theta = math.radians(rng.uniform(-12, 12))
    y0 = rng.uniform(92, 124)                      # start row (sharp, bottom)
    L = rng.uniform(30, 85)                        # visible length up to the fade onset
    drift = math.tan(theta) * L                    # how far x moves between start and end
    margin = 5.0
    # the whole set (starts and ends) must stay inside the map
    spacing = rng.uniform(9, 20)
    if n > 1:
        spacing = min(spacing, (W - 2 * margin - abs(drift) - 2) / (n - 1))
    total = spacing * max(n - 1, 0)
    lo = margin + max(0.0, -drift)
    hi = W - margin - total - max(0.0, drift)
    x_left = rng.uniform(lo, hi) if hi > lo else (lo + hi) / 2
    lines = []
    for i in range(n):
        xs = x_left + i * spacing + rng.uniform(-0.15, 0.15) * spacing
        ti = theta + math.radians(rng.uniform(-2, 2))
        ys = y0 + rng.uniform(-3, 3)
        ye = max(6.0, ys - L + rng.uniform(-6, 6))
        xe = xs + math.tan(ti) * (ys - ye)         # tilt: x drifts as the line rises
        xs = float(np.clip(xs, 2, W - 3)); xe = float(np.clip(xe, 2, W - 3))
        lines.append(Line(xs, ys, xe, ye))
    return lines, theta, spacing


def _draw_lines(img, lines, contrast, width, rng, faint_tail: bool):
    for ln in lines:
        # the sharp part: full contrast at the start easing to ~0.45 at the end
        _draw_segment(img, ln.xs, ln.ys, ln.xe, ln.ye, contrast, 0.45 * contrast, width)
        # the fade: from the end point up 8 px to ~0
        tx = (ln.xe - ln.xs) / max(ln.ys - ln.ye, 1e-6)
        yf = max(0.0, ln.ye - 8.0)
        _draw_segment(img, ln.xe, ln.ye, ln.xe + tx * (ln.ye - yf), yf, 0.45 * contrast, 0.0, width * 1.2)
        # the sharp start: a slightly brighter foot over the lowest 6 px
        _draw_segment(img, ln.xs, min(H - 1.0, ln.ys + 3), ln.xs - tx * 6, ln.ys - 6, 0.25 * contrast, 0.0, width)
        if faint_tail:
            _draw_segment(img, ln.xe + tx * (ln.ye - yf), yf, ln.xe + tx * ln.ye, 0.0, 0.12 * contrast, 0.05 * contrast, width * 1.6)


def _draw_branching(img, lines, spacing, contrast, width, rng):
    """Honeycomb-like higher-level transitions above the line ends (parasitic
    dots).  Adjacent line ends are joined by a pair of branches meeting at a
    vertex above their midpoint; each vertex continues upward and branches
    again, for one to three tiers with decreasing contrast."""
    if not lines:
        return
    tiers = int(rng.integers(1, 4))
    phi = math.radians(rng.uniform(28, 40))        # branch angle from vertical
    amp = contrast * rng.uniform(0.3, 0.8)
    width_b = width * rng.uniform(0.9, 1.4)
    ends = [(ln.xe, ln.ye) for ln in lines]
    for _ in range(tiers):
        rise = spacing / 2 / math.tan(phi)          # vertical rise to the vertex between neighbours
        verts = []
        for i, (x, y) in enumerate(ends):
            # outer branches on the two sides
            if i == 0:
                _draw_segment(img, x, y, x - spacing / 2, y - rise, amp, 0.5 * amp, width_b)
            if i == len(ends) - 1:
                _draw_segment(img, x, y, x + spacing / 2, y - rise, amp, 0.5 * amp, width_b)
            if i + 1 < len(ends):
                x2, y2 = ends[i + 1]
                vx, vy = (x + x2) / 2, (y + y2) / 2 - rise
                _draw_segment(img, x, y, vx, vy, amp, 0.8 * amp, width_b)
                _draw_segment(img, x2, y2, vx, vy, amp, 0.8 * amp, width_b)
                verts.append((vx, vy))
        if not verts:
            break
        # vertical stems above vertices, then the next tier joins the stems' tops
        stem = rng.uniform(6, 14)
        ends = []
        for (vx, vy) in verts:
            _draw_segment(img, vx, vy, vx, vy - stem, 0.8 * amp, 0.7 * amp, width_b)
            ends.append((vx, vy - stem))
        amp *= rng.uniform(0.55, 0.85)
        if ends and ends[0][1] < 6:
            break


def _background(img, rng, strength: float = 1.0):
    gx, gy = rng.uniform(-0.15, 0.15) * strength, rng.uniform(-0.2, 0.2) * strength
    img += gx * (_X / W - 0.5) + gy * (_Y / H - 0.5)
    v = rng.uniform(0.0, 0.3) * strength                                  # vignetting
    img -= v * (((_X / W - 0.5) ** 2 + (_Y / H - 0.5) ** 2) * 2)
    for _ in range(int(rng.integers(1, 4))):                              # diffuse blobs
        _gauss_blob(img, rng.uniform(0, W), rng.uniform(0, H), rng.uniform(15, 40), rng.uniform(15, 40),
                    rng.uniform(-0.15, 0.15) * strength)
    if rng.random() < 0.5:                                                # scan-line ripple (row-wise)
        a, per = rng.uniform(0.03, 0.08) * strength, rng.uniform(2, 8)
        img += a * np.sin(2 * np.pi * _Y / per + rng.uniform(0, 6.28)) * (1 + 0.3 * rng.standard_normal((H, 1)))
    if rng.random() < 0.3:                                                # column ripple
        a, per = rng.uniform(0.02, 0.06) * strength, rng.uniform(3, 12)
        img += a * np.sin(2 * np.pi * _X / per + rng.uniform(0, 6.28))
    if rng.random() < 0.35:                                               # broad horizontal gate modulation
        a, per = rng.uniform(0.04, 0.12) * strength, rng.uniform(18, 45)
        img += a * np.sin(2 * np.pi * _Y / per + rng.uniform(0, 6.28))
    if rng.random() < 0.4:                                                # trap / coupling stripes
        for _ in range(int(rng.integers(1, 3))):
            ang = math.radians(rng.uniform(-70, 70))
            x0, y0 = rng.uniform(0, W), rng.uniform(0, H)
            L = 200.0
            _draw_segment(img, x0 - math.sin(ang) * L, y0 - math.cos(ang) * L,
                          x0 + math.sin(ang) * L, y0 + math.cos(ang) * L,
                          rng.uniform(0.08, 0.3) * strength, rng.uniform(0.08, 0.3) * strength, rng.uniform(0.8, 1.6))


def _finish(img, rng, sigma_noise: float, salt: bool):
    img = img + sigma_noise * rng.standard_normal((H, W)).astype(np.float32)
    if salt:
        m = rng.random((H, W)) < 0.002
        img[m] += rng.uniform(0.3, 0.8)
    gain, off = rng.uniform(0.8, 1.2), rng.uniform(0.1, 0.3)
    img = off + gain * img
    return np.clip(img, 0.0, 1.0).astype(np.float32)


def generate(rng: np.random.Generator, cls: str = "clean") -> tuple[np.ndarray, Label]:
    """cls in {'clean', 'degraded', 'unstable', 'unclear'}.

    'degraded' is countable-but-messy (mild artefacts); it is *not* clean for
    the classifier but carries reliable line labels for the line network."""
    n = int(rng.choice(np.arange(0, 8), p=[0.06, 0.16, 0.18, 0.18, 0.16, 0.12, 0.08, 0.06]))
    lines, theta, spacing = _sample_lines(rng, n)
    label = Label(n=n, lines=lines)
    img = np.zeros((H, W), dtype=np.float32)
    contrast = rng.uniform(0.35, 1.0)
    width = rng.uniform(0.9, 2.2)

    if cls == "unclear" and rng.random() < 0.5:
        contrast = rng.uniform(0.05, 0.16)          # lines washed out
    bg_strength = 1.0 if cls in ("clean",) else rng.uniform(1.0, 1.8)
    _background(img, rng, bg_strength)

    if cls == "unstable":
        # the whole line set shifts for a band of rows (telegraph switching), and/or a
        # line exists only in part of the scan
        n_jumps = int(rng.integers(1, 4))
        cuts = sorted(rng.uniform(15, 115, size=n_jumps))
        base = img.copy()
        img[:] = 0
        segs = []            # (row_lo, row_hi, dx)
        prev, dx = 0.0, 0.0
        for c in cuts:
            segs.append((prev, c, dx)); prev = c
            dx += rng.choice([-1, 1]) * rng.uniform(3, 12)
        segs.append((prev, H, dx))
        drop = int(rng.integers(0, n)) if (n > 0 and rng.random() < 0.5) else -1
        drop_row = rng.uniform(30, 100)
        for (lo, hi, sdx) in segs:
            part = np.zeros((H, W), dtype=np.float32)
            shifted = [Line(l.xs + sdx, l.ys, l.xe + sdx, l.ye) for l in lines]
            if drop >= 0:
                shifted = [l for i, l in enumerate(shifted) if not (i == drop and hi > drop_row)]
            _draw_lines(part, shifted, contrast, width, rng, faint_tail=rng.random() < 0.4)
            if rng.random() < 0.65:
                _draw_branching(part, shifted, spacing, contrast, width, rng)
            r0, r1 = int(lo), int(hi)
            img[r0:r1] += part[r0:r1]
        img += base
        label.unstable, label.clean = True, False
    else:
        _draw_lines(img, lines, contrast, width, rng, faint_tail=rng.random() < 0.4)
        if rng.random() < 0.65:
            _draw_branching(img, lines, spacing, contrast, width, rng)

    if cls == "unclear":
        label.unclear, label.clean = True, False
        mode = rng.integers(0, 4)
        if mode == 0:                                   # obscuring broad transition band
            ang = math.radians(rng.uniform(-60, 60))
            x0, y0 = rng.uniform(20, W - 20), rng.uniform(20, H - 20)
            _draw_segment(img, x0 - math.sin(ang) * 200, y0 - math.cos(ang) * 200,
                          x0 + math.sin(ang) * 200, y0 + math.cos(ang) * 200,
                          rng.uniform(0.35, 0.7), rng.uniform(0.35, 0.7), rng.uniform(6, 14))
        elif mode == 1:                                 # heavy stripes
            for _ in range(int(rng.integers(6, 14))):
                ang = math.radians(rng.uniform(-80, 80))
                x0, y0 = rng.uniform(0, W), rng.uniform(0, H)
                _draw_segment(img, x0 - math.sin(ang) * 200, y0 - math.cos(ang) * 200,
                              x0 + math.sin(ang) * 200, y0 + math.cos(ang) * 200,
                              rng.uniform(0.2, 0.45), rng.uniform(0.2, 0.45), rng.uniform(0.8, 2.5))
        elif mode == 2:                                 # smeared / blurred sensor
            img = _blur(img, rng.uniform(2.0, 3.5))
        sigma = rng.uniform(0.12, 0.25) if mode == 3 or contrast < 0.2 else rng.uniform(0.06, 0.14)
        img = _finish(img, rng, sigma, salt=rng.random() < 0.3)
        return img, label

    if cls == "degraded":
        label.clean = False
        sigma = rng.uniform(0.06, 0.11)
    elif cls == "unstable":
        sigma = rng.uniform(0.03, 0.09)
    else:
        sigma = rng.uniform(0.02, 0.07)
    img = _finish(img, rng, sigma, salt=rng.random() < 0.2)
    return img, label


def render_targets(label: Label) -> np.ndarray:
    """3 x H x W float32: signed heatmap (start +1, end -1 Gaussians) and
    offset vectors (dx, dy)/OFFSET_SCALE from each end toward its start,
    weighted by the end blob."""
    t = np.zeros((3, H, W), dtype=np.float32)
    starts = np.zeros((H, W), dtype=np.float32)
    ends = np.zeros((H, W), dtype=np.float32)
    for ln in label.lines:
        gs = np.exp(-((_X - ln.xs) ** 2 + (_Y - ln.ys) ** 2) / (2 * SIGMA_BLOB ** 2))
        ge = np.exp(-((_X - ln.xe) ** 2 + (_Y - ln.ye) ** 2) / (2 * SIGMA_BLOB ** 2))
        starts = np.maximum(starts, gs)
        ends = np.maximum(ends, ge)
        t[1] += ge * (ln.xs - ln.xe) / OFFSET_SCALE
        t[2] += ge * (ln.ys - ln.ye) / OFFSET_SCALE
    t[0] = np.clip(starts - ends, -1.0, 1.0)   # start and end blobs are >= 30 px apart, so they never overlap
    return t


def preprocess(img: np.ndarray) -> np.ndarray:
    """Histogram-invariant stem stand-in: per-image standardisation followed by
    local contrast normalisation (9x9 Gaussian neighbourhood, sigma 2).
    Mirrored exactly in csm-nn.js."""
    x = img.astype(np.float32)
    x = (x - x.mean()) / (x.std() + 1e-6)
    mu = _blur(x, 2.0)
    var = _blur((x - mu) ** 2, 2.0)
    return ((x - mu) / np.sqrt(var + 1e-3)).astype(np.float32)


def to_uint8(img: np.ndarray) -> np.ndarray:
    return np.clip(np.round(img * 255), 0, 255).astype(np.uint8)
