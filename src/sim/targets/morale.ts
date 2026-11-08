import type { ShipCombat, ShipRecord } from '../../../data/schemas/ships';

/**
 * A target ship's will (plan 07 §5; Phase 6 piece C): the morale meter, and her captain's
 * `Transit → Alert → Flee / Fight / Surrender`. Plain state and plain inputs, so it unit-
 * tests; `gameplay/targets.ts` tells it each tick what her lookout sees and what's been
 * done to her, and carries out what the captain decides.
 *
 * - **The meter (0–100)** is her class's base (`ships.json` `combat.moraleBase`), plus
 *   the situation she's in now (`standing`: Fame, the guns she faces, help near, whether
 *   she can outrun you, whether she's disabled or caught), plus what she's been through
 *   (`shock`: warning shots, hits, casualties), which wears off slowly once the firing
 *   stops. Every part has a name, so the HUD can say why she struck or why she didn't.
 * - **Transit** is her lane. A ship running at her, a shot near her, or gunfire close by
 *   puts her on the **alert**. Night or fog surprise costs her nerve when it does.
 * - On the alert she decides: below `strikeBelow` she **strikes her colors** (heaves to,
 *   a white flag; for good), below her flee line she **runs**, and otherwise she holds
 *   on at her best speed. A barge on her towline can't run on her own. Only an armed
 *   ship, or a determined steamer's captain with his blood up, turns to **fight** (ram).
 * - A runner that opens the range far enough has **fled**.
 */

export type TargetPhase = 'transit' | 'alert' | 'fleeing' | 'fighting' | 'struck' | 'fled';

export interface MoraleRules {
  /** Below this she strikes her colors. */
  strikeBelow: number;
  /** Her flee line is `fleeBase + fleeSpan × combat.flee`: below it she runs. */
  fleeBase: number;
  fleeSpan: number;
  /** A runner stops running only this far back above her flee line. */
  fleeHysteresis: number;
  /** A ship closing on her inside this range, zone meters, puts her on the alert... */
  alertRangeM: number;
  /** ...when it closes this fast, knots, and would pass this close, meters. */
  alertClosingKn: number;
  alertCpaM: number;
  /** A ship lying this close to her this long puts her on the alert too. */
  shadowRangeM: number;
  shadowS: number;
  /** At night or in fog her lookout sees the threat only this share as far. */
  darkAlertShare: number;
  /** Surprised at close range in the dark: this much off her nerve. */
  surpriseShock: number;
  surpriseRangeM: number;
  /** Warning shots: the first takes this much, each after it `warnDecay` as much again. */
  warnShock: number;
  warnDecay: number;
  /** Hits: this much per share of hull, rigging (sail and steam) and engine lost. */
  hullShock: number;
  riggingShockSail: number;
  riggingShockSteam: number;
  engineShock: number;
  /** Casualties: this much per share of her crew killed, and wounded. */
  killedShock: number;
  woundedShock: number;
  /** Standing: per Fame tier, per gun she faces (capped), and help in reach. */
  perFameTier: number;
  perGun: number;
  gunsCap: number;
  friendNear: number;
  friendRangeM: number;
  refugeNear: number;
  refugeRangeM: number;
  /** Other ships in view by day, each (capped at two). */
  perWitness: number;
  outrun: number;
  determined: number;
  /** One in this many captains is determined (seeded by her id). */
  determinedShare: number;
  disabled: number;
  sinking: number;
  /** Hull share at or below which she's sinking. */
  sinkingHull01: number;
  /** Rigging share at or below which a sailing ship is disabled. */
  disabledRigging01: number;
  becalmed: number;
  trapped: number;
  adrift: number;
  /** A ship that can't outrun you, held alongside this long, inside this range: caught. */
  caught: number;
  caughtRangeM: number;
  caughtS: number;
  /** Shock wears off this much a second once nobody has fired on her for `quietS`. */
  recoverPerS: number;
  quietS: number;
  /** A runner this far from the player has fled. */
  fledRangeM: number;
  /** On the alert but left alone this far off this long, she goes back to her lane. */
  standDownRangeM: number;
  standDownS: number;
  /** A determined steamer rams above this morale, inside this range. */
  ramAbove: number;
  ramRangeM: number;
  /** An armed ship fights above this morale. */
  fightAbove: number;
  /**
   * An honest captain doesn't run from a schooner that only comes close: she runs once
   * someone's fired on or near her, or when the player is this famous (she knows the ship).
   */
  recognizedFameTier: number;
}

export const MORALE_RULES: MoraleRules = {
  strikeBelow: 25,
  fleeBase: 50,
  fleeSpan: 40,
  fleeHysteresis: 8,
  alertRangeM: 550,
  alertClosingKn: 1.5,
  alertCpaM: 150,
  shadowRangeM: 180,
  shadowS: 10,
  darkAlertShare: 0.45,
  surpriseShock: 12,
  surpriseRangeM: 400,
  warnShock: 14,
  warnDecay: 0.75,
  hullShock: 50,
  riggingShockSail: 35,
  riggingShockSteam: 12,
  engineShock: 40,
  killedShock: 120,
  woundedShock: 40,
  perFameTier: 4,
  perGun: 6,
  gunsCap: 3,
  friendNear: 20,
  friendRangeM: 2500,
  refugeNear: 8,
  refugeRangeM: 3000,
  perWitness: 4,
  outrun: 10,
  determined: 15,
  determinedShare: 0.12,
  disabled: 25,
  sinking: 30,
  sinkingHull01: 0.3,
  disabledRigging01: 0.25,
  becalmed: 10,
  trapped: 15,
  adrift: 15,
  caught: 15,
  caughtRangeM: 90,
  caughtS: 8,
  recoverPerS: 0.2,
  quietS: 20,
  fledRangeM: 1800,
  standDownRangeM: 1500,
  standDownS: 60,
  recognizedFameTier: 2,
  ramAbove: 75,
  ramRangeM: 400,
  fightAbove: 70,
};

/** What her lookout and her master know this tick. */
export interface TargetSituation {
  /** The player's ship: how far, how fast it closes (knots, + closing), how close it'd pass. */
  rangeM: number;
  closingKn: number;
  cpaM: number;
  /** The player's Fame tier (0 Unknown … 4 Legendary). */
  fameTier: number;
  /** The guns she faces: 0 small arms only, 1 a swivel, 2 a light broadside, 3+ heavier. */
  playerGuns: number;
  /** 0 broad day and clear, 1 a dark night or thick fog. */
  dark01: number;
  /** The nearest friendly armed ship (the cutter), meters; undefined if none in reach. */
  friendM?: number | undefined;
  /** The nearest harbor, meters; undefined in open water. */
  refugeM?: number | undefined;
  /** Other ships (not struck) within sight of her. */
  witnesses: number;
  /** Her best speed beats the player's now. */
  canOutrun: boolean;
  /** A sailing ship with no wind to run on. */
  becalmed: boolean;
  /** No clear water to run for (land all round). */
  trapped: boolean;
  /** A consort still on her towline: she goes where her steamer goes. */
  towed: boolean;
  /** Her towline parted: no way on and no say in where she drifts. */
  adrift: boolean;
}

/** Her damage pools as shares left (1 sound), and her dead and wounded. */
export interface TargetDamage {
  hull01: number;
  rigging01: number;
  engine01: number;
  killed: number;
  wounded: number;
}

export type DamagePool = 'hull' | 'rigging' | 'engine';

export interface TargetCaptain {
  readonly id: string;
  readonly classId: string;
  readonly propulsion: 'sail' | 'steam';
  readonly stats: ShipCombat;
  /** A rare captain who holds on longer and may ram (seeded by her id). */
  readonly determined: boolean;
  phase: TargetPhase;
  /** What she's been through: warning shots, hits and casualties (≤ 0). */
  shock: number;
  /** Warning shots across her bow so far. */
  warnings: number;
  damage: TargetDamage;
  /** Seconds since anyone last fired on her or near her. */
  quietS: number;
  /** Seconds the player has lain close by (shadowing, or caught alongside). */
  closeS: number;
  /** Seconds on the alert, left alone and out of range (standing down). */
  idleS: number;
  /** The meter as last worked out, and why. */
  morale: number;
  parts: MoralePart[];
  /** Why she did the last thing she did, for the HUD and the combat log. */
  why: string;
  /** Someone has fired on her or near her: she knows what she's dealing with. */
  provoked: boolean;
}

/** One named share of the meter: `+20 the cutter is near`. */
export interface MoralePart {
  label: string;
  value: number;
}

export type CaptainAction =
  | { type: 'phase'; from: TargetPhase; to: TargetPhase; morale: number; why: string }
  | { type: 'surprised'; shock: number };

/** 0–1 from a string, stable across runs: the same ship has the same captain. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** The captain of a target class's ship, or undefined for a class nobody robs. */
export function createCaptain(
  id: string,
  record: ShipRecord,
  rules: MoraleRules = MORALE_RULES,
): TargetCaptain | undefined {
  const stats = record.combat;
  if (!stats?.target) return undefined;
  return {
    id,
    classId: record.id,
    propulsion: record.propulsion,
    stats,
    determined: hash01(`${id}:captain`) < rules.determinedShare,
    phase: 'transit',
    shock: 0,
    warnings: 0,
    damage: { hull01: 1, rigging01: 1, engine01: 1, killed: 0, wounded: 0 },
    quietS: Infinity,
    closeS: 0,
    idleS: 0,
    morale: stats.moraleBase,
    parts: [],
    why: '',
    provoked: false,
  };
}

/** Her flee line: below it she runs. */
export function fleeLine(c: TargetCaptain, rules: MoraleRules = MORALE_RULES): number {
  return rules.fleeBase + rules.fleeSpan * c.stats.flee;
}

/** Whether she's disabled: a steamer's engine stopped, or a sailing ship's rig shot away. */
export function disabled(c: TargetCaptain, rules: MoraleRules = MORALE_RULES): boolean {
  return c.propulsion === 'steam'
    ? c.damage.engine01 <= 0
    : c.damage.rigging01 <= rules.disabledRigging01;
}

/** The situation's share of the meter, named part by part (zero parts left out). */
export function standing(
  c: TargetCaptain,
  sit: TargetSituation,
  rules: MoraleRules = MORALE_RULES,
): MoralePart[] {
  const parts: MoralePart[] = [];
  const add = (label: string, value: number): void => {
    if (value !== 0) parts.push({ label, value: Math.round(value * 10) / 10 });
  };
  add('your Fame', -rules.perFameTier * Math.max(0, sit.fameTier));
  const guns = Math.min(Math.max(0, sit.playerGuns), rules.gunsCap);
  // An armed ship minds only a heavier battery than a swivel and small arms.
  add('your guns', -rules.perGun * (c.stats.armed ? Math.max(0, guns - 2) : guns));
  if (sit.friendM !== undefined && sit.friendM < rules.friendRangeM)
    add('the cutter is near', rules.friendNear);
  if (sit.refugeM !== undefined && sit.refugeM < rules.refugeRangeM)
    add('a harbor is near', rules.refugeNear);
  add('ships in view', rules.perWitness * Math.min(sit.witnesses, 2) * (1 - sit.dark01));
  if (sit.canOutrun && !sit.towed && !sit.adrift && !disabled(c, rules))
    add('she can outrun you', rules.outrun);
  if (c.determined) add('a determined captain', rules.determined);
  if (disabled(c, rules)) add('disabled', -rules.disabled);
  if (c.damage.hull01 <= rules.sinkingHull01) add('sinking', -rules.sinking);
  if (sit.becalmed && c.propulsion === 'sail' && !sit.towed) add('becalmed', -rules.becalmed);
  if (sit.trapped) add('nowhere to run', -rules.trapped);
  if (sit.adrift) add('adrift', -rules.adrift);
  if (c.closeS >= rules.caughtS && sit.rangeM < rules.caughtRangeM && !sit.canOutrun)
    add('caught', -rules.caught);
  return parts;
}

/** Works out the meter (and its parts) for the situation now. */
export function moraleOf(
  c: TargetCaptain,
  sit: TargetSituation,
  rules: MoraleRules = MORALE_RULES,
): number {
  const parts = standing(c, sit, rules);
  if (c.shock < 0) parts.push({ label: 'under fire', value: Math.round(c.shock * 10) / 10 });
  c.parts = parts;
  let m = c.stats.moraleBase;
  for (const p of parts) m += p.value;
  c.morale = Math.max(0, Math.min(100, m));
  return c.morale;
}

/** A shot across her bow (landed near her, not on her). */
export function noteWarningShot(c: TargetCaptain, rules: MoraleRules = MORALE_RULES): void {
  if (c.phase === 'struck') return;
  c.shock -= rules.warnShock * rules.warnDecay ** c.warnings;
  c.warnings++;
  c.quietS = 0;
  c.provoked = true;
  c.why = 'a shot across her bow';
}

/** A hit: `share` of the pool's full value carried away (0–1). */
export function noteHit(
  c: TargetCaptain,
  pool: DamagePool,
  share: number,
  rules: MoraleRules = MORALE_RULES,
): void {
  const d = c.damage;
  const s = Math.max(0, share);
  if (pool === 'hull') {
    const lost = Math.min(s, d.hull01);
    d.hull01 -= lost;
    c.shock -= rules.hullShock * lost;
  } else if (pool === 'rigging') {
    const lost = Math.min(s, d.rigging01);
    d.rigging01 -= lost;
    c.shock -= (c.propulsion === 'sail' ? rules.riggingShockSail : rules.riggingShockSteam) * lost;
  } else {
    const lost = Math.min(s, d.engine01);
    d.engine01 -= lost;
    c.shock -= rules.engineShock * lost;
  }
  c.quietS = 0;
  c.provoked = true;
  c.why = `hit in the ${pool}`;
}

/** Men killed and wounded aboard her. */
export function noteCasualties(
  c: TargetCaptain,
  killed: number,
  wounded: number,
  rules: MoraleRules = MORALE_RULES,
): void {
  const crew = Math.max(1, c.stats.crew);
  c.damage.killed += killed;
  c.damage.wounded += wounded;
  c.shock -= (rules.killedShock * killed + rules.woundedShock * wounded) / crew;
  c.quietS = 0;
  c.provoked = true;
  if (killed > 0) c.why = killed === 1 ? 'a man killed' : `${killed} men killed`;
}

/** Gunfire heard close by: she's on the alert even if nobody fired at her. */
export function noteGunfire(c: TargetCaptain): void {
  c.provoked = true;
  if (c.phase === 'transit') c.quietS = 0;
}

function setPhase(c: TargetCaptain, to: TargetPhase, why: string, out: CaptainAction[]): void {
  if (c.phase === to) return;
  out.push({ type: 'phase', from: c.phase, to, morale: c.morale, why });
  c.phase = to;
  c.why = why;
}

/** Why she struck, from the biggest blows to her nerve. */
function strikeWhy(c: TargetCaptain): string {
  const worst = [...c.parts].filter((p) => p.value < 0).sort((a, b) => a.value - b.value);
  return worst
    .slice(0, 2)
    .map((p) => p.label)
    .join(', ');
}

/**
 * One tick of her captain: the meter for the situation now, and what he does about it.
 * Returns the phase changes (and a night surprise) for the caller to carry out.
 */
export function stepCaptain(
  c: TargetCaptain,
  sit: TargetSituation,
  dt: number,
  rules: MoraleRules = MORALE_RULES,
): CaptainAction[] {
  const out: CaptainAction[] = [];
  if (c.phase === 'struck' || c.phase === 'fled') {
    moraleOf(c, sit, rules);
    return out;
  }
  c.quietS += dt;
  c.closeS = sit.rangeM < rules.shadowRangeM ? c.closeS + dt : 0;
  if (c.quietS > rules.quietS && c.shock < 0)
    c.shock = Math.min(0, c.shock + rules.recoverPerS * dt);

  if (c.phase === 'transit') {
    const see = rules.alertRangeM * (1 - (1 - rules.darkAlertShare) * sit.dark01);
    const running =
      sit.rangeM < see && sit.closingKn > rules.alertClosingKn && sit.cpaM < rules.alertCpaM;
    const shadowed = c.closeS >= rules.shadowS;
    const fired = c.quietS < dt * 2;
    if (!running && !shadowed && !fired) {
      moraleOf(c, sit, rules);
      return out;
    }
    if (sit.dark01 > 0.5 && sit.rangeM < rules.surpriseRangeM) {
      const shock = rules.surpriseShock * sit.dark01;
      c.shock -= shock;
      out.push({ type: 'surprised', shock });
    }
    moraleOf(c, sit, rules);
    setPhase(
      c,
      'alert',
      fired ? 'gunfire' : shadowed ? 'a ship lying close by' : 'a ship running down on her',
      out,
    );
  }

  const m = moraleOf(c, sit, rules);
  if (m < rules.strikeBelow) {
    setPhase(c, 'struck', strikeWhy(c) || 'her nerve broke', out);
    return out;
  }
  const canRun = !sit.towed && !sit.adrift && !disabled(c, rules);
  // Only a ship that knows she's being robbed runs: fired on, or the pirate recognized.
  const wary = c.provoked || sit.fameTier >= rules.recognizedFameTier;
  const fightOn =
    (c.stats.armed && m > rules.fightAbove) ||
    (c.determined &&
      c.propulsion === 'steam' &&
      canRun &&
      m > rules.ramAbove &&
      sit.rangeM < rules.ramRangeM &&
      c.quietS < rules.quietS);
  const line = fleeLine(c, rules);
  if (fightOn) {
    setPhase(c, 'fighting', c.stats.armed ? 'she fights' : 'her captain means to ram', out);
  } else if (
    canRun &&
    wary &&
    (m < line || (c.phase === 'fleeing' && m < line + rules.fleeHysteresis))
  ) {
    setPhase(c, 'fleeing', 'she runs for it', out);
  } else if (c.phase !== 'alert') {
    setPhase(c, 'alert', canRun ? 'she holds on' : 'she can only wait', out);
  }

  if (c.phase === 'fleeing' && sit.rangeM > rules.fledRangeM) {
    setPhase(c, 'fled', 'she got away', out);
    return out;
  }
  // Left alone, she stands down and goes back to her lane.
  const idle =
    c.phase === 'alert' && sit.rangeM > rules.standDownRangeM && c.quietS > rules.standDownS;
  c.idleS = idle ? c.idleS + dt : 0;
  if (c.idleS > rules.standDownS) {
    c.shock = 0;
    c.warnings = 0;
    c.provoked = false;
    setPhase(c, 'transit', 'she stood down', out);
  }
  return out;
}
