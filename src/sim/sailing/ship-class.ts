import type { HandlingRecord } from './handling';
import type { SailShipRecord } from '../../../data/schemas/ships';
import { knotsToMs } from '../../core/coords';
import { createCurve, type Curve } from './curve';

const DEG = Math.PI / 180;

/**
 * A sailing ship class in sim units (plan 01 §8): m/s, radians, seconds. Built from a
 * ships.json record plus the shared handling rules; rebuild it when either changes.
 */
export interface SailingClass {
  id: string;
  hullMaxSpeed: number;
  accelTau: number;
  decelTau: number;
  /** Speed (m/s) → turn rate (rad/s) at full rudder. */
  turnRate: Curve;
  /** True wind angle off the bow (rad, 0–π) → speed factor. */
  polar: Curve;
  /** The widest wind angle where the polar is still zero: the no-go zone. */
  noGo: number;
  sailChangeTimeS: number;
  sweeps: boolean;
  sweepsSpeed: number;
  sweepsTurnRate: number;

  sailFactors: readonly [number, number, number, number];
  /** Wind speed (knots) → windStrengthFactor. */
  windStrength: Curve;
  gustGain: number;
  autoTrimFactor: number;
  manualTrimMin: number;
  trimSweetSpot: number;
  /** Extra speed with the sheets in the sweet spot by hand (the Deckhand's perk; 0 or absent otherwise). */
  trimmedBonus?: number;
  trimFalloff: number;
  trimRate: number;
  rudderRampS: number;
  rudderCenterS: number;
  ironsDecelTau: number;
  stallSpeed: number;
  backDrift: number;
  fallOffRate: number;
  heelMax: number;
  heelFullWindKn: number;
  heelTau: number;
  leewayMax: number;
  headSeaPenalty: number;
  headSeaFullM: number;
  strongWindKn: number;
}

export function compileSailingClass(ship: SailShipRecord, h: HandlingRecord): SailingClass {
  const polarPoints = ship.polar.map(([deg, f]) => [deg * DEG, f] as const);
  let noGo = 0;
  for (const [angle, f] of polarPoints) {
    if (f > 0) break;
    noGo = angle;
  }
  return {
    id: ship.id,
    hullMaxSpeed: knotsToMs(ship.hullMaxSpeedKn),
    accelTau: ship.accelTau,
    decelTau: ship.decelTau,
    turnRate: createCurve(ship.turnRateCurve.map(([kn, deg]) => [knotsToMs(kn), deg * DEG])),
    polar: createCurve(polarPoints),
    noGo,
    sailChangeTimeS: ship.sailChangeTimeS,
    sweeps: ship.sweeps,
    sweepsSpeed: knotsToMs(ship.sweepsKn),
    sweepsTurnRate: ship.sweepsTurnDegS * DEG,

    sailFactors: h.sailFactors,
    windStrength: createCurve(h.windStrength),
    gustGain: h.gustGain,
    autoTrimFactor: h.autoTrimFactor,
    manualTrimMin: h.manualTrimMin,
    trimSweetSpot: h.trimSweetSpot,
    trimFalloff: h.trimFalloff,
    trimRate: h.trimRate,
    rudderRampS: h.rudderRampS,
    rudderCenterS: h.rudderCenterS,
    ironsDecelTau: h.ironsDecelTau,
    stallSpeed: knotsToMs(h.stallSpeedKn),
    backDrift: knotsToMs(h.backDriftKn),
    fallOffRate: h.fallOffDegS * DEG,
    heelMax: h.heelMaxDeg * DEG,
    heelFullWindKn: h.heelFullWindKn,
    heelTau: h.heelTau,
    leewayMax: h.leewayMaxDeg * DEG,
    headSeaPenalty: h.headSeaPenalty,
    headSeaFullM: h.headSeaFullM,
    strongWindKn: h.strongWindKn,
  };
}
