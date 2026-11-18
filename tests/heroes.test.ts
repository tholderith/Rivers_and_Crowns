import { describe, expect, it } from 'vitest';
import {
  MAX_HEROES, ROUTE_DAYS, SKILL_IDS, aiChooseSkills, aiHeroes, aiManageTowns, aiTarget, battleHero, chooseSkill, createWorld, deserializeWorld, endTurn,
  findPath, grantXp, heroById, heroPool, hireCost, hireHero, isExplored, levelForXp, moveHero, moveMods, recruitAtVillage, resolveBattle, routeHold,
  selectHero, serializeWorld, signAgreement, stepCost, swapArmies, transfer, villageOffer, xpForLevel, type HeroState, type Tile, type WorldState,
} from '../src/sim/world';
import { begin, createCustomBattle, moraleOf, preview } from '../src/sim/battle';

const rich = (st: WorldState, p = 0) => { st.players[p].resources = { coin: 99999, timber: 999, iron: 999, provisions: 999 }; };
const nextDay = (st: WorldState) => { endTurn(st); endTurn(st); };
const hero0 = (st: WorldState, p = 0) => st.players[p].heroes[0];
const hireOne = (st: WorldState, id: string) => { expect(hireHero(st, 'town-fr', id)).toBe(true); return heroById(st, id)!.hero; };

describe('hiring heroes', () => {
  it('each faction starts with one hero and a pool of the other two', () => {
    const st = createWorld();
    expect(st.players[0].heroes.map(h => h.id)).toEqual(['fr-elise']);
    expect(heroPool(st, 0).map(h => h.id)).toEqual(['fr-antoine', 'fr-jb']);
    expect(st.players[1].heroes.map(h => h.id)).toEqual(['hd-captain']);
    expect(heroPool(st, 1).map(h => h.id)).toEqual(['hd-clanmother', 'hd-pathfinder']);
    expect(hero0(st).sprite).toBe('heroes/fr-elise');
    expect(Object.keys(hero0(st).skills)).toEqual(['leadership']);
  });

  it('costs 1500 coin and puts the hero beside the gate with a small army', () => {
    const st = createWorld(); rich(st);
    const town = st.objects.find(o => o.id === 'town-fr')!;
    const coin = st.players[0].resources.coin;
    const h = hireOne(st, 'fr-antoine');
    expect(st.players[0].resources.coin).toBe(coin - 1500);
    expect(Math.max(Math.abs(h.tile[0] - town.tile[0]), Math.abs(h.tile[1] - town.tile[1]))).toBeLessThanOrEqual(2);
    expect(h.tile).not.toEqual(hero0(st).tile);
    expect(h.army.length).toBe(2);
    const figures = h.army.reduce((n, a) => n + a.count, 0);
    expect(figures).toBeGreaterThanOrEqual(8);
    expect(figures).toBeLessThanOrEqual(12);
    expect(heroPool(st, 0).map(d => d.id)).toEqual(['fr-jb']);
    expect(h.mp).toBe(h.mpMax);
  });

  it('refuses when poor, at a town you do not own, or for a hero not in the pool', () => {
    const st = createWorld();
    st.players[0].resources.coin = 1499;
    expect(hireHero(st, 'town-fr', 'fr-antoine')).toBe(false);
    rich(st);
    expect(hireHero(st, 'town-hd', 'fr-antoine')).toBe(false);
    expect(hireHero(st, 'town-fr', 'fr-elise')).toBe(false); // already on the map
    expect(hireHero(st, 'town-fr', 'hd-clanmother')).toBe(false); // other faction
  });

  it('one hire per town per day, and at most three heroes', () => {
    const st = createWorld(); rich(st);
    hireOne(st, 'fr-antoine');
    expect(hireHero(st, 'town-fr', 'fr-jb')).toBe(false); // same town, same day
    nextDay(st);
    expect(hireHero(st, 'town-fr', 'fr-jb')).toBe(true);
    expect(st.players[0].heroes.length).toBe(MAX_HEROES);
    // a defeated hero goes back to the pool, but the cap still applies while three are out
    nextDay(st);
    st.objects.find(o => o.id === 'town-fr')!.hiredDay = 0;
    expect(hireHero(st, 'town-fr', 'fr-antoine')).toBe(false);
  });

  it('Diplomacy makes hiring cheaper', () => {
    const st = createWorld(); rich(st);
    hero0(st).skills.diplomacy = 2;
    expect(hireCost(st, 0)).toBe(1200);
    const coin = st.players[0].resources.coin;
    hireOne(st, 'fr-jb');
    expect(st.players[0].resources.coin).toBe(coin - 1200);
  });

  it('new heroes never land on a tile that is already taken', () => {
    const st = createWorld(); rich(st);
    const a = hireOne(st, 'fr-antoine');
    nextDay(st);
    const b = hireOne(st, 'fr-jb');
    const tiles = [hero0(st).tile, a.tile, b.tile].map(t => t.join(','));
    expect(new Set(tiles).size).toBe(3);
  });
});

describe('selecting and moving several heroes', () => {
  it('moveHero and findPath act on the active hero; each hero has its own movement', () => {
    const st = createWorld(); rich(st);
    const b = hireOne(st, 'fr-antoine');
    const a = hero0(st);
    expect(selectHero(st, 5)).toBe(false);
    expect(selectHero(st, -1)).toBe(false);
    expect(st.players[0].active).toBe(0);
    const goal: Tile = [a.tile[0] - 3, a.tile[1] - 5];
    const pa = findPath(st, 0, goal)!;
    moveHero(st, pa.path);
    expect(a.mp).toBeLessThan(a.mpMax);
    expect(b.mp).toBe(b.mpMax);
    expect(selectHero(st, 1)).toBe(true);
    expect(selectHero(st, 'fr-elise')).toBe(true);
    expect(selectHero(st, 'fr-antoine')).toBe(true);
    const from = [...b.tile] as Tile;
    const pb = findPath(st, 0, [from[0] + 2, from[1] + 3])!;
    moveHero(st, pb.path);
    expect(b.tile).not.toEqual(from);
    expect(b.mp).toBeLessThan(b.mpMax);
    const aMp = a.mp;
    nextDay(st);
    expect(a.mp).toBeGreaterThan(aMp);
    expect(a.mp).toBe(a.mpMax);
    expect(b.mp).toBe(b.mpMax);
  });

  it('other heroes block paths except as the last step, and walking into your own hero stops before it', () => {
    const st = createWorld(); rich(st);
    st.objects = st.objects.filter(o => o.type === 'town');
    const b = hireOne(st, 'fr-antoine');
    const a = hero0(st);
    a.tile = [8, 4]; b.tile = [10, 4];
    a.mp = 9999;
    const direct = findPath(st, 0, [12, 4])!;
    expect(direct.path.some(t => t[0] === 10 && t[1] === 4)).toBe(false); // goes around
    const onto = findPath(st, 0, [10, 4])!;
    expect(onto.path.at(-1)).toEqual([10, 4]);
    moveHero(st, onto.path);
    expect(a.tile).toEqual([9, 4]);
    expect(st.encounter).toBeNull();
    const mp = a.mp;
    moveHero(st, [[10, 4]]);
    expect(a.tile).toEqual([9, 4]);
    expect(a.mp).toBe(mp);
  });

  it('stepping onto an enemy hero is an encounter naming both heroes', () => {
    const st = createWorld();
    st.objects = st.objects.filter(o => o.type === 'town');
    const a = hero0(st), e = hero0(st, 1);
    a.tile = [8, 4]; e.tile = [10, 4];
    moveHero(st, [[9, 4], [10, 4]]);
    expect(st.encounter).toEqual({ kind: 'hero', attacker: 'fr-elise', player: 1, hero: 'hd-captain' });
  });

  it('every hero reveals the map around itself', () => {
    const st = createWorld(); rich(st);
    const b = hireOne(st, 'fr-jb');
    b.tile = [20, 3];
    endTurn(st); endTurn(st);
    expect(isExplored(st, 0, [20, 3])).toBe(true);
    expect(isExplored(st, 0, [27, 3])).toBe(true);
  });
});

describe('armies of several heroes', () => {
  it('transfer works with the hero at the gate, and a chosen hero can be named', () => {
    const st = createWorld(); rich(st);
    const b = hireOne(st, 'fr-antoine');
    const town = st.objects.find(o => o.id === 'town-fr')!;
    hero0(st).tile = [20, 2];
    expect(selectHero(st, 'fr-antoine')).toBe(true);
    expect(transfer(st, 'town-fr', 'garrison', 0, 5, 'fr-elise')).toBe(false); // that hero is away
    const before = b.army[0].count;
    b.tile = [town.tile[0], town.tile[1] + 1];
    expect(transfer(st, 'town-fr', 'garrison', 0, 5)).toBe(true);
    expect(b.army[0].count).toBe(before + 5);
    expect(town.army![0].count).toBe(25);
  });

  it('swapArmies merges stacks between adjacent heroes and each keeps a stack', () => {
    const st = createWorld(); rich(st);
    const b = hireOne(st, 'fr-antoine');
    const a = hero0(st);
    a.tile = [b.tile[0] + 1, b.tile[1]];
    const aMilitia = a.army.find(s => s.unit === 'U-FR-01')!.count;
    const bMilitia = b.army.find(s => s.unit === 'U-FR-01')!.count;
    expect(swapArmies(st, 'fr-elise', 'fr-antoine', 0, 5)).toBe(true);
    expect(a.army.find(s => s.unit === 'U-FR-01')!.count).toBe(aMilitia - 5);
    expect(b.army.find(s => s.unit === 'U-FR-01')!.count).toBe(bMilitia + 5);
    // not the last stack
    b.army = [{ unit: 'U-FR-01', count: 4 }];
    expect(swapArmies(st, 'fr-antoine', 'fr-elise', 0, 4)).toBe(false);
    expect(swapArmies(st, 'fr-antoine', 'fr-elise', 0, 3)).toBe(true);
    expect(b.army).toEqual([{ unit: 'U-FR-01', count: 1 }]);
    // must be adjacent
    a.tile = [b.tile[0] + 4, b.tile[1]];
    expect(swapArmies(st, 'fr-elise', 'fr-antoine', 0, 1)).toBe(false);
  });
});
describe('hero defeat', () => {
  const fight = (st: WorldState, id: string, won: boolean, counts: number[]) => {
    st.encounter = { kind: 'guard', attacker: id, object: 'g-bear' };
    return resolveBattle(st, won, counts, [3]);
  };

  it('a beaten hero leaves the map, loses its army and returns to the pool', () => {
    const st = createWorld(); rich(st);
    hireOne(st, 'fr-antoine');
    selectHero(st, 'fr-antoine');
    fight(st, 'fr-antoine', false, [0, 0]);
    expect(st.players[0].heroes.map(h => h.id)).toEqual(['fr-elise']);
    expect(st.players[0].active).toBe(0);
    expect(heroPool(st, 0).map(h => h.id)).toContain('fr-antoine');
    expect(st.winner).toBeNull();
    // and it can be hired again, from scratch
    nextDay(st);
    const again = hireOne(st, 'fr-antoine');
    expect(again.xp).toBe(0);
  });

  it('the active selection stays on the same hero when an earlier one falls', () => {
    const st = createWorld(); rich(st);
    hireOne(st, 'fr-antoine'); nextDay(st); hireOne(st, 'fr-jb');
    selectHero(st, 'fr-jb');
    fight(st, 'fr-elise', false, [0, 0, 0, 0]);
    expect(st.players[0].heroes[st.players[0].active].id).toBe('fr-jb');
  });

  it('a player with no heroes and no towns has lost; with a town they play on', () => {
    const st = createWorld();
    fight(st, 'fr-elise', false, [0, 0, 0, 0]);
    expect(st.players[0].heroes.length).toBe(0);
    expect(st.winner).toBeNull(); // still has the fort
    const st2 = createWorld();
    st2.objects.find(o => o.id === 'town-fr')!.owner = 1;
    fight(st2, 'fr-elise', false, [0, 0, 0, 0]);
    expect(st2.winner).toBe(1);
    expect(st2.winReason).toBe('elimination');
  });

  it('a hero beaten in a hero-vs-hero fight returns to the pool and the winner earns its hit points', () => {
    const st = createWorld();
    const a = hero0(st), d = hero0(st, 1);
    a.tile = [20, 2]; d.tile = [21, 2];
    d.army = [{ unit: 'U-HD-02', count: 10 }];
    st.encounter = { kind: 'hero', attacker: 'fr-elise', player: 1, hero: 'hd-captain' };
    resolveBattle(st, true, a.army.map(s => s.count), [0]);
    expect(st.players[1].heroes.length).toBe(0);
    expect(heroPool(st, 1).map(h => h.id)).toContain('hd-captain');
    expect(a.xp).toBe(50); // 10 bowmen x 5 hp
  });

  it('a defending hero that wins earns experience for the attackers it killed', () => {
    const st = createWorld();
    const a = hero0(st), d = hero0(st, 1);
    a.tile = [20, 2]; d.tile = [21, 2];
    a.army = [{ unit: 'U-FR-01', count: 10 }];
    d.army = [{ unit: 'U-HD-02', count: 10 }];
    st.encounter = { kind: 'hero', attacker: 'fr-elise', player: 1, hero: 'hd-captain' };
    resolveBattle(st, false, [0], [7]);
    expect(st.players[0].heroes.length).toBe(0);
    expect(d.xp).toBe(40); // 10 militia x 4 hp
    expect(d.army).toEqual([{ unit: 'U-HD-02', count: 7 }]);
  });
});

describe('experience, levels and skills', () => {
  it('level thresholds', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(xpForLevel)).toEqual([0, 1000, 2000, 3200, 4600, 6200, 8000, 10000]);
    expect(xpForLevel(9)).toBe(12000);
    expect(xpForLevel(10)).toBeGreaterThan(xpForLevel(9) * 1.15);
    expect(xpForLevel(10)).toBeLessThan(xpForLevel(9) * 1.25);
    expect(levelForXp(999)).toBe(1);
    expect(levelForXp(1000)).toBe(2);
    expect(levelForXp(4599)).toBe(4);
    expect(levelForXp(10000)).toBe(8);
  });

  it('a won battle gives the hit points of the killed; a lost one gives nothing', () => {
    const st = createWorld();
    st.encounter = { kind: 'guard', attacker: 'fr-elise', object: 'g-deserters' };
    resolveBattle(st, true, [20, 10, 8, 1], [0, 0]);
    expect(hero0(st).xp).toBe(14 * 5 + 6 * 5);
    const st2 = createWorld();
    rich(st2); hireOne(st2, 'fr-jb');
    st2.encounter = { kind: 'guard', attacker: 'fr-jb', object: 'g-bear' };
    resolveBattle(st2, false, [0, 0], [3]);
    expect(hero0(st2).xp).toBe(0);
  });

  it('level-ups raise one primary stat and queue a pair of skills', () => {
    const st = createWorld();
    const h = hero0(st);
    const sum = () => h.attack + h.defense + h.command;
    const s0 = sum();
    const ev = grantXp(st, 0, h, 1000);
    expect(h.level).toBe(2);
    expect(sum()).toBe(s0 + 1);
    expect(h.pendingSkills.length).toBe(1);
    expect(ev.some(e => e.type === 'level')).toBe(true);
    const [x, y] = h.pendingSkills[0];
    expect(SKILL_IDS).toContain(x);
    expect(SKILL_IDS).toContain(y);
    grantXp(st, 0, h, 5000); // 6000 xp: level 5
    expect(h.level).toBe(5);
    expect(h.pendingSkills.length).toBe(4);
    expect(sum()).toBe(s0 + 4);
  });

  it('level-ups are deterministic for a seed and vary with it', () => {
    const run = (seed: number) => { const st = createWorld(seed); grantXp(st, 0, hero0(st), 10000); const h = hero0(st); return JSON.stringify([h.attack, h.defense, h.command, h.pendingSkills]); };
    expect(run(3)).toBe(run(3));
    expect(new Set([1, 2, 3, 4, 5, 6].map(run)).size).toBeGreaterThan(1);
  });

  it('chooseSkill applies the first pending pair, validates the pick, and upgrades held skills', () => {
    const st = createWorld();
    const h = hero0(st);
    grantXp(st, 0, h, 2000); // level 3: two pairs
    expect(h.pendingSkills.length).toBe(2);
    const [first, second] = h.pendingSkills;
    const other = SKILL_IDS.find(s => !first.includes(s))!;
    expect(chooseSkill(st, h.id, other)).toBe(false);
    expect(h.pendingSkills.length).toBe(2);
    expect(chooseSkill(st, h.id, first[0])).toBe(true);
    expect(h.pendingSkills).toEqual([second]);
    expect(h.skills[first[0]]).toBe(first[0] === 'leadership' ? 2 : 1);
    expect(chooseSkill(st, 'nobody', 'tactics')).toBe(false);
  });

  it('pairs offer upgrades of held skills too, and never more than six skills or level 3', () => {
    const st = createWorld();
    const h = hero0(st);
    h.skills = { leadership: 3, tactics: 3, surgery: 1, scouting: 1, diplomacy: 2, logistics: 1 };
    for (let l = 2; l < 8; l++) grantXp(st, 0, h, xpForLevel(l) - h.xp);
    for (const pair of h.pendingSkills) for (const s of pair) {
      expect(['surgery', 'scouting', 'diplomacy', 'logistics']).toContain(s);
    }
    while (h.pendingSkills.length) chooseSkill(st, h.id, h.pendingSkills[0][0]);
    expect(Object.keys(h.skills).length).toBe(6);
    expect(Math.max(...Object.values(h.skills))).toBeLessThanOrEqual(3);
  });

  it('the AI prefers skills it holds, then the priority order', () => {
    const st = createWorld();
    const h = hero0(st);
    h.skills = { logistics: 1 };
    h.pendingSkills = [['tactics', 'logistics'], ['scouting', 'marksmanship'], ['diplomacy', 'surgery']];
    aiChooseSkills(st, 0);
    expect(h.pendingSkills).toEqual([]);
    expect(h.skills.logistics).toBe(2); // held beats the higher-priority tactics
    expect(h.skills.marksmanship).toBe(1); // priority: marksmanship before scouting
    expect(h.skills.surgery).toBe(1); // surgery before diplomacy
  });
});

describe('skill effects', () => {
  it('Pathfinding cuts the extra cost of forest and ford', () => {
    const st = createWorld();
    const h = hero0(st);
    const forest: Tile = [0, 0], ford: Tile = [12, 9];
    expect(st.terrain[0][0]).toBe('f');
    expect(st.terrain[9][12]).toBe('F');
    expect(stepCost(st, 'french', forest, false, moveMods(st, 0, h))).toBe(30);
    expect(stepCost(st, 'french', ford, false, moveMods(st, 0, h))).toBe(40);
    h.skills.pathfinding = 1;
    expect(stepCost(st, 'french', ford, false, moveMods(st, 0, h))).toBe(35);
    h.skills.pathfinding = 3;
    expect(stepCost(st, 'french', ford, false, moveMods(st, 0, h))).toBe(25);
    expect(stepCost(st, 'french', forest, false, moveMods(st, 0, h))).toBe(23);
    expect(stepCost(st, 'french', [6, 3], false, moveMods(st, 0, h))).toBe(20); // grass unchanged
  });

  it('Pathfinding really makes a walk cheaper', () => {
    const st = createWorld();
    st.objects = st.objects.filter(o => o.type === 'town');
    const h = hero0(st);
    h.tile = [10, 9]; h.mp = 99999;
    const goal: Tile = [18, 9];
    const base = findPath(st, 0, goal)!.cost.at(-1)!;
    h.skills.pathfinding = 3;
    expect(findPath(st, 0, goal)!.cost.at(-1)!).toBeLessThan(base);
  });

  it('Logistics adds movement, now and at each turn', () => {
    const st = createWorld();
    const h = hero0(st);
    expect(h.mpMax).toBe(220);
    h.pendingSkills = [['logistics', 'tactics']];
    expect(chooseSkill(st, h.id, 'logistics')).toBe(true);
    expect(h.mpMax).toBe(242); // +10%
    h.pendingSkills = [['logistics', 'tactics']]; chooseSkill(st, h.id, 'logistics');
    h.pendingSkills = [['logistics', 'tactics']]; chooseSkill(st, h.id, 'logistics');
    expect(h.mpMax).toBe(286); // +30%
    h.mp = 0;
    nextDay(st);
    expect(h.mp).toBe(286);
  });

  it('Scouting widens the sight radius', () => {
    const st = createWorld();
    const h = hero0(st);
    h.tile = [20, 3];
    endTurn(st); endTurn(st);
    expect(isExplored(st, 0, [20, 3 + 9])).toBe(false);
    h.skills.scouting = 2; // +3
    endTurn(st); endTurn(st);
    expect(isExplored(st, 0, [20, 3 + 11])).toBe(true);
  });

  it('Surgery returns part of the lost figures after a won battle, even whole stacks', () => {
    const st = createWorld();
    const h = hero0(st);
    h.army = [{ unit: 'U-FR-01', count: 40 }, { unit: 'U-FR-02', count: 10 }];
    h.skills.surgery = 2; // 20%
    st.encounter = { kind: 'guard', attacker: h.id, object: 'g-wolves' };
    resolveBattle(st, true, [20, 0], [0]);
    expect(h.army).toEqual([{ unit: 'U-FR-01', count: 24 }, { unit: 'U-FR-02', count: 2 }]);
    // nothing comes back after a loss
    const st2 = createWorld();
    st2.players[0].heroes[0].skills.surgery = 3;
    st2.encounter = { kind: 'guard', attacker: 'fr-elise', object: 'g-bear' };
    resolveBattle(st2, false, [0, 0, 0, 0], [3]);
    expect(st2.players[0].heroes.length).toBe(0);
  });
});

describe('battle bonuses', () => {
  const setup = (_st: null, bonus: { morale?: number; rangedBonus?: number; meleeBonus?: number }) => {
    const base = { name: 'x', portrait: 'x', attack: 0, defense: 0, command: 3 };
    const b = createCustomBattle('t', 5, { faction: 'french', name: 'A', hero: { ...base, ...bonus }, army: [{ unit: 'U-FR-01', count: 20 }, { unit: 'U-FR-04', count: 5 }] },
      { faction: 'haudenosaunee', name: 'B', hero: base, army: [{ unit: 'U-HD-04', count: 10 }] }, 'B-01', [], []);
    begin(b);
    return b;
  };

  it('defaults leave morale and damage exactly as before', () => {
    const a = setup(null, {}), b = setup(null, { morale: 0, rangedBonus: 0, meleeBonus: 0 });
    const [s1, t1] = [a.stacks.find(s => s.unit === 'U-FR-01')!, a.stacks.find(s => s.unit === 'U-HD-04')!];
    const [s2, t2] = [b.stacks.find(s => s.unit === 'U-FR-01')!, b.stacks.find(s => s.unit === 'U-HD-04')!];
    expect(moraleOf(a, s1)).toBe(moraleOf(b, s2));
    expect(preview(a, s1, t1, true).damage).toBe(preview(b, s2, t2, true).damage);
    expect(preview(a, s1, t1, false).damage).toBe(preview(b, s2, t2, false).damage);
  });

  it('Leadership raises morale (capped at +3)', () => {
    const a = setup(null, {}), b = setup(null, { morale: 2 }), c = setup(null, { morale: 9 });
    const at = (s: ReturnType<typeof setup>) => s.stacks.find(x => x.unit === 'U-FR-01')!;
    expect(moraleOf(b, at(b))).toBe(moraleOf(a, at(a)) + 2);
    expect(moraleOf(c, at(c))).toBe(3);
    const enemy = b.stacks.find(x => x.side === 1)!;
    expect(moraleOf(b, enemy)).toBe(0); // the other side is unaffected
  });

  it('Marksmanship raises ranged damage only, Tactics melee only', () => {
    const base = setup(null, {}), ms = setup(null, { rangedBonus: 0.3 }), tc = setup(null, { meleeBonus: 0.15 });
    const get = (s: ReturnType<typeof setup>) => [s.stacks.find(x => x.unit === 'U-FR-01')!, s.stacks.find(x => x.unit === 'U-HD-04')!] as const;
    const [b1, b2] = get(base), [m1, m2] = get(ms), [t1, t2] = get(tc);
    const ranged = preview(base, b1, b2, true).damage, melee = preview(base, b1, b2, false).damage;
    expect(preview(ms, m1, m2, true).damage).toBeCloseTo(ranged * 1.3, -0.5);
    expect(preview(ms, m1, m2, true).damage).toBeGreaterThan(ranged);
    expect(preview(ms, m1, m2, false).damage).toBe(melee);
    expect(preview(tc, t1, t2, false).damage).toBeGreaterThan(melee);
    expect(preview(tc, t1, t2, true).damage).toBe(ranged);
  });

  it('battleHero reports the hero fields with skill bonuses', () => {
    const st = createWorld();
    const h = hero0(st);
    expect(battleHero(st, h.id)).toMatchObject({ name: 'Élise Marchand', portrait: 'H-FR-01', attack: 1, defense: 1, command: 5, morale: 1, rangedBonus: 0, meleeBonus: 0 });
    h.skills = { leadership: 3, marksmanship: 2, tactics: 1 };
    expect(battleHero(st, h.id)).toMatchObject({ morale: 3, rangedBonus: 0.2, meleeBonus: 0.05 });
    expect(() => battleHero(st, 'nobody')).toThrow();
  });
});

describe('the independent village', () => {
  const near = (st: WorldState, p: number, h: HeroState) => { const v = st.objects.find(o => o.id === 'village')!; h.tile = [v.tile[0] - 1, v.tile[1]]; void p; return v; };

  it('stepping onto it is a village visit, and it blocks no route', () => {
    const st = createWorld();
    st.objects = st.objects.filter(o => o.type !== 'guard');
    const v = st.objects.find(o => o.id === 'village')!;
    expect(v.sprite).toBe('L-03/L-03-01');
    expect(v.name).toBe('Riverside Village');
    expect('.f').toContain(st.terrain[v.tile[1]][v.tile[0]]);
    const h = hero0(st); h.tile = [v.tile[0] - 2, v.tile[1]]; h.mp = 9999;
    const ev = moveHero(st, findPath(st, 0, v.tile)!.path);
    expect(ev.some(e => e.type === 'village' && e.object === 'village')).toBe(true);
    // the far side of the map stays reachable with the village in place
    h.tile = [5, 13]; h.mp = 99999;
    expect(findPath(st, 0, [33, 15])).not.toBeNull();
    expect(findPath(st, 0, [14, 22])).not.toBeNull();
  });

  it('an alliance costs 800 coin and 10 provisions, needs a hero there, and only one player can hold it', () => {
    const st = createWorld();
    rich(st); rich(st, 1);
    const v = st.objects.find(o => o.id === 'village')!;
    expect(signAgreement(st, 'village', 'alliance')).toBe(false); // nobody there
    near(st, 0, hero0(st));
    const offer = villageOffer(st, 'village', 0)!;
    expect(offer.alliance).toMatchObject({ cost: { coin: 800, provisions: 10 }, available: true });
    expect(isExplored(st, 0, [v.tile[0] + 10, v.tile[1]])).toBe(false);
    const coin = st.players[0].resources.coin, prov = st.players[0].resources.provisions;
    expect(signAgreement(st, 'village', 'alliance')).toBe(true);
    expect(st.players[0].resources.coin).toBe(coin - 800);
    expect(st.players[0].resources.provisions).toBe(prov - 10);
    expect(v.owner).toBe(0);
    expect(isExplored(st, 0, [v.tile[0] + 10, v.tile[1]])).toBe(true); // the village shares its sight
    expect(signAgreement(st, 'village', 'alliance')).toBe(false);
    endTurn(st);
    near(st, 1, hero0(st, 1));
    expect(villageOffer(st, 'village', 1)!.alliance.available).toBe(false);
    expect(signAgreement(st, 'village', 'alliance')).toBe(false);
    expect(v.owner).toBe(0);
  });

  it('Diplomacy discounts agreements', () => {
    const st = createWorld(); rich(st);
    hero0(st).skills.diplomacy = 3; // 50%
    near(st, 0, hero0(st));
    expect(villageOffer(st, 'village', 0)!.alliance.cost).toEqual({ coin: 400, provisions: 5 });
    expect(villageOffer(st, 'village', 0)!.guides.cost).toEqual({ coin: 150 });
  });

  it('the ally recruits the village warriors from a weekly stock, into the hero there', () => {
    const st = createWorld(); rich(st);
    const h = hero0(st);
    near(st, 0, h);
    expect(recruitAtVillage(st, 'village', 'U-HD-01', 1)).toBe(false); // not allied yet
    signAgreement(st, 'village', 'alliance');
    const v = st.objects.find(o => o.id === 'village')!;
    expect(v.stock).toEqual({ 'U-HD-01': 8, 'U-HD-02': 10 });
    const coin = st.players[0].resources.coin;
    expect(recruitAtVillage(st, 'village', 'U-HD-01', 8)).toBe(true);
    expect(st.players[0].resources.coin).toBe(coin - 8 * 30);
    expect(h.army.find(a => a.unit === 'U-HD-01')!.count).toBe(8);
    expect(recruitAtVillage(st, 'village', 'U-HD-01', 1)).toBe(false); // out of stock
    expect(recruitAtVillage(st, 'village', 'U-HD-02', 11)).toBe(false);
    expect(recruitAtVillage(st, 'village', 'U-HD-02', 10)).toBe(true);
    expect(recruitAtVillage(st, 'village', 'U-FR-01', 1)).toBe(false); // not on offer
    // a hero that is not there cannot recruit
    h.tile = [3, 3];
    expect(recruitAtVillage(st, 'village', 'U-HD-01', 1)).toBe(false);
    // the stock refills (not accumulates) when a new week begins
    for (let i = 0; i < 6; i++) nextDay(st);
    expect(v.stock).toEqual({ 'U-HD-01': 0, 'U-HD-02': 0 });
    nextDay(st);
    expect(st.day).toBe(8);
    expect(v.stock).toEqual({ 'U-HD-01': 8, 'U-HD-02': 10 });
  });

  it('trade works once a week per player', () => {
    const st = createWorld();
    near(st, 0, hero0(st));
    const r = st.players[0].resources;
    const [coin, prov, iron] = [r.coin, r.provisions, r.iron];
    expect(signAgreement(st, 'village', 'trade', 'provisions')).toBe(true);
    expect([r.coin, r.provisions]).toEqual([coin + 400, prov - 10]);
    expect(signAgreement(st, 'village', 'trade', 'iron')).toBe(false);
    expect(villageOffer(st, 'village', 0)!.trade.available).toBe(false);
    for (let i = 0; i < 7; i++) nextDay(st);
    expect(signAgreement(st, 'village', 'trade', 'iron')).toBe(true);
    expect(r.iron).toBe(iron + 4);
    // the other player's weekly trade is separate
    endTurn(st);
    near(st, 1, hero0(st, 1));
    expect(signAgreement(st, 'village', 'trade')).toBe(true);
  });

  it('trade refuses a deal you cannot pay for', () => {
    const st = createWorld();
    near(st, 0, hero0(st));
    st.players[0].resources.provisions = 9;
    expect(signAgreement(st, 'village', 'trade', 'provisions')).toBe(false);
    st.players[0].resources.coin = 299;
    expect(signAgreement(st, 'village', 'trade', 'iron')).toBe(false);
  });

  it('guides cost 300 and make forests grass-cost until the end of the week', () => {
    const st = createWorld();
    const h = hero0(st);
    near(st, 0, h);
    const coin = st.players[0].resources.coin;
    expect(stepCost(st, 'french', [0, 0], false, moveMods(st, 0, h))).toBe(30);
    expect(signAgreement(st, 'village', 'guides')).toBe(true);
    expect(st.players[0].resources.coin).toBe(coin - 300);
    expect(signAgreement(st, 'village', 'guides')).toBe(false);
    expect(stepCost(st, 'french', [0, 0], false, moveMods(st, 0, h))).toBe(20);
    expect(stepCost(st, 'french', [12, 9], false, moveMods(st, 0, h))).toBe(40); // fords unchanged
    for (let i = 0; i < 6; i++) nextDay(st); // day 7: still the same week
    expect(stepCost(st, 'french', [0, 0], false, moveMods(st, 0, h))).toBe(20);
    nextDay(st); // day 8
    expect(stepCost(st, 'french', [0, 0], false, moveMods(st, 0, h))).toBe(30);
  });
});

describe('holding the river routes', () => {
  const ids = ['ford-blockhouse', 'portage-camp', 'post-island'];
  const own = (st: WorldState, p: number | null, which = ids) => which.forEach(id => { st.objects.find(o => o.id === id)!.owner = p; });

  it('the outposts exist and pay 100 coin a day', () => {
    const st = createWorld();
    const ford = st.objects.find(o => o.id === 'ford-blockhouse')!, camp = st.objects.find(o => o.id === 'portage-camp')!;
    expect([ford.type, ford.kind, ford.sprite, ford.income]).toEqual(['mine', 'route', 'L-05/L-05-04', { coin: 100 }]);
    expect([camp.type, camp.kind, camp.sprite, camp.income]).toEqual(['mine', 'route', 'L-06/L-06-01', { coin: 100 }]);
    expect(st.objects.find(o => o.id === 'tower-east')).toBeUndefined();
    ford.owner = 0;
    const coin = st.players[0].resources.coin;
    nextDay(st);
    expect(st.players[0].resources.coin).toBe(coin + 500 + 100);
  });

  it('counts consecutive own turns, resets when one is lost, and wins after ROUTE_DAYS turns', () => {
    const st = createWorld();
    own(st, 0);
    expect(routeHold(st, 0)).toBe(0);
    for (let d = 1; d <= 3; d++) { nextDay(st); expect(routeHold(st, 0)).toBe(d); }
    expect(routeHold(st, 1)).toBe(0);
    own(st, 1, ['portage-camp']);
    nextDay(st);
    expect(routeHold(st, 0)).toBe(0);
    own(st, 0, ['portage-camp']);
    for (let d = 1; d < ROUTE_DAYS; d++) { nextDay(st); expect(routeHold(st, 0)).toBe(d); expect(st.winner).toBeNull(); }
    nextDay(st);
    expect(routeHold(st, 0)).toBe(ROUTE_DAYS);
    expect(st.winner).toBe(0);
    expect(st.winReason).toBe('routes');
    expect(endTurn(st)).toEqual([]); // the game is over
  });

  it('holding only two of the three does not count', () => {
    const st = createWorld();
    own(st, 0, ['ford-blockhouse', 'post-island']);
    for (let i = 0; i < 9; i++) nextDay(st);
    expect(routeHold(st, 0)).toBe(0);
    expect(st.winner).toBeNull();
  });

  it('flagging an outpost by walking onto it takes it over', () => {
    const st = createWorld();
    st.objects = st.objects.filter(o => o.type !== 'guard');
    const o = st.objects.find(x => x.id === 'ford-blockhouse')!;
    hero0(st).tile = [o.tile[0] - 2, o.tile[1]];
    const ev = moveHero(st, findPath(st, 0, o.tile)!.path);
    expect(ev.some(e => e.type === 'flag')).toBe(true);
    expect(o.owner).toBe(0);
  });

  it('the town win still works', () => {
    const st = createWorld();
    st.encounter = { kind: 'town', attacker: 'fr-elise', object: 'town-hd' };
    const ev = resolveBattle(st, true, [20, 10, 8, 1], [0, 0, 0]);
    expect(st.winner).toBe(0);
    expect(st.winReason).toBe('town');
    expect(ev.some(e => e.type === 'win')).toBe(true);
    expect(hero0(st).xp).toBeGreaterThan(0);
  });
});

describe('the AI with several heroes', () => {
  it('hires a second hero and orders its heroes, strongest first', () => {
    const st = createWorld();
    st.turn = 1;
    aiManageTowns(st);
    expect(st.players[1].heroes.length).toBe(2);
    const order = aiHeroes(st);
    expect(order.length).toBe(2);
    expect(order[0]).toBe('hd-captain');
    expect(hero0(st, 1).army.length).toBeGreaterThan(0);
  });

  it('aiTarget works on the active hero', () => {
    const st = createWorld();
    st.turn = 1;
    aiManageTowns(st);
    const t0 = aiTarget(st);
    selectHero(st, 1);
    const t1 = aiTarget(st);
    expect(t0).not.toBeNull();
    expect(t1).not.toBeNull();
  });

  it('the AI signs the alliance when a hero visits with the means', () => {
    const st = createWorld();
    st.turn = 1;
    st.players[1].resources = { coin: 5000, timber: 10, iron: 4, provisions: 20 };
    const v = st.objects.find(o => o.id === 'village')!;
    hero0(st, 1).tile = [v.tile[0] + 1, v.tile[1]];
    aiManageTowns(st);
    expect(v.owner).toBe(1);
  });
});

describe('save and load', () => {
  const play = (st: WorldState, turns: number) => {
    for (let t = 0; t < turns && st.winner === null; t++) {
      aiManageTowns(st);
      for (const id of aiHeroes(st)) {
        selectHero(st, id);
        for (let i = 0; i < 6; i++) {
          const target = aiTarget(st); if (!target || st.encounter) break;
          const r = findPath(st, st.turn, target); if (!r) break;
          if (!moveHero(st, r.path).length) break;
          if (st.encounter) { const pl = st.players[st.turn]; resolveBattle(st, true, pl.heroes[pl.active].army.map(a => a.count), []); }
        }
      }
      endTurn(st);
    }
  };

  it('round-trips a new world exactly', () => {
    const st = createWorld(7);
    const json = serializeWorld(st);
    expect(JSON.parse(json).version).toBe(1);
    const back = deserializeWorld(json);
    expect(back).toEqual(st);
    expect(serializeWorld(back)).toBe(json);
  });

  it('round-trips a game in progress, and both copies play on identically', () => {
    const st = createWorld(11);
    play(st, 14);
    expect(st.day).toBeGreaterThan(5);
    st.players[0].heroes[0].pendingSkills.push(['tactics', 'surgery']);
    const back = deserializeWorld(serializeWorld(st));
    expect(back).toEqual(st);
    play(st, 6); play(back, 6);
    expect(back).toEqual(st);
  });

  it('rejects unknown versions and junk with a clear error', () => {
    const st = createWorld();
    const bad = JSON.stringify({ version: 99, state: st });
    expect(() => deserializeWorld(bad)).toThrow(/version 99/);
    expect(() => deserializeWorld('{"state":{}}')).toThrow(/version/);
    expect(() => deserializeWorld('not json')).toThrow(/JSON/);
    expect(() => deserializeWorld(JSON.stringify({ version: 1, state: { day: 1 } }))).toThrow(/damaged|incomplete/);
  });
});
