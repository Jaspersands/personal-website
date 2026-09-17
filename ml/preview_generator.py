"""Contact sheet of synthetic CSMs per class -> scratchpad PNG, for eyeballing
against Fig. 12 / Fig. 4 of arXiv:2607.20871."""
import sys, numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, 'ml')
from csm_generator import generate, render_targets, H, W

rng = np.random.default_rng(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
out = sys.argv[1] if len(sys.argv) > 1 else 'contact.png'
classes = ['clean', 'degraded', 'unstable', 'unclear']
cols, rows, S = 6, len(classes), 128
sheet = Image.new('RGB', (cols * (S + 6), rows * (S + 6)), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for r, cls in enumerate(classes):
    for c in range(cols):
        img, lab = generate(rng, cls)
        tile = Image.fromarray((img * 255).astype(np.uint8)).convert('RGB')
        td = ImageDraw.Draw(tile)
        for ln in lab.lines:   # supervision targets: start ▲ (green), end ▼ (orange)
            td.polygon([(ln.xs, ln.ys - 4), (ln.xs - 3, ln.ys + 1), (ln.xs + 3, ln.ys + 1)], fill=(80, 220, 120))
            td.polygon([(ln.xe, ln.ye + 4), (ln.xe - 3, ln.ye - 1), (ln.xe + 3, ln.ye - 1)], fill=(230, 150, 60))
        td.text((3, 3), f"{cls} N={lab.n}", fill=(255, 210, 90))
        sheet.paste(tile, (c * (S + 6) + 3, r * (S + 6) + 3))
sheet.save(out)
print('wrote', out)
