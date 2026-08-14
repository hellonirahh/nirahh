"""Sample the foil colour from the printed card, correcting the photograph's cast.

The card is shot under warm light on pearl stock, so the paper reads blue-grey
rather than white. Neutralising against the paper first gives a usable gold.
"""

from collections import Counter

from PIL import Image

im = Image.open("/tmp/card-upright.png").convert("RGB")
word = im.crop((380, 430, 770, 630))

px = list(word.getdata())

# The paper is the brightest cluster; average the top decile as the white point.
by_lum = sorted(px, key=lambda c: sum(c), reverse=True)
paper = by_lum[: len(by_lum) // 10]
wp = tuple(sum(c[i] for c in paper) / len(paper) for i in range(3))
print(f"paper as photographed  #{int(wp[0]):02X}{int(wp[1]):02X}{int(wp[2]):02X}")

scale = [250 / v for v in wp]


def balance(c):
    return tuple(min(255, int(c[i] * scale[i])) for i in range(3))


# The foil is the darker ink; average the darkest decile after balancing.
ink = sorted((balance(c) for c in px), key=sum)[: len(px) // 10]
gold = tuple(sum(c[i] for c in ink) / len(ink) for i in range(3))
print(f"foil, white balanced   #{int(gold[0]):02X}{int(gold[1]):02X}{int(gold[2]):02X}")

mid = sorted((balance(c) for c in px), key=sum)[len(px) // 10 : len(px) // 4]
midg = tuple(sum(c[i] for c in mid) / len(mid) for i in range(3))
print(f"foil midtone           #{int(midg[0]):02X}{int(midg[1]):02X}{int(midg[2]):02X}")

common = Counter(balance(c) for c in px).most_common(6)
print("\nmost common balanced colours:")
for c, n in common:
    print(f"  #{c[0]:02X}{c[1]:02X}{c[2]:02X}  x{n}")
