// Pixi rendering of the adventure map: the painted basin, objects, heroes, flags,
// fog of war and path previews, seen through a scrolling, zoomable camera.
// Reads the world state; never changes it.

import { Application, Assets, Container, Graphics, Sprite, Text, type Texture, type FederatedPointerEvent } from 'pixi.js';
import { type Tile, type WorldState, type WObject, MAP_W, MAP_H, TILE, isExplored } from '../sim/world';
import { asset } from './assets';

const MW = MAP_W * TILE, MH = MAP_H * TILE;
const FLAG: number[] = [0x2f5aa8, 0x7a3b8f];
/** Sprite width in tiles. Towns fill their 6×4 footprint. */
const SIZE: Record<string, number> = { town: 6.6, mine: 2.2, tower: 2.0, pickup: 1.2, guard: 1.8, hero: 1.7 };
const VISIBLE_TILES = 20; // tiles across the view at the default zoom
const BG = 'scenes/L-10-hd.webp';

export const tileCenter = (t: Tile) => ({ x: t[0] * TILE + TILE / 2, y: t[1] * TILE + TILE / 2 });
const spriteUrl = (s: string) => asset(`sprites/${s}.webp`);
export const walkFrameUrls = (faction: string) =>
  [1, 2, 3, 4, 5, 6].map(i => asset(`sprites/hero-walk-${faction}/frame-${i}.webp`));

export async function loadMapTextures(world: WorldState): Promise<Record<string, Texture>> {
  const urls = new Set<string>([asset(BG)]);
  for (const o of world.objects) urls.add(spriteUrl(o.sprite));
  for (const p of world.players) urls.add(spriteUrl(p.hero.sprite));
  const tex = (await Assets.load([...urls])) as Record<string, Texture>;
  // walk frames are optional: any that are missing are skipped, and with none the hero just bobs
  for (const p of world.players) for (const u of walkFrameUrls(p.faction)) {
    try { tex[u] = await Assets.load(u); } catch { /* frame not present */ }
  }
  return tex;
}

/** Where a town's sprite sits: centred on its footprint, feet at the bottom of the entrance row. */
function townPos(o: WObject) {
  return { x: o.tile[0] * TILE, y: (o.tile[1] + 1) * TILE };
}

interface HeroView { sprite: Sprite; idle: Texture; frames: Texture[]; baseScale: number; frameScale: number }

export class MapView {
  app = new Application();
  private tex: Record<string, Texture> = {};
  private worldLayer = new Container();
  private objLayer = new Container();
  private flags = new Graphics();
  private pathG = new Graphics();
  private fog = new Graphics();
  private fx = new Container();
  private ring = new Graphics();
  private heroes: HeroView[] = [];
  private objSprites = new Map<string, Sprite>();
  private host!: HTMLElement;
  private zoom = 1;
  private minZoom = 0.5;
  private cam = { x: MW / 2, y: MH / 2 }; // world point at the view centre
  private follow: Tile | null = null;
  private miniCanvas: HTMLCanvasElement | null = null;
  private lastWorld: WorldState | null = null;
  private lastViewer = 0;
  onHover: (t: Tile | null) => void = () => {};
  onClick: (t: Tile) => void = () => {};

  async init(host: HTMLElement, world: WorldState, textures: Record<string, Texture>) {
    this.tex = textures;
    this.host = host;
    await this.app.init({ resizeTo: host, background: '#0b1428', antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    host.appendChild(this.app.canvas);
    const bg = new Sprite(this.tex[asset(BG)]);
    bg.scale.set(MW / bg.texture.width);
    this.objLayer.sortableChildren = true;
    this.worldLayer.addChild(bg, this.flags, this.pathG, this.objLayer, this.ring, this.fog, this.fx);
    this.app.stage.addChild(this.worldLayer);

    for (const o of world.objects) {
      const sp = new Sprite(this.tex[spriteUrl(o.sprite)]);
      const w = TILE * (SIZE[o.type] ?? 1.5);
      sp.scale.set(w / sp.texture.width);
      if (o.type === 'town') {
        sp.anchor.set(0.5, 0.95);
        const p = townPos(o);
        sp.position.set(p.x, p.y);
        sp.zIndex = p.y - TILE; // heroes at the gate draw in front
      } else {
        sp.anchor.set(0.5, 0.82);
        if (sp.height > TILE * 2.4) sp.scale.set((TILE * 2.4) / sp.texture.height);
        const c = tileCenter(o.tile);
        sp.position.set(c.x, c.y + TILE * 0.35);
        sp.zIndex = c.y;
      }
      this.objLayer.addChild(sp);
      this.objSprites.set(o.id, sp);
    }
    world.players.forEach(p => {
      const idle = this.tex[spriteUrl(p.hero.sprite)];
      const frames = walkFrameUrls(p.faction).map(u => this.tex[u]).filter(Boolean);
      const sp = new Sprite(idle);
      sp.anchor.set(0.5, 0.92);
      const baseScale = (TILE * SIZE.hero) / Math.max(idle.width, idle.height);
      sp.scale.set(baseScale);
      this.objLayer.addChild(sp);
      // frames are drawn at the same on-screen height as the idle sprite
      this.heroes.push({ sprite: sp, idle, frames: frames.length >= 4 ? frames : [], baseScale, frameScale: frames.length ? baseScale * (idle.height * 0.95) / frames[0].height : baseScale });
    });

    this.setupInput();
    const ro = new ResizeObserver(() => { this.app.resize(); this.fitZoom(false); this.applyCamera(); });
    ro.observe(host);
    this.fitZoom(true);
    this.app.ticker.add(() => this.tickCamera());
  }

  // ------------------------------------------------------------------ camera

  /** Zoom so about VISIBLE_TILES tiles fit across; never zoom out past the whole map. */
  private fitZoom(reset: boolean) {
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 600;
    this.minZoom = Math.max(w / MW, h / MH);
    const z = Math.max(this.minZoom, w / (VISIBLE_TILES * TILE));
    if (reset || this.zoom < this.minZoom) this.zoom = z;
  }

  private clampCam() {
    const w = this.app.screen.width / this.zoom, h = this.app.screen.height / this.zoom;
    this.cam.x = w >= MW ? MW / 2 : Math.min(MW - w / 2, Math.max(w / 2, this.cam.x));
    this.cam.y = h >= MH ? MH / 2 : Math.min(MH - h / 2, Math.max(h / 2, this.cam.y));
  }

  private applyCamera() {
    this.clampCam();
    this.worldLayer.scale.set(this.zoom);
    this.worldLayer.position.set(this.app.screen.width / 2 - this.cam.x * this.zoom, this.app.screen.height / 2 - this.cam.y * this.zoom);
    this.drawMinimap();
  }

  /** Ease the camera toward the tile it is following. */
  private tickCamera() {
    if (!this.follow) return;
    const c = tileCenter(this.follow);
    const dx = c.x - this.cam.x, dy = c.y - this.cam.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) { this.follow = null; return; }
    this.cam.x += dx * 0.15;
    this.cam.y += dy * 0.15;
    this.applyCamera();
  }

  /** Centre the view on a tile (smoothly unless `instant`). */
  centerOn(t: Tile, instant = false) {
    if (instant) { const c = tileCenter(t); this.cam.x = c.x; this.cam.y = c.y; this.follow = null; this.applyCamera(); }
    else this.follow = t;
  }

  /** Keep a moving point inside the middle of the view. */
  private keepInView(x: number, y: number) {
    const w = this.app.screen.width / this.zoom, h = this.app.screen.height / this.zoom;
    const mx = w * 0.3, my = h * 0.3;
    let moved = false;
    if (x < this.cam.x - mx) { this.cam.x = x + mx; moved = true; }
    if (x > this.cam.x + mx) { this.cam.x = x - mx; moved = true; }
    if (y < this.cam.y - my) { this.cam.y = y + my; moved = true; }
    if (y > this.cam.y + my) { this.cam.y = y - my; moved = true; }
    if (moved) this.applyCamera();
  }

  private setupInput() {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = { contains: () => true };
    const toTile = (e: FederatedPointerEvent): Tile => {
      const p = this.worldLayer.toLocal(e.global);
      return [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];
    };
    let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    stage.on('pointerdown', e => { drag = { x: e.global.x, y: e.global.y, cx: this.cam.x, cy: this.cam.y, moved: false }; });
    stage.on('pointermove', e => {
      if (drag && (e.buttons & 1 || e.pointerType === 'touch')) {
        const dx = e.global.x - drag.x, dy = e.global.y - drag.y;
        if (drag.moved || Math.hypot(dx, dy) > 8) {
          drag.moved = true;
          this.follow = null;
          this.cam.x = drag.cx - dx / this.zoom;
          this.cam.y = drag.cy - dy / this.zoom;
          this.applyCamera();
          this.onHover(null);
          return;
        }
      }
      this.onHover(toTile(e));
    });
    stage.on('pointerup', e => { const d = drag; drag = null; if (d && !d.moved) this.onClick(toTile(e)); });
    stage.on('pointerupoutside', () => { drag = null; });
    stage.on('pointerleave', () => this.onHover(null));
    this.app.canvas.addEventListener('wheel', ev => {
      ev.preventDefault();
      const before = this.zoom;
      this.zoom = Math.min(2.6, Math.max(this.minZoom, this.zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
      // zoom around the cursor
      const r = this.app.canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left - this.app.screen.width / 2, sy = ev.clientY - r.top - this.app.screen.height / 2;
      this.cam.x += sx / before - sx / this.zoom;
      this.cam.y += sy / before - sy / this.zoom;
      this.follow = null;
      this.applyCamera();
    }, { passive: false });
    // arrow keys / WASD scroll the map
    addEventListener('keydown', ev => {
      if (!this.host.isConnected || this.host.closest('[hidden]')) return;
      if ((ev.target as HTMLElement)?.closest('input, textarea')) return;
      const step = TILE * 3;
      const k = ev.key.toLowerCase();
      const d = k === 'arrowleft' || k === 'a' ? [-step, 0] : k === 'arrowright' || k === 'd' ? [step, 0] : k === 'arrowup' || k === 'w' ? [0, -step] : k === 'arrowdown' || k === 's' ? [0, step] : null;
      if (!d) return;
      ev.preventDefault();
      this.follow = null;
      this.cam.x += d[0]; this.cam.y += d[1];
      this.applyCamera();
    });
  }

  /** Screen position (CSS pixels, relative to the canvas) of a tile's top centre. */
  tileToScreen(t: Tile): { x: number; y: number } {
    const p = this.worldLayer.toGlobal({ x: t[0] * TILE + TILE / 2, y: t[1] * TILE });
    return { x: p.x, y: p.y };
  }

  // ------------------------------------------------------------------ minimap

  attachMinimap(canvas: HTMLCanvasElement) {
    this.miniCanvas = canvas;
    const jump = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this.follow = null;
      this.cam.x = ((ev.clientX - r.left) / r.width) * MW;
      this.cam.y = ((ev.clientY - r.top) / r.height) * MH;
      this.applyCamera();
    };
    canvas.onpointerdown = ev => { jump(ev); canvas.setPointerCapture(ev.pointerId); };
    canvas.onpointermove = ev => { if (ev.buttons & 1) jump(ev); };
    this.drawMinimap();
  }

  private miniBg: HTMLImageElement | null = null;

  private drawMinimap() {
    const cv = this.miniCanvas, world = this.lastWorld;
    if (!cv || !world) return;
    const g = cv.getContext('2d')!;
    const W = cv.width, H = cv.height, sx = W / MAP_W, sy = H / MAP_H;
    if (!this.miniBg) { this.miniBg = new Image(); this.miniBg.src = asset(BG); this.miniBg.onload = () => this.drawMinimap(); }
    g.fillStyle = '#05080f';
    g.fillRect(0, 0, W, H);
    if (this.miniBg.complete && this.miniBg.naturalWidth) g.drawImage(this.miniBg, 0, 0, W, (this.miniBg.naturalHeight / this.miniBg.naturalWidth) * W);
    g.fillStyle = 'rgba(5,8,15,0.92)';
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (!isExplored(world, this.lastViewer, [x, y])) g.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
    for (const o of world.objects) {
      if (o.gone || !isExplored(world, this.lastViewer, o.tile)) continue;
      const colour = o.owner != null ? (o.owner === 0 ? '#4a7ad8' : '#a35bbf') : o.type === 'guard' ? '#e0705a' : null;
      if (!colour) continue;
      const big = o.type === 'town';
      g.fillStyle = colour;
      g.fillRect((o.tile[0] - (big ? 3 : 0.4)) * sx, (o.tile[1] - (big ? 3 : 0.4)) * sy, (big ? 6 : 1.2) * sx, (big ? 4 : 1.2) * sy);
    }
    world.players.forEach((p, i) => {
      if (p.hero.defeated || (i !== this.lastViewer && !isExplored(world, this.lastViewer, p.hero.tile))) return;
      g.fillStyle = i === 0 ? '#9cc0ff' : '#e0a8ff';
      g.strokeStyle = '#0b1428';
      g.beginPath(); g.arc((p.hero.tile[0] + 0.5) * sx, (p.hero.tile[1] + 0.5) * sy, Math.max(2.5, sx * 0.8), 0, 7); g.fill(); g.stroke();
    });
    // the camera's view
    const vw = this.app.screen.width / this.zoom, vh = this.app.screen.height / this.zoom;
    g.strokeStyle = '#f2d68c';
    g.lineWidth = 1.5;
    g.strokeRect(((this.cam.x - vw / 2) / MW) * W, ((this.cam.y - vh / 2) / MH) * H, (vw / MW) * W, (vh / MH) * H);
  }

  // ------------------------------------------------------------------ state

  /** Redraw everything from the world state, as seen by `viewer`. */
  sync(world: WorldState, viewer: number) {
    this.lastWorld = world;
    this.lastViewer = viewer;
    for (const o of world.objects) {
      const sp = this.objSprites.get(o.id)!;
      sp.visible = !o.gone;
    }
    world.players.forEach((p, i) => {
      const hv = this.heroes[i];
      hv.sprite.visible = !p.hero.defeated && (i === viewer || isExplored(world, viewer, p.hero.tile));
      const c = tileCenter(p.hero.tile);
      hv.sprite.position.set(c.x, c.y + TILE * 0.42);
      hv.sprite.zIndex = c.y + 1;
      hv.sprite.texture = hv.idle;
      hv.sprite.scale.set(hv.baseScale * (i === 1 ? -1 : 1), hv.baseScale);
      hv.sprite.rotation = 0;
    });
    const f = this.flags;
    f.clear();
    for (const o of world.objects) {
      if (o.gone || o.owner == null || (o.type !== 'mine' && o.type !== 'town')) continue;
      const town = o.type === 'town';
      const base = town ? townPos(o) : tileCenter(o.tile);
      const x = base.x + TILE * (town ? 2.4 : 0.75), y = base.y - TILE * (town ? 4.2 : 0.9);
      const h = town ? 44 : 30;
      f.rect(x, y, 3, h).fill({ color: 0xe9e4d6 });
      f.poly([x + 3, y, x + (town ? 34 : 22), y + 8, x + 3, y + (town ? 17 : 12)]).fill({ color: FLAG[o.owner] }).stroke({ width: 1, color: 0x0b1428 });
    }
    const cur = world.players[world.turn].hero;
    this.ring.clear();
    if (!cur.defeated && world.turn === viewer) {
      const c = tileCenter(cur.tile);
      this.ring.ellipse(c.x, c.y + TILE * 0.38, TILE * 0.55, TILE * 0.22).stroke({ width: 3, color: 0xf2d68c });
    }
    const g = this.fog;
    g.clear();
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (isExplored(world, viewer, [x, y])) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isExplored(world, viewer, [x + dx, y + dy]));
      g.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0x05080f, alpha: edge ? 0.72 : 0.97 });
    }
    this.drawMinimap();
  }

  /** Path preview: green steps within today's movement, red beyond. */
  showPath(path: Tile[] | null, cost: number[] | null, mp: number) {
    const g = this.pathG;
    g.clear();
    if (!path || !cost) return;
    let prev: { x: number; y: number } | null = null;
    path.forEach((t, i) => {
      const c = tileCenter(t);
      const ok = cost[i] <= mp;
      const last = i === path.length - 1;
      if (prev) {
        // a small arrow pointing along the route, HoMM style
        const a = Math.atan2(c.y - prev.y, c.x - prev.x);
        const tip = { x: c.x - Math.cos(a) * 6, y: c.y - Math.sin(a) * 6 };
        g.moveTo(tip.x - Math.cos(a - 0.6) * 12, tip.y - Math.sin(a - 0.6) * 12).lineTo(tip.x, tip.y).lineTo(tip.x - Math.cos(a + 0.6) * 12, tip.y - Math.sin(a + 0.6) * 12)
          .stroke({ width: 5, color: 0x0b1428, alpha: 0.7 })
          .moveTo(tip.x - Math.cos(a - 0.6) * 12, tip.y - Math.sin(a - 0.6) * 12).lineTo(tip.x, tip.y).lineTo(tip.x - Math.cos(a + 0.6) * 12, tip.y - Math.sin(a + 0.6) * 12)
          .stroke({ width: 3, color: ok ? 0x5ce05a : 0xe0503a });
      }
      if (last) g.circle(c.x, c.y, 9).fill({ color: ok ? 0x5ce05a : 0xe0503a }).stroke({ width: 2, color: 0x0b1428 });
      prev = c;
    });
  }

  // ------------------------------------------------------------------ animation

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

  /** Walk a hero along tiles: walk-cycle frames if we have them, plus a gait bob, a lean and hoof dust. */
  async walk(player: number, from: Tile, steps: Tile[]) {
    const hv = this.heroes[player], sp = hv.sprite;
    const STEP_MS = 230;
    this.ring.visible = false;
    let prev = from, frame = 0, elapsed = 0;
    const start = tileCenter(from);
    this.keepInView(start.x, start.y);
    for (const t of steps) {
      const a = tileCenter(prev), b = tileCenter(t);
      const dir = b.x === a.x ? Math.sign(sp.scale.x) || 1 : b.x > a.x ? 1 : -1;
      const sc = hv.frames.length ? hv.frameScale : hv.baseScale;
      sp.scale.set(sc * dir, sc);
      if (hv.frames.length) sp.anchor.set(0.5, 0.97);
      this.dust(a.x, a.y + TILE * 0.4);
      await this.tween(STEP_MS, k => {
        const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
        const phase = (elapsed + k * STEP_MS) / 115;
        sp.position.set(x, y + TILE * 0.42 - Math.abs(Math.sin(phase * Math.PI)) * 5);
        sp.rotation = Math.sin(phase * Math.PI) * 0.035 * dir;
        sp.zIndex = y + 1;
        if (hv.frames.length) {
          const f = Math.floor((elapsed + k * STEP_MS) / 95) % hv.frames.length;
          if (f !== frame) { frame = f; sp.texture = hv.frames[f]; }
        }
        this.keepInView(x, y);
      });
      elapsed += STEP_MS;
      prev = t;
    }
    this.ring.visible = true;
    sp.texture = hv.idle;
    sp.anchor.set(0.5, 0.92);
    sp.scale.set(hv.baseScale * Math.sign(sp.scale.x || 1), hv.baseScale);
    sp.rotation = 0;
    const end = tileCenter(prev);
    sp.position.set(end.x, end.y + TILE * 0.42);
  }

  private dust(x: number, y: number) {
    const g = new Graphics();
    for (let i = 0; i < 3; i++) g.circle((i - 1) * 7, -i * 2, 5 + i).fill({ color: 0xd8c49a, alpha: 0.55 });
    g.position.set(x, y);
    this.fx.addChild(g);
    void this.tween(520, k => { g.alpha = 1 - k; g.scale.set(1 + k * 0.8); g.y = y - k * 8; }).then(() => g.destroy());
  }

  float(text: string, t: Tile, color = 0xffe7a0) {
    const c = tileCenter(t);
    const tx = new Text({ text, style: { fontFamily: 'Alegreya, Georgia, serif', fontSize: 24, fontWeight: '700', fill: color, stroke: { color: 0x0b1428, width: 5 } } });
    tx.anchor.set(0.5);
    tx.position.set(c.x, c.y - 40);
    this.fx.addChild(tx);
    void this.tween(1400, k => { tx.y = c.y - 40 - 40 * k; tx.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3; }).then(() => tx.destroy());
  }
}
