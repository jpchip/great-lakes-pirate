import {
  CAVE_RULES,
  caveAt,
  rollCaveCache,
  sampleCave,
  underRoof,
  type PlacedCave,
} from '../sim/caves/caves';
import { COLD, iceUnderfoot } from '../sim/cold/footing';
import type { IceSample } from '../sim/ice/season';
import type { WorldState } from '../sim/world-state';
import type { GameEvents } from '../modes/context';
import type { EventBus } from '../core/events';

/**
 * The sea caves in play (plan 11 §5, §18.4 piece S): getting in, what's in them, and the
 * sea and the ice at their mouths.
 *
 * - **Rowing in** under a roof only in a calm: above `rowMaxHsM` at the mouth the swell
 *   breaking in it turns the boat back.
 * - **Swimming in** always, in water as cold as the lake's; but in a sea the surge throws
 *   you on the rock.
 * - **Walking in** at a cave mouth prefab's opening (Sand's swallow caves, Devils' first
 *   cave), and in winter, when the lake's ice at the mouth holds a walker, across the ice
 *   into an ice cave.
 * - **Caches** seeded among their spots, searched as an island's cairns are; a winter cache
 *   is in a crack over the water only the ice puts in reach.
 */

export interface CavesDeps {
  state: WorldState;
  events: EventBus<GameEvents>;
  caves(): readonly PlacedCave[];
  /** Significant wave height at a point, m. */
  hsAt(x: number, z: number): number;
  /** The lake's ice at a point, in winter (piece K); absent, never frozen. */
  iceAt?(x: number, z: number): IceSample;
  runSeed(): number;
  notice(text: string): void;
  /** A cave's wonder seen from inside, and a cache's find: piece O's journal. */
  wonder?(id: string): void;
  found?(cacheId: string, where: string, cents: number): void;
}

export interface CavePrompt {
  text: string;
  act(): void;
}

export interface Caves {
  /** The zone's caves, placed. */
  list(): readonly PlacedCave[];
  /** The cave a point is under the roof of, for something at height `y`. */
  inside(x: number, y: number, z: number): PlacedCave | undefined;
  /** The ice's top over this cave's water when it's an ice cave; undefined if not. */
  iceTop(cave: PlacedCave): number | undefined;
  /** The caves frozen now, by id (for the view's ice). */
  frozen(): ReadonlySet<string>;
  /**
   * Keeps the boat out of a cave's roofed water in a sea: the push back out at (x, z) for a
   * boat this wide, or undefined.
   */
  rowBlocked(
    x: number,
    z: number,
    r: number,
  ): { nx: number; nz: number; depth: number } | undefined;
  /** The water's depth for the boat in a cave's passage or channel; undefined outside them. */
  depthAt(x: number, z: number): number | undefined;
  /**
   * A cave's floor (or its ice) at (x, z) for someone at the water, as the boat sees it;
   * undefined outside the caves. Stepping out of the boat onto a cave's beach reads it.
   */
  floorAt(x: number, z: number): number | undefined;
  /** F on foot: search a cave cache's spot here. */
  prompt(at: { x: number; y: number; z: number }, swimming: boolean): CavePrompt | undefined;
  /**
   * Each tick ashore: where you are (feet, or the boat at the water) and how. Notes coming
   * in and going out, and the surge's harm to a swimmer (returned, health a second).
   */
  tick(
    at: { x: number; y: number; z: number },
    by: 'boat' | 'swimming' | 'foot' | undefined,
  ): number;
  /** The cave you're in now, if any. */
  readonly current: PlacedCave | undefined;
  /** For the dev hooks: these caves frozen whatever the lake says (undefined: the lake). */
  forceFrozen(ids: readonly string[] | undefined): void;
  /** For the dev hooks: a cache's spots, which holds it, and what's been searched. */
  cache(id: string):
    | {
        spots: { name: string; x: number; y: number; z: number }[];
        holds: number;
        cents: number;
        searched: number[];
        looted: boolean;
      }
    | undefined;
}

/** The boat's turned back this far before the roof, m. */
const ROW_TURN_M = 1.2;
/** The ice cave: the lake's ice at the mouth checked this often, s. */
const ICE_CHECK_S = 5;

export function attachCaves(deps: CavesDeps): Caves {
  const { state } = deps;
  let current: PlacedCave | undefined;
  let rowNoticeAt = -Infinity;
  let surgeNoticeAt = -Infinity;
  let clockS = 0;
  const frozenNow = new Set<string>();
  let iceCheckedAt = -Infinity;
  let forced: Set<string> | undefined;

  const refreshIce = (): void => {
    clockS = state.environment.clock.gameSeconds;
    if (clockS - iceCheckedAt < ICE_CHECK_S && iceCheckedAt > -Infinity) return;
    iceCheckedAt = clockS;
    frozenNow.clear();
    if (forced) {
      for (const id of forced) frozenNow.add(id);
      return;
    }
    if (!CAVE_RULES.iceCave || !deps.iceAt) return;
    for (const cave of deps.caves()) {
      if (!cave.sea) continue;
      if (iceUnderfoot(deps.iceAt(cave.sea.x, cave.sea.z))) frozenNow.add(cave.id);
    }
  };

  const iceTop = (cave: PlacedCave): number | undefined => {
    refreshIce();
    return frozenNow.has(cave.id) ? COLD.ice.topM : undefined;
  };

  const seaAt = (cave: PlacedCave): number =>
    cave.sea ? deps.hsAt(cave.sea.x, cave.sea.z) : deps.hsAt(cave.frame.x, cave.frame.z);

  const cacheState = (id: string): { searched: number[]; looted: boolean } => {
    const all = (state.caches ??= {});
    return (all[id] ??= { searched: [], looted: false });
  };

  const findCache = (id: string) => {
    for (const cave of deps.caves()) {
      const c = cave.caches.find((k) => k.def.id === id);
      if (c) return { cave, cache: c };
    }
    return undefined;
  };

  const search = (id: string, spot: number): void => {
    const hit = findCache(id);
    if (!hit) return;
    const s = cacheState(id);
    if (s.looted || s.searched.includes(spot)) return;
    s.searched.push(spot);
    const roll = rollCaveCache(hit.cache.def, deps.runSeed());
    if (roll.spot !== spot) {
      deps.notice('Nothing there but wet rock');
      return;
    }
    s.looted = true;
    state.player.purse += roll.cents;
    deps.found?.(id, hit.cave.name, roll.cents);
    deps.notice(hit.cache.def.found.replace('{cash}', `$${(roll.cents / 100).toFixed(2)}`));
  };

  return {
    list: () => deps.caves(),
    forceFrozen(ids) {
      forced = ids ? new Set(ids) : undefined;
      iceCheckedAt = -Infinity;
    },
    get current() {
      return current;
    },
    inside(x, y, z) {
      const s = caveAt(deps.caves(), x, z);
      return underRoof(s, y) ? s?.cave : undefined;
    },
    iceTop,
    frozen() {
      refreshIce();
      return frozenNow;
    },
    rowBlocked(x, z, r) {
      for (const cave of deps.caves()) {
        const s = sampleCave(cave, x, z, r + ROW_TURN_M);
        if (!s || s.roof === undefined) continue;
        if (seaAt(cave) <= CAVE_RULES.rowMaxHsM) return undefined;
        if (clockS - rowNoticeAt > 6) {
          rowNoticeAt = clockS;
          deps.notice('The swell is breaking in the mouth. Not in a boat, not today.');
        }
        // Back the way the passage came out: toward its open end.
        const open = cave.sea ?? { x: cave.frame.x, z: cave.frame.z };
        const dx = open.x - x;
        const dz = open.z - z;
        const d = Math.hypot(dx, dz) || 1;
        return { nx: dx / d, nz: dz / d, depth: 0.15 };
      }
      return undefined;
    },
    depthAt(x, z) {
      const s = caveAt(deps.caves(), x, z, 0.6);
      if (!s) return undefined;
      // An ice cave's water is ice: no boat goes in.
      if (s.floor < 0 && iceTop(s.cave) !== undefined) return -1;
      return -s.floor;
    },
    floorAt(x, z) {
      const s = caveAt(deps.caves(), x, z);
      if (!s) return undefined;
      const ice = s.floor < 0 ? iceTop(s.cave) : undefined;
      return ice !== undefined ? Math.max(ice, s.floor) : s.floor;
    },
    prompt(at, swimming) {
      if (swimming) return undefined;
      for (const cave of deps.caves()) {
        for (const cache of cave.caches) {
          const s = state.caches?.[cache.def.id];
          if (s?.looted) continue;
          // A winter cache is only reached standing on an ice cave's ice.
          if (cache.def.winter && iceTop(cave) === undefined) continue;
          for (let k = 0; k < cache.spots.length; k++) {
            const spot = cache.spots[k];
            if (!spot || s?.searched.includes(k)) continue;
            if (Math.hypot(at.x - spot.x, at.z - spot.z) > CAVE_RULES.reachM) continue;
            const floor = cache.def.winter ? (iceTop(cave) ?? spot.y) : spot.y;
            if (Math.abs(at.y - floor) > 1.6) continue;
            return { text: `Search ${spot.name}`, act: () => search(cache.def.id, k) };
          }
        }
      }
      return undefined;
    },
    tick(at, by) {
      clockS = state.environment.clock.gameSeconds;
      const next = by ? this.inside(at.x, at.y, at.z) : undefined;
      if (next !== current) {
        if (current) deps.events.emit('CaveLeft', { cave: current.id });
        current = next;
        if (current && by) {
          const ice = iceTop(current) !== undefined;
          deps.events.emit('CaveEntered', { cave: current.id, by, ice });
          const caves = (state.caves ??= { entered: {} });
          if (caves.entered[current.id] === undefined) {
            caves.entered[current.id] = clockS;
            deps.notice(ice ? `An ice cave. ${current.entered}` : current.entered);
            deps.wonder?.(current.wonder);
          }
        }
      }
      if (!current || by !== 'swimming') return 0;
      const hs = seaAt(current);
      if (hs <= CAVE_RULES.surgeHsM) return 0;
      if (clockS - surgeNoticeAt > 8) {
        surgeNoticeAt = clockS;
        deps.notice('The surge throws you against the rock!');
        deps.events.emit('CaveSurge', { cave: current.id });
      }
      return CAVE_RULES.surgeHurtPerS * (hs / CAVE_RULES.surgeHsM);
    },
    cache(id) {
      const hit = findCache(id);
      if (!hit) return undefined;
      const roll = rollCaveCache(hit.cache.def, deps.runSeed());
      const s = state.caches?.[id];
      return {
        spots: hit.cache.spots.map((p) => ({ ...p })),
        holds: roll.spot,
        cents: roll.cents,
        searched: [...(s?.searched ?? [])],
        looted: s?.looted ?? false,
      };
    },
  };
}
