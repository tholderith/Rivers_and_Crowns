import './ui/style.css';
import {
  ABILITIES, type Ability, type Action, type BattleState, type SideIndex, type Stack, abilityAllowed, act, activeStack,
  adjacentEnemies, alive, battleInfo, begin, canFire, createBattle, firePositions, has, isCover, isShooter, preview,
  reachable, stackAt, unitOf, UNITS, moraleOf,
} from './sim/battle';
import { chooseAbility, chooseAction } from './sim/ai';
import { type Hex, distance, fromKey, key, neighbors, same } from './sim/hex';
import { BattleView, center } from './render/battleView';
import { asset, loadBattleTextures, poseUrl } from './render/assets';

type Controller = 'human' | 'ai';
const BATTLE = 'forest-edge';
const TRAITS: Record<string, string> = {
  musket: 'Musket: must reload after firing',
  skirmish: 'Skirmish: may move 2 hexes and fire',
  drilled: 'Drilled: may move 2 hexes while reloading',
  woodland: 'Woodland: moves through woods at full speed',
  rapid: 'Bow: shoots every turn, never reloads',
  ambush: 'Ambush: +25% damage firing from woods',
  charge: 'Charge: +25% damage after moving 3+ hexes',
  grapeshot: 'Grapeshot: also hits enemies next to the target',
  colours: 'Colours: neighbours never falter, +1 morale',
  inspire: 'Inspire: neighbours get +1 attack and morale',
  bayonet: 'Bayonet: full strength in melee',
  heavy: 'Heavy: cannot enter woods',
};

const $ = (id: string) => document.getElementById(id)!;
let st: BattleState;
let view: BattleView;
let control: [Controller, Controller] = ['human', 'ai'];
let busy = false;
let armed: Ability | null = null;
let hover: Hex | null = null;
let retreatArmed = false;
let seed = Date.now() % 100000;

// ------------------------------------------------------------------ start

function startScreen() {
  const el = $('start');
  el.style.backgroundImage = `url(${asset('scenes/K-01.webp')})`;
  el.hidden = false;
  el.innerHTML = `<div class="card">
    <h1>Rivers &amp; Crowns</h1>
    <p>${battleInfo(BATTLE).name}. A turn-based battle at the edge of the autumn woods.</p>
    <div class="choices">
      <button class="choice primary" data-mode="french"><b>Play New France</b><span>Against the Haudenosaunee AI</span></button>
      <button class="choice" data-mode="haudenosaunee"><b>Play Haudenosaunee</b><span>Against the New France AI</span></button>
      <button class="choice" data-mode="hotseat"><b>Hotseat</b><span>Two players, one screen</span></button>
      <button class="choice" data-mode="watch"><b>Watch AI vs AI</b><span>See how a battle plays out</span></button>
    </div>
    <ul>
      <li>Click an enemy to shoot it, or to march up and attack it in melee.</li>
      <li>Muskets must <b>reload</b> after every shot. Bows never do. That pause is your opponent's chance to close in.</li>
      <li><b>Woods</b> halve incoming fire. Woodland units cross them at full speed.</li>
      <li>Your hero's <b>Command</b> points pay for Rally, Coordinated Volley and Fieldworks, one per round.</li>
    </ul>
  </div>`;
  el.querySelectorAll<HTMLButtonElement>('.choice').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.mode!;
    control = m === 'french' ? ['human', 'ai'] : m === 'haudenosaunee' ? ['ai', 'human'] : m === 'hotseat' ? ['human', 'human'] : ['ai', 'ai'];
    el.hidden = true;
    void newBattle();
  }));
}

async function newBattle() {
  seed += 1;
  st = createBattle(BATTLE, seed);
  $('stage').innerHTML = '';
  view = new BattleView();
  const tex = await loadBattleTextures(battleInfo(BATTLE).background);
  await view.init($('stage'), tex, battleInfo(BATTLE).background);
  view.build(st);
  view.onHover = onHover;
  view.onClick = onClick;
  armed = null;
  busy = false;
  const events = begin(st);
  await view.play(st, events);
  view.banner('Round 1');
  render();
  void loop();
}

// ------------------------------------------------------------------ turn loop

const isHumanTurn = () => { const s = activeStack(st); return !!s && control[s.side] === 'human' && st.winner === null; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms / view.speed));

async function apply(action: Action) {
  const events = act(st, action);
  await view.play(st, events);
}

async function loop() {
  while (st.winner === null && !busy) {
    const s = activeStack(st);
    if (!s) return;
    if (control[s.side] === 'human') { render(); return; }
    busy = true;
    render();
    await sleep(450);
    const ab = chooseAbility(st);
    if (ab) await apply(ab);
    await apply(chooseAction(st));
    busy = false;
  }
  render();
  if (st.winner !== null) endScreen();
}

async function submit(action: Action) {
  if (busy || !isHumanTurn()) return;
  busy = true;
  armed = null;
  retreatArmed = false;
  try {
    await apply(action);
  } catch (err) {
    st.log.push(`Can't do that: ${(err as Error).message}.`);
  }
  busy = false;
  render();
  void loop();
}

// ------------------------------------------------------------------ input

function withHex<T>(s: Stack, h: Hex, fn: () => T): T {
  const saved = s.hex;
  s.hex = h;
  try { return fn(); } finally { s.hex = saved; }
}

/** What clicking this hex would do for the active stack. */
function intent(h: Hex, px = 0, py = 0): { action: Action; label: string; detail?: string } | null {
  const s = activeStack(st);
  if (!s) return null;
  const t = stackAt(st, h);
  if (armed === 'rally') {
    return t && t.side === s.side ? { action: { type: 'ability', ability: 'rally', target: t.id }, label: `Rally ${unitOf(t).name}` } : null;
  }
  if (armed === 'fieldworks') {
    const ok = !t && !isCover(st, h) && !st.rocks.includes(key(h)) && alive(st).some(o => o.side === s.side && distance(o.hex, h) === 1);
    return ok ? { action: { type: 'ability', ability: 'fieldworks', hex: h }, label: 'Build fieldworks here' } : null;
  }
  if (t && t.side !== s.side) {
    if (isShooter(s) && canFire(st, s)) {
      const p = preview(st, s, t, true);
      return { action: { type: 'fire', target: t.id }, label: `Fire: about ${p.damage} damage, ${p.killed} fall`, detail: p.cover ? 'Target is in cover: half damage' : distance(s.hex, t.hex) > unitOf(s).range ? 'Long shot: half damage' : undefined };
    }
    if (isShooter(s) && has(s, 'skirmish') && (s.loaded || !has(s, 'musket'))) {
      const spots = [...firePositions(st, s)].map(([k]) => fromKey(k)).filter(f => withHex(s, f, () => canFire(st, s)));
      spots.sort((a, b) => distance(a, s.hex) - distance(b, s.hex));
      if (spots.length) {
        const p = preview(st, s, t, true, spots[0]);
        return { action: { type: 'fire', target: t.id, from: spots[0] }, label: `Skirmish and fire: about ${p.damage} damage, ${p.killed} fall` };
      }
    }
    const reach = reachable(st, s);
    const spots = [s.hex, ...neighbors(t.hex)].filter(n => distance(n, t.hex) === 1 && reach.has(key(n)));
    if (!spots.length) return null;
    spots.sort((a, b) => {
      const ca = center(a), cb = center(b);
      return ((ca.x - px) ** 2 + (ca.y - py) ** 2) - ((cb.x - px) ** 2 + (cb.y - py) ** 2);
    });
    const from = spots.find(n => same(n, s.hex)) ?? spots[0];
    const moved = reach.get(key(from))!.cost;
    const p = preview(st, s, t, false, from, moved);
    const back = p.killed < t.count && !t.retaliated ? preview(st, t, s, false, t.hex) : null;
    return { action: { type: 'attack', target: t.id, from }, label: `Attack: about ${p.damage} damage, ${p.killed} fall`, detail: back ? `They strike back for about ${Math.round(back.damage * (t.count - p.killed) / t.count)}` : 'No strike back' };
  }
  if (!t) {
    const r = reachable(st, s).get(key(h));
    if (r && r.cost > 0) return { action: { type: 'move', to: h }, label: `Move here`, detail: isCover(st, h) ? 'Woods: cover from fire' : undefined };
  }
  return null;
}

function onHover(h: Hex | null, x: number, y: number) {
  hover = h;
  const tip = $('tip');
  const it = h && isHumanTurn() && !busy ? intent(h, x, y) : null;
  if (it) {
    const rect = (view.app.canvas as HTMLCanvasElement).getBoundingClientRect();
    const k = rect.width / 1600;
    tip.style.left = `${x * k}px`;
    tip.style.top = `${y * k}px`;
    tip.innerHTML = `${it.label}${it.detail ? `<small>${it.detail}</small>` : ''}`;
    tip.hidden = false;
  } else tip.hidden = true;
  const over = h ? stackAt(st, h) : undefined;
  renderInfo(over ?? activeStack(st) ?? undefined);
  drawHighlights(it?.action);
}

function onClick(h: Hex, x: number, y: number) {
  if (!isHumanTurn() || busy) return;
  const it = intent(h, x, y);
  if (it) { $('tip').hidden = true; void submit(it.action); }
}

// ------------------------------------------------------------------ rendering

function drawHighlights(pending?: Action) {
  if (!view) return;
  const s = activeStack(st);
  if (!s || st.winner !== null) { view.highlight(st, {}); return; }
  const human = isHumanTurn() && !busy;
  const reach = human && !armed ? [...reachable(st, s).entries()].filter(([, r]) => r.cost > 0).map(([k]) => fromKey(k)) : [];
  const targets = human && !armed ? alive(st).filter(o => o.side !== s.side && intent(o.hex)).map(o => o.hex) : [];
  let pick: Hex[] = [];
  if (human && armed === 'rally') pick = alive(st).filter(o => o.side === s.side).map(o => o.hex);
  if (human && armed === 'fieldworks') pick = st.stacks.length ? allEmptyNearAllies(s.side) : [];
  let path: Hex[] | undefined;
  if (pending && (pending.type === 'move' || pending.type === 'attack' || pending.type === 'fire')) {
    const to = pending.type === 'move' ? pending.to : pending.from;
    if (to) path = reachable(st, s).get(key(to))?.path;
  }
  view.highlight(st, { active: s.hex, reachable: reach, targets, hover, path, pick });
}

function allEmptyNearAllies(side: SideIndex): Hex[] {
  const out = new Map<string, Hex>();
  for (const o of alive(st)) if (o.side === side) for (const n of neighbors(o.hex)) if (!stackAt(st, n) && !isCover(st, n) && !st.rocks.includes(key(n))) out.set(key(n), n);
  return [...out.values()];
}

function heroCard(i: SideIndex) {
  const sd = st.sides[i];
  const s = activeStack(st);
  const el = $(`hero${i}`);
  el.className = `herocard${i === 1 ? ' right' : ''}${s && s.side === i ? ' turn' : ''}`;
  el.style.setProperty('--fc', sd.faction === 'french' ? 'var(--french)' : 'var(--haud)');
  const pips = Array.from({ length: sd.hero.commandMax }, (_, k) => `<i class="${k < sd.hero.command ? '' : 'off'}"></i>`).join('');
  el.innerHTML = `<img src="${asset(`portraits/${sd.hero.portrait}/${sd.hero.portrait}-01.webp`)}" alt="">
    <div><div class="nm">${sd.hero.name}</div><div class="fx">${sd.name} · ${control[i] === 'human' ? 'You' : 'AI'}</div>
    <div class="fx">Command<span class="pips">${pips}</span></div></div>`;
}

function render() {
  if (!st) return;
  heroCard(0);
  heroCard(1);
  const s = activeStack(st);
  $('round').textContent = st.winner !== null ? 'Battle over' : `Round ${st.round}${s ? ` · ${st.sides[s.side].name} to move` : ''}`;
  // queue
  const ids = [s?.id, ...st.queue].filter(Boolean).slice(0, 11) as string[];
  $('queue').innerHTML = ids.map((id, i) => {
    const o = st.stacks.find(x => x.id === id)!;
    const fc = st.sides[o.side].faction === 'french' ? 'var(--french)' : 'var(--haud)';
    return `<div class="q${i === 0 ? ' now' : ''}" style="--fc:${fc}" title="${unitOf(o).name}"><img src="${poseUrl(o.unit, 'ready')}" alt="${unitOf(o).name}"><b>${o.count}</b></div>`;
  }).join('') + (st.queue.length < 10 ? '<span class="sep">Next round</span>' : '');
  // actions
  const human = isHumanTurn() && !busy;
  const canReload = !!s && has(s, 'musket') && !s.loaded && adjacentEnemies(st, s).length === 0;
  $('actions').innerHTML = [
    `<button class="btn" data-a="reload" ${human && canReload ? '' : 'disabled'}>Reload</button>`,
    `<button class="btn" data-a="defend" ${human ? '' : 'disabled'}>Defend</button>`,
    `<button class="btn" data-a="wait" ${human && s && !s.waited ? '' : 'disabled'}>Wait</button>`,
    `<button class="btn warn" data-a="retreat" ${human ? '' : 'disabled'}>${retreatArmed ? 'Click again to retreat' : 'Retreat'}</button>`,
    `<button class="btn" data-a="speed">Speed ${view.speed}×</button>`,
  ].join('');
  $('abilities').innerHTML = (Object.keys(ABILITIES) as Ability[]).map(a => {
    const ok = human && !!s && abilityAllowed(st, s.side, a);
    return `<button class="btn cmd${armed === a ? ' armed' : ''}" data-ab="${a}" title="${ABILITIES[a].text}" ${ok ? '' : 'disabled'}>${ABILITIES[a].name} <span class="c">◆${ABILITIES[a].cost}</span></button>`;
  }).join('');
  $('log').innerHTML = st.log.slice(-8).reverse().map(l => `<li>${l}</li>`).join('');
  renderInfo(s ?? undefined);
  drawHighlights();
}

function renderInfo(s?: Stack) {
  if (!s) { $('info').innerHTML = ''; return; }
  const u = unitOf(s);
  const status = [
    has(s, 'musket') ? (s.loaded ? 'Loaded' : 'Needs to reload') : '',
    s.wavering ? 'Wavering' : '', s.rallied > 0 ? 'Rallied' : '', s.defending ? 'Defending' : '',
    isCover(st, s.hex) ? 'In cover' : '', `Morale ${moraleOf(st, s) >= 0 ? '+' : ''}${moraleOf(st, s)}`,
  ].filter(Boolean).join(' · ');
  $('info').innerHTML = `<b>${u.name}</b> · ${s.count} of ${s.startCount} · ${st.sides[s.side].name}
    <div class="stats">Attack ${u.attack} · Defense ${u.defense} · Damage ${u.dmg[0]}–${u.dmg[1]} · Health ${u.hp} · Speed ${u.speed}${u.range ? ` · Range ${u.range}` : ' · Melee'}</div>
    <div class="tr">${u.traits.map(t => TRAITS[t]).join(' · ')}</div><div class="stats">${status}</div>`;
}

document.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b || !st) return;
  const s = activeStack(st);
  if (b.dataset.a === 'speed') { view.speed = view.speed === 1 ? 2 : view.speed === 2 ? 4 : 1; render(); return; }
  if (!s || !isHumanTurn() || busy) return;
  if (b.dataset.a === 'reload') void submit({ type: 'reload' });
  if (b.dataset.a === 'defend') void submit({ type: 'defend' });
  if (b.dataset.a === 'wait') void submit({ type: 'wait' });
  if (b.dataset.a === 'retreat') { if (retreatArmed) void submit({ type: 'retreat' }); else { retreatArmed = true; render(); } }
  if (b.dataset.ab) {
    const a = b.dataset.ab as Ability;
    if (a === 'volley') void abilityNow({ type: 'ability', ability: 'volley' });
    else { armed = armed === a ? null : a; render(); }
  }
});

async function abilityNow(action: Action) {
  if (busy) return;
  busy = true;
  try { await apply(action); } catch (err) { st.log.push(`Can't do that: ${(err as Error).message}.`); }
  busy = false;
  render();
}

// ------------------------------------------------------------------ end

function endScreen() {
  const el = $('end');
  const w = st.winner;
  const humanSides = control.map((c, i) => (c === 'human' ? i : -1)).filter(i => i >= 0);
  const won = typeof w === 'number' && humanSides.includes(w);
  const title = w === 'draw' ? 'A Draw' : humanSides.length === 1 ? (won ? 'Victory' : 'Defeat') : `${st.sides[w as number].name} Win`;
  el.style.backgroundImage = `url(${asset(`scenes/${won || humanSides.length !== 1 ? 'K-06' : 'K-07'}.webp`)})`;
  const losses = st.sides.map((sd, i) => {
    const mine = st.stacks.filter(s => s.side === i);
    const lost = mine.reduce((n, s) => n + s.startCount - s.count, 0), total = mine.reduce((n, s) => n + s.startCount, 0);
    return `<li>${sd.name}: lost ${lost} of ${total}</li>`;
  }).join('');
  el.innerHTML = `<div class="card"><h2>${title}</h2><p>The battle lasted ${st.round} rounds.</p><ul>${losses}</ul>
    <div class="choices"><button class="choice primary" data-end="again"><b>Fight again</b><span>Same sides, new dice</span></button>
    <button class="choice" data-end="menu"><b>Main menu</b><span>Choose sides</span></button></div></div>`;
  el.hidden = false;
  el.querySelectorAll<HTMLButtonElement>('[data-end]').forEach(b => b.addEventListener('click', () => {
    el.hidden = true;
    if (b.dataset.end === 'again') void newBattle(); else startScreen();
  }));
}

// test hook: lets automated playtests drive the game the same way a click would
(window as unknown as { __rc: unknown }).__rc = { get st() { return st; }, submit, chooseAction: () => chooseAction(st), isHumanTurn, get busy() { return busy; } };
void UNITS;
startScreen();
