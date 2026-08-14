"""Propagate the homepage header, head links and footer base onto the sub-pages.

index.html is the source of truth for the masthead; this keeps edit/note/story
from drifting whenever the navigation or branding changes.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ["edit.html", "note.html", "story.html"]

index = (ROOT / "index.html").read_text()


def block(text, start, end):
    i = text.index(start)
    j = text.index(end, i) + len(end)
    return text[i:j]


announce_header = block(index, '<p class="announce"', "</header>")
fonts = block(index, '<link rel="icon"', 'rel="stylesheet">\n<link rel="stylesheet" href="assets/css/style.css">')

for name in PAGES:
    path = ROOT / name
    html = path.read_text()

    # Replace everything from the favicon/font links through the stylesheet link.
    html = re.sub(
        r'<link rel="preconnect" href="https://fonts\.googleapis\.com">.*?<link rel="stylesheet" href="assets/css/style\.css">',
        fonts,
        html,
        flags=re.S,
    )

    # Drop any existing announcement bar, then replace the whole masthead.
    html = re.sub(r'<p class="announce">.*?</p>\s*', "", html, flags=re.S)
    html = re.sub(r'<header class="site-header[^>]*>.*?</header>', announce_header, html, flags=re.S)

    # Mark the current page in the nav.
    path.write_text(html)
    print("synced", name)
