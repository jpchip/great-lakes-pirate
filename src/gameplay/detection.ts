import { dayAndHour } from '../core/time';
import type { GameContext } from '../modes/context';
import { lampLevel, type PlacedLight } from '../sim/lighthouses';
import {
  awarenessOf,
  createMeter,
  daylight01,
  landBetween,
  shoreBehind,
  sight,
  stepMeter,
  SPOTTED,
  type Awareness,
  type Backdrop,
  type Conditions,
  type DetectionMeter,
  type Sight,
  type Target,
} from '../sim/law/perception';
import {
  beamHit,
  inGlow,
  keeperObservers,
  shipObserver,
  type Observer,
} from '../sim/law/observers';
import type { Identification, Witness, WitnessSource } from '../sim/law/witness';
import { moonAt, sunAt } from '../sim/weather/celestial';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import type { Entity } from './ecs';

/**
 * Detection at sea (plan 06 §7.1, Phase 5 piece B): every watcher in the zone or arena
 * (the keepers on their galleries, the crews of the ships about, the cutter's lookout)
 * looks for the player's ship a few times a second and fills a detection meter. Spotting
 * and identifying her raise events, and whoever has her in sight is a witness the law
 * core (piece A) can ask for the moment a crime is done.
 */

/** Looks a second: detection is slow-moving, so it needn't run every tick. */
export const DETECTION_HZ = 4;

/** The player's deck, for the line of sight: a sail shows well above it. */
const TARGET_Y_M = 6;

export interface Watcher {
  observer: Observer;
  meter: DetectionMeter;
  sight: Sight;
  backdrop: Backdrop;
  awareness: Awareness;
  distanceM: number;
}

export interface DetectionDeps {
  ctx: GameContext;
  /** The player's ship entity. */
  player: Entity;
  /** The current zone's id, undefined in an arena or open water. */
  zoneId(): string | undefined;
  /** The current zone's lights, placed on its land (none in an arena). */
  lights(): readonly PlacedLight[];
  /** A traffic ship's name by entity id. */
  shipName(id: string): string | undefined;
  /** Ships that don't watch: the smuggler, whose crew won't tell. */
  ignore?(id: string): boolean;
  /** The lenses' clock, real seconds: the renderer's, so the beam you see is the beam that hits. */
  beamClock?(): number;
  /** Regional Wanted tier at a light (piece A); 0 until the law core is wired. */
  wantedTier?(lightId: string): number;
}

export interface Detection extends WitnessSource {
  /** Real seconds; call while sailing (zone or arena), not on the chart or a paused screen. */
  step(dt: number): void;
  /** Forget every meter: a new zone or arena has different eyes. */
  reset(): void;
  /** Everyone looking, sorted by how close they are to spotting her. */
  readonly watchers: readonly Watcher[];
  /** The one most aware of her, for the HUD's eye. */
  readonly keenest: Watcher | undefined;
  /** The player's detectability now (for the debug readout), with the conditions it used. */
  readonly conditions: Conditions | undefined;
}

function tierOf(classId: string | undefined): number {
  return SHIP_RECORDS.find((r) => r.id === classId)?.tier ?? 1;
}

function identification(w: Watcher): Identification {
  if (w.meter.identified) return 'ship';
  return w.meter.byLanternOnly ? 'unknown' : 'schooner';
}

export function attachDetection(deps: DetectionDeps): Detection {
  const { ctx, player } = deps;
  const meters = new Map<string, DetectionMeter>();
  let watchers: Watcher[] = [];
  let accum = 0;
  let realS = 0;
  let conditions: Conditions | undefined;

  const witnessOf = (w: Watcher): Witness => {
    const zoneId = deps.zoneId();
    return {
      id: w.observer.id,
      kind: w.observer.kind,
      name: w.observer.name,
      ...(zoneId ? { zoneId } : {}),
      identification: identification(w),
      ...(w.observer.reporting ? { reporting: w.observer.reporting } : {}),
      distanceM: Math.round(w.distanceM),
    };
  };

  const look = (dt: number): void => {
    const t = player.transform;
    const sailing = player.sailing;
    if (!t || !sailing) return;
    const now = ctx.state.environment.clock.gameSeconds;
    const sun = sunAt(now);
    const moon = moonAt(now);
    const cloud01 = ctx.weather.cloudAt(now);
    const cond: Conditions = {
      sky: {
        sunElevationRad: sun.elevationRad,
        moonElevationRad: moon.elevationRad,
        moonIllumination01: moon.illumination01,
        cloud01,
      },
      fogM: ctx.weather.fogVisibilityAt(now),
      rain01: ctx.weather.rainAt(now),
    };
    conditions = cond;
    const day = daylight01(sun.elevationRad);
    const lamp01 = lampLevel((sun.elevationRad * 180) / Math.PI);
    const target: Target = {
      tier: tierOf(sailing.cls.id),
      sails01: sailing.state.sailSetting / 3,
      lanternLit: !!player.lantern?.lit,
    };
    const ship = { x: t.position.x, z: t.position.z };
    const lights = deps.lights();
    const glow = inGlow(lights, ship, lamp01);
    const beamS = deps.beamClock?.() ?? realS;

    const observers: Observer[] = keeperObservers(
      lights,
      dayAndHour(now).hour,
      day,
      deps.wantedTier,
    );
    for (const e of ctx.world.with('npc', 'transform')) {
      const id = e.id;
      if (!id || e.npc.derelict || deps.ignore?.(id)) continue;
      observers.push(
        shipObserver(
          {
            id,
            classId: e.npc.classId,
            name: deps.shipName(id) ?? 'a ship',
            x: e.transform.position.x,
            z: e.transform.position.z,
          },
          day,
        ),
      );
    }

    const terrain = ctx.terrain;
    const heightAt =
      terrain && terrain.contains(ship.x, ship.z)
        ? (x: number, z: number) => (terrain.contains(x, z) ? terrain.heightAt(x, z) : -10)
        : undefined;
    const next: Watcher[] = [];
    const seen = new Set<string>();
    for (const o of observers) {
      seen.add(o.id);
      const distanceM = Math.hypot(ship.x - o.x, ship.z - o.z);
      const blocked =
        !!heightAt &&
        landBetween(
          heightAt,
          { x: o.x, y: o.eyeM, z: o.z },
          { x: ship.x, y: TARGET_Y_M, z: ship.z },
        );
      const backdrop: Backdrop = glow
        ? 'glow'
        : heightAt && shoreBehind(heightAt, o, ship)
          ? 'shore'
          : 'sky';
      const s: Sight = blocked
        ? { hullM: 0, lanternM: 0, rangeM: 0, by: 'none', closeness01: 0, canIdentify: false }
        : sight(target, cond, o, backdrop, distanceM);
      let meter = meters.get(o.id);
      if (!meter) {
        meter = createMeter();
        meters.set(o.id, meter);
      }
      const before = awarenessOf(meter);
      const hit = !blocked && !!o.light && beamHit(o.light, ship, beamS, lamp01);
      stepMeter(meter, s, o.vigilance, dt, hit);
      const w: Watcher = {
        observer: o,
        meter,
        sight: s,
        backdrop,
        awareness: awarenessOf(meter),
        distanceM,
      };
      next.push(w);
      if (w.awareness === before) continue;
      if (w.awareness === 'identified') {
        ctx.events.emit('PlayerIdentified', { witness: witnessOf(w) });
      } else if (w.awareness === 'spotted' && before !== 'identified') {
        ctx.events.emit('PlayerSpotted', { witness: witnessOf(w) });
      } else if ((before === 'spotted' || before === 'identified') && meter.value < SPOTTED) {
        ctx.events.emit('PlayerLostSight', { witnessId: o.id });
      }
    }
    // Watchers gone from the scene (a ship sailed off) forget her.
    for (const id of meters.keys()) if (!seen.has(id)) meters.delete(id);
    next.sort((a, b) => b.meter.value - a.meter.value || a.distanceM - b.distanceM);
    watchers = next;
  };

  return {
    step(dt) {
      realS += dt;
      accum += dt;
      const period = 1 / DETECTION_HZ;
      if (accum < period) return;
      const stepS = Math.min(accum, 1);
      accum = 0;
      look(stepS);
    },
    reset() {
      meters.clear();
      watchers = [];
      accum = 0;
    },
    witnesses() {
      return watchers
        .filter((w) => w.meter.value >= SPOTTED && w.sight.by !== 'none')
        .map(witnessOf);
    },
    get watchers() {
      return watchers;
    },
    get keenest() {
      return watchers[0];
    },
    get conditions() {
      return conditions;
    },
  };
}

/** The HUD's eye: who's watching, in words (plan 13: a word and a shape, not color alone). */
export function awarenessChip(
  w: Watcher | undefined,
): { level: Exclude<Awareness, 'unaware'>; by: string } | undefined {
  if (!w || w.awareness === 'unaware') return undefined;
  return { level: w.awareness, by: w.observer.name };
}
