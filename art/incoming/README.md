# Incoming art

Raw images from the image model, one per card in `docs/art-list.html`, named by card ID.
Stored as WebP at quality 95 (visually the same as the PNG the API returns, about a third of the size).
Each `<ID>.json` records the model, settings and cost. `_spend.json` logs every paid call.
`-v1` files are earlier attempts kept for comparison.

Regenerate a card: `python3 tools/gen_art.py <ID>`. Rebuild game assets: `python3 tools/cut_all.py`
and `python3 tools/town_layers.py art/towns/<town>.json`.

| ID | Asset | Priority | Status | Cost | Notes |
|---|---|---|---|---|---|
| S-01 | Style anchor (corrected) | P0 | Generated | $0.061 |  |
| T-01 | Meadow grass | P0 | Generated | $0.055 |  |
| T-02 | Forest floor | P0 | Generated | $0.055 |  |
| T-03 | Dirt road | P0 | Generated | $0.055 | Tiles top to bottom only (a road). |
| T-04 | Deep river water | P0 | Generated | $0.056 |  |
| T-05 | Shallows and ford | P0 | Generated | $0.055 |  |
| T-06 | Sand and gravel bank | P1 | Generated | $0.055 |  |
| T-07 | Marsh | P1 | Generated | $0.055 |  |
| T-08 | Rocky upland | P1 | Generated | $0.057 |  |
| M-01 | Tree clusters (8) | P0 | Generated | $0.058 |  |
| M-02 | Rocks and hills (8) | P0 | Generated | $0.062 |  |
| M-03 | Impassable ridge pieces (6) | P1 | Generated | $0.062 |  |
| M-04 | Riverbank details (8) | P1 | Generated | $0.060 |  |
| M-05 | River crossings (5) | P0 | Generated | $0.059 |  |
| L-01 | French town (map icon) | P0 | Generated | $0.060 | Redone once: the first try had ghost text (L-01-v1). |
| L-02 | Haudenosaunee town (map icon) | P0 | Generated | $0.061 |  |
| L-03 | Independent community (map icon) | P1 | Generated | $0.060 |  |
| L-04 | Resource sites (4) | P0 | Generated | $0.063 |  |
| L-05 | Trade and defence sites (4) | P0 | Generated | $0.062 |  |
| L-06 | Places to visit (5) | P1 | Generated | $0.060 |  |
| L-07 | Pickups (8) | P0 | Generated | $0.058 |  |
| L-08 | Map guards (4) | P0 | Generated | $0.061 |  |
| L-09 | Hero map figures (4) | P0 | Generated | $0.064 |  |
| L-10 | Prototype river map (painted base) | P1 | Generated | $0.058 |  |
| TF-01 | French town, fully built | P0 | Generated | $0.059 |  |
| TF-02 | French town, empty plots | P0 | Generated | $0.057 |  |
| TF-03 | Upgrade: Stone Bastion | P0 | Generated | $0.055 |  |
| TF-04 | Upgrade: Commercial Harbor | P0 | Generated | $0.055 | Redone once: the first try also replaced the Voyageur Lodge (kept as TF-04-v1). |
| TF-05 | Upgrade: Military Dock | P0 | Generated | $0.055 | Redone once for the same reason (TF-05-v1). |
| TH-01 | Haudenosaunee town, fully built | P0 | Generated | $0.059 |  |
| TH-02 | Haudenosaunee town, empty plots | P0 | Generated | $0.056 |  |
| TH-03 | Upgrade: Fortified palisade | P0 | Generated | $0.055 |  |
| TH-04 | Upgrade: Great Trade House | P0 | Generated | $0.055 |  |
| TH-05 | Upgrade: Gunsmith's Forge | P0 | Generated | $0.055 |  |
| TI-01 | Independent village scene | P1 | Generated | $0.057 |  |
| B-01 | Battlefield: meadow at forest edge | P0 | Generated | $0.056 |  |
| B-02 | Battlefield: river ford | P0 | Generated | $0.055 |  |
| B-03 | Battlefield: forest clearing | P1 | Generated | $0.055 |  |
| B-04 | Siege field: French town | P1 | Generated | $0.062 |  |
| B-05 | Siege field: Haudenosaunee town | P1 | Generated | $0.057 |  |
| B-06 | Hex obstacles (8) | P0 | Generated | $0.063 |  |
| B-07 | Siege walls: French | P1 | Generated | $0.059 | Walls drawn running left to right, not top to bottom. |
| B-08 | Siege walls: Haudenosaunee | P1 | Generated | $0.061 | Walls drawn running left to right, not top to bottom. |
| B-09 | Battle effects (10) | P0 | Generated | $0.061 |  |
| U-FR-01 | Habitant Militia | P0 | Generated | $0.061 |  |
| U-FR-02 | Voyageurs | P0 | Generated | $0.062 |  |
| U-FR-03 | Troupes de la Marine | P0 | Generated | $0.061 |  |
| U-FR-04 | Colour Party | P0 | Generated | $0.058 |  |
| U-FR-05 | Field Gun | P0 | Generated | $0.063 |  |
| U-HD-01 | Scouts | P0 | Generated | $0.062 |  |
| U-HD-02 | Bowmen | P0 | Generated | $0.062 |  |
| U-HD-03 | Musket Warriors | P0 | Generated | $0.063 |  |
| U-HD-04 | Club Warriors | P0 | Generated | $0.062 |  |
| U-HD-05 | War Captain's Band | P0 | Generated | $0.063 |  |
| U-NE-01 | Wolves | P1 | Generated | $0.062 |  |
| U-NE-02 | Black bear | P1 | Generated | $0.060 |  |
| U-NE-03 | Deserters | P1 | Generated | $0.062 |  |
| H-FR-01 | Élise Marchand · River Captain | P0 | Generated | $0.057 |  |
| H-FR-02 | Antoine Lefèvre · Engineer | P0 | Generated | $0.057 |  |
| H-FR-03 | Jean-Baptiste Roy · Voyageur Guide | P0 | Generated | $0.057 |  |
| H-HD-01 | Clan Mother · Diplomat | P0 | Generated | $0.059 |  |
| H-HD-02 | War Captain · Commander | P0 | Generated | $0.059 |  |
| H-HD-03 | Pathfinder · Navigator | P0 | Generated | $0.059 |  |
| H-NE-01 | Independent community leader | P1 | Generated | $0.057 |  |
| I-01 | Resource icons (5) | P0 | Generated | $0.058 |  |
| I-02 | Command ability medallions (5) | P0 | Generated | $0.064 |  |
| I-03 | Equipment set A (8) | P0 | Generated | $0.062 |  |
| I-04 | Equipment set B (8) | P1 | Generated | $0.058 |  |
| I-05 | Specialty and status icons (9) | P1 | Generated | $0.065 | Redone once: the first try had words baked in (I-05-v1). |
| I-06 | Parchment texture | P0 | Generated | $0.054 |  |
| I-07 | Navy panel texture | P0 | Generated | $0.058 | Made with GPT Image 2.6 Flare: Google blocked it as a false copyright match. |
| I-08 | Wood button texture | P0 | Generated | $0.054 |  |
| I-09 | Gold frame corner | P1 | Generated | $0.057 |  |
| I-10 | Crown emblem | P1 | Generated | $0.055 |  |
| K-01 | Title screen | P1 | Generated | $0.060 |  |
| K-02 | Diplomacy backdrop | P1 | Generated | $0.058 |  |
| K-03 | Scenario map (parchment style) | P1 | Generated | $0.062 |  |
| K-04 | Loading screen: the portage | P2 | Generated | $0.060 |  |
| K-05 | Loading screen: harvest | P2 | Generated | $0.059 |  |
| K-06 | Victory | P2 | Generated | $0.056 |  |
| K-07 | Defeat | P2 | Generated | $0.060 |  |
| TE-01 | English town, fully built | P2 | Generated | $0.056 |  |
| U-EN-01 | English Line Infantry | P2 | Generated | $0.065 |  |
| U-EN-02 | English Colonial Militia | P2 | Generated | $0.062 |  |

Total OpenRouter spend, including model tests and redos: **$5.50**.
