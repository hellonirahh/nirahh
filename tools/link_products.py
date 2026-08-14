"""Point every product card at its detail page and load the shop scripts.

Cards were built before product.html existed, so their links are still "#".
The image filename is the only thing tying a card to a saree, so it drives the
handle lookup here and in assets/js/products.js.

Also collapses the favicon tags, which multiplied each time the shared header
was synced across pages.
"""

import re
from pathlib import Path

HANDLES = {
    "product-1.png": "peacock-ombre",
    "product-2.png": "midnight-bloom",
    "product-3.png": "aubergine-linen",
    "product-4.png": "teal-linen",
    "product-5.png": "lemon-linen",
    "product-6.png": "ivory-citron",
}

PAGES = ["index.html", "edit.html", "note.html", "story.html"]
SHOP_PAGES = {"index.html", "edit.html"}

CARD = re.compile(
    r'<a class="product-media" href="[^"]*">\s*<img src="assets/images/(product-\d\.png)[^"]*"',
    re.S,
)
ICONS = re.compile(r'^[ \t]*<link rel="(?:icon|apple-touch-icon)"[^>]*>\n', re.M)
ICON_BLOCK = (
    '<link rel="icon" href="assets/images/favicon.png" type="image/png">\n'
    '<link rel="apple-touch-icon" href="assets/images/apple-touch-icon.png">\n'
)


def link_cards(text):
    """Wrap the image link and the title in an anchor to the saree's page."""
    def media(m):
        handle = HANDLES[m.group(1)]
        return m.group(0).replace('href=""', "").replace(
            '<a class="product-media" href="#">',
            f'<a class="product-media" href="product.html?saree={handle}">',
        )

    # The href in the source may be "#" or an already-written product link.
    def swap(m):
        handle = HANDLES[m.group(1)]
        return re.sub(
            r'href="[^"]*"',
            f'href="product.html?saree={handle}"',
            m.group(0),
            count=1,
        )

    return CARD.sub(swap, text)


def link_titles(text):
    """Give each card title the same destination as its image."""
    pattern = re.compile(
        r'(<a class="product-media" href="(product\.html\?saree=[^"]+)">.*?</a>\s*<h3>)(?!<a)(.*?)(</h3>)',
        re.S,
    )
    return pattern.sub(lambda m: f'{m.group(1)}<a href="{m.group(2)}">{m.group(3)}</a>{m.group(4)}', text)


def dedupe_icons(text):
    first = ICONS.search(text)
    if not first:
        return text
    return text[: first.start()] + ICON_BLOCK + ICONS.sub("", text[first.start():])


def add_scripts(text):
    if "assets/js/products.js" in text:
        return text
    return re.sub(
        r'(\s*)<script src="assets/js/main\.js[^"]*"></script>',
        r'\1<script src="assets/js/products.js"></script>'
        r'\1<script src="assets/js/cart.js"></script>'
        r'\1<script src="assets/js/main.js"></script>',
        text,
    )


for name in PAGES:
    page = Path(name)
    text = original = page.read_text()
    text = dedupe_icons(text)
    text = add_scripts(text)
    if name in SHOP_PAGES:
        text = link_cards(text)
        text = link_titles(text)
    page.write_text(text)
    links = len(re.findall(r'product\.html\?saree=', text))
    print(f"{name}: {'updated' if text != original else 'unchanged'}, {links} product links")
