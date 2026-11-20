import type { WorldState } from '../sim/world-state';
import type { GridField } from '../sim/terrain/grid-field';
import type { Hideouts } from './hideouts';
import {
  caveMouthBlocks,
  landDistanceM,
  pieceToZone,
  rollCache,
  signalFeet,
  type PlacedIsland,
  type PlacedPoiPiece,
} from '../sim/islands/on-foot';
import type { HarborLayout, PlacedBuilding } from '../sim/harbors';
import type { PlacedSolid, PlacedStation } from '../sim/light-stations';
import { bearingBox, type AshoreGround } from './onfoot/ashore-scene';
import type { BoxCollider, Collider } from './onfoot/colliders';
import type { ControllerParams, Ladder } from './onfoot/controller';
import type { PlacedCave } from '../sim/caves/caves';

/**
 * Walking a hero island (plan 08 §20.4 piece H; plan 11 §3): Stockton built whole on its
 * baked 1 m tiles, its quarry solid, its cache cairns to search, and the hideout's pieces
 * standing where they're built, its storage opened at them (Phase 8 piece C). Off the
 * island's tiles the ground is the zone's 4 m terrain, as every other landing's is.
 *
 * Phase 9 piece Q: the hero islands walked whole the same way, a lighthouse station's pad
 * part of its island (the keepers' station with the rest of it round it), the island's
 * residents in its scene for the watch to put on their rounds, which island a landing is on
 * told by its own land where the baked boxes overlap, and La Pointe's trading post on foot.
 * Piece R: the standard and minor islands walk the same way (Michigan's and Long Island's
 * stations inside their islands; Rocky and South Twin, Gull and Michigan told apart).
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
  /** The island walked, with its residents (piece Q); absent on a station's pad alone. */
  placed?: PlacedIsland;
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
  /** The zone's harbors: a village's buildings, for its trading post (piece Q). */
  harbors?(): readonly HarborLayout[];
  /** Opens a port's market at a counter on foot (La Pointe's trading post); the refusal. */
  trade?(port: string, title: string): string | undefined;
  /**
   * The zone's sea caves (Phase 9 piece S): a mainland cave has a pad of its own round its
   * mouth, as a light station does, so a boat can land you at it.
   */
  caves?(): readonly PlacedCave[];
  /** Legends' pads on the mainland (piece T): the Dark Light's, on Minnesota Point. */
  pads?(): readonly { id: string; x: number; z: number }[];
  /** A seeded cache stocked this run (piece T); undefined: every cache is. */
  stocked?(cacheId: string): boolean;
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
/** A landing this close to a mainland cave's mouth walks its pad (piece S). */
export const CAVE_LAND_M = 300;
/** The pad round a mainland cave: this far each side of its frame. */
export const CAVE_PAD_M = 360;
/** Reach to a cairn or the strongbox. */
const REACH_M = 2.2;
/** From this far off a building's front you're at its counter (the trading post). */
const COUNTER_M = 3.2;

/** Within reach of a harbor building's front door (its -z side faces `facing`). */
export function atFrontDoor(b: PlacedBuilding, x: number, z: number, reachM = COUNTER_M): boolean {
  const fx = Math.sin(b.facing);
  const fz = -Math.cos(b.facing);
  const dx = x - b.x;
  const dz = z - b.z;
  const out = dx * fx + dz * fz;
  const across = Math.abs(dx * -fz + dz * fx);
  return out > b.depthM / 2 - 0.5 && out < b.depthM / 2 + reachM && across < b.widthM / 2;
}

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
  if (p.kind === 'ledge' || p.kind === 'dock') {
    // A ledge's `minY` sits 1 m under the lower of its top and the ground around it (so its
    // face never shows a gap underneath), which isn't its real rise: that's its top over
    // the ground it stands above. A dock is the same, in timber.
    const rise = p.maxY - (p.minY + 1);
    const surface = p.kind === 'dock' ? ('wood' as const) : ('stone' as const);
    return [{ ...box, surface, spot: rise <= 1.6 ? 'vault' : 'climb' }];
  }
  return kitColliders(p, box, height);
}

const lowSpot = (height: number): 'vault' | 'climb' | undefined =>
  height <= 1.6 ? 'vault' : height <= 3.2 ? 'climb' : undefined;

/** Phase 9 piece P's kit pieces as solids: the same shapes the renderer draws. */
function kitColliders(p: PlacedPoiPiece, box: BoxCollider, height: number): Collider[] {
  switch (p.kind) {
    case 'field':
    case 'planks':
    case 'dig':
      // Walked over.
      return [];
    case 'shanty':
    case 'fish_house':
    case 'cabin':
    case 'barn':
      return [{ ...box, surface: 'wood' }];
    case 'net_reel':
    case 'barrels':
    case 'boat':
    case 'woodpile':
    case 'spar': {
      const spot = lowSpot(height);
      return [{ ...box, surface: 'wood', ...(spot ? { spot } : {}) }];
    }
    case 'drying_rack':
    case 'hide_rack':
    case 'ribs':
      return [{ ...box, surface: 'wood', blocksSight: false }];
    case 'fence':
      return [{ ...box, surface: 'wood', blocksSight: false, spot: 'vault' }];
    case 'stumps':
      return (p.posts ?? []).map((s) => ({
        kind: 'cylinder' as const,
        x: s.x,
        z: s.z,
        radius: s.r,
        minY: s.y - 0.3,
        maxY: s.y + 0.5,
        surface: 'wood' as const,
        spot: 'vault' as const,
      }));
    case 'blaze':
      return [{ kind: 'cylinder', x: p.x, z: p.z, radius: 0.12, minY: p.minY, maxY: p.maxY }];
    case 'boulder': {
      const spot = lowSpot(height);
      return [
        {
          kind: 'cylinder',
          x: p.x,
          z: p.z,
          radius: Math.min(p.widthM, p.depthM) / 2,
          minY: p.minY,
          maxY: p.maxY,
          surface: 'rock',
          ...(spot ? { spot } : {}),
        },
      ];
    }
    case 'signal':
      return signalFeet(p.widthM).map((f) => {
        const at = pieceToZone(p, f.right, f.out);
        return {
          kind: 'cylinder' as const,
          x: at.x,
          z: at.z,
          radius: 0.25,
          minY: p.minY,
          maxY: p.maxY,
          blocksSight: false,
        };
      });
    case 'cave_mouth':
      return caveMouthBlocks(p)
        .filter((b) => !b.dark)
        .map((b) => {
          const at = pieceToZone(p, b.right, b.out);
          return bearingBox(at.x, at.z, p.bearing, b.w, b.d, p.minY + b.y0, p.minY + b.y1, 'stone');
        });
    default:
      return [box];
  }
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

  /**
   * The island a point is on or off: within its tiles' box (and a pad), and where boxes
   * overlap (Basswood's inside Madeline's), the one whose own land is nearest (piece Q).
   */
  const islandAt = (
    x: number,
    z: number,
  ): { island: PlacedIsland; field: GridField } | undefined => {
    let best: { island: PlacedIsland; field: GridField } | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const island of deps.islands()) {
      const field = deps.ground(island.id);
      if (!field) continue;
      if (
        x > field.x0 - LAND_PAD_M &&
        x < field.maxX + LAND_PAD_M &&
        z > field.z0 - LAND_PAD_M &&
        z < field.maxZ + LAND_PAD_M
      ) {
        // Without its land worked out, the box is the island, as before.
        const d = island.land ? landDistanceM(island.land, x, z) : 0;
        if (d > ISLAND_PAD_M || d >= bestD) continue;
        bestD = d;
        best = { island, field };
      }
    }
    return best;
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

  /** A mainland cave whose pad a landing here walks (piece S). */
  const mainlandCaveNear = (x: number, z: number): PlacedCave | undefined =>
    (deps.caves?.() ?? []).find(
      (c) => !c.island && Math.hypot(c.frame.x - x, c.frame.z - z) < CAVE_LAND_M,
    );

  /** A legend's pad on the mainland whose ground a landing here walks (piece T). */
  const legendPadNear = (x: number, z: number) =>
    (deps.pads?.() ?? []).find((p) => Math.hypot(p.x - x, p.z - z) < CAVE_LAND_M);

  /**
   * The zone's own ground round a point on the mainland (a cave's mouth, a legend's pad),
   * with whatever pieces stand on it.
   */
  const padScene = (id: string, x: number, z: number): IslandScene => {
    const grid = deps.grid();
    const extra: Collider[] = [];
    const placed = deps.islands().find((i) => i.id === id);
    for (const p of placed?.pieces ?? []) extra.push(...pieceColliders(p));
    return {
      island: id,
      ground: {
        heightAt: deps.heightAt,
        x0: grid?.x0 ?? x - CAVE_PAD_M,
        z0: grid?.z0 ?? z - CAVE_PAD_M,
        step: grid?.step ?? 4,
      },
      box: {
        minX: x - CAVE_PAD_M,
        minZ: z - CAVE_PAD_M,
        maxX: x + CAVE_PAD_M,
        maxZ: z + CAVE_PAD_M,
      },
      extra,
      ladders: [],
      ...(placed ? { placed } : {}),
    };
  };

  const sceneFor = (at: { x: number; z: number }): IslandScene | undefined => {
    const hit = islandAt(at.x, at.z);
    if (!hit) {
      const st = stationNear(deps.stations?.() ?? [], at.x, at.z);
      if (st) return stationScene(st);
      const cave = mainlandCaveNear(at.x, at.z);
      if (cave) return padScene(cave.id, cave.frame.x, cave.frame.z);
      const pad = legendPadNear(at.x, at.z);
      return pad && padScene(pad.id, pad.x, pad.z);
    }
    const { island, field } = hit;
    const grid = deps.grid() ?? { x0: field.x0, z0: field.z0, step: field.step };
    const extra: Collider[] = [];
    for (const p of island.pieces) extra.push(...pieceColliders(p));
    if (deps.hideouts) extra.push(...deps.hideouts.colliders());
    // A light station on the island stands in its scene as on its own pad (piece Q): the
    // nearest one to where you land is the one whose keepers are about.
    const ladders: Ladder[] = island.ladders.map((l) => ({ ...l }));
    const stations = (deps.stations?.() ?? []).filter((st) => st.island === island.id);
    for (const st of stations) {
      for (const s of st.solids) extra.push(...stationColliders(s));
      if (st.landing) extra.push(...stationColliders(st.landing));
      if (st.landingLadder) ladders.push({ ...st.landingLadder });
    }
    const station = stations
      .map((st) => ({ st, d: Math.hypot(st.light.x - at.x, st.light.z - at.z) }))
      .sort((a, b) => a.d - b.d)[0]?.st;
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
      ladders,
      ...(station ? { station } : {}),
      placed: island,
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
    // A seeded cache not stocked this run is stones all the way down (piece T).
    if (roll.spot !== spot || (cache.seeded && deps.stocked?.(id) === false)) {
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
    return deps.salvage?.prompt(at) ?? deps.hideouts?.prompt(at) ?? tradingPost(at);
  };

  /** At a village's trading post counter (La Pointe's general store): its market (piece Q). */
  const tradingPost = (at: { x: number; z: number }): IslandPrompt | undefined => {
    if (!deps.trade || !deps.harbors) return undefined;
    for (const island of deps.islands()) {
      const v = island.village;
      if (!v) continue;
      const layout = deps.harbors().find((l) => l.def.id === v.harbor);
      const b = layout?.buildings.find((k) => k.name === v.tradingPost);
      if (!b || !atFrontDoor(b, at.x, at.z)) continue;
      const trade = deps.trade;
      return {
        text: 'Trade at the trading post',
        act: () => {
          const refused = trade(v.port, `The ${layout?.def.name ?? ''} trading post`);
          if (refused) deps.notice(refused);
        },
      };
    }
    return undefined;
  };

  return {
    walkableAt: (at) =>
      islandAt(at.x, at.z) !== undefined ||
      stationNear(deps.stations?.() ?? [], at.x, at.z) !== undefined ||
      mainlandCaveNear(at.x, at.z) !== undefined ||
      legendPadNear(at.x, at.z) !== undefined,
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
