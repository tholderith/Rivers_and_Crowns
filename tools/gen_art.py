#!/usr/bin/env python3
"""Generate art-list images through OpenRouter's image API.

Reads the cards in art/prompts.json (exported from docs/art-list.html), attaches the
references each card names, and saves the result as art/incoming/<ID>.webp (quality 95) with a
<ID>.json sidecar (model, cost, settings). Every call is logged to
art/incoming/_spend.json, and the script refuses to start a call that could push
total spend past --budget.

    python3 tools/gen_art.py U-FR-01 U-FR-02
    python3 tools/gen_art.py --priority P0 --skip-existing --jobs 3 --budget 8
    python3 tools/gen_art.py TH-01 --model openai/gpt-image-2.6-sunburst --suffix gpt

The API key comes from OPENROUTER_API_KEY. In the Claude cloud environment the network
proxy adds it, so the placeholder default is fine there.

References on a card: A0 = the approved style anchor (S-01), R1-R5 = art/reference/,
and any card ID (TF-01, L-08 ...) = that card's generated image.
"""
import argparse, base64, io, json, os, re, sys, threading, time, urllib.error, urllib.request
import concurrent.futures as cf
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
INCOMING = ROOT / "art" / "incoming"
REFDIR = ROOT / "art" / "reference"
REF_FILES = {
    "R1": "R1-asset-language.webp", "R2": "R2-hero-screen.webp", "R3": "R3-haudenosaunee-town.webp",
    "R4": "R4-french-town.webp", "R5": "R5-adventure-map.webp",
}
API = "https://openrouter.ai/api/v1/images"
DEFAULT_MODEL = "google/gemini-nano-banana-2.1"
EST_COST = 0.08  # per call, used only for the budget check before a call
_lock = threading.Lock()


def incoming(cid):
    """The generated image for a card: stored as WebP (quality 95) in art/incoming."""
    for ext in (".webp", ".png"):
        if (INCOMING / f"{cid}{ext}").exists():
            return INCOMING / f"{cid}{ext}"
    return INCOMING / f"{cid}.webp"


def ref_path(token):
    token = token.strip()
    if token == "A0":
        return incoming("S-01")
    if token in REF_FILES:
        return REFDIR / REF_FILES[token]
    m = re.search(r"([A-Z]{1,2}-(?:[A-Z]{2}-)?\d{2})", token)
    if m:
        return incoming(m.group(1))
    raise ValueError(f"unknown reference {token!r}")


def encode(path, max_side):
    im = Image.open(path).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}}


def aspect_for(card):
    cid, size = card["id"], card["size"]
    if cid.startswith(("TF-", "TH-", "TI-", "B-0", "K-")) and card["background"] in ("Full scene",) or card["background"].startswith("Edit of"):
        return "16:9"
    if "portrait" in size:
        return "2:3"
    if "square" in size:
        return "1:1"
    return "3:2"


def spend_total():
    led = json.loads((INCOMING / "_spend.json").read_text())
    return sum(e["cost"] or 0 for e in led["entries"]), led


def log_spend(entry):
    with _lock:
        _, led = spend_total()
        led["entries"].append(entry)
        (INCOMING / "_spend.json").write_text(json.dumps(led, indent=1))


def generate(card, model, budget, suffix="", extra_prompt=""):
    out = INCOMING / f"{card['id']}{('-' + suffix) if suffix else ''}.webp"
    with _lock:
        total, _ = spend_total()
        if total + EST_COST > budget:
            return card["id"], f"SKIPPED: budget (${total:.2f} spent of ${budget:.2f})", None
    edit = card["background"].startswith("Edit of")
    refs = [encode(ref_path(t), 2752 if edit else 1024) for t in card["refs"].split(",") if t.strip()]
    prompt = card["prompt"] + (("\n" + extra_prompt) if extra_prompt else "")
    body = {"model": model, "prompt": prompt, "aspect_ratio": aspect_for(card), "input_references": refs}
    if model.startswith("google/"):
        body["resolution"] = "2K"
    if model.startswith("openai/"):
        body["quality"] = "high"
        if card["background"].startswith("Cut-out"):
            body["background"] = "transparent"
    key = os.environ.get("OPENROUTER_API_KEY", "proxy-injected")
    req = urllib.request.Request(API, data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    t0 = time.time()
    for attempt in range(3):
        try:
            res = json.loads(urllib.request.urlopen(req, timeout=600).read())
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(15 * (attempt + 1)); continue
            return card["id"], f"HTTP {e.code}: {msg}", None
        except Exception as e:  # network hiccup
            if attempt < 2:
                time.sleep(15); continue
            return card["id"], f"ERROR: {e}", None
    data = res.get("data") or []
    if not data:
        return card["id"], "no image returned: " + json.dumps(res)[:300], None
    Image.open(io.BytesIO(base64.b64decode(data[0]["b64_json"]))).convert("RGB").save(out, "WEBP", quality=95, method=4)
    cost = (res.get("usage") or {}).get("cost")
    meta = {"id": card["id"], "model": model, "aspect_ratio": body["aspect_ratio"], "refs": card["refs"],
            "cost": cost, "seconds": round(time.time() - t0), "size": Image.open(out).size, "extra_prompt": extra_prompt}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1))
    log_spend({"id": out.stem, "model": model, "cost": cost})
    return card["id"], f"ok {meta['size']} ${cost}", cost


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--priority")
    ap.add_argument("--skip-existing", action="store_true")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--suffix", default="", help="saved as <ID>-<suffix>.webp, for alternates")
    ap.add_argument("--extra", default="", help="text appended to the prompt")
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--budget", type=float, default=8.0, help="stop before total logged spend passes this (USD)")
    a = ap.parse_args()
    cards = {c["id"]: c for c in json.loads((ROOT / "art" / "prompts.json").read_text())}
    ids = a.ids or [i for i, c in cards.items() if a.priority and c["priority"] == a.priority]
    if a.skip_existing:
        ids = [i for i in ids if not incoming(i).exists()]
    missing = [i for i in ids if i not in cards]
    if missing:
        sys.exit(f"unknown ids: {missing}")
    print(f"{len(ids)} to generate; spent so far ${spend_total()[0]:.2f}", flush=True)
    with cf.ThreadPoolExecutor(a.jobs) as ex:
        futs = {ex.submit(generate, cards[i], a.model, a.budget, a.suffix, a.extra): i for i in ids}
        for f in cf.as_completed(futs):
            cid, status, _ = f.result()
            print(f"{cid}: {status}", flush=True)
    print(f"total spent ${spend_total()[0]:.2f}")


if __name__ == "__main__":
    main()
