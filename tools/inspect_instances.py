"""List the foreground instances Vision finds in each photo, with area and position.

Used to work out a rule for keeping the garment (and the stand it hangs on)
while dropping the rug, plants and floor.
"""

import struct
from pathlib import Path

import Quartz
import Vision
from Foundation import NSURL, NSIndexSet
from PIL import Image

SRC = Path("reference/sarees")


def mask_for(handler, observation, index_set):
    buf, err = observation.generateScaledMaskForImageForInstances_fromRequestHandler_error_(
        index_set, handler, None
    )
    if buf is None:
        return None
    Quartz.CVPixelBufferLockBaseAddress(buf, 1)
    try:
        w = Quartz.CVPixelBufferGetWidth(buf)
        h = Quartz.CVPixelBufferGetHeight(buf)
        stride = Quartz.CVPixelBufferGetBytesPerRow(buf)
        raw = Quartz.CVPixelBufferGetBaseAddress(buf).as_buffer(stride * h)
        rows = [
            bytes(min(255, max(0, int(v * 255))) for v in struct.unpack_from(f"<{w}f", raw, y * stride))
            for y in range(h)
        ]
        return Image.frombytes("L", (w, h), b"".join(rows))
    finally:
        Quartz.CVPixelBufferUnlockBaseAddress(buf, 1)


for p in sorted(SRC.glob("saree-*.png")):
    url = NSURL.fileURLWithPath_(str(p.resolve()))
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, {})
    req = Vision.VNGenerateForegroundInstanceMaskRequest.alloc().init()
    handler.performRequests_error_([req], None)
    obs = req.results()[0]

    instances = list(obs.allInstances())
    print(f"\n{p.name}: {len(instances)} instance(s) -> {instances}")

    for idx in instances:
        m = mask_for(handler, obs, NSIndexSet.indexSetWithIndex_(idx))
        if m is None:
            print(f"   [{idx}] mask failed")
            continue
        binary = m.point(lambda v: 255 if v > 128 else 0)
        box = binary.getbbox()
        area = sum(binary.histogram()[128:])
        total = m.width * m.height
        print(
            f"   [{idx}] area {area/total:6.2%}  box {box}  "
            f"x {box[0]/m.width:.2f}..{box[2]/m.width:.2f}  y {box[1]/m.height:.2f}..{box[3]/m.height:.2f}"
        )
