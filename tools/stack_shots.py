"""Stack screenshots into one strip so a set of widths can be judged together.

Usage: python tools/stack_shots.py out.png shot1.png shot2.png ...
"""

import sys
from pathlib import Path

from PIL import Image

out = Path(sys.argv[1])
paths = [Path(p) for p in sys.argv[2:]]

images = [Image.open(p).convert("RGB") for p in paths]
width = max(i.width for i in images)
scaled = [
    i.resize((width, round(i.height * width / i.width)), Image.Resampling.LANCZOS)
    for i in images
]

gap = 10
sheet = Image.new("RGB", (width, sum(i.height + gap for i in scaled) + gap), (244, 239, 230))
y = gap
for img in scaled:
    sheet.paste(img, (0, y))
    y += img.height + gap

sheet.thumbnail((1000, 1600), Image.Resampling.LANCZOS)
sheet.save(out)
print(out, sheet.size)
