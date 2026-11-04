import type { LighthouseDef } from '../../../data/schemas/lighthouses';
import { flashSeen, LIGHT_TIERS, lightRangeM, type PlacedLight } from '../lighthouses';
import type { ObserverSpec } from './perception';
import type { WitnessKind } from './witness';

/**
 * The eyes at sea (plan 06 §5.5, §6.1; Phase 5 piece B): lighthouse keepers on their
 * galleries, the crews of passing ships, and the revenue cutter's lookout. Each is an
 * `ObserverSpec` for the perception module plus who they are, for the witness they become.
 * Pure: the gameplay layer places them from the zone's lights and the ships in the world.
 */

export interface Observer extends ObserverSpec {
  id: string;
  kind: WitnessKind;
  name: string;
  x: number;
  z: number;
  reporting?: LighthouseDef['reporting'];
  /** A keeper's light, for its beam and its glow. */
  light?: PlacedLight;
}

/**
 * Keepers dozed before dawn (§6.1: "a keeper might doze"): the hours from 2 to 5 are the
 * dog watch of a light, the lamp trimmed and the log written.
 */
export const DOZE_FROM_H = 2;
export const DOZE_TO_H = 5;

/** At Wanted tier 3 and up keepers watch harder (§6.1). */
export const ALERT_TIER = 3;

/**
 * How hard a station's keepers watch the water at this hour (0–1). By day it's a glance up
 * from the work; at night one is on watch in the lantern room, more alert at a station of
 * three than a lone keeper, and a lone keeper nods off before dawn. A dark station (no
 * keeper) watches nothing.
 */
export function keeperVigilance(
  def: Pick<LighthouseDef, 'keepers' | 'lit'>,
  hour: number,
  daylight01: number,
  wantedTier = 0,
): number {
  if (!def.lit || def.keepers <= 0) return 0;
  const night = def.keepers >= 3 ? 0.85 : def.keepers === 2 ? 0.75 : 0.6;
  const doze = hour >= DOZE_FROM_H && hour < DOZE_TO_H;
  const dozing = !doze ? 1 : def.keepers >= 3 ? 0.85 : def.keepers === 2 ? 0.6 : 0.3;
  const v = 0.5 * daylight01 + night * dozing * (1 - daylight01);
  return Math.min(1, v * (wantedTier >= ALERT_TIER ? 1.35 : 1));
}

/** A keeper's eye: the gallery around the lantern, above the lake. */
export function keeperEyeM(p: Pick<PlacedLight, 'groundM' | 'def'>): number {
  return p.groundM + p.def.tower.heightM + 1.6;
}

/** The keepers of the lit, kept lights in a zone, as observers. */
export function keeperObservers(
  lights: readonly PlacedLight[],
  hour: number,
  daylight01: number,
  wantedTier: (lightId: string) => number = () => 0,
): Observer[] {
  const out: Observer[] = [];
  for (const p of lights) {
    const vigilance = keeperVigilance(p.def, hour, daylight01, wantedTier(p.def.id));
    if (vigilance <= 0) continue;
    out.push({
      id: p.def.id,
      kind: 'keeper',
      name: `${p.def.name.replace(/ Light$/, '')} keeper`,
      x: p.x,
      z: p.z,
      eyeM: keeperEyeM(p),
      spyglass: false,
      vigilance,
      reporting: p.def.reporting,
      light: p,
    });
  }
  return out;
}

/** Eye heights on deck by ships.json class: a freighter's pilothouse stands high. */
const DECK_EYE_M: Readonly<Record<string, number>> = {
  'ship.ore_freighter': 14,
  'ship.package_steamer': 12,
  'ship.schooner_barge': 7,
  'ship.fish_tug': 5,
  'ship.cutter_morrill': 10,
};

export const CUTTER_CLASS_ID = 'ship.cutter_morrill';

/**
 * A ship's watch as an observer: a crew keeps a lookout of sorts (busy by day, a man at
 * the wheel by night), the *Morrill* a proper one with a glass.
 */
export function shipObserver(
  ship: { id: string; classId: string; name: string; x: number; z: number },
  daylight01: number,
): Observer {
  const cutter = ship.classId === CUTTER_CLASS_ID;
  return {
    id: ship.id,
    kind: cutter ? 'cutter' : 'crew',
    name: ship.name,
    x: ship.x,
    z: ship.z,
    eyeM: DECK_EYE_M[ship.classId] ?? 5,
    spyglass: cutter,
    vigilance: cutter ? 0.9 + 0.1 * daylight01 : 0.35 + 0.2 * daylight01,
  };
}

/** A light's glow lights the water round it this far, as a share of its range. */
export const GLOW_SHARE = 0.15;

/**
 * Whether the ship lies in a lit light's glow (§7.1: "against a lighthouse beam"), so she
 * stands out to anyone looking her way. `lamp01` is how lit the lamps are (lampLevel).
 */
export function inGlow(
  lights: readonly PlacedLight[],
  ship: { x: number; z: number },
  lamp01: number,
): boolean {
  if (lamp01 < 0.5) return false;
  return lights.some(
    (p) =>
      p.def.lit &&
      Math.hypot(ship.x - p.x, ship.z - p.z) < LIGHT_TIERS[p.def.tier].rangeM * GLOW_SHARE,
  );
}

/** A flashing light's beam lights a ship this far out, as a share of its range. */
export const BEAM_SHARE = 0.6;

/**
 * Whether a flashing light's beam is sweeping across the ship now (§6.1: "a direct hit =
 * instant spot within range" for its keeper). `beamS` is the lens's clock.
 */
export function beamHit(
  p: PlacedLight,
  ship: { x: number; z: number },
  beamS: number,
  lamp01: number,
): boolean {
  if (!p.def.lit || lamp01 < 0.5 || p.def.characteristic.kind !== 'flashing') return false;
  const dx = ship.x - p.x;
  const dz = ship.z - p.z;
  if (Math.hypot(dx, dz) > lightRangeM(p.def) * BEAM_SHARE) return false;
  // Bearing from the light: clockwise from north, north being -z.
  return flashSeen(p.def, beamS, Math.atan2(dx, -dz)) > 0.5;
}
