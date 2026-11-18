import { describe, expect, it } from 'vitest';
import {
  aiTarget, heroPool, build, cannotBuild, createWorld, endTurn, findPath, guardsNear, moveHero, objectAt, recruit, resolveBattle, terrainAt, townFootprint, townHere, transfer, type Tile, type WorldState,
} from '../src/sim/world';

const teleport = (st: WorldState, p: number, t: Tile) => { st.players[p].heroes[0].tile = t; };

describe('adventure map', () => {
  it('the only ways across the river are the ford and the portage', () => {
    const st = createWorld();
    st.objects = st.objects.filter(o => o.type !== 'guard');
    st.players[0].heroes[0].mp = 99999;
    const r = findPath(st, 0, [33, 15])!;
    expect(r).not.toBeNull();
    const kinds = new Set(r.path.map(t => terrainAt(st, t)));
    expect(kinds.has('F')).toBe(true);
    expect(kinds.has('P')).toBe(true);
    expect(r.path.every(t => terrainAt(st, t) !== '~' && terrainAt(st, t) !== '^')).toBe(true);
  });

  it('walking next to guards starts a battle', () => {
    const st = createWorld();
    const wolves = st.objects.find(o => o.id === 'g-wolves')!;
    teleport(st, 0, [wolves.tile[0] - 3, wolves.tile[1]]);
    const r = findPath(st, 0, [wolves.tile[0] - 1, wolves.tile[1]])!;
    const ev = moveHero(st, r.path);
    expect(ev.at(-1)?.type).toBe('encounter');
    expect(st.encounter).toEqual({ kind: 'guard', attacker: 'fr-elise', object: 'g-wolves' });
    expect(guardsNear(st, st.players[0].heroes[0].tile).length).toBe(1);
  });

  it('beating guards removes them; losing removes the hero into the hire pool', () => {
    const st = createWorld();
    st.encounter = { kind: 'guard', attacker: 'fr-elise', object: 'g-wolves' };
    resolveBattle(st, true, [20, 10, 8, 1], [0]);
    expect(st.objects.find(o => o.id === 'g-wolves')!.gone).toBe(true);
    st.encounter = { kind: 'guard', attacker: 'fr-elise', object: 'g-bear' };
    resolveBattle(st, false, [0, 0, 0, 0], [3]);
    expect(st.players[0].heroes).toEqual([]);
    expect(heroPool(st, 0).map(h => h.id)).toContain('fr-elise');
  });

  it('captured mines pay out at the start of each day', () => {
    const st = createWorld();
    const mill = st.objects.find(o => o.id === 'mine-saw')!;
    mill.owner = 0;
    const before = st.players[0].resources.timber, coin = st.players[0].resources.coin;
    endTurn(st); endTurn(st);
    expect(st.day).toBe(2);
    expect(st.players[0].resources.timber).toBe(before + 2);
    expect(st.players[0].resources.coin).toBe(coin + 500); // the town
  });

  it('recruiting goes into the garrison and needs coin and stock', () => {
    const st = createWorld();
    const town = st.objects.find(o => o.id === 'town-fr')!;
    const coin = st.players[0].resources.coin;
    expect(recruit(st, 'town-fr', 'U-FR-01', 5)).toBe(true);
    expect(st.players[0].resources.coin).toBe(coin - 150);
    expect(town.army!.find(a => a.unit === 'U-FR-01')!.count).toBe(35);
    expect(recruit(st, 'town-fr', 'U-FR-05', 99)).toBe(false);
  });

  it('town footprints block movement; only the entrance can be entered', () => {
    const st = createWorld();
    st.objects = st.objects.filter(o => o.type === 'town');
    const town = st.objects.find(o => o.id === 'town-fr')!;
    const fp = townFootprint(town);
    expect(fp.length).toBe(23);
    expect(fp.some(t => t[0] === town.tile[0] && t[1] === town.tile[1])).toBe(false);
    for (const t of fp) expect(objectAt(st, t)).toBe(town);
    expect(objectAt(st, town.tile)).toBe(town);
    st.players[0].heroes[0].mp = 99999;
    const around = findPath(st, 0, [town.tile[0], town.tile[1] - 5])!;
    expect(around).not.toBeNull();
    expect(around.path.some(t => fp.some(f => f[0] === t[0] && f[1] === t[1]))).toBe(false);
    // aiming at the body of the town heads for the gate instead
    expect(findPath(st, 0, fp[0])!.path.at(-1)).toEqual(town.tile);
    // a hand-made path through the footprint is refused
    teleport(st, 0, [town.tile[0], town.tile[1] + 1]);
    const hero = st.players[0].heroes[0];
    moveHero(st, [[town.tile[0], town.tile[1] - 1]]);
    expect(hero.tile).toEqual([town.tile[0], town.tile[1] + 1]);
    // the entrance is enterable: visiting an own town; attacking an enemy one
    expect(moveHero(st, [town.tile]).some(e => e.type === 'town')).toBe(true);
    town.owner = 1;
    expect(moveHero(st, [town.tile]).some(e => e.type === 'encounter')).toBe(true);
    expect(st.encounter).toEqual({ kind: 'town', attacker: 'fr-elise', object: 'town-fr' });
  });

  it('towns and hero starts sit on clear land', () => {
    const st = createWorld();
    for (const town of st.objects.filter(o => o.type === 'town')) {
      for (const t of [town.tile, ...townFootprint(town)]) {
        expect('.f').toContain(terrainAt(st, t));
        expect(st.objects.filter(o => o !== town && o.tile[0] === t[0] && o.tile[1] === t[1])).toEqual([]);
      }
    }
    st.players.forEach((p, i) => {
      const gate = st.objects.find(o => o.type === 'town' && o.owner === i)!;
      expect(townHere(st, i)).toBe(gate);
      expect(townFootprint(gate).some(t => t[0] === p.heroes[0].tile[0] && t[1] === p.heroes[0].tile[1])).toBe(false);
    });
  });

  it('both gates can be reached from the other side of the map', () => {
    const st = createWorld();
    st.objects = st.objects.filter(o => o.type !== 'guard');
    st.players[0].heroes[0].mp = 99999;
    expect(findPath(st, 0, st.objects.find(o => o.id === 'town-hd')!.tile)).not.toBeNull();
  });

  it('the map AI makes the same choices from the same position', () => {
    const run = () => {
      const st = createWorld();
      const tiles: string[] = [];
      for (let turn = 0; turn < 12 && st.winner === null; turn++) {
        for (let i = 0; i < 4; i++) {
          const t = aiTarget(st);
          if (!t || st.encounter) break;
          const r = findPath(st, st.turn, t);
          if (!r) break;
          moveHero(st, r.path);
          if (st.encounter) resolveBattle(st, true, st.players[st.turn].heroes[0].army.map(a => a.count), []);
        }
        tiles.push(st.players.map(p => p.heroes[0].tile.join(',')).join('|'));
        endTurn(st);
      }
      return tiles.join(';');
    };
    expect(run()).toBe(run());
  });
});

describe('towns', () => {
  const rich = (st: WorldState) => { st.players[0].resources = { coin: 99999, timber: 999, iron: 999, provisions: 999 }; };

  it('one building per day, and prerequisites first', () => {
    const st = createWorld(); rich(st);
    expect(cannotBuild(st, 'town-fr', 'artillery')).toMatch(/Needs Marine Barracks/);
    expect(build(st, 'town-fr', 'barracks')).toBe(true);
    expect(cannotBuild(st, 'town-fr', 'sawmill')).toBe('Already built today');
    endTurn(st); endTurn(st);
    expect(build(st, 'town-fr', 'artillery')).toBe(true);
  });

  it('a branch closes the other choice', () => {
    const st = createWorld(); rich(st);
    build(st, 'town-fr', 'wharf'); endTurn(st); endTurn(st);
    expect(build(st, 'town-fr', 'military_dock')).toBe(true); endTurn(st); endTurn(st);
    expect(cannotBuild(st, 'town-fr', 'commercial_harbor')).toMatch(/Military Dock was chosen instead/);
  });

  it('dwellings unlock recruits and buildings pay income', () => {
    const st = createWorld(); rich(st);
    expect(recruit(st, 'town-fr', 'U-FR-03', 1)).toBe(false);
    build(st, 'town-fr', 'barracks');
    expect(recruit(st, 'town-fr', 'U-FR-03', 1)).toBe(true);
    endTurn(st); endTurn(st);
    build(st, 'town-fr', 'sawmill');
    const timber = st.players[0].resources.timber;
    endTurn(st); endTurn(st);
    expect(st.players[0].resources.timber).toBe(timber + 2);
  });

  it('a movement building speeds up the hero', () => {
    const st = createWorld(); rich(st);
    build(st, 'town-fr', 'wharf'); endTurn(st); endTurn(st);
    build(st, 'town-fr', 'military_dock'); endTurn(st); endTurn(st);
    expect(st.players[0].heroes[0].mp).toBe(st.players[0].heroes[0].mpMax + 50);
  });
});

describe('garrisons', () => {
  const rich = (st: WorldState) => { st.players[0].resources = { coin: 99999, timber: 999, iron: 999, provisions: 999 }; };

  it('building works with the hero far away', () => {
    const st = createWorld(); rich(st);
    teleport(st, 0, [20, 2]);
    expect(townHere(st, 0)).toBeUndefined();
    expect(cannotBuild(st, 'town-fr', 'barracks')).toBe('');
    expect(build(st, 'town-fr', 'barracks')).toBe(true);
  });

  it('recruiting with the hero far away fills the garrison, not the hero', () => {
    const st = createWorld(); rich(st);
    teleport(st, 0, [20, 2]);
    const heroArmy = JSON.stringify(st.players[0].heroes[0].army);
    expect(recruit(st, 'town-fr', 'U-FR-01', 3)).toBe(true);
    expect(JSON.stringify(st.players[0].heroes[0].army)).toBe(heroArmy);
    expect(st.objects.find(o => o.id === 'town-fr')!.army!.find(a => a.unit === 'U-FR-01')!.count).toBe(33);
    expect(recruit(st, 'town-hd', 'U-HD-01', 1)).toBe(false); // not your town
  });

  it('transfer needs the hero at the gate', () => {
    const st = createWorld();
    const town = st.objects.find(o => o.id === 'town-fr')!;
    teleport(st, 0, [20, 2]);
    expect(transfer(st, 'town-fr', 'garrison', 0, 5)).toBe(false);
    teleport(st, 0, [town.tile[0] + 1, town.tile[1] + 1]);
    const heroBefore = st.players[0].heroes[0].army.find(a => a.unit === 'U-FR-01')!.count;
    expect(transfer(st, 'town-fr', 'garrison', 0, 5)).toBe(true); // merges into the hero's U-FR-01
    expect(st.players[0].heroes[0].army.find(a => a.unit === 'U-FR-01')!.count).toBe(heroBefore + 5);
    expect(town.army![0].count).toBe(25);
    expect(transfer(st, 'town-fr', 'garrison', 0, 999)).toBe(false);
    expect(transfer(st, 'town-fr', 'hero', 0, 5)).toBe(true);
    expect(town.army![0].count).toBe(30);
  });

  it('stack limits and the hero keeping an army', () => {
    const st = createWorld(); rich(st);
    const town = st.objects.find(o => o.id === 'town-fr')!, hero = st.players[0].heroes[0];
    teleport(st, 0, [town.tile[0], town.tile[1] + 1]);
    town.army = ['U-FR-01', 'U-FR-02', 'U-FR-03', 'U-FR-04', 'U-FR-05', 'U-HD-01', 'U-HD-02'].map(unit => ({ unit, count: 3 }));
    expect(recruit(st, 'town-fr', 'U-FR-01', 1)).toBe(true); // merges even when full
    expect(town.army.length).toBe(7);
    town.stock!['U-NE-01'] = 5;
    expect(recruit(st, 'town-fr', 'U-NE-01', 1)).toBe(false); // an eighth stack
    hero.army = ['U-FR-01', 'U-FR-02', 'U-FR-03', 'U-FR-04', 'U-FR-05', 'U-HD-03', 'U-HD-04'].map(unit => ({ unit, count: 2 }));
    expect(transfer(st, 'town-fr', 'garrison', 5, 1)).toBe(false); // hero is full, new unit
    expect(transfer(st, 'town-fr', 'garrison', 0, 1)).toBe(true); // merge is fine
    hero.army = [{ unit: 'U-FR-01', count: 4 }];
    expect(transfer(st, 'town-fr', 'hero', 0, 4)).toBe(false); // the hero must keep an army
    expect(transfer(st, 'town-fr', 'hero', 0, 3)).toBe(true);
    expect(hero.army).toEqual([{ unit: 'U-FR-01', count: 1 }]);
  });

  it('garrisons no longer grow by themselves', () => {
    const st = createWorld();
    for (let i = 0; i < 16; i++) endTurn(st);
    const town = st.objects.find(o => o.id === 'town-fr')!;
    expect(town.army).toBeUndefined();
  });
});
