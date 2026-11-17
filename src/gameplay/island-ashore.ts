import type { WorldState } from '../sim/world-state';
import type { GridField } from '../sim/terrain/grid-field';
import type { Hideouts } from './hideouts';
import { rollCache, type PlacedIsland, type PlacedPoiPiece } from '../sim/islands/on-foot';
import type { PlacedSolid, PlacedStation } from '../sim/light-stations';
import { bearingBox, type AshoreGround } from './onfoot/ashore-scene';
import type { Collider } from './onfoot/colliders';
import type { ControllerParams, Ladder } from './onfoot/controller';

/**
 * Walking a hero island (plan 08 §20.4 piece H; plan 11 §3): Stockton built whole on its
 * baked 1 m tiles, its quarry solid, its cache cairns to search, and the hideout's pieces
 * standing where they're built, its storage opened at them (Phase 8 piece C). Off the
 * island's tiles the ground is the zone's 4 m terrain, as every other landing's is.
 */

/** The island's scene: what `buildAshoreScene` takes for it. */
export interface IslandScene {
  island: string;
  ground: AshoreGround;
  box: { minX: number; minZ: number; maxX: number; maxZ: number };
  extra: Collider[];
  ladders: Ladder[];
  /** The lighthouse station this landing is at (plan 11 §18.4 piece H), if any. */
  station?: PlacedStation;
}

export interface IslandPrompt {
  text: string;
  act(): void;
}

export interface IslandAshoreDeps {
  state: WorldState;
  /** The zone's 4 m terrain height: what's drawn, and now what's walked too. */
  heightAt(x: number, z: number): number;
  /** The zone's 4 m terrain grid's origin and spacing, so the walked ground samples it the
   * way the mesh does. */
  grid(): { x0: number; z0: number; step: number } | undefined;
  /** The zone's walkable islands, placed. */
  islands(): readonly PlacedIsland[];
  /** An island's 1 m tiles, once loaded: just its extent now the ground is the 4 m terrain. */
  ground(id: string): GridField | undefined;
  /**
   * The run's hideouts on this zone (Phase 8 piece C): their built pieces are solid, and F
   * at a storage piece or the strongbox opens the hideout's storage.
   */
  hideouts?: Pick<Hideouts, 'prompt' | 'strongbox' | 'colliders'>;
  /**
   * Salvage from a site's ruins (Phase 8 piece F): the prompt at a pile, the rowboat's
   * prompt with a load in your arms, and the slower walk while you carry it.
   */
  salvage?: {
    prompt(at: { x: number; y: number; z: number }): IslandPrompt | undefined;
    boatPrompt(): IslandPrompt | undefined;
    params(base: ControllerParams): ControllerParams;
    readonly load: unknown;
  };
  /**
   * The lighthouse stations of this zone you can land at (piece H): each a walkable pad
   * round its light, before the rest of its island walks (pieces Q and R).
   */
  stations?(): readonly PlacedStation[];
  /** The run's seed for what's hidden where (the weather's noise seed). */
  runSeed(): number;
  notice(text: string): void;
  /** Cash found: the logbook line and the stats. */
  found?(cacheId: string, cents: number): void;
}

export interface IslandAshore {
  /** True when (x, z) is within a hero island's walkable tiles (plus landing pad). */
  walkableAt(at: { x: number; z: number }): boolean;
  /** The island scene for a landing here, or undefined off the walkable islands. */
  sceneFor(at: { x: number; z: number }): IslandScene | undefined;
  /** F on foot at (x, y, z): search a cairn, or open the stash at its strongbox. */
  prompt(at: { x: number; y: number; z: number }): IslandPrompt | undefined;
  /** At the rowboat with a load of salvage in your arms: put it in the hold (piece F). */
  boatPrompt(): IslandPrompt | undefined;
  /** The walker's params: slower with a load in your arms (piece F). */
  params(base: ControllerParams): ControllerParams;
  /** Arms full: no crouching. */
  carrying(): boolean;
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
/** A landing this close to a station's tower walks its pad (piece H). */
export const STATION_LAND_M = 450;
/** The pad round a station: this far each side of its tower. */
export const STATION_PAD_M = 520;
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
  // The logging camp's log decks, lumber piles and roofless bunkhouse walls (Phase 8).
  if (p.kind === 'logs' || p.kind === 'lumber' || p.kind === 'wall') {
    return [{ ...box, surface: 'wood', spot: height <= 1.6 ? 'vault' : 'climb' }];
  }
  if (p.kind === 'ledge') {
    // A ledge's `minY` sits 1 m under the lower of its top and the ground around it (so its
    // face never shows a gap underneath), which isn't its real rise: that's its top over
    // the ground it stands above.
    const rise = p.maxY - (p.minY + 1);
    return [{ ...box, spot: rise <= 1.6 ? 'vault' : 'climb' }];
  }
  return [box];
}

/** A station's solid as the controller's collider. */
export function stationColliders(s: PlacedSolid): Collider[] {
  if (s.shape === 'cyl') {
    return [
      {
        kind: 'cylinder',
        x: s.x,
        z: s.z,
        radius: s.w,
        minY: s.minY,
        maxY: s.maxY,
        surface: s.part === 'gallery' ? 'wood' : 'stone',
        ...(s.part === 'leg' ? { blocksSight: false } : {}),
      },
    ];
  }
  const b = bearingBox(s.x, s.z, s.bearing, s.w, s.d, s.minY, s.maxY, 'wood');
  if (s.part === 'rail') return [{ ...b, blocksSight: false }];
  return [b];
}

/** The station a landing here walks, if it's near one. */
export function stationNear(
  stations: readonly PlacedStation[],
  x: number,
  z: number,
): PlacedStation | undefined {
  let best: PlacedStation | undefined;
  let bestD = STATION_LAND_M;
  for (const s of stations) {
    const d = Math.hypot(x - s.light.x, z - s.light.z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
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

  const stationScene = (st: PlacedStation): IslandScene => {
    const grid = deps.grid();
    const extra: Collider[] = [];
    for (const s of st.solids) extra.push(...stationColliders(s));
    if (st.landing) extra.push(...stationColliders(st.landing));
    return {
      island: st.island,
      ground: {
        heightAt: deps.heightAt,
        x0: grid?.x0 ?? st.light.x - STATION_PAD_M,
        z0: grid?.z0 ?? st.light.z - STATION_PAD_M,
        step: grid?.step ?? 4,
      },
      box: {
        minX: st.light.x - STATION_PAD_M,
        minZ: st.light.z - STATION_PAD_M,
        maxX: st.light.x + STATION_PAD_M,
        maxZ: st.light.z + STATION_PAD_M,
      },
      extra,
      ladders: st.landingLadder ? [{ ...st.landingLadder }] : [],
      station: st,
    };
  };

  const sceneFor = (at: { x: number; z: number }): IslandScene | undefined => {
    const hit = islandAt(at.x, at.z);
    if (!hit) {
      const st = stationNear(deps.stations?.() ?? [], at.x, at.z);
      return st && stationScene(st);
    }
    const { island, field } = hit;
    const grid = deps.grid() ?? { x0: field.x0, z0: field.z0, step: field.step };
    const extra: Collider[] = [];
    for (const p of island.pieces) extra.push(...pieceColliders(p));
    if (deps.hideouts) extra.push(...deps.hideouts.colliders());
    return {
      island: island.id,
      // Walked ground is the zone's 4 m terrain everywhere now, the same heights the mesh,
      // the trees and the quarry's pieces are drawn and placed on (plan 08 §20.4 piece H
      // follow-up): no more a hand's width of mismatch between the 1 m tiles and the 4 m
      // mesh. The 1 m field still marks the island's walkable extent, above.
      ground: {
        heightAt: deps.heightAt,
        x0: grid.x0,
        z0: grid.z0,
        step: grid.step,
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
    return deps.salvage?.prompt(at) ?? deps.hideouts?.prompt(at);
  };

  return {
    walkableAt: (at) =>
      islandAt(at.x, at.z) !== undefined ||
      stationNear(deps.stations?.() ?? [], at.x, at.z) !== undefined,
    sceneFor,
    prompt,
    boatPrompt: () => deps.salvage?.boatPrompt(),
    params: (base) => deps.salvage?.params(base) ?? base,
    carrying: () => !!deps.salvage?.load,
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
      return deps.hideouts?.strongbox();
    },
  };
}
