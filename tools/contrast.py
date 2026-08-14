"""Report WCAG contrast for the site's text colours, and test candidates.

The palette was picked by eye, so this checks each text colour against the
background it actually sits on. 4.5:1 is the readable threshold for body text,
3:1 for large text.
"""


def srgb(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_colour):
    h = hex_colour.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)


def ratio(fg, bg):
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def blend(fg, bg, alpha):
    """Flatten a translucent colour onto its background."""
    f = fg.lstrip("#")
    b = bg.lstrip("#")
    out = []
    for i in (0, 2, 4):
        fv, bv = int(f[i:i + 2], 16), int(b[i:i + 2], 16)
        out.append(round(fv * alpha + bv * (1 - alpha)))
    return "#%02X%02X%02X" % tuple(out)


IVORY, PAPER, SAND, INK = "#FBF8F3", "#F4EFE6", "#EFE7DA", "#23201C"

CURRENT = [
    ("--ink        body text", "#23201C", IVORY),
    ("--muted      secondary", "#7C7266", IVORY),
    ("--muted      on paper", "#7C7266", PAPER),
    ("--muted      on sand", "#7C7266", SAND),
    ("--gold-deep  eyebrows", "#836440", IVORY),
    ("--gold       wordmark", "#9C7B48", IVORY),
    ("--gold-light on ink", "#C0A070", INK),
    ("worn-role    60% ivory", blend("#FBF8F3", INK, 0.60), INK),
    ("worn-quote   78% ivory", blend("#FBF8F3", INK, 0.78), INK),
    ("rail-link    35% ivory", blend("#FBF8F3", INK, 0.35), INK),
]

CANDIDATES = [
    ("--muted  #4A4239 on ivory", "#4A4239", IVORY),
    ("--muted  #4A4239 on sand", "#4A4239", SAND),
    ("--muted  #423B31 on ivory", "#423B31", IVORY),
    ("--muted  #423B31 on sand", "#423B31", SAND),
    ("--muted  #3A342C on ivory", "#3A342C", IVORY),
    ("--muted  #3A342C on sand", "#3A342C", SAND),
    ("--gold-deep #5E4726 on ivory", "#5E4726", IVORY),
    ("--gold-deep #543F21 on ivory", "#543F21", IVORY),
    ("--gold-deep #543F21 on sand", "#543F21", SAND),
    ("--ink       #23201C for reference", "#23201C", IVORY),
]


def table(rows, heading):
    print("\n" + heading)
    for label, fg, bg in rows:
        r = ratio(fg, bg)
        mark = "PASS" if r >= 4.5 else ("large only" if r >= 3 else "FAIL")
        print(f"  {label:26} {fg} on {bg}  {r:5.2f}:1  {mark}")


table(CURRENT, "Current")
table(CANDIDATES, "Proposed")
