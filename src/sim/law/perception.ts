/**
 * The perception module (plan 06 §7.1, Phase 5 piece B): how far an observer can make out
 * the player's ship, and how a watcher's detection meter climbs to spotted and then to
 * identified. Pure functions with no three.js and no game state, so the keepers, the
 * traffic's crews, the cutter's lookout, a bench and the tests all read the same numbers.
 *
 * §7.1's product is worked as ranges, in zone meters: the hull is seen out to
 * `ambient sight × ship tier × sails × silhouette × vantage`, capped by fog and rain, and a
 * lit lantern shows on its own out to the lantern's range once it's dark (a light carries
 * through the night, not through fog). An observer inside either range fills their meter,
 * faster the closer the ship is, and slower for a dozing keeper than a cutter's lookout.
 */

const DEG = Math.PI / 180;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(e0: number, e1: number, v: number): number {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** The sky's light, from sim/weather/celestial and the zone's cloud. */
export interface SkyLight {
  sunElevationRad: number;
  moonElevationRad: number;
  /** Lit fraction of the moon's disc, 0–1. */
  moonIllumination01: number;
  /** Cloud cover, 0–1: an overcast hides the moon. */
  cloud01: number;
}

/** How far a ship's hull is made out in full daylight and clear air, zone meters. */
export const DAY_SIGHT_M = 5000;
/** …on a moonless night under clear stars (cf. local-weather's night visibility). */
export const STARLIGHT_SIGHT_M = 300;
/** …what a full moon high in a clear sky adds to that. */
export const MOONLIGHT_SIGHT_M = 1700;
/** A lit lantern shows this far on a dark, clear night, zone meters. */
export const LANTERN_RANGE_M = 3000;

/** Daylight, 0 (the sun 12° or more below the horizon) to 1 (the sun above it). */
export function daylight01(sunElevationRad: number): number {
  return smoothstep(-12 * DEG, 0, sunElevationRad);
}

/** Moonlight, 0–1: the lit disc, once it's clear of the horizon, dimmed by cloud. */
export function moonlight01(sky: SkyLight): number {
  const up = smoothstep(0, 8 * DEG, sky.moonElevationRad);
  return sky.moonIllumination01 * up * (1 - 0.7 * clamp01(sky.cloud01));
}

/**
 * How far a reference ship (a T1 under full sail, on open water, seen from a deck) is made
 * out in this light without fog: 5 km by day, 300 m on a moonless night, about 2 km under
 * a full moon, easing across the twilight.
 */
export function ambientSightM(sky: SkyLight): number {
  const night =
    (STARLIGHT_SIGHT_M + MOONLIGHT_SIGHT_M * moonlight01(sky)) * (1 - 0.3 * sky.cloud01);
  const day = daylight01(sky.sunElevationRad);
  return Math.exp(Math.log(night) * (1 - day) + Math.log(DAY_SIGHT_M) * day);
}

/** What's behind the ship from where the observer stands (§7.1 silhouette). */
export type Backdrop = 'sky' | 'shore' | 'glow';

/**
 * Silhouette (§7.1): against a dark shore a ship melts into it, more so at night; against
 * a lighthouse's glow she stands out black; against open sky and water she's as she is.
 */
export function silhouetteFactor(backdrop: Backdrop, daylight: number): number {
  switch (backdrop) {
    case 'sky':
      return 1;
    case 'shore':
      return 0.55 + 0.3 * daylight;
    case 'glow':
      return 1.6 - 0.6 * daylight;
  }
}

/** The ship's tier: a bigger hull and taller rig show further (§7.1 baseVisibility). */
export function tierFactor(tier: number): number {
  return 1 + 0.2 * Math.max(0, tier - 1);
}

/** Sails up are more visible (§7.1 sailFactor): `sails01` 0 furled … 1 full. */
export function sailFactor(sails01: number): number {
  return 0.55 + 0.45 * clamp01(sails01);
}

/** The ship being watched. */
export interface Target {
  /** ships.json tier: 1 for the T1, 2 for the T2. */
  tier: number;
  /** Sail set, 0 furled … 1 full. */
  sails01: number;
  lanternLit: boolean;
}

/** The air between them. */
export interface Conditions {
  sky: SkyLight;
  /** Fog and haze visibility, zone meters (local-weather's `fogVisibilityAt`). */
  fogM: number;
  /** Rain, 0–1. */
  rain01: number;
}

/** Who's watching, and from where. */
export interface ObserverSpec {
  /** Eye above the water, meters: a deck is ~4, a lighthouse gallery 15–30. */
  eyeM: number;
  /** A glass doubles what can be made out at range (the cutter's lookout). */
  spyglass: boolean;
  /** 0–1: how hard they're looking. A dozing keeper is ~0.25, a lookout 1. */
  vigilance: number;
}

/** A high vantage sees further over the swell (§6.1: a keeper's gallery). */
export function vantageFactor(eyeM: number): number {
  return 1 + Math.min(0.5, Math.max(0, eyeM - 4) / 50);
}

const SPYGLASS = 1.6;
/** A lit ship's hull shows this much further at night, by her own lamplight. */
export const LAMPLIT_HULL = 0.3;

/** Rain thins what's seen through it; heavy rain takes off 40%. */
export function rainFactor(rain01: number): number {
  return 1 - 0.4 * clamp01(rain01);
}

/** How far this observer makes out the hull, zone meters. */
export function hullRangeM(
  target: Target,
  cond: Conditions,
  obs: ObserverSpec,
  backdrop: Backdrop,
): number {
  const day = daylight01(cond.sky.sunElevationRad);
  const seen =
    ambientSightM(cond.sky) *
    tierFactor(target.tier) *
    sailFactor(target.sails01) *
    silhouetteFactor(backdrop, day) *
    vantageFactor(obs.eyeM) *
    (obs.spyglass ? SPYGLASS : 1) *
    // Her own lamps light her deck and the foot of her sails after dark.
    (target.lanternLit ? 1 + LAMPLIT_HULL * (1 - day) : 1);
  return Math.min(seen, cond.fogM * (obs.spyglass ? 1.15 : 1)) * rainFactor(cond.rain01);
}

/**
 * How far a lit lantern shows, zone meters: nothing by day, out to 3 km on a dark night,
 * and through fog a little further than a hull. A glass doesn't help a point of light.
 */
export function lanternRangeM(cond: Conditions): number {
  const dark = 1 - daylight01(cond.sky.sunElevationRad);
  // The moon's light washes a small lamp out a little.
  const contrast = 1 - 0.15 * moonlight01(cond.sky);
  return Math.min(LANTERN_RANGE_M * dark * contrast, cond.fogM * 1.25) * rainFactor(cond.rain01);
}

/** What an observer could make out right now. */
export interface Sight {
  hullM: number;
  lanternM: number;
  /** The further of the two. */
  rangeM: number;
  /** What they'd see at `distanceM`: the ship herself, only her light, or nothing. */
  by: 'hull' | 'lantern' | 'none';
  /** 0 at the edge of sight … 1 alongside. */
  closeness01: number;
  /** Close and clear enough to match her profile (§2.3), given time. */
  canIdentify: boolean;
}

/** A ship is identified (her profile matched) inside this share of the hull range. */
export const IDENTIFY_SHARE = 0.4;

export function sight(
  target: Target,
  cond: Conditions,
  obs: ObserverSpec,
  backdrop: Backdrop,
  distanceM: number,
): Sight {
  const hullM = hullRangeM(target, cond, obs, backdrop);
  const lanternM = target.lanternLit ? lanternRangeM(cond) : 0;
  const rangeM = Math.max(hullM, lanternM);
  const by = distanceM <= hullM ? 'hull' : distanceM <= lanternM ? 'lantern' : 'none';
  return {
    hullM,
    lanternM,
    rangeM,
    by,
    closeness01: rangeM > 0 ? clamp01(1 - distanceM / rangeM) : 0,
    canIdentify: by === 'hull' && distanceM <= hullM * IDENTIFY_SHARE,
  };
}

/**
 * Detectability (§7.1) as one number: how far this ship is seen from a reference deck,
 * as a share of a T1 under full sail in daylight. For the bench and the debug readout.
 */
export function detectability(
  target: Target,
  cond: Conditions,
  backdrop: Backdrop = 'sky',
): number {
  const deck: ObserverSpec = { eyeM: 4, spyglass: false, vigilance: 1 };
  const hull = hullRangeM(target, cond, deck, backdrop);
  const lamp = target.lanternLit ? lanternRangeM(cond) : 0;
  return Math.max(hull, lamp) / DAY_SIGHT_M;
}

// ---------------------------------------------------------------------------------------
// The detection meter (§7.1): 0 … 1 spotted … 2 identified.

/** Seconds of looking, alongside and fully alert, to spot a ship. */
export const SPOT_S = 4;
/** Seconds more, inside identification range and fully alert, to match her profile. */
export const IDENTIFY_S = 6;
/** Out of sight, the meter falls this much a second: a minute to forget a spotted ship. */
export const FORGET_PER_S = 1 / 40;
/** At the very edge of sight a watcher still fills the meter this fast, relative to alongside. */
const EDGE_RATE = 0.12;

export interface DetectionMeter {
  /** 0 … 1 spotted … 2 identified. */
  value: number;
  /** Matched to her profile once: stays so while they keep her in sight. */
  identified: boolean;
  /** Seen only by her light, never the hull, at the moment of spotting. */
  byLanternOnly: boolean;
}

export function createMeter(): DetectionMeter {
  return { value: 0, identified: false, byLanternOnly: false };
}

export const SPOTTED = 1;
export const IDENTIFIED = 2;

/**
 * One step of a watcher's meter, `dt` real seconds. In sight it climbs (faster closer and
 * the more alert they are) to spotted, and past it only while close enough to identify.
 * A lighthouse beam sweeping across her (`beamHit`) spots her at once (§6.1). Out of sight
 * it falls back; below spotted the identification is lost with it.
 */
export function stepMeter(
  m: DetectionMeter,
  s: Pick<Sight, 'by' | 'closeness01' | 'canIdentify'>,
  vigilance: number,
  dt: number,
  beamHit = false,
): DetectionMeter {
  if (s.by === 'none') {
    m.value = Math.max(0, m.value - FORGET_PER_S * dt);
    if (m.value < SPOTTED) m.identified = false;
    return m;
  }
  const rate = (vigilance * (EDGE_RATE + (1 - EDGE_RATE) * s.closeness01)) / SPOT_S;
  if (m.value < SPOTTED) {
    m.value = Math.min(SPOTTED, m.value + rate * dt);
    if (beamHit && s.by === 'hull') m.value = SPOTTED;
    if (m.value >= SPOTTED) m.byLanternOnly = s.by === 'lantern';
  } else if (s.canIdentify) {
    m.value = Math.min(IDENTIFIED, m.value + (rate * SPOT_S * dt) / IDENTIFY_S);
    m.byLanternOnly = false;
  } else if (s.by === 'hull') {
    m.byLanternOnly = false;
  }
  if (m.value >= IDENTIFIED) m.identified = true;
  return m;
}

/** The watcher's state as the HUD shows it (plan 13: shape and word, not color alone). */
export type Awareness = 'unaware' | 'watching' | 'spotted' | 'identified';

/** The meter shows as "watching" from this far toward spotted. */
export const WATCHING = 0.3;

export function awarenessOf(m: DetectionMeter): Awareness {
  if (m.identified) return 'identified';
  if (m.value >= SPOTTED) return 'spotted';
  return m.value >= WATCHING ? 'watching' : 'unaware';
}

// ---------------------------------------------------------------------------------------
// Line of sight over the zone's land.

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Whether land stands between the eye and the ship (an island between a keeper and the
 * ship hides her): samples the ground every `stepM` along the line and checks it against
 * the sight line's height there. `heightAt` is the zone's ground, meters above the lake.
 */
export function landBetween(
  heightAt: (x: number, z: number) => number,
  from: Point3,
  to: Point3,
  stepM = 40,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  // Skip the first and last stretch: the tower's own headland and the ship's own water.
  for (let s = Math.min(60, d / 2); s < d - 30; s += stepM) {
    const t = s / d;
    const lineY = from.y + (to.y - from.y) * t;
    if (heightAt(from.x + dx * t, from.z + dz * t) > lineY) return true;
  }
  return false;
}

/**
 * Whether the shore stands behind the ship as seen from the eye (§7.1: against a dark shore
 * she melts in): any land above 2 m within `beyondM` past her along the line of sight.
 */
export function shoreBehind(
  heightAt: (x: number, z: number) => number,
  from: { x: number; z: number },
  to: { x: number; z: number },
  beyondM = 1500,
  stepM = 75,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1) return false;
  const ux = dx / d;
  const uz = dz / d;
  for (let s = stepM; s <= beyondM; s += stepM) {
    if (heightAt(to.x + ux * s, to.z + uz * s) > 2) return true;
  }
  return false;
}
