# Rivers & Crowns

A turn-based strategy game in the spirit of Heroes of Might and Magic II, set in a fictional
river basin inspired by northeastern North America around 1700. Lead a faction's expeditions,
grow settlements, recruit troops, sign agreements, and fight compact hex battles over the
crossings and trade routes that hold the map together.

**Explore → find an opportunity → fight or negotiate → gain resources → upgrade the settlement → recruit something exciting.**

## Play the combat prototype

With Node.js 24 or later, run `npm run dev` and open http://127.0.0.1:5173. Two players share the controls. Run `npm test` to verify the combat rules. See [development.md](docs/development.md) for the current milestone and contributor handoff.

## What's here

| Path | What it is |
|---|---|
| `docs/design.html` | Design direction, with working town-screen and battle mock-ups. Open it in a browser. |
| `docs/art-list.html` | Every art asset, each with a complete ChatGPT image prompt and a done checklist. |
| `art/reference/` | Concept art R1–R5. The art-list prompts refer to these by ID. |
| `art/incoming/` | Raw image downloads from ChatGPT, named by card ID. See its README for the full list. |
| `tools/cut_sprites.py` | Cuts a generated sprite sheet into separate transparent PNGs. |

Online copies: [design](https://claude.ai/artifact/HhqbjSYEn2YR5BNLxdP8Aj) ·
[art list](https://claude.ai/artifact/NEckq8AxSLxcsDtNkmwdJi)

## Factions

| Faction | Plays as | Status |
|---|---|---|
| French expedition | Connected river outposts, trade agreements, flexible armies | Prototype |
| Haudenosaunee nation | Political coordination, strong inland towns, control of interior routes | Prototype |
| English colony | Productive ports, organized infantry, expensive artillery | Release 1 |
| Wabanaki | Coastal and river mobility, spread-out settlements | Later |

## Prototype scope

One 30–45 minute scenario: two playable factions and one independent community, three heroes
per side, five unit types and eight buildings per faction, and one river map with a ford, a
portage, a trading settlement and a fort. You win by holding the key routes or taking the enemy
headquarters. Local hotseat play plus a basic AI.

1. **Combat slice.** Fire, reload, maneuver, cover and morale.
2. **River map.** Hero movement, boats, ford, portage, fog of war.
3. **Settlement.** Town screen, eight buildings, branching upgrades, recruitment.
4. **Playable scenario.** Both factions, agreements, victory conditions, hotseat, AI.

## Art workflow

1. Generate images in ChatGPT with the prompts in `docs/art-list.html`, attaching the
   references named on each card.
2. Download the full-size PNG, name it by card ID (for example `U-FR-03.png`), and upload it to
   `art/incoming/`.
3. Sprite sheets are cut with:

   ```bash
   python3 tools/cut_sprites.py art/incoming/L-07.png public/assets/sprites/L-07
   ```

   Town screens are made as a fully built painting plus an empty version made by editing it.
   Comparing the two gives each building as its own layer.

Planned stack: TypeScript, Vite and PixiJS, with a deterministic turn-based simulation kept
separate from rendering.
