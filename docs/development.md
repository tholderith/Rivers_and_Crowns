# Rivers & Crowns development

## Current milestone

M1 is a standalone, replayable hex skirmish for the French expedition and Haudenosaunee nation. Local hotseat lets us test whether firing creates a worthwhile window to advance, take cover or reload. The prototype roadmap continues with river travel, then settlements, then the full 30–45 minute scenario.

The current design lives in [design.html](design.html), which supplies the rules and visual references, and [art-list.html](art-list.html), which supplies production prompts. The latest campaign-map direction keeps routes readable and gives landmarks breathing room. For French uniforms, blue officers and grey-white infantry with blue cuffs are intentional.

## Run M1

With Node.js 24 or later, run `npm run dev` and open http://127.0.0.1:5173. Run `npm test` for the combat rules. The prototype uses TypeScript, the browser DOM/SVG, and a dependency-free local development server. Vite and PixiJS remain the planned stack.

## Ownership

| Owner | Scope | Reads first |
| --- | --- | --- |
| Integration | Entry point, milestone decisions, interfaces and release checks | This file and the prototype roadmap in `docs/design.html` |
| Combat rules | `src/combat/` and `tests/combat.test.ts` | Combat and battle mock-up sections of `docs/design.html` |
| Battle screen | `index.html`, `src/main.ts` and `src/battle-view/` | Battle mock-up and battle-facing API in `src/combat/index.ts` |
| Art production | `art/incoming/` and approved references | Relevant card IDs in `docs/art-list.html` and `art/reference/` |
| Playtest | Reproduction steps, expected behavior and evidence | Current milestone, relevant rules, and the branch diff |

## Starting and handing off an agent task

1. Give the agent a branch or commit, one outcome, its owned paths, the design sections to read, and checks that prove the outcome. Start with a fresh context and attach the specific reference images only when the assignment calls for them.
2. Keep shared interfaces with integration. Get agreement between affected owners before changing an interface, then record the decision near the code or design section it affects.
3. End each task with changed paths, checks run and their results, provisional decisions, and the next unresolved item. Put durable decisions in the repo or PR so a fresh agent can resume from the branch and its brief.
4. Have an independent playtester try the combined build. Check both factions can move, exchange fire, reload and Rally, cover affects outcomes, a battle can end, and reset starts the same opening. Use playtest notes to adjust balance before building out the full roster.

For M2, start from the river design in `docs/design.html`. Resolve the map size and movement budget against a small fork-and-portage test map before spending time on final art.

## M1 playtest notes

The initial meadow has a 9×6 hex board and five stacks across the two sides. Each activation consumes one order. A ranged attack empties the weapon, woodland reduces ranged damage, and weakened morale reduces attack damage. Rally restores the acting stack’s morale for one side Command. Eliminating the other army wins, and a match draws after 16 rounds. Roster composition, stats, Command supply, and round limit are provisional. Range and cover stand in for a fuller sight-line model.

Try the opening shot into cover, then replay it by moving into cover first. After an exchange, weigh taking a melee opportunity or changing position against spending the next action to reload. Note where passing or reloading feels forced and whether either side can evade to draw too easily.

## Art checkpoint

M1 uses SVG placeholders. The baseline had five concept references and no incoming production images. The first production dependency is S-01, the style anchor. Accept it as A0 after confirming all 12 specified subjects and clean separation around each one. For a first combat art batch, use B-01 meadow, B-06 cover and roster sheets U-FR-02, U-FR-03, U-FR-05, U-HD-03, and U-HD-05. Keep raw card-ID PNGs under `art/incoming/` and processed sprites under `public/assets/`.
