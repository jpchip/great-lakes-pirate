import type { AmmoDef, DamagePool, PoolDamage } from '../../../data/schemas/combat';
import type { ShipRecord } from '../../../data/schemas/ships';
import type { HitLocation } from './hull';

/**
 * An NPC ship's damage (plan 07 §4.2; Phase 6 piece A): hull, rigging, crew and, on a
 * steamer, her engine, and what they do to her. Leaks slow her and sink her at 0 after
 * she founders a while; torn rigging slows a sailing ship; a wrecked engine stops a
 * steamer, and at critical damage her boiler may go up. Crew casualties are counted
 * killed and wounded. Transient (it lives on the entity while she's on the water); piece
 * D records robbed and sunk ships in the traffic slice. Plain data and math.
 */

export interface DamageRules {
  /** A steamer's engine points, as a share of her hull points. */
  engineShareOfHull: number;
  /** A hull hit in a steamer's engine spaces carries this share of the engine damage too. */
  engineSpill: number;
  /** A waterline hit holes her this much worse. */
  waterlineMul: number;
  /** Speed left with the hull at 0 (leaks): `1 - leakSlow × (1 - hull01)`. */
  leakSlow: number;
  /** Speed left with the rigging gone, for a sailing ship. */
  bareRigSpeed: number;
  /** Engine share under which she has no way on (dead in the water). */
  engineDead01: number;
  /** Engine share under which her boiler is critical, and the chance per engine hit it bursts. */
  boilerCritical01: number;
  boilerChance: number;
  /** Of her crew, the share a boiler burst kills, and her hull share it takes. */
  boilerKilledShare: number;
  boilerHullShare: number;
  /** Hull points a burst takes off a ship next to her at 0 m, falling to 0 at the radius. */
  blastRadiusM: number;
  blastHull: number;
  /** Real seconds she founders at hull 0 before she goes under. */
  founderS: number;
  /** Her list when she goes, radians. */
  founderListRad: number;
}

export const DAMAGE_RULES: Readonly<DamageRules> = {
  engineShareOfHull: 0.35,
  engineSpill: 0.5,
  waterlineMul: 1.5,
  leakSlow: 0.6,
  bareRigSpeed: 0.25,
  engineDead01: 0.12,
  boilerCritical01: 0.25,
  boilerChance: 0.08,
  boilerKilledShare: 0.3,
  boilerHullShare: 0.45,
  blastRadiusM: 60,
  blastHull: 30,
  founderS: 30,
  founderListRad: (25 * Math.PI) / 180,
};

export interface ShipDamage {
  classId: string;
  steam: boolean;
  hull: number;
  hullMax: number;
  rigging: number;
  riggingMax: number;
  /** Engine points; 0 of 0 on a sailing ship. */
  engine: number;
  engineMax: number;
  /** Hands aboard able to work, and the ship's complement. */
  crew: number;
  crewMax: number;
  killed: number;
  wounded: number;
  boilerExploded: boolean;
  /** Real seconds she has been foundering; undefined while she floats. */
  founderingS?: number;
  sunk: boolean;
}

export function createShipDamage(
  record: ShipRecord,
  crew: number,
  rules: DamageRules = DAMAGE_RULES,
): ShipDamage {
  const steam = record.propulsion === 'steam';
  const engineMax = steam ? Math.round(record.hullHP * rules.engineShareOfHull) : 0;
  return {
    classId: record.id,
    steam,
    hull: record.hullHP,
    hullMax: record.hullHP,
    rigging: record.riggingHP,
    riggingMax: record.riggingHP,
    engine: engineMax,
    engineMax,
    crew,
    crewMax: crew,
    killed: 0,
    wounded: 0,
    boilerExploded: false,
    sunk: false,
  };
}

/** A random source in [0, 1): the run's Rng in the game, a stub in tests. */
export interface Random {
  next(): number;
}

/** What one hit did, for the events and the combat log. */
export interface HitResult {
  /** The pools it took points off, with the points (crew in hands hit). */
  pools: Partial<Record<DamagePool, number>>;
  killed: number;
  wounded: number;
  boiler?: { killed: number };
  /** She started foundering with this hit. */
  foundering: boolean;
}

/** Hands hit, as a whole number: the fraction is a chance of one more. */
function handsHit(expected: number, rng: Random): number {
  const whole = Math.floor(expected);
  return whole + (rng.next() < expected - whole ? 1 : 0);
}

/** Splits hands hit into killed and wounded, out of those still standing. */
function casualties(
  d: ShipDamage,
  hands: number,
  killedShare: number,
  rng: Random,
): { killed: number; wounded: number } {
  let killed = 0;
  let wounded = 0;
  for (let i = 0; i < hands && killed + wounded < d.crew; i++) {
    if (rng.next() < killedShare) killed++;
    else wounded++;
  }
  d.crew -= killed + wounded;
  d.killed += killed;
  d.wounded += wounded;
  return { killed, wounded };
}

/**
 * A shot's hit at `location` (plan 07 §4.1–4.3): the gun's damage for the pool it struck,
 * the stray chance of a death from splinters, the steamer's engine and the boiler.
 * `inEngine` says a hull hit was in a steamer's engine spaces.
 */
export function applyHit(
  d: ShipDamage,
  location: HitLocation,
  dmg: PoolDamage,
  ammo: AmmoDef,
  rng: Random,
  inEngine = false,
  rules: DamageRules = DAMAGE_RULES,
): HitResult {
  const out: HitResult = { pools: {}, killed: 0, wounded: 0, foundering: false };
  if (d.sunk) return out;
  const wasAfloat = d.hull > 0;
  const add = (pool: DamagePool, points: number): void => {
    if (points <= 0) return;
    out.pools[pool] = (out.pools[pool] ?? 0) + points;
  };
  const hull = (points: number): void => {
    const take = Math.min(d.hull, points);
    d.hull -= take;
    add('hull', take);
  };
  const engine = (points: number): void => {
    if (!d.steam || d.engine <= 0) return;
    const take = Math.min(d.engine, points);
    d.engine -= take;
    add('engine', take);
  };
  const hit = (hands: number, killedShare: number): void => {
    const c = casualties(d, hands, killedShare, rng);
    out.killed += c.killed;
    out.wounded += c.wounded;
    if (c.killed + c.wounded > 0) add('crew', c.killed + c.wounded);
  };

  switch (location) {
    case 'waterline':
    case 'hull':
      hull(dmg.hull * (location === 'waterline' ? rules.waterlineMul : 1));
      if (inEngine) engine(dmg.engine * rules.engineSpill);
      if (rng.next() < ammo.strayKillChance) hit(1, 1);
      break;
    case 'deck':
      hit(handsHit(dmg.crew, rng), ammo.killedShare);
      // A round through the bulwarks and deckhouse still does the hull some harm.
      hull(dmg.hull * 0.25);
      break;
    case 'engine':
      engine(dmg.engine);
      if (rng.next() < ammo.strayKillChance) hit(1, 1);
      break;
    case 'rigging': {
      const take = Math.min(d.rigging, dmg.rigging);
      d.rigging -= take;
      add('rigging', take);
      if (rng.next() < ammo.strayKillChance * 0.5) hit(1, 1);
      break;
    }
  }

  if (out.pools.engine && boilerGoes(d, rng, rules)) out.boiler = burst(d, rng, rules);
  if (out.boiler) {
    out.killed += out.boiler.killed;
  }
  if (wasAfloat && d.hull <= 0) out.foundering = startFoundering(d);
  return out;
}

function boilerGoes(d: ShipDamage, rng: Random, rules: DamageRules): boolean {
  if (!d.steam || d.boilerExploded || d.engineMax <= 0) return false;
  return d.engine / d.engineMax < rules.boilerCritical01 && rng.next() < rules.boilerChance;
}

/** The boiler bursts (plan 07 §4.2, kept 2026-10-21): her engine gone, men killed, hull torn. */
function burst(d: ShipDamage, rng: Random, rules: DamageRules): { killed: number } {
  d.boilerExploded = true;
  d.engine = 0;
  d.hull = Math.max(0, d.hull - d.hullMax * rules.boilerHullShare);
  const hands = Math.min(d.crew, Math.max(1, Math.round(d.crewMax * rules.boilerKilledShare)));
  const { killed } = casualties(d, hands, 1, rng);
  return { killed };
}

/** Sets a burst off now, for the dev panel and tests; false if she has no boiler left. */
export function explodeBoiler(
  d: ShipDamage,
  rng: Random,
  rules: DamageRules = DAMAGE_RULES,
): { killed: number; foundering: boolean } | undefined {
  if (!d.steam || d.boilerExploded || d.sunk) return undefined;
  const afloat = d.hull > 0;
  const { killed } = burst(d, rng, rules);
  return { killed, foundering: afloat && d.hull <= 0 && startFoundering(d) };
}

function startFoundering(d: ShipDamage): boolean {
  if (d.founderingS !== undefined) return false;
  d.founderingS = 0;
  return true;
}

/** Points straight off a pool, for the dev hook and for blasts; returns what it did. */
export function damagePool(
  d: ShipDamage,
  pool: DamagePool,
  points: number,
  rng: Random,
  killedShare = 0.5,
): HitResult {
  const out: HitResult = { pools: {}, killed: 0, wounded: 0, foundering: false };
  if (d.sunk || points <= 0) return out;
  const afloat = d.hull > 0;
  if (pool === 'crew') {
    const c = casualties(d, Math.round(points), killedShare, rng);
    out.killed = c.killed;
    out.wounded = c.wounded;
    if (c.killed + c.wounded > 0) out.pools.crew = c.killed + c.wounded;
  } else {
    const max = pool === 'hull' ? d.hull : pool === 'rigging' ? d.rigging : d.engine;
    const take = Math.min(max, points);
    if (pool === 'hull') d.hull -= take;
    else if (pool === 'rigging') d.rigging -= take;
    else d.engine -= take;
    if (take > 0) out.pools[pool] = take;
  }
  if (afloat && d.hull <= 0) out.foundering = startFoundering(d);
  return out;
}

/** Hull points a boiler's blast takes off a ship `distM` from it. */
export function blastDamage(distM: number, rules: DamageRules = DAMAGE_RULES): number {
  if (distM >= rules.blastRadiusM) return 0;
  return rules.blastHull * (1 - distM / rules.blastRadiusM);
}

/**
 * Her speed through the water as a share of her service speed (plan 07 §4.2): leaks
 * drag at her, a torn rig loses a sailing ship her drive, a wrecked engine stops a
 * steamer and a hurt one runs slow. A ship foundering has no way on.
 */
export function speedFactor(d: ShipDamage, rules: DamageRules = DAMAGE_RULES): number {
  if (d.sunk || d.founderingS !== undefined) return 0;
  const hull01 = d.hullMax > 0 ? d.hull / d.hullMax : 1;
  let f = 1 - rules.leakSlow * (1 - hull01);
  if (d.steam) {
    const engine01 = d.engineMax > 0 ? d.engine / d.engineMax : 1;
    f *= engine01 < rules.engineDead01 ? 0 : 0.35 + 0.65 * engine01;
  } else {
    const rig01 = d.riggingMax > 0 ? d.rigging / d.riggingMax : 1;
    f *= rules.bareRigSpeed + (1 - rules.bareRigSpeed) * rig01;
  }
  return Math.max(0, Math.min(1, f));
}

/**
 * The foundering clock: she settles and lists for `founderS`, then she's gone. Returns
 * true on the tick she sinks.
 */
export function stepFoundering(d: ShipDamage, dt: number, rules = DAMAGE_RULES): boolean {
  if (d.sunk || d.founderingS === undefined) return false;
  d.founderingS += dt;
  if (d.founderingS < rules.founderS) return false;
  d.sunk = true;
  return true;
}

/** How far along her foundering is, 0–1 (the list and how low she sits). */
export function founder01(d: ShipDamage, rules = DAMAGE_RULES): number {
  if (d.founderingS === undefined) return 0;
  return Math.min(1, d.founderingS / rules.founderS);
}
