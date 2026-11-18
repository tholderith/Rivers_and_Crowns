import { describe, expect, it } from 'vitest';
import {
  aiHeroes, aiManageTowns, aiTarget, battleHero, createWorld, encounterArmies, endTurn, findPath, heroById, moveHero, resolveBattle, selectHero, type WorldState,
} from '../src/sim/world';
import { act, begin, createCustomBattle } from '../src/sim/battle';
import { chooseAbility, chooseAction } from '../src/sim/ai';

function fightOut(world: WorldState, seed: number) {
  const d = encounterArmies(world);
  const att = heroById(world, d.attacker)!;
  const pl = world.players[att.player];
  const plain = { name: 'x', portrait: 'x', attack: 0, defense: 0, command: 3 };
  const st = createCustomBattle('t', seed, { faction: pl.faction, name: pl.name, hero: battleHero(world, att.hero.id), army: att.hero.army },
    { faction: d.defenderFaction, name: d.defenderName, hero: d.defenderHero ? battleHero(world, d.defenderHero) : plain, army: d.army }, 'B-01', [], []);
  begin(st);
  for (let n = 0; n < 3000 && st.winner === null; n++) { const ab = chooseAbility(st); if (ab) act(st, ab); act(st, chooseAction(st)); }
  resolveBattle(world, st.winner === 0, st.stacks.filter(s => s.side === 0).map(s => s.count), st.stacks.filter(s => s.side === 1).map(s => s.count));
}

/** One AI turn for the current player: every hero moves, strongest first. */
export function aiTurn(w: WorldState, nextSeed: () => number) {
  aiManageTowns(w);
  for (const id of aiHeroes(w)) {
    if (w.winner !== null) break;
    if (!selectHero(w, id)) continue; // fell in an earlier fight
    for (let i = 0; i < 10 && w.winner === null; i++) {
      const t = aiTarget(w); if (!t) break;
      const r = findPath(w, w.turn, t); if (!r) break;
      const ev = moveHero(w, r.path); if (!ev.length) break;
      if (w.encounter) { fightOut(w, nextSeed()); if (!w.players[w.turn].heroes.some(h => h.id === id)) break; }
    }
  }
  aiManageTowns(w);
}

describe.skipIf(!process.env.CAMPAIGN)('campaign', () => {
  it('AI vs AI campaigns finish', () => {
    const rows: { winner: number | null; how: string | null; day: number; xp: number; heroes: number }[] = [];
    for (let g = 0; g < Number(process.env.GAMES ?? 10); g++) {
      const w = createWorld(g + 1);
      let seed = g * 100;
      for (let turn = 0; turn < 400 && w.winner === null; turn++) {
        aiTurn(w, () => seed++);
        endTurn(w);
      }
      rows.push({ winner: w.winner, how: w.winReason, day: w.day, xp: w.players.reduce((n, p) => n + p.heroes.reduce((m, h) => m + h.xp, 0), 0), heroes: w.players.reduce((n, p) => n + p.heroes.length, 0) });
    }
    const done = rows.filter(r => r.winner !== null);
    const count = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).length;
    console.log([
      ...rows.map((r, i) => `game ${i + 1}: ${r.winner === null ? 'none' : ['french', 'haudenosaunee'][r.winner]} (${r.how ?? '-'}) day ${r.day}, xp on the map ${r.xp}, heroes left ${r.heroes}`),
      `finished ${done.length}/${rows.length}; French ${count(r => r.winner === 0)}, Haudenosaunee ${count(r => r.winner === 1)}, stalemates ${count(r => r.winner === null)}`,
      `by town ${count(r => r.how === 'town')}, by routes ${count(r => r.how === 'routes')}, elimination ${count(r => r.how === 'elimination')}`,
      `average length of finished games: ${(done.reduce((n, r) => n + r.day, 0) / Math.max(1, done.length)).toFixed(1)} days`,
    ].join('\n'));
    expect(done.length).toBeGreaterThan(0);
    expect(rows.some(r => r.xp > 0)).toBe(true);
  }, 3600000);
});
