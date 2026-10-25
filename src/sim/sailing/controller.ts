import { msToKnots, sceneSpeed } from '../../core/coords';
import { GAMEPLAY_WAVES, type PackedWave } from '../weather/waves';
import { sampleCurve } from './curve';
import type { SailingClass } from './ship-class';

/**
 * The arcade sailing model (plan 02 §3–5): speed from wind angle, wind strength, sail
 * level and trim, with inertia, speed-dependent turning, tacking and jibing, stalling
 * in irons, sweeps, leeway and heel. Pure sim: no three.js, no ECS, no input devices.
 * The player and sailing NPCs drive it with the same commands (plan 02 §10.1).
 *
 * Units are SI (plan 01 §8) except wind, which arrives in knots from `windAt`
 * (plan 02 §11). Speeds are game speeds; positions are zone meters and move at
 * v₃ᴅ = v × R / C (plan 03 §3.3). Headings are radians clockwise from north.
 */

export const SAIL_LEVELS = ['Furled', 'Reefed', 'Half', 'Full'] as const;
export const FULL_SAIL = SAIL_LEVELS.length - 1;

/**
 * The wind at the ship, as `windAt` returns it (the S9 `Wind` shape, plan 04 §20):
 * `speedKn` already has shelter and funneling applied; gusts come separately.
 */
export interface SailingWind {
  /** Where the wind comes from, radians clockwise from north. */
  fromRad: number;
  /** Sustained speed, knots. */
  speedKn: number;
  /** Gust strength now, 0–1. */
  gust01: number;
}

/** One tick of helm orders, from the keyboard or from AI. */
export interface SailingCommand {
  /** -1 hard to port … 1 hard to starboard. */
  steer: number;
  /** One sail-level step up or down (edge-triggered). */
  raiseSail: boolean;
  lowerSail: boolean;
  /** Sheets in or out while held (manual trim only). */
  trimIn: boolean;
  trimOut: boolean;
  /** Put the sweeps out or ship them (edge-triggered). */
  toggleSweeps: boolean;
}

export const IDLE_COMMAND: Readonly<SailingCommand> = {
  steer: 0,
  raiseSail: false,
  lowerSail: false,
  trimIn: false,
  trimOut: false,
  toggleSweeps: false,
};

export interface SailingState {
  /** Zone meters. */
  x: number;
  z: number;
  heading: number;
  /** Game speed through the water along the heading, m/s; negative is sternway. */
  speed: number;
  /** Rudder angle, -1 (port) … 1 (starboard); ramps toward the helm command. */
  rudder: number;
  /** The ordered sail level, 0 (Furled) … 3 (Full). */
  sailLevel: number;
  /** The sails actually set, easing toward `sailLevel` one step per sailChangeTimeS. */
  sailSetting: number;
  /** Sheet position for manual trim: 0 hauled in hard … 1 eased right out. */
  trim: number;
  /** Manual trim on (a settings toggle; auto-trim is the default, plan 02 §3.4). */
  manualTrim: boolean;
  sweepsOut: boolean;
  /** Heel from the wind, radians, starboard side up (adds to buoyancy roll). */
  heel: number;
  /** Rigging damage, cargo and ice multipliers (plan 02 §3.1); set by other systems. */
  riggingCondition: number;
  loadFactor: number;
  iceFactor: number;

  /** Readouts from the last step, for the HUD, audio, AI and the tuning panel. */
  /** True wind angle off the bow, signed: positive when the wind is on the starboard side. */
  windAngle: number;
  /** Wind speed including the gust, knots. */
  windKn: number;
  inIrons: boolean;
  stalled: boolean;
  targetSpeed: number;
  sailFactor: number;
  polarFactor: number;
  windFactor: number;
  trimFactor: number;
  /** Where the sheets should be for this wind angle, 0–1 (the HUD sweet spot). */
  idealTrim: number;
  seaStateFactor: number;
  /** Direction of travel over the ground, radians (heading plus leeway). */
  course: number;
}

export function createSailingState(x = 0, z = 0, heading = 0): SailingState {
  return {
    x,
    z,
    heading,
    speed: 0,
    rudder: 0,
    sailLevel: 0,
    sailSetting: 0,
    trim: 0.5,
    manualTrim: false,
    sweepsOut: false,
    heel: 0,
    riggingCondition: 1,
    loadFactor: 1,
    iceFactor: 1,
    windAngle: Number.NaN,
    windKn: 0,
    inIrons: false,
    stalled: false,
    targetSpeed: 0,
    sailFactor: 0,
    polarFactor: 0,
    windFactor: 0,
    trimFactor: 1,
    idealTrim: 0,
    seaStateFactor: 1,
    course: heading,
  };
}

export type SailingEvent =
  /** The bow crossed the wind. */
  | { kind: 'tack' }
  /** The stern crossed the wind; uncontrolled in strong wind with Half or Full set. */
  | { kind: 'jibe'; uncontrolled: boolean };

export interface SceneScale {
  /** Game seconds per real second, R. */
  rate: number;
  /** Horizontal compression, C. */
  compression: number;
}

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  const w = Math.atan2(Math.sin(a), Math.cos(a));
  return w === -Math.PI ? Math.PI : w;
}

/** Speed factor for a sail setting between levels (0–3). */
export function sailFactorAt(c: SailingClass, setting: number): number {
  const lo = Math.min(Math.floor(setting), FULL_SAIL);
  const hi = Math.min(lo + 1, FULL_SAIL);
  const t = setting - lo;
  return (c.sailFactors[lo] as number) * (1 - t) + (c.sailFactors[hi] as number) * t;
}

/** Ideal sheet position for a wind angle: hauled in close-hauled, eased out running. */
export function idealTrimAt(c: SailingClass, angle: number): number {
  return clamp01((Math.abs(angle) - c.noGo) / (Math.PI - c.noGo));
}

export function trimFactorAt(
  c: SailingClass,
  manual: boolean,
  trim: number,
  ideal: number,
): number {
  if (!manual) return c.autoTrimFactor;
  const off = Math.abs(trim - ideal) - c.trimSweetSpot;
  return 1 - (1 - c.manualTrimMin) * clamp01(off / c.trimFalloff);
}

/**
 * Summed amplitude of the gameplay waves running against the bow, meters (plan 02
 * §5.2 head seas). `scale` is the local wave-height multiplier (1 in open water; less
 * in an island's lee).
 */
export function headSeaAmplitude(waves: readonly PackedWave[], heading: number, scale = 1): number {
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  let sum = 0;
  const n = Math.min(waves.length, GAMEPLAY_WAVES);
  for (let i = 0; i < n; i++) {
    const w = waves[i] as PackedWave;
    // A wave traveling opposite the heading meets the bow head on.
    sum += w.amplitude * Math.max(0, -(w.dx * fx + w.dz * fz));
  }
  return sum * scale;
}

/**
 * The plan 02 §3.1 product for a ship holding this heading, sail setting and trim,
 * without inertia. Fills the readouts on `s` and returns the target speed in m/s.
 */
export function updateTargetSpeed(
  s: SailingState,
  c: SailingClass,
  wind: SailingWind,
  headSeaM: number,
): number {
  const rel = wrapAngle(wind.fromRad - s.heading);
  const angle = Math.abs(rel);
  s.windAngle = rel;
  s.windKn = wind.speedKn * (1 + c.gustGain * clamp01(wind.gust01));
  s.inIrons = angle <= c.noGo;
  s.sailFactor = sailFactorAt(c, s.sailSetting);
  s.polarFactor = sampleCurve(c.polar, angle);
  s.windFactor = sampleCurve(c.windStrength, s.windKn);
  s.idealTrim = idealTrimAt(c, angle);
  s.trimFactor = trimFactorAt(c, s.manualTrim, s.trim, s.idealTrim);
  s.seaStateFactor = 1 - c.headSeaPenalty * clamp01(headSeaM / c.headSeaFullM);
  s.targetSpeed =
    c.hullMaxSpeed *
    s.sailFactor *
    s.polarFactor *
    s.windFactor *
    s.trimFactor *
    s.riggingCondition *
    s.loadFactor *
    s.seaStateFactor *
    s.iceFactor;
  return s.targetSpeed;
}

function approach(value: number, target: number, maxStep: number): number {
  if (Math.abs(target - value) <= maxStep) return target;
  return value + Math.sign(target - value) * maxStep;
}

/**
 * Advances one fixed tick. `headSeaM` comes from `headSeaAmplitude` at the ship. Any
 * tack or jibe this tick is pushed onto `events`.
 */
export function stepSailing(
  s: SailingState,
  cmd: SailingCommand,
  c: SailingClass,
  wind: SailingWind,
  headSeaM: number,
  scale: SceneScale,
  dt: number,
  events: SailingEvent[] = [],
): SailingEvent[] {
  // Sails: orders are instant, the work takes time (slow for the solo T1, §3.2).
  if (cmd.raiseSail) s.sailLevel = Math.min(s.sailLevel + 1, FULL_SAIL);
  if (cmd.lowerSail) s.sailLevel = Math.max(s.sailLevel - 1, 0);
  s.sailSetting = approach(s.sailSetting, s.sailLevel, dt / c.sailChangeTimeS);

  if (s.manualTrim) {
    if (cmd.trimIn) s.trim -= c.trimRate * dt;
    if (cmd.trimOut) s.trim += c.trimRate * dt;
    s.trim = clamp01(s.trim);
  }
  if (cmd.toggleSweeps) s.sweepsOut = c.sweeps && !s.sweepsOut;

  const prevAngle = s.windAngle;
  let target = updateTargetSpeed(s, c, wind, headSeaM);
  const rel = s.windAngle;
  const side = rel >= 0 ? 1 : -1;

  // Which end crossed the wind since last tick (plan 02 §4).
  if (Number.isFinite(prevAngle) && prevAngle !== 0 && rel !== 0 && Math.sign(prevAngle) !== side) {
    if (Math.abs(rel) < Math.PI / 2) {
      events.push({ kind: 'tack' });
    } else {
      const uncontrolled = s.windKn >= c.strongWindKn && s.sailSetting >= 2;
      events.push({ kind: 'jibe', uncontrolled });
    }
  }

  // In irons below steerage way the ship stalls and makes sternway (plan 02 §4).
  if (!s.inIrons || s.sweepsOut) s.stalled = false;
  else if (Math.abs(s.speed) < c.stallSpeed) s.stalled = true;
  if (s.stalled) target = -c.backDrift * s.windFactor;
  if (s.sweepsOut) target = Math.max(target, c.sweepsSpeed);
  s.targetSpeed = target;

  const tau = s.stalled || target > s.speed ? c.accelTau : s.inIrons ? c.ironsDecelTau : c.decelTau;
  s.speed += (target - s.speed) * (1 - Math.exp(-dt / tau));

  // Rudder ramps over, and comes back to center a little quicker (plan 02 §2).
  const helm = Math.min(Math.max(cmd.steer, -1), 1);
  const centering = Math.abs(helm) < Math.abs(s.rudder) && helm * s.rudder >= 0;
  s.rudder = approach(s.rudder, helm, dt / (centering ? c.rudderCenterS : c.rudderRampS));

  // The rudder needs water flow; it works backward with sternway (plan 02 §4).
  let yawRate = sampleCurve(c.turnRate, Math.abs(s.speed)) * s.rudder * (s.speed < 0 ? -1 : 1);
  if (s.sweepsOut && Math.abs(yawRate) < c.sweepsTurnRate * Math.abs(s.rudder)) {
    yawRate = c.sweepsTurnRate * s.rudder;
  }
  if (s.stalled) {
    // The wind pushes the bow off to whichever side it's already on.
    const away = rel !== 0 ? -side : s.rudder !== 0 ? Math.sign(s.rudder) : 1;
    yawRate += away * c.fallOffRate;
  }
  s.heading = wrapAngle(s.heading + yawRate * dt);

  // Leeway: a slight sideways slip when close-hauled (plan 02 §3.3).
  const angle = Math.abs(rel);
  const pinch = s.inIrons ? 0 : 1 - clamp01((angle - c.noGo) / (Math.PI / 2 - c.noGo));
  const leeway = s.speed > 0 ? c.leewayMax * s.sailFactor * pinch : 0;
  s.course = wrapAngle(s.heading - side * leeway);

  const v = sceneSpeed(s.speed, scale.rate, scale.compression);
  s.x += Math.sin(s.course) * v * dt;
  s.z += -Math.cos(s.course) * v * dt;

  // Heel to leeward from wind pressure on the sails; none while luffing (plan 02 §5.1).
  const pressure = s.inIrons ? 0 : Math.sin(angle);
  const strength = Math.min(1, (s.windKn / c.heelFullWindKn) ** 2);
  const heelTarget = side * c.heelMax * s.sailFactor * pressure * strength;
  s.heel += (heelTarget - s.heel) * (1 - Math.exp(-dt / c.heelTau));

  return events;
}

/** Speed in knots, for readouts. */
export function speedKn(s: SailingState): number {
  return msToKnots(s.speed);
}
