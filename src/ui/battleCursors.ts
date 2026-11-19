// Battle cursors, HoMM style: the pointer shows what a click on a hex will do.
// Melee shows a sword pointing the way the blow lands, so you can see which side you attack from.

const OUT = 'stroke="#0b1428" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
const url = (body: string, hx = 16, hy = 16, fallback = 'pointer') =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`)}") ${hx} ${hy}, ${fallback}`;

const BOOT = (fill: string) => `<path d="M12 4c4 0 6 3 6 7v6c0 2 1 3 3 4l4 2c2 1 2 4 0 5H11c-2 0-3-1-3-3V9c0-3 1-5 4-5z" fill="${fill}" ${OUT}/>`;
const HALF = '<circle cx="25" cy="25" r="6.5" fill="#f2d68c" stroke="#0b1428" stroke-width="1.6"/><text x="25" y="28.5" font-family="Arial,sans-serif" font-size="9" font-weight="700" text-anchor="middle" fill="#0b1428">½</text>';

/** A sword pointing right (tip at the right edge), rotated so it points along the blow. */
function sword(angleDeg: number): string {
  const blade = '<path d="M3 16h20l6-0" stroke="#0b1428" stroke-width="6"/><path d="M5 16h19l5 0" stroke="#e9e4d6" stroke-width="3"/><path d="M10 9v14" stroke="#0b1428" stroke-width="5"/><path d="M10 9v14" stroke="#d6b25a" stroke-width="2.5"/><path d="M2 16h7" stroke="#8a5a2b" stroke-width="4"/>';
  return `<g transform="rotate(${angleDeg.toFixed(0)} 16 16)" stroke-linecap="round">${blade}</g>`;
}

const SVG = {
  move: BOOT('#6cc25a'),
  // musket: a crosshair
  fire: `<circle cx="16" cy="16" r="9" fill="none" stroke="#0b1428" stroke-width="5"/><circle cx="16" cy="16" r="9" fill="none" stroke="#ff7a5c" stroke-width="2.5"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="#0b1428" stroke-width="4"/><path d="M16 3v7M16 22v7M3 16h7M22 16h7" stroke="#ffe7a0" stroke-width="2"/>`,
  // bow: an arrow in flight
  arrow: `<path d="M4 28L26 6" stroke="#0b1428" stroke-width="5" stroke-linecap="round"/><path d="M4 28L26 6" stroke="#c9a46a" stroke-width="2.5" stroke-linecap="round"/><path d="M28 4l-9 2 7 7z" fill="#e9e4d6" ${OUT}/><path d="M4 28l1-7M4 28l7-1M7 25l1-6M7 25l6-1" stroke="#c0392b" stroke-width="2"/>`,
  rally: `<path d="M8 30V3" stroke="#0b1428" stroke-width="4"/><path d="M8 30V3" stroke="#e9e4d6" stroke-width="2"/><path d="M9 4l18 6-18 7z" fill="#f2d68c" ${OUT}/>`,
  dig: `<path d="M22 4l6 6-11 11-6-6z" fill="#8a5a2b" ${OUT}/><path d="M12 16l-8 8 4 4 8-8" fill="#c9ccd1" ${OUT}/>`,
};

export type BattleCursor =
  | { kind: 'move' | 'rally' | 'dig' }
  | { kind: 'fire'; bow: boolean; half: boolean }
  | { kind: 'melee'; angle: number } // degrees, direction the blow travels (0 = to the right)
  | { kind: 'none' };

export function battleCursor(c: BattleCursor | null): string {
  if (!c) return '';
  switch (c.kind) {
    case 'none': return 'not-allowed';
    case 'move': return url(SVG.move);
    case 'rally': return url(SVG.rally, 8, 30);
    case 'dig': return url(SVG.dig);
    case 'fire': return url((c.bow ? SVG.arrow : SVG.fire) + (c.half ? HALF : ''), c.bow ? 27 : 16, c.bow ? 5 : 16);
    case 'melee': {
      // snap to 30° steps so there are only a handful of distinct cursors
      const a = Math.round(c.angle / 30) * 30;
      // hotspot at the sword's tip, which sits on the target
      const r = (a * Math.PI) / 180;
      return url(sword(a), Math.round(16 + Math.cos(r) * 12), Math.round(16 + Math.sin(r) * 12));
    }
  }
}
