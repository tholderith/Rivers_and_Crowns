import { describe, expect, it } from 'vitest';
import { aiManageTowns, aiTarget, createWorld, encounterArmies, endTurn, findPath, moveHero, resolveBattle } from '../src/sim/world';
import { act, begin, createCustomBattle } from '../src/sim/battle';
import { chooseAbility, chooseAction } from '../src/sim/ai';

function fightOut(world: ReturnType<typeof createWorld>, seed: number) {
  const att = world.players[world.turn];
  const d = encounterArmies(world);
  const hero = { name: 'x', portrait: 'x', attack: 1, defense: 1, command: 3 };
  const st = createCustomBattle('t', seed, { faction: att.faction, name: att.name, hero, army: att.hero.army },
    { faction: d.defenderFaction, name: d.defenderName, hero: { ...hero, attack: 0, defense: 0 }, army: d.army }, 'B-01', [], []);
  begin(st);
  for (let n = 0; n < 3000 && st.winner === null; n++) { const ab = chooseAbility(st); if (ab) act(st, ab); act(st, chooseAction(st)); }
  resolveBattle(world, st.winner === 0, st.stacks.filter(s => s.side === 0).map(s => s.count), st.stacks.filter(s => s.side === 1).map(s => s.count));
}

describe.skipIf(!process.env.CAMPAIGN)('campaign', () => {
  it('AI vs AI campaigns finish', () => {
    const results: string[] = [];
    for (let g = 0; g < Number(process.env.GAMES ?? 10); g++) {
      const w = createWorld(g + 1);
      let seed = g * 100;
      for (let turn = 0; turn < 400 && w.winner === null; turn++) {
        aiManageTowns(w);
        for (let i = 0; i < 10 && w.winner === null; i++) {
          const t = aiTarget(w); if (!t) break;
          const r = findPath(w, w.turn, t); if (!r) break;
          const ev = moveHero(w, r.path); if (!ev.length) break;
          if (w.encounter) fightOut(w, seed++);
        }
        aiManageTowns(w);
        endTurn(w);
      }
      results.push(`${w.winner === null ? 'none' : w.players[w.winner].faction} day ${w.day}`);
    }
    console.log(results.join('\n'));
    expect(results.some(r => !r.startsWith('none'))).toBe(true);
  }, 600000);
});
