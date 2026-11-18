// The adventure map: heroes, movement points, days and weeks, resources, fog of war,
// mines, pickups and guards. Pure and deterministic like the battle rules. When a hero
// runs into guards, a town or another hero, the world records a pending battle; the
// game plays it with the battle rules and reports the result back with `resolveBattle`.
//
// Several heroes per player (HoMM II style), experience and skills, an independent
// village, a second victory condition (hold the river routes) and save/load.

import worldJson from '../data/world.json';
import buildingsJson from '../data/buildings.json';
import skillsJson from '../data/skills.json';
import { UNITS, type Hero } from './battle';

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

// ------------------------------------------------------------------ skills

export interface SkillDef { name: string; values: number[]; hire?: number[]; text: string[] }
export const SKILLS = (skillsJson as unknown as { skills: Record<string, SkillDef> }).skills;
export const SKILL_IDS = Object.keys(SKILLS);
/** The AI's order of preference for skills it does not hold yet. */
export const SKILL_PRIORITY = (skillsJson as unknown as { priority: string[] }).priority;
export const MAX_SKILLS = 6;
export const MAX_SKILL_LEVEL = 3;

export interface WObject {
  id: string;
  type: 'town' | 'mine' | 'tower' | 'pickup' | 'guard' | 'village';
  name?: string;
  faction?: string;
  kind?: string;
  tile: Tile;
  sprite: string;
  owner?: number | null; // villages: the allied player
  income?: Partial<Record<Res, number>>;
  give?: Partial<Record<Res, number>>;
  bonus?: 'command' | 'reveal';
  radius?: number;
  army?: ArmyStack[];
  stock?: Record<string, number>; // towns: units available to recruit this week; village: warriors for the ally
  built?: string[]; // towns: buildings standing
  builtDay?: number; // towns: the day something was last built (one per day)
  hiredDay?: number; // towns: the day a hero was last hired here (one per day)
  gone?: boolean;
}

/** A hero as defined in world.json (the hire pool). */
export interface HeroDef {
  id: string;
  name: string;
  portrait: string;
  title: string;
  skill: string; // starting specialty
  lean: 'attack' | 'defense' | 'command'; // the stat that tends to rise on level up
  attack: number;
  defense: number;
  command: number;
  move: number;
}

export interface HeroState {
  id: string;
  name: string;
  portrait: string;
  sprite: string; // `heroes/<id>`
  title: string;
  lean: 'attack' | 'defense' | 'command';
  tile: Tile;
  home: Tile;
  mp: number;
  mpMax: number; // includes Logistics, excludes building bonuses
  moveBase: number; // before Logistics
  attack: number;
  defense: number;
  command: number;
  army: ArmyStack[];
  xp: number;
  level: number;
  skills: Record<string, number>; // skill id -> level 1..3
  pendingSkills: [string, string][]; // one pair of choices per level gained; the first is applied next
}

export interface PlayerState {
  faction: string;
  name: string;
  resources: Record<Res, number>;
  heroes: HeroState[]; // at most MAX_HEROES
  active: number; // index of the selected hero
  explored: string[]; // "c,r" of tiles this player has seen
  routeDays: number; // consecutive own turns that began holding all the route posts
  guidesUntil: number; // the village guides serve this player up to and including this day (0 = none)
  tradeWeek: number; // the week the player last traded with the village (0 = never)
}

export type Encounter =
  | { kind: 'guard'; attacker: string; object: string }
  | { kind: 'town'; attacker: string; object: string }
  | { kind: 'hero'; attacker: string; player: number; hero: string };

export type WinReason = 'town' | 'routes' | 'elimination';

export interface WorldState {
  seed: number; // varies the AI's choices between games
  day: number;
  turn: number; // whose turn: player index
  players: PlayerState[];
  objects: WObject[];
  terrain: string[];
  encounter: Encounter | null; // a battle waiting to be fought
  winner: number | null;
  winReason: WinReason | null;
  log: string[];
}

export type WorldEvent =
  | { type: 'step'; player: number; hero: string; tile: Tile }
  | { type: 'collect'; player: number; hero: string; object: string; text: string }
  | { type: 'flag'; player: number; hero: string; object: string }
  | { type: 'reveal'; player: number }
  | { type: 'town'; player: number; hero: string; object: string }
  | { type: 'village'; player: number; hero: string; object: string }
  | { type: 'encounter'; player: number; encounter: Encounter }
  | { type: 'level'; player: number; hero: string; level: number }
  | { type: 'defeat'; player: number; hero: string }
  | { type: 'day'; day: number; income: Partial<Record<Res, number>>[] }
  | { type: 'turn'; player: number }
  | { type: 'win'; player: number; how: WinReason };

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

export const MAX_HEROES = 3;
export const HIRE_COST = 1500;
export const ROUTE_OBJECTS = ['ford-blockhouse', 'portage-camp', 'post-island'];
export const ROUTE_DAYS = 4;
export const VILLAGE_STOCK: Record<string, number> = { 'U-HD-01': 8, 'U-HD-02': 10 };
export const ALLIANCE_COST: Partial<Record<Res, number>> = { coin: 800, provisions: 10 };
export const GUIDES_COST: Partial<Record<Res, number>> = { coin: 300 };
export const TRADE_DEALS = {
  provisions: { give: { provisions: 10 }, get: { coin: 400 } },
  iron: { give: { coin: 300 }, get: { iron: 4 } },
} as const satisfies Record<string, { give: Partial<Record<Res, number>>; get: Partial<Record<Res, number>> }>;
export type TradeDeal = keyof typeof TRADE_DEALS;
export type AgreementKind = 'alliance' | 'trade' | 'guides';

export const ROSTER = (worldJson as unknown as { heroes: Record<string, HeroDef[]> }).heroes;

// ------------------------------------------------------------------ setup

const hash01 = (...parts: (string | number)[]): number => {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

function makeHero(def: HeroDef, tile: Tile, army: ArmyStack[]): HeroState {
  const h: HeroState = {
    id: def.id, name: def.name, portrait: def.portrait, sprite: `heroes/${def.id}`, title: def.title, lean: def.lean,
    tile: [...tile] as Tile, home: [...tile] as Tile, mp: 0, mpMax: 0, moveBase: def.move * 10,
    attack: def.attack, defense: def.defense, command: def.command, army: army.map(a => ({ ...a })),
    xp: 0, level: 1, skills: { [def.skill]: 1 }, pendingSkills: [],
  };
  h.mpMax = maxMoveOf(h);
  h.mp = h.mpMax;
  return h;
}

export function createWorld(seed = 1): WorldState {
  const wj = worldJson as unknown as { terrain: string[]; objects: WObject[]; players: { faction: string; name: string; start: Tile; army: ArmyStack[]; resources: Record<Res, number> }[] };
  const st: WorldState = {
    seed, day: 1, turn: 0, terrain: [...wj.terrain], encounter: null, winner: null, winReason: null, log: [],
    objects: wj.objects.map(o => {
      const obj: WObject = { ...o, tile: [...o.tile] as Tile, owner: o.owner ?? null, army: o.army?.map(a => ({ ...a })), stock: o.stock ? { ...o.stock } : undefined };
      if (o.type === 'town') {
        obj.built = Object.entries(BUILDINGS[o.faction!].buildings).filter(([, b]) => b.built).map(([id]) => id);
        obj.builtDay = 0;
        obj.hiredDay = 0;
        obj.stock = Object.fromEntries(available(obj).map(u => [u, GROWTH[o.faction!][u]]));
      }
      return obj;
    }),
    players: wj.players.map(p => ({
      faction: p.faction, name: p.name, resources: { ...p.resources }, explored: [],
      heroes: [makeHero(ROSTER[p.faction][0], p.start, p.army)], active: 0,
      routeDays: 0, guidesUntil: 0, tradeWeek: 0,
    })),
  };
  st.players.forEach((_, i) => revealAround(st, i));
  return st;
}

// ------------------------------------------------------------------ heroes, skills, experience

/** The selected hero of a player (the current player by default). */
export const activeHero = (st: WorldState, p = st.turn): HeroState | undefined => st.players[p].heroes[st.players[p].active];

/** Find a hero anywhere on the map by id. */
export function heroById(st: WorldState, id: string): { player: number; hero: HeroState; index: number } | undefined {
  for (let player = 0; player < st.players.length; player++) {
    const index = st.players[player].heroes.findIndex(h => h.id === id);
    if (index >= 0) return { player, hero: st.players[player].heroes[index], index };
  }
  return undefined;
}

export const skillLevel = (hero: HeroState, skill: string): number => hero.skills[skill] ?? 0;
/** The numeric effect of a skill at the hero's level (0 if the hero lacks it). */
export const skillValue = (hero: HeroState, skill: string): number => {
  const l = skillLevel(hero, skill);
  return l > 0 ? SKILLS[skill].values[l - 1] : 0;
};

/** The best Diplomacy level among a player's heroes. */
const diplomacyLevel = (pl: PlayerState): number => Math.max(0, ...pl.heroes.map(h => skillLevel(h, 'diplomacy')));
/** Discount on village agreements (0..0.5) from Diplomacy. */
export const agreementDiscount = (st: WorldState, p: number): number => { const l = diplomacyLevel(st.players[p]); return l ? SKILLS.diplomacy.values[l - 1] : 0; };
/** Discount on hiring heroes (0..0.3) from Diplomacy. */
export const hireDiscount = (st: WorldState, p: number): number => { const l = diplomacyLevel(st.players[p]); return l ? SKILLS.diplomacy.hire![l - 1] : 0; };
/** What it costs this player to hire a hero. */
export const hireCost = (st: WorldState, p: number): number => Math.round(HIRE_COST * (1 - hireDiscount(st, p)));

const maxMoveOf = (h: HeroState) => Math.round(h.moveBase * (1 + skillValue(h, 'logistics')));
const sightOf = (h: HeroState) => 8 + (skillLevel(h, 'scouting') ? SKILLS.scouting.values[skillLevel(h, 'scouting') - 1] : 0);
/** Movement a hero gets at the start of its player's turn. */
export const maxMove = (st: WorldState, p: number, h: HeroState) => h.mpMax + moveBonus(st, p);

/** Experience needed to reach a level: 0, 1000, 2000, 3200, 4600, 6200, 8000, 10000, then +20% a step. */
const LEVEL_XP = [0, 1000, 2000, 3200, 4600, 6200, 8000, 10000];
export function xpForLevel(level: number): number {
  if (level <= LEVEL_XP.length) return LEVEL_XP[Math.max(1, level) - 1];
  let x = LEVEL_XP[LEVEL_XP.length - 1];
  for (let l = LEVEL_XP.length; l < level; l++) x = Math.round((x * 1.2) / 50) * 50;
  return x;
}
export function levelForXp(xp: number): number {
  let l = 1;
  while (l < 60 && xp >= xpForLevel(l + 1)) l++;
  return l;
}

/** Hit points of the figures in an army (what a battle is worth in experience). */
export const armyHp = (army: ArmyStack[]) => army.reduce((n, a) => n + a.count * UNITS[a.unit].hp, 0);

/** The two skills offered for a level-up: new ones or upgrades of held ones, chosen from the seed. */
function offerSkills(st: WorldState, hero: HeroState, level: number): [string, string] | null {
  const held = Object.keys(hero.skills).length;
  const cands = SKILL_IDS.filter(id => (hero.skills[id] ? hero.skills[id] < MAX_SKILL_LEVEL : held < MAX_SKILLS));
  if (!cands.length) return null;
  const first = cands.splice(Math.floor(hash01(st.seed, hero.id, level, 'skill-a') * cands.length), 1)[0];
  const second = cands.length ? cands[Math.floor(hash01(st.seed, hero.id, level, 'skill-b') * cands.length)] : first;
  return [first, second];
}

function levelUp(st: WorldState, p: number, hero: HeroState, events: WorldEvent[]) {
  hero.level += 1;
  // the stat comes from the hero's leaning half the time, else one of the others
  const stats = ['attack', 'defense', 'command'] as const;
  const others = stats.filter(s => s !== hero.lean);
  const r = hash01(st.seed, hero.id, hero.level, 'stat');
  const stat = r < 0.5 ? hero.lean : r < 0.75 ? others[0] : others[1];
  hero[stat] += 1;
  const pair = offerSkills(st, hero, hero.level);
  if (pair) hero.pendingSkills.push(pair);
  st.log.push(`${hero.name} reaches level ${hero.level} (+1 ${stat}).`);
  events.push({ type: 'level', player: p, hero: hero.id, level: hero.level });
}

/** Give a hero experience and handle any level-ups it earns. */
export function grantXp(st: WorldState, p: number, hero: HeroState, xp: number, events: WorldEvent[] = []): WorldEvent[] {
  if (xp <= 0) return events;
  hero.xp += Math.round(xp);
  while (hero.level < levelForXp(hero.xp)) levelUp(st, p, hero, events);
  return events;
}

const canTake = (hero: HeroState, skill: string) => !!SKILLS[skill] && (hero.skills[skill] ? hero.skills[skill] < MAX_SKILL_LEVEL : Object.keys(hero.skills).length < MAX_SKILLS);

/** Apply the hero's first pending pair of skills by picking one of them. A pair whose choices can no longer be taken is dropped (returns false). */
export function chooseSkill(st: WorldState, heroId: string, skill: string): boolean {
  const f = heroById(st, heroId);
  if (!f) return false;
  const hero = f.hero, pair = hero.pendingSkills[0];
  if (!pair || !pair.includes(skill)) return false;
  hero.pendingSkills.shift();
  if (!canTake(hero, skill)) return false;
  hero.skills[skill] = (hero.skills[skill] ?? 0) + 1;
  if (skill === 'logistics') { const mx = maxMoveOf(hero); hero.mp += mx - hero.mpMax; hero.mpMax = mx; }
  st.log.push(`${hero.name} learns ${SKILLS[skill].name} (level ${hero.skills[skill]}).`);
  if (skill === 'scouting') revealAround(st, f.player);
  return true;
}

/** The AI's pick from a pair: skills it already holds first, then the fixed priority order. */
function aiPickSkill(hero: HeroState, pair: [string, string]): string {
  const ok = pair.filter(s => canTake(hero, s));
  const options = ok.length ? ok : pair;
  const rank = (s: string) => (hero.skills[s] ? 0 : 100) + SKILL_PRIORITY.indexOf(s);
  return [...options].sort((a, b) => rank(a) - rank(b))[0];
}

/** Fields of a hero for a battle's `ArmySetup`, including its skill bonuses. */
export function battleHero(st: WorldState, heroId: string): Omit<Hero, 'commandMax'> {
  const f = heroById(st, heroId);
  if (!f) throw new Error(`no such hero: ${heroId}`);
  const h = f.hero;
  return {
    name: h.name, portrait: h.portrait, attack: h.attack, defense: h.defense, command: h.command,
    morale: skillValue(h, 'leadership'), rangedBonus: skillValue(h, 'marksmanship'), meleeBonus: skillValue(h, 'tactics'),
  };
}

/** Heroes this player can hire: their faction's pool minus those on the map. */
export function heroPool(st: WorldState, player: number): HeroDef[] {
  const pl = st.players[player];
  return (ROSTER[pl.faction] ?? []).filter(d => !pl.heroes.some(h => h.id === d.id));
}

/** Select the hero (by index or id) that `moveHero`, `findPath` and `transfer` act on. */
export function selectHero(st: WorldState, which: number | string): boolean {
  const pl = st.players[st.turn];
  const i = typeof which === 'string' ? pl.heroes.findIndex(h => h.id === which) : which;
  if (!Number.isInteger(i) || i < 0 || i >= pl.heroes.length) return false;
  pl.active = i;
  return true;
}

/** A free land tile near a town gate for a new hero, or null. */
function freeTileNear(st: WorldState, town: WObject): Tile | null {
  const cands: Tile[] = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const t: Tile = [town.tile[0] + dx, town.tile[1] + dy];
    if (!dx && !dy) continue;
    if (!inMap(t) || !'.f'.includes(terrainAt(st, t)) || inFootprint(town, t) || footprintTown(st, t)) continue;
    if (objectOn(st, t) || heroAt(st, t) || guardsNear(st, t).length) continue;
    cands.push(t);
  }
  // keep clear of other heroes so the newcomer doesn't stand on top of them
  const crowded = (t: Tile) => st.players.some(pl => pl.heroes.some(h => cheb(h.tile, t) <= 1));
  const rank = (t: Tile) => (crowded(t) ? 1000 : 0) + cheb(t, town.tile) * 100 - (t[1] - town.tile[1]) * 10 + Math.abs(t[0] - town.tile[0]);
  cands.sort((a, b) => rank(a) - rank(b));
  return cands[0] ?? null;
}

/** Hire a hero from the pool at one of your towns: coin, one hire per town per day, at most MAX_HEROES on the map. */
export function hireHero(st: WorldState, townId: string, heroId: string): boolean {
  const p = st.turn, pl = st.players[p];
  const town = st.objects.find(o => o.id === townId);
  if (!town || town.type !== 'town' || town.owner !== p || st.winner !== null) return false;
  if (pl.heroes.length >= MAX_HEROES || town.hiredDay === st.day) return false;
  const def = heroPool(st, p).find(d => d.id === heroId);
  const cost = hireCost(st, p);
  if (!def || pl.resources.coin < cost) return false;
  const tile = freeTileNear(st, town);
  if (!tile) return false;
  const tiers = Object.keys(GROWTH[pl.faction]).filter(u => UNITS[u].tier <= 2).sort((a, b) => UNITS[a].tier - UNITS[b].tier);
  const hero = makeHero(def, tile, [{ unit: tiers[0], count: 8 }, { unit: tiers[1], count: 4 }]);
  hero.mp = maxMove(st, p, hero);
  pl.resources.coin -= cost;
  town.hiredDay = st.day;
  pl.heroes.push(hero);
  revealAround(st, p);
  st.log.push(`${pl.name} hire ${hero.name} at ${town.name}.`);
  return true;
}

/** Remove a defeated hero: its army is lost and it returns to the faction's hire pool. */
function removeHero(st: WorldState, p: number, heroId: string, events: WorldEvent[]) {
  const pl = st.players[p];
  const i = pl.heroes.findIndex(h => h.id === heroId);
  if (i < 0) return;
  const [h] = pl.heroes.splice(i, 1);
  if (i < pl.active) pl.active -= 1;
  else if (i === pl.active) pl.active = 0;
  pl.active = Math.max(0, Math.min(pl.active, pl.heroes.length - 1));
  st.log.push(`${h.name} is beaten and leaves the field; the hero may be hired again.`);
  events.push({ type: 'defeat', player: p, hero: h.id });
  if (!pl.heroes.length && !st.objects.some(o => o.type === 'town' && !o.gone && o.owner === p) && st.winner === null) {
    st.winner = (p + 1) % st.players.length;
    st.winReason = 'elimination';
    events.push({ type: 'win', player: st.winner, how: 'elimination' });
  }
}

// ------------------------------------------------------------------ terrain and movement

export const terrainAt = (st: WorldState, t: Tile): string => st.terrain[t[1]]?.[t[0]] ?? '~';
export const inMap = (t: Tile) => t[0] >= 0 && t[1] >= 0 && t[0] < W && t[1] < H;

export interface MoveMods { pathfinding: number; guides: boolean }
/** The movement modifiers of a hero: its Pathfinding skill and the village guides. */
export function moveMods(st: WorldState, p: number, hero: HeroState): MoveMods {
  return { pathfinding: skillValue(hero, 'pathfinding'), guides: st.day <= st.players[p].guidesUntil };
}

/** Movement cost (in tenths of a point) to step onto a tile. */
export function stepCost(st: WorldState, faction: string, to: Tile, diagonal: boolean, mods?: MoveMods): number {
  const t = terrainAt(st, to);
  let c = t === '.' ? 20 : t === 'f' ? (faction === 'haudenosaunee' || mods?.guides ? 20 : 30) : t === 'F' ? 40 : t === 'P' ? 50 : Infinity;
  if (mods?.pathfinding && (t === 'f' || t === 'F')) c = Math.round(20 + (c - 20) * (1 - mods.pathfinding));
  if (diagonal) c = Math.round(c * 1.4);
  return c;
}

/** The tiles a town covers: 6 wide x 4 tall, the entrance (the town's own tile) at the bottom centre, excluded. */
export function townFootprint(o: WObject): Tile[] {
  const out: Tile[] = [];
  for (let r = o.tile[1] - 3; r <= o.tile[1]; r++) for (let c = o.tile[0] - 3; c <= o.tile[0] + 2; c++) {
    if (c !== o.tile[0] || r !== o.tile[1]) out.push([c, r]);
  }
  return out;
}
const inFootprint = (o: WObject, t: Tile) => t[0] >= o.tile[0] - 3 && t[0] <= o.tile[0] + 2 && t[1] >= o.tile[1] - 3 && t[1] <= o.tile[1] && !sameTile(o.tile, t);
const towns = (st: WorldState) => st.objects.filter(o => o.type === 'town' && !o.gone);
/** The town whose footprint (not entrance) covers this tile. */
const footprintTown = (st: WorldState, t: Tile) => towns(st).find(o => inFootprint(o, t));
/** The object standing exactly on this tile (a town's entrance counts, its footprint does not). */
const objectOn = (st: WorldState, t: Tile) => st.objects.find(o => !o.gone && sameTile(o.tile, t));
/** The object at a tile; any tile of a town's footprint returns the town (for tooltips). */
export const objectAt = (st: WorldState, t: Tile) => objectOn(st, t) ?? footprintTown(st, t);
/** The hero standing on a tile (any player's), other than `except`. */
const heroAt = (st: WorldState, t: Tile, except?: HeroState): { player: number; hero: HeroState } | undefined => {
  for (let player = 0; player < st.players.length; player++) {
    const hero = st.players[player].heroes.find(h => h !== except && sameTile(h.tile, t));
    if (hero) return { player, hero };
  }
  return undefined;
};
/** Guards standing next to this tile; stepping here starts a fight. */
export const guardsNear = (st: WorldState, t: Tile) => st.objects.filter(o => o.type === 'guard' && !o.gone && cheb(o.tile, t) <= 1);

/** Cheapest path for a player's active hero to a tile, or null. Objects, other heroes (yours too) and guard zones can only be the last step. */
export function findPath(st: WorldState, p: number, goal: Tile): { path: Tile[]; cost: number[] } | null {
  const hero = activeHero(st, p);
  if (!hero || !inMap(goal)) return null;
  const mods = moveMods(st, p, hero);
  const fpTown = footprintTown(st, goal);
  if (fpTown) goal = fpTown.tile; // aiming at the body of a town means heading for its gate
  if (sameTile(goal, hero.tile)) return null;
  const faction = st.players[p].faction;
  const dist = new Map<string, number>([[k(hero.tile), 0]]);
  const prev = new Map<string, Tile>();
  const open: Tile[] = [hero.tile];
  // per-search lookups: scanning every object at every node is what made searches slow
  const objAt = new Map<string, WObject>(), zoneAt = new Set<string>(), body = new Set<string>(), heroTiles = new Set<string>();
  for (const o of st.objects) {
    if (o.gone) continue;
    if (!objAt.has(k(o.tile))) objAt.set(k(o.tile), o);
    if (o.type === 'town') for (const f of townFootprint(o)) body.add(k(f));
    if (o.type === 'guard') for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) zoneAt.add(k([o.tile[0] + x, o.tile[1] + y]));
  }
  for (const pl of st.players) for (const h of pl.heroes) if (h !== hero) heroTiles.add(k(h.tile));
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(k(open[i]))! < dist.get(k(open[bi]))!) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (sameTile(cur, goal)) break;
    const start = sameTile(cur, hero.tile);
    if (!start && (objAt.has(k(cur)) || heroTiles.has(k(cur)))) continue;
    // inside a guard's zone you can only step onto the guard itself (to attack it)
    const zone = !start && zoneAt.has(k(cur));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const n: Tile = [cur[0] + dx, cur[1] + dy];
      if (!inMap(n) || body.has(k(n))) continue;
      if (zone && !(sameTile(n, goal) && objAt.get(k(n))?.type === 'guard')) continue;
      const c = stepCost(st, faction, n, !!(dx && dy), mods);
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
    ...pl.heroes.map(h => ({ c: h.tile, r: sightOf(h) })),
    ...st.objects.filter(o => o.owner === p && !o.gone).map(o => ({ c: o.tile, r: o.type === 'town' ? Math.max(9, ...townDefs(o).map(b => b.reveal ?? 0)) : o.type === 'village' ? 10 : 4 })),
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

/** Walk the active hero along a path as far as its movement allows, handling whatever it meets. */
export function moveHero(st: WorldState, path: Tile[]): WorldEvent[] {
  const p = st.turn, pl = st.players[p], hero = pl.heroes[pl.active];
  const events: WorldEvent[] = [];
  if (!hero || st.encounter || st.winner !== null) return events;
  const mods = moveMods(st, p, hero);
  for (const t of path) {
    const diag = Math.abs(t[0] - hero.tile[0]) + Math.abs(t[1] - hero.tile[1]) === 2;
    const c = stepCost(st, pl.faction, t, diag, mods);
    if (c > hero.mp || footprintTown(st, t)) break;
    const obj = objectOn(st, t);
    const other = heroAt(st, t, hero);
    if (other) {
      if (other.player === p) break; // your own hero: stop before it
      hero.mp -= c;
      st.encounter = { kind: 'hero', attacker: hero.id, player: other.player, hero: other.hero.id };
      events.push({ type: 'encounter', player: p, encounter: st.encounter });
      break;
    }
    if (obj && obj.type === 'guard') { hero.mp -= c; st.encounter = { kind: 'guard', attacker: hero.id, object: obj.id }; events.push({ type: 'encounter', player: p, encounter: st.encounter }); break; }
    if (obj && obj.type === 'town' && obj.owner !== p) { hero.mp -= c; st.encounter = { kind: 'town', attacker: hero.id, object: obj.id }; events.push({ type: 'encounter', player: p, encounter: st.encounter }); break; }
    hero.mp -= c;
    if (obj) { visit(st, p, hero, obj, events); break; } // visiting an object ends the walk next to it
    hero.tile = t;
    events.push({ type: 'step', player: p, hero: hero.id, tile: t });
    revealAround(st, p);
    const g = guardsNear(st, t)[0];
    if (g) { st.encounter = { kind: 'guard', attacker: hero.id, object: g.id }; events.push({ type: 'encounter', player: p, encounter: st.encounter }); break; }
  }
  return events;
}

function visit(st: WorldState, p: number, hero: HeroState, o: WObject, events: WorldEvent[]) {
  const pl = st.players[p];
  if (o.type === 'pickup') {
    o.gone = true;
    if (o.give) addRes(pl, o.give);
    let text = o.give ? `Found ${resText(o.give)}.` : '';
    if (o.bonus === 'command') { hero.command += 1; text += ' The dispatches carry new orders: +1 Command.'; }
    if (o.bonus === 'reveal') { revealAround(st, p, 60, [Math.floor(W / 2), Math.floor(H / 2)]); text += ' The chart reveals the whole basin.'; events.push({ type: 'reveal', player: p }); }
    st.log.push(`${hero.name}: ${text.trim()}`);
    events.push({ type: 'collect', player: p, hero: hero.id, object: o.id, text: text.trim() });
  } else if (o.type === 'mine') {
    if (o.owner !== p) {
      o.owner = p;
      st.log.push(`${pl.name} take the ${o.name} (+${resText(o.income ?? {})} a day).`);
      events.push({ type: 'flag', player: p, hero: hero.id, object: o.id });
      revealAround(st, p);
    }
  } else if (o.type === 'tower') {
    revealAround(st, p, o.radius ?? 10, o.tile);
    st.log.push(`${hero.name} climbs the ${o.name} and surveys the land.`);
    events.push({ type: 'reveal', player: p });
  } else if (o.type === 'town') {
    events.push({ type: 'town', player: p, hero: hero.id, object: o.id });
  } else if (o.type === 'village') {
    st.log.push(`${hero.name} reaches ${o.name}.`);
    events.push({ type: 'village', player: p, hero: hero.id, object: o.id });
  }
}

/** The defender of the pending battle (the attacker is the hero named by `attacker`). */
export function encounterArmies(st: WorldState): { defenderName: string; defenderFaction: string; army: ArmyStack[]; heroDefender?: number; defenderHero?: string; attacker: string; terrain: string } {
  const e = st.encounter!;
  const pl = st.players[st.turn];
  const hero = pl.heroes.find(h => h.id === e.attacker) ?? pl.heroes[pl.active];
  if (e.kind === 'hero') {
    const d = st.players[e.player];
    const dh = d.heroes.find(h => h.id === e.hero) ?? d.heroes[d.active];
    return { defenderName: d.name, defenderFaction: d.faction, army: dh.army, heroDefender: e.player, defenderHero: dh.id, attacker: hero.id, terrain: terrainAt(st, dh.tile) };
  }
  const o = st.objects.find(x => x.id === e.object)!;
  if (e.kind === 'town') {
    const army = garrisonOf(o).map(a => ({ ...a }));
    if (o.built?.includes('artillery') && !army.some(a => a.unit === 'U-FR-05')) army.push({ unit: 'U-FR-05', count: 1 });
    return { defenderName: o.name!, defenderFaction: o.faction!, army, attacker: hero.id, terrain: '.' };
  }
  return { defenderName: o.name!, defenderFaction: 'neutral', army: o.army!, attacker: hero.id, terrain: terrainAt(st, o.tile) || terrainAt(st, hero.tile) };
}

/** Report the result of the pending battle. Survivors are counts in army order. Winners earn experience, and Surgery returns some of the fallen. */
export function resolveBattle(st: WorldState, attackerWon: boolean, attackerSurvivors: number[], defenderSurvivors: number[]): WorldEvent[] {
  const e = st.encounter;
  if (!e) return [];
  const p = st.turn, pl = st.players[p];
  const events: WorldEvent[] = [];
  const att = pl.heroes.find(h => h.id === e.attacker) ?? pl.heroes[pl.active];
  if (!att) { st.encounter = null; return events; }
  const def = encounterArmies(st);
  const defHero = e.kind === 'hero' ? st.players[e.player].heroes.find(h => h.id === def.defenderHero) : undefined;
  const attBefore = att.army.map(a => ({ ...a }));
  const defBefore = def.army.map(a => ({ ...a }));
  // experience: the hit points of the figures the winner killed (a won attack clears the defenders)
  const fallen = (before: ArmyStack[], counts: number[]) => armyHp(before.map((a, i) => ({ unit: a.unit, count: Math.max(0, a.count - (counts[i] ?? a.count)) })));
  const apply = (army: ArmyStack[], counts: number[]) => army.forEach((a, i) => { a.count = counts[i] ?? a.count; });
  /** Surgery: some of the winner's fallen figures return. */
  const surgery = (hero: HeroState, before: ArmyStack[]) => {
    const pct = skillValue(hero, 'surgery');
    if (!pct) return;
    hero.army.forEach((a, i) => { a.count += Math.round((before[i].count - a.count) * pct); });
  };
  apply(att.army, attackerSurvivors);
  const xpAtt = attackerWon ? armyHp(defBefore) : 0;
  const xpDef = !attackerWon && defHero ? fallen(attBefore, attackerSurvivors) : 0;
  if (attackerWon) surgery(att, attBefore);
  att.army = att.army.filter(a => a.count > 0);
  if (e.kind === 'guard') {
    const o = st.objects.find(x => x.id === e.object)!;
    if (attackerWon) { o.gone = true; st.log.push(`${att.name} clears the ${o.name}.`); }
    else { apply(o.army!, defenderSurvivors); o.army = o.army!.filter(a => a.count > 0); if (!o.army.length) o.gone = true; }
  } else if (e.kind === 'town') {
    const o = st.objects.find(x => x.id === e.object)!;
    if (attackerWon) {
      o.owner = p;
      o.army = [];
      st.log.push(`${pl.name} capture ${o.name}!`);
      st.winner = p;
      st.winReason = 'town';
      events.push({ type: 'win', player: p, how: 'town' });
    } else { o.army = garrisonOf(o).map((a, i) => ({ ...a, count: defenderSurvivors[i] ?? a.count })).filter(a => a.count > 0); }
  } else if (defHero) {
    if (attackerWon) removeHero(st, e.player, defHero.id, events);
    else {
      apply(defHero.army, defenderSurvivors);
      surgery(defHero, defBefore);
      defHero.army = defHero.army.filter(a => a.count > 0);
    }
  }
  if (attackerWon) grantXp(st, p, att, xpAtt, events);
  else if (defHero && xpDef > 0) grantXp(st, e.kind === 'hero' ? e.player : p, defHero, xpDef, events);
  if (!attackerWon) removeHero(st, p, att.id, events);
  st.encounter = null;
  return events;
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

/** The town garrison, initialised from the starting garrison the first time it is touched. */
export function garrisonOf(o: WObject): ArmyStack[] {
  if (!o.army) o.army = GARRISON[o.faction!].map(a => ({ ...a }));
  return o.army;
}
export const MAX_STACKS = 7;

/** The town of this player whose gate the given hero (default: the active one) is standing at, if any. */
export function townHere(st: WorldState, p: number, hero: HeroState | undefined = activeHero(st, p)): WObject | undefined {
  if (!hero) return undefined;
  return st.objects.find(o => o.type === 'town' && o.owner === p && cheb(o.tile, hero.tile) <= 1);
}

/** A hero of the player standing next to a tile: the one asked for, else the active one, else the first. */
function heroNear(st: WorldState, p: number, t: Tile, heroId?: string): HeroState | undefined {
  const pl = st.players[p];
  const near = pl.heroes.filter(h => cheb(h.tile, t) <= 1);
  if (heroId) return near.find(h => h.id === heroId);
  return near.find(h => h === pl.heroes[pl.active]) ?? near[0];
}

/** Buy units from a town's weekly stock into its garrison. The hero need not be there. */
export function recruit(st: WorldState, townId: string, unit: string, n: number): boolean {
  const p = st.turn, pl = st.players[p];
  const town = st.objects.find(o => o.id === townId);
  if (!town || town.type !== 'town' || town.owner !== p || !town.stock || !Number.isInteger(n) || n <= 0) return false;
  const have = town.stock[unit] ?? 0, cost = unitCost(unit) * n;
  if (n > have || cost > pl.resources.coin) return false;
  const garrison = garrisonOf(town);
  const slot = garrison.find(a => a.unit === unit);
  if (!slot && garrison.length >= MAX_STACKS) return false;
  town.stock[unit] = have - n;
  pl.resources.coin -= cost;
  if (slot) slot.count += n; else garrison.push({ unit, count: n });
  st.log.push(`${pl.name} recruit ${n} ${UNITS[unit].name} at ${town.name}.`);
  return true;
}

/** Move troops between a town's garrison and a hero's army. Needs the hero at the gate (the active one unless `heroId` names another). */
export function transfer(st: WorldState, townId: string, from: 'garrison' | 'hero', index: number, count: number, heroId?: string): boolean {
  const p = st.turn;
  const town = st.objects.find(o => o.id === townId);
  if (!town || town.type !== 'town' || town.owner !== p) return false;
  const hero = heroNear(st, p, town.tile, heroId);
  if (!hero) return false;
  const garrison = garrisonOf(town);
  const src = from === 'garrison' ? garrison : hero.army;
  const dst = from === 'garrison' ? hero.army : garrison;
  const stack = src[index];
  if (!stack || !Number.isInteger(count) || count <= 0 || count > stack.count) return false;
  const slot = dst.find(a => a.unit === stack.unit);
  if (!slot && dst.length >= MAX_STACKS) return false;
  if (from === 'hero' && src.reduce((n, a) => n + a.count, 0) - count <= 0) return false; // the hero keeps an army
  if (slot) slot.count += count; else dst.push({ unit: stack.unit, count });
  stack.count -= count;
  if (stack.count === 0) src.splice(index, 1);
  return true;
}

/**
 * Move figures from one of your heroes to another standing on an adjacent tile: `count` figures of
 * `from`'s stack number `index` join `to`'s army (merging with the same unit). `from` keeps at least
 * one stack. To pass troops the other way, call it with the heroes reversed.
 */
export function swapArmies(st: WorldState, from: string, to: string, index: number, count: number): boolean {
  const pl = st.players[st.turn];
  const a = pl.heroes.find(h => h.id === from), b = pl.heroes.find(h => h.id === to);
  if (!a || !b || a === b || cheb(a.tile, b.tile) > 1) return false;
  const stack = a.army[index];
  if (!stack || !Number.isInteger(count) || count <= 0 || count > stack.count) return false;
  if (count === stack.count && a.army.length <= 1) return false; // each hero keeps a stack
  const slot = b.army.find(x => x.unit === stack.unit);
  if (!slot && b.army.length >= MAX_STACKS) return false;
  if (slot) slot.count += count; else b.army.push({ unit: stack.unit, count });
  stack.count -= count;
  if (stack.count === 0) a.army.splice(index, 1);
  return true;
}

// ------------------------------------------------------------------ the independent village

const villageOf = (st: WorldState, id: string) => st.objects.find(o => o.id === id && o.type === 'village' && !o.gone);
const scaleCost = (cost: Partial<Record<Res, number>>, discount: number) => Object.fromEntries(RESOURCES.filter(r => cost[r]).map(r => [r, Math.round(cost[r]! * (1 - discount))])) as Partial<Record<Res, number>>;
const canPay = (pl: PlayerState, cost: Partial<Record<Res, number>>) => RESOURCES.every(r => pl.resources[r] >= (cost[r] ?? 0));
const pay = (pl: PlayerState, cost: Partial<Record<Res, number>>) => { for (const r of RESOURCES) pl.resources[r] -= cost[r] ?? 0; };

export interface VillageOffer {
  ally: number | null; // the allied player, if any
  heroHere: boolean; // one of the player's heroes is at the village
  discount: number; // Diplomacy discount on agreements
  alliance: { cost: Partial<Record<Res, number>>; available: boolean; reason: string };
  guides: { cost: Partial<Record<Res, number>>; available: boolean; reason: string; activeUntil: number };
  trade: { available: boolean; reason: string; deals: { id: TradeDeal; give: Partial<Record<Res, number>>; get: Partial<Record<Res, number>>; affordable: boolean }[] };
  stock: Record<string, number>; // warriors the ally can recruit now (empty for anyone else)
}

/** What a player can do at the village right now, and what it costs. */
export function villageOffer(st: WorldState, villageId: string, player: number): VillageOffer | null {
  const v = villageOf(st, villageId);
  if (!v) return null;
  const pl = st.players[player];
  const here = pl.heroes.some(h => cheb(h.tile, v.tile) <= 1);
  const discount = agreementDiscount(st, player);
  const ally = v.owner ?? null;
  const week = weekOf(st.day);
  const need = (cost: Partial<Record<Res, number>>) => (!here ? 'No hero at the village' : !canPay(pl, cost) ? 'Cannot afford it' : '');
  const allianceCost = scaleCost(ALLIANCE_COST, discount), guidesCost = scaleCost(GUIDES_COST, discount);
  const aReason = ally === player ? 'Already allied' : ally !== null ? 'Allied to another power' : need(allianceCost);
  const gActive = st.day <= pl.guidesUntil;
  const gReason = gActive ? 'Guides already hired this week' : need(guidesCost);
  const tReason = !here ? 'No hero at the village' : pl.tradeWeek === week ? 'Already traded this week' : '';
  return {
    ally, heroHere: here, discount,
    alliance: { cost: allianceCost, available: !aReason, reason: aReason },
    guides: { cost: guidesCost, available: !gReason, reason: gReason, activeUntil: pl.guidesUntil },
    trade: {
      available: !tReason, reason: tReason,
      deals: (Object.keys(TRADE_DEALS) as TradeDeal[]).map(id => ({ id, give: { ...TRADE_DEALS[id].give }, get: { ...TRADE_DEALS[id].get }, affordable: canPay(pl, TRADE_DEALS[id].give) })),
    },
    stock: ally === player ? { ...v.stock } : {},
  };
}

/**
 * Sign an agreement with the village for the current player (a hero must be at the village).
 * 'alliance' (one ally at a time), 'guides' (grass cost in forest until the end of the week) and
 * 'trade' (once a week; `deal` picks 'provisions' = 10 provisions for 400 coin, or 'iron' = 300 coin for 4 iron).
 */
export function signAgreement(st: WorldState, villageId: string, kind: AgreementKind, deal: TradeDeal = 'provisions'): boolean {
  const p = st.turn, pl = st.players[p];
  const v = villageOf(st, villageId);
  const offer = v && villageOffer(st, villageId, p);
  if (!v || !offer || st.winner !== null) return false;
  if (kind === 'alliance') {
    if (!offer.alliance.available) return false;
    pay(pl, offer.alliance.cost);
    v.owner = p;
    revealAround(st, p);
    st.log.push(`${pl.name} sign an alliance with ${v.name}.`);
    return true;
  }
  if (kind === 'guides') {
    if (!offer.guides.available) return false;
    pay(pl, offer.guides.cost);
    pl.guidesUntil = weekOf(st.day) * 7;
    st.log.push(`${pl.name} hire guides from ${v.name} until the week's end.`);
    return true;
  }
  if (kind === 'trade') {
    const d = TRADE_DEALS[deal];
    if (!d || !offer.trade.available || !canPay(pl, d.give)) return false;
    pay(pl, d.give);
    addRes(pl, d.get);
    pl.tradeWeek = weekOf(st.day);
    st.log.push(`${pl.name} trade with ${v.name}: ${resText(d.give)} for ${resText(d.get)}.`);
    return true;
  }
  return false;
}

/** The allied player buys warriors from the village's weekly stock into a hero's army (the given hero, else the active one if it is there, else any hero there). */
export function recruitAtVillage(st: WorldState, villageId: string, unit: string, n: number, heroId?: string): boolean {
  const p = st.turn, pl = st.players[p];
  const v = villageOf(st, villageId);
  if (!v || v.owner !== p || !v.stock || !Number.isInteger(n) || n <= 0) return false;
  const hero = heroNear(st, p, v.tile, heroId);
  if (!hero) return false;
  const have = v.stock[unit] ?? 0, cost = unitCost(unit) * n;
  if (n > have || cost > pl.resources.coin) return false;
  const slot = hero.army.find(a => a.unit === unit);
  if (!slot && hero.army.length >= MAX_STACKS) return false;
  v.stock[unit] = have - n;
  pl.resources.coin -= cost;
  if (slot) slot.count += n; else hero.army.push({ unit, count: n });
  st.log.push(`${pl.name} recruit ${n} ${UNITS[unit].name} at ${v.name}.`);
  return true;
}

// ------------------------------------------------------------------ the river routes

const holdsRoutes = (st: WorldState, p: number) => ROUTE_OBJECTS.every(id => st.objects.find(o => o.id === id)?.owner === p);
/** Consecutive own turns that began with this player holding both route outposts and the Island Trading Post. ROUTE_DAYS of them wins. */
export const routeHold = (st: WorldState, player: number): number => st.players[player].routeDays;

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
      for (const o of st.objects) if (o.type === 'town' && o.stock) {
        const bonus = 1 + townDefs(o).reduce((n, b) => n + (b.growth ?? 0), 0);
        for (const u of available(o)) o.stock[u] = (o.stock[u] ?? 0) + Math.round(GROWTH[o.faction!][u] * bonus);
      } else if (o.type === 'village') o.stock = { ...VILLAGE_STOCK };
      st.log.push(`Week ${weekOf(st.day)} begins: new recruits gather in the towns.`);
    }
  }
  const pl = st.players[st.turn];
  for (const h of pl.heroes) h.mp = maxMove(st, st.turn, h);
  revealAround(st, st.turn);
  events.push({ type: 'turn', player: st.turn });
  // the river routes: count this turn if all three posts are held, else start again
  pl.routeDays = holdsRoutes(st, st.turn) ? pl.routeDays + 1 : 0;
  if (pl.routeDays >= ROUTE_DAYS) {
    st.winner = st.turn;
    st.winReason = 'routes';
    st.log.push(`${pl.name} have held the river routes for ${ROUTE_DAYS} days and win!`);
    events.push({ type: 'win', player: st.turn, how: 'routes' });
  } else if (!pl.heroes.length && !st.objects.some(o => o.type === 'town' && !o.gone && o.owner === st.turn)) {
    st.winner = (st.turn + 1) % st.players.length;
    st.winReason = 'elimination';
    events.push({ type: 'win', player: st.winner, how: 'elimination' });
  }
  return events;
}

export const weekOf = (day: number) => Math.floor((day - 1) / 7) + 1;
export const dayOfWeek = (day: number) => ((day - 1) % 7) + 1;

export function armyPower(army: ArmyStack[]): number {
  return army.reduce((n, a) => { const u = UNITS[a.unit]; return n + a.count * u.hp * (u.dmg[0] + u.dmg[1]) / 2; }, 0);
}

// ------------------------------------------------------------------ AI

/** The order the AI moves its heroes in (ids): the main army (its strongest) first, then the others. */
export function aiHeroes(st: WorldState, p = st.turn): string[] {
  return st.players[p].heroes.map((h, i) => ({ id: h.id, i, power: armyPower(h.army) })).sort((a, b) => b.power - a.power || a.i - b.i).map(x => x.id);
}

/** Pick where the active (AI) hero should go next, or null to end its move. The main army collects garrison troops; the others take mines, pickups and the village. */
export function aiTarget(st: WorldState): Tile | null {
  const p = st.turn, pl = st.players[p], hero = pl.heroes[pl.active];
  if (!hero || st.encounter) return null;
  const main = aiHeroes(st)[0] === hero.id;
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
  const routesHeld = ROUTE_OBJECTS.filter(id => st.objects.find(o => o.id === id)?.owner === p).length;
  // the rival's grip on the river routes: posts they hold, and turns they have held all three
  const rivalHeld = (q: number) => ROUTE_OBJECTS.filter(id => st.objects.find(o => o.id === id)?.owner === q).length;
  const routeValue = (o: WObject) => {
    if (o.owner != null && o.owner !== p) {
      const held = rivalHeld(o.owner);
      if (held === 3) return 300 + 60 * st.players[o.owner].routeDays; // break their hold before it wins
      if (held === 2) return 160;
    }
    // side heroes work the routes harder than the main army does
    return (main ? 75 : 120) + (main ? 25 : 45) * routesHeld;
  };
  for (const o of st.objects) {
    if (o.gone) continue;
    if (o.type === 'pickup') consider(o.tile, 30);
    else if (o.type === 'mine' && o.owner !== p) consider(o.tile, ROUTE_OBJECTS.includes(o.id) ? routeValue(o) : o.kind === 'coin' ? 70 : 45);
    else if (o.type === 'tower' && !isExplored(st, p, [o.tile[0] + 6, o.tile[1]])) consider(o.tile, 12);
    else if (o.type === 'guard' && power > armyPower(o.army!) * 1.6) consider(o.tile, 25);
    else if (o.type === 'town' && o.owner !== p && power > armyPower(garrisonOf(o)) * 1.4) consider(o.tile, 400);
    else if (o.type === 'village' && cheb(o.tile, hero.tile) > 1) {
      if (o.owner === null && canPay(pl, scaleCost(ALLIANCE_COST, agreementDiscount(st, p)))) consider(o.tile, 90);
      else if (o.owner === p && Object.values(o.stock ?? {}).some(n => n > 0) && pl.resources.coin >= 120) consider(o.tile, 40);
    }
  }
  for (let i = 0; i < st.players.length; i++) {
    if (i === p) continue;
    for (const other of st.players[i].heroes) if (power > armyPower(other.army) * 1.4) consider(other.tile, 120);
  }
  // go home to collect troops when the garrison holds a meaningful army (the main army only)
  const home = st.objects.find(o => o.type === 'town' && o.owner === p);
  if (main && home && cheb(home.tile, hero.tile) > 1) {
    const spare = armyPower(garrisonToCollect(home));
    if (spare > 0 && spare >= power * 0.25) consider(home.tile, Math.min(250, 60 + (100 * spare) / Math.max(1, power)));
  }
  return best ? (best as { t: Tile }).t : null;
}

/** The AI picks a skill for every pending level-up: skills it already has first, then the priority order. */
export function aiChooseSkills(st: WorldState, p: number) {
  for (const h of st.players[p].heroes) {
    for (let guard = 0; h.pendingSkills.length && guard < 20; guard++) chooseSkill(st, h.id, aiPickSkill(h, h.pendingSkills[0]));
  }
}

// ------------------------------------------------------------------ AI town management

const AI_BUILD_ORDER: Record<string, string[]> = {
  french: ['barracks', 'sawmill', 'wharf', 'artillery', 'commercial_harbor', 'warehouse', 'stone_rampart', 'watchtower'],
  haudenosaunee: ['three_sisters_fields', 'family_longhouses', 'trade_house', 'gunsmith_forge', 'storehouse', 'canoe_landing', 'fortified_palisade'],
};

/** Garrison stacks the AI would hand to its hero: everything but the weakest stack. */
function garrisonToCollect(o: WObject): ArmyStack[] {
  const g = garrisonOf(o);
  if (g.length < 2) return [];
  const weakest = weakestIndex(g);
  return g.filter((_, i) => i !== weakest);
}
const stackPower = (a: ArmyStack) => armyPower([a]);
function weakestIndex(g: ArmyStack[]): number {
  let w = 0;
  for (let i = 1; i < g.length; i++) if (stackPower(g[i]) < stackPower(g[w])) w = i;
  return w;
}

const AI_MAX_HEROES = 2;

/** The AI levels up, builds what it can from its plan, hires a second hero, recruits into each garrison, deals with the village, and arms its main army if it is at the gate. */
export function aiManageTowns(st: WorldState) {
  const p = st.turn, pl = st.players[p];
  aiChooseSkills(st, p);
  const village = st.objects.find(o => o.type === 'village' && !o.gone);
  // a village visit: sign the alliance when affordable, then buy warriors for the hero there
  if (village) {
    if (village.owner === null && signAgreement(st, village.id, 'alliance')) { /* signed */ }
    if (village.owner === p) {
      const hero = heroNear(st, p, village.tile);
      if (hero) for (const unit of Object.keys(village.stock ?? {}).sort((a, b) => UNITS[b].tier - UNITS[a].tier)) {
        const n = Math.min(village.stock![unit], Math.floor(pl.resources.coin / unitCost(unit)));
        if (n > 0) recruitAtVillage(st, village.id, unit, n, hero.id);
      }
    }
  }
  const reserve = village && village.owner === null && pl.resources.provisions >= (ALLIANCE_COST.provisions ?? 0) ? (ALLIANCE_COST.coin ?? 0) : 0;
  for (const o of st.objects) {
    if (o.type !== 'town' || o.owner !== p) continue;
    if (pl.heroes.length < AI_MAX_HEROES && pl.resources.coin >= hireCost(st, p)) {
      const def = heroPool(st, p)[0];
      if (def) hireHero(st, o.id, def.id);
    }
    const next = (AI_BUILD_ORDER[o.faction!] ?? []).find(id => !cannotBuild(st, o.id, id));
    if (next) build(st, o.id, next);
    if (o.stock) {
      const units = Object.keys(o.stock).sort((a, b) => UNITS[b].tier - UNITS[a].tier);
      for (const u of units) {
        const n = Math.min(o.stock[u], Math.floor((pl.resources.coin - reserve) / unitCost(u)));
        if (n > 0) recruit(st, o.id, u, n);
      }
    }
  }
  // only the main army collects the garrison
  const main = pl.heroes.find(h => h.id === aiHeroes(st)[0]);
  const town = main && townHere(st, p, main);
  if (main && town) {
    const g = garrisonOf(town);
    const skip = new Set<string>();
    // strongest first, always leaving the weakest stack behind
    for (let guard = 0; guard < 2 * MAX_STACKS && g.length > 1; guard++) {
      const weakest = weakestIndex(g);
      let best = -1;
      for (let i = 0; i < g.length; i++) {
        if (i === weakest || skip.has(g[i].unit)) continue;
        if (best < 0 || stackPower(g[i]) > stackPower(g[best])) best = i;
      }
      if (best < 0) break;
      const unit = g[best].unit;
      if (!transfer(st, town.id, 'garrison', best, g[best].count, main.id)) skip.add(unit);
    }
  }
}

// ------------------------------------------------------------------ save and load

export const SAVE_VERSION = 1;

/** The whole world as JSON text. Everything in the state is plain data, so it round-trips exactly. */
export function serializeWorld(st: WorldState): string {
  return JSON.stringify({ version: SAVE_VERSION, state: st });
}

/** Rebuild a world from `serializeWorld` output. Throws a clear error for bad or unknown-version saves. */
export function deserializeWorld(json: string): WorldState {
  let data: { version?: unknown; state?: WorldState };
  try { data = JSON.parse(json); } catch { throw new Error('Save file is not valid JSON.'); }
  if (!data || typeof data !== 'object') throw new Error('Save file is not a saved game.');
  if (data.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${String(data.version)} (this game reads version ${SAVE_VERSION}).`);
  const s = data.state;
  if (!s || !Array.isArray(s.players) || !Array.isArray(s.objects) || !Array.isArray(s.terrain) || typeof s.day !== 'number') throw new Error('Save file is damaged: the game state is incomplete.');
  return s;
}
