"""Work out the object-position each photograph needs so heads are not cropped.

Every image box on the site uses object-fit: cover with no object-position, so
the browser crops from the centre. The photographs are tall (2:3) and the boxes
are squarer or landscape, which means the crop comes off the top and bottom
equally — and the head is at the top.

This finds the face with Apple's Vision framework, then solves for the
object-position that puts the top of the head just inside the visible box.
"""

from pathlib import Path

import Quartz
import Vision
from Foundation import NSURL
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "assets" / "images"

# Where each photograph appears, and the aspect ratio of that box.
BOXES = {
    ".moment img": 4 / 5,
    ".note-card img": 4 / 3,
}

IMAGES = [
    "moment-monday.png",
    "moment-important-room.png",
    "moment-evening.png",
    "moment-work-trip.png",
    "moment-celebration.png",
    "hero.png",
]

# How much clear space to leave above the hairline, as a fraction of the
# visible box height. Zero would put the hair exactly on the edge.
HEADROOM = 0.045

# Vision finds the face, not the hair. The top of the head sits roughly this
# much higher, measured as a multiple of the face box height.
HAIR = 0.55

# Where we would frame the crop if the head were not a constraint. 50% is the
# browser default — dead centre — and it is the right look when it fits, since
# it keeps the most saree in shot.
PREFERRED = 0.5


def faces(path):
    """Face boxes as (x, y, w, h) fractions, y measured down from the top."""
    url = NSURL.fileURLWithPath_(str(path))
    source = Quartz.CGImageSourceCreateWithURL(url, None)
    image = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)

    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(image, None)
    request = Vision.VNDetectFaceRectanglesRequest.alloc().init()
    handler.performRequests_error_([request], None)

    out = []
    for obs in request.results() or []:
        b = obs.boundingBox()
        # Vision's origin is bottom-left; flip to top-left.
        out.append(
            (
                b.origin.x,
                1.0 - b.origin.y - b.size.height,
                b.size.width,
                b.size.height,
            )
        )
    return out


def solve(src_aspect, box_aspect, head_top):
    """The object-position Y to use, and the largest one the head allows.

    With cover, the image is scaled so the short side fills. When the box is
    wider than the image, the image overflows vertically and object-position
    picks which slice shows: 0% shows the top of the photograph, 100% the
    bottom. Sliding down past a point starts eating the head.

    Keeping the head is a limit, not a target — pinning every head to the top
    edge would be as wrong as cropping it. So this takes the preferred framing
    and only pulls it up when the head demands it.
    """
    if box_aspect <= src_aspect:
        return None, None  # crops sideways instead; the head is safe

    scaled_h = 1.0 / src_aspect   # image height, per unit of width
    box_h = 1.0 / box_aspect      # visible height, same units
    overflow = scaled_h - box_h

    # Largest p where the hairline still sits HEADROOM below the box top.
    limit = (head_top * scaled_h - HEADROOM * box_h) / overflow
    limit = max(0.0, min(1.0, limit))
    return min(PREFERRED, limit), limit


print(f"{'image':<28} {'face':>16}  {'head top':>8}   object-position Y per box")
print("-" * 92)

results = {}
for name in IMAGES:
    path = ROOT / name
    if not path.exists():
        continue

    w, h = Image.open(path).size
    src_aspect = w / h
    found = faces(path)
    if not found:
        print(f"{name:<28} {'no face found':>16}")
        continue

    # The subject is the largest face; others are background people.
    fx, fy, fw, fh = max(found, key=lambda f: f[2] * f[3])
    head_top = max(0.0, fy - fh * HAIR)

    line = f"{name:<28} {fx:.2f},{fy:.2f} {fw:.2f}x{fh:.2f}  {head_top:>7.1%}   "
    per_box = {}
    for selector, box_aspect in BOXES.items():
        p, limit = solve(src_aspect, box_aspect, head_top)
        # Only worth writing a rule where the browser default would cut in.
        per_box[selector] = None if p is None or limit >= PREFERRED else p
        if p is None:
            shown = "no crop"
        elif limit >= PREFERRED:
            shown = "default ok"
        else:
            shown = f"{p:.0%} (cuts past {limit:.0%})"
        line += f"{selector} {shown}    "
    results[name] = per_box
    print(line)

print("\n--- CSS ---\n")
for selector, box_aspect in BOXES.items():
    print(f"/* {selector} — box is {box_aspect:.2f}:1, photographs are 0.67:1 */")
    for name, per_box in results.items():
        p = per_box[selector]
        if p is None:
            continue
        stem = name.replace(".png", "")
        print(f'{selector}[src*="{stem}"]{{object-position:50% {p:.0%}}}')
    print()
