"""Derive web-ready logo assets from the master Nirahh artwork.

The artwork is printed on a textured beige card, so a hard background knockout
leaves ragged edges. Instead we keep the card and feather its border into
transparency, then serve it on a section painted the same paper colour — the
edge disappears and the embossed gold keeps its depth.

Outputs: logo-lockup.png, logo-mark.png, favicon.png, apple-touch-icon.png
and the paper/gold values to mirror in CSS.
"""

from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SRC = Path("assets/images/logo-full.png")
OUT = Path("assets/images")


def saturation(px):
    mx, mn = max(px[:3]), min(px[:3])
    return 0 if mx == 0 else (mx - mn) / mx


def report_colours(im):
    rgb = im.convert("RGB")
    w, h = rgb.size
    paper = rgb.getpixel((4, 4))
    band = rgb.crop((int(w * 0.08), int(h * 0.58), int(w * 0.92), int(h * 0.74)))
    golds = [p for p in band.getdata() if saturation(p) > 0.30 and sum(p) / 3 < 205]
    avg = tuple(sum(c) // len(golds) for c in zip(*golds))
    print("paper  #%02X%02X%02X" % paper)
    print("gold   #%02X%02X%02X (mean)" % avg)
    for col, n in Counter(golds).most_common(4):
        print("       #%02X%02X%02X" % col, n)
    return paper


def knockout(im, tolerance=42):
    """Remove the card by flood-filling inward from the corners.

    A global colour threshold fails here because the card is textured, but the
    background is one contiguous region, so a tolerant flood fill follows it
    around the gold without eating into the mark.
    """
    rgb = im.convert("RGB")
    w, h = rgb.size
    marker = (255, 0, 255)
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        ImageDraw.floodfill(rgb, corner, marker, thresh=tolerance)

    out = im.convert("RGBA")
    px = list(out.getdata())
    flooded = list(rgb.getdata())
    out.putdata([
        (0, 0, 0, 0) if flooded[i] == marker else px[i]
        for i in range(len(px))
    ])
    return out


def feather(im, inset_ratio=0.055, blur_ratio=0.045):
    """Fade the outer border of the card to transparent."""
    im = im.convert("RGBA")
    w, h = im.size
    inset = int(min(w, h) * inset_ratio)
    blur = max(2, int(min(w, h) * blur_ratio))

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rectangle([inset, inset, w - inset, h - inset], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(blur))

    im.putalpha(mask)
    return im


def main():
    src = Image.open(SRC)
    report_colours(src)
    w, h = src.size

    lockup = feather(src)
    lockup.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
    lockup.save(OUT / "logo-lockup.png")
    print("logo-lockup.png", lockup.size)

    # Monogram only — the N sits in the upper ~55% of the card. This one is used
    # small in the header, so it needs a true knockout rather than a feather.
    mark = knockout(src.crop((int(w * 0.06), int(h * 0.04), int(w * 0.94), int(h * 0.58))))
    bbox = mark.getbbox()
    if bbox:
        mark = mark.crop(bbox)
    mark.thumbnail((520, 520), Image.Resampling.LANCZOS)
    mark.save(OUT / "logo-mark.png")
    print("logo-mark.png", mark.size)

    # Favicon: square crop of the monogram, no feather needed at this size.
    icon_src = src.crop((int(w * 0.16), int(h * 0.10), int(w * 0.86), int(h * 0.56)))
    side = max(icon_src.size)
    icon = Image.new("RGB", (side, side), src.convert("RGB").getpixel((4, 4)))
    icon.paste(icon_src, ((side - icon_src.width) // 2, (side - icon_src.height) // 2))
    icon.resize((64, 64), Image.Resampling.LANCZOS).save(OUT / "favicon.png")
    icon.resize((180, 180), Image.Resampling.LANCZOS).save(OUT / "apple-touch-icon.png")
    print("favicon.png + apple-touch-icon.png written")


if __name__ == "__main__":
    main()
