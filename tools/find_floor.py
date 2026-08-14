"""Find where the floor line sits in each photo, and how far down the drape reaches.

The wall meets the floor at a strong horizontal edge. Everything below it is rug,
marble and pot plants — the parts that must not survive into a product image.
"""

from pathlib import Path

import numpy as np
from PIL import Image

for p in sorted(Path("reference/sarees").glob("saree-*.png")):
    a = np.asarray(Image.open(p).convert("L"), dtype=float)
    h, w = a.shape

    # Look only at the outer columns, which are backdrop rather than garment.
    side = np.concatenate([a[:, : int(w * 0.14)], a[:, int(w * 0.86) :]], axis=1)
    prof = side.mean(axis=1)
    grad = np.abs(np.diff(prof))

    lower = int(h * 0.55)
    floor = lower + int(np.argmax(grad[lower:]))

    print(f"{p.name}  floor edge at y={floor}  ({floor/h:.2f} of height)")
