"""Measure section bands in the reference wireframe so the build can match its proportions.

Detects horizontal boundaries by looking for rows where the average colour
changes sharply, then reports each band's height as a fraction of the page width
(the only stable ratio, since the screenshot is scaled).
"""

import sys
from pathlib import Path

from PIL import Image

REF = Path(sys.argv[1] if len(sys.argv) > 1 else "reference/wireframe.png")

im = Image.open(REF).convert("RGB")
w, h = im.size
print(f"reference {w}x{h}  (aspect {h / w:.2f})\n")

rows = []
px = im.load()
step = max(1, w // 160)
for y in range(h):
    r = g = b = n = 0
    for x in range(0, w, step):
        c = px[x, y]
        r += c[0]; g += c[1]; b += c[2]; n += 1
    rows.append((r / n, g / n, b / n))


def delta(a, b):
    return max(abs(a[i] - b[i]) for i in range(3))


bounds = [0]
for y in range(2, h - 2):
    if delta(rows[y - 2], rows[y + 2]) > 14 and y - bounds[-1] > 6:
        bounds.append(y)
bounds.append(h)

print("band  y-range      height   height/width   mean colour")
for i in range(len(bounds) - 1):
    top, bot = bounds[i], bounds[i + 1]
    height = bot - top
    if height < 12:
        continue
    mean = rows[(top + bot) // 2]
    print(
        f"{i:>3}   {top:>4}-{bot:<5}  {height:>5}   {height / w:>10.3f}   "
        f"#{int(mean[0]):02X}{int(mean[1]):02X}{int(mean[2]):02X}"
    )
