/**
 * The combat sound rules (Phase 6 piece G; plan 07 §14.4 row G, plan 15 §4.4, §6.1): which
 * report a gun makes at a distance (close to from your own deck, the rolling far report
 * across the water), when a round in flight is heard going by, what it sounds like where
 * it lands, how far a boiler and a crew's shouting carry, and how hard the chase layer of
 * the music plays. Pure functions, unit-tested; `combat-audio.ts` plays them.
 */

import { shotLevel } from './law-mix';
import { SOUND_MS } from './world-mix';

// ---------------------------------------------------------------------------------------
// Guns

/** A weapon's kind in `weapons.json`: the swivel, a broadside's cannon, small arms. */
export type GunKind = 'swivel' | 'broadside' | 'small_arms';

export interface GunSound {
  /** Heard close to (your own deck, a ship alongside). */
  near: string;
  /** Heard across the water: the law's bow gun and rifle, which roll and echo. */
  far: string;
  /** Inside this the near sound plays, meters. */
  nearM: number;
  /** How far the report carries, and the distance it's at full level within, meters. */
  rangeM: number;
  refM: number;
  /** Playback rate of the far sound (a swivel is a smaller gun than the cutter's). */
  farRate: number;
}

export const GUN_SOUNDS: Readonly<Record<GunKind, GunSound>> = {
  swivel: {
    near: 'sfx.combat.swivel',
    far: 'sfx.law.gun',
    nearM: 400,
    rangeM: 6000,
    refM: 25,
    farRate: 1.2,
  },
  broadside: {
    near: 'sfx.combat.cannon',
    far: 'sfx.law.gun',
    nearM: 500,
    rangeM: 8000,
    refM: 35,
    farRate: 1,
  },
  small_arms: {
    near: 'sfx.combat.rifle',
    far: 'sfx.law.rifle',
    nearM: 150,
    rangeM: 2500,
    refM: 12,
    farRate: 1,
  },
};

export interface Placed {
  soundId: string;
  gain: number;
  lowpassHz: number;
  rate: number;
  /** Seconds until it's heard: the sound's travel time. */
  delayS: number;
}

/** A gun's report at `distanceM`, or undefined out of earshot. */
export function reportFor(kind: GunKind, distanceM: number, damping = 1): Placed | undefined {
  const g = GUN_SOUNDS[kind];
  const level = shotLevel(distanceM, g.rangeM, g.refM, damping);
  if (!level) return undefined;
  const near = distanceM < g.nearM;
  return {
    soundId: near ? g.near : g.far,
    gain: level.gain,
    lowpassHz: level.lowpassHz,
    rate: near ? 1 : g.farRate,
    delayS: distanceM / SOUND_MS,
  };
}

/** The weapon's kind from its id when the data doesn't know it (a law ship's gun). */
export function gunKindOf(weaponId: string, known?: GunKind): GunKind {
  if (known) return known;
  if (weaponId.includes('rifle') || weaponId.includes('pistol')) return 'small_arms';
  if (weaponId.includes('swivel')) return 'swivel';
  return 'broadside';
}

// ---------------------------------------------------------------------------------------
// The round in flight

export interface FlybySound {
  soundId: string;
  /** Where the buffer passes closest, seconds into it. */
  passS: number;
  /** Heard going by within this, meters. */
  rangeM: number;
}

export const FLYBY: Readonly<Record<'round' | 'ball', FlybySound>> = {
  round: { soundId: 'sfx.combat.flyby', passS: 0.9, rangeM: 70 },
  ball: { soundId: 'sfx.combat.zip', passS: 0.12, rangeM: 18 },
};

/** How far ahead the shots are looked at, seconds: a frame or two past the fly-by's lead. */
export const FLYBY_LOOKAHEAD_S = 1.1;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * When a shot flying straight on passes closest to the listener (seconds from now; negative
 * if it already has) and by how much, meters. Over a second gravity bends it only a little.
 */
export function closestApproach(
  pos: Vec3,
  vel: Vec3,
  listener: Vec3,
): { tS: number; missM: number } {
  const rx = pos.x - listener.x;
  const ry = pos.y - listener.y;
  const rz = pos.z - listener.z;
  const v2 = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
  const tS = v2 > 1e-9 ? -(rx * vel.x + ry * vel.y + rz * vel.z) / v2 : 0;
  const t = Math.max(tS, 0);
  const missM = Math.hypot(rx + vel.x * t, ry + vel.y * t, rz + vel.z * t);
  return { tS, missM };
}

/** The ammo that flies as a rifle ball (a zip) rather than a round shot (a whistle). */
export const isBall = (ammo: string): boolean => ammo === 'ammo.ball';

/**
 * A shot (not your own) heard going by: lined up so the buffer's pass falls at its closest
 * approach, louder the closer it comes. Undefined if it won't pass near enough soon enough.
 */
export function flybyFor(
  shot: { pos: Vec3; vel: Vec3; ammo: string },
  listener: Vec3,
): { soundId: string; delayS: number; offsetS: number; gain: number; at: Vec3 } | undefined {
  const f = isBall(shot.ammo) ? FLYBY.ball : FLYBY.round;
  const { tS, missM } = closestApproach(shot.pos, shot.vel, listener);
  if (tS < 0 || tS > FLYBY_LOOKAHEAD_S || missM >= f.rangeM) return undefined;
  // Wait until the pass is `passS` off, or start partway in if it's closer than that.
  if (tS > f.passS + 0.1) return undefined;
  const near = 1 - missM / f.rangeM;
  return {
    soundId: f.soundId,
    delayS: Math.max(0, tS - f.passS),
    offsetS: Math.max(0, f.passS - tS),
    gain: 0.25 + 0.75 * near * near,
    at: {
      x: shot.pos.x + shot.vel.x * tS,
      y: shot.pos.y + shot.vel.y * tS,
      z: shot.pos.z + shot.vel.z * tS,
    },
  };
}

/** Your own round going away: the tail of the whistle, quieter, just after the bang. */
export const OWN_FLYBY = { gain: 0.3, delayS: 0.05 } as const;

// ---------------------------------------------------------------------------------------
// Where it lands

export type ImpactKind = 'water' | 'wood' | 'canvas';

/** The impact for where a shot struck (a hit's location; `water` for the lake). */
export function impactKindOf(location: string | undefined): ImpactKind {
  if (location === undefined || location === 'water') return 'water';
  return location === 'rigging' ? 'canvas' : 'wood';
}

/**
 * What a shot sounds like landing, heard from `distanceM`. A rifle ball is a plip in the
 * water and a small knock in wood or canvas; chain shot through the rigging parts a stay.
 */
export function impactFor(
  kind: ImpactKind,
  ammo: string,
  distanceM: number,
  damping = 1,
): Placed | undefined {
  const ball = isBall(ammo);
  let soundId: string;
  let rangeM: number;
  let refM: number;
  let scale = 1;
  let rate = 1;
  switch (kind) {
    case 'water':
      [soundId, rangeM, refM] = ball
        ? ['sfx.combat.splash-ball', 500, 12]
        : ['sfx.law.splash', 1500, 40];
      break;
    case 'wood':
      [soundId, rangeM, refM] = ['sfx.combat.hit-wood', ball ? 400 : 2000, ball ? 10 : 30];
      if (ball) [scale, rate] = [0.35, 1.8];
      break;
    case 'canvas':
      soundId = ammo === 'ammo.chain' ? 'sfx.law.rigging-hit' : 'sfx.combat.hit-canvas';
      [rangeM, refM] = [ball ? 300 : 1500, ball ? 10 : 30];
      if (ball) [scale, rate] = [0.3, 1.5];
      break;
  }
  const level = shotLevel(distanceM, rangeM, refM, damping);
  if (!level) return undefined;
  return {
    soundId,
    gain: level.gain * scale,
    lowpassHz: level.lowpassHz,
    rate,
    delayS: distanceM / SOUND_MS,
  };
}

/** A boiler bursting: heard right across a zone. */
export const BOILER = { soundId: 'sfx.combat.boiler', rangeM: 9000, refM: 250 } as const;

/** Her crew calling out as she strikes: a ship's length or so off, and fading out by 1.5 km. */
export const STRIKE_SHOUT = { soundId: 'voice.combat.strike', rangeM: 1500, refM: 40 } as const;

/** A stinger for a ship that strikes, if it happened near enough to be yours, meters. */
export const STRUCK_STINGER_M = 3000;

export const COMBAT_CAPTIONS = {
  gun: 'gunfire',
  rifle: 'rifle shot',
  boiler: 'a boiler explodes',
  strike: 'her crew shouting, she strikes',
} as const;

// ---------------------------------------------------------------------------------------
// The chase layer

/** 0: none; 1: the drums and low strings (tension); 2: the fiddle on top (the chase). */
export type ChaseLevel = 0 | 1 | 2;

/** What the chase layer listens to, each frame. */
export interface ChaseInputs {
  /** Seconds since a gun went off within earshot (Infinity if none has). */
  sinceGunfireS: number;
  /** The targets in the zone or arena: their captain's phase and how far off they are. */
  targets: readonly { phase: string; distanceM: number }[];
  /** How far off the law ship chasing you is, meters; undefined when nobody is. */
  lawPursuitM: number | undefined;
}

export const CHASE_RULES = {
  /** A gun heard keeps the full chase going this long, seconds. */
  gunfireS: 20,
  /** A target running or turning on you, inside this, is a chase, meters. */
  chaseM: 1500,
  /** A target on the alert, or one running further off, is tension inside this. */
  tensionM: 2500,
  /** Seconds the level holds before it falls, so it doesn't flicker. */
  holdS: 8,
  /** Gunfire heard within this counts, meters (piece C's captains hear it as far). */
  gunfireHeardM: 2000,
} as const;

/** The level the chase layer should be at now. */
export function chaseLevelFor(i: ChaseInputs): ChaseLevel {
  const r = CHASE_RULES;
  let level: ChaseLevel = 0;
  if (i.sinceGunfireS < r.gunfireS) return 2;
  if (i.lawPursuitM !== undefined) {
    if (i.lawPursuitM < r.chaseM) return 2;
    level = 1;
  }
  for (const t of i.targets) {
    const running = t.phase === 'fleeing' || t.phase === 'fighting';
    if (running && t.distanceM < r.chaseM) return 2;
    if ((running || t.phase === 'alert') && t.distanceM < r.tensionM) level = 1;
  }
  return level;
}

/** The level with a hold: it rises at once, and falls only after `holdS` lower. */
export class ChaseState {
  level: ChaseLevel = 0;
  private lowerS = 0;

  update(target: ChaseLevel, dt: number): ChaseLevel {
    if (target >= this.level) {
      this.level = target;
      this.lowerS = 0;
      return this.level;
    }
    this.lowerS += dt;
    if (this.lowerS >= CHASE_RULES.holdS) {
      this.level = target;
      this.lowerS = 0;
    }
    return this.level;
  }

  reset(): void {
    this.level = 0;
    this.lowerS = 0;
  }
}

/** Each stem's level at a chase level (the mix's balance; heard on the music bus). */
export const CHASE_STEM_GAIN = { drums: 0.5, fiddle: 0.42 } as const;

export function stemGains(level: ChaseLevel): { drums: number; fiddle: number } {
  return {
    drums: level >= 1 ? CHASE_STEM_GAIN.drums : 0,
    fiddle: level >= 2 ? CHASE_STEM_GAIN.fiddle : 0,
  };
}
