// Battle AI: scores every option the active stack has and picks the best one.
// Deterministic (no dice): uses expected damage from `preview`.

import {
  type Action, type BattleState, type Stack, ABILITIES, abilityAllowed, activeStack, adjacentEnemies, alive,
  canFire, firePositions, has, isCover, isShooter, preview, reachable, unitOf,
} from './battle';
import { type Hex, distance, fromKey, key, neighbors } from './hex';

const perFigure = (s: Stack): number => {
  const u = unitOf(s);
  return u.hp * ((u.dmg[0] + u.dmg[1]) / 2) * (u.range > 0 ? 1.2 : 1) / 10;
};
const worth = (s: Stack, damage: number): number => (damage / unitOf(s).hp) * perFigure(s);

interface Option { action: Action; value: number }

/** The hero ability to use before this turn's action, if any. */
export function chooseAbility(st: BattleState): Action | null {
  const s = activeStack(st);
  if (!s) return null;
  const mine = alive(st).filter(o => o.side === s.side);
  if (abilityAllowed(st, s.side, 'rally')) {
    const shaken = mine.filter(o => o.wavering).sort((a, b) => b.count * perFigure(b) - a.count * perFigure(a))[0];
    if (shaken) return { type: 'ability', ability: 'rally', target: shaken.id };
  }
  if (abilityAllowed(st, s.side, 'volley')) {
    const ready = mine.filter(o => isShooter(o) && (!has(o, 'musket') || o.loaded) && (st.queue.includes(o.id) || o.id === s.id) && canFire(st, o));
    if (ready.length >= 3 && st.sides[s.side].hero.command >= ABILITIES.volley.cost) return { type: 'ability', ability: 'volley' };
  }
  return null;
}

function bestShot(st: BattleState, s: Stack, from: Hex, enemies: Stack[]): Option | null {
  let best: Option | null = null;
  for (const t of enemies) {
    const p = preview(st, s, t, true, from);
    const v = worth(t, p.damage) + (p.killed >= t.count ? 3 : 0);
    if (!best || v > best.value) best = { action: { type: 'fire', target: t.id, from }, value: v };
  }
  return best;
}

/** Danger of standing on a hex: expected fire from loaded enemy shooters and reach of melee enemies. */
function danger(st: BattleState, s: Stack, h: Hex, enemies: Stack[]): number {
  let d = 0;
  for (const e of enemies) {
    const dist = distance(e.hex, h);
    if (isShooter(e) && (!has(e, 'musket') || e.loaded) && dist <= unitOf(e).range) {
      d += worth(s, preview(st, e, s, true, e.hex).damage) * (isCover(st, h) ? 0.5 : 1) * 0.35;
    } else if (!isShooter(e) && dist <= unitOf(e).speed + 1) {
      d += worth(s, preview(st, e, s, false, e.hex, 3).damage) * 0.3;
    }
  }
  return d;
}

export function chooseAction(st: BattleState): Action {
  const s = activeStack(st);
  if (!s) throw new Error('no active stack');
  const enemies = alive(st).filter(o => o.side !== s.side);
  const options: Option[] = [{ action: { type: 'defend' }, value: 0.05 }];
  const reach = reachable(st, s);

  // shoot
  if (isShooter(s) && (!has(s, 'musket') || s.loaded)) {
    for (const [k] of firePositions(st, s)) {
      const from = fromKey(k);
      const saved = s.hex;
      s.hex = from;
      const ok = canFire(st, s);
      const shot = ok ? bestShot(st, s, from, enemies) : null;
      s.hex = saved;
      if (shot) {
        shot.value += isCover(st, from) ? 0.3 : 0;
        if (k !== key(s.hex)) shot.value -= 0.05;
        options.push(shot);
      }
    }
  }

  // melee
  for (const t of enemies) {
    for (const h of [s.hex, ...neighbors(t.hex)]) {
      if (distance(h, t.hex) !== 1) continue;
      const r = reach.get(key(h));
      if (!r) continue;
      const p = preview(st, s, t, false, h, r.cost);
      const left = Math.max(0, t.count - p.killed);
      const back = left > 0 && !t.retaliated ? preview(st, t, s, false, t.hex).damage * (left / t.count) : 0;
      let v = worth(t, p.damage) + (left === 0 ? 3 : 0) - worth(s, back) * 0.7;
      if (isShooter(s) && !has(s, 'bayonet')) v -= 1; // shooters belong at range
      options.push({ action: { type: 'attack', target: t.id, from: h }, value: v });
    }
  }

  // reload
  if (has(s, 'musket') && !s.loaded && adjacentEnemies(st, s).length === 0) {
    const spots = has(s, 'drilled') ? [...reachable(st, s, 2).keys()].map(fromKey) : [s.hex];
    for (const h of spots) {
      const shot = bestShot(st, s, h, enemies.filter(e => distance(e.hex, h) <= unitOf(s).range + 2));
      const v = (shot ? shot.value * 0.75 : 0.2) + (isCover(st, h) ? 0.3 : 0) - danger(st, s, h, enemies) * 0.5;
      options.push({ action: { type: 'reload', to: h }, value: v });
    }
  }

  // move into position
  for (const [k, r] of reach) {
    if (r.cost === 0) continue;
    const h = fromKey(k);
    let v: number;
    if (isShooter(s)) {
      const inRange = enemies.filter(e => distance(e.hex, h) <= unitOf(s).range);
      const adjacent = enemies.some(e => distance(e.hex, h) === 1);
      v = adjacent ? -2 : inRange.length ? 0.4 : 0.1 - nearest(enemies, h) * 0.02;
    } else {
      const d = nearest(enemies, h);
      v = 0.6 - d * 0.08;
    }
    v += isCover(st, h) ? 0.35 : 0;
    v -= danger(st, s, h, enemies) * 0.25;
    options.push({ action: { type: 'move', to: h }, value: v });
  }

  options.sort((a, b) => b.value - a.value);
  return options[0].action;
}

function nearest(enemies: Stack[], h: Hex): number {
  return Math.min(...enemies.map(e => distance(e.hex, h)));
}
