import { describe, expect, it } from 'vitest';
import {
  aiTarget, build, cannotBuild, createWorld, endTurn, findPath, guardsNear, moveHero, recruit, resolveBattle, terrainAt, townHere, type Tile, type WorldState,
} from '../src/sim/world';

const teleport = (st: WorldState, p: number, t: Tile) => { st.players[p].hero.tile = t; };

describe('adventure map', () => {
  it('the only ways across the river are the ford and the portage', () => {
    const st = createWorld();
    st.objects = st.objects.filter(o => o.type !== 'guard');
    st.players[0].hero.mp = 99999;
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
    expect(st.encounter).toEqual({ kind: 'guard', object: 'g-wolves' });
    expect(guardsNear(st, st.players[0].hero.tile).length).toBe(1);
  });

  it('beating guards removes them; losing sends the hero home', () => {
    const st = createWorld();
    st.encounter = { kind: 'guard', object: 'g-wolves' };
    resolveBattle(st, true, [20, 10, 8, 1], [0]);
    expect(st.objects.find(o => o.id === 'g-wolves')!.gone).toBe(true);
    st.encounter = { kind: 'guard', object: 'g-bear' };
    resolveBattle(st, false, [0, 0, 0, 0], [3]);
    expect(st.players[0].hero.defeated).toBe(true);
    endTurn(st); endTurn(st);
    expect(st.players[0].hero.defeated).toBe(false);
    expect(st.players[0].hero.tile).toEqual(st.players[0].hero.home);
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

  it('recruiting needs the hero at home and enough coin', () => {
    const st = createWorld();
    expect(townHere(st, 0)).toBeDefined();
    const coin = st.players[0].resources.coin;
    expect(recruit(st, 'U-FR-01', 5)).toBe(true);
    expect(st.players[0].resources.coin).toBe(coin - 150);
    expect(recruit(st, 'U-FR-05', 99)).toBe(false);
    teleport(st, 0, [20, 2]);
    expect(recruit(st, 'U-FR-01', 1)).toBe(false);
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
          if (st.encounter) resolveBattle(st, true, st.players[st.turn].hero.army.map(a => a.count), []);
        }
        tiles.push(st.players.map(p => p.hero.tile.join(',')).join('|'));
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
    expect(recruit(st, 'U-FR-03', 1)).toBe(false);
    build(st, 'town-fr', 'barracks');
    expect(recruit(st, 'U-FR-03', 1)).toBe(true);
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
    expect(st.players[0].hero.mp).toBe(st.players[0].hero.mpMax + 50);
  });
});
