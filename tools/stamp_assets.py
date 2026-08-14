"""Stamp local asset URLs with a content hash so browsers can't serve stale files.

Image and stylesheet filenames stay the same as the site is edited, so a browser
that already has product-1.png will happily keep showing the old one. Appending
?v=<hash of the file> makes the URL change whenever the bytes change, and stay
put when they don't.

Idempotent: existing stamps are stripped before new ones are written.
"""

import hashlib
import re
from pathlib import Path

PAGES = ["index.html", "edit.html", "note.html", "story.html", "product.html"]
REF = re.compile(r'(src|href)="(assets/[^"?]+)(\?v=[0-9a-f]+)?"')
# The catalogue holds image paths too, and they need the same treatment.
CATALOGUE = Path("assets/js/products.js")
CAT_REF = re.compile(r"(src: ')(assets/[^'?]+)(\?v=[0-9a-f]+)?(')")


def digest(rel):
    p = Path(rel)
    if not p.exists():
        return None
    return hashlib.sha256(p.read_bytes()).hexdigest()[:8]


def stamp(match):
    attr, rel = match.group(1), match.group(2)
    h = digest(rel)
    return f'{attr}="{rel}"' if h is None else f'{attr}="{rel}?v={h}"'


if CATALOGUE.exists():
    text = CATALOGUE.read_text()
    new, n = CAT_REF.subn(
        lambda m: m.group(1) + m.group(2) + (f"?v={digest(m.group(2))}" if digest(m.group(2)) else "") + m.group(4),
        text,
    )
    CATALOGUE.write_text(new)
    print(f"{CATALOGUE}: stamped {n} image paths")

for name in PAGES:
    page = Path(name)
    text = page.read_text()
    new, n = REF.subn(stamp, text)
    page.write_text(new)
    missing = [m.group(2) for m in REF.finditer(new) if digest(m.group(2)) is None]
    print(f"{name}: stamped {n} asset references" + (f"  MISSING: {missing}" if missing else ""))
