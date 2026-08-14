"""Turn the studio saree photographs into product images on a flat background.

The photographs share a room but not a backdrop: the wall is lit from the left
and falls away to the right, and each frame also carries a stand, plants, a rug
and a marble floor. So rather than cropping, the garment is cut out with Apple's
Vision foreground segmentation and composited onto one flat colour.

Run with the tools/.venv interpreter, which has the pyobjc bindings.
"""

import sys
from pathlib import Path

import numpy as np
import Quartz
import Vision
from Foundation import NSURL
from PIL import Image, ImageFilter
from scipy import ndimage

SRC = Path("reference/sarees")
OUT = Path("assets/images")
BACKDROP = (0xF4, 0xEF, 0xE6)   # var(--paper), so cards sit flush with the page
TARGET = (900, 1200)            # 3:4, matching .product-media img
MARGIN = 0.055                  # breathing room around the garment


def foreground_mask(path):
    """Apple's subject lift, returned as an 8-bit PIL mask at the image's size."""
    url = NSURL.fileURLWithPath_(str(path.resolve()))
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, {})
    request = Vision.VNGenerateForegroundInstanceMaskRequest.alloc().init()

    ok, err = handler.performRequests_error_([request], None)
    if not ok:
        raise RuntimeError(f"Vision failed on {path.name}: {err}")

    results = request.results()
    if not results:
        raise RuntimeError(f"no foreground found in {path.name}")

    observation = results[0]
    buf, err = observation.generateScaledMaskForImageForInstances_fromRequestHandler_error_(
        observation.allInstances(), handler, None
    )
    if buf is None:
        raise RuntimeError(f"mask generation failed on {path.name}: {err}")

    Quartz.CVPixelBufferLockBaseAddress(buf, 1)
    try:
        w = Quartz.CVPixelBufferGetWidth(buf)
        h = Quartz.CVPixelBufferGetHeight(buf)
        stride = Quartz.CVPixelBufferGetBytesPerRow(buf)
        base = Quartz.CVPixelBufferGetBaseAddress(buf)
        raw = base.as_buffer(stride * h)
        # One float32 channel per pixel, 0..1.
        import struct
        rows = []
        for y in range(h):
            off = y * stride
            vals = struct.unpack_from(f"<{w}f", raw, off)
            rows.append(bytes(min(255, max(0, int(v * 255))) for v in vals))
        mask = Image.frombytes("L", (w, h), b"".join(rows))
    finally:
        Quartz.CVPixelBufferUnlockBaseAddress(buf, 1)

    return mask


def wall_ends(photo, tol=26):
    """First row where the outer columns stop looking like the wall.

    Everything below is marble, jute rug and pot plants. Vision merges those into
    the garment wherever the drape pools against them, and in some frames the rug
    reaches well above the skirting — so this is measured, not assumed.
    """
    # Only the left margin is reliably backdrop: in four of the six frames the
    # drape runs all the way to the right edge.
    rgb = np.asarray(photo, dtype=np.int16)
    h, w, _ = rgb.shape
    side = rgb[:, : int(w * 0.09)]

    # The wall is lit unevenly top to bottom, so a fixed threshold misfires.
    # The skirting is a step instead: find the sharpest sustained drop.
    lum = side.mean(axis=(1, 2))
    smooth = np.convolve(lum, np.ones(9) / 9, mode="same")
    lo, hi = int(h * 0.55), int(h * 0.96)
    step = smooth[lo:hi] - np.roll(smooth, -14)[lo:hi]
    return lo + int(np.argmax(step))


def largest_region(mask):
    """Vision returns the rug and pot plants inside one instance with the saree.

    They are separate blobs, so keeping only the biggest connected region drops
    them. A light erosion first breaks whiskers where a fringe brushes the rug.
    """
    solid = np.array(mask) > 128
    core = ndimage.binary_erosion(solid, np.ones((7, 7)))
    labels, count = ndimage.label(core)
    if count == 0:
        return mask
    sizes = ndimage.sum(core, labels, range(1, count + 1))
    keep = labels == (int(np.argmax(sizes)) + 1)
    # Grow back to the original silhouette, but only where it was foreground.
    keep = ndimage.binary_dilation(keep, np.ones((9, 9)), iterations=2) & solid
    return Image.fromarray((keep * 255).astype(np.uint8), "L")


def build(path, out_name):
    photo = Image.open(path).convert("RGB")
    mask = foreground_mask(path).resize(photo.size, Image.Resampling.LANCZOS)

    # Clean specks, then soften the edge so the cutout does not look stamped on.
    mask = mask.filter(ImageFilter.MedianFilter(5))
    mask = mask.point(lambda v: 0 if v < 110 else (255 if v > 165 else v))

    arr = np.array(mask)
    arr[wall_ends(photo):, :] = 0
    mask = Image.fromarray(arr, "L")

    mask = largest_region(mask)
    mask = mask.filter(ImageFilter.GaussianBlur(1.1))

    cut = Image.new("RGBA", photo.size)
    cut.paste(photo, (0, 0), mask)

    box = mask.point(lambda v: 255 if v > 128 else 0).getbbox()
    if not box:
        raise RuntimeError(f"empty mask for {path.name}")
    cut = cut.crop(box)

    # Fit inside the 3:4 frame, leaving a consistent margin.
    tw, th = TARGET
    avail_w, avail_h = tw * (1 - 2 * MARGIN), th * (1 - 2 * MARGIN)
    scale = min(avail_w / cut.width, avail_h / cut.height)
    cut = cut.resize((max(1, int(cut.width * scale)), max(1, int(cut.height * scale))),
                     Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", TARGET, BACKDROP)
    canvas.paste(cut, ((tw - cut.width) // 2, (th - cut.height) // 2), cut)
    canvas.save(OUT / out_name)
    return box, cut.size


if __name__ == "__main__":
    names = sys.argv[1:] or [f"product-{i}.png" for i in range(1, 7)]
    for i, out_name in enumerate(names, start=1):
        src = SRC / f"saree-{i}.png"
        box, size = build(src, out_name)
        print(f"{src.name} -> {out_name}   subject {box[2]-box[0]}x{box[3]-box[1]} -> {size[0]}x{size[1]}")
