"""Enlarge the top of the reference wireframe with a y-axis ruler for measuring bands."""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ref = Image.open(Path(sys.argv[1])).convert("RGB")
top, bottom, scale = int(sys.argv[2]), int(sys.argv[3]), 3

crop = ref.crop((0, top, ref.width, bottom))
big = crop.resize((crop.width * scale, crop.height * scale), Image.Resampling.LANCZOS)

canvas = Image.new("RGB", (big.width + 60, big.height), "white")
canvas.paste(big, (60, 0))
draw = ImageDraw.Draw(canvas)
for y in range(top - top % 10, bottom, 10):
    yy = (y - top) * scale
    draw.line([(50, yy), (60, yy)], fill="red")
    if y % 20 == 0:
        draw.line([(40, yy), (60, yy)], fill="red")
        draw.text((4, max(0, yy - 5)), str(y), fill="red")

canvas.save("/tmp/ref_crop.png")
print("wrote /tmp/ref_crop.png", canvas.size, f"(source rows {top}-{bottom} of {ref.height})")
