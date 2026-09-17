"""Sanity checks for the synthetic generator: python3 ml/test_generator.py"""
import sys, numpy as np
sys.path.insert(0, 'ml')
from csm_generator import generate, render_targets, preprocess, H, W

rng = np.random.default_rng(0)
counts = {c: 0 for c in ['clean', 'degraded', 'unstable', 'unclear']}
for i in range(400):
    cls = ['clean', 'degraded', 'unstable', 'unclear'][i % 4]
    img, lab = generate(rng, cls)
    assert img.shape == (H, W) and img.dtype == np.float32
    assert 0.0 <= img.min() and img.max() <= 1.0
    assert lab.n == len(lab.lines)
    for ln in lab.lines:
        assert 0 <= ln.xs < W and 0 <= ln.xe < W, (ln.xs, ln.xe)
        assert 0 <= ln.ye < ln.ys < H, (ln.ye, ln.ys)
        assert ln.ys - ln.ye >= 20, 'lines are at least 20 px long'
    assert lab.unstable == (cls == 'unstable') and lab.unclear == (cls == 'unclear')
    assert lab.clean == (cls == 'clean')
    t = render_targets(lab)
    assert t.shape == (3, H, W) and abs(t[0]).max() <= 1.0
    if lab.n:
        assert t[0].max() > 0.85 and t[0].min() < -0.85   # sub-pixel centres: peak >= exp(-0.5/4.5)
        ye, xe = np.unravel_index(np.argmin(t[0]), t[0].shape)
        assert abs(t[1][ye, xe]) <= 128 / 64 and abs(t[2][ye, xe]) <= 128 / 64
    counts[cls] += 1
p = preprocess(img)
assert p.shape == (H, W) and np.isfinite(p).all()
assert abs(p.mean()) < 0.5, 'LCN output roughly zero-mean'
print('generator ok', counts)
