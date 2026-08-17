"""Lay the Shop by moment photographs out in one strip, as the rail shows them.

Judging them one at a time hides the real problem, which is that they do not
sit together.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / "assets" / "images"
OUT = Path("/tmp/moments-sheet.png")

NAMES = sys.argv[1:] or [
    "moment-monday.png",
    "moment-important-room.png",
    "moment-evening.png",
    "moment-work-trip.png",
    "moment-celebration.png",
]
LABELS = ["Office", "Boardroom", "Evening", "Travel", "Celebration"]

CELL_W, CELL_H, PAD, STRIP = 340, 425, 12, 34
BG = (244, 239, 230)

sheet = Image.new("RGB", (len(NAMES) * (CELL_W + PAD) + PAD, CELL_H + STRIP + PAD * 2), BG)
draw = ImageDraw.Draw(sheet)

for i, name in enumerate(NAMES):
    path = ROOT / name
    if not path.exists():
        continue
    img = Image.open(path).convert("RGB")

    # Cover-crop to the cell, the way the rail does.
    scale = max(CELL_W / img.width, CELL_H / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    left = (img.width - CELL_W) // 2
    top = (img.height - CELL_H) // 3
    img = img.crop((left, top, left + CELL_W, top + CELL_H))

    x = PAD + i * (CELL_W + PAD)
    sheet.paste(img, (x, PAD))
    label = LABELS[i] if i < len(LABELS) else name
    draw.text((x + 4, PAD + CELL_H + 9), label, fill=(35, 32, 28))

sheet.save(OUT)
print(f"{OUT}  {sheet.size[0]}x{sheet.size[1]}")
