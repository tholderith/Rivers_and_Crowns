#!/usr/bin/env python3
"""Cut a generated sprite sheet into separate transparent PNGs.

Removes the flat background (transparent, or the plain parchment colour the
prompts ask for), finds each separate object, and saves one trimmed PNG per object,
numbered left to right, top to bottom.

    python3 tools/cut_sprites.py art/incoming/L-07.png public/assets/sprites/L-07
    python3 tools/cut_sprites.py SHEET OUT_DIR --tolerance 40 --min-area 400

Needs Pillow, numpy and scipy.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def background_mask(rgba: np.ndarray, tolerance: float) -> np.ndarray:
    """True where a pixel is background: already transparent, or close to the
    border colour and connected to the image edge."""
    alpha = rgba[..., 3]
    if (alpha < 16).mean() > 0.2:  # the sheet already has transparency
        return alpha < 16
    rgb = rgba[..., :3].astype(np.int32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    close = np.sqrt(((rgb - bg) ** 2).sum(-1)) < tolerance
    # keep only the background regions that touch the edge, so light colours
    # inside an object (a white sail, a pale face) are not removed
    labels, _ = ndimage.label(close)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    return np.isin(labels, edge[edge > 0])


def cut(sheet: Path, out_dir: Path, tolerance: float, min_area: int, pad: int) -> int:
    im = np.array(Image.open(sheet).convert("RGBA"))
    bg = background_mask(im, tolerance)
    im[bg, 3] = 0
    # objects = connected non-background areas; a small dilation keeps shadows
    # and thin parts (musket barrels, flag poles) attached to their object
    solid = ndimage.binary_dilation(~bg, iterations=3)
    labels, n = ndimage.label(solid)
    boxes = [(sl, int((labels[sl] == i + 1).sum())) for i, sl in enumerate(ndimage.find_objects(labels))]
    boxes = [sl for sl, area in boxes if area >= min_area]
    # reading order: rows (by top edge, in bands of 1/8 image height), then left to right
    band = max(1, im.shape[0] // 8)
    boxes.sort(key=lambda sl: (sl[0].start // band, sl[1].start))
    out_dir.mkdir(parents=True, exist_ok=True)
    for k, (ys, xs) in enumerate(boxes, 1):
        y0, y1 = max(0, ys.start - pad), min(im.shape[0], ys.stop + pad)
        x0, x1 = max(0, xs.start - pad), min(im.shape[1], xs.stop + pad)
        Image.fromarray(im[y0:y1, x0:x1]).save(out_dir / f"{sheet.stem}-{k:02d}.png")
    return len(boxes)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheet", type=Path)
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--tolerance", type=float, default=38, help="colour distance counted as background (default 38)")
    ap.add_argument("--min-area", type=int, default=600, help="ignore specks smaller than this many pixels")
    ap.add_argument("--pad", type=int, default=2, help="transparent margin around each sprite")
    a = ap.parse_args()
    print(f"{cut(a.sheet, a.out_dir, a.tolerance, a.min_area, a.pad)} sprites -> {a.out_dir}")
