import type { WorldState } from '../sim/world-state';
import type { GridField } from '../sim/terrain/grid-field';
import type { HarborLayout } from '../sim/harbors';
import { hideoutIdOf, SITES } from '../sim/hideouts/stash';
import { rollCache, type PlacedIsland, type PlacedPoiPiece } from '../sim/islands/on-foot';
import { bearingBox, type AshoreGround } from './onfoot/ashore-scene';
import type { Collider } from './onfoot/colliders';
import type { Ladder } from './onfoot/controller';

/**
 * Walking a hero island (plan 08 §20.4 piece H; plan 11 §3): Stockton built whole on its
 * baked 1 m tiles, its quarry solid, its cache cairns to search, and the stash's strongbox
 * opened where it stands. Off the island's tiles the ground is the zone's 4 m terrain, as
 * every other landing's is.
 */

/** The island's scene: what `buildAshoreScene` takes for it. */
export interface IslandScene {
  island: string;
  ground: AshoreGround;
  box: { minX: number; minZ: number; maxX: number; maxZ: number };
  extra: Collider[];
  ladders: Ladder[];
}

export interface IslandPrompt {
  text: string;
  act(): void;
}

export interface IslandAshoreDeps {
  state: WorldState;
  /** The zone's 4 m terrain height, for the ground around the tiles. */
  heightAt(x: number, z: number): number;
  /** The zone's walkable islands, placed. */
  islands(): readonly PlacedIsland[];
  /** An island's 1 m tiles, once loaded. */
  ground(id: string): GridField | undefined;
  harbors(): readonly HarborLayout[];
  /** The run's seed for what's hidden where (the weather's noise seed). */
  runSeed(): number;
  /** Opens a hideout's storage screen; false if it can't open now. */
  openStash(hideoutId: string): boolean;
  notice(text: string): void;
  /** Cash found: the logbook line and the stats. */
  found?(cacheId: string, cents: number): void;
}

export interface IslandAshore {
  /** The island scene for a landing here, or undefined off the walkable islands. */
  sceneFor(at: { x: number; z: number }): IslandScene | undefined;
  /** F on foot at (x, y, z): search a cairn, or open the stash at its strongbox. */
  prompt(at: { x: number; y: number; z: number }): IslandPrompt | undefined;
  /** For the dev hooks: a cache's cairns, which holds it, and what's been searched. */
  cache(id: string):
    | {
        spots: { name: string; x: number; y: number; z: number }[];
        holds: number;
        cents: number;
        searched: number[];
        looted: boolean;
      }
    | undefined;
  /** For the dev hooks: the stash strongbox you'd open on foot, zone meters. */
  strongbox(): { x: number; y: number; z: number; hideout: string } | undefined;
}

/** The island is built this far past its tiles, so its shore is never at the edge. */
export const ISLAND_PAD_M = 160;
/** A landing this far past the tiles still gets the island; further out, the stand-in. */
const LAND_PAD_M = 80;
/** Reach to a cairn or the strongbox. */
const REACH_M = 2.2;

/** A placed piece as solids for the controller. */
export function pieceColliders(p: PlacedPoiPiece): Collider[] {
  if (p.kind === 'derrick') {
    return [{ kind: 'cylinder', x: p.x, z: p.z, radius: 0.3, minY: p.minY, maxY: p.maxY }];
  }
  if (p.kind === 'cairn') {
    return [
      {
        kind: 'cylinder',
        x: p.x,
        z: p.z,
        radius: p.widthM / 2,
        minY: p.minY,
        maxY: p.maxY,
        surface: 'rock',
        spot: 'vault',
      },
    ];
  }
  const height = p.maxY - p.minY;
  const box = bearingBox(p.x, p.z, p.bearing, p.widthM, p.depthM, p.minY, p.maxY, 'stone');
  if (p.kind === 'shack') return [{ ...box, surface: 'wood' }];
  if (p.kind === 'block') return [{ ...box, spot: height <= 1.6 ? 'vault' : 'climb' }];
  return [box];
}

export function attachIslandAshore(deps: IslandAshoreDeps): IslandAshore {
  const { state } = deps;

  const islandAt = (
    x: number,
    z: number,
  ): { island: PlacedIsland; field: GridField } | undefined => {
    for (const island of deps.islands()) {
      const field = deps.ground(island.id);
      if (!field) continue;
      if (
        x > field.x0 - LAND_PAD_M &&
        x < field.maxX + LAND_PAD_M &&
        z > field.z0 - LAND_PAD_M &&
        z < field.maxZ + LAND_PAD_M
      ) {
        return { island, field };
      }
    }
    return undefined;
  };

  const sceneFor = (at: { x: number; z: number }): IslandScene | undefined => {
    const hit = islandAt(at.x, at.z);
    if (!hit) return undefined;
    const { island, field } = hit;
    const onTiles = (x: number, z: number): boolean =>
      x >= field.x0 && x <= field.maxX && z >= field.z0 && z <= field.maxZ;
    const extra: Collider[] = [];
    for (const p of island.pieces) extra.push(...pieceColliders(p));
    return {
      island: island.id,
      ground: {
        heightAt: (x, z) => (onTiles(x, z) ? field.sample(x, z) : deps.heightAt(x, z)),
        x0: field.x0,
        z0: field.z0,
        step: field.step,
      },
      box: {
        minX: field.x0 - ISLAND_PAD_M,
        minZ: field.z0 - ISLAND_PAD_M,
        maxX: field.maxX + ISLAND_PAD_M,
        maxZ: field.maxZ + ISLAND_PAD_M,
      },
      extra,
      ladders: island.ladders.map((l) => ({ ...l })),
    };
  };

  const cacheState = (id: string): { searched: number[]; looted: boolean } => {
    const all = (state.caches ??= {});
    return (all[id] ??= { searched: [], looted: false });
  };

  const findCache = (id: string) => {
    for (const island of deps.islands()) {
      const c = island.caches.find((k) => k.def.id === id);
      if (c) return c;
    }
    return undefined;
  };

  const search = (id: string, spot: number): void => {
    const cache = findCache(id);
    if (!cache) return;
    const s = cacheState(id);
    if (s.looted || s.searched.includes(spot)) return;
    s.searched.push(spot);
    const roll = rollCache(cache.def, deps.runSeed());
    if (roll.spot !== spot) {
      deps.notice('Only stones under the stones');
      return;
    }
    s.looted = true;
    state.player.purse += roll.cents;
    deps.found?.(id, roll.cents);
    deps.notice(cache.def.found.replace('{cash}', `$${(roll.cents / 100).toFixed(2)}`));
  };

  /** The stash strongboxes standing in the zone, with their hideouts. */
  const strongboxes = (): { x: number; y: number; z: number; hideout: string }[] => {
    const out: { x: number; y: number; z: number; hideout: string }[] = [];
    for (const layout of deps.harbors()) {
      const site = SITES.find((s) => s.setPiece === layout.def.setPiece);
      if (!site) continue;
      const hideout = hideoutIdOf(site.id);
      for (const b of layout.buildings) {
        if (b.kind === 'strongbox') out.push({ x: b.x, y: b.floorM, z: b.z, hideout });
      }
    }
    return out;
  };

  const prompt = (at: { x: number; y: number; z: number }): IslandPrompt | undefined => {
    for (const island of deps.islands()) {
      for (const cache of island.caches) {
        const s = state.caches?.[cache.def.id];
        if (s?.looted) continue;
        for (let k = 0; k < cache.spots.length; k++) {
          const spot = cache.spots[k];
          if (!spot || s?.searched.includes(k)) continue;
          if (Math.hypot(at.x - spot.x, at.z - spot.z) > REACH_M) continue;
          if (Math.abs(at.y - spot.y) > 1.6) continue;
          return { text: `Search ${spot.name}`, act: () => search(cache.def.id, k) };
        }
      }
    }
    for (const box of strongboxes()) {
      if (!state.hideouts?.[box.hideout]) continue;
      if (Math.hypot(at.x - box.x, at.z - box.z) > REACH_M) continue;
      if (Math.abs(at.y - box.y) > 1.6) continue;
      return {
        text: 'Open the stash',
        act: () => {
          if (!deps.openStash(box.hideout)) deps.notice('Not now');
        },
      };
    }
    return undefined;
  };

  return {
    sceneFor,
    prompt,
    cache(id) {
      const cache = findCache(id);
      if (!cache) return undefined;
      const roll = rollCache(cache.def, deps.runSeed());
      const s = state.caches?.[id];
      return {
        spots: cache.spots.map((p) => ({ ...p })),
        holds: roll.spot,
        cents: roll.cents,
        searched: [...(s?.searched ?? [])],
        looted: s?.looted ?? false,
      };
    },
    strongbox() {
      const box = strongboxes().find((b) => !!state.hideouts?.[b.hideout]);
      return box && { ...box };
    },
  };
}
