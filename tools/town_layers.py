#!/usr/bin/env python3
"""Split a generated town screen into an empty base plus one layer per building.

Needs three kinds of image from the art list: the fully built town, an edit of it with
the buildings removed (the empty plots), and optionally edits that upgrade one building.
Comparing them gives each building as a cut-out layer that lines up with the base.

    python3 tools/town_layers.py art/towns/french.json

The config names the images, a box for each building (in 0-1 fractions of the image),
and the upgrades. Output goes to public/assets/towns/<name>/ at 1920 px wide: base.webp,
one WebP per layer, and layers.json with each layer's position as fractions of the base.

An upgrade with "replaces" is the whole upgraded structure: show it instead of that
layer. One with "adds_to" holds only the new pixels: draw it on top of that layer.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent
THRESH = 75  # summed RGB difference that counts as "changed"


OUT_WIDTH = 1920  # game resolution for town screens


def load(cid):
    return np.asarray(Image.open(ROOT / "art" / "incoming" / f"{cid}.webp").convert("RGB")).astype(int)


def save_scaled(img, path, scale):
    if scale != 1:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    img.save(path, "WEBP", quality=90, method=4)


def changed(a, b):
    m = np.abs(a - b).sum(-1) > THRESH
    m = nd.binary_opening(m, iterations=1)
    m = nd.binary_closing(m, iterations=4)
    m = nd.binary_fill_holes(m)
    lab, n = nd.label(m)
    if n:
        sizes = nd.sum(m, lab, range(1, n + 1))
        m = np.isin(lab, 1 + np.where(sizes > 1500)[0])
    return nd.binary_dilation(m, iterations=3)


def box_mask(shape, boxes):
    h, w = shape
    m = np.zeros((h, w), bool)
    for x0, y0, x1, y1 in boxes:
        m[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = True
    return m


def save_layer(out, name, src, mask, meta, scale=1.0):
    ys, xs = np.where(mask)
    if not len(ys):
        print(f"  {name}: empty, skipped"); return
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([src[y0:y1, x0:x1].astype(np.uint8), (mask[y0:y1, x0:x1] * 255).astype(np.uint8)])
    save_scaled(Image.fromarray(rgba, "RGBA"), out / f"{name}.webp", scale)
    h, w = mask.shape
    meta[name] = {"left": round(x0 / w, 5), "top": round(y0 / h, 5), "width": round((x1 - x0) / w, 5), "height": round((y1 - y0) / h, 5)}
    print(f"  {name}: {x1 - x0}x{y1 - y0}, {int(mask.sum())} px")


def main(cfg_path):
    cfg = json.loads(Path(cfg_path).read_text())
    out = ROOT / "public" / "assets" / "towns" / cfg["name"]
    out.mkdir(parents=True, exist_ok=True)
    built, empty = load(cfg["built"]), load(cfg["empty"])
    scale = OUT_WIDTH / built.shape[1]
    for old in list(out.glob("*.png")) + list(out.glob("*.webp")):
        old.unlink()
    save_scaled(Image.fromarray(empty.astype(np.uint8)), out / "base.webp", scale)
    diff = changed(built, empty)
    taken = np.zeros(diff.shape, bool)
    layers, masks = {}, {}
    print(cfg["name"])
    for name, spec in cfg["buildings"].items():  # first listed claims shared pixels
        m = diff & box_mask(diff.shape, spec["boxes"]) & ~taken
        if "exclude" in spec:
            m &= ~box_mask(diff.shape, spec["exclude"])
        taken |= m
        masks[name] = m
        save_layer(out, name, built, m, layers, scale)
    if cfg.get("leftovers"):
        save_layer(out, cfg["leftovers"], built, diff & ~taken, layers, scale)
    for name, spec in cfg.get("upgrades", {}).items():
        up = load(spec["image"])
        new = changed(up, built)
        if spec.get("replaces"):
            # the whole upgraded structure: everything that isn't empty ground, minus other
            # buildings that the edit left untouched
            others = np.zeros(diff.shape, bool)
            for k, mk in masks.items():
                if k != spec["replaces"]:
                    others |= mk
            m = changed(up, empty) & ~(others & ~new)
        else:
            m = new  # an add-on drawn over the existing building
        m &= box_mask(diff.shape, spec["boxes"])
        if "exclude" in spec:
            m &= ~box_mask(diff.shape, spec["exclude"])
        save_layer(out, name, up, m, layers, scale)
        if name in layers:
            layers[name]["replaces" if spec.get("replaces") else "adds_to"] = spec.get("replaces") or spec.get("adds_to")
    order = list(cfg["buildings"]) + ([cfg["leftovers"]] if cfg.get("leftovers") else [])
    (out / "layers.json").write_text(json.dumps({"base": "base.webp", "size": [round(built.shape[1] * scale), round(built.shape[0] * scale)],
                                                 "draw_order": cfg.get("draw_order", order), "layers": layers}, indent=1))
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[1])
