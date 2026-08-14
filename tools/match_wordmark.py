"""Render NIRAHH in candidate faces and stack them under the logo's own wordmark.

Downloads each family from Google Fonts as TrueType (an old user-agent gets the
ttf rather than woff2), draws the word with the same tracking, and writes one
comparison sheet so the letterforms can be judged side by side.
"""

import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CACHE = Path("/tmp/fontcache")
CACHE.mkdir(exist_ok=True)

CANDIDATES = [
    ("Cinzel", 400),
    ("Cinzel", 600),
    ("Bodoni Moda", 400),
    ("Playfair Display", 400),
    ("Cormorant Garamond", 400),
    ("Marcellus", 400),
    ("Prata", 400),
    ("Gilda Display", 400),
    ("Italiana", 400),
    ("Forum", 400),
]

UA = "Mozilla/5.0 (Windows NT 5.1)"  # old UA -> truetype


def fetch(family, weight):
    slug = f"{family.replace(' ', '')}-{weight}.ttf"
    path = CACHE / slug
    if path.exists():
        return path
    css_url = (
        f"https://fonts.googleapis.com/css2?family={family.replace(' ', '+')}"
        f":wght@{weight}&display=swap"
    )
    css = subprocess.run(
        ["curl", "-sL", "-A", UA, css_url], capture_output=True, text=True
    ).stdout
    urls = re.findall(r"url\((https://[^)]+?\.ttf)\)", css)
    if not urls:
        print(f"  no ttf for {family} {weight}")
        return None
    subprocess.run(["curl", "-sL", "-o", str(path), urls[0]], check=True)
    return path


def draw_tracked(draw, xy, text, font, tracking, fill):
    """PIL has no letter-spacing, so step through the string glyph by glyph."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x


ref = Image.open("/tmp/wordmark.png").convert("RGB")
WIDTH = ref.width
ROW = 150
SIZE = 86
TRACKING = int(SIZE * 0.24)

rows = [("the logo artwork", ref)]

for family, weight in CANDIDATES:
    path = fetch(family, weight)
    if not path:
        continue
    font = ImageFont.truetype(str(path), SIZE)
    tile = Image.new("RGB", (WIDTH, ROW), "#F5E4D0")
    d = ImageDraw.Draw(tile)
    end = draw_tracked(d, (0, 0), "NIRAHH", font, TRACKING, "#A8813C")
    # Centre it by redrawing at an offset now that the width is known.
    tile = Image.new("RGB", (WIDTH, ROW), "#F5E4D0")
    d = ImageDraw.Draw(tile)
    draw_tracked(d, ((WIDTH - (end - TRACKING)) / 2, 28), "NIRAHH", font, TRACKING, "#A8813C")
    d.text((12, 8), f"{family} {weight}", font=ImageFont.load_default(), fill="#8A6829")
    rows.append((f"{family} {weight}", tile))

sheet = Image.new("RGB", (WIDTH, sum(r[1].height for r in rows)), "white")
y = 0
for _, tile in rows:
    sheet.paste(tile, (0, y))
    y += tile.height
sheet.save("/tmp/wordmark-compare.png")
print("wrote /tmp/wordmark-compare.png", sheet.size)
