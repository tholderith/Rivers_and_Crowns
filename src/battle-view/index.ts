import { applyAction, createBattle, getActions } from '../combat/index.ts';
import type { BattleAction, BattleState, Unit } from '../combat/index.ts';
import { isTargetAction, renderBoard, roleName, sideName } from './board.ts';

type Order = BattleAction['type'];
type TargetMode = 'move' | 'fire' | 'melee';

const prompts: Record<TargetMode, string> = {
  move: 'Choose a highlighted hex to move into.',
  fire: 'Choose a marked enemy stack to fire at.',
  melee: 'Choose a marked adjacent stack to strike.',
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing battle element: ${id}`);
  return found as T;
}

function unitCard(card: HTMLElement, unit?: Unit): void {
  const title = document.createElement('h2');
  title.id = 'unit-title';
  title.textContent = unit?.name ?? 'Battle complete';
  card.replaceChildren();

  if (unit === undefined) {
    card.append(title);
    return;
  }

  const affiliation = document.createElement('p');
  affiliation.className = 'unit-side';
  affiliation.dataset.side = unit.side;
  affiliation.textContent = `${sideName(unit.side)} · ${roleName(unit.role)}`;

  const stats = document.createElement('dl');
  stats.className = 'unit-stats';
  const weapons = unit.range === 0 ? ['Attack', 'Melee'] : ['Firearm', unit.loaded ? 'Loaded' : 'Reload'];
  const fields = [['Strength', String(unit.strength)], ['Morale', `${unit.morale}%`], weapons];

  for (const [label, value] of fields) {
    const field = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    if (label === 'Morale' && unit.morale < 40) detail.className = 'low-morale';
    field.append(term, detail);
    stats.append(field);
  }

  const detail = document.createElement('p');
  detail.className = 'unit-detail';
  detail.textContent = unit.morale < 40
    ? 'Low morale reduces damage.'
    : unit.range > 0 ? `Firing range ${unit.range} hexes` : 'Attacks adjacent enemies.';

  card.append(affiliation, title, stats, detail);
}

function updateOrder(list: HTMLOListElement, state: BattleState): void {
  list.replaceChildren();
  for (const id of state.turnOrder) {
    const unit = state.units.find((candidate) => candidate.id === id);
    if (!unit || unit.strength <= 0) continue;

    const item = document.createElement('li');
    item.className = unit.side;
    if (unit.id === state.activeUnitId) item.setAttribute('aria-current', 'step');
    item.textContent = unit.name;
    const count = document.createElement('span');
    count.className = 'queue-strength';
    count.setAttribute('aria-label', `Strength ${unit.strength}`);
    count.textContent = String(unit.strength);
    item.append(count);
    list.append(item);
  }
}

function updateLog(log: HTMLOListElement, entries: string[]): void {
  log.replaceChildren();
  log.start = entries.length;
  for (const entry of entries.slice().reverse()) {
    const item = document.createElement('li');
    item.textContent = entry;
    log.append(item);
  }
  log.scrollTop = 0;
}

export function mountBattle(): void {
  const restart = element<HTMLButtonElement>('restart');
  const board = element('board');
  const round = element('round');
  const marker = element('turn-marker');
  const message = element('turn-message');
  const actions = element('order-actions');
  const hint = element('order-hint');
  const info = element('unit-card');
  const frenchCommand = element('french-command');
  const haudenosauneeCommand = element('haudenosaunee-command');
  const queue = element<HTMLOListElement>('turn-order');
  const log = element<HTMLOListElement>('battle-log');
  const orderButtons = [...actions.querySelectorAll<HTMLButtonElement>('[data-order]')];

  let state = createBattle();
  let mode: TargetMode | null = null;

  function execute(action: BattleAction): void {
    const focused = document.activeElement;
    const fromBoard = board.contains(focused);
    state = applyAction(state, action);
    mode = null;
    render();

    if (fromBoard || (focused instanceof HTMLButtonElement && focused.disabled)) {
      (board.querySelector<HTMLButtonElement>('button[tabindex="0"]')
        ?? actions.querySelector<HTMLButtonElement>('button:enabled')
        ?? restart).focus({ preventScroll: true });
    }
  }

  function render(): void {
    const available = getActions(state);
    const unit = state.units.find((stack) => stack.id === state.activeUnitId);
    const currentSide = state.winner ?? unit?.side;

    marker.dataset.side = currentSide ?? '';
    round.textContent = `Round ${state.round}`;
    const turnSummary = state.winner
      ? `${sideName(state.winner)} wins the battle.`
      : state.draw
        ? 'Battle ended in a draw.'
        : unit ? `${unit.name} to act · ${sideName(unit.side)}` : 'Battle complete.';
    if (message.textContent !== turnSummary) message.textContent = turnSummary;

    for (const button of orderButtons) {
      const order = button.dataset.order as Order;
      button.disabled = !available.some((action) => action.type === order);
      if (button.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', String(mode === order));
    }

    hint.textContent = state.winner || state.draw
      ? 'Restart the battle to play again.'
      : mode
        ? `${prompts[mode]} Use arrow keys to browse and Enter to confirm.`
        : unit && unit.range > 0 && !unit.loaded
          ? 'This stack needs to reload before it can fire. Choose one order per turn.'
          : 'Choose an order or a highlighted hex. Each order ends the stack’s turn.';

    renderBoard(board, state, available, mode, execute);
    unitCard(info, unit);
    frenchCommand.textContent = String(state.command.french);
    haudenosauneeCommand.textContent = String(state.command.haudenosaunee);
    updateOrder(queue, state);
    updateLog(log, state.log);
  }

  for (const button of orderButtons) {
    button.addEventListener('click', () => {
      const order = button.dataset.order as Order;
      const action = getActions(state).find((candidate) => candidate.type === order);
      if (action === undefined) return;

      if (isTargetAction(action)) {
        mode = mode === action.type ? null : action.type;
        render();
        if (mode) board.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
      } else {
        execute(action);
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || mode === null) return;
    const canceled = mode;
    mode = null;
    render();
    orderButtons.find((button) => button.dataset.order === canceled)?.focus();
  });

  restart.addEventListener('click', () => {
    state = createBattle();
    mode = null;
    render();
  });

  render();
}
