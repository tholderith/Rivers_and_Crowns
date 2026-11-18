// The adventure-map screen: runs the world turn loop, the AI rival, recruiting, and
// hands encounters to the battle screen (or resolves them instantly when no human fights).

import {
  type Tile, type WorldEvent, type WorldState, RESOURCES, aiTarget, createWorld, dayOfWeek, encounterArmies, endTurn,
  findPath, guardsNear, isExplored, moveHero, objectAt, recruit, resolveBattle, terrainAt, townHere, unitCost, weekOf, armyPower,
  garrisonOf, transfer, MAX_STACKS,
  BUILDINGS, aiManageTowns, build, cannotBuild, wallsOf, type WObject,
} from '../sim/world';
import { type ArmySetup, type BattleState, UNITS, act, begin, createCustomBattle } from '../sim/battle';
import { chooseAbility, chooseAction } from '../sim/ai';
import { MapView, loadMapTextures } from '../render/mapView';
import { asset, poseUrl } from '../render/assets';
import battlesJson from '../data/battles.json';
import { music } from '../audio/music';

type Ctrl = 'human' | 'ai';
type PlayBattle = (st: BattleState, ctrl: [Ctrl, Ctrl]) => Promise<BattleState>;

const $ = (id: string) => document.getElementById(id)!;
const RES_ICON: Record<string, string> = { coin: 'I-01/I-01-01', timber: 'I-01/I-01-02', provisions: 'I-01/I-01-03', iron: 'I-01/I-01-04' };
const TERRAIN_NAME: Record<string, string> = { '.': 'Open ground', f: 'Forest', F: 'Ford', P: 'Portage', '~': 'River', '^': 'Rock' };
const forestEdge = (battlesJson as Record<string, { woods: string[]; rocks: string[] }>)['forest-edge'];
const PRESETS: Record<string, { woods: string[]; rocks: string[] }> = {
  'B-01': forestEdge,
  'B-02': { woods: ['0,0', '1,0', '9,0', '10,0', '0,6', '10,6', '4,3'], rocks: ['5,1', '6,5'] },
  'B-03': { woods: ['2,1', '3,4', '7,2', '8,5', '5,0', '5,6', '1,5', '9,1', '6,3'], rocks: ['4,2', '6,5'] },
  'B-04': { woods: ['0,0', '0,6'], rocks: ['5,3'] },
  'B-05': { woods: ['0,0', '0,6', '10,0'], rocks: ['5,3'] },
};
const TOWN_HERO: Record<string, { name: string; portrait: string }> = {
  french: { name: 'Antoine Lefèvre', portrait: 'H-FR-02' },
  haudenosaunee: { name: 'Clan Mother', portrait: 'H-HD-01' },
};

let world: WorldState;
let view: MapView;
let control: [Ctrl, Ctrl];
let playBattle: PlayBattle;
let exitToMenu: () => void;
let busy = false;
let planned: { to: Tile; path: Tile[]; cost: number[] } | null = null;
let battleSeed = 1;

const viewer = (): number => {
  const humans = control.map((c, i) => (c === 'human' ? i : -1)).filter(i => i >= 0);
  return humans.length === 1 ? humans[0] : humans.length === 2 ? world.turn : 0;
};
const humanTurn = () => control[world.turn] === 'human' && world.winner === null;

export async function startCampaign(ctrl: [Ctrl, Ctrl], play: PlayBattle, onExit: () => void) {
  control = ctrl;
  playBattle = play;
  exitToMenu = onExit;
  world = createWorld(Date.now() % 100000);
  $('map').hidden = false;
  $('mapstage').innerHTML = '';
  view = new MapView();
  await view.init($('mapstage'), world, await loadMapTextures(world));
  view.onHover = onHover;
  view.onClick = onClick;
  view.attachMinimap($('minimap') as HTMLCanvasElement);
  view.centerOn(world.players[viewer()].hero.tile, true);
  render();
  if (!humanTurn()) await aiTurn();
}

// ------------------------------------------------------------------ rendering

/** The map theme of whichever faction's player is looking at the map. */
const mapTrack = () => (world.players[viewer()].faction === 'french' ? 'map-french' : 'map-haudenosaunee');

function render() {
  const v = viewer();
  if ($('recruit').hidden && !$('map').hidden) music.play(mapTrack());
  view.sync(world, v);
  const pl = world.players[world.turn], me = world.players[v];
  $('mapres').innerHTML = RESOURCES.map(r => `<span title="${r}"><img src="${asset(`sprites/${RES_ICON[r]}.webp`)}" alt="${r}">${me.resources[r].toLocaleString('en-US')}</span>`).join('');
  $('mapday').innerHTML = `<b>Week ${weekOf(world.day)} · Day ${dayOfWeek(world.day)}</b>${pl.name} to move`;
  const h = pl.hero;
  $('side').innerHTML = `
    <div class="sidehero"><img src="${asset(`portraits/${h.portrait}/${h.portrait}-01.webp`)}" alt=""><div><b>${h.name}</b><span>${pl.name} · ${control[world.turn] === 'human' ? 'You' : 'AI'}</span></div></div>
    <div class="mpbar" title="Movement left today"><i style="width:${Math.round((h.mp / h.mpMax) * 100)}%"></i><span>Movement ${Math.floor(h.mp / 10)} / ${h.mpMax / 10}</span></div>
    <div class="army">${h.defeated ? '<p class="muted">Beaten. A new band musters at home next turn.</p>' : h.army.map(a => `<div class="slot" title="${UNITS[a.unit].name}"><img src="${poseUrl(a.unit, 'ready')}" alt="${UNITS[a.unit].name}"><b>${a.count}</b></div>`).join('')}</div>
    <div class="sidebtns">
      ${world.objects.filter(o => o.type === 'town' && o.owner === world.turn && !o.gone).map(o => `<button class="btn" data-town="${o.id}" ${humanTurn() && !busy ? '' : 'disabled'}>${o.name}${townHere(world, world.turn)?.id === o.id ? ' (hero at the gate)' : ''}</button>`).join('')}
      <button class="btn cmd" id="btnEnd" ${humanTurn() && !busy ? '' : 'disabled'}>End turn</button>
      <button class="btn" id="btnMenu">Main menu</button>
    </div>
    <ol class="log">${world.log.slice(-7).reverse().map(l => `<li>${l}</li>`).join('')}</ol>`;
  $('btnEnd').onclick = () => void nextTurn();
  $('side').querySelectorAll<HTMLButtonElement>('[data-town]').forEach(b => b.onclick = () => void openTown(b.dataset.town!));
  $('btnMenu').onclick = () => { $('map').hidden = true; exitToMenu(); };
}

function onHover(t: Tile | null) {
  const tip = $('maptip');
  if (!t || busy || !isExplored(world, viewer(), t)) { tip.hidden = true; return; }
  const o = objectAt(world, t);
  const g = guardsNear(world, t)[0];
  const lines: string[] = [];
  if (o) {
    if (o.type === 'guard') lines.push(`<b>${o.name}</b>${o.army!.map(a => `${a.count} ${UNITS[a.unit].name}`).join(', ')}<small>${strength(o.army!)}</small>`);
    else if (o.type === 'mine') lines.push(`<b>${o.name}</b>+${Object.entries(o.income ?? {}).map(([r, n]) => `${n} ${r}`).join(', ')} a day${o.owner != null ? `<small>Held by ${world.players[o.owner].name}</small>` : '<small>Unclaimed</small>'}`);
    else if (o.type === 'town') lines.push(`<b>${o.name}</b>${world.players[o.owner ?? 0]?.name ?? ''}${o.owner !== world.turn ? `<small>Capture it to win · ${strength(o.army ?? [])}</small>` : '<small>Your town: recruit here</small>'}`);
    else if (o.type === 'tower') lines.push(`<b>${o.name}</b>Climb it to see far across the basin`);
    else lines.push(`<b>Supplies</b>${o.give ? Object.entries(o.give).map(([r, n]) => `${n} ${r}`).join(', ') : ''}${o.bonus === 'reveal' ? 'A chart of the whole basin' : ''}${o.bonus === 'command' ? ' · dispatches' : ''}`);
  } else {
    lines.push(`<b>${TERRAIN_NAME[terrainAt(world, t)] ?? ''}</b>${g ? `Guarded by the ${g.name}` : ''}`);
  }
  if (humanTurn()) {
    const r = findPath(world, world.turn, t);
    if (r) lines.push(`<small>${Math.ceil(r.cost[r.cost.length - 1] / 10)} movement · ${r.cost[r.cost.length - 1] <= world.players[world.turn].hero.mp ? 'reachable today' : 'more than one day'}</small>`);
  }
  tip.innerHTML = lines.join('');
  const sp = view.tileToScreen(t);
  tip.style.left = `${sp.x}px`;
  tip.style.top = `${sp.y}px`;
  tip.hidden = false;
}

function strength(army: { unit: string; count: number }[]): string {
  const mine = armyPower(world.players[world.turn].hero.army), theirs = armyPower(army);
  const r = theirs / Math.max(1, mine);
  return r < 0.5 ? 'Much weaker than your army' : r < 0.85 ? 'Weaker than your army' : r < 1.2 ? 'About as strong as your army' : r < 2 ? 'Stronger than your army' : 'Far stronger than your army';
}

async function onClick(t: Tile) {
  if (busy || !humanTurn()) return;
  if (planned && planned.to[0] === t[0] && planned.to[1] === t[1]) {
    const path = planned.path;
    planned = null;
    view.showPath(null, null, 0);
    await walk(path);
    return;
  }
  const r = findPath(world, world.turn, t);
  if (!r) { planned = null; view.showPath(null, null, 0); return; }
  planned = { to: t, ...r };
  view.showPath(r.path, r.cost, world.players[world.turn].hero.mp);
}

// ------------------------------------------------------------------ turn flow

async function walk(path: Tile[]) {
  busy = true;
  render();
  const p = world.turn, from = [...world.players[p].hero.tile] as Tile;
  const events = moveHero(world, path);
  await animate(p, from, events);
  if (world.encounter) await fight();
  busy = false;
  render();
  if (world.winner !== null) return finish();
  const town = events.find(e => e.type === 'town');
  const here = townHere(world, world.turn);
  if (town && here && humanTurn()) { townTab = 'army'; void openTown(here.id); }
}

async function animate(p: number, from: Tile, events: WorldEvent[]) {
  const steps = events.filter((e): e is Extract<WorldEvent, { type: 'step' }> => e.type === 'step').map(e => e.tile);
  const visible = p === viewer() || steps.some(s => isExplored(world, viewer(), s));
  if (steps.length && visible) await view.walk(p, from, steps);
  for (const e of events) {
    const at = world.players[p].hero.tile;
    if (e.type === 'collect') view.float(e.text.split('.')[0], at);
    if (e.type === 'flag') view.float('Captured!', at, 0x8fd07a);
    if (e.type === 'encounter') view.float('To arms!', at, 0xf0a06a);
  }
  view.sync(world, viewer());
}

async function fight() {
  const p = world.turn, att = world.players[p];
  const e = world.encounter!;
  const d = encounterArmies(world);
  if (!d.army.some(a => a.count > 0)) { // nobody home: walk in unopposed
    resolveBattle(world, true, att.hero.army.map(a => a.count), []);
    view.float('Taken unopposed!', att.hero.tile, 0x8fd07a);
    return;
  }
  const left: ArmySetup = { faction: att.faction, name: att.name, hero: { name: att.hero.name, portrait: att.hero.portrait, attack: att.hero.attack, defense: att.hero.defense, command: att.hero.command }, army: att.hero.army };
  let rightHero = { name: d.defenderName, portrait: d.army[0]?.unit ?? '', attack: 0, defense: 0, command: 0 };
  let defenderPlayer: number | null = null;
  if (e.kind === 'hero') {
    const dh = world.players[e.player].hero;
    rightHero = { name: dh.name, portrait: dh.portrait, attack: dh.attack, defense: dh.defense, command: dh.command };
    defenderPlayer = e.player;
  } else if (e.kind === 'town') {
    const o = world.objects.find(x => x.id === e.object)!;
    rightHero = { ...TOWN_HERO[o.faction!], attack: 1, defense: 2, command: 3 };
    defenderPlayer = o.owner ?? null;
  }
  const bg = e.kind === 'town' ? (d.defenderFaction === 'french' ? 'B-04' : 'B-05') : d.terrain === 'f' ? 'B-03' : d.terrain === 'F' || d.terrain === 'P' ? 'B-02' : 'B-01';
  const right: ArmySetup = { faction: d.defenderFaction, name: d.defenderName, hero: rightHero, army: d.army };
  const bst = createCustomBattle(`map-${battleSeed}`, world.day * 1000 + battleSeed++, left, right, bg, PRESETS[bg].woods, PRESETS[bg].rocks);
  if (e.kind === 'town') {
    const walls = wallsOf(world.objects.find(x => x.id === (e as { object: string }).object)!);
    bst.works = walls >= 2 ? ['8,0', '8,1', '8,2', '8,4', '8,5', '8,6'] : walls === 1 ? ['8,1', '8,3', '8,5'] : [];
  }
  const ctrl: [Ctrl, Ctrl] = [control[p], defenderPlayer != null ? control[defenderPlayer] : 'ai'];
  let result: BattleState;
  if (ctrl[0] === 'ai' && ctrl[1] === 'ai') {
    result = autoResolve(bst);
  } else {
    $('map').hidden = true;
    result = await playBattle(bst, ctrl);
    $('map').hidden = false;
  }
  const survivors = (side: 0 | 1) => result.stacks.filter(s => s.side === side).map(s => s.count);
  const won = result.winner === 0;
  resolveBattle(world, won, survivors(0), survivors(1));
  view.float(won ? 'Victory' : 'Defeat', world.players[p].hero.tile, won ? 0x8fd07a : 0xf0a06a);
}

function autoResolve(bst: BattleState): BattleState {
  begin(bst);
  for (let n = 0; n < 3000 && bst.winner === null; n++) {
    const ab = chooseAbility(bst);
    if (ab) act(bst, ab);
    act(bst, chooseAction(bst));
  }
  return bst;
}

async function aiTurn() {
  busy = true;
  aiManageTowns(world);
  render();
  for (let i = 0; i < 10 && world.winner === null; i++) {
    const t = aiTarget(world);
    if (!t) break;
    const r = findPath(world, world.turn, t);
    if (!r) break;
    const p = world.turn, from = [...world.players[p].hero.tile] as Tile;
    const ev = moveHero(world, r.path);
    if (!ev.length) break;
    await animate(p, from, ev);
    if (world.encounter) await fight();
    render();
    await new Promise(res => setTimeout(res, 150));
  }
  aiManageTowns(world);
  busy = false;
  if (world.winner !== null) return finish();
  await nextTurn();
}

async function nextTurn() {
  if (busy) return;
  planned = null;
  view.showPath(null, null, 0);
  closeRecruit();
  endTurn(world);
  const hot = control[0] === 'human' && control[1] === 'human';
  render();
  if (hot) await passScreen();
  if (humanTurn()) view.centerOn(world.players[world.turn].hero.tile);
  if (!humanTurn()) await aiTurn();
}

function passScreen(): Promise<void> {
  const el = $('pass');
  el.innerHTML = `<div class="card"><h2>${world.players[world.turn].name}</h2><p>Week ${weekOf(world.day)}, day ${dayOfWeek(world.day)}. Pass the screen to the ${world.players[world.turn].name} player.</p><button class="choice primary" id="passGo"><b>Begin turn</b><span>${world.players[world.turn].hero.name} awaits orders</span></button></div>`;
  el.hidden = false;
  return new Promise(res => { $('passGo').onclick = () => { el.hidden = true; render(); res(); }; });
}

function finish() {
  const humansWon = control.map((c, i) => (c === 'human' ? i : -1)).filter(i => i >= 0);
  music.play(humansWon.length !== 1 || humansWon[0] === world.winner ? 'victory' : 'defeat');
  const el = $('end');
  const w = world.winner!;
  const humans = control.map((c, i) => (c === 'human' ? i : -1)).filter(i => i >= 0);
  const title = humans.length === 1 ? (humans[0] === w ? 'Victory' : 'Defeat') : `${world.players[w].name} Win`;
  el.style.backgroundImage = `url(${asset(`scenes/${humans.length !== 1 || humans[0] === w ? 'K-06' : 'K-07'}.webp`)})`;
  el.innerHTML = `<div class="card"><h2>${title}</h2><p>${world.players[w].name} took the enemy town in week ${weekOf(world.day)}, day ${dayOfWeek(world.day)}.</p>
    <div class="choices"><button class="choice primary" id="endMenu"><b>Main menu</b><span>Play again</span></button></div></div>`;
  el.hidden = false;
  $('endMenu').onclick = () => { el.hidden = true; $('map').hidden = true; exitToMenu(); };
}

// ------------------------------------------------------------------ town screen

let townTab: 'build' | 'recruit' | 'army' = 'build';
const layerCache: Record<string, { size: [number, number]; draw_order: string[]; layers: Record<string, { left: number; top: number; width: number; replaces?: string; adds_to?: string }> }> = {};

async function townLayers(faction: string) {
  if (!layerCache[faction]) layerCache[faction] = await (await fetch(asset(`towns/${faction}/layers.json`))).json();
  return layerCache[faction];
}

/** The town painting with every standing building drawn on the empty base. */
async function townPicture(o: WObject): Promise<string> {
  const L = await townLayers(o.faction!);
  const defs = BUILDINGS[o.faction!].buildings;
  const built = new Set(o.built ?? []);
  const show = new Set<string>();
  for (const id of built) {
    const d = defs[id];
    if (!d) continue;
    if (d.replaces) { show.delete(defs[d.replaces].layer); show.add(d.layer); }
    else if (!(defs[id] && [...built].some(b => defs[b]?.replaces === id))) show.add(d.layer);
    if (d.adds) show.add(defs[d.adds].layer);
  }
  if (built.size >= 4) show.add('townsfolk');
  const order = [...L.draw_order];
  for (const k of Object.keys(L.layers)) if (!order.includes(k)) {
    const lay = L.layers[k];
    const anchor = lay.replaces ?? lay.adds_to;
    order.splice(anchor ? order.indexOf(anchor) + (lay.adds_to ? 1 : 0) : order.length, 0, k);
  }
  const imgs = order.filter(k => show.has(k) && L.layers[k]).map(k => {
    const v = L.layers[k];
    return `<img src="${asset(`towns/${o.faction}/${k}.webp`)}" alt="" style="left:${v.left * 100}%;top:${v.top * 100}%;width:${v.width * 100}%">`;
  });
  return `<div class="townpic" style="aspect-ratio:${L.size[0]}/${L.size[1]}"><img class="base" src="${asset(`towns/${o.faction}/base.webp`)}" alt="${o.name}">${imgs.join('')}</div>`;
}


async function openTown(townId: string) {
  const town = world.objects.find(o => o.id === townId);
  if (!town || !town.stock || town.owner !== world.turn) return;
  music.play(town.faction === 'french' ? 'town-french' : 'town-haudenosaunee');
  const pl = world.players[world.turn];
  const heroHere = townHere(world, world.turn)?.id === townId;
  const el = $('recruit');
  const defs = BUILDINGS[town.faction!].buildings;
  const cost = (c: Partial<Record<string, number>>) => Object.entries(c).map(([r, n]) => `<span class="cost"><img src="${asset(`sprites/${RES_ICON[r]}.webp`)}" alt="${r}">${n}</span>`).join('');
  const buildList = Object.entries(defs).map(([id, d]) => {
    const why = cannotBuild(world, town.id, id);
    const built = why === 'Built';
    return `<div class="bcard${built ? ' built' : ''}"><div><b>${d.name}</b><span>${d.text}</span><div class="costs">${built ? '<em>Built</em>' : cost(d.cost)}</div></div>
      ${built ? '' : `<button class="btn${why ? '' : ' cmd'}" data-b="${id}" ${why ? 'disabled' : ''} title="${why}">${why || 'Build'}</button>`}</div>`;
  }).join('');
  const recruitList = Object.keys(town.stock).map(u => {
    const n = town.stock![u], c = unitCost(u);
    const afford = Math.min(n, Math.floor(pl.resources.coin / c));
    return `<div class="rrow"><img src="${poseUrl(u, 'ready')}" alt=""><div><b>${UNITS[u].name}</b><span>${UNITS[u].job} · ${c} coin each · ${n} available</span></div>
      <button class="btn" data-u="${u}" data-n="1" ${afford >= 1 ? '' : 'disabled'}>+1</button><button class="btn" data-u="${u}" data-n="${afford}" ${afford >= 1 ? '' : 'disabled'}>All (${afford})</button></div>`;
  }).join('') + '<p class="muted">Recruits join the town garrison. Your hero collects them at the gate (Army tab).</p>';
  const garrison = garrisonOf(town), heroArmy = pl.hero.army;
  const stackRow = (army: { unit: string; count: number }[], side: 'garrison' | 'hero') => {
    const slots = army.map((a, i) => {
      const can = heroHere && !(side === 'hero' && heroArmy.length === 1);
      return `<div class="aslot"><img src="${poseUrl(a.unit, 'ready')}" alt=""><b>${a.count}</b><span>${UNITS[a.unit].name}</span>
        <button class="btn" data-x="${side}" data-i="${i}" data-c="${a.count}" ${can ? '' : 'disabled'}>${side === 'garrison' ? 'To hero ↓' : 'To garrison ↑'}</button>
        ${a.count > 1 ? `<button class="btn" data-x="${side}" data-i="${i}" data-c="${Math.floor(a.count / 2)}" ${heroHere ? '' : 'disabled'}>Half</button>` : ''}</div>`;
    }).join('');
    return slots + Array.from({ length: Math.max(0, MAX_STACKS - army.length) }, () => '<div class="aslot empty"></div>').join('');
  };
  const armyTab = `<div class="armyrow"><h3>Garrison of ${town.name}</h3><div class="aslots">${stackRow(garrison, 'garrison')}</div></div>
    <div class="armyrow"><h3>${pl.hero.name}${heroHere ? '' : ' (away)'}</h3><div class="aslots">${pl.hero.defeated ? '' : stackRow(heroArmy, 'hero')}</div></div>
    <p class="muted">${heroHere ? 'Move troops between the garrison and your hero. The garrison defends the town if it is attacked; an empty town is taken without a fight.' : 'Your hero must be at the town gate to exchange troops.'}</p>`;
  el.innerHTML = `<div class="towncard">
    <div class="townhead"><h2>${town.name}</h2><div class="mapres">${RESOURCES.map(r => `<span><img src="${asset(`sprites/${RES_ICON[r]}.webp`)}" alt="${r}">${pl.resources[r].toLocaleString('en-US')}</span>`).join('')}</div>
      <button class="btn" id="rClose">Back to the map</button></div>
    ${await townPicture(town)}
    <div class="tabs">${(['build', 'recruit', 'army'] as const).map(t => `<button class="btn${townTab === t ? ' armed' : ''}" data-tab="${t}">${t === 'build' ? 'Build' : t === 'recruit' ? 'Recruit' : 'Army'}</button>`).join('')}
      <span class="muted">One building a day. New recruits gather each week.</span></div>
    <div class="tabbody">${townTab === 'build' ? `<div class="bgrid">${buildList}</div>` : townTab === 'recruit' ? recruitList : armyTab}</div></div>`;
  el.hidden = false;
  const again = () => { render(); void openTown(townId); };
  el.querySelectorAll<HTMLButtonElement>('[data-u]').forEach(b => b.onclick = () => { recruit(world, townId, b.dataset.u!, Number(b.dataset.n)); again(); });
  el.querySelectorAll<HTMLButtonElement>('[data-b]').forEach(b => b.onclick = () => { build(world, townId, b.dataset.b!); again(); });
  el.querySelectorAll<HTMLButtonElement>('[data-x]').forEach(b => b.onclick = () => { transfer(world, townId, b.dataset.x as 'garrison' | 'hero', Number(b.dataset.i), Number(b.dataset.c)); again(); });
  el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { townTab = b.dataset.tab as typeof townTab; void openTown(townId); });
  $('rClose').onclick = closeRecruit;
}

function closeRecruit() { $('recruit').hidden = true; if (world && !$('map').hidden) music.play(mapTrack()); }

// test hook for automated playtests
(window as unknown as { __map: unknown }).__map = {
  get world() { return world; },
  get busy() { return busy; },
  walkTo: async (t: Tile) => { const r = findPath(world, world.turn, t); if (r) await walk(r.path); },
  nextTurn: () => nextTurn(),
};
