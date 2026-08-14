"""Tight comparison: the logo's wordmark against the finalists, cap heights matched.

Each candidate is drawn, trimmed to its ink, then scaled so its cap height and
overall word width match the artwork — so only the letterforms differ.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CACHE = Path("/tmp/fontcache")
FINALISTS = [("Cinzel", 400), ("Cinzel", 500), ("Marcellus", 400), ("Cormorant Garamond", 500)]

ref = Image.open("/tmp/wordmark.png").convert("RGB")


def ink_box(img, bg=(245, 228, 208)):
    """Bounding box of anything darker than the paper."""
    grey = img.convert("L")
    mask = grey.point(lambda v: 255 if v < 200 else 0)
    return mask.getbbox()


# Trim the artwork to its lettering so the comparison starts from the same place.
ref_box = ink_box(ref)
ref_word = ref.crop(ref_box)
W, H = ref_word.size

rows = [("logo artwork", ref_word)]

for family, weight in FINALISTS:
    path = CACHE / f"{family.replace(' ', '')}-{weight}.ttf"
    if not path.exists():
        print("missing", path)
        continue
    big = 200
    font = ImageFont.truetype(str(path), big)
    tracking = int(big * 0.24)

    canvas = Image.new("RGB", (big * 12, big * 3), "#F5E4D0")
    d = ImageDraw.Draw(canvas)
    x = big
    for ch in "NIRAHH":
        d.text((x, big // 2), ch, font=font, fill="#8A6829")
        x += d.textlength(ch, font=font) + tracking

    word = canvas.crop(ink_box(canvas))
    word = word.resize((W, H), Image.Resampling.LANCZOS)
    rows.append((f"{family} {weight}", word))

pad = 26
sheet = Image.new("RGB", (W, (H + pad) * len(rows)), "#F5E4D0")
d = ImageDraw.Draw(sheet)
y = 0
for label, tile in rows:
    sheet.paste(tile, (0, y))
    d.text((4, y + H + 6), label, fill="#8A6829")
    y += H + pad
sheet.save("/tmp/wordmark-close.png")
print("wrote /tmp/wordmark-close.png", sheet.size)
