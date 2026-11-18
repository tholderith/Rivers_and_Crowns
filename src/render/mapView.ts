// Pixi rendering of the adventure map: the painted basin, objects, heroes, flags,
// fog of war and path previews. Reads the world state; never changes it.

import { Application, Assets, Container, Graphics, Sprite, Text, type Texture, type FederatedPointerEvent } from 'pixi.js';
import { type Tile, type WorldState, MAP_W, MAP_H, TILE, isExplored } from '../sim/world';
import { asset } from './assets';

const MW = MAP_W * TILE, MH = MAP_H * TILE;
const FLAG: number[] = [0x2f5aa8, 0x7a3b8f];
const SIZE: Record<string, number> = { town: 3.4, mine: 2.1, tower: 1.9, pickup: 1.15, guard: 1.7, hero: 1.6 };

export const tileCenter = (t: Tile) => ({ x: t[0] * TILE + TILE / 2, y: t[1] * TILE + TILE / 2 });
const spriteUrl = (s: string) => asset(`sprites/${s}.webp`);

export async function loadMapTextures(world: WorldState): Promise<Record<string, Texture>> {
  const urls = new Set<string>([asset('scenes/L-10.webp')]);
  for (const o of world.objects) urls.add(spriteUrl(o.sprite));
  for (const p of world.players) urls.add(spriteUrl(p.hero.sprite));
  return (await Assets.load([...urls])) as Record<string, Texture>;
}

export class MapView {
  app = new Application();
  private tex: Record<string, Texture> = {};
  private objLayer = new Container();
  private flags = new Graphics();
  private pathG = new Graphics();
  private fog = new Graphics();
  private heroes: Sprite[] = [];
  private ring = new Graphics();
  private objSprites = new Map<string, Sprite>();
  onHover: (t: Tile | null) => void = () => {};
  onClick: (t: Tile) => void = () => {};

  async init(host: HTMLElement, world: WorldState, textures: Record<string, Texture>) {
    this.tex = textures;
    await this.app.init({ width: MW, height: MH, background: '#0b1428', antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    host.appendChild(this.app.canvas);
    const bg = new Sprite(this.tex[asset('scenes/L-10.webp')]);
    bg.scale.set(MW / bg.texture.width);
    this.objLayer.sortableChildren = true;
    this.app.stage.addChild(bg, this.flags, this.pathG, this.objLayer, this.ring, this.fog);
    for (const o of world.objects) {
      const sp = new Sprite(this.tex[spriteUrl(o.sprite)]);
      sp.anchor.set(0.5, 0.82);
      const w = TILE * (SIZE[o.type] ?? 1.5);
      sp.scale.set(w / Math.max(sp.texture.width, sp.texture.height * 0.9));
      const c = tileCenter(o.tile);
      sp.position.set(c.x, c.y + TILE * 0.35);
      sp.zIndex = c.y;
      this.objLayer.addChild(sp);
      this.objSprites.set(o.id, sp);
    }
    world.players.forEach(p => {
      const sp = new Sprite(this.tex[spriteUrl(p.hero.sprite)]);
      sp.anchor.set(0.5, 0.9);
      sp.scale.set((TILE * SIZE.hero) / Math.max(sp.texture.width, sp.texture.height));
      this.objLayer.addChild(sp);
      this.heroes.push(sp);
    });
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = { contains: () => true };
    const toTile = (e: FederatedPointerEvent): Tile => [Math.floor(e.global.x / TILE), Math.floor(e.global.y / TILE)];
    this.app.stage.on('pointermove', e => this.onHover(toTile(e)));
    this.app.stage.on('pointerleave', () => this.onHover(null));
    this.app.stage.on('pointertap', e => this.onClick(toTile(e)));
  }

  /** Redraw everything from the world state, as seen by `viewer`. */
  sync(world: WorldState, viewer: number) {
    for (const o of world.objects) {
      const sp = this.objSprites.get(o.id)!;
      sp.visible = !o.gone;
    }
    world.players.forEach((p, i) => {
      const sp = this.heroes[i];
      sp.visible = !p.hero.defeated && (i === viewer || isExplored(world, viewer, p.hero.tile));
      const c = tileCenter(p.hero.tile);
      sp.position.set(c.x, c.y + TILE * 0.4);
      sp.zIndex = c.y + 1;
      sp.scale.x = Math.abs(sp.scale.x) * (i === 1 ? -1 : 1);
    });
    // ownership flags
    const f = this.flags;
    f.clear();
    for (const o of world.objects) {
      if (o.gone || o.owner == null || (o.type !== 'mine' && o.type !== 'town')) continue;
      const c = tileCenter(o.tile);
      const x = c.x + TILE * (o.type === 'town' ? 1.2 : 0.75), y = c.y - TILE * (o.type === 'town' ? 1.6 : 0.9);
      f.rect(x, y, 2, 30).fill({ color: 0xe9e4d6 });
      f.poly([x + 2, y, x + 22, y + 6, x + 2, y + 12]).fill({ color: FLAG[o.owner] }).stroke({ width: 1, color: 0x0b1428 });
    }
    // current hero ring
    const cur = world.players[world.turn].hero;
    this.ring.clear();
    if (!cur.defeated && world.turn === viewer) {
      const c = tileCenter(cur.tile);
      this.ring.ellipse(c.x, c.y + TILE * 0.35, TILE * 0.55, TILE * 0.22).stroke({ width: 3, color: 0xf2d68c });
    }
    // fog of war
    const g = this.fog;
    g.clear();
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (isExplored(world, viewer, [x, y])) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isExplored(world, viewer, [x + dx, y + dy]));
      g.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0x05080f, alpha: edge ? 0.72 : 0.96 });
    }
  }

  /** Path preview: dots that are green within today's movement, red beyond. */
  showPath(path: Tile[] | null, cost: number[] | null, mp: number) {
    const g = this.pathG;
    g.clear();
    if (!path || !cost) return;
    path.forEach((t, i) => {
      const c = tileCenter(t);
      const ok = cost[i] <= mp;
      const last = i === path.length - 1;
      g.circle(c.x, c.y, last ? 9 : 6).fill({ color: ok ? 0x5ce05a : 0xe0503a, alpha: 0.95 }).stroke({ width: 2, color: 0x0b1428, alpha: 0.8 });
    });
  }

  private tween(ms: number, step: (t: number) => void): Promise<void> {
    return new Promise(res => {
      let t0 = -1;
      const tick = () => {
        const now = performance.now();
        if (t0 < 0) t0 = now;
        const t = Math.min(1, (now - t0) / ms);
        step(t);
        if (t >= 1) { this.app.ticker.remove(tick); res(); }
      };
      this.app.ticker.add(tick);
    });
  }

  async walk(player: number, from: Tile, steps: Tile[]) {
    const sp = this.heroes[player];
    let prev = from;
    for (const t of steps) {
      const a = tileCenter(prev), b = tileCenter(t);
      if (b.x !== a.x) sp.scale.x = Math.abs(sp.scale.x) * (b.x > a.x ? 1 : -1);
      await this.tween(90, k => { sp.position.set(a.x + (b.x - a.x) * k, a.y + TILE * 0.4 + (b.y - a.y) * k); sp.zIndex = a.y + (b.y - a.y) * k + 1; });
      prev = t;
    }
  }

  float(text: string, t: Tile, color = 0xffe7a0) {
    const c = tileCenter(t);
    const tx = new Text({ text, style: { fontFamily: 'Alegreya, Georgia, serif', fontSize: 24, fontWeight: '700', fill: color, stroke: { color: 0x0b1428, width: 5 } } });
    tx.anchor.set(0.5);
    tx.position.set(c.x, c.y - 40);
    this.app.stage.addChild(tx);
    void this.tween(1400, k => { tx.y = c.y - 40 - 40 * k; tx.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3; }).then(() => tx.destroy());
  }
}
