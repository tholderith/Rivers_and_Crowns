#!/usr/bin/env python3
"""Make a texture tile seamlessly and save it at game size.

Generated "seamless" textures usually show a seam when repeated. This shifts the image
by half its size (so the old edges meet in the middle), then blends that seam away
with the unshifted image, which itself has no seam in the middle. The edges of the
result come from the shifted copy, so they wrap perfectly.

    python3 tools/make_seamless.py art/incoming/T-01.webp public/assets/textures/T-01.webp --size 512
    python3 tools/make_seamless.py art/incoming/T-03.webp public/assets/textures/T-03.webp --vertical-only
"""
import argparse
from pathlib import Path
import numpy as np
from PIL import Image


def seamless(im: Image.Image, vertical_only: bool = False) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    h, w = a.shape[:2]
    shifted = np.roll(a, (h // 2, 0 if vertical_only else w // 2), axis=(0, 1))  # its edges wrap; its seam is on the centre lines
    ey = 1 - np.abs(np.linspace(-1, 1, h))  # 0 at top/bottom edge, 1 at the centre row
    ex = np.ones(w) if vertical_only else 1 - np.abs(np.linspace(-1, 1, w))
    w_orig = np.minimum(ey[:, None], ex[None, :])            # far from the original's edges
    w_shift = (1 - ey[:, None]) * np.ones((1, w)) if vertical_only else np.minimum(1 - ey[:, None], 1 - ex[None, :])  # far from the shifted copy's seam
    w_orig, w_shift = w_orig ** 2, w_shift ** 2
    out = (a * w_orig[..., None] + shifted * w_shift[..., None]) / (w_orig + w_shift + 1e-6)[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--vertical-only", action="store_true", help="for directional textures such as roads: tile top to bottom only")
    a = ap.parse_args()
    a.dst.parent.mkdir(parents=True, exist_ok=True)
    out = seamless(Image.open(a.src), a.vertical_only).resize((a.size, a.size), Image.LANCZOS)
    out.save(a.dst, quality=92) if a.dst.suffix == ".webp" else out.save(a.dst)
    print("wrote", a.dst)
