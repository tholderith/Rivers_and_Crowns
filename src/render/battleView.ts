// Pixi rendering of a battle: battlefield, hex grid, units, highlights and animations.
// It reads the battle state and plays back the events the simulation produces; it never
// changes the state itself. Clicks and hovers are reported back as hexes.

import { Application, Container, Graphics, Sprite, Text, type Texture, type FederatedPointerEvent } from 'pixi.js';
import { type BattleEvent, type BattleState, type Stack, alive, byId, has, unitOf } from '../sim/battle';
import { type Hex, COLS, allHexes } from '../sim/hex';
import { PROPS, asset, poseUrl, type Pose } from './assets';

export const W = 1600, H = 900;
const R = 64; // hex radius (pointy top)
const HW = Math.sqrt(3) * R; // hex width
const X0 = (W - (COLS * HW + HW / 2)) / 2 + HW / 2;
const Y0 = 222;
const RS = R * 1.5;
const UNIT_H = 118;
const FACTION_COLOR: Record<string, number> = { french: 0x2f5aa8, haudenosaunee: 0x7a3b8f };

export function center(h: Hex): { x: number; y: number } {
  return { x: X0 + h.col * HW + (h.row & 1 ? HW / 2 : 0), y: Y0 + h.row * RS };
}

function hexPoints(h: Hex, shrink = 0): number[] {
  const { x, y } = center(h);
  const r = R - shrink;
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  return pts;
}

export function hexAt(x: number, y: number): Hex | null {
  let best: Hex | null = null, bd = Infinity;
  for (const h of allHexes()) {
    const c = center(h);
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bd) { bd = d; best = h; }
  }
  return bd <= R * R ? best : null;
}

interface UnitView {
  root: Container;
  body: Sprite;
  tag: Container; // badge + icons, lives in the labels layer
  badge: Container;
  badgeText: Text;
  icons: Container;
  scale: number;
  dir: 1 | -1;
}

export interface Highlights {
  active?: Hex;
  reachable?: Hex[];
  targets?: Hex[];
  hover?: Hex | null;
  path?: Hex[];
  pick?: Hex[]; // hexes valid for a pending ability
}

export class BattleView {
  app = new Application();
  private tex: Record<string, Texture> = {};
  private ground = new Container();
  private overlay = new Graphics();
  private objects = new Container();
  private labels = new Container(); // count badges and status icons, always above units
  private fx = new Container();
  private units = new Map<string, UnitView>();
  private works = new Set<string>();
  speed = 1;
  onHover: (h: Hex | null, x: number, y: number) => void = () => {};
  onClick: (h: Hex, x: number, y: number) => void = () => {};

  async init(host: HTMLElement, textures: Record<string, Texture>, background: string) {
    this.tex = textures;
    await this.app.init({ width: W, height: H, background: '#0b1428', antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    host.appendChild(this.app.canvas);
    const bg = new Sprite(this.tex[asset(`scenes/${background}.webp`)]);
    const s = Math.max(W / bg.texture.width, H / bg.texture.height);
    bg.scale.set(s);
    bg.position.set((W - bg.texture.width * s) / 2, (H - bg.texture.height * s) / 2);
    this.objects.sortableChildren = true;
    this.app.stage.addChild(bg, this.ground, this.overlay, this.objects, this.labels, this.fx);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = { contains: () => true };
    this.app.stage.on('pointermove', (e: FederatedPointerEvent) => this.onHover(hexAt(e.global.x, e.global.y), e.global.x, e.global.y));
    this.app.stage.on('pointerleave', () => this.onHover(null, 0, 0));
    this.app.stage.on('pointertap', (e: FederatedPointerEvent) => {
      const h = hexAt(e.global.x, e.global.y);
      if (h) this.onClick(h, e.global.x, e.global.y);
    });
  }

  /** Build the static field (grid, woods, rocks) and one view per stack. */
  build(st: BattleState) {
    const grid = new Graphics();
    for (const h of allHexes()) grid.poly(hexPoints(h)).stroke({ width: 1.5, color: 0x1c2a10, alpha: 0.35 });
    for (const k of st.woods) grid.poly(hexPoints(fromKeyLocal(k), 2)).fill({ color: 0x1e3a14, alpha: 0.22 });
    this.ground.addChild(grid);
    st.woods.forEach((k, i) => {
      const h = fromKeyLocal(k);
      const kind = [PROPS.maples, PROPS.pines, PROPS.pines, PROPS.maples, PROPS.thicket][(h.col * 7 + h.row * 3 + i) % 5];
      this.addProp(kind, h, 0.86, -18);
    });
    for (const k of st.rocks) this.addProp(PROPS.boulder, fromKeyLocal(k), 0.8, 18);
    for (const s of st.stacks) this.addUnit(st, s);
    this.sync(st);
  }

  private addProp(url: string, h: Hex, widthFrac: number, dy: number) {
    const sp = new Sprite(this.tex[url]);
    sp.anchor.set(0.5, 0.9);
    sp.scale.set((HW * widthFrac) / sp.texture.width);
    const c = center(h);
    sp.position.set(c.x, c.y + dy);
    sp.zIndex = c.y + dy;
    this.objects.addChild(sp);
  }

  private addUnit(st: BattleState, s: Stack) {
    const ready = this.tex[poseUrl(s.unit, 'ready')];
    const scale = Math.min(UNIT_H / ready.height, 150 / ready.width);
    const dir: 1 | -1 = s.side === 0 ? 1 : -1;
    const root = new Container();
    const body = new Sprite(ready);
    body.anchor.set(0.5, 1);
    body.scale.set(scale * dir, scale);
    const badge = new Container();
    const color = FACTION_COLOR[st.sides[s.side].faction] ?? 0x555555;
    const g = new Graphics().roundRect(-24, -13, 48, 26, 6).fill({ color }).stroke({ width: 2, color: 0xf2d68c });
    const badgeText = new Text({ text: String(s.count), style: { fontFamily: 'Alegreya, Georgia, serif', fontSize: 18, fontWeight: '700', fill: 0xfff6e0 } });
    badgeText.anchor.set(0.5);
    badge.addChild(g, badgeText);
    badge.position.set(30 * dir, -10);
    const icons = new Container();
    icons.position.set(-34 * dir, -16);
    root.addChild(body);
    const tag = new Container();
    tag.addChild(badge, icons);
    this.objects.addChild(root);
    this.labels.addChild(tag);
    this.units.set(s.id, { root, body, tag, badge, badgeText, icons, scale, dir });
    this.place(s.id, center(s.hex));
  }

  private place(id: string, p: { x: number; y: number }) {
    const v = this.units.get(id)!;
    v.root.position.set(p.x, p.y + 40);
    v.root.zIndex = p.y + 40;
    v.tag.position.set(p.x, p.y + 40);
  }

  private setPose(s: Stack, pose: Pose) {
    const v = this.units.get(s.id)!;
    v.body.texture = this.tex[poseUrl(s.unit, pose)];
  }

  private restPose(s: Stack): Pose {
    if (s.count <= 0) return 'defeated';
    return has(s, 'musket') && !s.loaded ? 'reload' : 'ready';
  }

  /** Bring every unit view in line with the state (counts, poses, positions, icons). */
  sync(st: BattleState) {
    for (const s of st.stacks) {
      const v = this.units.get(s.id);
      if (!v) continue;
      this.place(s.id, center(s.hex));
      this.setPose(s, this.restPose(s));
      v.badgeText.text = String(s.count);
      v.tag.visible = s.count > 0;
      v.root.alpha = s.count > 0 ? 1 : 0.5;
      if (s.count <= 0) v.root.zIndex = center(s.hex).y - 30; // corpses lie under the living
      v.icons.removeChildren();
      if (s.count > 0) {
        const icons: string[] = [];
        if (has(s, 'musket') && !s.loaded) icons.push(PROPS.iconUnloaded);
        if (s.wavering) icons.push(PROPS.iconWavering);
        if (s.rallied > 0) icons.push(PROPS.iconRallied);
        if (s.defending) icons.push(PROPS.iconDefend);
        icons.forEach((u, i) => {
          const ic = new Sprite(this.tex[u]);
          ic.anchor.set(0.5);
          ic.scale.set(24 / Math.max(ic.texture.width, ic.texture.height));
          ic.position.set(0, -i * 26);
          v.icons.addChild(ic);
        });
      }
    }
    for (const k of st.works) {
      if (this.works.has(k)) continue;
      this.works.add(k);
      this.addProp(PROPS.fence, fromKeyLocal(k), 0.7, 22);
    }
  }

  highlight(st: BattleState, hl: Highlights) {
    const g = this.overlay;
    g.clear();
    for (const h of hl.reachable ?? []) g.poly(hexPoints(h, 3)).fill({ color: 0xffffff, alpha: 0.13 });
    for (const h of hl.pick ?? []) g.poly(hexPoints(h, 3)).fill({ color: 0x8fd07a, alpha: 0.22 }).stroke({ width: 2, color: 0x8fd07a, alpha: 0.8 });
    if (hl.active) g.poly(hexPoints(hl.active, 2)).fill({ color: 0xf2d68c, alpha: 0.25 }).stroke({ width: 3, color: 0xf2d68c });
    for (const h of hl.targets ?? []) g.poly(hexPoints(h, 4)).stroke({ width: 3, color: 0xe0705a, alpha: 0.9 });
    if (hl.path && hl.path.length > 1) for (const h of hl.path.slice(1)) { const c = center(h); g.circle(c.x, c.y, 7).fill({ color: 0xf2d68c, alpha: 0.9 }); }
    if (hl.hover) g.poly(hexPoints(hl.hover, 1)).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
    void st;
  }

  // ------------------------------------------------------------ animation

  private tween(ms: number, step: (t: number) => void): Promise<void> {
    const dur = ms / this.speed;
    return new Promise(res => {
      let t0 = -1;
      const tick = () => {
        const now = performance.now();
        if (t0 < 0) t0 = now;
        const t = Math.min(1, (now - t0) / dur);
        step(t);
        if (t >= 1) { this.app.ticker.remove(tick); res(); }
      };
      this.app.ticker.add(tick);
    });
  }

  private wait(ms: number) { return this.tween(ms, () => {}); }

  private float(text: string, x: number, y: number, color = 0xffe7a0) {
    const t = new Text({ text, style: { fontFamily: 'Alegreya, Georgia, serif', fontSize: 26, fontWeight: '700', fill: color, stroke: { color: 0x0b1428, width: 5 } } });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fx.addChild(t);
    void this.tween(1100, k => { t.y = y - 50 * k; t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3; }).then(() => t.destroy());
  }

  private puff(url: string, x: number, y: number, width: number, ms = 700, flip = 1) {
    const sp = new Sprite(this.tex[url]);
    sp.anchor.set(0.5);
    const s = width / sp.texture.width;
    sp.scale.set(s * flip, s);
    sp.position.set(x, y);
    this.fx.addChild(sp);
    void this.tween(ms, k => { sp.alpha = 1 - k; sp.scale.set(s * (1 + k * 0.4) * flip, s * (1 + k * 0.4)); sp.y = y - 14 * k; }).then(() => sp.destroy());
  }

  private shake(id: string) {
    const v = this.units.get(id)!;
    const x0 = v.root.x;
    v.body.tint = 0xff9a8a;
    return this.tween(260, k => { v.root.x = x0 + Math.sin(k * Math.PI * 6) * 6 * (1 - k); }).then(() => { v.root.x = x0; v.body.tint = 0xffffff; });
  }

  banner(text: string) {
    const t = new Text({ text, style: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 64, fontWeight: '700', fill: 0xf2d68c, stroke: { color: 0x0b1428, width: 8 } } });
    t.anchor.set(0.5);
    t.position.set(W / 2, 120);
    this.fx.addChild(t);
    void this.tween(1300, k => { t.alpha = k < 0.15 ? k / 0.15 : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1; }).then(() => t.destroy());
  }

  /** Animate a batch of events, then sync to the final state. */
  async play(st: BattleState, events: BattleEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'round':
          if (e.round > 1) this.banner(`Round ${e.round}`);
          break;
        case 'move': {
          const s = byId(st, e.stack);
          const v = this.units.get(e.stack)!;
          for (let i = 1; i < e.path.length; i++) {
            const a = center(e.path[i - 1]), b = center(e.path[i]);
            if (b.x !== a.x) v.body.scale.x = Math.abs(v.body.scale.x) * (b.x > a.x ? 1 : -1);
            await this.tween(150, k => this.place(e.stack, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }));
          }
          v.body.scale.x = Math.abs(v.body.scale.x) * v.dir;
          void s;
          break;
        }
        case 'fire': {
          const a = byId(st, e.stack), v = this.units.get(e.stack)!;
          this.faceToward(e.stack, e.target);
          this.setPose(a, 'attack');
          const sx = v.root.x + 60 * Math.sign(v.body.scale.x), sy = v.root.y - 70;
          if (unitOf(a).id === 'U-FR-05') this.puff(PROPS.cannonBlast, sx + 20 * Math.sign(v.body.scale.x), sy + 30, 150, 900, Math.sign(v.body.scale.x));
          else { this.puff(PROPS.flash, sx, sy, 60, 300, Math.sign(v.body.scale.x)); this.puff(PROPS.puff, sx + 10, sy - 6, 70, 900); }
          await this.wait(330);
          const tv = this.units.get(e.target)!;
          if (e.cover) this.float('cover', tv.root.x, tv.root.y - 150, 0x8fd07a);
          this.float(`−${e.damage}  (${e.killed} fall)`, tv.root.x, tv.root.y - 120);
          const shakes = [this.shake(e.target)];
          for (const x of e.extra ?? []) {
            const ev = this.units.get(x.target)!;
            this.float(`−${x.damage}  (${x.killed})`, ev.root.x, ev.root.y - 120, 0xffb38a);
            shakes.push(this.shake(x.target));
          }
          await Promise.all(shakes);
          await this.wait(150);
          v.body.scale.x = Math.abs(v.body.scale.x) * v.dir;
          break;
        }
        case 'melee': {
          const a = byId(st, e.stack), v = this.units.get(e.stack)!, tv = this.units.get(e.target)!;
          this.faceToward(e.stack, e.target);
          this.setPose(a, 'attack');
          const x0 = v.root.x, y0 = v.root.y, dx = (tv.root.x - x0) * 0.32, dy = (tv.root.y - y0) * 0.32;
          await this.tween(170, k => { v.root.x = x0 + dx * k; v.root.y = y0 + dy * k; v.tag.position.copyFrom(v.root.position); });
          this.puff(PROPS.dust, tv.root.x, tv.root.y - 30, 110, 600);
          this.float(`${e.retaliation ? 'Strike back ' : ''}−${e.damage}  (${e.killed} fall)`, tv.root.x, tv.root.y - 120, e.retaliation ? 0xffc8a0 : 0xffe7a0);
          await Promise.all([this.shake(e.target), this.tween(200, k => { v.root.x = x0 + dx * (1 - k); v.root.y = y0 + dy * (1 - k); v.tag.position.copyFrom(v.root.position); })]);
          v.body.scale.x = Math.abs(v.body.scale.x) * v.dir;
          this.setPose(a, this.restPose(a));
          break;
        }
        case 'reload': {
          const s = byId(st, e.stack), v = this.units.get(e.stack)!;
          this.float('Reloaded', v.root.x, v.root.y - 130, 0xcfe8c2);
          this.setPose(s, 'ready');
          await this.wait(250);
          break;
        }
        case 'defend': { const v = this.units.get(e.stack)!; this.float('Defending', v.root.x, v.root.y - 130, 0xcfe8c2); await this.wait(200); break; }
        case 'wait': { const v = this.units.get(e.stack)!; this.float('Waits', v.root.x, v.root.y - 130, 0xa8b1c5); await this.wait(150); break; }
        case 'falter': { const v = this.units.get(e.stack)!; this.float('Falters!', v.root.x, v.root.y - 130, 0xf0a06a); await this.wait(600); break; }
        case 'inspired': { const v = this.units.get(e.stack)!; this.float('Inspired!', v.root.x, v.root.y - 130, 0x8fd07a); await this.wait(400); break; }
        case 'wavering': { const v = this.units.get(e.stack)!; this.float('Wavering', v.root.x, v.root.y - 150, 0xf0a06a); break; }
        case 'destroyed': {
          const s = byId(st, e.stack), v = this.units.get(e.stack)!;
          await this.wait(200);
          this.setPose(s, 'defeated');
          v.tag.visible = false;
          await this.tween(400, k => { v.root.alpha = 1 - 0.5 * k; });
          break;
        }
        case 'ability': this.banner(abilityTitle(e.ability)); await this.wait(500); break;
        default: break;
      }
    }
    this.sync(st);
  }

  private faceToward(id: string, target: string) {
    const v = this.units.get(id)!, t = this.units.get(target)!;
    v.body.scale.x = Math.abs(v.body.scale.x) * (t.root.x >= v.root.x ? 1 : -1);
  }

  livingCount(st: BattleState) { return alive(st).length; }
}

function abilityTitle(a: string) {
  return a === 'rally' ? 'Rally!' : a === 'volley' ? 'Coordinated Volley' : 'Fieldworks';
}

function fromKeyLocal(k: string): Hex {
  const [col, row] = k.split(',').map(Number);
  return { col, row };
}

