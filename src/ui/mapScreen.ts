// The adventure-map screen: runs the world turn loop, the AI rival, towns, heroes, the
// village, and hands encounters to the battle screen (or resolves them instantly when no human fights).

import {
  type Tile, type WorldEvent, type WorldState, type HeroState, type Res, RESOURCES, aiTarget, createWorld, dayOfWeek, encounterArmies, endTurn,
  findPath, guardsNear, isExplored, moveHero, objectAt, recruit, resolveBattle, terrainAt, townHere, unitCost, weekOf, armyPower,
  garrisonOf, transfer, MAX_STACKS, BUILDINGS, aiManageTowns, build, cannotBuild, wallsOf, type WObject,
  activeHero, selectHero, heroById, aiHeroes, battleHero, chooseSkill, heroPool, hireHero, hireCost, MAX_HEROES,
  maxMove, xpForLevel, SKILLS, MAX_SKILL_LEVEL, villageOffer, signAgreement, recruitAtVillage, swapArmies,
  routeHold, ROUTE_OBJECTS, ROUTE_DAYS, serializeWorld, deserializeWorld,
} from '../sim/world';
import { type ArmySetup, type BattleState, UNITS, act, begin, createCustomBattle } from '../sim/battle';
import { chooseAbility, chooseAction } from '../sim/ai';
import { MapView, loadMapTextures } from '../render/mapView';
import { asset, poseUrl } from '../render/assets';
import battlesJson from '../data/battles.json';
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';

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
  french: { name: 'Town Commandant', portrait: 'H-FR-02' },
  haudenosaunee: { name: 'Town Elders', portrait: 'H-HD-01' },
};
const SAVE_KEY = 'rivers-and-crowns-save';

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
const hero = (): HeroState | undefined => activeHero(world);
const portraitUrl = (h: { portrait: string }) => asset(`portraits/${h.portrait}/${h.portrait}-01.webp`);
const skillIcon = (s: string) => asset(`sprites/skills/${s}.webp`);
const costHtml = (c: Partial<Record<string, number>>) => Object.entries(c).filter(([, n]) => n).map(([r, n]) => `<span class="cost"><img src="${asset(`sprites/${RES_ICON[r]}.webp`)}" alt="${r}">${n}</span>`).join('');
const resBar = (r: Record<Res, number>) => RESOURCES.map(k => `<span title="${k}"><img src="${asset(`sprites/${RES_ICON[k]}.webp`)}" alt="${k}">${r[k].toLocaleString('en-US')}</span>`).join('');
const homeTile = (): Tile => hero()?.tile ?? world.objects.find(o => o.type === 'town' && o.owner === viewer())?.tile ?? [20, 13];

// ------------------------------------------------------------------ start, save and load

export async function startCampaign(ctrl: [Ctrl, Ctrl], play: PlayBattle, onExit: () => void, saved?: WorldState) {
  control = ctrl;
  playBattle = play;
  exitToMenu = onExit;
  world = saved ?? createWorld(Date.now() % 100000);
  busy = false;
  planned = null;
  $('map').hidden = false;
  $('mapstage').innerHTML = '';
  view = new MapView();
  await view.init($('mapstage'), world, await loadMapTextures(world));
  view.onHover = onHover;
  view.onClick = onClick;
  view.attachMinimap($('minimap') as HTMLCanvasElement);
  $('zIn').onclick = () => view.zoomBy(1.25);
  $('zOut').onclick = () => view.zoomBy(0.8);
  $('zHome').onclick = () => view.resetView(homeTile());
  view.centerOn(homeTile(), true);
  render();
  if (!humanTurn()) await aiTurn();
  else await levelUps();
}

/** Is there a saved campaign in this browser? Returns a short description, or null. */
export function savedCampaign(): string | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const { ctrl, world: w } = JSON.parse(raw) as { ctrl: [Ctrl, Ctrl]; world: string };
    const st = deserializeWorld(w);
    const who = ctrl[0] === 'human' && ctrl[1] === 'human' ? 'Hotseat' : st.players[ctrl.indexOf('human')].name;
    return `${who} · week ${weekOf(st.day)}, day ${dayOfWeek(st.day)}`;
  } catch { return null; }
}

export async function continueCampaign(play: PlayBattle, onExit: () => void): Promise<boolean> {
  try {
    const { ctrl, world: w } = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '') as { ctrl: [Ctrl, Ctrl]; world: string };
    await startCampaign(ctrl, play, onExit, deserializeWorld(w));
    return true;
  } catch { return false; }
}

function save(quiet = false) {
  if (world.encounter || world.winner !== null) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ctrl: control, world: serializeWorld(world) }));
    if (!quiet) { const h = hero(); if (h) view.float('Game saved', h.tile, 0x9cc0ff); }
  } catch { /* storage full or blocked: saving is best-effort */ }
}

// ------------------------------------------------------------------ rendering

/** The map theme of whichever faction's player is looking at the map. */
const mapTrack = () => (world.players[viewer()].faction === 'french' ? 'map-french' : 'map-haudenosaunee');

function heroDetail(h: HeroState): string {
  const next = xpForLevel(h.level + 1);
  const skills = Object.entries(h.skills).map(([s, l]) => `<span class="skill" title="${SKILLS[s].name} ${l}: ${SKILLS[s].text[l - 1]}"><img src="${skillIcon(s)}" alt="${SKILLS[s].name}"><i>${l}</i></span>`).join('');
  const mx = maxMove(world, world.turn, h);
  return `<div class="sidehero"><img src="${portraitUrl(h)}" alt=""><div><b>${h.name}</b><span>${h.title} · Level ${h.level}</span>
      <span class="stats" title="Attack · Defense · Command">⚔ ${h.attack} · ⛨ ${h.defense} · ✦ ${h.command}</span></div></div>
    <div class="xpbar" title="Experience"><i style="width:${Math.min(100, Math.round(((h.xp - xpForLevel(h.level)) / Math.max(1, next - xpForLevel(h.level))) * 100))}%"></i><span>XP ${h.xp} / ${next}</span></div>
    ${skills ? `<div class="skills">${skills}</div>` : ''}
    ${h.pendingSkills.length && humanTurn() ? `<button class="btn cmd" id="btnLevel">Choose a new skill (${h.pendingSkills.length})</button>` : ''}
    <div class="mpbar" title="Movement left today"><i style="width:${Math.round((h.mp / Math.max(1, mx)) * 100)}%"></i><span>Movement ${Math.floor(h.mp / 10)} / ${Math.floor(mx / 10)}</span></div>
    <div class="army">${h.army.map(a => `<div class="slot" title="${UNITS[a.unit].name}"><img src="${poseUrl(a.unit, 'ready')}" alt="${UNITS[a.unit].name}"><b>${a.count}</b></div>`).join('')}</div>`;
}

function render() {
  const v = viewer();
  if ($('recruit').hidden && $('dlg').hidden && !$('map').hidden) music.play(mapTrack());
  view.sync(world, v);
  const pl = world.players[world.turn], me = world.players[v];
  $('mapres').innerHTML = resBar(me.resources);
  const held = ROUTE_OBJECTS.filter(id => world.objects.find(o => o.id === id)?.owner === v).length;
  $('mapday').innerHTML = `<b>Week ${weekOf(world.day)} · Day ${dayOfWeek(world.day)}</b>${pl.name} to move
    <span class="routes" title="Hold the ford blockhouse, the portage camp and the Island Trading Post at the start of ${ROUTE_DAYS} of your turns in a row to win">River routes ${held}/3${held === 3 ? ` · ${routeHold(world, v)}/${ROUTE_DAYS} days` : ''}</span>`;
  const h = hero();
  const ok = humanTurn() && !busy;
  const heroes = pl.heroes.map((x, i) => `<button class="herochip${i === pl.active ? ' on' : ''}" data-hero="${x.id}" ${ok ? '' : 'disabled'} title="${x.name}, level ${x.level}">
      <img src="${portraitUrl(x)}" alt=""><span>${x.name.split(' ')[0]}</span><i>${x.level}</i>${x.pendingSkills.length ? '<em>★</em>' : ''}
      <u style="width:${Math.round((x.mp / Math.max(1, maxMove(world, world.turn, x))) * 100)}%"></u></button>`).join('');
  $('side').innerHTML = `
    <div class="heroes">${heroes}${pl.heroes.length < MAX_HEROES ? `<span class="hirehint" title="Hire more heroes in a town (Heroes tab)">${pl.heroes.length}/${MAX_HEROES}</span>` : ''}</div>
    ${h ? heroDetail(h) : '<p class="muted">No heroes in the field. Hire one in a town.</p>'}
    <h3 class="sidehead">Towns</h3>
    <div class="towns">${world.objects.filter(o => o.type === 'town' && o.owner === world.turn && !o.gone).map(o => {
      const g = garrisonOf(o).reduce((n, a) => n + a.count, 0);
      const here = pl.heroes.filter(x => townHere(world, world.turn, x)?.id === o.id).map(x => x.name.split(' ')[0]);
      const canBuild = o.builtDay !== world.day;
      return `<div class="towncardside">
        <button class="townthumb" data-town="${o.id}" ${ok ? '' : 'disabled'} title="Open ${o.name}"><img src="${asset(`sprites/${o.sprite}.webp`)}" alt=""></button>
        <div class="towninfo"><b>${o.name}</b><span>Garrison ${g}${here.length ? ` · ${here.join(', ')} at the gate` : ''}</span><span class="${canBuild ? 'ok' : 'muted'}">${canBuild ? 'Can build today' : 'Built today'}</span>
          <div class="tbtns"><button class="btn" data-town="${o.id}" ${ok ? '' : 'disabled'}>Open</button><button class="btn" data-locate="${o.id}">Show</button></div></div>
      </div>`;
    }).join('') || '<p class="muted">You hold no towns.</p>'}</div>
    <div class="sidebtns">
      <button class="btn cmd" id="btnEnd" ${ok ? '' : 'disabled'}>End turn</button>
      <div class="row2"><button class="btn" id="btnSave" ${ok ? '' : 'disabled'}>Save</button><button class="btn" id="btnMenu">Main menu</button></div>
    </div>
    <ol class="log">${world.log.slice(-7).reverse().map(l => `<li>${l}</li>`).join('')}</ol>`;
  $('btnEnd').onclick = () => void nextTurn();
  $('btnSave').onclick = () => save();
  const lv = document.getElementById('btnLevel');
  if (lv) lv.onclick = () => void levelUps();
  $('side').querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(b => b.onclick = () => pickHero(b.dataset.hero!));
  $('side').querySelectorAll<HTMLButtonElement>('[data-town]').forEach(b => b.onclick = () => void openTown(b.dataset.town!));
  $('side').querySelectorAll<HTMLButtonElement>('[data-locate]').forEach(b => b.onclick = () => { const o = world.objects.find(x => x.id === b.dataset.locate)!; view.centerOn([o.tile[0], o.tile[1] - 2]); });
  $('btnMenu').onclick = () => { $('map').hidden = true; exitToMenu(); };
}

function pickHero(id: string) {
  if (busy || !humanTurn()) return;
  selectHero(world, id);
  planned = null;
  view.showPath(null, null, 0);
  sfx.click();
  const h = hero();
  if (h) view.centerOn(h.tile);
  render();
}

function onHover(t: Tile | null) {
  const tip = $('maptip');
  if (!t || busy || !isExplored(world, viewer(), t)) { tip.hidden = true; return; }
  const o = objectAt(world, t);
  const g = guardsNear(world, t)[0];
  const lines: string[] = [];
  const other = world.players.flatMap((pl, i) => pl.heroes.map(h => ({ h, i }))).find(x => x.h.tile[0] === t[0] && x.h.tile[1] === t[1]);
  if (other) {
    const mine = other.i === world.turn;
    lines.push(`<b>${other.h.name}</b>${world.players[other.i].name} · level ${other.h.level}<small>${mine ? (other.h === hero() ? 'Selected' : 'Click to select; next to your selected hero, click to exchange troops') : strength(other.h.army)}</small>`);
  } else if (o) {
    if (o.type === 'guard') lines.push(`<b>${o.name}</b>${o.army!.map(a => `${a.count} ${UNITS[a.unit].name}`).join(', ')}<small>${strength(o.army!)}</small>`);
    else if (o.type === 'mine') lines.push(`<b>${o.name}</b>+${Object.entries(o.income ?? {}).map(([r, n]) => `${n} ${r}`).join(', ')} a day${ROUTE_OBJECTS.includes(o.id) ? '<small>A river-route post</small>' : ''}${o.owner != null ? `<small>Held by ${world.players[o.owner].name}</small>` : '<small>Unclaimed</small>'}`);
    else if (o.type === 'town') lines.push(`<b>${o.name}</b>${world.players[o.owner ?? 0]?.name ?? ''}${o.owner !== world.turn ? `<small>Capture it to win · ${strength(garrisonOf(o))}</small>` : '<small>Your town: build, recruit, hire heroes</small>'}`);
    else if (o.type === 'village') lines.push(`<b>${o.name}</b>An independent village${o.owner != null ? `<small>Allied to ${world.players[o.owner].name}</small>` : '<small>Visit to talk: alliance, guides, trade</small>'}`);
    else if (o.type === 'tower') lines.push(`<b>${o.name}</b>Climb it to see far across the basin`);
    else lines.push(`<b>Supplies</b>${o.give ? Object.entries(o.give).map(([r, n]) => `${n} ${r}`).join(', ') : ''}${o.bonus === 'reveal' ? 'A chart of the whole basin' : ''}${o.bonus === 'command' ? ' · dispatches' : ''}`);
  } else {
    lines.push(`<b>${TERRAIN_NAME[terrainAt(world, t)] ?? ''}</b>${g ? `Guarded by the ${g.name}` : ''}`);
  }
  const h = hero();
  if (humanTurn() && h && !(other && other.i === world.turn)) {
    const r = findPath(world, world.turn, t);
    if (r) lines.push(`<small>${Math.ceil(r.cost[r.cost.length - 1] / 10)} movement · ${r.cost[r.cost.length - 1] <= h.mp ? 'reachable today' : 'more than one day'}</small>`);
  }
  tip.innerHTML = lines.join('');
  const sp = view.tileToScreen(t);
  tip.style.left = `${sp.x}px`;
  tip.style.top = `${sp.y}px`;
  tip.hidden = false;
}

function strength(army: { unit: string; count: number }[]): string {
  const mine = armyPower(hero()?.army ?? []), theirs = armyPower(army);
  const r = theirs / Math.max(1, mine);
  return r < 0.5 ? 'Much weaker than your army' : r < 0.85 ? 'Weaker than your army' : r < 1.2 ? 'About as strong as your army' : r < 2 ? 'Stronger than your army' : 'Far stronger than your army';
}

async function onClick(t: Tile) {
  if (busy || !humanTurn()) return;
  const h = hero();
  // your own heroes: select, or exchange troops when next to the selected one
  const own = world.players[world.turn].heroes.find(x => x.tile[0] === t[0] && x.tile[1] === t[1]);
  if (own) {
    if (h && own !== h && Math.max(Math.abs(own.tile[0] - h.tile[0]), Math.abs(own.tile[1] - h.tile[1])) <= 1) openExchange(h.id, own.id);
    else pickHero(own.id);
    return;
  }
  if (!h) return;
  // a village next to the hero opens straight away
  const o = objectAt(world, t);
  if (o?.type === 'village' && Math.max(Math.abs(o.tile[0] - h.tile[0]), Math.abs(o.tile[1] - h.tile[1])) <= 1) { openVillage(o.id); return; }
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
  view.showPath(r.path, r.cost, h.mp);
}

// ------------------------------------------------------------------ turn flow

async function walk(path: Tile[]) {
  const h = hero();
  if (!h) return;
  busy = true;
  render();
  const p = world.turn, from = [...h.tile] as Tile;
  const events = moveHero(world, path);
  await animate(p, h.id, from, events);
  if (world.encounter) await fight();
  busy = false;
  render();
  if (world.winner !== null) return finish();
  await levelUps();
  const town = events.find(e => e.type === 'town');
  const here = townHere(world, world.turn);
  if (town && here && humanTurn()) { townTab = 'army'; void openTown(here.id); }
  const vil = events.find((e): e is Extract<WorldEvent, { type: 'village' }> => e.type === 'village');
  if (vil && humanTurn()) openVillage(vil.object);
}

async function animate(p: number, heroId: string, from: Tile, events: WorldEvent[]) {
  const steps = events.filter((e): e is Extract<WorldEvent, { type: 'step' }> => e.type === 'step').map(e => e.tile);
  const visible = p === viewer() || steps.some(s => isExplored(world, viewer(), s));
  if (steps.length && visible) await view.walk(heroId, from, steps);
  const at = heroById(world, heroId)?.hero.tile ?? steps[steps.length - 1] ?? from;
  for (const e of events) {
    if (e.type === 'collect') { view.float(e.text.split('.')[0], at); if (visible) sfx.coins(); }
    if (e.type === 'flag') { view.float('Captured!', at, 0x8fd07a); if (visible) sfx.drum(); }
    if (e.type === 'encounter') view.float('To arms!', at, 0xf0a06a);
  }
  view.sync(world, viewer());
}

async function fight() {
  const p = world.turn, att = world.players[p];
  const e = world.encounter!;
  const d = encounterArmies(world);
  const attacker = heroById(world, d.attacker)!.hero;
  const at = [...attacker.tile] as Tile;
  if (!d.army.some(a => a.count > 0)) { // nobody home: walk in unopposed
    resolveBattle(world, true, attacker.army.map(a => a.count), []);
    view.float('Taken unopposed!', at, 0x8fd07a);
    return;
  }
  const left: ArmySetup = { faction: att.faction, name: att.name, hero: battleHero(world, d.attacker), army: attacker.army };
  let rightHero: ArmySetup['hero'] = { name: d.defenderName, portrait: d.army[0]?.unit ?? '', attack: 0, defense: 0, command: 0 };
  let defenderPlayer: number | null = null;
  if (e.kind === 'hero') {
    rightHero = battleHero(world, e.hero);
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
    const walls = wallsOf(world.objects.find(x => x.id === e.object)!);
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
  const events = resolveBattle(world, won, survivors(0), survivors(1));
  view.float(won ? 'Victory' : 'Defeat', at, won ? 0x8fd07a : 0xf0a06a);
  for (const ev of events) {
    if (ev.type === 'level' && control[ev.player] === 'human') { sfx.fanfare(); const lh = heroById(world, ev.hero); if (lh) view.float(`${lh.hero.name}: level ${ev.level}!`, lh.hero.tile, 0xf2d68c); }
  }
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
  for (const id of aiHeroes(world)) {
    if (world.winner !== null) break;
    if (!selectHero(world, id)) continue;
    for (let i = 0; i < 10 && world.winner === null; i++) {
      const h = heroById(world, id);
      if (!h) break; // beaten in battle
      const t = aiTarget(world);
      if (!t) break;
      const r = findPath(world, world.turn, t);
      if (!r) break;
      const from = [...h.hero.tile] as Tile;
      const ev = moveHero(world, r.path);
      if (!ev.length) break;
      await animate(world.turn, id, from, ev);
      if (world.encounter) await fight();
      render();
      await new Promise(res => setTimeout(res, 150));
    }
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
  closeDlg();
  endTurn(world);
  const hot = control[0] === 'human' && control[1] === 'human';
  render();
  if (world.winner !== null) return finish();
  if (hot) await passScreen();
  if (humanTurn()) {
    save(true); // autosave at the start of each human turn
    view.centerOn(homeTile());
    await levelUps();
  }
  if (!humanTurn()) await aiTurn();
}

function passScreen(): Promise<void> {
  const el = $('pass');
  const pl = world.players[world.turn];
  el.innerHTML = `<div class="card"><h2>${pl.name}</h2><p>Week ${weekOf(world.day)}, day ${dayOfWeek(world.day)}. Pass the screen to the ${pl.name} player.</p><button class="choice primary" id="passGo"><b>Begin turn</b><span>${hero()?.name ?? 'Your towns'} await${hero() ? 's' : ''} orders</span></button></div>`;
  el.hidden = false;
  return new Promise(res => { $('passGo').onclick = () => { el.hidden = true; render(); res(); }; });
}

function finish() {
  const humansWon = control.map((c, i) => (c === 'human' ? i : -1)).filter(i => i >= 0);
  music.play(humansWon.length !== 1 || humansWon[0] === world.winner ? 'victory' : 'defeat');
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  const el = $('end');
  const w = world.winner!;
  const humans = control.map((c, i) => (c === 'human' ? i : -1)).filter(i => i >= 0);
  const title = humans.length === 1 ? (humans[0] === w ? 'Victory' : 'Defeat') : `${world.players[w].name} Win`;
  const when = `week ${weekOf(world.day)}, day ${dayOfWeek(world.day)}`;
  const how = world.winReason === 'routes' ? `${world.players[w].name} held the river routes for ${ROUTE_DAYS} days and control the basin's trade (${when}).`
    : world.winReason === 'elimination' ? `${world.players[(w + 1) % 2].name} have no heroes and no towns left (${when}).`
    : `${world.players[w].name} took the enemy town in ${when}.`;
  el.style.backgroundImage = `url(${asset(`scenes/${humans.length !== 1 || humans[0] === w ? 'K-06' : 'K-07'}.webp`)})`;
  el.innerHTML = `<div class="card"><h2>${title}</h2><p>${how}</p>
    <div class="choices"><button class="choice primary" id="endMenu"><b>Main menu</b><span>Play again</span></button></div></div>`;
  el.hidden = false;
  $('endMenu').onclick = () => { el.hidden = true; $('map').hidden = true; exitToMenu(); };
}

// ------------------------------------------------------------------ dialogs: level-up, village, exchange

function openDlg(html: string) {
  const el = $('dlg');
  el.innerHTML = `<div class="card dlgcard">${html}</div>`;
  el.hidden = false;
  return el;
}
function closeDlg() { $('dlg').hidden = true; }

/** Ask the human to pick a skill for every level their heroes have gained. */
async function levelUps() {
  if (!humanTurn()) return;
  for (const h of [...world.players[world.turn].heroes]) {
    while (h.pendingSkills.length) {
      const pair = h.pendingSkills[0];
      const card = (s: string) => {
        const lv = (h.skills[s] ?? 0) + 1;
        return `<button class="choice skillpick" data-skill="${s}"><img src="${skillIcon(s)}" alt=""><b>${SKILLS[s].name} ${lv > 1 ? ['', 'I', 'II', 'III'][lv] : ''}</b><span>${SKILLS[s].text[Math.min(lv, MAX_SKILL_LEVEL) - 1]}</span></button>`;
      };
      const el = openDlg(`<div class="lvlhead"><img src="${portraitUrl(h)}" alt=""><div><h2>${h.name} reaches level ${h.level - h.pendingSkills.length + 1}</h2><p class="muted">Choose a skill.</p></div></div>
        <div class="choices two">${pair.map(card).join('')}</div>`);
      sfx.fanfare();
      await new Promise<void>(res => el.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach(b => b.onclick = () => { chooseSkill(world, h.id, b.dataset.skill!); sfx.click(); res(); }));
    }
  }
  closeDlg();
  render();
}

function openVillage(villageId: string) {
  const v = world.objects.find(o => o.id === villageId);
  const offer = villageOffer(world, villageId, world.turn);
  if (!v || !offer) return;
  const pl = world.players[world.turn];
  const reason = (r: string) => (r ? `<small class="muted">${r}</small>` : '');
  const allyName = offer.ally != null ? world.players[offer.ally].name : null;
  const stock = Object.entries(offer.stock).map(([u, n]) => {
    const c = unitCost(u), afford = Math.min(n, Math.floor(pl.resources.coin / c));
    return `<div class="rrow"><img src="${poseUrl(u, 'ready')}" alt=""><div><b>${UNITS[u].name}</b><span>${c} coin each · ${n} available</span></div>
      <button class="btn" data-vu="${u}" data-n="1" ${afford >= 1 && offer.heroHere ? '' : 'disabled'}>+1</button><button class="btn" data-vu="${u}" data-n="${afford}" ${afford >= 1 && offer.heroHere ? '' : 'disabled'}>All (${afford})</button></div>`;
  }).join('');
  const el = openDlg(`<div class="townhead"><h2>${v.name}</h2><div class="mapres">${resBar(pl.resources)}</div><button class="btn" id="vClose">Leave</button></div>
    <img class="vilpic" src="${asset(`sprites/${v.sprite}.webp`)}" alt="">
    <p>${allyName ? `The village is allied to <b>${allyName}</b>.` : 'The village keeps its own counsel. Its people will hear an offer.'}${offer.discount ? ` <span class="ok">Diplomacy: ${Math.round(offer.discount * 100)}% off agreements.</span>` : ''}</p>
    <div class="bgrid">
      <div class="bcard"><div><b>Alliance</b><span>Warriors to recruit each week, and the village's eyes on the land around it.</span><div class="costs">${costHtml(offer.alliance.cost)}</div>${reason(offer.alliance.reason)}</div>
        <button class="btn${offer.alliance.available ? ' cmd' : ''}" data-va="alliance" ${offer.alliance.available ? '' : 'disabled'}>Sign</button></div>
      <div class="bcard"><div><b>Guides</b><span>Forest costs no more than open ground for all your heroes until the week ends.${offer.guides.activeUntil >= world.day ? ` Active to day ${dayOfWeek(offer.guides.activeUntil)}.` : ''}</span><div class="costs">${costHtml(offer.guides.cost)}</div>${reason(offer.guides.reason)}</div>
        <button class="btn${offer.guides.available ? ' cmd' : ''}" data-va="guides" ${offer.guides.available ? '' : 'disabled'}>Hire</button></div>
      ${offer.trade.deals.map(dl => `<div class="bcard"><div><b>Trade</b><span>Once a week.</span><div class="costs">${costHtml(dl.give)} → ${costHtml(dl.get)}</div>${reason(offer.trade.reason)}</div>
        <button class="btn" data-vt="${dl.id}" ${offer.trade.available && dl.affordable ? '' : 'disabled'}>Trade</button></div>`).join('')}
    </div>
    ${stock ? `<h3 class="sidehead">Warriors of the village</h3>${stock}` : ''}
    ${offer.heroHere ? '' : '<p class="muted">Bring a hero to the village to deal with it.</p>'}`);
  const again = () => { render(); openVillage(villageId); };
  el.querySelectorAll<HTMLButtonElement>('[data-va]').forEach(b => b.onclick = () => { if (signAgreement(world, villageId, b.dataset.va as 'alliance' | 'guides')) sfx.coins(); again(); });
  el.querySelectorAll<HTMLButtonElement>('[data-vt]').forEach(b => b.onclick = () => { if (signAgreement(world, villageId, 'trade', b.dataset.vt as 'provisions' | 'iron')) sfx.coins(); again(); });
  el.querySelectorAll<HTMLButtonElement>('[data-vu]').forEach(b => b.onclick = () => { if (recruitAtVillage(world, villageId, b.dataset.vu!, Number(b.dataset.n))) sfx.coins(); again(); });
  $('vClose').onclick = () => { closeDlg(); render(); };
}

function openExchange(aId: string, bId: string) {
  const a = heroById(world, aId)!.hero, b = heroById(world, bId)!.hero;
  const row = (h: HeroState, other: HeroState) => {
    const slots = h.army.map((s, i) => {
      const can = h.army.length > 1 || s.count > 1;
      return `<div class="aslot"><img src="${poseUrl(s.unit, 'ready')}" alt=""><b>${s.count}</b><span>${UNITS[s.unit].name}</span>
        <button class="btn" data-from="${h.id}" data-to="${other.id}" data-i="${i}" data-c="${h.army.length > 1 ? s.count : s.count - 1}" ${can ? '' : 'disabled'}>${h === a ? 'Give ↓' : 'Give ↑'}</button>
        ${s.count > 1 ? `<button class="btn" data-from="${h.id}" data-to="${other.id}" data-i="${i}" data-c="${Math.floor(s.count / 2)}">Half</button>` : ''}</div>`;
    }).join('');
    return slots + Array.from({ length: Math.max(0, MAX_STACKS - h.army.length) }, () => '<div class="aslot empty"></div>').join('');
  };
  const el = openDlg(`<div class="townhead"><h2>Exchange</h2><button class="btn" id="xClose">Done</button></div>
    <div class="armyrow"><h3>${a.name}</h3><div class="aslots">${row(a, b)}</div></div>
    <div class="armyrow"><h3>${b.name}</h3><div class="aslots">${row(b, a)}</div></div>
    <p class="muted">A hero must keep at least one figure.</p>`);
  el.querySelectorAll<HTMLButtonElement>('[data-from]').forEach(btn => btn.onclick = () => {
    if (swapArmies(world, btn.dataset.from!, btn.dataset.to!, Number(btn.dataset.i), Number(btn.dataset.c))) sfx.click();
    render(); openExchange(aId, bId);
  });
  $('xClose').onclick = () => { closeDlg(); render(); };
}

// ------------------------------------------------------------------ town screen

let townTab: 'build' | 'recruit' | 'army' | 'heroes' = 'build';
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
  // the hero at the gate: the selected one if it is there, else any of yours there
  const atGate = pl.heroes.filter(h => townHere(world, world.turn, h)?.id === townId);
  const gateHero = atGate.find(h => h === hero()) ?? atGate[0];
  const heroHere = !!gateHero;
  const el = $('recruit');
  const defs = BUILDINGS[town.faction!].buildings;
  const cost = costHtml;
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
  const garrison = garrisonOf(town), heroArmy = gateHero?.army ?? [];
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
    ${atGate.length > 1 ? `<div class="tabs">${atGate.map(h => `<button class="btn${h === gateHero ? ' armed' : ''}" data-gh="${h.id}">${h.name}</button>`).join('')}</div>` : ''}
    <div class="armyrow"><h3>${gateHero ? gateHero.name : 'No hero at the gate'}</h3><div class="aslots">${gateHero ? stackRow(heroArmy, 'hero') : ''}</div></div>
    <p class="muted">${heroHere ? 'Move troops between the garrison and your hero. The garrison defends the town if it is attacked; an empty town is taken without a fight.' : 'A hero must be at the town gate to exchange troops.'}</p>`;
  const price = hireCost(world, world.turn);
  const pool = heroPool(world, world.turn);
  const hireWhy = pl.heroes.length >= MAX_HEROES ? `You already have ${MAX_HEROES} heroes` : town.hiredDay === world.day ? 'One hire per town a day' : pl.resources.coin < price ? 'Cannot afford it' : '';
  const heroesTab = `<div class="bgrid">${pool.map(d => `<div class="bcard"><img class="hirepic" src="${portraitUrl(d)}" alt=""><div><b>${d.name}</b><span>${d.title} · ${SKILLS[d.skill]?.name ?? ''}</span>
      <span>⚔ ${d.attack} · ⛨ ${d.defense} · ✦ ${d.command}</span><div class="costs">${costHtml({ coin: price })}</div></div>
      <button class="btn${hireWhy ? '' : ' cmd'}" data-hire="${d.id}" ${hireWhy ? 'disabled' : ''} title="${hireWhy}">${hireWhy || 'Hire'}</button></div>`).join('') || '<p class="muted">Every hero of your people is already in the field.</p>'}</div>
    <p class="muted">A new hero arrives with a small band of troops and can move at once. Up to ${MAX_HEROES} heroes.</p>`;
  el.innerHTML = `<div class="towncard">
    <div class="townhead"><h2>${town.name}</h2><div class="mapres">${RESOURCES.map(r => `<span><img src="${asset(`sprites/${RES_ICON[r]}.webp`)}" alt="${r}">${pl.resources[r].toLocaleString('en-US')}</span>`).join('')}</div>
      <button class="btn" id="rClose">Back to the map</button></div>
    ${await townPicture(town)}
    <div class="tabs">${(['build', 'recruit', 'army', 'heroes'] as const).map(t => `<button class="btn${townTab === t ? ' armed' : ''}" data-tab="${t}">${t === 'build' ? 'Build' : t === 'recruit' ? 'Recruit' : t === 'army' ? 'Army' : 'Heroes'}</button>`).join('')}
      <span class="muted">One building a day. New recruits gather each week.</span></div>
    <div class="tabbody">${townTab === 'build' ? `<div class="bgrid">${buildList}</div>` : townTab === 'recruit' ? recruitList : townTab === 'army' ? armyTab : heroesTab}</div></div>`;
  el.hidden = false;
  const again = () => { render(); void openTown(townId); };
  el.querySelectorAll<HTMLButtonElement>('[data-u]').forEach(b => b.onclick = () => { if (recruit(world, townId, b.dataset.u!, Number(b.dataset.n))) sfx.coins(); again(); });
  el.querySelectorAll<HTMLButtonElement>('[data-b]').forEach(b => b.onclick = () => { if (build(world, townId, b.dataset.b!)) sfx.build(); again(); });
  el.querySelectorAll<HTMLButtonElement>('[data-x]').forEach(b => b.onclick = () => { transfer(world, townId, b.dataset.x as 'garrison' | 'hero', Number(b.dataset.i), Number(b.dataset.c), gateHero?.id); again(); });
  el.querySelectorAll<HTMLButtonElement>('[data-gh]').forEach(b => b.onclick = () => { selectHero(world, b.dataset.gh!); again(); });
  el.querySelectorAll<HTMLButtonElement>('[data-hire]').forEach(b => b.onclick = () => { if (hireHero(world, townId, b.dataset.hire!)) { sfx.fanfare(); const nh = world.players[world.turn].heroes.at(-1)!; selectHero(world, nh.id); } again(); });
  el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { townTab = b.dataset.tab as typeof townTab; void openTown(townId); });
  $('rClose').onclick = closeRecruit;
}

function closeRecruit() { $('recruit').hidden = true; if (world && !$('map').hidden) music.play(mapTrack()); }

// test hook for automated playtests
(window as unknown as { __map: unknown }).__map = {
  get world() { return world; },
  get busy() { return busy; },
  walkTo: async (t: Tile) => { const r = findPath(world, world.turn, t); if (r) await walk(r.path); },
  select: (id: string) => pickHero(id),
  openTown: (id: string) => openTown(id),
  openVillage: (id: string) => openVillage(id),
  save: () => save(true),
  nextTurn: () => nextTurn(),
};
