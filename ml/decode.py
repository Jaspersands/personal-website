"""Heatmap decoding and the classical baseline counter.

Mirrored exactly in csm-decode.js — keep the two in step.

decode_lines: signed heatmap + offset field -> paired start/end lines
  (Appendix F of arXiv:2607.20871, simplified: 3x3 non-maximum suppression,
  end-anchored offsets, snap to the nearest start within a corridor).
classical_count: the 'Profile' column-projection counter of Appendix J.
"""
from __future__ import annotations

import math

import numpy as np

OFFSET_SCALE = 64.0


def _peaks2d(a: np.ndarray, tau: float) -> list[tuple[int, int, float]]:
    """(y, x, value) of strict 3x3 local maxima above tau."""
    H, W = a.shape
    p = np.pad(a, 1, mode="constant", constant_values=-np.inf)
    c = p[1:-1, 1:-1]
    m = c > tau
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            m &= c >= p[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
    ys, xs = np.nonzero(m)
    out = [(int(y), int(x), float(a[y, x])) for y, x in zip(ys, xs)]
    out.sort(key=lambda t: -t[2])
    return out


def decode_lines(heat: np.ndarray, tau: float = 0.3, corridor: float = 8.0) -> list[dict]:
    """heat: (3, H, W). Returns lines sorted by start x:
    [{xs, ys, xe, ye, score}]"""
    h = heat[0]
    starts = _peaks2d(h, tau)
    ends = _peaks2d(-h, tau)
    used = set()
    lines = []
    for (ye, xe, v) in ends:
        mag = max(v, 0.2)
        # offsets were regressed weighted by the end blob, so divide by its height
        dx = float(heat[1][ye, xe]) / mag * OFFSET_SCALE
        dy = float(heat[2][ye, xe]) / mag * OFFSET_SCALE
        px, py = xe + dx, ye + dy
        best, bd = -1, corridor
        for i, (ys, xs, sv) in enumerate(starts):
            if i in used:
                continue
            d = math.hypot(xs - px, ys - py)
            if d < bd:
                best, bd = i, d
        if best >= 0:
            used.add(best)
            ys, xs, sv = starts[best]
            lines.append({"xs": float(xs), "ys": float(ys), "xe": float(xe), "ye": float(ye), "score": float(min(v, sv))})
    lines.sort(key=lambda l: l["xs"])
    return lines


def _gauss1d(sigma: float, deriv: int = 0) -> np.ndarray:
    r = int(math.ceil(3 * sigma))
    x = np.arange(-r, r + 1, dtype=np.float64)
    g = np.exp(-x * x / (2 * sigma * sigma))
    g /= g.sum()
    if deriv == 2:
        g = g * (x * x - sigma * sigma) / sigma ** 4
    return g.astype(np.float32)


def _conv_rows(img: np.ndarray, k: np.ndarray) -> np.ndarray:
    r = len(k) // 2
    pad = np.pad(img, ((0, 0), (r, r)), mode="reflect")
    return np.stack([np.convolve(row, k, mode="valid") for row in pad]).astype(np.float32)


def _conv_cols(img: np.ndarray, k: np.ndarray) -> np.ndarray:
    return _conv_rows(img.T, k).T


def classical_count(img: np.ndarray, sigma_y: float = 6.0, sigma_x: float = 1.5,
                    prominence: float = 0.25, min_sep: int = 4) -> tuple[int, np.ndarray]:
    """The 'Profile' detector: smooth along the line direction, matched-filter
    (negative second derivative of a Gaussian) across it, rectify, integrate
    over rows, and pick peaks of the column profile."""
    sm = _conv_cols(img.astype(np.float32), _gauss1d(sigma_y))
    resp = -_conv_rows(sm, _gauss1d(sigma_x, deriv=2))     # bright ridges -> positive response
    resp = np.maximum(resp, 0.0)
    profile = resp.sum(axis=0)
    profile = profile - np.percentile(profile, 20)          # crude background flattening
    profile = np.maximum(profile, 0.0)
    thr = prominence * (profile.max() + 1e-9)
    peaks = []
    for x in range(1, len(profile) - 1):
        if profile[x] > thr and profile[x] >= profile[x - 1] and profile[x] > profile[x + 1]:
            if not peaks or x - peaks[-1] >= min_sep:
                peaks.append(x)
            elif profile[x] > profile[peaks[-1]]:
                peaks[-1] = x
    return len(peaks), profile
