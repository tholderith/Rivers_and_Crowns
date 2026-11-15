import assert from "node:assert/strict";
import test from "node:test";
import { applyAction, createBattle, getActions, hexDistance } from "../src/combat/index.ts";
import type { BattleAction, BattleState, Unit } from "../src/combat/index.ts";

const initialShot: BattleAction = { type: "fire", targetId: "musket-warriors" };

function unit(state: BattleState, id: string): Unit {
  const result = state.units.find((candidate) => candidate.id === id);
  assert.ok(result, `Missing unit ${id}`);
  return result;
}

test("fire consumes the Voyageurs' action and reload is required before firing again", () => {
  const start = createBattle();
  const snapshot = structuredClone(start);
  assert.ok(getActions(start).some((action) => action.type === "fire"));

  let battle = applyAction(start, initialShot);
  assert.deepEqual(start, snapshot);
  assert.deepEqual(battle, applyAction(createBattle(), initialShot));
  assert.equal(battle.activeUnitId, "musket-warriors");
  assert.equal(unit(battle, "voyageurs").loaded, false);
  assert.equal(unit(battle, "musket-warriors").strength, 15);
  assert.equal(unit(battle, "musket-warriors").morale, 86);

  for (let turn = 0; turn < 4; turn += 1) battle = applyAction(battle, { type: "pass" });

  assert.equal(battle.round, 2);
  assert.equal(battle.activeUnitId, "voyageurs");
  assert.equal(getActions(battle).some((action) => action.type === "fire"), false);
  assert.strictEqual(applyAction(battle, initialShot), battle);
  const reloaded = applyAction(battle, { type: "reload" });
  assert.equal(unit(reloaded, "voyageurs").loaded, true);
  assert.equal(reloaded.activeUnitId, "musket-warriors");
});

test("axial moves respect range, bounds and occupied routes", () => {
  const start = createBattle();
  const movement = getActions(start).find((action) => action.type === "move");
  assert.ok(movement);
  const moved = applyAction(start, movement);
  assert.deepEqual(unit(moved, "voyageurs").position, movement.to);
  assert.equal(moved.activeUnitId, "musket-warriors");
  assert.equal(hexDistance({ q: 1, r: 1 }, { q: 2, r: 0 }), 1);
  assert.equal(hexDistance({ q: 1, r: 1 }, { q: 2, r: 2 }), 2);

  const corridor: BattleState = {
    ...start,
    width: 5,
    height: 1,
    units: start.units.map((occupant, index) => ({ ...occupant, position: { q: index, r: 0 } })),
  };
  assert.equal(getActions(corridor).some((action) => action.type === "move"), false);
  assert.strictEqual(applyAction(corridor, { type: "move", to: { q: 1, r: 0 } }), corridor);
  assert.strictEqual(applyAction(start, { type: "move", to: { q: -1, r: 2 } }), start);
  assert.strictEqual(applyAction(start, { type: "move", to: { q: 2, r: 2 } }), start);
});

test("cover protects against fire while shaken morale reduces attack damage", () => {
  const start = createBattle();
  const normal = applyAction({ ...start, cover: [] }, initialShot);
  assert.equal(unit(normal, "musket-warriors").strength, 13);

  const shaken = {
    ...start,
    cover: [],
    units: start.units.map((occupant) =>
      occupant.id === "voyageurs" ? { ...occupant, morale: 30 } : occupant),
  };
  const weakenedShot = applyAction(shaken, initialShot);
  assert.equal(unit(weakenedShot, "musket-warriors").strength, 14);

  const adjacent = {
    ...start,
    units: start.units.map((occupant) =>
      occupant.id === "voyageurs" ? { ...occupant, position: { q: 5, r: 2 }, loaded: false } : occupant),
  };
  const melee = applyAction(adjacent, { type: "melee", targetId: "musket-warriors" });
  assert.equal(unit(melee, "musket-warriors").strength, 14);
  assert.equal(unit(melee, "voyageurs").loaded, false);
});

test("Rally spends one side Command on the active stack and uses its turn", () => {
  const start = createBattle();
  const shot = applyAction(start, initialShot);
  const rallied = applyAction(shot, { type: "rally" });
  assert.deepEqual(rallied.command, { french: 3, haudenosaunee: 2 });
  assert.equal(unit(rallied, "musket-warriors").morale, 100);
  assert.equal(rallied.activeUnitId, "field-gun");
  assert.strictEqual(applyAction(start, { type: "rally" }), start);

  const outOfCommand = { ...shot, command: { ...shot.command, haudenosaunee: 0 } };
  assert.strictEqual(applyAction(outOfCommand, { type: "rally" }), outOfCommand);
});

test("illegal friendly fire and attacks outside range leave the battle unchanged", () => {
  const start = createBattle();
  const invalidActions: BattleAction[] = [
    { type: "fire", targetId: "field-gun" },
    { type: "fire", targetId: "war-captains-band" },
    { type: "fire", targetId: "missing" },
    { type: "melee", targetId: "musket-warriors" },
    { type: "reload" },
  ];
  for (const action of invalidActions) assert.strictEqual(applyAction(start, action), start);
});

test("turn order skips defeated stacks and last opposing loss ends the battle", () => {
  const start = createBattle();
  const closeToWin = {
    ...start,
    units: start.units.map((occupant) =>
      occupant.id === "musket-warriors" ? { ...occupant, strength: 1 } : occupant),
  };
  const oneLeft = applyAction(closeToWin, initialShot);
  assert.equal(unit(oneLeft, "musket-warriors").strength, 0);
  assert.equal(oneLeft.activeUnitId, "field-gun");
  assert.equal(oneLeft.winner, null);

  const captainsGone = {
    ...closeToWin,
    units: closeToWin.units.map((occupant) =>
      occupant.id === "war-captains-band" ? { ...occupant, strength: 0 } : occupant),
  };
  const won = applyAction(captainsGone, initialShot);
  assert.equal(won.winner, "french");
  assert.equal(won.draw, false);
  assert.equal(won.activeUnitId, null);
  assert.deepEqual(getActions(won), []);
  assert.strictEqual(applyAction(won, { type: "pass" }), won);
});

test("passing for sixteen rounds yields a draw without changing army strengths", () => {
  const start = createBattle();
  let battle = start;
  for (let turn = 0; turn < 79; turn += 1) battle = applyAction(battle, { type: "pass" });
  assert.equal(battle.round, 16);
  assert.equal(battle.draw, false);

  const finished = applyAction(battle, { type: "pass" });
  assert.equal(finished.round, 16);
  assert.equal(finished.draw, true);
  assert.equal(finished.winner, null);
  assert.equal(finished.activeUnitId, null);
  assert.deepEqual(finished.units, start.units);
  assert.deepEqual(getActions(finished), []);
});
