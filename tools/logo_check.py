"""Sample the artwork's paper tone and preview the feathered logo on candidate backgrounds."""

from PIL import Image

src = Image.open("assets/images/logo-full.png").convert("RGB")
w, h = src.size

points = {
    "top-centre": (int(w * 0.50), int(h * 0.05)),
    "left-mid": (int(w * 0.05), int(h * 0.45)),
    "under-tagline": (int(w * 0.50), int(h * 0.95)),
    "corner": (4, 4),
}
for name, pt in points.items():
    print("%-14s #%02X%02X%02X" % ((name,) + src.getpixel(pt)))

paper = src.getpixel((int(w * 0.50), int(h * 0.05)))

lockup = Image.open("assets/images/logo-lockup.png")
mark = Image.open("assets/images/logo-mark.png")


def on(bg, img, width=440):
    im = img.copy()
    im.thumbnail((width, width), Image.Resampling.LANCZOS)
    card = Image.new("RGB", (im.width + 120, im.height + 120), bg)
    card.paste(im, (60, 60), im)
    return card


tiles = [
    on(paper, lockup),            # artwork paper
    on((243, 238, 229), lockup),  # site --paper
    on(paper, mark),
]

sheet = Image.new("RGB", (sum(t.width for t in tiles) + 60, max(t.height for t in tiles) + 40), "white")
x = 15
for t in tiles:
    sheet.paste(t, (x, 20))
    x += t.width + 15
sheet.save("/tmp/logo_check.png")
print("wrote /tmp/logo_check.png")
