import { calendarDate, dayAndHour } from '../../core/time';
import type { Entity } from '../../gameplay/ecs';
import type { HazardState } from '../../sim/sailing/hazards';
import { SAIL_LEVELS, speedKn } from '../../sim/sailing/controller';
import { sampleCurve } from '../../sim/sailing/curve';
import type { SailingClass } from '../../sim/sailing/ship-class';
import type { ZoneTerrain } from '../../sim/terrain/zone-terrain';
import { moonPhase } from '../../sim/weather/celestial';
import type { BarometerReading, BarometerTrend } from '../../sim/weather/weather';

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
  /** Damage pools and overpressing strain, 0–1 (plan 02 §6.1); absent without hazards. */
  hull01: number | undefined;
  rigging01: number;
  strain01: number | undefined;
  /** Water under the keel, meters; undefined off the loaded terrain. */
  depthM: number | undefined;
  draftM: number;
  /** The lead-line warning: shallow enough to show on the minimal HUD. */
  shallow: boolean;
  /** Short states worth a chip: aground, anchored, docking and the like. */
  status: string[];
  /** "Wk of Jun 4, 1900" and "19:30". */
  dateText: string;
  timeText: string;
  /** 0 new … 0.5 full … 1 new. */
  moonPhase01: number;
  /** The barometer (plan 04 §5.4); absent while the dev panel drives the weather. */
  barometer: BarometerSnapshot | undefined;
}

export interface BarometerSnapshot {
  /** "29.85": inches of mercury, as an 1900 Great Lakes barometer read. */
  inHgText: string;
  hpa: number;
  trend: BarometerTrend;
  /** An arrow for the trend: ⬆ ↗ → ↘ ⬇. */
  arrow: string;
}

/** hPa to inches of mercury. */
export const INHG_PER_HPA = 0.02953;

const TREND_ARROWS: Record<BarometerTrend, string> = {
  'rising fast': '⬆',
  rising: '↗',
  steady: '→',
  falling: '↘',
  'falling fast': '⬇',
};

export function barometerSnapshot(reading: BarometerReading): BarometerSnapshot {
  return {
    inHgText: (reading.hpa * INHG_PER_HPA).toFixed(2),
    hpa: reading.hpa,
    trend: reading.trend,
    arrow: TREND_ARROWS[reading.trend],
  };
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

export interface HudSources {
  /** The player's ship entity. */
  ship: Entity | undefined;
  terrain: ZoneTerrain | undefined;
  gameSeconds: number;
  /** Draft when the ship has no hazards component. */
  draftM: number;
  /** The weather's barometer at the ship, if it has one. */
  barometer?: BarometerReading | undefined;
}

/** The hazard and mooring states worth a chip on the HUD (plan 02 §6–7). */
export function hazardStatus(h: HazardState): string[] {
  const out: string[] = [];
  if (h.foundering) out.push('Foundering');
  if (h.knockdown > 0) out.push('Knocked down');
  if (h.aground) out.push(h.kedging ? 'Kedging off' : 'Aground');
  if (h.anchor === 'down') out.push(h.dragging ? 'Anchor dragging' : 'Anchored');
  if (h.anchor === 'weighing') out.push('Weighing anchor');
  if (h.mooring === 'docking') out.push('Docking');
  if (h.mooring === 'docked') out.push('Docked');
  if (h.mooring === 'castingOff') out.push('Casting off');
  return out;
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
  const hz = src.ship.hazards;
  const heading = (((s.heading * DEG) % 360) + 360) % 360;
  const onTerrain = src.terrain?.contains(s.x, s.z) ?? false;
  // The hazards' keel probes when there are any; otherwise the terrain under the ship.
  const probed = hz && Number.isFinite(hz.state.depth) ? hz.state.depth : undefined;
  const depthM = probed ?? (onTerrain ? src.terrain?.depthAt(s.x, s.z) : undefined);
  const draftM = hz ? hz.state.draft : src.draftM;
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
    hull01: hz ? hz.state.hull / hz.cls.hullHP : undefined,
    rigging01: hz ? hz.state.rigging / hz.cls.riggingHP : s.riggingCondition,
    strain01: hz?.state.strain,
    depthM,
    draftM,
    shallow: hz ? hz.state.shallow : depthM !== undefined && depthM < SHALLOW_M,
    status: hz ? hazardStatus(hz.state) : [],
    dateText: weekLabel(src.gameSeconds),
    timeText: clockLabel(src.gameSeconds),
    moonPhase01: moonPhase(calendarDate(src.gameSeconds)),
    barometer: src.barometer ? barometerSnapshot(src.barometer) : undefined,
  };
}

/**
 * Depth shows on the minimal HUD only in shallows (plan 13 §4.1): without hazards, under
 * this many meters; with them, the hazards' own 2× draft warning.
 */
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
