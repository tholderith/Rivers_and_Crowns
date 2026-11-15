export type Side = "french" | "haudenosaunee";
export type Role = "scout" | "hold" | "breach" | "skirmish" | "support";

export interface Hex {
  q: number;
  r: number;
}

export interface Unit {
  id: string;
  name: string;
  side: Side;
  role: Role;
  position: Hex;
  strength: number;
  maxStrength: number;
  movement: number;
  range: number;
  firePower: number;
  meleePower: number;
  loaded: boolean;
  morale: number;
}

export interface BattleState {
  width: number;
  height: number;
  units: Unit[];
  cover: Hex[];
  activeUnitId: string | null;
  turnOrder: string[];
  round: number;
  winner: Side | null;
  draw: boolean;
  log: string[];
  command: Record<Side, number>;
}

export type BattleAction =
  | { type: "move"; to: Hex }
  | { type: "fire"; targetId: string }
  | { type: "melee"; targetId: string }
  | { type: "reload" }
  | { type: "rally" }
  | { type: "pass" };

const MAX_ROUNDS = 16;
const SHAKE_THRESHOLD = 40;
const MAX_MORALE = 100;
const DIRECTIONS: Hex[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export function createBattle(): BattleState {
  const units: Unit[] = [
    {
      id: "voyageurs",
      name: "Voyageurs",
      side: "french",
      role: "scout",
      position: { q: 2, r: 2 },
      strength: 12,
      maxStrength: 12,
      movement: 3,
      range: 4,
      firePower: 5,
      meleePower: 4,
      loaded: true,
      morale: MAX_MORALE,
    },
    {
      id: "musket-warriors",
      name: "Musket Warriors",
      side: "haudenosaunee",
      role: "skirmish",
      position: { q: 6, r: 2 },
      strength: 18,
      maxStrength: 18,
      movement: 3,
      range: 5,
      firePower: 9,
      meleePower: 5,
      loaded: true,
      morale: MAX_MORALE,
    },
    {
      id: "field-gun",
      name: "Field Gun",
      side: "french",
      role: "breach",
      position: { q: 1, r: 1 },
      strength: 8,
      maxStrength: 8,
      movement: 1,
      range: 6,
      firePower: 9,
      meleePower: 2,
      loaded: true,
      morale: MAX_MORALE,
    },
    {
      id: "war-captains-band",
      name: "War Captain’s Band",
      side: "haudenosaunee",
      role: "support",
      position: { q: 7, r: 3 },
      strength: 28,
      maxStrength: 28,
      movement: 4,
      range: 0,
      firePower: 0,
      meleePower: 11,
      loaded: false,
      morale: MAX_MORALE,
    },
    {
      id: "troupes-de-la-marine",
      name: "Troupes de la Marine",
      side: "french",
      role: "hold",
      position: { q: 1, r: 4 },
      strength: 18,
      maxStrength: 18,
      movement: 2,
      range: 4,
      firePower: 7,
      meleePower: 6,
      loaded: true,
      morale: MAX_MORALE,
    },
  ];

  return {
    width: 9,
    height: 6,
    units,
    cover: [
      { q: 3, r: 1 },
      { q: 4, r: 1 },
      { q: 4, r: 3 },
      { q: 6, r: 2 },
      { q: 5, r: 4 },
      { q: 6, r: 4 },
    ],
    activeUnitId: units[0].id,
    turnOrder: units.map((unit) => unit.id),
    round: 1,
    winner: null,
    draw: false,
    log: ["The armies meet at the meadow. Voyageurs act first."],
    command: { french: 3, haudenosaunee: 3 },
  };
}

export function hexDistance(first: Hex, second: Hex): number {
  const q = first.q - second.q;
  const r = first.r - second.r;
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

function sameHex(first: Hex, second: Hex): boolean {
  return first.q === second.q && first.r === second.r;
}

function hexKey(hex: Hex): string {
  return `${hex.q},${hex.r}`;
}

function inBounds(state: BattleState, hex: Hex): boolean {
  return hex.q >= 0 && hex.r >= 0 && hex.q < state.width && hex.r < state.height;
}

function reachableHexes(state: BattleState, unit: Unit): Hex[] {
  const occupied = state.units.filter((other) => other.strength > 0);
  const visited = new Set(occupied.map((other) => hexKey(other.position)));
  const queue = [{ hex: unit.position, distance: 0 }];

  for (let index = 0; index < queue.length; index += 1) {
    const { hex, distance } = queue[index];
    if (distance >= unit.movement) continue;

    for (const direction of DIRECTIONS) {
      const next = { q: hex.q + direction.q, r: hex.r + direction.r };
      const key = hexKey(next);
      if (!inBounds(state, next) || visited.has(key)) continue;

      visited.add(key);
      queue.push({ hex: next, distance: distance + 1 });
    }
  }

  return queue.slice(1).map(({ hex }) => hex);
}

export function getActions(state: BattleState): BattleAction[] {
  if (state.winner || state.draw) return [];
  const active = state.units.find((unit) => unit.id === state.activeUnitId && unit.strength > 0);
  if (!active) return [];

  const actions: BattleAction[] = reachableHexes(state, active).map((to) => ({ type: "move", to }));

  for (const target of state.units) {
    if (target.side === active.side || target.strength === 0) continue;

    const distance = hexDistance(active.position, target.position);
    if (active.loaded && active.range > 0 && distance <= active.range) {
      actions.push({ type: "fire", targetId: target.id });
    }
    if (distance === 1) actions.push({ type: "melee", targetId: target.id });
  }

  if (active.range > 0 && !active.loaded) actions.push({ type: "reload" });
  if (active.morale < MAX_MORALE && state.command[active.side] > 0) {
    actions.push({ type: "rally" });
  }
  actions.push({ type: "pass" });
  return actions;
}

function matchingAction(legal: BattleAction, requested: BattleAction): boolean {
  switch (legal.type) {
    case "move":
      return requested.type === "move" && Boolean(requested.to && sameHex(legal.to, requested.to));
    case "fire":
      return requested.type === "fire" && legal.targetId === requested.targetId;
    case "melee":
      return requested.type === "melee" && legal.targetId === requested.targetId;
    default:
      return legal.type === requested.type;
  }
}

function attackLosses(state: BattleState, attacker: Unit, target: Unit, ranged: boolean): number {
  const power = ranged ? attacker.firePower : attacker.meleePower;
  const strengthFactor = 0.5 + 0.5 * (attacker.strength / attacker.maxStrength);
  const moraleFactor = attacker.morale < SHAKE_THRESHOLD ? 0.7 : 1;
  const hasCover = ranged && state.cover.some((hex) => sameHex(hex, target.position));
  const coverFactor = hasCover ? 0.6 : 1;
  const losses = Math.max(1, Math.round(power * strengthFactor * moraleFactor * coverFactor));
  return Math.min(target.strength, losses);
}

function advance(state: BattleState, active: Unit, units: Unit[], command: BattleState["command"], message: string): BattleState {
  const alive = units.filter((unit) => unit.strength > 0);
  const log = [...state.log, message];
  const survivingSides = new Set(alive.map((unit) => unit.side));
  if (survivingSides.size === 1) {
    const winner = alive[0].side;
    log.push(winner === "french" ? "The French expedition wins." : "The Haudenosaunee nation wins.");
    return { ...state, units, command, log, winner, activeUnitId: null };
  }

  const activeIndex = state.turnOrder.indexOf(active.id);
  const aliveIds = new Set(alive.map((unit) => unit.id));
  const nextInRound = state.turnOrder.slice(activeIndex + 1).find((id) => aliveIds.has(id));
  if (nextInRound) {
    return { ...state, units, command, log, activeUnitId: nextInRound };
  }
  if (state.round === MAX_ROUNDS) {
    log.push(`Both armies remain after ${MAX_ROUNDS} rounds. The battle ends in a draw.`);
    return { ...state, units, command, log, draw: true, activeUnitId: null };
  }

  const nextRound = state.turnOrder.find((id) => aliveIds.has(id)) ?? null;
  return { ...state, units, command, log, activeUnitId: nextRound, round: state.round + 1 };
}

export function applyAction(state: BattleState, requested: BattleAction): BattleState {
  const action = requested && getActions(state).find((legal) => matchingAction(legal, requested));
  const active = state.units.find((unit) => unit.id === state.activeUnitId);
  if (!action || !active) return state;

  let units = state.units;
  let command = state.command;
  let message: string;

  switch (action.type) {
    case "move":
      units = units.map((unit) => unit.id === active.id ? { ...unit, position: action.to } : unit);
      message = `${active.name} moved to hex ${action.to.q + 1}, ${action.to.r + 1}.`;
      break;
    case "fire":
    case "melee": {
      const target = units.find((unit) => unit.id === action.targetId);
      if (!target) return state;

      const ranged = action.type === "fire";
      const losses = attackLosses(state, active, target, ranged);
      const strength = target.strength - losses;
      const morale = Math.max(0, target.morale - 8 - 2 * losses);
      units = units.map((unit) => {
        if (unit.id === target.id) return { ...unit, strength, morale };
        if (ranged && unit.id === active.id) return { ...unit, loaded: false };
        return unit;
      });

      const verb = ranged ? "fired on" : "struck";
      message = `${active.name} ${verb} ${target.name} for ${losses} ${losses === 1 ? "loss" : "losses"}.`;
      if (strength === 0) message += ` ${target.name} fell.`;
      else if (target.morale >= SHAKE_THRESHOLD && morale < SHAKE_THRESHOLD) {
        message += ` ${target.name} became shaken.`;
      }
      break;
    }
    case "reload":
      units = units.map((unit) => unit.id === active.id ? { ...unit, loaded: true } : unit);
      message = `${active.name} reloaded.`;
      break;
    case "rally": {
      const bonus = active.role === "support" ? 35 : 25;
      const morale = Math.min(MAX_MORALE, active.morale + bonus);
      units = units.map((unit) => unit.id === active.id ? { ...unit, morale } : unit);
      command = { ...command, [active.side]: command[active.side] - 1 };
      message = `${active.name} rallied for 1 Command and recovered ${morale - active.morale} morale.`;
      break;
    }
    case "pass":
      message = `${active.name} held position.`;
      break;
  }

  return advance(state, active, units, command, message);
}
