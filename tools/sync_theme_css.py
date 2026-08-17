"""Rebuild the theme stylesheet from the site stylesheet.

shopify-theme/assets/style.css is the site's stylesheet plus a block of rules
that only the Shopify templates need. Editing the site stylesheet would other-
wise leave the theme behind, which is how the two drift apart silently.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "assets" / "css" / "style.css"
THEME = ROOT / "shopify-theme" / "assets" / "style.css"
MARKER = "   Shopify theme"

theme = THEME.read_text()
start = theme.find(MARKER)
if start == -1:
    raise SystemExit(f"{THEME}: cannot find the Shopify block marker")

# Rewind to the opening of the comment that introduces the block.
start = theme.rfind("/* ===", 0, start)
tail = theme[start:]

THEME.write_text(SITE.read_text().rstrip() + "\n\n" + tail.lstrip())
print(f"theme stylesheet rebuilt: {len(SITE.read_text().splitlines())} shared lines "
      f"+ {len(tail.splitlines())} Shopify-only lines")
