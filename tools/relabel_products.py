"""Rewrite each product card's alt text, name and fabric line to match its image.

The old copy described a different set of sarees, and the cards are not in file
order, so each block is matched by the image it actually uses.
"""

import re
from pathlib import Path

LABELS = {
    "product-1.png": ("Peacock ombré saree in blue, green and violet", "The Peacock Ombré", "Ombré weave"),
    "product-2.png": ("Black saree with sage floral print", "The Midnight Bloom", "Floral print"),
    "product-3.png": ("Aubergine linen saree with embroidered motifs", "The Aubergine Linen", "Embroidered linen"),
    "product-4.png": ("Teal linen saree", "The Teal Linen", "Handwoven linen"),
    "product-5.png": ("Pale lemon linen saree with woven motifs", "The Lemon Linen", "Woven motifs"),
    "product-6.png": ("Ivory linen saree with citron border", "The Ivory Citron", "Contrast border"),
}

BLOCK = re.compile(
    r'(<img src="assets/images/(product-\d\.png)" alt=")[^"]*(">.*?<h3>)[^<]*(</h3>\s*'
    r'<p class="product-meta">)[^<]*(</p>)',
    re.S,
)


def relabel(match):
    alt, name, meta = LABELS[match.group(2)]
    return f"{match.group(1)}{alt}{match.group(3)}{name}{match.group(4)}{meta}{match.group(5)}"


for name in ("index.html", "edit.html"):
    p = Path(name)
    text = p.read_text()
    new, n = BLOCK.subn(relabel, text)
    p.write_text(new)
    print(f"{name}: relabelled {n} product cards")
