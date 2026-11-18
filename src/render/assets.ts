// Every texture the battle needs, loaded once up front.
import { Assets, type Texture } from 'pixi.js';
import { UNITS } from '../sim/battle';

export const asset = (p: string): string => `${import.meta.env.BASE_URL}assets/${p}`;
const sprite = (card: string, n: number): string => asset(`sprites/${card}/${card}-${String(n).padStart(2, '0')}.webp`);

export const PROPS = {
  maples: sprite('B-06', 1),
  pines: sprite('B-06', 2),
  thicket: sprite('B-06', 3),
  boulder: sprite('B-06', 4),
  boulders: sprite('B-06', 5),
  fence: sprite('B-06', 7),
  puff: sprite('B-09', 1),
  smokeBank: sprite('B-09', 2),
  cannonBlast: sprite('B-09', 3),
  flash: sprite('B-09', 5),
  dust: sprite('B-09', 6),
  dirt: sprite('B-09', 7),
  iconCover: sprite('I-05', 7),
  iconWavering: sprite('I-05', 9),
  iconRallied: sprite('I-05', 10),
  iconUnloaded: sprite('I-05', 11),
  iconDefend: sprite('I-05', 1),
} as const;

export type Pose = 'ready' | 'attack' | 'reload' | 'defeated';
export const poseUrl = (unit: string, pose: Pose): string => sprite(unit, UNITS[unit].poses[pose]);

export async function loadBattleTextures(background: string): Promise<Record<string, Texture>> {
  const urls: string[] = [asset(`scenes/${background}.webp`), ...Object.values(PROPS)];
  for (const id of Object.keys(UNITS)) for (const p of ['ready', 'attack', 'reload', 'defeated'] as Pose[]) urls.push(poseUrl(id, p));
  const loaded = await Assets.load(urls);
  return loaded as Record<string, Texture>;
}
