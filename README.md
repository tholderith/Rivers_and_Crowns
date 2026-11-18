# Rivers & Crowns

A turn-based strategy game in the spirit of Heroes of Might and Magic II, set in a fictional
river basin inspired by northeastern North America around 1700. Lead a faction's expeditions,
grow settlements, recruit troops, sign agreements, and fight compact hex battles over the
crossings and trade routes that hold the map together.

**Explore → find an opportunity → fight or negotiate → gain resources → upgrade the settlement → recruit something exciting.**

## What's here

| Path | What it is |
|---|---|
| `docs/design.html` | Design direction, with working town-screen and battle mock-ups. Open it in a browser. |
| `docs/art-list.html` | Every art asset (84 cards), each with its full image prompt. |
| `art/prompts.json` | The same cards as data, read by the generation script. |
| `art/reference/` | Concept art R1–R5. The prompts refer to these by ID. |
| `art/incoming/` | Raw generated images, one per card, with cost and settings. Its README has the status of every card. |
| `art/towns/` | How each town screen is split into building layers. |
| `public/assets/` | Game-ready art: sprites, portraits, seamless textures and layered town screens. |
| `tools/` | The art pipeline (below). |

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

Images come from Google's Nano Banana 2.1 through OpenRouter, chosen in a five-model comparison
for matching the concept art best. Each image costs about $0.06; generating all 84 cards,
including tests and redos, cost $5.50.

1. **Generate.** `python3 tools/gen_art.py <IDs>` (or `--priority P0 --skip-existing`) sends each
   card's prompt with its references (the S-01 style anchor and R1–R5) and saves
   `art/incoming/<ID>.webp`. It reads `OPENROUTER_API_KEY` and stops before passing `--budget`.
2. **Cut.** `python3 tools/cut_all.py` turns sprite sheets into one transparent sprite per pose,
   portraits into cut-outs, and textures into seamless 512 px tiles under `public/assets/`.
3. **Towns.** Each town is painted fully built, then edited into an empty version and into each
   upgrade. `python3 tools/town_layers.py art/towns/french.json` compares them and writes an
   empty base plus one layer per building, positioned by `layers.json`.

## Running the game

```bash
npm install
npm run dev        # play at http://localhost:5173
npm run check      # typecheck + tests
BALANCE=1 npx vitest run tests/balance.test.ts --reporter=verbose   # AI-vs-AI win rates
```

Stack: TypeScript, Vite and PixiJS. The battle rules live in `src/sim/` as pure, deterministic
TypeScript (seeded dice, no DOM), so a battle replays exactly from its seed and actions.
`src/render/` draws it with Pixi and `src/main.ts` runs the HTML interface and turn loop.

## Status

**M1 combat slice: playable.** A hex battle between New France and the Haudenosaunee, played against
the AI, hotseat, or AI vs AI. It has fire / reload / maneuver, woods as cover, morale (wavering,
faltering, inspired), strike-backs, and three hero Command abilities (Rally, Coordinated Volley,
Fieldworks). In 300 AI-vs-AI battles the sides win 145–155, and a battle lasts about 11 rounds.
