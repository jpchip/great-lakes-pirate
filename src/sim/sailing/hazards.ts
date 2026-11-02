import type { SailShipRecord } from '../../../data/schemas/ships';
import { knotsToMs, msToKnots, sceneSpeed } from '../../core/coords';
import { bearingVector, dockBerths, type Berth, type Dock, type Pose } from '../terrain/test-bay';
import { wrapAngle, type SailingState, type SailingWind, type SceneScale } from './controller';
import type { HazardRules } from './hazard-rules';

/**
 * Hazards, damage and mooring (plan 02 §6–7): running aground, hitting rock and piers,
 * the hull and rigging pools and what damage does to handling, overpressing strain and
 * knockdowns, anchoring with drag, and auto-docking. Pure sim like the controller: it
 * runs right after `stepSailing` on the same ship and corrects where the controller put
 * it. Positions are zone meters, speeds game m/s, headings radians clockwise from north.
 */

const DEG = Math.PI / 180;

/** Per-class numbers from ships.json plus the shared rules. */
export interface HazardClass {
  lengthM: number;
  halfBeamM: number;
  draftEmptyM: number;
  draftFullM: number;
  hullHP: number;
  riggingHP: number;
  anchorRodeM: number;
  rules: HazardRules;
}

export function compileHazardClass(ship: SailShipRecord, rules: HazardRules): HazardClass {
  return {
    lengthM: ship.lengthM,
    halfBeamM: ship.buoyancy.beam / 2,
    draftEmptyM: ship.draftEmptyM,
    draftFullM: ship.draftFullM,
    hullHP: ship.hullHP,
    riggingHP: ship.riggingHP,
    anchorRodeM: ship.anchorRodeM,
    rules,
  };
}

export type AnchorState = 'up' | 'down' | 'weighing';
export type MooringState = 'free' | 'docking' | 'docked' | 'castingOff';

export interface HazardState {
  hull: number;
  rigging: number;
  /**
   * The hold's load, 0 empty … 1 full of the heaviest goods (plan 05 `holdLoad01`): sets
   * the draft between draftEmptyM and draftFullM and the cargo speed loss.
   */
  cargo01: number;
  /** Overpressing strain, 0–1 (plan 02 §3.5). Rigging tears above strainDamageAt. */
  strain: number;
  /** How far over the safe wind the sails are now, 0–1: where strain is heading. */
  overpress: number;
  /** Draft now, meters: cargo plus water in the hold. */
  draft: number;
  /** Shallowest water under the keel probes, meters; Infinity with no terrain. */
  depth: number;
  /** The depth readout's warning: under 2× draft (plan 02 §6.2). */
  shallow: boolean;
  aground: boolean;
  /** Hauling off on the kedge anchor this tick (X held while aground). */
  kedging: boolean;
  /** Hull at 0: the ship is going down (plan 02 §6.5; abandon ship is a later phase). */
  foundering: boolean;
  /** Seconds left in a knockdown's lurch and recovery; 0 when upright. */
  knockdown: number;
  knockdownSide: number;
  knockdownCooldown: number;

  anchor: AnchorState;
  /** Where the anchor lies, zone meters. */
  anchorX: number;
  anchorZ: number;
  /** Seconds X has been held; a hold of anchorHoldS acts once per press. */
  anchorHeldS: number;
  anchorLatched: boolean;
  /** Seconds left weighing anchor. */
  weighS: number;
  dragging: boolean;
  /** What the anchor holds here, and the wind load on the ship, knots. */
  holdingKn: number;
  anchorLoadKn: number;

  mooring: MooringState;
  berthId: string | undefined;
  /** Seconds into docking, or left in casting off. */
  mooringS: number;
  /** Where the auto-dock started from. */
  from: Pose;
}

export function createHazardState(c: HazardClass): HazardState {
  return {
    hull: c.hullHP,
    rigging: c.riggingHP,
    cargo01: 0,
    strain: 0,
    overpress: 0,
    draft: c.draftEmptyM,
    depth: Number.POSITIVE_INFINITY,
    shallow: false,
    aground: false,
    kedging: false,
    foundering: false,
    knockdown: 0,
    knockdownSide: 1,
    knockdownCooldown: 0,
    anchor: 'up',
    anchorX: 0,
    anchorZ: 0,
    anchorHeldS: 0,
    anchorLatched: false,
    weighS: 0,
    dragging: false,
    holdingKn: 0,
    anchorLoadKn: 0,
    mooring: 'free',
    berthId: undefined,
    mooringS: 0,
    from: { x: 0, z: 0, heading: 0 },
  };
}

/** Full repair of both pools (the dev panel; shipyards later, plan 02 §6.1). */
export function repairAll(h: HazardState, c: HazardClass): void {
  h.hull = c.hullHP;
  h.rigging = c.riggingHP;
  h.foundering = false;
}

/** What hazards need from the zone's terrain; `ZoneTerrain` fits. */
export interface HazardTerrain {
  /** Water depth, meters; 0 on land. */
  depthAt(x: number, z: number): number;
}

/** A berth with the direction away from its pier, for casting off. */
export interface MooringBerth extends Berth {
  awayX: number;
  awayZ: number;
}

/** Water a berth needs under its middle to be offered, meters. */
const BERTH_MIN_DEPTH_M = 3;

/**
 * Every pier's berths with their away directions. With the terrain, berths in water
 * shallower than 3 m are left out (the inner ones on a pier over a shoaling bottom).
 */
export function mooringBerths(docks: readonly Dock[], terrain?: HazardTerrain): MooringBerth[] {
  const out: MooringBerth[] = [];
  for (const dock of docks) {
    const f = bearingVector(dock.bearing);
    for (const berth of dockBerths(dock)) {
      if (terrain && terrain.depthAt(berth.pose.x, berth.pose.z) < BERTH_MIN_DEPTH_M) continue;
      const dx = berth.pose.x - dock.root.x;
      const dz = berth.pose.z - dock.root.z;
      const along = dx * f.x + dz * f.z;
      const ax = dx - f.x * along;
      const az = dz - f.z * along;
      const len = Math.hypot(ax, az) || 1;
      out.push({ ...berth, awayX: ax / len, awayZ: az / len });
    }
  }
  return out;
}

export interface HazardEnv {
  /** Absent: open water everywhere. */
  terrain?: HazardTerrain | undefined;
  /** Piers, as obstacles. */
  docks: readonly Dock[];
  berths: readonly MooringBerth[];
}

/** One tick of anchor and dock orders. */
export interface MooringCommand {
  /** X held: drop or weigh anchor after a short hold, or kedge off when aground. */
  anchor: boolean;
  /** F pressed (edge-triggered): auto-dock at a berth, or cast off. */
  interact: boolean;
}

export const IDLE_MOORING: Readonly<MooringCommand> = { anchor: false, interact: false };

export type HazardEvent =
  | { kind: 'grounded'; speedKn: number; damage: number; hard: boolean }
  | { kind: 'refloated' }
  | { kind: 'struck'; what: 'rock' | 'pier'; speedKn: number; damage: number }
  | { kind: 'knockdown'; riggingDamage: number; hullDamage: number }
  | { kind: 'foundering' }
  | { kind: 'anchorDropped' }
  | { kind: 'anchorWeighed' }
  | { kind: 'anchorDragging'; dragging: boolean }
  | { kind: 'anchorRefused'; reason: 'tooDeep' | 'moored' }
  | { kind: 'docked'; berthId: string }
  | { kind: 'castOff'; berthId: string }
  | { kind: 'dockRefused'; reason: 'noBerth' | 'tooFast' | 'anchored' | 'aground' };

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

function approach(value: number, target: number, maxStep: number): number {
  if (Math.abs(target - value) <= maxStep) return target;
  return value + Math.sign(target - value) * maxStep;
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

function damageHull(h: HazardState, amount: number, events: HazardEvent[]): void {
  h.hull = Math.max(0, h.hull - amount);
  if (h.hull === 0 && !h.foundering) {
    h.foundering = true;
    events.push({ kind: 'foundering' });
  }
}

function damageRigging(h: HazardState, amount: number): void {
  h.rigging = Math.max(0, h.rigging - amount);
}

/** An uncontrolled jibe (the controller's `jibe` event) tears rigging (plan 02 §4). */
export function applyJibe(h: HazardState, c: HazardClass, uncontrolled: boolean): void {
  if (uncontrolled) damageRigging(h, c.rules.jibeDamage);
}

/**
 * What damage does to handling (plan 02 §6.1), for the controller's next step: a
 * leaking hull is slower and sits deeper, torn rigging is slower and slower to work.
 */
function applyCondition(s: SailingState, h: HazardState, c: HazardClass): void {
  const r = c.rules;
  const leak = 1 - clamp01(h.hull / c.hullHP);
  const rig = clamp01(h.rigging / c.riggingHP);
  // Water in the hold and cargo in it both slow her (plan 02 §3, §6.1; plan 05 §3).
  s.loadFactor = (1 - r.leakSpeedLoss * leak) * (1 - r.cargoSpeedLoss * clamp01(h.cargo01));
  s.riggingCondition = r.riggingConditionMin + (1 - r.riggingConditionMin) * rig;
  s.sailChangeScale = 1 + r.riggingSailSlowdown * (1 - rig);
  h.draft =
    c.draftEmptyM + (c.draftFullM - c.draftEmptyM) * clamp01(h.cargo01) + r.leakSinkM * leak;
}

// Keel probes along the centerline: bow, midships, stern (scratch, reused every tick).
const PROBES = [0.45, 0, -0.45] as const;
/** Clearance each probe needs from a pier: the bow is fine, midships is the full beam. */
const PIER_CLEARANCE = [0.3, 1, 0.7] as const;
const px = new Float64Array(3);
const pz = new Float64Array(3);

function placeProbes(s: SailingState, c: HazardClass): void {
  const fx = Math.sin(s.heading);
  const fz = -Math.cos(s.heading);
  for (let i = 0; i < 3; i++) {
    const k = (PROBES[i] as number) * c.lengthM;
    px[i] = s.x + fx * k;
    pz[i] = s.z + fz * k;
  }
}

/** Gradient of depth (it points toward deeper water) and its size, over ±2 m. */
const grad = { x: 0, z: 0, slope: 0 };
function depthGradient(t: HazardTerrain, x: number, z: number): typeof grad {
  const e = 2;
  grad.x = (t.depthAt(x + e, z) - t.depthAt(x - e, z)) / (2 * e);
  grad.z = (t.depthAt(x, z + e) - t.depthAt(x, z - e)) / (2 * e);
  grad.slope = Math.hypot(grad.x, grad.z);
  return grad;
}

/**
 * Takes an impact on a surface whose normal (n) points out of it: removes the speed into
 * the surface, with a little bounce, and returns the impact speed in game m/s.
 */
function impact(s: SailingState, nx: number, nz: number, bounce: number): number {
  const dx = Math.sin(s.course);
  const dz = -Math.cos(s.course);
  const into = -(dx * nx + dz * nz) * s.speed;
  if (into <= 0 || s.speed === 0) return 0;
  s.speed -= ((1 + bounce) * into * into) / s.speed;
  return into;
}

/** Signed distance from a pier deck's footprint (positive outside) and its outward normal. */
const pierHit = { d: 0, nx: 0, nz: 0 };
function pierDistance(dock: Dock, x: number, z: number): typeof pierHit {
  const f = bearingVector(dock.bearing);
  const rx = -f.z;
  const rz = f.x;
  const dx = x - dock.root.x;
  const dz = z - dock.root.z;
  const a = dx * f.x + dz * f.z - dock.lengthM / 2;
  const b = dx * rx + dz * rz;
  const qa = Math.abs(a) - dock.lengthM / 2;
  const qb = Math.abs(b) - dock.widthM / 2;
  let na: number;
  let nb: number;
  if (qa > 0 || qb > 0) {
    const oa = Math.max(qa, 0);
    const ob = Math.max(qb, 0);
    pierHit.d = Math.hypot(oa, ob);
    na = oa * Math.sign(a);
    nb = ob * Math.sign(b);
  } else {
    pierHit.d = Math.max(qa, qb);
    na = qa > qb ? Math.sign(a) : 0;
    nb = qa > qb ? 0 : Math.sign(b) || 1;
  }
  const len = Math.hypot(na, nb) || 1;
  pierHit.nx = (f.x * na + rx * nb) / len;
  pierHit.nz = (f.z * na + rz * nb) / len;
  return pierHit;
}

/** Piers are hard: push the ship clear and take the knock (plan 02 §6.2). */
function collidePiers(
  s: SailingState,
  h: HazardState,
  c: HazardClass,
  env: HazardEnv,
  events: HazardEvent[],
): void {
  for (const dock of env.docks) {
    // Cheap reject: the ship is nowhere near this pier.
    const reach = dock.lengthM + c.lengthM;
    if (Math.abs(s.x - dock.root.x) > reach || Math.abs(s.z - dock.root.z) > reach) continue;
    placeProbes(s, c);
    let worst = 0;
    let nx = 0;
    let nz = 0;
    for (let i = 0; i < 3; i++) {
      const hit = pierDistance(dock, px[i] as number, pz[i] as number);
      const pen = (PIER_CLEARANCE[i] as number) * c.halfBeamM - hit.d;
      if (pen > worst) {
        worst = pen;
        nx = hit.nx;
        nz = hit.nz;
      }
    }
    if (worst <= 0) continue;
    s.x += nx * worst;
    s.z += nz * worst;
    const into = impact(s, nx, nz, c.rules.strikeBounce);
    const kn = msToKnots(into);
    if (kn > c.rules.strikeMinKn) {
      const damage = c.rules.pierDamagePerKn * kn;
      damageHull(h, damage, events);
      events.push({ kind: 'struck', what: 'pier', speedKn: kn, damage });
    }
  }
}

/**
 * The keel touching bottom (plan 02 §6.2). On a steep bottom (rock, a bluff shore) it's a
 * hit: pushed back toward deep water with heavy damage. On a gentle one (a shoal, a
 * beach) the ship runs aground and sticks, with damage if it was going fast.
 */
function touchBottom(
  s: SailingState,
  h: HazardState,
  c: HazardClass,
  t: HazardTerrain,
  prev: Pose,
  events: HazardEvent[],
): void {
  const r = c.rules;
  placeProbes(s, c);
  let shallowest = 0;
  let depth = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const d = t.depthAt(px[i] as number, pz[i] as number);
    if (d < depth) {
      depth = d;
      shallowest = i;
    }
  }
  if (depth >= h.draft) return;

  const g = depthGradient(t, px[shallowest] as number, pz[shallowest] as number);
  if (g.slope >= r.rockSlope) {
    const nx = g.x / g.slope;
    const nz = g.z / g.slope;
    const push = Math.min((h.draft - depth) / g.slope + 0.3, 4);
    s.x += nx * push;
    s.z += nz * push;
    const kn = msToKnots(impact(s, nx, nz, r.strikeBounce));
    if (kn > r.strikeMinKn) {
      const damage = r.rockDamagePerKn * kn;
      damageHull(h, damage, events);
      events.push({ kind: 'struck', what: 'rock', speedKn: kn, damage });
    }
    return;
  }
  if (g.slope === 0 && depth === 0) {
    // Wholly on land (a tick that skipped the shore): back where it was, as a hit.
    s.x = prev.x;
    s.z = prev.z;
  }
  const kn = Math.abs(msToKnots(s.speed));
  const hard = kn > r.hardGroundKn;
  const damage = hard ? r.groundDamagePerKn * kn : r.groundMinorDamage;
  damageHull(h, damage, events);
  s.speed = 0;
  h.aground = true;
  events.push({ kind: 'grounded', speedKn: kn, damage, hard });
}

/** Least depth under the three keel probes. */
function keelDepth(s: SailingState, c: HazardClass, t: HazardTerrain | undefined): number {
  if (!t) return Number.POSITIVE_INFINITY;
  placeProbes(s, c);
  let depth = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) depth = Math.min(depth, t.depthAt(px[i] as number, pz[i] as number));
  return depth;
}

/**
 * Stuck fast: the ship holds where it grounded. Holding X kedges it off (plan 02 §6.2,
 * simplified: the anchor is carried out to deep water and hauled on), and it floats free
 * once every probe has water under the keel.
 */
function stayAground(
  s: SailingState,
  h: HazardState,
  c: HazardClass,
  t: HazardTerrain | undefined,
  prev: Pose,
  scale: SceneScale,
  dt: number,
  events: HazardEvent[],
): void {
  s.x = prev.x;
  s.z = prev.z;
  s.heading = prev.heading;
  s.speed = 0;
  if (h.kedging && t) {
    const g = depthGradient(t, s.x, s.z);
    let dx = -Math.sin(s.heading);
    let dz = Math.cos(s.heading);
    if (g.slope > 1e-3) {
      dx = g.x / g.slope;
      dz = g.z / g.slope;
    }
    const step = sceneSpeed(knotsToMs(c.rules.kedgeKn), scale.rate, scale.compression) * dt;
    s.x += dx * step;
    s.z += dz * step;
  }
  if (keelDepth(s, c, t) >= h.draft + c.rules.refloatMarginM) {
    h.aground = false;
    events.push({ kind: 'refloated' });
  }
}

function toggleAnchor(
  s: SailingState,
  h: HazardState,
  c: HazardClass,
  env: HazardEnv,
  events: HazardEvent[],
): void {
  if (h.mooring !== 'free') {
    events.push({ kind: 'anchorRefused', reason: 'moored' });
    return;
  }
  if (h.anchor === 'up') {
    const fx = Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    const ax = s.x + fx * c.lengthM * 0.45;
    const az = s.z + fz * c.lengthM * 0.45;
    const depth = env.terrain?.depthAt(ax, az) ?? Number.POSITIVE_INFINITY;
    if (depth > c.anchorRodeM) {
      events.push({ kind: 'anchorRefused', reason: 'tooDeep' });
      return;
    }
    h.anchor = 'down';
    h.anchorX = ax;
    h.anchorZ = az;
    events.push({ kind: 'anchorDropped' });
  } else if (h.anchor === 'down') {
    h.anchor = 'weighing';
    h.weighS = c.rules.anchorWeighS;
  }
}

/**
 * At anchor (plan 02 §7): the ship brings up over a few seconds, swings head to wind and
 * lies downwind of the anchor. A load over the holding drags the anchor downwind, which
 * can put the ship aground; a lee or shallow, well-scoped ground holds better.
 */
function rideAnchor(
  s: SailingState,
  h: HazardState,
  c: HazardClass,
  env: HazardEnv,
  wind: SailingWind,
  scale: SceneScale,
  dt: number,
  events: HazardEvent[],
): void {
  const r = c.rules;
  const depth = env.terrain?.depthAt(h.anchorX, h.anchorZ) ?? c.anchorRodeM;
  const scope = clamp01(depth / c.anchorRodeM);
  h.holdingKn = r.anchorHoldKn * (1 - (1 - r.anchorDeepHold) * scope);
  h.anchorLoadKn = s.windKn * (1 + r.anchorSailWindage * s.sailFactor);
  const excess = (h.anchorLoadKn - h.holdingKn) / h.holdingKn;
  const dragging = excess > 0;
  if (dragging !== h.dragging) {
    h.dragging = dragging;
    events.push({ kind: 'anchorDragging', dragging });
  }
  const down = bearingVector(wind.fromRad + Math.PI);
  if (dragging) {
    const v = sceneSpeed(
      knotsToMs(r.anchorDragKn * Math.min(excess, 1)),
      scale.rate,
      scale.compression,
    );
    h.anchorX += down.x * v * dt;
    h.anchorZ += down.z * v * dt;
  }
  if (!h.aground) {
    const k = 1 - Math.exp(-dt / r.anchorSwingTau);
    s.x += (h.anchorX + down.x * r.anchorSwingM - s.x) * k;
    s.z += (h.anchorZ + down.z * r.anchorSwingM - s.z) * k;
    s.speed *= Math.exp(-dt / r.anchorStopTau);
    const toWind = wrapAngle(wind.fromRad - s.heading);
    s.heading = wrapAngle(s.heading + approach(0, toWind, r.anchorSwingDegS * DEG * dt));
  }
  if (h.anchor === 'weighing') {
    h.weighS -= dt;
    if (h.weighS <= 0) {
      h.anchor = 'up';
      h.weighS = 0;
      if (h.dragging) events.push({ kind: 'anchorDragging', dragging: false });
      h.dragging = false;
      events.push({ kind: 'anchorWeighed' });
    }
  }
}

/** The berth whose (widened) zone holds the ship, nearest first. */
function berthAt(s: SailingState, c: HazardClass, env: HazardEnv): MooringBerth | undefined {
  let best: MooringBerth | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  const reach = c.rules.dockReachM;
  for (const b of env.berths) {
    const f = bearingVector(b.pose.heading);
    const dx = s.x - b.pose.x;
    const dz = s.z - b.pose.z;
    const along = dx * f.x + dz * f.z;
    const across = -dx * f.z + dz * f.x;
    if (Math.abs(along) > b.lengthM / 2 + reach || Math.abs(across) > b.halfWidthM + reach)
      continue;
    const d = Math.hypot(dx, dz);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function interact(
  s: SailingState,
  h: HazardState,
  c: HazardClass,
  env: HazardEnv,
  events: HazardEvent[],
): void {
  if (h.mooring === 'docked' && h.berthId) {
    h.mooring = 'castingOff';
    h.mooringS = c.rules.castOffS;
    s.speed = knotsToMs(c.rules.castOffKn);
    events.push({ kind: 'castOff', berthId: h.berthId });
    return;
  }
  if (h.mooring !== 'free') return;
  const refuse = (reason: 'noBerth' | 'tooFast' | 'anchored' | 'aground'): void => {
    events.push({ kind: 'dockRefused', reason });
  };
  if (h.aground) return refuse('aground');
  if (h.anchor !== 'up') return refuse('anchored');
  const berth = berthAt(s, c, env);
  if (!berth) return refuse('noBerth');
  if (Math.abs(msToKnots(s.speed)) > c.rules.dockMaxKn) return refuse('tooFast');
  h.mooring = 'docking';
  h.berthId = berth.id;
  h.mooringS = 0;
  h.from = { x: s.x, z: s.z, heading: s.heading };
  // The arcade assist hands the sails too (plan 02 §7).
  s.sailLevel = 0;
}

/** Docking, docked and casting off. Returns true while the berth owns the ship's pose. */
function moor(
  s: SailingState,
  h: HazardState,
  c: HazardClass,
  env: HazardEnv,
  dt: number,
  events: HazardEvent[],
): boolean {
  const berth = env.berths.find((b) => b.id === h.berthId);
  if (!berth) {
    h.mooring = 'free';
    return false;
  }
  if (h.mooring === 'castingOff') {
    const shove = (c.rules.castOffSideM / c.rules.castOffS) * dt;
    s.x += berth.awayX * shove;
    s.z += berth.awayZ * shove;
    h.mooringS -= dt;
    if (h.mooringS <= 0) {
      h.mooring = 'free';
      h.berthId = undefined;
    }
    return false;
  }
  let t = 1;
  if (h.mooring === 'docking') {
    h.mooringS += dt;
    t = smoothstep(clamp01(h.mooringS / c.rules.dockS));
    if (h.mooringS >= c.rules.dockS) {
      h.mooring = 'docked';
      events.push({ kind: 'docked', berthId: berth.id });
    }
  }
  const from = h.from;
  s.x = from.x + (berth.pose.x - from.x) * t;
  s.z = from.z + (berth.pose.z - from.z) * t;
  s.heading = wrapAngle(from.heading + wrapAngle(berth.pose.heading - from.heading) * t);
  s.speed = 0;
  return true;
}

/**
 * Overpressing (plan 02 §3.5): too much sail for the wind builds strain, strain past a
 * threshold tears the rigging, and in a gale at Half or Full a full strain knocks the
 * ship down (plan 02 §6.4). Luffing sails carry no load; running eases it a little.
 */
function strainAndKnockdown(
  s: SailingState,
  h: HazardState,
  c: HazardClass,
  dt: number,
  events: HazardEvent[],
): void {
  const r = c.rules;
  const lo = Math.min(Math.floor(s.sailSetting), 3);
  const hi = Math.min(lo + 1, 3);
  const t = s.sailSetting - lo;
  const safe = (r.safeWindKn[lo] as number) * (1 - t) + (r.safeWindKn[hi] as number) * t;
  const load =
    s.inIrons || h.mooring === 'docked'
      ? 0
      : s.windKn * (0.7 + 0.3 * Math.abs(Math.sin(s.windAngle)));
  h.overpress = clamp01((load - safe) / r.overpressSpanKn);
  const rate = h.overpress > h.strain ? 1 / r.strainRiseS : 1 / r.strainFallS;
  h.strain = approach(h.strain, h.overpress, rate * dt);
  if (h.strain > r.strainDamageAt) {
    damageRigging(
      h,
      r.strainDamagePerS * ((h.strain - r.strainDamageAt) / (1 - r.strainDamageAt)) * dt,
    );
  }

  h.knockdownCooldown = Math.max(0, h.knockdownCooldown - dt);
  if (
    h.knockdownCooldown === 0 &&
    s.windKn >= r.knockdownWindKn &&
    s.sailSetting >= r.knockdownMinSail &&
    h.strain >= r.knockdownStrain
  ) {
    const riggingDamage = r.knockdownRiggingShare * c.riggingHP;
    const hullDamage = r.knockdownHullShare * c.hullHP;
    damageRigging(h, riggingDamage);
    damageHull(h, hullDamage, events);
    s.speed *= r.knockdownSpeedKeep;
    h.strain = r.knockdownStrainAfter;
    h.knockdown = r.knockdownS;
    h.knockdownSide = s.windAngle >= 0 ? 1 : -1;
    h.knockdownCooldown = r.knockdownCooldownS;
    events.push({ kind: 'knockdown', riggingDamage, hullDamage });
  }

  if (h.knockdown > 0) {
    // A fast lurch over, then a slow recovery; it overrides the wind heel meanwhile.
    h.knockdown = Math.max(0, h.knockdown - dt);
    const u = 1 - h.knockdown / r.knockdownS;
    const env = u < 0.15 ? smoothstep(u / 0.15) : 1 - smoothstep((u - 0.15) / 0.85);
    s.heel += (h.knockdownSide * r.knockdownRollDeg * DEG - s.heel) * env;
  }
}

/**
 * Advances one tick, right after `stepSailing` moved the ship. `prev` is the pose before
 * that step (the transform snapshot), which a grounded ship is held at. Anything that
 * happened is pushed onto `events`.
 */
export function stepHazards(
  s: SailingState,
  h: HazardState,
  c: HazardClass,
  cmd: MooringCommand,
  env: HazardEnv,
  prev: Pose,
  wind: SailingWind,
  scale: SceneScale,
  dt: number,
  events: HazardEvent[] = [],
): HazardEvent[] {
  // Orders: X is a hold (or the kedge when aground); F docks and casts off.
  if (cmd.anchor) h.anchorHeldS += dt;
  else {
    h.anchorHeldS = 0;
    h.anchorLatched = false;
  }
  h.kedging = h.aground && cmd.anchor;
  // A hold that kedged the ship off doesn't go on to drop the anchor.
  if (h.kedging) h.anchorLatched = true;
  if (!h.aground && cmd.anchor && !h.anchorLatched && h.anchorHeldS >= c.rules.anchorHoldS) {
    h.anchorLatched = true;
    toggleAnchor(s, h, c, env, events);
  }
  if (cmd.interact) interact(s, h, c, env, events);

  const held = h.mooring !== 'free' && moor(s, h, c, env, dt, events);
  if (!held) {
    if (h.aground) stayAground(s, h, c, env.terrain, prev, scale, dt, events);
    if (h.anchor !== 'up') rideAnchor(s, h, c, env, wind, scale, dt, events);
    collidePiers(s, h, c, env, events);
    if (!h.aground && env.terrain) touchBottom(s, h, c, env.terrain, prev, events);
  }
  strainAndKnockdown(s, h, c, dt, events);
  applyCondition(s, h, c);

  h.depth = keelDepth(s, c, env.terrain);
  h.shallow = h.depth < c.rules.shallowWarnDrafts * h.draft;
  return events;
}
