// HoMM-style map cursors: the pointer shows what a click on the tile will do.
// Small inline SVGs, so there are no files to load.

export type MapAction = 'move' | 'far' | 'enter' | 'attack' | 'capture' | 'pickup' | 'talk' | 'visit' | 'exchange' | 'select' | 'none';

const OUT = 'stroke="#0b1428" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
const SVG: Record<Exclude<MapAction, 'none' | 'select'>, string> = {
  // a boot print: walk here today
  move: `<path d="M12 4c4 0 6 3 6 7v6c0 2 1 3 3 4l4 2c2 1 2 4 0 5H11c-2 0-3-1-3-3V9c0-3 1-5 4-5z" fill="#6cc25a" ${OUT}/>`,
  // same boot, greyed: needs more than today's movement
  far: `<path d="M12 4c4 0 6 3 6 7v6c0 2 1 3 3 4l4 2c2 1 2 4 0 5H11c-2 0-3-1-3-3V9c0-3 1-5 4-5z" fill="#c9b27a" ${OUT}/><circle cx="24" cy="9" r="5" fill="#f2d68c" ${OUT}/><path d="M24 6v3l2 1" fill="none" stroke="#0b1428" stroke-width="1.6"/>`,
  // a gate: enter your town
  enter: `<path d="M4 28V12l12-8 12 8v16z" fill="#8a5a2b" ${OUT}/><path d="M11 28V18a5 5 0 0 1 10 0v10z" fill="#1a1208" ${OUT}/><path d="M16 4v-2" stroke="#0b1428" stroke-width="2"/>`,
  // crossed swords: fight
  attack: `<g ${OUT}><path d="M5 5l15 15M27 5L12 20" stroke="#0b1428" stroke-width="6"/><path d="M5 5l15 15M27 5L12 20" stroke="#e9e4d6" stroke-width="3"/><path d="M17 23l6-6M9 17l6 6" stroke="#c0392b" stroke-width="4"/><path d="M21 21l6 6M11 21l-6 6" stroke="#8a5a2b" stroke-width="4"/></g>`,
  // a flag: claim it
  capture: `<path d="M8 30V3" stroke="#0b1428" stroke-width="4"/><path d="M8 30V3" stroke="#e9e4d6" stroke-width="2"/><path d="M9 4l18 6-18 7z" fill="#3c7bd8" ${OUT}/>`,
  // a sack: pick it up
  pickup: `<path d="M11 7h10l-2 4c5 2 8 7 8 12 0 4-3 6-11 6S5 27 5 23c0-5 3-10 8-12z" fill="#d6b25a" ${OUT}/><path d="M11 11h10" stroke="#0b1428" stroke-width="2"/>`,
  // a speech bubble: talk to the village
  talk: `<path d="M4 6h24v15H14l-7 6v-6H4z" fill="#f2ead6" ${OUT}/><circle cx="11" cy="13.5" r="1.8" fill="#0b1428"/><circle cx="16" cy="13.5" r="1.8" fill="#0b1428"/><circle cx="21" cy="13.5" r="1.8" fill="#0b1428"/>`,
  // an eye: look out from a tower
  visit: `<path d="M2 16c4-7 9-10 14-10s10 3 14 10c-4 7-9 10-14 10S6 23 2 16z" fill="#f2ead6" ${OUT}/><circle cx="16" cy="16" r="5" fill="#3c7bd8" ${OUT}/>`,
  // two arrows: swap troops between heroes
  exchange: `<g ${OUT}><path d="M4 11h18l-5-5M28 21H10l5 5" fill="none" stroke="#0b1428" stroke-width="6"/><path d="M4 11h18l-5-5M28 21H10l5 5" fill="none" stroke="#f2d68c" stroke-width="3"/></g>`,
};

const url = (body: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`)}")`;

/** CSS cursor value for a map action. */
export function cursorFor(a: MapAction): string {
  if (a === 'none') return 'not-allowed';
  if (a === 'select') return 'pointer';
  return `${url(SVG[a])} 16 16, pointer`;
}

/** Colour of the target highlight drawn on the map for each action. */
export const ACTION_COLOR: Record<MapAction, number> = {
  move: 0x5ce05a, far: 0xd6b25a, enter: 0xf2d68c, attack: 0xe0503a, capture: 0x5b9bff, pickup: 0xf2d68c,
  talk: 0xf2ead6, visit: 0x9cc0ff, exchange: 0xf2d68c, select: 0xf2d68c, none: 0x888888,
};

export const ACTION_LABEL: Record<MapAction, string> = {
  move: 'Move here', far: 'Move here (more than one day)', enter: 'Enter the town', attack: 'Attack', capture: 'Claim it',
  pickup: 'Pick it up', talk: 'Talk with the village', visit: 'Visit', exchange: 'Exchange troops', select: 'Select this hero', none: 'Cannot go there',
};
