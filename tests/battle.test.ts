import { describe, expect, it } from 'vitest';
import { distance, neighbors } from '../src/sim/hex';
import {
  act, activeStack, alive, begin, byId, canFire, createBattle, preview, stackAt, unitOf, type BattleState, type Stack,
} from '../src/sim/battle';
import { chooseAbility, chooseAction } from '../src/sim/ai';

function playOut(st: BattleState, maxActions = 2000): number {
  begin(st);
  let n = 0;
  while (st.winner === null && n < maxActions) {
    const ab = chooseAbility(st);
    if (ab) act(st, ab);
    act(st, chooseAction(st));
    n++;
  }
  return n;
}

/** Put one stack on a cleared field so a rule can be tested on its own. */
function duel(attackerUnit: string, defenderUnit: string) {
  const st = createBattle('forest-edge', 7);
  st.woods = []; st.rocks = [];
  const [a, d] = [st.stacks.find(s => s.unit === attackerUnit)!, st.stacks.find(s => s.unit === defenderUnit)!];
  st.stacks = [a, d];
  a.hex = { col: 2, row: 3 };
  d.hex = { col: 6, row: 3 };
  st.queue = [];
  st.active = a.id;
  return { st, a, d };
}

describe('hex grid', () => {
  it('measures distance on the offset grid', () => {
    expect(distance({ col: 0, row: 0 }, { col: 0, row: 0 })).toBe(0);
    expect(distance({ col: 0, row: 0 }, { col: 3, row: 0 })).toBe(3);
    expect(distance({ col: 0, row: 0 }, { col: 0, row: 2 })).toBe(2);
    expect(distance({ col: 2, row: 3 }, { col: 6, row: 3 })).toBe(4);
  });
  it('gives every neighbour at distance 1', () => {
    for (const n of neighbors({ col: 5, row: 3 })) expect(distance({ col: 5, row: 3 }, n)).toBe(1);
    expect(neighbors({ col: 5, row: 3 })).toHaveLength(6);
    expect(neighbors({ col: 0, row: 0 }).length).toBeLessThan(6);
  });
});

describe('battle rules', () => {
  it('replays identically from the same seed', () => {
    const a = createBattle('forest-edge', 1234);
    const b = createBattle('forest-edge', 1234);
    playOut(a);
    playOut(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a musket unit must reload before firing again', () => {
    const { st, a, d } = duel('U-FR-03', 'U-HD-04');
    expect(canFire(st, a)).toBe(true);
    act(st, { type: 'fire', target: d.id });
    expect(byId(st, a.id).loaded).toBe(false);
    st.active = a.id;
    expect(canFire(st, a)).toBe(false);
    expect(() => act(st, { type: 'fire', target: d.id })).toThrow();
    st.active = a.id;
    act(st, { type: 'reload' });
    expect(byId(st, a.id).loaded).toBe(true);
  });

  it('bows never need reloading', () => {
    const { st, a, d } = duel('U-HD-02', 'U-FR-01');
    act(st, { type: 'fire', target: d.id });
    st.active = a.id;
    expect(canFire(st, a)).toBe(true);
  });

  it('cover halves incoming fire', () => {
    const { st, a, d } = duel('U-FR-03', 'U-HD-04');
    const open = preview(st, a, d, true).damage;
    st.woods = ['6,3'];
    const covered = preview(st, a, d, true).damage;
    expect(Math.abs(covered - open / 2)).toBeLessThanOrEqual(1);
  });

  it('a shooter next to an enemy cannot fire', () => {
    const { st, a, d } = duel('U-FR-01', 'U-HD-04');
    d.hex = { col: 3, row: 3 };
    expect(canFire(st, a)).toBe(false);
  });

  it('melee kills figures and the defender strikes back once', () => {
    const { st, a, d } = duel('U-HD-04', 'U-FR-01');
    d.hex = { col: 3, row: 3 };
    const before = [a.count, d.count];
    const events = act(st, { type: 'attack', target: d.id });
    expect(d.count).toBeLessThan(before[1]);
    expect(a.count).toBeLessThanOrEqual(before[0]);
    const strikes = events.filter(e => e.type === 'melee');
    expect(strikes.map(e => e.type === 'melee' && e.retaliation)).toEqual([false, true]);
  });

  it('grapeshot also hits enemies next to the target', () => {
    const { st, d } = duel('U-FR-05', 'U-HD-02');
    const other: Stack = { ...d, id: 'x', hex: { col: 7, row: 3 } };
    st.stacks.push(other);
    const before = other.count;
    act(st, { type: 'fire', target: d.id });
    expect(other.count).toBeLessThan(before);
  });

  it('heavy guns cannot enter woods', () => {
    const { st, a } = duel('U-FR-05', 'U-HD-02');
    st.woods = ['3,3'];
    expect(() => act(st, { type: 'move', to: { col: 3, row: 3 } })).toThrow();
    expect(stackAt(st, { col: 2, row: 3 })?.id).toBe(a.id);
  });

  it('AI against AI always reaches a result', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const st = createBattle('forest-edge', seed);
      playOut(st);
      expect(st.winner).not.toBeNull();
    }
  });

  it('every turn belongs to a living stack', () => {
    const st = createBattle('forest-edge', 99);
    begin(st);
    for (let i = 0; i < 300 && st.winner === null; i++) {
      const s = activeStack(st)!;
      expect(s.count).toBeGreaterThan(0);
      act(st, chooseAction(st));
    }
    expect(alive(st).every(s => unitOf(s).hp > 0)).toBe(true);
  });
});
