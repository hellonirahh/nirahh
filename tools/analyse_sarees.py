"""Profile the new saree photographs: shared geometry, wall tone, and where the drape sits.

All six were shot in the same room, so the aim is to find out how consistent the
setup is and whether the backdrop can be separated from the garment by tone alone.
"""

from pathlib import Path

from PIL import Image

SRC = Path("reference/sarees")

for p in sorted(SRC.glob("saree-*.png")):
    im = Image.open(p).convert("RGB")
    w, h = im.size
    px = im.load()

    # Wall tone from the top corners, well clear of the stand.
    def patch(x0, y0):
        s = [px[x, y] for x in range(x0, x0 + 40) for y in range(y0, y0 + 40)]
        return tuple(int(sum(c[i] for c in s) / len(s)) for i in range(3))

    tl, tr = patch(10, 10), patch(w - 55, 10)

    # Column darkness profile: where the garment blocks the wall.
    step = max(1, w // 120)
    cols = []
    for x in range(0, w, step):
        vals = [sum(px[x, y]) / 3 for y in range(int(h * 0.15), int(h * 0.75), 6)]
        cols.append((x, sum(vals) / len(vals)))
    wall_lum = (sum(tl) + sum(tr)) / 6
    drape = [x for x, v in cols if v < wall_lum - 18]

    # Row profile: where floor/rug begins.
    rows = []
    for y in range(0, h, 6):
        vals = [sum(px[x, y]) / 3 for x in range(0, w, step)]
        rows.append((y, sum(vals) / len(vals)))

    print(
        f"{p.name}  {w}x{h}  aspect {w/h:.3f}\n"
        f"   wall TL #{tl[0]:02X}{tl[1]:02X}{tl[2]:02X}  TR #{tr[0]:02X}{tr[1]:02X}{tr[2]:02X}"
        f"   diff {max(abs(tl[i]-tr[i]) for i in range(3))}\n"
        f"   drape spans x {min(drape) if drape else '-'}..{max(drape) if drape else '-'}"
        f"  ({(min(drape)/w if drape else 0):.2f}..{(max(drape)/w if drape else 0):.2f} of width)"
    )
