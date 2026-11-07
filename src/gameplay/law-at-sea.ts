import type { GameContext } from '../modes/context';
import type { Chart } from '../core/coords';
import type { ArenaLand } from '../sim/arena/land';
import { createHelm, steerShips, type SteeredShip, type Traffic } from '../sim/arena/steering';
import { offerKind, searchChance } from '../sim/economy/contraband';
import type { EconomyDefs } from '../sim/economy/defs';
import {
  afterInspection,
  createCutterBrain,
  cutterOrders,
  intentFor,
  stepCutter,
  CUTTER_RULES,
  type CutterAction,
  type CutterBrain,
  type CutterIntent,
} from '../sim/law/cutter';
import { tierIn } from '../sim/law/law';
import { CUTTER_CLASS_ID } from '../sim/law/observers';
import type { Witness } from '../sim/law/witness';
import { damageRigging } from '../sim/sailing/hazards';
import { SHIP_RECORDS, serviceSpeedKn } from '../sim/sailing/ships';
import type { Detection } from './detection';
import type { Entity } from './ecs';
import type { ShipHazards } from './hazards';
import type { GameLaw } from './law';
import { TUG_ID } from './law-ships';

/**
 * The law at close quarters (plan 06 §5.1, §8.1; Phase 5 piece C). Every law ship on the
 * water with the player (the *Morrill*, the tier-5 tug), in an arena or a zone, has a
 * captain (`sim/law/cutter.ts`). Each sailing tick this module tells him what her lookout
 * sees (piece B's meter), the Wanted where the player is (piece A), how fast the player
 * is going, whether she's in the shallows and how her rigging stands; then carries out
 * what he decides: the hail, the warning shot, a round at the rigging, the search of the
 * hold (confiscation and the crime it is), and the capture, which piece D takes over.
 *
 * In an arena her helm is the arena's. In a zone she sails her timetable until her
 * captain takes an interest; then she's taken off it (`hold`) and steered here.
 */

/** Below this tier she's never after you (decided 2026-10-21); she pursues from here. */
export const PURSUES_FROM_TIER = 2;

/** The tug's deputies jump aboard a ship making less than this alongside, knots. */
const TUG_BOARDS_UNDER_KN = 4;

/** A ship forced on the chart keeps the player in sight this long while her meter fills. */
const CHART_SIGHT_GRACE_S = 10;

/** The water a law ship draws too much for, beyond her draft, meters. */
const UNDER_KEEL_M = 0.6;

/** Law ships the player can meet: by entity id or class. */
export function isLawShip(e: Entity): boolean {
  return e.npc?.classId === CUTTER_CLASS_ID || e.id === TUG_ID;
}

/** Her law id for the events: the *Morrill* or the chartered tug. */
function lawIdOf(e: Entity): 'law.morrill' | 'law.chartered_tug' {
  return e.id === TUG_ID ? 'law.chartered_tug' : 'law.morrill';
}

export interface LawAtSeaDeps {
  ctx: GameContext;
  law: GameLaw;
  detection: Detection;
  player: Entity;
  hazards: ShipHazards;
  economy: EconomyDefs;
  /** The player's speed, knots. */
  playerKn(): number;
  /** The player's Wanted region now. */
  region(): string | undefined;
  /** Where the player is on the world chart frame, for the capture. */
  chartAt(): Chart;
  /** The arena in play: its ships' helms and its land. */
  arena():
    | {
        ships: readonly { entity: Entity; steer: SteeredShip }[];
        land: ArenaLand;
        /** The cutter hunts (forced on the chart or `?cutter=hunt`). */
        hunting: boolean;
      }
    | undefined;
  /** The zone's ships, and taking one off her timetable. */
  zoneShips(): Iterable<Entity>;
  hold(id: string): Entity | undefined;
  /** The zone's land and shoals for a deep-draft helm; undefined in an arena. */
  zoneLand(): ArenaLand | undefined;
  /** A hidden compartment's multiplier on the search (the shipyard's instruments). */
  searchMul(): number;
  notice(text: string): void;
  /** A shot falling into the water at (x, z): the warning shot and the misses. */
  splash?(x: number, z: number): void;
  /** At least this tier, whatever the region's (the `?cutter=hunt` dev flag). */
  devTier?(): number;
}

interface Tracked {
  entity: Entity;
  brain: CutterBrain;
  /**
   * Seconds she still has the player in sight from the chart: forced on her there, she
   * saw the ship before the arena's lookout had a meter to fill.
   */
  graceS: number;
  /** A zone ship steered here (off her timetable). */
  steer?: SteeredShip;
  locked: boolean;
}

export interface LawAtSea {
  /** One sailing tick (after the arena's helms, before the ships move). */
  step(dt: number): void;
  /** A law ship's lookout has the player and she's after them: the chart is locked. */
  readonly locked: boolean;
  /** She has taken the player (the arena ends with 'caught'). */
  readonly captured: boolean;
  /** For the dev hook and tests. */
  brains(): { id: string; phase: string; intent: CutterIntent; hails: number; shots: number }[];
  /** A new zone or arena: other ships, other captains. */
  reset(): void;
}

export function attachLawAtSea(deps: LawAtSeaDeps): LawAtSea {
  const { ctx, law, detection, hazards } = deps;
  const tracked = new Map<string, Tracked>();
  let captured = false;
  const cutterDraft = SHIP_RECORDS.find((r) => r.id === CUTTER_CLASS_ID)?.draftFullM ?? 3;

  const tierNow = (): number => {
    const region = deps.region();
    const tier = region ? tierIn(law.defs, ctx.state, region) : 0;
    return Math.max(tier, deps.devTier?.() ?? 0);
  };

  const playerShoal = (x: number, z: number): boolean => {
    const arena = deps.arena();
    if (arena) return !!arena.land.isShoal?.(x, z);
    const t = ctx.terrain;
    return !!t && t.contains(x, z) && t.depthAt(x, z) < cutterDraft + UNDER_KEEL_M;
  };

  const witnessOf = (e: Entity): Witness => ({
    id: lawIdOf(e),
    kind: 'cutter',
    name: e.id === TUG_ID ? law.defs.actors.tug.name : law.defs.actors.cutter.name,
    identification: 'person',
  });

  /** The search of the hold: what's found is confiscated, and each kind is its crime. */
  const search = (e: Entity, tier: number): boolean => {
    const region = deps.region();
    const now = ctx.state.environment.clock.gameSeconds;
    const cargo = ctx.state.player.cargo;
    const found: { good: string; qty: number; kind: 'hot' | 'contraband' }[] = [];
    for (let i = cargo.length - 1; i >= 0; i--) {
      const stack = cargo[i];
      if (!stack) continue;
      const kind = offerKind(deps.economy, stack);
      if (!kind) continue;
      const p = searchChance(deps.economy, stack, tier, region, now, deps.searchMul());
      if (ctx.rng.next() >= p) continue;
      found.push({ good: stack.good, qty: stack.qty, kind });
      cargo.splice(i, 1);
    }
    ctx.events.emit('HoldSearched', { by: lawIdOf(e), region: region ?? '', found });
    if (region && law.defs.regionById.has(region)) {
      for (const kind of new Set(found.map((f) => f.kind))) {
        law.commit({
          crime: kind === 'contraband' ? 'crime.contraband' : 'crime.hot_goods',
          region,
          witnesses: [witnessOf(e)],
        });
      }
    }
    const goods = found.map(
      (f) => `${f.qty} CU of ${deps.economy.goods.get(f.good)?.name ?? f.good}`,
    );
    deps.notice(
      found.length > 0
        ? `The boarding officer found ${goods.join(' and ')}, and took it.`
        : 'The boarding officer turned out the hold and found nothing.',
    );
    return found.length > 0;
  };

  const act = (t: Tracked, a: CutterAction, tier: number): void => {
    const by = lawIdOf(t.entity);
    const name = t.entity.id === TUG_ID ? 'The tug' : 'The Morrill';
    switch (a.type) {
      case 'pursuit':
        t.locked = a.locked;
        ctx.events.emit('PursuitChanged', { pursued: a.locked, by });
        break;
      case 'hail':
        ctx.events.emit('CutterHailed', { by, intent: a.intent, arrest: a.arrest });
        deps.notice(
          a.arrest
            ? `${name}: "You're under arrest. Lie to and stand by to be boarded."`
            : a.intent === 'inspect'
              ? `${name} hails: "Heave to for inspection!"`
              : `${name} hails: "Heave to, in the name of the United States!"`,
        );
        break;
      case 'warningShot': {
        // Across the bow: a column of water a few lengths ahead of her.
        const pt = deps.player.transform;
        let at: { x: number; z: number } | undefined;
        if (pt && t.entity.id !== TUG_ID) {
          const ahead = 70 + 30 * ctx.rng.next();
          at = {
            x: pt.position.x + Math.sin(pt.heading) * ahead,
            z: pt.position.z - Math.cos(pt.heading) * ahead,
          };
        }
        ctx.events.emit('CutterFired', { by, kind: 'warning', hit: false, ...(at ? { at } : {}) });
        if (at) deps.splash?.(at.x, at.z);
        deps.notice(
          t.entity.id === TUG_ID
            ? 'A deputy fires a rifle over your bow. Heave to!'
            : `${name} fires a shot across your bow. Heave to, or she'll fire on you.`,
        );
        break;
      }
      case 'fire': {
        // The tug has no gun, only her deputies' rifles: they can't shoot a mast away.
        if (t.entity.id === TUG_ID) {
          ctx.events.emit('CutterFired', { by, kind: 'rigging', hit: a.hit });
          deps.notice("The deputies' rifles crack from the tug's deck.");
          break;
        }
        const pt = deps.player.transform;
        if (!a.hit) {
          // A miss throws up water close aboard.
          let at: { x: number; z: number } | undefined;
          if (pt) {
            const ang = ctx.rng.next() * Math.PI * 2;
            const off = 25 + 35 * ctx.rng.next();
            at = { x: pt.position.x + Math.cos(ang) * off, z: pt.position.z + Math.sin(ang) * off };
          }
          ctx.events.emit('CutterFired', {
            by,
            kind: 'rigging',
            hit: false,
            ...(at ? { at } : {}),
          });
          if (at) deps.splash?.(at.x, at.z);
        } else {
          const at = pt ? { x: pt.position.x, z: pt.position.z } : undefined;
          ctx.events.emit('CutterFired', { by, kind: 'rigging', hit: true, ...(at ? { at } : {}) });
          damageRigging(hazards.state, a.riggingShare * hazards.cls.riggingHP);
          deps.notice('A shot tears through your rigging!');
        }
        break;
      }
      case 'inspect': {
        const found = search(t.entity, tier);
        for (const next of afterInspection(t.brain, found, tierNow(), PURSUES_FROM_TIER)) {
          if (next.type === 'release') deps.notice(`${name} lets you go on your way.`);
          else act(t, next, tier);
        }
        break;
      }
      case 'release':
        break;
      case 'capture':
        captured = true;
        ctx.events.emit('PlayerCaptured', {
          by,
          region: deps.region() ?? '',
          how: a.how,
          at: deps.chartAt(),
        });
        deps.notice(
          a.how === 'surrender'
            ? `You heave to under ${name}'s gun and surrender.`
            : `${name}'s boarding party takes your ship.`,
        );
        break;
      case 'gaveUp':
        deps.notice(
          a.why === 'shallows'
            ? `${name} won't risk her keel in the shallows: she stands off and gives it up.`
            : `${name} has lost you.`,
        );
        break;
    }
  };

  const zoneHelm = (e: Entity): SteeredShip | undefined => {
    const record = SHIP_RECORDS.find((r) => r.id === e.npc?.classId);
    const t = e.transform;
    if (!record || !t) return undefined;
    const speedKn = e.npc?.speedKn ?? 0;
    const helm = createHelm(record, t.heading, serviceSpeedKn(record));
    helm.deepDraft = record.id === CUTTER_CLASS_ID;
    helm.speedKn = speedKn;
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

  const traffic: Traffic = { x: 0, z: 0, vx: 0, vz: 0, lengthM: 30 };
  const playerTraffic = (dt: number): Traffic | undefined => {
    const t = deps.player.transform;
    if (!t) return undefined;
    const prev = deps.player.previousTransform ?? t;
    traffic.x = t.position.x;
    traffic.z = t.position.z;
    traffic.vx = (t.position.x - prev.position.x) / Math.max(dt, 1e-6);
    traffic.vz = (t.position.z - prev.position.z) / Math.max(dt, 1e-6);
    return traffic;
  };

  return {
    step(dt) {
      const p = deps.player.transform?.position;
      if (!p || dt <= 0) return;
      const arena = deps.arena();
      const ships: Entity[] = arena ? arena.ships.map((s) => s.entity) : [...deps.zoneShips()];
      const tier = tierNow();
      const seen = new Set<string>();
      for (const e of ships) {
        if (!e.id || !isLawShip(e) || !e.transform) continue;
        seen.add(e.id);
        let t = tracked.get(e.id);
        const watcher = detection.watchers.find((w) => w.observer.id === e.id);
        const t0 = tracked.get(e.id);
        const graced = !!t0 && t0.graceS > 0;
        if (t0) t0.graceS = Math.max(0, t0.graceS - dt);
        const looked = watcher?.awareness ?? 'unaware';
        const awareness =
          graced && (looked === 'unaware' || looked === 'watching') ? 'spotted' : looked;
        const identified = !!watcher?.meter.identified;
        if (!t) {
          const sense = {
            tier,
            inspectsFromTier: law.defs.actors.cutter.inspectsFromTier,
            pursuesFromTier: PURSUES_FROM_TIER,
            // Forced on the chart, she has already seen you.
            awareness: arena?.hunting ? ('spotted' as const) : awareness,
            identified,
          };
          const intent = arena?.hunting ? intentFor(sense) : undefined;
          t = {
            entity: e,
            brain: createCutterBrain(intent ? { hunting: true, intent } : undefined),
            graceS: intent ? CHART_SIGHT_GRACE_S : 0,
            locked: false,
          };
          tracked.set(e.id, t);
        }
        const d = Math.hypot(e.transform.position.x - p.x, e.transform.position.z - p.z);
        const rigging01 = hazards.state.rigging / Math.max(hazards.cls.riggingHP, 1);
        const actions = stepCutter(
          t.brain,
          {
            tier,
            inspectsFromTier: law.defs.actors.cutter.inspectsFromTier,
            pursuesFromTier: PURSUES_FROM_TIER,
            awareness,
            identified,
            player: { x: p.x, z: p.z },
            distanceM: d,
            playerKn: deps.playerKn(),
            playerShoal: playerShoal(p.x, p.z),
            rigging01,
            ...(e.id === TUG_ID ? { boardsUnderKn: TUG_BOARDS_UNDER_KN } : {}),
          },
          dt,
          () => ctx.rng.next(),
          CUTTER_RULES,
        );
        for (const a of actions) act(t, a, tier);

        // Her helm: the arena's, or (in a zone, once she's after you) one of our own.
        const orders = cutterOrders(t.brain);
        const arenaSteer = arena?.ships.find((s) => s.entity === e)?.steer;
        if (arenaSteer) {
          arenaSteer.helm.orders = orders;
          arenaSteer.helm.hunting = orders.mode !== 'course';
        } else if (!t.steer && orders.mode !== 'course') {
          const held = deps.hold(e.id);
          const steer = held ? zoneHelm(held) : undefined;
          if (steer) t.steer = steer;
        }
        if (t.steer) {
          t.steer.helm.orders = orders;
          t.steer.helm.hunting = orders.mode !== 'course';
        }
      }

      // Zone ships off their timetables: steer them here (the arena steers its own).
      const steered = [...tracked.values()].filter((t) => t.steer && seen.has(t.entity.id ?? ''));
      if (!arena && steered.length > 0) {
        const land = deps.zoneLand();
        const player = playerTraffic(dt);
        for (const t of steered) {
          const s = t.steer as SteeredShip;
          const tr = t.entity.transform;
          if (!tr) continue;
          s.x = tr.position.x;
          s.z = tr.position.z;
          s.heading = tr.heading;
        }
        if (land)
          steerShips(
            steered.map((t) => t.steer as SteeredShip),
            player,
            land,
            dt,
          );
        for (const t of steered) {
          const s = t.steer as SteeredShip;
          const e = t.entity;
          if (e.transform) e.transform.heading = s.heading;
          if (e.velocity) {
            e.velocity.x = s.vx;
            e.velocity.z = s.vz;
          }
          if (e.npc) e.npc.speedKn = s.helm.speedKn;
        }
      }
      for (const [id, t] of tracked) {
        if (seen.has(id)) continue;
        if (t.locked) ctx.events.emit('PursuitChanged', { pursued: false, by: lawIdOf(t.entity) });
        tracked.delete(id);
      }
    },
    get locked() {
      for (const t of tracked.values()) if (t.brain.locked) return true;
      return false;
    },
    get captured() {
      return captured;
    },
    brains() {
      return [...tracked.entries()].map(([id, t]) => ({
        id,
        phase: t.brain.phase,
        intent: t.brain.intent,
        hails: t.brain.hails,
        shots: t.brain.shots,
      }));
    },
    reset() {
      for (const t of tracked.values()) {
        if (t.locked) ctx.events.emit('PursuitChanged', { pursued: false, by: lawIdOf(t.entity) });
      }
      tracked.clear();
      captured = false;
    },
  };
}
