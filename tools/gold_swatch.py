"""Compare the site's gold against the card's foil, white balanced.

Foil has no single colour — it runs from near-white highlights to dark shadow —
so this shows the range next to the value the site currently uses.
"""

from PIL import Image, ImageDraw

card = Image.open("/tmp/card-upright.png").convert("RGB")
band = card.crop((390, 440, 760, 520))  # the NIRAHH row
px = list(band.getdata())

paper = sorted(px, key=sum, reverse=True)[: len(px) // 8]
wp = [sum(c[i] for c in paper) / len(paper) for i in range(3)]
s = [252 / v for v in wp]
bal = lambda c: tuple(min(255, int(c[i] * s[i])) for i in range(3))

ordered = sorted((bal(c) for c in px), key=sum)


def avg(sl):
    return tuple(int(sum(c[i] for c in sl) / len(sl)) for i in range(3))


swatches = [
    ("card shadow", avg(ordered[: len(px) // 50])),
    ("card body", avg(ordered[len(px) // 50 : len(px) // 12])),
    ("card light", avg(ordered[len(px) // 12 : len(px) // 6])),
    ("site --gold", (0xA8, 0x81, 0x3C)),
    ("proposed", (0x9C, 0x7B, 0x48)),
]

W, H = 200, 150
sheet = Image.new("RGB", (W * len(swatches), H + 30), "#FBF8F3")
d = ImageDraw.Draw(sheet)
for i, (label, rgb) in enumerate(swatches):
    d.rectangle([i * W, 0, (i + 1) * W - 6, H], fill=rgb)
    d.text((i * W + 6, H + 8), f"{label}  #{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}", fill="#23201C")
sheet.save("/tmp/gold-swatch.png")
for label, rgb in swatches:
    print(f"{label:14} #{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}")
