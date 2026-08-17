"""Measure how colourful the Shop by moment photographs actually are.

The complaint is that the rail reads grey. Saturation is the number that says
whether that is true, so this reports it per image alongside the hero and the
saree cut-outs for comparison — the sarees are the colour the rail is being
judged against.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "assets" / "images"

MOMENTS = [
    "moment-monday.png",
    "moment-important-room.png",
    "moment-evening.png",
    "moment-work-trip.png",
    "moment-celebration.png",
]
COMPARE = ["hero.png", "product-1.png", "product-4.png", "pov-editorial.png"]


def stats(path):
    img = Image.open(path).convert("RGB")
    img.thumbnail((400, 400))
    rgb = np.asarray(img, dtype=np.float32) / 255.0

    hi = rgb.max(axis=2)
    lo = rgb.min(axis=2)
    # HSV saturation, guarding the black pixels where it is undefined.
    sat = np.where(hi > 0, (hi - lo) / np.maximum(hi, 1e-6), 0.0)
    value = hi

    # A pixel reading as grey to the eye: almost no separation between the
    # strongest and weakest channel, anywhere it is bright enough to notice.
    visible = value > 0.15
    greyish = (sat < 0.10) & visible
    grey_share = greyish.sum() / max(visible.sum(), 1)

    return {
        "sat": float(sat[visible].mean()),
        "grey": float(grey_share),
        "value": float(value.mean()),
        "size": Image.open(path).size,
    }


def bar(fraction, width=24):
    filled = int(round(fraction * width))
    return "#" * filled + "." * (width - filled)


print(f"{'image':<30} {'mean sat':>8}  {'% grey pixels':<32} {'bright':>6}")
print("-" * 82)

for group, names in (("Shop by moment", MOMENTS), ("for comparison", COMPARE)):
    print(f"\n{group}")
    for name in names:
        path = ROOT / name
        if not path.exists():
            print(f"  {name:<28} missing")
            continue
        s = stats(path)
        print(f"  {name:<28} {s['sat']:>7.3f}  {bar(s['grey'])} {s['grey']:>5.0%} {s['value']:>6.2f}")

print(
    "\nSaturation runs 0 (grey) to 1 (pure colour). Editorial fashion photography\n"
    "usually sits around 0.20-0.35; below ~0.15 an image reads as desaturated."
)
