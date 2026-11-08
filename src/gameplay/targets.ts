import type { GameContext } from '../modes/context';
import type { ShipRecord } from '../../data/schemas/ships';
import type { ArenaLand } from '../sim/arena/land';
import {
  arenaSceneSpeed,
  closestApproach,
  createHelm,
  steerShips,
  type NpcHelm,
  type SteeredShip,
  type Traffic,
} from '../sim/arena/steering';
import { CUTTER_CLASS_ID } from '../sim/law/observers';
import {
  createCaptain,
  disabled,
  noteCasualties,
  noteGunfire,
  noteHit,
  noteWarningShot,
  stepCaptain,
  type DamagePool,
  type MoralePart,
  type TargetCaptain,
  type TargetPhase,
  type TargetSituation,
} from '../sim/targets/morale';
import { hawser, hitsHawser, towConsort, type TowLine } from '../sim/targets/tow';
import { SHIP_RECORDS, serviceSpeedKn } from '../sim/sailing/ships';
import type { Entity } from './ecs';
import { isLawShip } from './law-at-sea';

/**
 * Targets at close quarters (plan 07 §5, §8; Phase 6 piece C). Every robbable ship on the
 * water with the player (the fish tug, the schooner-barge, the package steamer, the ore
 * freighter), in an arena or a zone, has a captain (`sim/targets/morale.ts`). Each sailing
 * tick this module tells him what he sees (the player's range and closing, Fame, the guns
 * he faces, help near, the dark, whether he can outrun her) and carries out what he
 * decides: hold on, run, ram, or strike his colors and heave to under a white flag.
 *
 * A consort rides her towline here: she goes where her steamer goes until a shot parts
 * the hawser, and then she drifts.
 *
 * Piece A's guns tell it what they did through `shotLanded`, `hit` and `casualties`
 * (until A lands, the dev hook does). In an arena her helm is the arena's; in a zone a
 * ship sails her timetable until her captain is alerted, and then she (with her consort)
 * is taken off it (`hold`) and steered here.
 */

/** A shot falling this close to a ship, or this far ahead of her bow, is across her bow. */
export const WARN_CLOSE_M = 120;
export const WARN_AHEAD_M = 220;
/** Gunfire is heard this far off: every captain in range is on the alert. */
export const GUNFIRE_HEARD_M = 2000;
/** Other ships this close are in view of her (witnesses by day). */
const IN_VIEW_M = 2000;
/** Below this wind, knots, a sailing ship can't run. */
const BECALMED_KN = 3;
/** A steamer towing a consort makes this share of her speed. */
const TOWING_SHARE = 0.75;

export interface TargetsDeps {
  ctx: GameContext;
  player: Entity;
  /** The player's speed, knots. */
  playerKn(): number;
  /** The arena in play: its ships' helms and its land. */
  arena():
    { ships: readonly { entity: Entity; steer: SteeredShip }[]; land: ArenaLand } | undefined;
  /** The zone's ships, and taking one off her timetable. */
  zoneShips(): Iterable<Entity>;
  hold(id: string): Entity | undefined;
  /** The zone's land, and shoals for a ship drawing `draftM`; undefined in an arena. */
  zoneLand(draftM: number): ArenaLand | undefined;
  /** The wind at a point: where it comes from (radians) and how hard (knots). */
  windAt(x: number, z: number): { fromRad: number; speedKn: number };
  /** 0 broad day and clear, 1 a dark night or thick fog. */
  dark01(): number;
  fameTier(): number;
  /** The guns the player's ship carries: 0 small arms, 1 a swivel, 2+ a broadside. */
  playerGuns(): number;
  /** Harbors in the zone (their anchors), zone meters: a steamer runs for one. */
  refuges(): readonly { x: number; z: number }[];
  /** A ship's name for the notices. */
  nameOf(id: string): string;
  notice(text: string): void;
}

interface Tracked {
  entity: Entity;
  record: ShipRecord;
  captain: TargetCaptain;
  /** A zone ship steered here (off her timetable). */
  steer?: SteeredShip;
}

export interface TargetView {
  id: string;
  classId: string;
  phase: TargetPhase;
  morale: number;
  parts: MoralePart[];
  why: string;
  warnings: number;
  damage: TargetCaptain['damage'];
  disabled: boolean;
  towedBy?: string;
  towParted?: boolean;
}

export interface Targets {
  /** One sailing tick (after the arena's helms and the law's, before the ships move). */
  step(dt: number): void;
  /**
   * A round (or a rifle ball) fell at `at`, zone meters; `hitId` the ship it struck, if
   * any. Parts a hawser it falls on, counts as a warning shot for the ship it fell across
   * the bow of, and puts every captain in earshot on the alert.
   */
  shotLanded(at: { x: number; z: number }, hitId?: string): { warned?: string; towCut?: string };
  /** A hit on a target: `share` of the pool carried away (piece A's damage). */
  hit(id: string, pool: DamagePool, share: number): void;
  casualties(id: string, killed: number, wounded: number): void;
  /** Parts a consort's hawser (a hit on the cable). */
  cutTow(consortId: string): boolean;
  /** The hawsers in the water, for aiming and hit tests. */
  towLines(): {
    leaderId: string;
    consortId: string;
    a: { x: number; z: number };
    b: { x: number; z: number };
  }[];
  isStruck(id: string): boolean;
  /**
   * Boarding (piece D): her crew gave in to you aboard (intimidated, or fought for), so
   * she strikes now; or, robbed and let go, she makes for port and never strikes again.
   */
  strike(id: string, why: string): boolean;
  release(id: string): boolean;
  /** Her captain's meter now, 0–100; undefined for a ship that isn't a target. */
  moraleOf(id: string): number | undefined;
  /** The helm a zone ship off her timetable sails under here (collisions slow it). */
  helmOf(e: Entity): NpcHelm | undefined;
  /** For the target card, the dev hook and tests. */
  captains(): TargetView[];
  /** A new zone or arena: other ships, other captains. */
  reset(): void;
}

function recordOf(classId: string | undefined): ShipRecord | undefined {
  return SHIP_RECORDS.find((r) => r.id === classId);
}

function halfLength(r: ShipRecord): number {
  return (r.lengthM * r.displayScale) / 2;
}

export function attachTargets(deps: TargetsDeps): Targets {
  const { ctx } = deps;
  const tracked = new Map<string, Tracked>();
  const tows = new Map<string, TowLine>();
  const knMs = arenaSceneSpeed(1);

  const playerTraffic: Traffic = { x: 0, z: 0, vx: 0, vz: 0, lengthM: 30 };
  const updatePlayer = (dt: number): Traffic | undefined => {
    const t = deps.player.transform;
    if (!t) return undefined;
    const prev = deps.player.previousTransform ?? t;
    playerTraffic.x = t.position.x;
    playerTraffic.z = t.position.z;
    playerTraffic.vx = (t.position.x - prev.position.x) / Math.max(dt, 1e-6);
    playerTraffic.vz = (t.position.z - prev.position.z) / Math.max(dt, 1e-6);
    return playerTraffic;
  };

  const shipsNow = (): Entity[] => {
    const arena = deps.arena();
    return arena ? arena.ships.map((s) => s.entity) : [...deps.zoneShips()];
  };

  const arenaSteer = (e: Entity): SteeredShip | undefined =>
    deps.arena()?.ships.find((s) => s.entity === e)?.steer;
  const helmOf = (t: Tracked): NpcHelm | undefined => (arenaSteer(t.entity) ?? t.steer)?.helm;

  /** A zone ship's own helm, once she's off her timetable. */
  const zoneHelm = (e: Entity, record: ShipRecord): SteeredShip | undefined => {
    const t = e.transform;
    if (!t) return undefined;
    const helm = createHelm(record, t.heading, serviceSpeedKn(record));
    helm.speedKn = e.npc?.speedKn ?? 0;
    helm.deepDraft = true;
    return {
      x: t.position.x,
      z: t.position.z,
      vx: e.velocity?.x ?? 0,
      vz: e.velocity?.z ?? 0,
      heading: t.heading,
      lengthM: record.lengthM * record.displayScale,
      helm,
    };
  };

  /** Takes a zone ship and everyone on her towline off the timetable. */
  const holdGroup = (t: Tracked): void => {
    if (deps.arena() || t.steer) return;
    const leaderId = t.entity.npc?.towedBy ?? t.entity.id ?? '';
    const group = [...tracked.values()].filter(
      (o) => o.entity.id === leaderId || o.entity.npc?.towedBy === leaderId,
    );
    for (const o of group) {
      if (o.steer || !o.entity.id) continue;
      const held = deps.hold(o.entity.id);
      const steer = held ? zoneHelm(held, o.record) : undefined;
      if (steer) o.steer = steer;
    }
  };

  /** Her best speed now, knots: flank speed, less for a tow, damage, or a light wind. */
  const bestKn = (t: Tracked): number => {
    const r = t.record;
    const c = t.captain;
    let kn = r.combat?.flankKn ?? serviceSpeedKn(r);
    if (towing(t.entity.id ?? '')) kn *= TOWING_SHARE;
    if (r.propulsion === 'steam') kn *= Math.max(0, c.damage.engine01);
    else {
      const p = t.entity.transform?.position;
      const wind = p ? deps.windAt(p.x, p.z).speedKn : 10;
      kn *= Math.min(1, Math.max(0, wind / 12)) * (0.3 + 0.7 * c.damage.rigging01);
    }
    return kn;
  };

  /** A consort still made fast astern of this ship. */
  const towing = (leaderId: string): boolean => {
    for (const l of tows.values()) if (l.leaderId === leaderId && !l.parted) return true;
    return false;
  };

  /** Finds new targets and their towlines. */
  const track = (ships: readonly Entity[]): Set<string> => {
    const seen = new Set<string>();
    for (const e of ships) {
      if (!e.id || !e.npc || e.npc.derelict || isLawShip(e) || !e.transform) continue;
      const record = recordOf(e.npc.classId);
      if (!record) continue;
      let t = tracked.get(e.id);
      if (!t) {
        const captain = createCaptain(e.id, record);
        if (!captain) continue;
        t = { entity: e, record, captain };
        tracked.set(e.id, t);
      }
      t.entity = e;
      seen.add(e.id);
      const leaderId = e.npc.towedBy;
      if (leaderId && !tows.has(e.id)) {
        const leader = ships.find((s) => s.id === leaderId);
        const lr = recordOf(leader?.npc?.classId);
        if (leader?.transform && lr) {
          const h = hawser(
            { ...leader.transform.position, heading: leader.transform.heading },
            halfLength(lr),
            { ...e.transform.position, heading: e.transform.heading },
            halfLength(record),
          );
          const lengthM = Math.max(20, Math.hypot(h.b.x - h.a.x, h.b.z - h.a.z));
          tows.set(e.id, { leaderId, consortId: e.id, lengthM, parted: false });
        }
      }
    }
    return seen;
  };

  const situation = (t: Tracked, ships: readonly Entity[]): TargetSituation | undefined => {
    const tr = t.entity.transform;
    if (!tr) return undefined;
    const p = playerTraffic;
    const me: Traffic = {
      x: tr.position.x,
      z: tr.position.z,
      vx: t.entity.velocity?.x ?? 0,
      vz: t.entity.velocity?.z ?? 0,
      lengthM: t.record.lengthM * t.record.displayScale,
    };
    const dx = p.x - me.x;
    const dz = p.z - me.z;
    const rangeM = Math.hypot(dx, dz);
    const closingMs = rangeM > 1e-6 ? -(dx * (p.vx - me.vx) + dz * (p.vz - me.vz)) / rangeM : 0;
    const cpa = closestApproach(me, p);
    let friendM: number | undefined;
    let witnesses = 0;
    for (const o of ships) {
      if (o === t.entity || !o.transform || !o.npc) continue;
      const d = Math.hypot(o.transform.position.x - me.x, o.transform.position.z - me.z);
      if (o.npc.classId === CUTTER_CLASS_ID) friendM = Math.min(friendM ?? Infinity, d);
      else if (d < IN_VIEW_M && !o.npc.struck && !o.npc.derelict) witnesses++;
    }
    let refugeM: number | undefined;
    for (const r of deps.refuges()) {
      const d = Math.hypot(r.x - me.x, r.z - me.z);
      refugeM = Math.min(refugeM ?? Infinity, d);
    }
    const tow = tows.get(t.entity.id ?? '');
    const leaderStruck =
      tow && !tow.parted && tracked.get(tow.leaderId)?.captain.phase === 'struck';
    const wind = deps.windAt(me.x, me.z);
    const helm = helmOf(t);
    return {
      rangeM,
      closingKn: closingMs / knMs,
      cpaM: cpa.t < 120 ? cpa.d : rangeM,
      fameTier: deps.fameTier(),
      playerGuns: deps.playerGuns(),
      dark01: deps.dark01(),
      friendM,
      refugeM,
      witnesses,
      canOutrun: bestKn(t) > deps.playerKn() + 0.5,
      becalmed: wind.speedKn < BECALMED_KN,
      trapped:
        !!leaderStruck ||
        (t.captain.phase === 'fleeing' && helm?.state === 'stopped' && helm.serviceKn > 0),
      towed: !!tow && !tow.parted,
      adrift: !!tow && tow.parted,
    };
  };

  const act = (
    t: Tracked,
    from: TargetPhase,
    to: TargetPhase,
    morale: number,
    why: string,
  ): void => {
    const id = t.entity.id ?? '';
    const name = deps.nameOf(id);
    ctx.events.emit('TargetStateChanged', { shipId: id, from, to, morale, why });
    switch (to) {
      case 'struck':
        if (t.entity.npc) t.entity.npc.struck = true;
        ctx.events.emit('MoraleBroken', { shipId: id, classId: t.record.id, morale, why });
        deps.notice(`${name} strikes her colors and heaves to (${why}).`);
        break;
      case 'fleeing':
        if (from !== 'fleeing') deps.notice(`${name} is running for it.`);
        break;
      case 'fighting':
        deps.notice(`${name} turns toward you: her captain means to ram!`);
        break;
      case 'fled':
        ctx.events.emit('ShipFled', { shipId: id, classId: t.record.id });
        deps.notice(`${name} has got clear away.`);
        break;
      default:
        break;
    }
  };

  /** The helm's orders for her captain's phase. */
  const ordersFor = (t: Tracked): NpcHelm['orders'] => {
    const c = t.captain;
    const tow = tows.get(t.entity.id ?? '');
    // A consort's helm stands by while she's towed, and she drifts once it parts.
    if (tow) return { mode: 'stop' };
    switch (c.phase) {
      case 'transit':
      case 'alert':
        return undefined;
      case 'struck':
        return { mode: 'stop' };
      case 'fighting':
        return { mode: 'ram', kn: bestKn(t) };
      case 'fleeing':
      case 'fled': {
        const p = t.entity.transform?.position;
        const kn = bestKn(t);
        if (t.record.propulsion === 'sail' && p) {
          const downwindRad = deps.windAt(p.x, p.z).fromRad + Math.PI;
          return { mode: 'flee', kn, downwindRad };
        }
        // A steamer makes for the nearest harbor off her quarter, if there is one.
        let refuge: { x: number; z: number } | undefined;
        let best = Infinity;
        for (const r of deps.refuges()) {
          const d = p ? Math.hypot(r.x - p.x, r.z - p.z) : Infinity;
          if (d < best) {
            best = d;
            refuge = r;
          }
        }
        return refuge ? { mode: 'flee', kn, refuge } : { mode: 'flee', kn };
      }
    }
  };

  /** Applies orders to her helm; transit leaves an arena helm on her lane's course. */
  const command = (t: Tracked): void => {
    const helm = helmOf(t);
    if (!helm) return;
    const orders = ordersFor(t);
    if (orders) helm.orders = orders;
    else delete helm.orders;
    helm.flankKn = bestKn(t);
  };

  /** Steers the zone ships off their timetables (the arena steers its own). */
  const steerZone = (dt: number, player: Traffic | undefined): void => {
    const held = [...tracked.values()].filter((t) => t.steer && t.entity.transform);
    if (held.length === 0) return;
    for (const t of held) {
      const s = t.steer as SteeredShip;
      const tr = t.entity.transform;
      if (!tr) continue;
      s.x = tr.position.x;
      s.z = tr.position.z;
      s.heading = tr.heading;
    }
    // One pass per draft: a freighter feels for her water, a tug goes where she likes.
    const byDraft = new Map<number, Tracked[]>();
    for (const t of held) {
      const list = byDraft.get(t.record.draftFullM) ?? [];
      list.push(t);
      byDraft.set(t.record.draftFullM, list);
    }
    for (const [draft, list] of byDraft) {
      const land = deps.zoneLand(draft);
      if (!land) continue;
      steerShips(
        list.map((t) => t.steer as SteeredShip),
        player,
        land,
        dt,
      );
    }
    for (const t of held) {
      const s = t.steer as SteeredShip;
      const e = t.entity;
      if (e.transform) e.transform.heading = s.heading;
      if (e.velocity) {
        e.velocity.x = s.vx;
        e.velocity.z = s.vz;
      }
      if (e.npc) e.npc.speedKn = s.helm.speedKn;
    }
  };

  /** Consorts made fast: pulled after their steamers, whatever their own helms said. */
  const towAll = (dt: number): void => {
    const arena = !!deps.arena();
    for (const line of tows.values()) {
      if (line.parted) continue;
      const leader = tracked.get(line.leaderId);
      const consort = tracked.get(line.consortId);
      const lt = leader?.entity.transform;
      const ct = consort?.entity.transform;
      if (!leader || !consort || !lt || !ct) continue;
      // In a zone, a ship sailing her timetable is placed by it, consort and all.
      if (!arena && !consort.steer) continue;
      const lv = leader.entity.velocity ?? { x: 0, z: 0 };
      const next = towConsort(
        { x: lt.position.x + lv.x * dt, z: lt.position.z + lv.z * dt, heading: lt.heading },
        halfLength(leader.record),
        { x: ct.position.x, z: ct.position.z, heading: ct.heading },
        halfLength(consort.record),
        line.lengthM,
      );
      const v = consort.entity.velocity;
      if (v) {
        v.x = (next.x - ct.position.x) / dt;
        v.z = (next.z - ct.position.z) / dt;
      }
      ct.heading = next.heading;
      const kn = v ? Math.hypot(v.x, v.z) / knMs : 0;
      if (consort.entity.npc) consort.entity.npc.speedKn = kn;
      const helm = helmOf(consort);
      if (helm) helm.speedKn = kn;
    }
  };

  const cutTow = (consortId: string): boolean => {
    const line = tows.get(consortId);
    if (!line || line.parted) return false;
    line.parted = true;
    const consort = tracked.get(consortId)?.entity.npc;
    if (consort) consort.towParted = true;
    ctx.events.emit('TowCut', { leaderId: line.leaderId, consortId });
    deps.notice(`The towline parts: ${deps.nameOf(consortId)} is adrift.`);
    return true;
  };

  const towLines: Targets['towLines'] = () => {
    const out: ReturnType<Targets['towLines']> = [];
    for (const line of tows.values()) {
      if (line.parted) continue;
      const leader = tracked.get(line.leaderId);
      const consort = tracked.get(line.consortId);
      const lt = leader?.entity.transform;
      const ct = consort?.entity.transform;
      if (!leader || !consort || !lt || !ct) continue;
      const h = hawser(
        { ...lt.position, heading: lt.heading },
        halfLength(leader.record),
        { ...ct.position, heading: ct.heading },
        halfLength(consort.record),
      );
      out.push({ leaderId: line.leaderId, consortId: line.consortId, a: h.a, b: h.b });
    }
    return out;
  };

  return {
    step(dt) {
      if (dt <= 0) return;
      const player = updatePlayer(dt);
      if (!player) return;
      const ships = shipsNow();
      const seen = track(ships);
      for (const id of [...tracked.keys()]) {
        if (seen.has(id)) continue;
        tracked.delete(id);
        tows.delete(id);
      }
      for (const t of tracked.values()) {
        const sit = situation(t, ships);
        if (!sit) continue;
        for (const a of stepCaptain(t.captain, sit, dt)) {
          if (a.type === 'phase') act(t, a.from, a.to, a.morale, a.why);
        }
        if (t.captain.phase !== 'transit') holdGroup(t);
      }
      for (const t of tracked.values()) command(t);
      if (!deps.arena()) steerZone(dt, player);
      towAll(dt);
    },
    shotLanded(at, hitId) {
      const out: { warned?: string; towCut?: string } = {};
      for (const line of towLines()) {
        if (hitsHawser(at, line.a, line.b) && cutTow(line.consortId)) {
          out.towCut = line.consortId;
          break;
        }
      }
      let best: { t: Tracked; d: number } | undefined;
      for (const t of tracked.values()) {
        const tr = t.entity.transform;
        if (!tr) continue;
        const dx = at.x - tr.position.x;
        const dz = at.z - tr.position.z;
        const d = Math.hypot(dx, dz);
        if (d < GUNFIRE_HEARD_M) noteGunfire(t.captain);
        if (t.entity.id === hitId) continue;
        // Ahead of her: along her heading, within a wide cone off the bow.
        const along = Math.sin(tr.heading) * dx - Math.cos(tr.heading) * dz;
        const across = Math.abs(Math.cos(tr.heading) * dx + Math.sin(tr.heading) * dz);
        const ahead = along > 0 && along < WARN_AHEAD_M && across < along * 0.7 + 40;
        if ((d < WARN_CLOSE_M || ahead) && (!best || d < best.d)) best = { t, d };
      }
      if (best && !hitId) {
        noteWarningShot(best.t.captain);
        out.warned = best.t.entity.id ?? '';
      }
      return out;
    },
    hit(id, pool, share) {
      const t = tracked.get(id);
      if (t) noteHit(t.captain, pool, share);
    },
    casualties(id, killed, wounded) {
      const t = tracked.get(id);
      if (t) noteCasualties(t.captain, killed, wounded);
    },
    cutTow,
    towLines,
    helmOf(e) {
      const t = e.id ? tracked.get(e.id) : undefined;
      return t ? helmOf(t) : undefined;
    },
    isStruck(id) {
      return tracked.get(id)?.captain.phase === 'struck';
    },
    strike(id, why) {
      const t = tracked.get(id);
      if (!t) return false;
      const c = t.captain;
      if (c.phase === 'struck') return true;
      const from = c.phase;
      c.phase = 'struck';
      c.why = why;
      holdGroup(t);
      act(t, from, 'struck', c.morale, why);
      command(t);
      return true;
    },
    release(id) {
      const t = tracked.get(id);
      if (!t) return false;
      const c = t.captain;
      const from = c.phase;
      c.phase = 'fled';
      c.why = 'let go';
      if (t.entity.npc) delete t.entity.npc.struck;
      ctx.events.emit('TargetStateChanged', {
        shipId: id,
        from,
        to: 'fled',
        morale: c.morale,
        why: c.why,
      });
      command(t);
      return true;
    },
    moraleOf(id) {
      return tracked.get(id)?.captain.morale;
    },
    captains() {
      return [...tracked.values()].map((t) => {
        const c = t.captain;
        const tow = tows.get(t.entity.id ?? '');
        return {
          id: c.id,
          classId: c.classId,
          phase: c.phase,
          morale: Math.round(c.morale * 10) / 10,
          parts: c.parts,
          why: c.why,
          warnings: c.warnings,
          damage: { ...c.damage },
          disabled: disabled(c),
          ...(tow ? { towedBy: tow.leaderId, towParted: tow.parted } : {}),
        };
      });
    },
    reset() {
      tracked.clear();
      tows.clear();
    },
  };
}
