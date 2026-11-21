import { caveAt, underRoof, type CaveSample, type PlacedCave } from '../../sim/caves/caves';
import { Heightfield } from './heightfield';

/**
 * The floor runs on this far past the walls, under the rock: the walls stop you before it,
 * and a slope sampled at your feet beside a wall reads the floor, not the cliff over it.
 */
const WALL_MARGIN_M = 1.2;

/**
 * The walked ground with sea caves in it (plan 11 §5, §18.4 piece S). A heightfield has one
 * height a point, and a cave is ground under ground: the cliff top over it, its floor
 * below. So the ground here answers for whoever is asking, by their height (`ref`, set
 * before each step): under a cave's roof it's the cave's floor, and over it the cliff top
 * as before. Out of the caves, and in the open channel in from the lake, it's the cave's
 * floor or the terrain as each holds; everything else is the field it wraps.
 *
 * The walls and the roof are the cave's colliders (`caveSolids`); without them the cliff
 * the floor runs under would still stand round you, as the terrain's slope does.
 */
export class CaveGround extends Heightfield {
  /** The height asked about: feet, a boat's waterline, a camera. */
  ref = 0;

  constructor(
    readonly base: Heightfield,
    readonly caves: readonly PlacedCave[],
    /** The lake's ice lies over this cave's water (an ice cave), its top this high. */
    readonly iceTop: (cave: PlacedCave) => number | undefined = () => undefined,
  ) {
    super(base.samplesX, base.samplesZ, base.cellSize, base.originX, base.originZ, base.heights);
  }

  /** The cave floor under (x, z) for `ref`, or undefined where the field's own holds. */
  caveFloor(
    x: number,
    z: number,
    s: CaveSample | undefined = caveAt(this.caves, x, z, WALL_MARGIN_M),
  ): number | undefined {
    if (!s) return undefined;
    if (s.roof === undefined) {
      // The channel and a prefab's opening: the lake's bottom or the opening's floor, but
      // never over the cliff (a point of the channel's round end tucked under a ledge).
      if (this.ref > s.floor + 4) return undefined;
    } else if (!underRoof(s, this.ref)) {
      return undefined;
    }
    const ice = s.floor < 0 ? this.iceTop(s.cave) : undefined;
    return ice !== undefined ? Math.max(s.floor, ice) : s.floor;
  }

  override heightAt(x: number, z: number): number {
    return this.caveFloor(x, z) ?? super.heightAt(x, z);
  }

  override gradientAt(
    x: number,
    z: number,
    out: { x: number; z: number },
  ): { x: number; z: number } {
    if (caveAt(this.caves, x, z, WALL_MARGIN_M) === undefined) {
      return super.gradientAt(x, z, out);
    }
    const h = 0.25;
    out.x = (this.heightAt(x + h, z) - this.heightAt(x - h, z)) / (2 * h);
    out.z = (this.heightAt(x, z + h) - this.heightAt(x, z - h)) / (2 * h);
    return out;
  }
}

/** The ground a scene walks with caves in it, or the field as it was without any. */
export function withCaves(
  field: Heightfield,
  caves: readonly PlacedCave[] | undefined,
  iceTop?: (cave: PlacedCave) => number | undefined,
): Heightfield {
  if (!caves?.length) return field;
  return new CaveGround(field, caves, iceTop);
}
