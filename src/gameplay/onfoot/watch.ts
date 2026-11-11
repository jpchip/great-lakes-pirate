import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import type { SkyLight } from '../../sim/law/perception';
import { moonAt, sunAt } from '../../sim/weather/celestial';
import type { DistrictModel } from '../district/district';
import { DEFAULT_CONTROLLER, type CharacterState } from './controller';
import {
  districtLamps,
  lightLamps,
  planDistrictWatch,
  suspectAshore,
  type SuspectContext,
} from './district-guards';
import { gameNpcs, rosterForTier, type NpcDefs } from './guards';
import { ambientLight01, LampSet } from './light';
import type { NavQuery } from './nav';
import { fogOnFoot01 } from './perception';
import { createStealth, type Stealth, type StealthEvent, type StealthReadout } from './stealth';

/**
 * The night watch in a district you've gone ashore in (plan 08 §5, §10; Phase 7): piece D's
 * guards and perception on the district's real navmesh, lamps and colliders, stepped with
 * the on-foot tick. The game's clock, moon, cloud, fog and rain light the scene; the
 * region's Wanted tier sizes the roster and Fame how fast a face is known.
 *
 * A capture is handed back once (`onCaptured`); the ashore mode takes you off your feet and
 * the jail (Phase 5) takes it from there. Everything else the guards do goes out as their
 * `StealthEvent`s, which piece E (crimes, reports) and piece I (barks) listen to.
 */

export interface WatchConditions {
  gameSeconds: number;
  cloud01: number;
  fogM: number;
  rain01: number;
  /** The region's Wanted tier now. */
  wantedTier: number;
  /** Plan 06's recognition: Fame's tier as 0 unknown … 1 legendary. */
  fame01: number;
}

export interface WatchOptions {
  model: DistrictModel;
  nav: NavQuery;
  /** Read each tick. */
  conditions(): WatchConditions;
  /** The tier the roster is drawn for (the region's when you landed). */
  tier: number;
  seed: string;
  defs?: NpcDefs;
  /**
   * Whether being seen now is suspicious. Defaults to `suspectAshore`, the placeholder
   * piece E's conduct replaces.
   */
  suspect?(c: SuspectContext): boolean;
  /** A guard laid hands on you: `by` is their npc type. */
  onCaptured(by: string, guard: string): void;
}

export interface Watch {
  readonly stealth: Stealth;
  readonly tier: number;
  /** A guard is chasing you (no autosave, the danger snapshot). */
  readonly pursued: boolean;
  /** A guard is searching for you. */
  readonly searched: boolean;
  step(dt: number, player: CharacterState): void;
  readout(): StealthReadout;
  on(fn: (e: StealthEvent) => void): () => void;
}

export function skyAt(gameSeconds: number, cloud01: number): SkyLight {
  const sun = sunAt(gameSeconds);
  const moon = moonAt(gameSeconds);
  return {
    sunElevationRad: sun.elevationRad,
    moonElevationRad: moon.elevationRad,
    moonIllumination01: moon.illumination01,
    cloud01,
  };
}

export function createWatch(opts: WatchOptions): Watch {
  const { model, nav } = opts;
  const defs = opts.defs ?? gameNpcs();
  const plan = planDistrictWatch(model, nav);
  const lamps = districtLamps(model);
  const lampSet = new LampSet(lamps);
  const stealth = createStealth(
    {
      zone: model,
      nav,
      lamps: lampSet,
      rng: Rng.fromSeed(`${opts.seed}:watch:${model.layout.id}`),
      ...(plan.lawPost ? { lawPost: plan.lawPost } : {}),
    },
    defs,
    rosterForTier(defs, plan.base, plan.spareBeats, opts.tier),
    opts.tier,
  );
  // Stand each guard on the floor at their start (a pier deck, not the lake bed under it).
  for (const g of stealth.guards) {
    const p = g.body.position;
    p.y = model.floorAt(p.x, p.z);
    g.previous.y = p.y;
  }
  const suspect = opts.suspect ?? suspectAshore;
  let told = false;
  stealth.on((e) => {
    if (e.type !== 'Captured' || told) return;
    told = true;
    opts.onCaptured(e.by, e.npc);
  });

  return {
    stealth,
    tier: opts.tier,
    get pursued() {
      return stealth.guards.some((g) => g.state === 'alerted' && g.type.pursues);
    },
    get searched() {
      return stealth.guards.some((g) => g.state === 'search');
    },
    step(dt, player) {
      const c = opts.conditions();
      const sky = skyAt(c.gameSeconds, c.cloud01);
      lightLamps(lamps, ambientLight01(sky, fogOnFoot01(c.fogM)));
      const p = player.position;
      const { hour } = dayAndHour(c.gameSeconds);
      stealth.step(dt, {
        player,
        playerParams: DEFAULT_CONTROLLER,
        surface: model.surfaceAt(p.x, p.z, p.y),
        sky,
        fogM: c.fogM,
        rain01: c.rain01,
        gameSeconds: c.gameSeconds,
        suspect: suspect({ model, player, hour }),
        fame01: c.fame01,
        wantedTier: c.wantedTier,
      });
    },
    readout: () => stealth.readout(),
    on: (fn) => stealth.on(fn),
  };
}
