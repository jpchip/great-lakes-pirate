import type { CargoStack } from '../sim/economy/hold';
import { COLD } from '../sim/cold/footing';
import type { IceRoad, XZ } from '../sim/cold/road';
import type { IceSample } from '../sim/ice/season';
import type { AshoreGround } from './onfoot/ashore-scene';
import type { Heightfield } from './onfoot/heightfield';

/**
 * Winter on foot in the game (plan 11 §18.4 piece M): what the ashore mode asks of the
 * world about the ice, the cold and the ice road, and the scene's ice surface.
 */
export interface AshoreWinter {
  /** The run's seed, for the ice's weak spots. */
  seed: string;
  /** The lake's ice at a zone point now (piece K). */
  iceAt(x: number, z: number): IceSample;
  /** The air where you are now: temperature, wind and rain or snow falling. */
  air(): { airC: number; windKn: number; precip01: number };
  /** Snow lies on the ground now. */
  snow(): boolean;
  /**
   * The Bayfield–La Pointe ice road in this zone: its lane on the ice, and the pier heads
   * at its two ends (zone meters, the decks' height), if the zone has it.
   */
  road(): (IceRoad & { fromHead: XZ & { y: number }; toHead: XZ & { y: number } }) | undefined;
  /**
   * The road's marked and open now: the channel ice is thick enough all the way across
   * (`cold.json` `road.openCm`). The same answer the papers and the harbor card give.
   */
  roadOpen(): boolean;
  /** The pier the road starts from (Bayfield's city dock). */
  roadPier: string;
  /** The port at its far end, whose trading post buys a sled's load. */
  roadPort: string;
  /** A good's weight factor and its value a CU, cents. */
  weightOf(good: string): number;
  valueOf(good: string): number;
  /** The ship's hold, to load the sled from and unload into (then `holdChanged`). */
  hold(): CargoStack[];
  holdChanged(): void;
  /** Sells a sled's load at a port's market: what's left unsold, and a line saying how it went. */
  sell(port: string, load: CargoStack[]): { left: CargoStack[]; line: string };
}

/** Ice cells are looked up this coarsely while a scene is built (the ice is 125 m cells). */
const ICE_CELL_M = 8;

/**
 * The scene's ground with the ice laid over its water: where the lake's ice is there to
 * stand on, the water's surface is the ice's top. Whether it holds you is the mode's to say.
 */
export function iceGround(base: AshoreGround, winter: AshoreWinter): AshoreGround {
  const cache = new Map<number, boolean>();
  const top = COLD.ice.topM;
  const iced = (x: number, z: number): boolean => {
    const i = Math.floor(x / ICE_CELL_M);
    const j = Math.floor(z / ICE_CELL_M);
    const key = i * 100_003 + j;
    let v = cache.get(key);
    if (v === undefined) {
      const s = winter.iceAt((i + 0.5) * ICE_CELL_M, (j + 0.5) * ICE_CELL_M);
      v =
        s.kind !== 'open' &&
        s.kind !== 'floes' &&
        s.coverage >= COLD.ice.minCoverage &&
        s.thicknessCm >= COLD.ice.formsCm;
      cache.set(key, v);
    }
    return v;
  };
  return {
    x0: base.x0,
    z0: base.z0,
    step: base.step,
    heightAt(x, z) {
      const h = base.heightAt(x, z);
      return h < top && iced(x, z) ? top : h;
    },
  };
}

/** How far a hole's water reaches on a ground grid of `cellM`, m: never less than a cell. */
export function holeReach(r: number, cellM: number): number {
  return Math.max(r, cellM) + cellM * 0.5;
}

/**
 * Opens a hole in the ice: the heightfield's samples within `holeReach` of (x, z) go down
 * to deep water, so you swim there (the grid can be coarser than the hole).
 */
export function punchHole(field: Heightfield, x: number, z: number, r: number): void {
  const s = field.cellSize;
  const reach = holeReach(r, s);
  const i0 = Math.floor((x - reach - field.originX) / s);
  const i1 = Math.ceil((x + reach - field.originX) / s);
  const j0 = Math.floor((z - reach - field.originZ) / s);
  const j1 = Math.ceil((z + reach - field.originZ) / s);
  for (let j = Math.max(0, j0); j <= Math.min(field.samplesZ - 1, j1); j++) {
    for (let i = Math.max(0, i0); i <= Math.min(field.samplesX - 1, i1); i++) {
      const px = field.originX + i * s;
      const pz = field.originZ + j * s;
      if (Math.hypot(px - x, pz - z) > reach) continue;
      const k = j * field.samplesX + i;
      field.heights[k] = Math.min(field.heights[k] ?? 0, HOLE_DEPTH_M);
    }
  }
}

/** The water in a hole, m below the lake: deep enough to swim anywhere over it. */
const HOLE_DEPTH_M = -4;
