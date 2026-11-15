import type { BattleAction, BattleState, Hex, Role, Side, Unit } from '../combat/index.ts';

const hexWidth = 48;
const radius = hexWidth / Math.sqrt(3);
const rowStep = 1.5 * radius;
const paddingX = 32;
const paddingY = 32;

const sideNames: Record<Side, string> = {
  french: 'French expedition',
  haudenosaunee: 'Haudenosaunee nation',
};

const roleNames: Record<Role, string> = {
  scout: 'Scout',
  hold: 'Hold',
  breach: 'Breach',
  skirmish: 'Skirmish',
  support: 'Support',
};

const roleEmblems: Record<Role, string> = {
  scout: '<path d="M-7 5 0-7 7 5 0 2Z"/>',
  hold: '<path d="M-6-6H6V0Q6 4 0 7-6 4-6 0Z"/>',
  breach: '<path d="M-7 3 5-5M2-7l5 5M-8 0l4 6"/><circle cx="2" cy="4" r="2.7"/>',
  skirmish: '<path d="M-5-7Q6-1-5 7M-5-7V7M-8 0H8M5-3l3 3-3 3"/>',
  support: '<path d="M-5 7V-7M-5-6H6L3-2l3 3H-5"/>',
};

type TargetAction = Extract<BattleAction, { type: 'move' | 'fire' | 'melee' }>;
type TargetMode = TargetAction['type'];

interface TileAction {
  action: TargetAction;
  position: Hex;
  label: string;
}

export function sideName(side: Side): string {
  return sideNames[side];
}

export function roleName(role: Role): string {
  return roleNames[role];
}

function key(position: Hex): string {
  return `${position.q},${position.r}`;
}

function center({ q, r }: Hex): [number, number] {
  return [paddingX + hexWidth * (q + r / 2), paddingY + rowStep * r];
}

export function isTargetAction(action: BattleAction): action is TargetAction {
  return action.type === 'move' || action.type === 'fire' || action.type === 'melee';
}

function getTileActions(state: BattleState, actions: BattleAction[], mode: TargetMode | null): Map<string, TileAction> {
  const targets = new Map<string, TileAction>();

  for (const action of actions) {
    if (!isTargetAction(action) || (mode !== null && action.type !== mode)) continue;

    if (action.type === 'move') {
      const { q, r } = action.to;
      const cover = state.cover.some((tile) => key(tile) === key(action.to)) ? ', woodland cover' : '';
      targets.set(key(action.to), { action, position: action.to, label: `Move to column ${q + 1}, row ${r + 1}${cover}` });
      continue;
    }

    const unit = state.units.find((candidate) => candidate.id === action.targetId);
    if (unit === undefined) continue;

    const unitKey = key(unit.position);
    if (targets.has(unitKey) && action.type !== 'fire') continue;
    targets.set(unitKey, {
      action,
      position: unit.position,
      label: `${action.type === 'fire' ? 'Fire at' : 'Strike'} ${unit.name}, strength ${unit.strength}`,
    });
  }

  return targets;
}

function hexPolygon(x: number, y: number): string {
  const half = hexWidth / 2;
  return [
    [x, y - radius],
    [x + half, y - radius / 2],
    [x + half, y + radius / 2],
    [x, y + radius],
    [x - half, y + radius / 2],
    [x - half, y - radius / 2],
  ].map(([px, py]) => `${px},${py}`).join(' ');
}

function terrain(width: number, height: number): string {
  return `
    <defs>
      <linearGradient id="meadow" x1="0" y1="0" x2=".58" y2="1" gradientUnits="objectBoundingBox">
        <stop stop-color="#536645"/><stop offset=".52" stop-color="#849365"/><stop offset="1" stop-color="#677b53"/>
      </linearGradient>
      <pattern id="grass" width="46" height="37" patternUnits="userSpaceOnUse">
        <path d="m7 6 2 3m2-4 1 2m20 14-2 5m5-7-1 4M15 29l1 2m5-4 2 3" stroke="#dae0a2" stroke-opacity=".24" stroke-width=".8" stroke-linecap="round"/>
        <path d="m5 22 2 1m19-17 2 1m13 26 2-3" stroke="#263f31" stroke-opacity=".23" stroke-width="1.2" stroke-linecap="round"/>
      </pattern>
      <pattern id="woods" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(36)">
        <path d="M1 0v8" stroke="#d1deb0" stroke-opacity=".35" stroke-width="1.5"/>
      </pattern>
      <radialGradient id="field-edge"><stop offset=".67" stop-color="#263d33" stop-opacity="0"/><stop offset="1" stop-color="#263529" stop-opacity=".52"/></radialGradient>
    </defs>
    <path d="M0 0H${width}V${height}H0Z" fill="url(#meadow)"/>
    <path d="M0 0H${width * .76}C${width * .62} ${height * .14} ${width * .35} ${height * .08} 0 ${height * .6}Z" fill="#3d5e48" opacity=".4"/>
    <path d="M${width} ${height * .39}C${width * .89} ${height * .56} ${width * .86} ${height * .8} ${width * .75} ${height}H${width}Z" fill="#41644a" opacity=".48"/>
    <path d="M-15 ${height * .94}C${width * .22} ${height * .87} ${width * .27} ${height * .44} ${width * .51} ${height * .45}S${width * .79} ${height * .36} ${width + 15} ${height * .13}" fill="none" stroke="#cdb486" opacity=".68" stroke-width="14"/>
    <path d="M-15 ${height * .94}C${width * .22} ${height * .87} ${width * .27} ${height * .44} ${width * .51} ${height * .45}S${width * .79} ${height * .36} ${width + 15} ${height * .13}" fill="none" stroke="#edcf95" opacity=".25" stroke-width="4"/>
    <path d="M0 0H${width}V${height}H0Z" fill="url(#grass)"/>
    <path d="M0 0H${width}V${height}H0Z" fill="url(#field-edge)"/>`;
}

function renderTile(position: Hex, cover: boolean, active: boolean, target?: TileAction): string {
  const [x, y] = center(position);
  const polygon = hexPolygon(x, y);
  let fill = cover ? '#2b493a' : 'none';
  let opacity = cover ? '.69' : '1';
  let stroke = '#263b2e';
  let strokeWidth = '.8';
  let strokeDash = '';

  if (active) {
    stroke = '#ffe19b';
    strokeWidth = '2.5';
  } else if (target) {
    const move = target.action.type === 'move';
    fill = move ? '#f7e7ae' : '#8e483a';
    opacity = move ? '.33' : '.52';
    stroke = move ? '#f8e9ba' : '#ffd1ba';
    strokeWidth = move ? '1.25' : '2.15';
    strokeDash = move ? '' : '4 3';
  }

  const coverIcon = cover
    ? `<polygon points="${polygon}" fill="url(#woods)"/>
       <path d="m${x - 19} ${y + 15} 4-8 4 8h-3v3h-2v-3Zm8 1 3-6 3 6h-2v2h-2v-2Z" fill="#e2e5b5" opacity=".9"/>`
    : '';

  return `
    <polygon points="${polygon}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeDash}"/>
    ${coverIcon}`;
}

function renderUnit(unit: Unit, active: boolean): string {
  const [x, y] = center(unit.position);
  const french = unit.side === 'french';
  const background = french ? '#244270' : '#334d32';
  const edge = french ? '#c4d9ff' : '#d7e4a9';
  const shape = french
    ? '<circle r="13.5"/>'
    : '<path d="M0-15 13-7.5v15L0 15l-13-7.5v-15Z"/>';
  const shade = active ? '#ffe098' : edge;
  const lowMorale = unit.morale < 40;
  const needsReload = unit.range > 0 && !unit.loaded;
  const status = lowMorale && needsReload ? '↓ R' : lowMorale ? '↓' : needsReload ? 'R' : '';

  return `
    <g transform="translate(${x} ${y})">
      <ellipse cy="10" rx="17" ry="6" fill="#17251e" opacity=".45"/>
      <g transform="translate(0 -3)" fill="${background}" stroke="${shade}" stroke-width="${active ? '2.1' : '1.2'}">${shape}</g>
      <g transform="translate(0 -3)" fill="none" stroke="${shade}" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${roleEmblems[unit.role]}</g>
      <rect x="-11" y="7" width="22" height="12" rx="3" fill="#141b25" stroke="${shade}" stroke-width=".8"/>
      <text y="16.2" fill="#fff5db" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="8.8">${unit.strength}</text>
      ${status ? `<rect x="8" y="-18" width="${status.length > 1 ? 17 : 10}" height="10" rx="3" fill="#1d211f" stroke="#f6d897" stroke-width=".7"/>
      <text x="${status.length > 1 ? 16.5 : 13}" y="-10.8" fill="#f9dea1" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="7">${status}</text>` : ''}
    </g>`;
}

function focusBoardTarget(button: HTMLButtonElement, buttons: HTMLButtonElement[]): void {
  for (const candidate of buttons) candidate.tabIndex = candidate === button ? 0 : -1;
  button.focus();
}

export function renderBoard(
  board: HTMLElement,
  state: BattleState,
  actions: BattleAction[],
  mode: TargetMode | null,
  execute: (action: BattleAction) => void,
): void {
  const width = (state.width - 1 + (state.height - 1) / 2) * hexWidth + paddingX * 2;
  const height = (state.height - 1) * rowStep + paddingY * 2;
  const active = state.units.find((unit) => unit.id === state.activeUnitId);
  const activeKey = active ? key(active.position) : '';
  const cover = new Set(state.cover.map(key));
  const targets = getTileActions(state, actions, mode);
  const tiles: string[] = [];

  for (let r = 0; r < state.height; r += 1) {
    for (let q = 0; q < state.width; q += 1) {
      const tileKey = key({ q, r });
      tiles.push(renderTile({ q, r }, cover.has(tileKey), activeKey === tileKey, targets.get(tileKey)));
    }
  }

  const units = state.units.filter((unit) => unit.strength > 0)
    .map((unit) => renderUnit(unit, unit.id === state.activeUnitId)).join('');
  board.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
    ${terrain(width, height)}${tiles.join('')}${units}</svg>`;

  const entries = [...targets.values()].sort((a, b) => {
    if (active === undefined) return 0;
    const [x, y] = center(active.position);
    const [ax, ay] = center(a.position);
    const [bx, by] = center(b.position);
    return Math.hypot(ax - x, ay - y) - Math.hypot(bx - x, by - y);
  });
  const buttons = entries.map(({ position, label, action }, index) => {
    const button = document.createElement('button');
    const [x, y] = center(position);
    button.className = 'board-target';
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.tabIndex = index === 0 ? 0 : -1;
    button.style.left = `${x / width * 100}%`;
    button.style.top = `${y / height * 100}%`;
    button.style.width = `${hexWidth / width * 100}%`;
    button.style.height = `${radius * 2 / height * 100}%`;
    button.addEventListener('click', () => execute(action));
    board.append(button);
    return button;
  });

  const directions = new Map<string, [number, number]>([
    ['ArrowLeft', [-1, 0]], ['ArrowRight', [1, 0]], ['ArrowUp', [0, -1]], ['ArrowDown', [0, 1]],
  ]);
  buttons.forEach((button, index) => {
    button.addEventListener('keydown', (event) => {
      const direction = directions.get(event.key);
      if (direction === undefined) return;
      event.preventDefault();
      const [originX, originY] = center(entries[index].position);
      const [dx, dy] = direction;
      let best: HTMLButtonElement | undefined;
      let bestScore = Infinity;

      entries.forEach(({ position }, candidateIndex) => {
        const [x, y] = center(position);
        const forward = dx * (x - originX) + dy * (y - originY);
        if (forward < 1) return;
        const sideways = dy * (x - originX) - dx * (y - originY);
        const score = Math.hypot(forward, sideways * 1.7);
        if (score < bestScore) {
          bestScore = score;
          best = buttons[candidateIndex];
        }
      });

      if (best) focusBoardTarget(best, buttons);
    });
  });

  const viewport = board.parentElement;
  if (active && viewport && viewport.scrollWidth > viewport.clientWidth) {
    const [x] = center(active.position);
    viewport.scrollLeft = x / width * board.clientWidth - viewport.clientWidth / 2;
  }
}
