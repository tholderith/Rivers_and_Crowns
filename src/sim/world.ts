// The adventure map: heroes, movement points, days and weeks, resources, fog of war,
// mines, pickups and guards. Pure and deterministic like the battle rules. When a hero
// runs into guards, a town or another hero, the world records a pending battle; the
// game plays it with the battle rules and reports the result back with `resolveBattle`.

import worldJson from '../data/world.json';
import buildingsJson from '../data/buildings.json';
import { UNITS } from './battle';

export interface BuildingDef {
  name: string;
  layer: string;
  cost: Partial<Record<Res, number>>;
  text: string;
  dwelling?: string[];
  income?: Partial<Record<Res, number>>;
  needs?: string[];
  branch?: string;
  replaces?: string;
  adds?: string;
  walls?: number;
  move?: number;
  reveal?: number;
  growth?: number;
  built?: boolean;
}
export const BUILDINGS = buildingsJson as unknown as Record<string, { town: string; base: string[]; buildings: Record<string, BuildingDef> }>;

export type Res = 'coin' | 'timber' | 'iron' | 'provisions';
export const RESOURCES: Res[] = ['coin', 'timber', 'iron', 'provisions'];
export type Tile = [number, number];
export interface ArmyStack { unit: string; count: number }

export interface WObject {
  id: string;
  type: 'town' | 'mine' | 'tower' | 'pickup' | 'guard';
  name?: string;
  faction?: string;
  kind?: string;
  tile: Tile;
  sprite: string;
  owner?: number | null;
  income?: Partial<Record<Res, number>>;
  give?: Partial<Record<Res, number>>;
  bonus?: 'command' | 'reveal';
  radius?: number;
  army?: ArmyStack[];
  stock?: Record<string, number>; // towns: units available to recruit this week
  built?: string[]; // towns: buildings standing
  builtDay?: number; // towns: the day something was last built (one per day)
  gone?: boolean;
}

export interface HeroState {
  name: string;
  portrait: string;
  sprite: string;
  tile: Tile;
  home: Tile;
  mp: number;
  mpMax: number;
  attack: number;
  defense: number;
  command: number;
  army: ArmyStack[];
  defeated: boolean;
}

export interface PlayerState {
  faction: string;
  name: string;
  resources: Record<Res, number>;
  hero: HeroState;
  explored: string[]; // "c,r" of tiles this player has seen
}

export type Encounter = { kind: 'guard'; object: string } | { kind: 'town'; object: string } | { kind: 'hero'; player: number };

export interface WorldState {
  seed: number; // varies the AI's choices between games
  day: number;
  turn: number; // whose turn: player index
  players: PlayerState[];
  objects: WObject[];
  terrain: string[];
  encounter: Encounter | null; // a battle waiting to be fought
  winner: number | null;
  log: string[];
}

export type WorldEvent =
  | { type: 'step'; player: number; tile: Tile }
  | { type: 'collect'; player: number; object: string; text: string }
  | { type: 'flag'; player: number; object: string }
  | { type: 'reveal'; player: number }
  | { type: 'town'; player: number; object: string }
  | { type: 'encounter'; player: number; encounter: Encounter }
  | { type: 'day'; day: number; income: Partial<Record<Res, number>>[] }
  | { type: 'turn'; player: number }
  | { type: 'win'; player: number };

const W = (worldJson as { terrain: string[] }).terrain[0].length;
const H = (worldJson as { terrain: string[] }).terrain.length;
export const MAP_W = W, MAP_H = H, TILE = 48;
const k = (t: Tile) => `${t[0]},${t[1]}`;
const sameTile = (a: Tile, b: Tile) => a[0] === b[0] && a[1] === b[1];
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

export const GARRISON: Record<string, ArmyStack[]> = {
  french: [{ unit: 'U-FR-01', count: 30 }, { unit: 'U-FR-03', count: 10 }, { unit: 'U-FR-04', count: 4 }],
  haudenosaunee: [{ unit: 'U-HD-01', count: 16 }, { unit: 'U-HD-03', count: 10 }, { unit: 'U-HD-02', count: 16 }],
};
const TOWN_INCOME: Partial<Record<Res, number>> = { coin: 500 };

// ------------------------------------------------------------------ setup

export function createWorld(seed = 1): WorldState {
  const wj = worldJson as unknown as { terrain: string[]; objects: WObject[]; players: { faction: string; name: string; hero: Omit<HeroState, 'mp' | 'mpMax' | 'army' | 'home' | 'defeated' | 'tile'> & { tile: Tile; move: number }; army: ArmyStack[]; resources: Record<Res, number> }[] };
  const st: WorldState = {
    seed, day: 1, turn: 0, terrain: [...wj.terrain], encounter: null, winner: null, log: [],
    objects: wj.objects.map(o => {
      const obj: WObject = { ...o, tile: [...o.tile] as Tile, owner: o.owner ?? null, army: o.army?.map(a => ({ ...a })) };
      if (o.type === 'town') {
        obj.built = Object.entries(BUILDINGS[o.faction!].buildings).filter(([, b]) => b.built).map(([id]) => id);
        obj.builtDay = 0;
        obj.stock = Object.fromEntries(available(obj).map(u => [u, GROWTH[o.faction!][u]]));
      }
      return obj;
    }),
    players: wj.players.map(p => ({
      faction: p.faction, name: p.name, resources: { ...p.resources }, explored: [],
      hero: {
        name: p.hero.name, portrait: p.hero.portrait, sprite: p.hero.sprite, tile: [...p.hero.tile] as Tile, home: [...p.hero.tile] as Tile,
        mp: p.hero.move * 10, mpMax: p.hero.move * 10, attack: p.hero.attack, defense: p.hero.defense, command: p.hero.command,
        army: p.army.map(a => ({ ...a })), defeated: false,
      },
    })),
  };
  st.players.forEach((_, i) => revealAround(st, i));
  return st;
}

// ------------------------------------------------------------------ terrain and movement

export const terrainAt = (st: WorldState, t: Tile): string => st.terrain[t[1]]?.[t[0]] ?? '~';
export const inMap = (t: Tile) => t[0] >= 0 && t[1] >= 0 && t[0] < W && t[1] < H;

/** Movement cost (in tenths of a point) to step onto a tile. */
export function stepCost(st: WorldState, faction: string, to: Tile, diagonal: boolean): number {
  const t = terrainAt(st, to);
  let c = t === '.' ? 20 : t === 'f' ? (faction === 'haudenosaunee' ? 20 : 30) : t === 'F' ? 40 : t === 'P' ? 50 : Infinity;
  if (diagonal) c = Math.round(c * 1.4);
  return c;
}

export const objectAt = (st: WorldState, t: Tile) => st.objects.find(o => !o.gone && sameTile(o.tile, t));
const heroAt = (st: WorldState, t: Tile, except?: number) => st.players.findIndex((p, i) => i !== except && !p.hero.defeated && sameTile(p.hero.tile, t));
/** Guards standing next to this tile; stepping here starts a fight. */
export const guardsNear = (st: WorldState, t: Tile) => st.objects.filter(o => o.type === 'guard' && !o.gone && cheb(o.tile, t) <= 1);

/** Cheapest path for a player's hero to a tile, or null. Objects and guard zones can only be the last step. */
export function findPath(st: WorldState, p: number, goal: Tile): { path: Tile[]; cost: number[] } | null {
  const hero = st.players[p].hero;
  if (!inMap(goal) || sameTile(goal, hero.tile)) return null;
  const faction = st.players[p].faction;
  const dist = new Map<string, number>([[k(hero.tile), 0]]);
  const prev = new Map<string, Tile>();
  const open: Tile[] = [hero.tile];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(k(open[i]))! < dist.get(k(open[bi]))!) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (sameTile(cur, goal)) break;
    const start = sameTile(cur, hero.tile);
    if (!start && (objectAt(st, cur) || heroAt(st, cur, p) >= 0)) continue;
    // inside a guard's zone you can only step onto the guard itself (to attack it)
    const zone = !start && guardsNear(st, cur).length > 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const n: Tile = [cur[0] + dx, cur[1] + dy];
      if (!inMap(n)) continue;
      if (zone && !(sameTile(n, goal) && objectAt(st, n)?.type === 'guard')) continue;
      const c = stepCost(st, faction, n, !!(dx && dy));
      if (!isFinite(c)) continue;
      const nd = dist.get(k(cur))! + c;
      if (nd < (dist.get(k(n)) ?? Infinity)) { dist.set(k(n), nd); prev.set(k(n), cur); open.push(n); }
    }
  }
  if (!dist.has(k(goal))) return null;
  const path: Tile[] = [];
  for (let t: Tile | undefined = goal; t && !sameTile(t, hero.tile); t = prev.get(k(t))) path.unshift(t);
  return { path, cost: path.map(t => dist.get(k(t))!) };
}

// ------------------------------------------------------------------ fog

function revealAround(st: WorldState, p: number, radius = 8, center?: Tile) {
  const pl = st.players[p];
  const set = new Set(pl.explored);
  const points: { c: Tile; r: number }[] = center ? [{ c: center, r: radius }] : [
    { c: pl.hero.tile, r: radius },
    ...st.objects.filter(o => o.owner === p).map(o => ({ c: o.tile, r: o.type === 'town' ? Math.max(9, ...townDefs(o).map(b => b.reveal ?? 0)) : 4 })),
  ];
  for (const { c, r } of points) {
    for (let y = c[1] - r; y <= c[1] + r; y++) for (let x = c[0] - r; x <= c[0] + r; x++) {
      if (inMap([x, y]) && (x - c[0]) ** 2 + (y - c[1]) ** 2 <= r * r + r) set.add(`${x},${y}`);
    }
  }
  pl.explored = [...set];
}

export const isExplored = (st: WorldState, p: number, t: Tile) => st.players[p].explored.includes(k(t));

// ------------------------------------------------------------------ actions

function addRes(pl: PlayerState, give: Partial<Record<Res, number>>) {
  for (const r of RESOURCES) pl.resources[r] += give[r] ?? 0;
}
const resText = (g: Partial<Record<Res, number>>) => RESOURCES.filter(r => g[r]).map(r => `${g[r]} ${r}`).join(', ');

/** Walk the current hero along a path as far as movement allows, handling whatever it meets. */
export function moveHero(st: WorldState, path: Tile[]): WorldEvent[] {
  const p = st.turn, pl = st.players[p], hero = pl.hero;
  const events: WorldEvent[] = [];
  if (st.encounter || st.winner !== null || hero.defeated) return events;
  for (const t of path) {
    const diag = Math.abs(t[0] - hero.tile[0]) + Math.abs(t[1] - hero.tile[1]) === 2;
    const c = stepCost(st, pl.faction, t, diag);
    if (c > hero.mp) break;
    const obj = objectAt(st, t);
    const other = heroAt(st, t, p);
    if (other >= 0) { hero.mp -= c; st.encounter = { kind: 'hero', player: other }; events.push({ type: 'encounter', player: p, encounter: st.encounter }); break; }
    if (obj && obj.type === 'guard') { hero.mp -= c; st.encounter = { kind: 'guard', object: obj.id }; events.push({ type: 'encounter', player: p, encounter: st.encounter }); break; }
    if (obj && obj.type === 'town' && obj.owner !== p) { hero.mp -= c; st.encounter = { kind: 'town', object: obj.id }; events.push({ type: 'encounter', player: p, encounter: st.encounter }); break; }
    hero.mp -= c;
    if (obj) { visit(st, p, obj, events); break; } // visiting an object ends the walk next to it
    hero.tile = t;
    events.push({ type: 'step', player: p, tile: t });
    revealAround(st, p);
    const g = guardsNear(st, t)[0];
    if (g) { st.encounter = { kind: 'guard', object: g.id }; events.push({ type: 'encounter', player: p, encounter: st.encounter }); break; }
  }
  return events;
}

function visit(st: WorldState, p: number, o: WObject, events: WorldEvent[]) {
  const pl = st.players[p];
  if (o.type === 'pickup') {
    o.gone = true;
    if (o.give) addRes(pl, o.give);
    let text = o.give ? `Found ${resText(o.give)}.` : '';
    if (o.bonus === 'command') { pl.hero.command += 1; text += ' The dispatches carry new orders: +1 Command.'; }
    if (o.bonus === 'reveal') { revealAround(st, p, 60, [Math.floor(W / 2), Math.floor(H / 2)]); text += ' The chart reveals the whole basin.'; events.push({ type: 'reveal', player: p }); }
    st.log.push(`${pl.hero.name}: ${text.trim()}`);
    events.push({ type: 'collect', player: p, object: o.id, text: text.trim() });
  } else if (o.type === 'mine') {
    if (o.owner !== p) {
      o.owner = p;
      st.log.push(`${pl.name} take the ${o.name} (+${resText(o.income ?? {})} a day).`);
      events.push({ type: 'flag', player: p, object: o.id });
      revealAround(st, p);
    }
  } else if (o.type === 'tower') {
    revealAround(st, p, o.radius ?? 10, o.tile);
    st.log.push(`${pl.hero.name} climbs the ${o.name} and surveys the land.`);
    events.push({ type: 'reveal', player: p });
  } else if (o.type === 'town') {
    events.push({ type: 'town', player: p, object: o.id });
  }
}

/** The armies for the pending battle: [attacker, defender]. */
export function encounterArmies(st: WorldState): { defenderName: string; defenderFaction: string; army: ArmyStack[]; heroDefender?: number; terrain: string } {
  const e = st.encounter!;
  const hero = st.players[st.turn].hero;
  if (e.kind === 'hero') {
    const d = st.players[e.player];
    return { defenderName: d.name, defenderFaction: d.faction, army: d.hero.army, heroDefender: e.player, terrain: terrainAt(st, d.hero.tile) };
  }
  const o = st.objects.find(x => x.id === e.object)!;
  if (e.kind === 'town') {
    const army = (o.army ?? GARRISON[o.faction!]).map(a => ({ ...a }));
    if (o.built?.includes('artillery') && !army.some(a => a.unit === 'U-FR-05')) army.push({ unit: 'U-FR-05', count: 1 });
    return { defenderName: o.name!, defenderFaction: o.faction!, army, terrain: '.' };
  }
  return { defenderName: o.name!, defenderFaction: 'neutral', army: o.army!, terrain: terrainAt(st, o.tile) || terrainAt(st, hero.tile) };
}

/** Report the result of the pending battle. Survivors are counts in army order. */
export function resolveBattle(st: WorldState, attackerWon: boolean, attackerSurvivors: number[], defenderSurvivors: number[]): WorldEvent[] {
  const e = st.encounter;
  if (!e) return [];
  const p = st.turn, pl = st.players[p];
  const events: WorldEvent[] = [];
  const apply = (army: ArmyStack[], counts: number[]) => army.forEach((a, i) => { a.count = counts[i] ?? a.count; });
  apply(pl.hero.army, attackerSurvivors);
  pl.hero.army = pl.hero.army.filter(a => a.count > 0);
  if (e.kind === 'guard') {
    const o = st.objects.find(x => x.id === e.object)!;
    if (attackerWon) { o.gone = true; st.log.push(`${pl.hero.name} clears the ${o.name}.`); }
    else { apply(o.army!, defenderSurvivors); o.army = o.army!.filter(a => a.count > 0); if (!o.army.length) o.gone = true; }
  } else if (e.kind === 'town') {
    const o = st.objects.find(x => x.id === e.object)!;
    if (attackerWon) {
      o.owner = p;
      o.army = [];
      st.log.push(`${pl.name} capture ${o.name}!`);
      st.winner = p;
      events.push({ type: 'win', player: p });
    } else { o.army = (o.army ?? GARRISON[o.faction!]).map((a, i) => ({ ...a, count: defenderSurvivors[i] ?? a.count })).filter(a => a.count > 0); }
  } else {
    const d = st.players[e.player];
    if (attackerWon) defeatHero(st, e.player);
    else { apply(d.hero.army, defenderSurvivors); d.hero.army = d.hero.army.filter(a => a.count > 0); }
  }
  if (!attackerWon) defeatHero(st, p);
  st.encounter = null;
  return events;
}

function defeatHero(st: WorldState, p: number) {
  const h = st.players[p].hero;
  h.defeated = true;
  h.army = [];
  h.mp = 0;
  st.log.push(`${h.name} is beaten and falls back to ${st.players[p].faction === 'french' ? 'the fort' : 'town'}.`);
}

// ------------------------------------------------------------------ recruiting (until the full town screen)

const GROWTH: Record<string, Record<string, number>> = {
  french: { 'U-FR-01': 12, 'U-FR-02': 6, 'U-FR-03': 5, 'U-FR-04': 2, 'U-FR-05': 1 },
  haudenosaunee: { 'U-HD-01': 9, 'U-HD-02': 8, 'U-HD-03': 5, 'U-HD-04': 4, 'U-HD-05': 2 },
};
const TIER_COST = [0, 30, 60, 110, 200, 500];
export const unitCost = (unit: string) => TIER_COST[UNITS[unit].tier];

/** Building definitions standing in a town. */
export function townDefs(o: WObject): BuildingDef[] {
  const defs = BUILDINGS[o.faction ?? '']?.buildings ?? {};
  return (o.built ?? []).map(id => defs[id]).filter(Boolean);
}

/** Units a town can raise: its base unit plus whatever its dwellings allow. */
export function available(o: WObject): string[] {
  const set = new Set(BUILDINGS[o.faction!].base);
  for (const b of townDefs(o)) for (const u of b.dwelling ?? []) set.add(u);
  return [...set];
}

export function wallsOf(o: WObject): number {
  return Math.max(0, ...townDefs(o).map(b => b.walls ?? 0));
}

/** Why a building can't be built right now ('' if it can). */
export function cannotBuild(st: WorldState, townId: string, id: string): string {
  const o = st.objects.find(x => x.id === townId)!;
  const def = BUILDINGS[o.faction!].buildings[id];
  const pl = st.players[st.turn];
  if (o.owner !== st.turn) return 'Not your town';
  if (o.built!.includes(id)) return 'Built';
  const missing = (def.needs ?? []).filter(n => !o.built!.includes(n));
  if (missing.length) return `Needs ${missing.map(n => BUILDINGS[o.faction!].buildings[n].name).join(', ')}`;
  if (def.branch) {
    const rival = o.built!.find(b => b !== id && BUILDINGS[o.faction!].buildings[b].branch === def.branch);
    if (rival) return `${BUILDINGS[o.faction!].buildings[rival].name} was chosen instead`;
  }
  if (o.builtDay === st.day) return 'Already built today';
  const short = RESOURCES.filter(r => (def.cost[r] ?? 0) > pl.resources[r]);
  if (short.length) return `Not enough ${short.join(', ')}`;
  return '';
}

export function build(st: WorldState, townId: string, id: string): boolean {
  if (cannotBuild(st, townId, id)) return false;
  const o = st.objects.find(x => x.id === townId)!;
  const def = BUILDINGS[o.faction!].buildings[id];
  const pl = st.players[st.turn];
  for (const r of RESOURCES) pl.resources[r] -= def.cost[r] ?? 0;
  o.built!.push(id);
  o.builtDay = st.day;
  for (const u of def.dwelling ?? []) if (!(u in o.stock!)) o.stock![u] = GROWTH[o.faction!][u];
  if (def.reveal) revealAround(st, st.turn);
  st.log.push(`${pl.name} build the ${def.name} at ${o.name}.`);
  return true;
}

/** Extra hero movement a player gets from buildings in their towns. */
export function moveBonus(st: WorldState, p: number): number {
  return st.objects.filter(o => o.type === 'town' && o.owner === p).reduce((n, o) => n + townDefs(o).reduce((m, b) => m + (b.move ?? 0), 0), 0);
}

/** The town a player's hero is standing next to, if it is theirs. */
export function townHere(st: WorldState, p: number): WObject | undefined {
  const h = st.players[p].hero;
  return st.objects.find(o => o.type === 'town' && o.owner === p && cheb(o.tile, h.tile) <= 1);
}

export function recruit(st: WorldState, unit: string, n: number): boolean {
  const p = st.turn, pl = st.players[p], town = townHere(st, p);
  if (!town || !town.stock || n <= 0) return false;
  const have = town.stock[unit] ?? 0, cost = unitCost(unit) * n;
  if (n > have || cost > pl.resources.coin) return false;
  const slot = pl.hero.army.find(a => a.unit === unit);
  if (!slot && pl.hero.army.length >= 7) return false;
  town.stock[unit] = have - n;
  pl.resources.coin -= cost;
  if (slot) slot.count += n; else pl.hero.army.push({ unit, count: n });
  st.log.push(`${pl.name} recruit ${n} ${UNITS[unit].name}.`);
  return true;
}

export function endTurn(st: WorldState): WorldEvent[] {
  const events: WorldEvent[] = [];
  if (st.winner !== null || st.encounter) return events;
  st.turn = (st.turn + 1) % st.players.length;
  if (st.turn === 0) {
    st.day += 1;
    const income = st.players.map((pl, i) => {
      const got: Partial<Record<Res, number>> = {};
      for (const o of st.objects) if (o.owner === i) for (const r of RESOURCES) {
        let v = (o.type === 'town' ? TOWN_INCOME[r] : o.income?.[r]) ?? 0;
        if (o.type === 'town') v += townDefs(o).reduce((n, b) => n + (b.income?.[r] ?? 0), 0);
        if (v) got[r] = (got[r] ?? 0) + v;
      }
      addRes(pl, got);
      return got;
    });
    events.push({ type: 'day', day: st.day, income });
    if (dayOfWeek(st.day) === 1) {
      for (const o of st.objects) if (o.type === 'town') {
        o.army = (o.army ?? GARRISON[o.faction!]).map(a => ({ ...a, count: Math.ceil(a.count * 1.15) }));
      }
      for (const o of st.objects) if (o.type === 'town' && o.stock) {
        const bonus = 1 + townDefs(o).reduce((n, b) => n + (b.growth ?? 0), 0);
        for (const u of available(o)) o.stock[u] = (o.stock[u] ?? 0) + Math.round(GROWTH[o.faction!][u] * bonus);
      }
      st.log.push(`Week ${weekOf(st.day)} begins: new recruits gather in the towns.`);
    }
  }
  const pl = st.players[st.turn], h = pl.hero;
  if (h.defeated) {
    // a beaten hero musters again at home with a small band
    h.defeated = false;
    h.tile = [...h.home] as Tile;
    h.army = pl.faction === 'french' ? [{ unit: 'U-FR-01', count: 12 }, { unit: 'U-FR-02', count: 4 }] : [{ unit: 'U-HD-01', count: 8 }, { unit: 'U-HD-02', count: 6 }];
    st.log.push(`${h.name} musters a new band at home.`);
  }
  h.mp = h.mpMax + moveBonus(st, st.turn);
  revealAround(st, st.turn);
  events.push({ type: 'turn', player: st.turn });
  return events;
}

export const weekOf = (day: number) => Math.floor((day - 1) / 7) + 1;
export const dayOfWeek = (day: number) => ((day - 1) % 7) + 1;

export function armyPower(army: ArmyStack[]): number {
  return army.reduce((n, a) => { const u = UNITS[a.unit]; return n + a.count * u.hp * (u.dmg[0] + u.dmg[1]) / 2; }, 0);
}

// ------------------------------------------------------------------ AI

/** Pick where the current (AI) hero should go next, or null to end the turn. */
export function aiTarget(st: WorldState): Tile | null {
  const p = st.turn, pl = st.players[p], hero = pl.hero;
  if (hero.defeated || st.encounter) return null;
  const power = armyPower(hero.army);
  let best: { t: Tile; v: number } | null = null;
  const consider = (t: Tile, value: number) => {
    const r = findPath(st, p, t);
    if (!r) return;
    // a stable per-game, per-target nudge so AI games don't all play out the same way
    let h = Math.imul(st.seed ^ (t[0] * 73856093) ^ (t[1] * 19349663) ^ (p * 83492791), 2654435761) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    const v = value * (0.75 + 0.5 * (h / 4294967296)) / (r.cost[r.cost.length - 1] / 10 + 8);
    if (!best || v > best.v) best = { t, v };
  };
  for (const o of st.objects) {
    if (o.gone) continue;
    if (o.type === 'pickup') consider(o.tile, 30);
    else if (o.type === 'mine' && o.owner !== p) consider(o.tile, o.kind === 'coin' ? 70 : 45);
    else if (o.type === 'tower' && !isExplored(st, p, [o.tile[0] + 6, o.tile[1]])) consider(o.tile, 12);
    else if (o.type === 'guard' && power > armyPower(o.army!) * 1.6) consider(o.tile, 25);
    else if (o.type === 'town' && o.owner !== p && power > armyPower(o.army ?? GARRISON[o.faction!]) * 1.4) consider(o.tile, 400);
  }
  st.players.forEach((other, i) => {
    if (i !== p && !other.hero.defeated && power > armyPower(other.hero.army) * 1.4) consider(other.hero.tile, 120);
  });
  // go home to spend money on recruits
  const home = st.objects.find(o => o.type === 'town' && o.owner === p && o.stock);
  if (home && cheb(home.tile, hero.tile) > 1) {
    const buyable = Object.entries(home.stock!).reduce((n, [u, c]) => n + Math.min(c, Math.floor(pl.resources.coin / unitCost(u))) * UNITS[u].hp, 0);
    if (buyable > 60) consider(hero.home, Math.min(200, buyable / 3));
  }
  return best ? (best as { t: Tile }).t : null;
}

// ------------------------------------------------------------------ AI town management

const AI_BUILD_ORDER: Record<string, string[]> = {
  french: ['barracks', 'sawmill', 'wharf', 'artillery', 'commercial_harbor', 'warehouse', 'stone_rampart', 'watchtower'],
  haudenosaunee: ['three_sisters_fields', 'family_longhouses', 'trade_house', 'gunsmith_forge', 'storehouse', 'canoe_landing', 'fortified_palisade'],
};

/** The AI builds the first thing it can afford from its plan, then recruits if its hero is home. */
export function aiManageTowns(st: WorldState) {
  const p = st.turn;
  for (const o of st.objects) {
    if (o.type !== 'town' || o.owner !== p) continue;
    const next = (AI_BUILD_ORDER[o.faction!] ?? []).find(id => !cannotBuild(st, o.id, id));
    if (next) build(st, o.id, next);
  }
  const town = townHere(st, p);
  if (town?.stock) {
    const units = Object.keys(town.stock).sort((a, b) => UNITS[b].tier - UNITS[a].tier);
    for (const u of units) {
      const n = Math.min(town.stock[u], Math.floor(st.players[p].resources.coin / unitCost(u)));
      if (n > 0) recruit(st, u, n);
    }
  }
}
