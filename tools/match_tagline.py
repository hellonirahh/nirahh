"""Render "Made for composure" in candidate script faces against the card's own tagline."""

import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CACHE = Path("/tmp/fontcache")
CACHE.mkdir(exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 5.1)"

CANDIDATES = [
    "Great Vibes", "Allura", "Pinyon Script", "Alex Brush", "Parisienne",
    "Italianno", "Petit Formal Script", "Mrs Saint Delafield", "Ephesis",
    "Style Script", "Sacramento", "Tangerine",
]


def fetch(family):
    path = CACHE / f"{family.replace(' ', '')}-400.ttf"
    if path.exists():
        return path
    url = f"https://fonts.googleapis.com/css2?family={family.replace(' ', '+')}&display=swap"
    css = subprocess.run(["curl", "-sL", "-A", UA, url], capture_output=True, text=True).stdout
    ttf = re.findall(r"url\((https://[^)]+?\.ttf)\)", css)
    if not ttf:
        print("  no ttf for", family)
        return None
    subprocess.run(["curl", "-sL", "-o", str(path), ttf[0]], check=True)
    return path


ref = Image.open("/tmp/card-upright.png").convert("RGB").crop((390, 540, 770, 630))
ref = ref.resize((ref.width * 3, ref.height * 3), Image.Resampling.LANCZOS)
W = ref.width
ROW = 130

rows = [("the card", ref)]
for family in CANDIDATES:
    path = fetch(family)
    if not path:
        continue
    font = ImageFont.truetype(str(path), 76)
    tile = Image.new("RGB", (W, ROW), "#EDEBE6")
    d = ImageDraw.Draw(tile)
    text = "Made for composure"
    w = d.textlength(text, font=font)
    d.text(((W - w) / 2, 18), text, font=font, fill="#6B6152")
    d.text((10, 6), family, fill="#A0987F")
    rows.append((family, tile))

sheet = Image.new("RGB", (W, sum(r[1].height for r in rows)), "white")
y = 0
for _, tile in rows:
    sheet.paste(tile, (0, y))
    y += tile.height
sheet.save("/tmp/tagline-compare.png")
print("wrote /tmp/tagline-compare.png", sheet.size)
