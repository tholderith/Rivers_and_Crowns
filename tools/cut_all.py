#!/usr/bin/env python3
"""Cut every generated sprite sheet and portrait in art/incoming into game assets.

Sprite sheets  -> public/assets/sprites/<ID>/<ID>-NN.webp (half the generated size)
Hero portraits -> public/assets/portraits/<ID>/<ID>-01.webp
Textures       -> public/assets/textures/<ID>.webp (made seamless, 512 px)

    python3 tools/cut_all.py            # everything that has been generated
    python3 tools/cut_all.py U-FR-01    # just these cards
"""
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# sheets whose pieces sit far apart (smoke, splinters, muzzle flashes) need wider grouping
GROUP = {"B-09": 22, "L-08": 14, "U-HD-03": 14, "U-FR-01": 14, "U-FR-03": 14, "U-FR-05": 14}
VERTICAL_ONLY = {"T-03"}  # directional textures


def run(args):
    r = subprocess.run([sys.executable, *args], capture_output=True, text=True, cwd=ROOT)
    return (r.stdout or r.stderr).strip().splitlines()[-1]


def main():
    cards = json.loads((ROOT / "art" / "prompts.json").read_text())
    only = set(sys.argv[1:])
    for c in cards:
        cid, bg = c["id"], c["background"]
        src = ROOT / "art" / "incoming" / f"{cid}.webp"
        if (only and cid not in only) or not src.exists():
            continue
        if bg == "Seamless":
            args = ["tools/make_seamless.py", str(src), f"public/assets/textures/{cid}.webp"]
            if cid in VERTICAL_ONLY:
                args.append("--vertical-only")
        elif bg.startswith("Navy"):
            args = ["tools/cut_sprites.py", str(src), f"public/assets/portraits/{cid}", "--min-area", "40000", "--tolerance", "30"]
        elif bg.startswith("Cut-out"):
            args = ["tools/cut_sprites.py", str(src), f"public/assets/sprites/{cid}", "--min-area", "2500",
                    "--group", str(GROUP.get(cid, 8))]
        else:
            continue  # full scenes and town edits are used whole or go through town_layers.py
        print(cid, run(args), flush=True)


if __name__ == "__main__":
    main()
