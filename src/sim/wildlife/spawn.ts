import type { WildlifeFile } from '../../../data/schemas/wildlife';
import type { Rng } from '../../core/rng';
import { landDistanceM, type PlacedIsland } from '../islands/on-foot';
import { WILDLIFE } from './defs';

/**
 * Where the animals lie up on a landing, and the sign that leads to the deer (plan 11 §4:
 * "track deer on larger islands"), pure over the island's land and heights.
 */

/** Ground an animal can stand on: the island's own land, dry, not a cliff. */
export function gameGround(
  island: PlacedIsland,
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
): boolean {
  const y = heightAt(x, z);
  if (y < 0.6) return false;
  if (island.land && landDistanceM(island.land, x, z) > 0) return false;
  // About 42°: what a man can't walk up, a deer won't graze on.
  const rise = Math.max(Math.abs(heightAt(x + 1.5, z) - y), Math.abs(heightAt(x, z + 1.5) - y));
  return rise < 1.35;
}

/** The island's doors and camps: game keeps clear of them. */
export function homesOf(island: PlacedIsland): { x: number; z: number }[] {
  return island.marks.filter((m) => m.kind === 'resident' || m.kind === 'fire');
}

/**
 * A place for a group to lie up: on the island's ground, far enough from where you land
 * and from anyone's door. `undefined` if the island has nowhere (a rock, all cliff).
 */
export function lieUp(
  island: PlacedIsland,
  heightAt: (x: number, z: number) => number,
  landing: { x: number; z: number },
  rng: Rng,
  opts: { minFromM: number; maxFromM: number; clearOfM: number },
): { x: number; z: number } | undefined {
  const homes = homesOf(island);
  for (let tries = 0; tries < 80; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(opts.minFromM, opts.maxFromM);
    const x = landing.x + Math.sin(a) * r;
    const z = landing.z - Math.cos(a) * r;
    if (!gameGround(island, heightAt, x, z)) continue;
    if (homes.some((h) => Math.hypot(h.x - x, h.z - z) < opts.clearOfM)) continue;
    return { x, z };
  }
  return undefined;
}

export interface Sign {
  x: number;
  y: number;
  z: number;
  /** The way the deer went, radians clockwise from north. */
  heading: number;
}

/**
 * Deer sign from near the landing toward the herd: the first within reach of the shore,
 * then on every `stepM`, stopping short of the herd so you come on it, not stand in it.
 */
export function signTrail(
  island: PlacedIsland,
  heightAt: (x: number, z: number) => number,
  landing: { x: number; z: number },
  herd: { x: number; z: number },
  rng: Rng,
  file: WildlifeFile = WILDLIFE,
): Sign[] {
  const s = file.sign;
  const out: Sign[] = [];
  const toHerd = Math.atan2(herd.x - landing.x, -(herd.z - landing.z));
  // The first sign lies off toward the herd, a little either side.
  let x = 0;
  let z = 0;
  let found = false;
  for (let tries = 0; tries < 30 && !found; tries++) {
    const a = toHerd + rng.range(-0.6, 0.6);
    const r = rng.range(s.firstM[0], s.firstM[1]);
    x = landing.x + Math.sin(a) * r;
    z = landing.z - Math.cos(a) * r;
    found = gameGround(island, heightAt, x, z);
  }
  if (!found) return out;
  for (let k = 0; k < s.count; k++) {
    const left = Math.hypot(herd.x - x, herd.z - z);
    if (left < 30) break;
    const h = Math.atan2(herd.x - x, -(herd.z - z));
    if (gameGround(island, heightAt, x, z)) out.push({ x, y: heightAt(x, z), z, heading: h });
    const wander = h + rng.range(-0.35, 0.35);
    x += Math.sin(wander) * s.stepM;
    z -= Math.cos(wander) * s.stepM;
  }
  return out;
}

const POINTS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
] as const;

/** A bearing as a compass word. */
export function compassWord(heading: number): (typeof POINTS)[number] {
  const k = Math.round((heading / (Math.PI * 2)) * 8);
  return POINTS[((k % 8) + 8) % 8] as (typeof POINTS)[number];
}

/** What reading the sign tells you: the way, and with woodcraft how many and how near. */
export function readSign(
  sign: Sign,
  herd: { x: number; z: number; count: number } | undefined,
  woodcraft: boolean,
): string {
  const way = compassWord(sign.heading);
  if (!herd || herd.count <= 0) {
    return `Old deer tracks heading ${way}, days old. Nothing's been by since.`;
  }
  const d = Math.hypot(herd.x - sign.x, herd.z - sign.z);
  if (!woodcraft) {
    return `Fresh deer tracks and droppings, heading ${way}. They aren't far.`;
  }
  const n = herd.count === 1 ? 'one deer' : herd.count === 2 ? 'two deer' : `${herd.count} deer`;
  const near = Math.max(20, Math.round(d / 20) * 20);
  return `Fresh tracks of ${n}, browsing as they went ${way}. Bedded down about ${near} m on, by the look of it.`;
}
