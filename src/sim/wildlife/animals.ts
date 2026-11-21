import type { SpeciesDef } from '../../../data/schemas/wildlife';
import type { Rng } from '../../core/rng';

/**
 * The island's animals (plan 11 §3.2; §18.4 piece V), pure: what each wants to do and where
 * it goes, given what it perceives of you. The gameplay side works out the perceiving
 * (sight past the trees, your footsteps, your scent on the wind) and the ground.
 *
 * Deer: Graze ──(sees, hears or smells you)──► Alert ──(closer, or more noise)──► Flee
 * Bears and wolves (the FSM plan 11 names):
 *   Wander ──(notices you)──► Wary ──(you come on)──► Threaten ──(bold)──► Attack
 *                                         │                └──(bluff, noise, fire)──► Flee
 *                                         └──(you back off)──► Wary
 * Come on one too close and it attacks at once. A shot, a gunshot near or a fire may turn
 * it; a wound may too, or make it worse. Killing animals is not a crime.
 */

export type AnimalState =
  'graze' | 'alert' | 'wander' | 'wary' | 'threaten' | 'attack' | 'flee' | 'wounded' | 'dead';

export interface Animal {
  id: string;
  species: SpeciesDef;
  x: number;
  y: number;
  z: number;
  /** Radians clockwise from north (-z), as the walker's. */
  heading: number;
  /** Ground speed it's moving at, m/s. */
  speed: number;
  state: AnimalState;
  /** Seconds left in the state (alert, threaten, flee, a wound's last run). */
  timer: number;
  /** Where it ranges round. */
  home: { x: number; z: number };
  /** Where it's walking to while it grazes or wanders. */
  goal: { x: number; z: number } | undefined;
  hp: number;
  /** Decided as it starts threatening: it means it. */
  bold: boolean;
  /** Seconds to its next bite or swipe. */
  attackIn: number;
  /** What it runs from. */
  from: { x: number; z: number } | undefined;
  /** Dressed where it fell (deer), or lifted away. */
  dressed: boolean;
  taken: boolean;
}

/** What it makes of you this tick (the gameplay side's sight, hearing and smell). */
export interface Perception {
  /** You, zone meters, and how far. */
  at: { x: number; z: number };
  distM: number;
  sees: boolean;
  hears: boolean;
  smells: boolean;
  /** You stand by a fire it won't come near (plan 11 §3.2). */
  byFire: boolean;
  /** Out of its reach: in the boat, in the water, aboard. */
  beyond: boolean;
}

export type AnimalEvent =
  | { type: 'Warned'; animal: string; state: 'wary' | 'threaten' | 'attack' | 'flee' }
  | { type: 'Bolted'; animal: string }
  | { type: 'Bit'; animal: string; damage: number }
  | { type: 'Died'; animal: string };

export function createAnimal(
  id: string,
  species: SpeciesDef,
  at: { x: number; y: number; z: number },
  heading: number,
): Animal {
  return {
    id,
    species,
    x: at.x,
    y: at.y,
    z: at.z,
    heading,
    speed: 0,
    state: species.kind === 'deer' ? 'graze' : 'wander',
    timer: 0,
    home: { x: at.x, z: at.z },
    goal: undefined,
    hp: species.hp,
    bold: false,
    attackIn: 0,
    from: undefined,
    dressed: false,
    taken: false,
  };
}

const bearingTo = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.atan2(b.x - a.x, -(b.z - a.z));

export const isDead = (a: Animal): boolean => a.state === 'dead';

function enter(a: Animal, s: AnimalState, out: AnimalEvent[], timer = 0): void {
  if (a.state === s) return;
  a.state = s;
  a.timer = timer;
  if (s === 'wary' || s === 'threaten' || s === 'attack' || s === 'flee') {
    if (a.species.kind === 'predator') out.push({ type: 'Warned', animal: a.id, state: s });
  }
}

function bolt(a: Animal, from: { x: number; z: number }, out: AnimalEvent[]): void {
  if (a.state === 'dead') return;
  const was = a.state;
  a.from = { ...from };
  if (a.state === 'wounded') return;
  enter(a, 'flee', out, a.species.fleeS);
  a.heading = bearingTo(from, a);
  a.speed = a.species.runMps;
  if (a.species.kind === 'deer' && was !== 'flee') out.push({ type: 'Bolted', animal: a.id });
}

/** Sets a fresh place to amble to within `rangeM` of home. */
function amble(a: Animal, rng: Rng, rangeM: number): void {
  const t = rng.range(0, Math.PI * 2);
  const r = rng.range(0.2, 1) * rangeM;
  a.goal = { x: a.home.x + Math.sin(t) * r, z: a.home.z - Math.cos(t) * r };
}

/**
 * One tick of an animal's mind: its state, which way it heads and how fast. `rangeM` is how
 * far it wanders from home when nothing's the matter.
 */
export function thinkAnimal(
  a: Animal,
  dt: number,
  p: Perception,
  rng: Rng,
  out: AnimalEvent[],
  rangeM = 20,
): void {
  if (a.state === 'dead') {
    a.speed = 0;
    return;
  }
  a.timer = Math.max(0, a.timer - dt);
  const s = a.species;
  const noticed = p.sees || p.hears || p.smells;

  if (a.state === 'wounded') {
    // A deer hit but not dropped runs on, and is down where it stops.
    if (a.from) a.heading = bearingTo(a.from, a);
    a.speed = s.runMps * 0.7;
    if (a.timer <= 0) {
      a.state = 'dead';
      a.speed = 0;
      out.push({ type: 'Died', animal: a.id });
    }
    return;
  }

  if (a.state === 'flee') {
    if (a.from) a.heading = bearingTo(a.from, a);
    a.speed = s.runMps;
    if (a.timer <= 0) {
      // It settles where it ran to.
      a.home = { x: a.x, z: a.z };
      a.goal = undefined;
      a.from = undefined;
      a.state = s.kind === 'deer' ? 'graze' : 'wander';
    }
    return;
  }

  if (s.kind === 'deer') {
    if (a.state === 'graze') {
      if (noticed) {
        enter(a, 'alert', out, s.alertS);
        a.heading = bearingTo(a, p.at);
        a.speed = 0;
        return;
      }
      grazeStep(a, rng, rangeM, s.walkMps * 0.6);
      return;
    }
    // Alert: head up, looking at you.
    a.speed = 0;
    a.heading = bearingTo(a, p.at);
    if (!p.beyond && (p.distM < s.fleeAtM || (p.hears && a.timer < s.alertS - 1))) {
      bolt(a, p.at, out);
      return;
    }
    if (a.timer <= 0) a.state = 'graze';
    return;
  }

  const pr = s.predator;
  if (!pr) return;
  switch (a.state) {
    case 'wander': {
      if (!p.beyond && noticed && p.distM < pr.waryM) {
        if (p.distM < pr.closeM) {
          enter(a, 'attack', out);
          a.attackIn = pr.everyS * 0.5;
        } else {
          enter(a, 'wary', out, s.alertS);
        }
        a.heading = bearingTo(a, p.at);
        a.speed = 0;
        return;
      }
      grazeStep(a, rng, rangeM, s.walkMps);
      return;
    }
    case 'wary': {
      a.heading = bearingTo(a, p.at);
      a.speed = 0;
      if (p.beyond || p.byFire) {
        if (a.timer <= 0) a.state = 'wander';
        return;
      }
      if (p.distM < pr.closeM) {
        enter(a, 'attack', out);
        a.attackIn = pr.everyS * 0.5;
        return;
      }
      if (p.distM < pr.threatenM) {
        a.bold = rng.chance(pr.boldness);
        enter(a, 'threaten', out, pr.threatenS);
        return;
      }
      if (noticed && p.distM < pr.waryM) a.timer = s.alertS;
      if (a.timer <= 0) a.state = 'wander';
      return;
    }
    case 'threaten': {
      a.heading = bearingTo(a, p.at);
      a.speed = 0;
      if (p.byFire) {
        bolt(a, p.at, out);
        return;
      }
      if (p.beyond || p.distM > pr.threatenM * 1.4) {
        // You backed off: it watches you go.
        enter(a, 'wary', out, s.alertS);
        return;
      }
      if (p.distM < pr.closeM) {
        enter(a, 'attack', out);
        a.attackIn = pr.everyS * 0.5;
        return;
      }
      if (a.timer <= 0) {
        if (a.bold) {
          enter(a, 'attack', out);
          a.attackIn = pr.everyS * 0.5;
        } else {
          bolt(a, p.at, out);
        }
      }
      return;
    }
    case 'attack': {
      if (p.byFire) {
        // It won't follow you into the firelight: it hangs back, watching.
        enter(a, 'wary', out, s.alertS * 2);
        a.speed = 0;
        return;
      }
      if (p.beyond) {
        enter(a, 'wary', out, s.alertS);
        a.speed = 0;
        return;
      }
      a.heading = bearingTo(a, p.at);
      if (p.distM > pr.attackM) {
        a.speed = s.runMps;
        a.attackIn = Math.min(a.attackIn, pr.everyS * 0.5);
        return;
      }
      a.speed = 0;
      a.attackIn -= dt;
      if (a.attackIn <= 0) {
        a.attackIn = pr.everyS;
        out.push({ type: 'Bit', animal: a.id, damage: pr.damage });
      }
      return;
    }
    default:
      a.state = 'wander';
  }
}

function grazeStep(a: Animal, rng: Rng, rangeM: number, mps: number): void {
  // Half the time it stands, browsing; the rest it ambles.
  if (a.timer <= 0) {
    a.timer = rng.range(3, 9);
    if (rng.chance(0.5)) {
      amble(a, rng, rangeM);
    } else {
      a.goal = undefined;
    }
  }
  if (!a.goal) {
    a.speed = 0;
    return;
  }
  const d = Math.hypot(a.goal.x - a.x, a.goal.z - a.z);
  if (d < 1) {
    a.goal = undefined;
    a.speed = 0;
    return;
  }
  a.heading = bearingTo(a, a.goal);
  a.speed = mps;
}

/**
 * A rifle ball into it: one less of its life. A deer is dropped or runs on wounded; a
 * predator hurt may run, or come on. Returns true if it's dead now.
 */
export function shootAnimal(
  a: Animal,
  from: { x: number; z: number },
  rng: Rng,
  out: AnimalEvent[],
  opts: { killChance: number; woundedS: number },
): boolean {
  if (a.state === 'dead') return true;
  const s = a.species;
  a.hp -= 1;
  if (s.kind === 'deer') {
    if (a.hp <= 0 && (a.state === 'wounded' || rng.chance(opts.killChance))) {
      a.state = 'dead';
      a.speed = 0;
      out.push({ type: 'Died', animal: a.id });
      return true;
    }
    a.hp = Math.max(a.hp, 1);
    a.state = 'wounded';
    a.timer = opts.woundedS;
    a.from = { ...from };
    return false;
  }
  if (a.hp <= 0) {
    a.state = 'dead';
    a.speed = 0;
    out.push({ type: 'Died', animal: a.id });
    return true;
  }
  const pr = s.predator;
  if (pr && rng.chance(pr.hurtFlee)) {
    bolt(a, from, out);
  } else if (a.state !== 'attack') {
    enter(a, 'attack', out);
    a.attackIn = (pr?.everyS ?? 1) * 0.5;
  }
  return false;
}

/** A shot heard (that missed it, or hit another): deer bolt; a predator may. */
export function hearShot(
  a: Animal,
  from: { x: number; z: number },
  rng: Rng,
  out: AnimalEvent[],
): void {
  if (a.state === 'dead' || a.state === 'wounded') return;
  if (a.species.kind === 'deer') {
    bolt(a, from, out);
    return;
  }
  const pr = a.species.predator;
  if (pr && rng.chance(pr.shotFlee)) bolt(a, from, out);
}

/** A shout, a stone's clatter: a predator threatening may turn and go. */
export function hearNoise(
  a: Animal,
  from: { x: number; z: number },
  rng: Rng,
  out: AnimalEvent[],
): void {
  const pr = a.species.predator;
  if (!pr || (a.state !== 'threaten' && a.state !== 'wary')) return;
  if (rng.chance(pr.noiseFlee)) bolt(a, from, out);
}

/**
 * Moves it along its heading at its speed over walkable ground; turns aside when the way is
 * barred (water, a cliff, a fire, a wall), and stands if nothing serves.
 */
export function moveAnimal(
  a: Animal,
  dt: number,
  walkable: (x: number, z: number) => boolean,
  heightAt: (x: number, z: number) => number,
): void {
  if (a.speed <= 0 || a.state === 'dead') return;
  const step = a.speed * dt;
  for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
    const h = a.heading + turn;
    const x = a.x + Math.sin(h) * step;
    const z = a.z - Math.cos(h) * step;
    if (!walkable(x, z)) continue;
    a.x = x;
    a.z = z;
    a.y = heightAt(x, z);
    if (turn !== 0) {
      a.heading = h;
      // An amble round an obstacle gives up on where it was going.
      if (a.state === 'graze' || a.state === 'wander') a.goal = undefined;
    }
    return;
  }
  a.speed = 0;
  a.goal = undefined;
}
