import type { DamagePool, Mount } from '../../data/schemas/combat';
import type { ShipRecord } from '../../data/schemas/ships';
import type { GameContext } from '../modes/context';
import { hasPerk } from '../sim/character/backgrounds';
import type { ArenaLand } from '../sim/arena/land';
import { createHelm, steerShips, type SteeredShip, type Traffic } from '../sim/arena/steering';
import {
  chargesAvailable,
  inArc,
  layRound,
  mountFor,
  muzzlesLocal,
  reachM,
  reloadSeconds,
  spendCharges,
  type MountedWeapon,
} from '../sim/combat/armament';
import { elevationFor, leadSolution } from '../sim/combat/ballistics';
import {
  applyHit,
  blastDamage,
  createShipDamage,
  damagePool,
  DAMAGE_RULES,
  explodeBoiler,
  founder01,
  speedFactor,
  stepFoundering,
  type HitResult,
  type ShipDamage,
} from '../sim/combat/damage';
import {
  ammoDef,
  damageOf,
  firedAs,
  gameCombat,
  weaponDef,
  type CombatDefs,
} from '../sim/combat/defs';
import {
  hullShape,
  inEngineSpaces,
  toWorld,
  type HitLocation,
  type HullPose,
  type HullShape,
} from '../sim/combat/hull';
import { ShotField, type Shot, type ShotEnd, type ShotTarget } from '../sim/combat/shots';
import { damageRigging } from '../sim/sailing/hazards';
import { sailShipRecord, SHIP_RECORDS, serviceSpeedKn } from '../sim/sailing/ships';
import { crewFor } from '../sim/traffic/cargo';
import type { Entity } from './ecs';
import type { ShipHazards } from './hazards';

/**
 * The combat core in play (plan 07 §2, §4; Phase 6 piece A). Guns are fired here, from the
 * player's mounts or any ship's, and their shot flies in the sailing tick: each ball is
 * tested against every ship on the water, the player's too, and the sea. A hit takes
 * points off the pool it struck: an NPC's hull, rigging, crew or engine (her damage lives
 * on the entity), or the player's hull and rigging (her hazard state). Damage slows an NPC
 * through her helm, a wrecked engine stops her, and at hull 0 she founders and goes under.
 *
 * Aiming (piece B) and the AI's will (piece C) sit on top: they call `fire` and read the
 * damage. Every event the law, the log, the papers and the audio need is raised here.
 */

export const PLAYER_ID = 'ship.player';

/** Seconds between the guns of a crew's rippled broadside (plan 07 §3). */
export const RIPPLE_S = 0.22;

/** Why a gun didn't fire. */
export type FireRefusal =
  | 'unarmed'
  | 'outOfArc'
  | 'reloading'
  | 'noPowder'
  | 'outOfRange'
  | 'wrongAmmo'
  | 'noTarget'
  | 'sunk';

export type FireResult =
  | { ok: true; mount: Mount; rounds: number; bearing: number; elevation: number }
  | { ok: false; reason: FireRefusal };

export interface FireOrder {
  ammo: string;
  /** Which guns: the mount whose arc holds the bearing if left out. */
  mount?: Mount;
  /** Lay on a ship: lead her and find the elevation. */
  target?: string;
  /** Or a bearing (radians from north) and a range, meters, or an elevation (radians). */
  bearing?: number;
  rangeM?: number;
  elevation?: number;
  /** A crew ripples a broadside by default; false fires every gun at once. */
  ripple?: boolean;
}

export interface CombatDeps {
  ctx: GameContext;
  player: Entity;
  hazards: ShipHazards;
  /** The arena's ships and their helms, when one is in play. */
  arena():
    { ships: readonly { entity: Entity; steer: SteeredShip }[]; land: ArenaLand } | undefined;
  /** The zone's traffic on the water, and taking a hit ship off her timetable. */
  zoneShips(): Iterable<Entity>;
  hold(id: string): Entity | undefined;
  /** The zone's land for a held ship's helm; undefined off a zone. */
  zoneLand(): ArenaLand | undefined;
  /** Ships the law steers itself (the cutter, the tug): no other helm takes them. */
  isLawShip(e: Entity): boolean;
  /** The sea's height at a point (0 when flat). */
  seaLevel?(x: number, z: number): number;
  /** A ball falling in the sea, scene meters (the spray's column). */
  splash?(x: number, z: number): void;
  notice?(text: string): void;
  /**
   * How the player's ship's motion throws a mount's barrel off its sight now, radians of
   * elevation (piece B: the roll, so firing on the downroll is the skill). 0 if absent.
   */
  barrelTilt?(mount: Mount): number;
  /**
   * Hull points a shooter's rounds can't take the player's ship below (Phase 6 piece F,
   * §14.3 criterion 10: the cutter never sinks you unless you fired on her). 0 if absent.
   */
  playerHullFloor?(shooter: string): number;
  defs?: CombatDefs;
}

export interface CombatShipStatus {
  id: string;
  classId: string;
  hull: number;
  rigging: number;
  engine: number;
  crew: number;
  killed: number;
  wounded: number;
  speed01: number;
  foundering: boolean;
  sunk: boolean;
  boilerExploded: boolean;
}

export interface GameCombat {
  readonly defs: CombatDefs;
  /** One sailing tick, after the helms and the law, before the ships move. */
  step(dt: number): void;
  /** The player's guns fire. */
  fire(order: FireOrder): FireResult;
  /** Any ship's gun fires at a bearing and elevation (the cutter's bow gun, piece F). */
  fireFrom(
    shooter: Entity,
    weaponId: string,
    ammoId: string,
    bearing: number,
    elevation: number,
    mount?: Mount,
  ): FireResult;
  /** Where a mount's (first) gun stands now, world meters; undefined off the water. */
  muzzle(mount: Mount): { x: number; y: number; z: number } | undefined;
  /** Where any ship's gun at a mount stands now (the one `fireFrom` lets fly from). */
  muzzleOf(shooter: Entity, mount: Mount): { x: number; y: number; z: number } | undefined;
  /** The player's way over the ground, m/s: every shot she fires carries it. */
  playerVelocity(): { x: number; z: number };
  /** Whether the player's guns are crewed (a T2 or bigger) and laid with the Ex-Navy's eye. */
  crewed(): boolean;
  gunnery(): boolean;
  /** Guns of a rippled broadside still to go off (piece B). */
  volleysPending(): number;
  /** A ship's damage if she's been touched, without starting it. */
  peek(id: string): ShipDamage | undefined;
  /** Seconds until each of the player's mounts is loaded again (0 is ready). */
  reloads(): Partial<Record<Mount, number>>;
  /** Charges ready to burn: loose ones and kegs in the hold. */
  charges(): number;
  /** A ship's damage, starting it if she hasn't been touched. */
  damageOf(id: string): ShipDamage | undefined;
  /** Points straight off a ship's pool (the dev hook and tests). */
  damage(id: string, pool: DamagePool, points: number): HitResult | undefined;
  /** Her boiler goes now (the dev hook). */
  explode(id: string): boolean;
  ships(): CombatShipStatus[];
  shots(): readonly Shot[];
  /** A new zone or arena: other ships, no shot in the air. */
  reset(): void;
}

interface Held {
  entity: Entity;
  steer: SteeredShip;
}

const recordOf = (classId: string): ShipRecord | undefined =>
  SHIP_RECORDS.find((r) => r.id === classId);

export function attachCombat(deps: CombatDeps): GameCombat {
  const { ctx, player, hazards } = deps;
  const defs = deps.defs ?? gameCombat();
  const field = new ShotField();
  const reload = new Map<string, Partial<Record<Mount, number>>>();
  const shapes = new Map<string, HullShape>();
  /** Each damaged NPC's service speed before it was hurt. */
  const baseKn = new Map<Entity, number>();
  /** Zone ships taken off their timetables once hit. */
  const held = new Map<string, Held>();
  const seaLevel = deps.seaLevel ?? (() => 0);
  /** Who last put a shot into each NPC: the one she's sunk by. */
  const lastShooter = new Map<Entity, string>();

  const shapeOf = (classId: string): HullShape | undefined => {
    let s = shapes.get(classId);
    if (!s) {
      const r = recordOf(classId);
      if (!r) return undefined;
      s = hullShape(r);
      shapes.set(classId, s);
    }
    return s;
  };

  const playerClass = (): string => ctx.state.player.ship?.classId ?? 'ship.t1_schooner';

  const npcShips = (): Entity[] => {
    const arena = deps.arena();
    const out = arena ? arena.ships.map((s) => s.entity) : [...deps.zoneShips()];
    for (const h of held.values()) if (!out.includes(h.entity)) out.push(h.entity);
    return out.filter((e) => e.npc && e.transform && !e.damage?.sunk);
  };

  const findShip = (id: string): Entity | undefined =>
    id === PLAYER_ID ? player : npcShips().find((e) => e.id === id);

  const poseOf = (e: Entity): HullPose | undefined => {
    const t = e.transform;
    if (!t) return undefined;
    return {
      x: t.position.x,
      y: t.position.y - (e.npc?.sinkM ?? 0),
      z: t.position.z,
      heading: t.heading,
    };
  };

  const classOf = (e: Entity): string | undefined =>
    e === player ? playerClass() : e.npc?.classId;

  /** Her damage, started the first time she's touched. */
  const damageState = (e: Entity): ShipDamage | undefined => {
    if (e === player || !e.npc) return undefined;
    if (!e.damage) {
      const r = recordOf(e.npc.classId);
      if (!r) return undefined;
      e.damage = createShipDamage(r, crewFor(r.id));
    }
    return e.damage;
  };

  /** A zone ship that's been hurt comes off her timetable and is steered here. */
  const takeOffTimetable = (e: Entity): void => {
    if (deps.arena() || !e.id || held.has(e.id) || deps.isLawShip(e)) return;
    const taken = deps.hold(e.id);
    const t = taken?.transform;
    const r = taken?.npc && recordOf(taken.npc.classId);
    if (!taken || !t || !r) return;
    // She holds the course and speed she had: a ship lying to stays lying to.
    const kn = Math.min(taken.npc?.speedKn ?? 0, serviceSpeedKn(r));
    const helm = createHelm(r, t.heading, kn);
    held.set(e.id, {
      entity: taken,
      steer: {
        x: t.position.x,
        z: t.position.z,
        vx: taken.velocity?.x ?? 0,
        vz: taken.velocity?.z ?? 0,
        heading: t.heading,
        lengthM: r.lengthM * r.displayScale,
        helm,
      },
    });
  };

  const emitHit = (
    shipId: string,
    by: string,
    weapon: string,
    ammo: string,
    location: HitLocation,
    at: { x: number; y: number; z: number },
    r: HitResult,
  ): void => {
    for (const [pool, damage] of Object.entries(r.pools) as [DamagePool, number][]) {
      if (pool === 'crew') continue;
      ctx.events.emit('ShipHit', { shipId, by, weapon, ammo, location, pool, damage, at });
    }
    const shotKilled = r.killed - (r.boiler?.killed ?? 0);
    if (shotKilled + r.wounded > 0) {
      ctx.events.emit('CrewCasualties', {
        shipId,
        by,
        killed: shotKilled,
        wounded: r.wounded,
        cause: 'shot',
        lethal: shotKilled > 0,
      });
    }
  };

  const boilerWent = (e: Entity, by: string, killed: number): void => {
    const t = e.transform;
    if (!t || !e.id) return;
    const at = { x: t.position.x, z: t.position.z };
    ctx.events.emit('BoilerExploded', { shipId: e.id, by, killed, at });
    if (killed > 0) {
      ctx.events.emit('CrewCasualties', {
        shipId: e.id,
        by,
        killed,
        wounded: 0,
        cause: 'boiler',
        lethal: true,
      });
    }
    deps.notice?.(`Her boiler goes up: ${killed} killed aboard.`);
    // The blast reaches the ships close by, and the player's hull (plan 07 §9).
    for (const other of [player, ...npcShips()]) {
      if (other === e || !other.transform) continue;
      const d = Math.hypot(other.transform.position.x - at.x, other.transform.position.z - at.z);
      const pts = blastDamage(d);
      if (pts <= 0) continue;
      if (other === player) {
        hazards.state.hull = Math.max(0, hazards.state.hull - pts);
        ctx.events.emit('ShipHit', {
          shipId: PLAYER_ID,
          by: e.id,
          weapon: 'boiler',
          ammo: 'boiler',
          location: 'hull',
          pool: 'hull',
          damage: pts,
          at: { ...at, y: 0 },
        });
      } else {
        const ds = damageState(other);
        if (!ds || !other.id) continue;
        const r = damagePool(ds, 'hull', pts, ctx.rng);
        emitHit(other.id, e.id, 'boiler', 'boiler', 'hull', { ...at, y: 0 }, r);
        afterDamage(other, e.id, r);
      }
    }
  };

  const afterDamage = (e: Entity, by: string, r: HitResult): void => {
    lastShooter.set(e, by);
    takeOffTimetable(e);
    if (r.foundering && e.id) {
      ctx.events.emit('ShipFoundering', { shipId: e.id });
      deps.notice?.('She is holed and settling: she will founder.');
    }
    if (r.boiler) boilerWent(e, by, r.boiler.killed);
  };

  /** A ball struck the player's ship: her hull or her rigging (no crew to hit on a T1). */
  const hitPlayer = (end: Extract<ShotEnd, { kind: 'hit' }>): void => {
    const dmg = damageOf(defs, end.shot.weapon, end.shot.ammo);
    const { shot } = end;
    if (end.location === 'rigging') {
      const before = hazards.state.rigging;
      damageRigging(hazards.state, dmg.rigging);
      const done = before - hazards.state.rigging;
      ctx.events.emit('ShipHit', {
        shipId: PLAYER_ID,
        by: shot.shooter,
        weapon: shot.weapon,
        ammo: shot.ammo,
        location: end.location,
        pool: 'rigging',
        damage: done,
        at: end.at,
      });
      return;
    }
    const mul = end.location === 'waterline' ? DAMAGE_RULES.waterlineMul : 1;
    const floor = deps.playerHullFloor?.(shot.shooter) ?? 0;
    const pts = Math.max(0, Math.min(hazards.state.hull - floor, dmg.hull * mul));
    hazards.state.hull -= pts;
    // Holed to nothing, she founders (Phase 6 piece F: the abandon-ship clock starts).
    if (hazards.state.hull <= 0) {
      hazards.state.hull = 0;
      hazards.state.foundering = true;
    }
    ctx.events.emit('ShipHit', {
      shipId: PLAYER_ID,
      by: shot.shooter,
      weapon: shot.weapon,
      ammo: shot.ammo,
      location: end.location === 'engine' ? 'hull' : end.location,
      pool: 'hull',
      damage: pts,
      at: end.at,
    });
  };

  const land = (end: ShotEnd): void => {
    const { shot } = end;
    if (end.kind === 'water') {
      deps.splash?.(end.at.x, end.at.z);
      ctx.events.emit('ShotLanded', { by: shot.shooter, ammo: shot.ammo, on: 'water', at: end.at });
      return;
    }
    ctx.events.emit('ShotLanded', {
      by: shot.shooter,
      ammo: shot.ammo,
      on: 'ship',
      shipId: end.target,
      at: end.at,
    });
    if (end.target === PLAYER_ID) {
      hitPlayer(end);
      return;
    }
    const e = findShip(end.target);
    const d = e && damageState(e);
    const shape = e && shapeOf(classOf(e) ?? '');
    if (!e || !d || !shape) return;
    const r = applyHit(
      d,
      end.location,
      damageOf(defs, shot.weapon, shot.ammo),
      firedAs(defs, shot.ammo),
      ctx.rng,
      inEngineSpaces(end.local, shape),
    );
    emitHit(end.target, shot.shooter, shot.weapon, shot.ammo, end.location, end.at, r);
    afterDamage(e, shot.shooter, r);
  };

  const targets = (): ShotTarget[] => {
    const out: ShotTarget[] = [];
    for (const e of [player, ...npcShips()]) {
      const cls = classOf(e);
      const shape = cls && shapeOf(cls);
      const pose = poseOf(e);
      const id = e === player ? PLAYER_ID : e.id;
      if (shape && pose && id) out.push({ id, shape, pose });
    }
    return out;
  };

  /** Speeds, listing and sinking for every damaged NPC. */
  const stepDamaged = (dt: number): void => {
    const arena = deps.arena();
    const helms = new Map<Entity, SteeredShip>();
    for (const s of arena?.ships ?? []) helms.set(s.entity, s.steer);
    for (const h of held.values()) helms.set(h.entity, h.steer);
    for (const e of npcShips()) {
      const d = e.damage;
      const npc = e.npc;
      if (!d || !npc) continue;
      const steer = helms.get(e);
      if (steer) {
        if (!baseKn.has(e)) baseKn.set(e, steer.helm.serviceKn);
        steer.helm.serviceKn = (baseKn.get(e) ?? 0) * speedFactor(d);
      }
      if (d.founderingS === undefined) continue;
      const f = founder01(d);
      npc.listRad = Math.max(npc.listRad ?? 0, DAMAGE_RULES.founderListRad * f);
      const shape = shapeOf(npc.classId);
      npc.sinkM = (shape ? shape.freeboardM + shape.deckM : 4) * f * f;
      if (stepFoundering(d, dt)) sink(e);
    }
  };

  const sink = (e: Entity): void => {
    const d = e.damage;
    const t = e.transform;
    if (!d || !t || !e.id) return;
    ctx.events.emit('ShipSunk', {
      shipId: e.id,
      classId: d.classId,
      by: lastShooter.get(e) ?? PLAYER_ID,
      crewAboard: d.crew,
      at: { x: t.position.x, z: t.position.z },
    });
    deps.notice?.(`${recordOf(d.classId)?.name ?? 'She'} goes under.`);
    held.delete(e.id);
    baseKn.delete(e);
    ctx.world.remove(e);
  };

  /** The held zone ships keep their course at what way they have left. */
  const steerHeld = (dt: number): void => {
    if (deps.arena() || held.size === 0) return;
    const zl = deps.zoneLand();
    const list = [...held.values()].filter((h) => h.entity.transform);
    for (const h of list) {
      const t = h.entity.transform;
      if (!t) continue;
      h.steer.x = t.position.x;
      h.steer.z = t.position.z;
      h.steer.heading = t.heading;
    }
    const tp = player.transform;
    const prev = player.previousTransform ?? tp;
    const traffic: Traffic | undefined =
      tp && prev
        ? {
            x: tp.position.x,
            z: tp.position.z,
            vx: (tp.position.x - prev.position.x) / Math.max(dt, 1e-6),
            vz: (tp.position.z - prev.position.z) / Math.max(dt, 1e-6),
            lengthM: 30,
          }
        : undefined;
    steerShips(
      list.map((h) => h.steer),
      traffic,
      zl ?? { halfM: Infinity, allWater: true, allDeep: true, isLand: () => false },
      dt,
    );
    for (const h of list) {
      const e = h.entity;
      if (e.transform) e.transform.heading = h.steer.heading;
      if (e.velocity) {
        e.velocity.x = h.steer.vx;
        e.velocity.z = h.steer.vz;
      }
      if (e.npc) e.npc.speedKn = h.steer.helm.speedKn;
    }
  };

  const shipVelocity = (e: Entity): { x: number; z: number } => {
    const t = e.transform;
    const prev = e.previousTransform;
    if (e === player && t && prev && lastDt > 0) {
      return {
        x: (t.position.x - prev.position.x) / lastDt,
        z: (t.position.z - prev.position.z) / lastDt,
      };
    }
    return { x: e.velocity?.x ?? 0, z: e.velocity?.z ?? 0 };
  };
  let lastDt = 0;

  const gunnery = (): boolean => hasPerk(ctx.state.player.captain, 'perk.gunnery');
  const crewed = (): boolean => {
    try {
      return (sailShipRecord(playerClass()).tier ?? 1) >= 2;
    } catch {
      return false;
    }
  };

  /**
   * Fires guns `from`… of the `guns` on one mount of `shooter`; the checks are done. Each
   * is laid at the bearing and the sight's elevation plus her barrel's tilt this moment.
   */
  const loose = (
    shooter: Entity,
    shooterId: string,
    guns: readonly MountedWeapon[],
    from: number,
    count: number,
    ammo: string,
    bearing: number,
    elevation: number,
    gunnerySkill: boolean,
  ): number => {
    const cls = classOf(shooter);
    const shape = cls && shapeOf(cls);
    const pose = poseOf(shooter);
    const first = guns[from];
    if (!shape || !pose || !first) return 0;
    const muzzles = muzzlesLocal(shape, first.mount, guns.length);
    const tilt = shooter === player ? (deps.barrelTilt?.(first.mount) ?? 0) : 0;
    const vel = shipVelocity(shooter);
    let fired = 0;
    for (let i = from; i < Math.min(guns.length, from + count); i++) {
      const g = guns[i];
      if (!g) continue;
      const r = layRound(
        defs,
        g,
        muzzles[i] ?? muzzles[0] ?? { x: 0, y: 2, z: 0 },
        pose,
        vel,
        bearing,
        elevation + tilt,
        ammo,
        ctx.rng,
        gunnerySkill,
      );
      field.add({ shooter: shooterId, weapon: r.weapon, ammo: r.ammo, pos: r.pos, vel: r.vel });
      fired++;
    }
    const muzzle = toWorld(muzzles[from] ?? muzzles[0] ?? { x: 0, y: 2, z: 0 }, pose);
    ctx.events.emit('WeaponFired', {
      by: shooterId,
      weapon: first.weapon,
      ammo,
      mount: first.mount,
      rounds: fired,
      warning: ammoDef(defs, ammo).warning,
      at: { x: muzzle.x, z: muzzle.z },
      y: muzzle.y,
      bearing,
    });
    return fired;
  };

  /** A crew's broadside goes off gun by gun (§3: a slight ripple), each on its own roll. */
  interface Volley {
    guns: readonly MountedWeapon[];
    next: number;
    ammo: string;
    bearing: number;
    elevation: number;
    gunnery: boolean;
    waitS: number;
  }
  const volleys: Volley[] = [];
  const stepVolleys = (dt: number): void => {
    for (let i = volleys.length - 1; i >= 0; i--) {
      const v = volleys[i];
      if (!v) continue;
      v.waitS -= dt;
      while (v.waitS <= 0 && v.next < v.guns.length) {
        loose(player, PLAYER_ID, v.guns, v.next, 1, v.ammo, v.bearing, v.elevation, v.gunnery);
        v.next++;
        v.waitS += RIPPLE_S;
      }
      if (v.next >= v.guns.length) volleys.splice(i, 1);
    }
  };

  const timers = (id: string): Partial<Record<Mount, number>> => {
    let t = reload.get(id);
    if (!t) {
      t = {};
      reload.set(id, t);
    }
    return t;
  };

  const relative = (heading: number, bearing: number): number =>
    Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading));

  return {
    defs,
    step(dt) {
      if (dt <= 0) return;
      lastDt = dt;
      for (const t of reload.values()) {
        for (const m of Object.keys(t) as Mount[]) t[m] = Math.max(0, (t[m] ?? 0) - dt);
      }
      steerHeld(dt);
      stepVolleys(dt);
      for (const end of field.step(dt, targets(), seaLevel)) land(end);
      stepDamaged(dt);
    },

    fire(order) {
      const weapons = ctx.state.player.ship?.weapons ?? [];
      const t = player.transform;
      const pose = poseOf(player);
      if (!t || !pose) return { ok: false, reason: 'unarmed' };
      const shape = shapeOf(playerClass());
      if (!shape) return { ok: false, reason: 'unarmed' };

      // The bearing: on a target (led), or as given.
      let bearing = order.bearing;
      let elevation = order.elevation;
      let rangeM = order.rangeM;
      let target: Entity | undefined;
      if (order.target !== undefined) {
        target = findShip(order.target);
        if (!target?.transform) return { ok: false, reason: 'noTarget' };
        const tp = target.transform.position;
        bearing = Math.atan2(tp.x - pose.x, -(tp.z - pose.z));
      }
      if (bearing === undefined) return { ok: false, reason: 'noTarget' };
      // Only the guns that fire this ammo.
      const loaded = weapons.filter((m) => weaponDef(defs, m.weapon).ammo.includes(order.ammo));
      if (loaded.length === 0) {
        return { ok: false, reason: weapons.length === 0 ? 'unarmed' : 'wrongAmmo' };
      }
      const mount = order.mount ?? mountFor(defs, loaded, relative(t.heading, bearing));
      const guns = loaded.filter((w) => w.mount === mount);
      const first = guns[0];
      if (!mount || !first) return { ok: false, reason: 'outOfArc' };
      const w = weaponDef(defs, first.weapon);
      if ((timers(PLAYER_ID)[mount] ?? 0) > 0) return { ok: false, reason: 'reloading' };

      const muzzle = toWorld(muzzlesLocal(shape, mount, 1)[0] ?? { x: 0, y: 2, z: 0 }, pose);
      const reach = reachM(defs, first.weapon, order.ammo);
      if (target?.transform) {
        const tp = target.transform.position;
        // Her waterline, not the mean sea: a ship on a swell sits above or below it.
        const waterline = tp.y - (target.npc?.sinkM ?? 0);
        const sol = leadSolution(
          { x: muzzle.x, y: muzzle.y - waterline, z: muzzle.z },
          shipVelocity(player),
          { x: tp.x, z: tp.z, vx: target.velocity?.x ?? 0, vz: target.velocity?.z ?? 0 },
          w.muzzleMs,
        );
        if (!sol) return { ok: false, reason: 'outOfRange' };
        bearing = sol.bearing;
        // Aim at her rail rather than her waterline. The barrel is already off its sight
        // by the sea's pitch and roll; lay the sight back by that, so the round leaves on
        // this arc. Aim mode passes its own elevation, and the ring there shows the tilt.
        const ts = shapeOf(classOf(target) ?? '');
        rangeM = Math.hypot(tp.x - muzzle.x, tp.z - muzzle.z);
        elevation =
          sol.elevation +
          (ts ? Math.atan2(ts.freeboardM * 0.7, Math.max(rangeM, 1)) : 0) -
          (deps.barrelTilt?.(mount) ?? 0);
      }
      if (!inArc(w, mount, relative(t.heading, bearing))) return { ok: false, reason: 'outOfArc' };
      if (elevation === undefined) {
        const r = rangeM ?? reach;
        if (r > reach) return { ok: false, reason: 'outOfRange' };
        elevation = elevationFor(r, w.muzzleMs, muzzle.y);
        if (elevation === undefined) return { ok: false, reason: 'outOfRange' };
      } else if (rangeM !== undefined && rangeM > reach) {
        return { ok: false, reason: 'outOfRange' };
      }
      const charges = guns.reduce((n, g) => n + weaponDef(defs, g.weapon).charges, 0);
      const ammoState = (ctx.state.player.ammo ??= { charges: 0 });
      if (!spendCharges(defs, ctx.state.player.cargo, ammoState, charges)) {
        return { ok: false, reason: 'noPowder' };
      }
      const skill = gunnery();
      const ripple = crewed() && guns.length > 1 && order.ripple !== false;
      loose(
        player,
        PLAYER_ID,
        guns,
        0,
        ripple ? 1 : guns.length,
        order.ammo,
        bearing,
        elevation,
        skill,
      );
      if (ripple) {
        volleys.push({
          guns,
          next: 1,
          ammo: order.ammo,
          bearing,
          elevation,
          gunnery: skill,
          waitS: RIPPLE_S,
        });
      }
      timers(PLAYER_ID)[mount] = reloadSeconds(w, crewed(), skill);
      return { ok: true, mount, rounds: guns.length, bearing, elevation };
    },

    fireFrom(shooter, weaponId, ammoId, bearing, elevation, mount = 'bow') {
      const id = shooter === player ? PLAYER_ID : shooter.id;
      if (!id) return { ok: false, reason: 'noTarget' };
      if (shooter.damage?.sunk) return { ok: false, reason: 'sunk' };
      const w = defs.weapons.get(weaponId);
      if (!w) return { ok: false, reason: 'unarmed' };
      if (!w.ammo.includes(ammoId)) return { ok: false, reason: 'wrongAmmo' };
      if ((timers(id)[mount] ?? 0) > 0) return { ok: false, reason: 'reloading' };
      const rounds = loose(
        shooter,
        id,
        [{ weapon: weaponId, mount }],
        0,
        1,
        ammoId,
        bearing,
        elevation,
        false,
      );
      timers(id)[mount] = w.reloadCrewedS;
      return { ok: true, mount, rounds, bearing, elevation };
    },

    muzzle(mount) {
      const shape = shapeOf(playerClass());
      const pose = poseOf(player);
      if (!shape || !pose) return undefined;
      const guns = (ctx.state.player.ship?.weapons ?? []).filter((w) => w.mount === mount).length;
      const local = muzzlesLocal(shape, mount, Math.max(1, guns));
      // A broadside's guns spread along her side: lay from the middle of them.
      const mid = local.reduce(
        (a, p) => ({
          x: a.x + p.x / local.length,
          y: a.y + p.y / local.length,
          z: a.z + p.z / local.length,
        }),
        { x: 0, y: 0, z: 0 },
      );
      return toWorld(mid, pose);
    },

    muzzleOf(shooter, mount) {
      const cls = classOf(shooter);
      const shape = cls && shapeOf(cls);
      const pose = poseOf(shooter);
      const local = shape && muzzlesLocal(shape, mount, 1)[0];
      return local && pose ? toWorld(local, pose) : undefined;
    },

    playerVelocity() {
      return shipVelocity(player);
    },

    crewed,
    gunnery,

    volleysPending() {
      return volleys.reduce((n, v) => n + v.guns.length - v.next, 0);
    },

    peek(id) {
      return findShip(id)?.damage;
    },

    reloads() {
      const out: Partial<Record<Mount, number>> = {};
      for (const w of ctx.state.player.ship?.weapons ?? []) {
        out[w.mount] = timers(PLAYER_ID)[w.mount] ?? 0;
      }
      return out;
    },

    charges() {
      return chargesAvailable(
        defs,
        ctx.state.player.cargo,
        ctx.state.player.ammo ?? { charges: 0 },
      );
    },

    damageOf(id) {
      const e = findShip(id);
      return e ? damageState(e) : undefined;
    },

    damage(id, pool, points) {
      const e = findShip(id);
      const d = e && damageState(e);
      if (!e || !d || !e.id) return undefined;
      const r = damagePool(d, pool, points, ctx.rng);
      const t = e.transform?.position ?? { x: 0, y: 0, z: 0 };
      emitHit(e.id, PLAYER_ID, 'dev', 'dev', pool === 'rigging' ? 'rigging' : 'hull', t, r);
      afterDamage(e, PLAYER_ID, r);
      return r;
    },

    explode(id) {
      const e = findShip(id);
      const d = e && damageState(e);
      if (!e || !d) return false;
      const r = explodeBoiler(d, ctx.rng);
      if (!r) return false;
      takeOffTimetable(e);
      boilerWent(e, PLAYER_ID, r.killed);
      if (r.foundering && e.id) ctx.events.emit('ShipFoundering', { shipId: e.id });
      return true;
    },

    ships() {
      return npcShips()
        .filter((e) => e.damage)
        .map((e) => {
          const d = e.damage as ShipDamage;
          return {
            id: e.id ?? '',
            classId: d.classId,
            hull: d.hull,
            rigging: d.rigging,
            engine: d.engine,
            crew: d.crew,
            killed: d.killed,
            wounded: d.wounded,
            speed01: speedFactor(d),
            foundering: d.founderingS !== undefined,
            sunk: d.sunk,
            boilerExploded: d.boilerExploded,
          };
        });
    },

    shots() {
      return field.live;
    },

    reset() {
      field.clear();
      volleys.length = 0;
      held.clear();
      baseKn.clear();
      lastShooter.clear();
      for (const id of [...reload.keys()]) if (id !== PLAYER_ID) reload.delete(id);
    },
  };
}
