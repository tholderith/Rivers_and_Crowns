// The battle rules. Pure and deterministic: no DOM, no Pixi, no Math.random.
// A battle is a plain state object. `act` applies one action for the active stack and
// returns the events it caused, which the renderer animates and the log prints.

import unitsJson from '../data/units.json';
import battlesJson from '../data/battles.json';
import { type Hex, key, fromKey, same, distance, neighbors, inBounds } from './hex';
import { nextRandom, randInt } from './rng';

export type Trait =
  | 'musket' | 'skirmish' | 'drilled' | 'woodland' | 'rapid' | 'ambush'
  | 'charge' | 'grapeshot' | 'colours' | 'inspire' | 'bayonet' | 'heavy';

export interface UnitDef {
  id: string;
  name: string;
  faction: string;
  tier: number;
  job: string;
  hp: number;
  attack: number;
  defense: number;
  dmg: [number, number];
  speed: number;
  range: number;
  traits: Trait[];
  poses: { ready: number; attack: number; reload: number; defeated: number };
}

export const UNITS: Record<string, UnitDef> = Object.fromEntries(
  Object.entries(unitsJson)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => [k, { id: k, ...(v as Omit<UnitDef, 'id'>) }]),
);

export type SideIndex = 0 | 1;

export interface Hero {
  name: string;
  portrait: string;
  attack: number;
  defense: number;
  command: number;
  commandMax: number;
}

export interface SideState {
  faction: string;
  name: string;
  hero: Hero;
  usedAbilityRound: number; // a hero acts at most once per round
}

export interface Stack {
  id: string;
  unit: string;
  side: SideIndex;
  hex: Hex;
  count: number;
  startCount: number;
  topHp: number; // health of the front figure
  loaded: boolean;
  retaliated: boolean;
  defending: boolean;
  waited: boolean;
  wavering: boolean;
  volley: boolean; // Coordinated Volley bonus on its next shot this round
  rallied: number; // rounds of Rally morale left
}

export interface BattleState {
  battleId: string;
  rng: number;
  round: number;
  sides: [SideState, SideState];
  stacks: Stack[];
  woods: string[];
  rocks: string[];
  works: string[]; // hexes fortified by Fieldworks
  queue: string[]; // stacks still to act this round, in order
  active: string | null;
  inspired: boolean; // the active stack rolled good morale this turn
  winner: SideIndex | 'draw' | null;
  log: string[];
}

export type Action =
  | { type: 'move'; to: Hex }
  | { type: 'attack'; target: string; from?: Hex }
  | { type: 'fire'; target: string; from?: Hex }
  | { type: 'reload'; to?: Hex }
  | { type: 'defend' }
  | { type: 'wait' }
  | { type: 'ability'; ability: Ability; target?: string; hex?: Hex }
  | { type: 'retreat' };

export type Ability = 'rally' | 'volley' | 'fieldworks';
export const ABILITIES: Record<Ability, { name: string; cost: number; text: string }> = {
  rally: { name: 'Rally', cost: 1, text: 'One of your units stops wavering and gains +2 morale for two rounds.' },
  volley: { name: 'Coordinated Volley', cost: 2, text: 'Your loaded shooting units deal +30% damage with their next shot this round.' },
  fieldworks: { name: 'Fieldworks', cost: 2, text: 'An empty hex next to one of your units becomes cover for the rest of the battle.' },
};

export type BattleEvent =
  | { type: 'round'; round: number }
  | { type: 'turn'; stack: string }
  | { type: 'falter'; stack: string }
  | { type: 'inspired'; stack: string }
  | { type: 'move'; stack: string; path: Hex[] }
  | { type: 'fire'; stack: string; target: string; damage: number; killed: number; cover: boolean; extra?: { target: string; damage: number; killed: number }[] }
  | { type: 'melee'; stack: string; target: string; damage: number; killed: number; retaliation: boolean }
  | { type: 'reload'; stack: string }
  | { type: 'defend'; stack: string }
  | { type: 'wait'; stack: string }
  | { type: 'wavering'; stack: string }
  | { type: 'destroyed'; stack: string }
  | { type: 'ability'; side: SideIndex; ability: Ability; target?: string; hex?: Hex }
  | { type: 'end'; winner: SideIndex | 'draw' };

// ---------------------------------------------------------------- setup

export function createBattle(battleId: string, seed: number, leftFaction = 'french', rightFaction = 'haudenosaunee'): BattleState {
  const def = (battlesJson as Record<string, BattleJson>)[battleId];
  const factions = [leftFaction, rightFaction];
  const stacks: Stack[] = [];
  const sides = factions.map((f, i) => {
    const s = def.sides[f];
    s.army.forEach((a, n) => {
      const u = UNITS[a.unit];
      let hex = fromKey(a.at);
      // an army deployed on the other side of the field mirrors its columns
      const homeLeft = hex.col < 5;
      if ((i === 0) !== homeLeft) hex = { col: 10 - hex.col, row: hex.row };
      stacks.push({
        id: `${i}-${n}`, unit: a.unit, side: i as SideIndex, hex, count: a.count, startCount: a.count, topHp: u.hp,
        loaded: true, retaliated: false, defending: false, waited: false, wavering: false, volley: false, rallied: 0,
      });
    });
    return { faction: f, name: s.name, hero: { ...s.hero, commandMax: s.hero.command }, usedAbilityRound: 0 } as SideState;
  }) as [SideState, SideState];
  const st: BattleState = {
    battleId, rng: seed | 0, round: 0, sides, stacks, woods: [...def.woods], rocks: [...def.rocks], works: [],
    queue: [], active: null, inspired: false, winner: null, log: [],
  };
  const events: BattleEvent[] = [];
  startRound(st, events);
  return st;
}

interface BattleJson {
  name: string;
  background: string;
  woods: string[];
  rocks: string[];
  sides: Record<string, { name: string; hero: Omit<Hero, 'commandMax'>; army: { unit: string; count: number; at: string }[] }>;
}

export const battleInfo = (id: string) => (battlesJson as Record<string, BattleJson>)[id];

// ---------------------------------------------------------------- queries

export const unitOf = (s: Stack): UnitDef => UNITS[s.unit];
export const has = (s: Stack, t: Trait): boolean => UNITS[s.unit].traits.includes(t);
export const alive = (st: BattleState): Stack[] => st.stacks.filter(s => s.count > 0);
export const byId = (st: BattleState, id: string): Stack => st.stacks.find(s => s.id === id)!;
export const activeStack = (st: BattleState): Stack | null => (st.active ? byId(st, st.active) : null);
export const stackAt = (st: BattleState, h: Hex): Stack | undefined => st.stacks.find(s => s.count > 0 && same(s.hex, h));
export const isWoods = (st: BattleState, h: Hex): boolean => st.woods.includes(key(h));
export const isCover = (st: BattleState, h: Hex): boolean => isWoods(st, h) || st.works.includes(key(h));
export const isShooter = (s: Stack): boolean => unitOf(s).range > 0;

export function adjacentEnemies(st: BattleState, s: Stack): Stack[] {
  return neighbors(s.hex).map(h => stackAt(st, h)).filter((o): o is Stack => !!o && o.side !== s.side);
}

function adjacentAllyWith(st: BattleState, s: Stack, t: Trait): boolean {
  return neighbors(s.hex).some(h => {
    const o = stackAt(st, h);
    return !!o && o.side === s.side && has(o, t);
  });
}

export function moraleOf(st: BattleState, s: Stack): number {
  let m = 0;
  if (adjacentAllyWith(st, s, 'colours') || has(s, 'colours')) m += 1;
  if (adjacentAllyWith(st, s, 'inspire')) m += 1;
  if (s.rallied > 0) m += 2;
  if (s.wavering) m -= 2;
  return Math.max(-3, Math.min(3, m));
}

function moveCost(st: BattleState, s: Stack, h: Hex): number {
  if (st.rocks.includes(key(h))) return Infinity;
  if (isWoods(st, h)) {
    if (has(s, 'heavy')) return Infinity;
    return has(s, 'woodland') ? 1 : 2;
  }
  return 1;
}

/** Hexes the stack can reach this turn, with the path to each. */
export function reachable(st: BattleState, s: Stack, budget = unitOf(s).speed): Map<string, { cost: number; path: Hex[] }> {
  const out = new Map<string, { cost: number; path: Hex[] }>();
  out.set(key(s.hex), { cost: 0, path: [s.hex] });
  const frontier: Hex[] = [s.hex];
  while (frontier.length) {
    frontier.sort((a, b) => out.get(key(a))!.cost - out.get(key(b))!.cost);
    const cur = frontier.shift()!;
    const here = out.get(key(cur))!;
    for (const n of neighbors(cur)) {
      if (stackAt(st, n)) continue;
      const c = here.cost + moveCost(st, s, n);
      if (c > budget) continue;
      const prev = out.get(key(n));
      if (!prev || c < prev.cost) {
        out.set(key(n), { cost: c, path: [...here.path, n] });
        frontier.push(n);
      }
    }
  }
  return out;
}

export function canFire(st: BattleState, s: Stack, from: Hex = s.hex): boolean {
  if (!isShooter(s)) return false;
  if (has(s, 'musket') && !s.loaded) return false;
  const blocked = neighbors(from).some(h => {
    const o = stackAt(st, h);
    return !!o && o.side !== s.side && o.id !== s.id;
  });
  return !blocked;
}

/** Hexes a shooter may fire from: where it stands, or up to 2 hexes away for skirmishers. */
export function firePositions(st: BattleState, s: Stack): Map<string, { cost: number; path: Hex[] }> {
  if (!has(s, 'skirmish')) return new Map([[key(s.hex), { cost: 0, path: [s.hex] }]]);
  return reachable(st, s, 2);
}

// ---------------------------------------------------------------- damage

interface HitOpts {
  ranged: boolean;
  from: Hex;
  moved: number;
  average?: boolean; // expected value, no dice (for the AI and the hover preview)
}

export function damageRoll(st: BattleState, a: Stack, d: Stack, o: HitOpts): { damage: number; cover: boolean } {
  const ua = unitOf(a), ud = unitOf(d);
  const ha = st.sides[a.side].hero, hd = st.sides[d.side].hero;
  let base: number;
  const [lo, hi] = ua.dmg;
  if (o.average) base = a.count * (lo + hi) / 2;
  else if (a.count <= 10) {
    base = 0;
    for (let i = 0; i < a.count; i++) base += randInt(st, lo, hi);
  } else {
    let ten = 0;
    for (let i = 0; i < 10; i++) ten += randInt(st, lo, hi);
    base = Math.round(ten * a.count / 10);
  }
  const atk = ua.attack + ha.attack + (adjacentAllyWith(st, a, 'inspire') ? 1 : 0);
  let def = ud.defense + hd.defense;
  if (d.defending) def = Math.round(def * 1.3);
  const diff = atk - def;
  let mult = diff >= 0 ? 1 + 0.05 * Math.min(diff, 40) : 1 - 0.025 * Math.min(-diff, 28);
  const cover = o.ranged && isCover(st, d.hex);
  if (o.ranged) {
    if (cover) mult *= 0.5;
    if (distance(o.from, d.hex) > ua.range) mult *= 0.5;
    if (has(a, 'ambush') && isWoods(st, o.from)) mult *= 1.25;
    if (a.volley) mult *= 1.3;
  } else {
    if (isShooter(a) && !has(a, 'bayonet')) mult *= 0.5;
    if (has(a, 'charge') && o.moved >= 3) mult *= 1.25;
  }
  if (a.wavering) mult *= 0.75;
  if (st.inspired && st.active === a.id) mult *= 1.25;
  return { damage: Math.max(1, Math.round(base * mult)), cover };
}

function applyDamage(st: BattleState, d: Stack, damage: number, events: BattleEvent[]): number {
  const hp = unitOf(d).hp;
  const before = d.count;
  const total = (d.count - 1) * hp + d.topHp - damage;
  if (total <= 0) {
    d.count = 0;
    d.topHp = 0;
  } else {
    d.count = Math.ceil(total / hp);
    d.topHp = total - (d.count - 1) * hp;
  }
  const killed = before - d.count;
  if (d.count === 0) {
    events.push({ type: 'destroyed', stack: d.id });
    st.queue = st.queue.filter(id => id !== d.id);
  } else if (!d.wavering && killed >= Math.max(1, before * 0.3) && !adjacentAllyWith(st, d, 'colours') && !has(d, 'colours')) {
    d.wavering = true;
    events.push({ type: 'wavering', stack: d.id });
  }
  return killed;
}

/** Expected damage and kills, for previews and the AI. */
export function preview(st: BattleState, a: Stack, d: Stack, ranged: boolean, from: Hex = a.hex, moved = 0) {
  const { damage, cover } = damageRoll(st, a, d, { ranged, from, moved, average: true });
  const hp = unitOf(d).hp;
  const total = (d.count - 1) * hp + d.topHp;
  const killed = damage >= total ? d.count : d.count - Math.ceil((total - damage) / hp);
  return { damage, killed, cover };
}

// ---------------------------------------------------------------- turn flow

function startRound(st: BattleState, events: BattleEvent[]) {
  st.round += 1;
  for (const s of st.stacks) {
    s.retaliated = false;
    s.waited = false;
    s.volley = false;
    if (s.rallied > 0) s.rallied -= 1;
  }
  const order = alive(st).slice().sort((a, b) => {
    const sp = unitOf(b).speed - unitOf(a).speed;
    if (sp) return sp;
    if (a.side !== b.side) return ((a.side + st.round) % 2) - ((b.side + st.round) % 2);
    return a.id < b.id ? -1 : 1;
  });
  st.queue = order.map(s => s.id);
  events.push({ type: 'round', round: st.round });
}

function advance(st: BattleState, events: BattleEvent[]) {
  st.active = null;
  st.inspired = false;
  for (let guard = 0; guard < 200 && st.winner === null; guard++) {
    if (!st.queue.length) startRound(st, events);
    const id = st.queue.shift()!;
    const s = byId(st, id);
    if (s.count <= 0) continue;
    st.active = id;
    s.defending = false;
    events.push({ type: 'turn', stack: id });
    const m = moraleOf(st, s);
    const r = nextRandom(st);
    if (m < 0 && r < 0.1 * -m) {
      events.push({ type: 'falter', stack: id });
      st.active = null;
      continue;
    }
    if (m > 0 && r < 0.06 * m) {
      st.inspired = true;
      events.push({ type: 'inspired', stack: id });
    }
    return;
  }
}

function checkEnd(st: BattleState, events: BattleEvent[]) {
  const left = alive(st).some(s => s.side === 0);
  const right = alive(st).some(s => s.side === 1);
  if (left && right && st.round <= 50) return;
  st.winner = left && !right ? 0 : right && !left ? 1 : 'draw';
  st.active = null;
  events.push({ type: 'end', winner: st.winner });
}

function walk(st: BattleState, s: Stack, to: Hex, budget: number, events: BattleEvent[]): number {
  if (same(s.hex, to)) return 0;
  const r = reachable(st, s, budget).get(key(to));
  if (!r) throw new Error(`cannot reach ${key(to)}`);
  s.hex = to;
  events.push({ type: 'move', stack: s.id, path: r.path });
  return r.path.length - 1;
}

/** Apply one action for the active stack (or its hero). Returns the resulting events. */
export function act(st: BattleState, action: Action): BattleEvent[] {
  if (st.winner !== null) return [];
  const s = activeStack(st);
  if (!s) throw new Error('no active stack');
  const events: BattleEvent[] = [];
  const name = unitOf(s).name;
  switch (action.type) {
    case 'move': {
      walk(st, s, action.to, unitOf(s).speed, events);
      break;
    }
    case 'attack': {
      const t = byId(st, action.target);
      const from = action.from ?? s.hex;
      if (distance(from, t.hex) !== 1) throw new Error('attack must be from an adjacent hex');
      const moved = walk(st, s, from, unitOf(s).speed, events);
      const hit = damageRoll(st, s, t, { ranged: false, from, moved });
      const ev = { type: 'melee' as const, stack: s.id, target: t.id, damage: hit.damage, killed: 0, retaliation: false };
      events.push(ev);
      ev.killed = applyDamage(st, t, hit.damage, events);
      st.log.push(`${name} attack ${unitOf(t).name}: ${ev.killed} fall.`);
      if (t.count > 0 && !t.retaliated) {
        t.retaliated = true;
        const back = damageRoll(st, t, s, { ranged: false, from: t.hex, moved: 0 });
        const ev2 = { type: 'melee' as const, stack: t.id, target: s.id, damage: back.damage, killed: 0, retaliation: true };
        events.push(ev2);
        ev2.killed = applyDamage(st, s, back.damage, events);
        st.log.push(`${unitOf(t).name} strike back: ${ev2.killed} fall.`);
      }
      break;
    }
    case 'fire': {
      const t = byId(st, action.target);
      const from = action.from ?? s.hex;
      if (!same(from, s.hex)) {
        if (!has(s, 'skirmish')) throw new Error('only skirmishers move and fire');
        walk(st, s, from, 2, events);
      }
      if (!canFire(st, s)) throw new Error('cannot fire');
      const hit = damageRoll(st, s, t, { ranged: true, from, moved: 0 });
      const extra: { target: string; damage: number; killed: number }[] = [];
      const fireEv: BattleEvent = { type: 'fire', stack: s.id, target: t.id, damage: hit.damage, killed: 0, cover: hit.cover, extra };
      events.push(fireEv);
      const splash = has(s, 'grapeshot') ? neighbors(t.hex).map(h => stackAt(st, h)).filter((o): o is Stack => !!o && o.side !== s.side) : [];
      fireEv.killed = applyDamage(st, t, hit.damage, events);
      for (const o of splash) {
        const h2 = damageRoll(st, s, o, { ranged: true, from, moved: 0 });
        const dmg = Math.max(1, Math.round(h2.damage / 2));
        extra.push({ target: o.id, damage: dmg, killed: applyDamage(st, o, dmg, events) });
      }
      st.log.push(`${name} fire at ${unitOf(t).name}${hit.cover ? ' in cover' : ''}: ${fireEv.killed} fall.`);
      s.volley = false;
      if (has(s, 'musket')) s.loaded = false;
      break;
    }
    case 'reload': {
      if (!has(s, 'musket') || s.loaded) throw new Error('nothing to reload');
      if (action.to && !same(action.to, s.hex)) {
        if (!has(s, 'drilled')) throw new Error('only drilled units move and reload');
        walk(st, s, action.to, 2, events);
      }
      s.loaded = true;
      events.push({ type: 'reload', stack: s.id });
      st.log.push(`${name} reload.`);
      break;
    }
    case 'defend': {
      s.defending = true;
      events.push({ type: 'defend', stack: s.id });
      st.log.push(`${name} brace to defend.`);
      break;
    }
    case 'wait': {
      if (s.waited) throw new Error('already waited this round');
      s.waited = true;
      st.queue.push(s.id);
      events.push({ type: 'wait', stack: s.id });
      advance(st, events);
      return events;
    }
    case 'ability': {
      useAbility(st, s.side, action, events);
      return events; // abilities don't end the unit's turn
    }
    case 'retreat': {
      st.winner = s.side === 0 ? 1 : 0;
      st.log.push(`${st.sides[s.side].name} retreat from the field.`);
      events.push({ type: 'end', winner: st.winner });
      return events;
    }
  }
  checkEnd(st, events);
  if (st.winner === null) advance(st, events);
  return events;
}

export function abilityAllowed(st: BattleState, side: SideIndex, ability: Ability): boolean {
  const sd = st.sides[side];
  return sd.usedAbilityRound !== st.round && sd.hero.command >= ABILITIES[ability].cost;
}

function useAbility(st: BattleState, side: SideIndex, a: Extract<Action, { type: 'ability' }>, events: BattleEvent[]) {
  if (!abilityAllowed(st, side, a.ability)) throw new Error('ability not available');
  const sd = st.sides[side];
  if (a.ability === 'rally') {
    const t = byId(st, a.target ?? '');
    if (!t || t.side !== side || t.count <= 0) throw new Error('rally needs one of your units');
    t.wavering = false;
    t.rallied = 2;
  } else if (a.ability === 'volley') {
    for (const s of alive(st)) if (s.side === side && isShooter(s)) s.volley = true;
  } else {
    const h = a.hex;
    if (!h || !inBounds(h) || stackAt(st, h) || isCover(st, h) || st.rocks.includes(key(h))) throw new Error('fieldworks need an empty open hex');
    if (!alive(st).some(s => s.side === side && distance(s.hex, h) === 1)) throw new Error('fieldworks must be next to one of your units');
    st.works.push(key(h));
  }
  sd.hero.command -= ABILITIES[a.ability].cost;
  sd.usedAbilityRound = st.round;
  events.push({ type: 'ability', side, ability: a.ability, target: a.target, hex: a.hex });
  st.log.push(`${sd.hero.name} orders ${ABILITIES[a.ability].name}.`);
}

/** Starting events for a freshly created battle (round 1 and the first turn). */
export function begin(st: BattleState): BattleEvent[] {
  const events: BattleEvent[] = [{ type: 'round', round: st.round }];
  advance(st, events);
  return events;
}
