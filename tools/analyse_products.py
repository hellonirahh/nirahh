"""Report how the current product images are built, so replacements can match.

Prints each image's dimensions, aspect ratio, and the colour of its border
region — which is what reads as the card "background" behind the garment.
"""

import sys
from pathlib import Path

from PIL import Image

IMAGES = Path("assets/images")
targets = sys.argv[1:] or [f"product-{i}.png" for i in range(1, 7)]

print(f"{'file':26} {'size':12} {'aspect':8} {'edge colour':12} {'corner spread'}")
print("-" * 76)

for name in targets:
    p = IMAGES / name if not Path(name).is_absolute() else Path(name)
    if not p.exists():
        print(f"{name:26} MISSING")
        continue
    im = Image.open(p).convert("RGB")
    w, h = im.size

    # Sample a thin frame around the edge: that is the visible backdrop.
    band = 6
    edge = []
    for x in range(0, w, 3):
        edge += [im.getpixel((x, y)) for y in range(band)]
        edge += [im.getpixel((x, h - 1 - y)) for y in range(band)]
    for y in range(0, h, 3):
        edge += [im.getpixel((x, y)) for x in range(band)]
        edge += [im.getpixel((w - 1 - x, y)) for x in range(band)]
    avg = tuple(int(sum(c[i] for c in edge) / len(edge)) for i in range(3))

    corners = [im.getpixel(xy) for xy in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3))]
    spread = max(max(abs(a[i] - b[i]) for i in range(3)) for a in corners for b in corners)

    print(
        f"{p.name:26} {f'{w}x{h}':12} {w/h:<8.3f} "
        f"#{avg[0]:02X}{avg[1]:02X}{avg[2]:02X}    {spread:>3}  "
        f"{'uniform' if spread < 12 else 'VARIES'}"
    )

print("\nCSS: .product-media img { aspect-ratio: 3/4; object-fit: cover }")
print("     .product-media { background: var(--paper) #F4EFE6 }  <- only shows while loading")
print("     .product { flex: 0 0 clamp(150px,16vw,205px) }  -> rendered ~205x273 at 1440")
