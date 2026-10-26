import { calendarDate, dayAndHour } from '../../core/time';
import type { Entity } from '../../gameplay/ecs';
import { SAIL_LEVELS, speedKn } from '../../sim/sailing/controller';
import { sampleCurve } from '../../sim/sailing/curve';
import type { SailingClass } from '../../sim/sailing/ship-class';
import type { ZoneTerrain } from '../../sim/terrain/zone-terrain';
import { moonPhase } from '../../sim/weather/celestial';

/**
 * What the sailing HUD shows (plan 13 §4.1, plan 02 §9), sampled from the sim at most
 * 10 times a second (plan 13 §10). The HUD only reads this; it never touches the sim.
 * Angles are degrees here because that's all the HUD does with them.
 */
export interface HudSnapshot {
  /** Compass heading, degrees clockwise from north. */
  headingDeg: number;
  /** True wind angle off the bow, degrees, positive on the starboard side; NaN in a calm. */
  windAngleDeg: number;
  windKn: number;
  /** Half-width of the no-go zone either side of the wind, degrees. */
  noGoDeg: number;
  /** The best-angle band off the wind, degrees from…to (plan 02 §9 gold band). */
  bestFromDeg: number;
  bestToDeg: number;
  speedKn: number;
  /** Ordered and actually set sail levels, as names. */
  sailOrdered: string;
  sailSet: string;
  inIrons: boolean;
  sweepsOut: boolean;
  /** Manual trim: the sheet now and where it should be, 0 hauled in … 1 eased out. */
  manualTrim: boolean;
  trim: number;
  idealTrim: number;
  /** Damage pools, 0–1. Hull and strain arrive with the hazards piece; absent until then. */
  hull01: number | undefined;
  rigging01: number;
  strain01: number | undefined;
  /** Water under the keel, meters; undefined off the loaded terrain. */
  depthM: number | undefined;
  draftM: number;
  /** "Wk of Jun 4, 1900" and "19:30". */
  dateText: string;
  timeText: string;
  /** 0 new … 0.5 full … 1 new. */
  moonPhase01: number;
}

const DEG = 180 / Math.PI;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Each game day is a calendar week (core/time): "Wk of Jun 4, 1900". */
export function weekLabel(gameSeconds: number): string {
  const { day } = dayAndHour(gameSeconds);
  const d = calendarDate(day * 86_400);
  return `Wk of ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "07:05" on the game day's own clock. */
export function clockLabel(gameSeconds: number): string {
  const { hour } = dayAndHour(gameSeconds);
  const minutes = Math.floor(hour * 60);
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * The band of wind angles that sail within 5% of the best the polar gives: the gold
 * band on the wind ring.
 */
export function bestAngleBand(cls: SailingClass): { fromDeg: number; toDeg: number } {
  let best = 0;
  for (let deg = 0; deg <= 180; deg++) best = Math.max(best, sampleCurve(cls.polar, deg / DEG));
  let fromDeg = 180;
  let toDeg = 0;
  for (let deg = 0; deg <= 180; deg++) {
    if (sampleCurve(cls.polar, deg / DEG) >= best * 0.95) {
      fromDeg = Math.min(fromDeg, deg);
      toDeg = Math.max(toDeg, deg);
    }
  }
  return { fromDeg, toDeg };
}

/** Optional damage readouts the hazards piece will provide (plan 02 §6.1). */
export interface DamageReadout {
  hull01: number;
  strain01: number;
}

export interface HudSources {
  /** The player's ship entity. */
  ship: Entity | undefined;
  terrain: ZoneTerrain | undefined;
  gameSeconds: number;
  draftM: number;
  damage?: (ship: Entity) => DamageReadout | undefined;
}

const bands = new WeakMap<SailingClass, { fromDeg: number; toDeg: number }>();

/** Read a snapshot from the sim; undefined when there's no sailing ship to show. */
export function sampleHud(src: HudSources): HudSnapshot | undefined {
  const sailing = src.ship?.sailing;
  if (!src.ship || !sailing) return undefined;
  const { state: s, cls } = sailing;
  let band = bands.get(cls);
  if (!band) {
    band = bestAngleBand(cls);
    bands.set(cls, band);
  }
  const damage = src.damage?.(src.ship);
  const heading = (((s.heading * DEG) % 360) + 360) % 360;
  const onTerrain = src.terrain?.contains(s.x, s.z) ?? false;
  return {
    headingDeg: heading,
    windAngleDeg: s.windAngle * DEG,
    windKn: s.windKn,
    noGoDeg: cls.noGo * DEG,
    bestFromDeg: band.fromDeg,
    bestToDeg: band.toDeg,
    speedKn: speedKn(s),
    sailOrdered: SAIL_LEVELS[s.sailLevel] ?? 'Furled',
    sailSet: SAIL_LEVELS[Math.round(s.sailSetting)] ?? 'Furled',
    inIrons: s.inIrons,
    sweepsOut: s.sweepsOut,
    manualTrim: s.manualTrim,
    trim: s.trim,
    idealTrim: s.idealTrim,
    hull01: damage?.hull01,
    rigging01: s.riggingCondition,
    strain01: damage?.strain01,
    depthM: onTerrain ? src.terrain?.depthAt(s.x, s.z) : undefined,
    draftM: src.draftM,
    dateText: weekLabel(src.gameSeconds),
    timeText: clockLabel(src.gameSeconds),
    moonPhase01: moonPhase(calendarDate(src.gameSeconds)),
  };
}

/** Depth shows on the minimal HUD only in shallows (plan 13 §4.1): under this, meters. */
export const SHALLOW_M = 10;

/** Strain shows on the minimal HUD only when overpressed (plan 13 §4.1). */
export const STRAIN_SHOW = 0.05;

/** Compass points for the strip along the top of the HUD. */
export const COMPASS_POINTS: readonly (readonly [number, string])[] = [
  [0, 'N'],
  [45, 'NE'],
  [90, 'E'],
  [135, 'SE'],
  [180, 'S'],
  [225, 'SW'],
  [270, 'W'],
  [315, 'NW'],
];
