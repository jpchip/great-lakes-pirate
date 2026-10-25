/**
 * The runtime view of the zone's baked wind maps (plan 02 §11, plan 03 §14.2): shelter,
 * fetch and funneling for any spot and wind direction. The terrain loader (piece B)
 * provides the real one from the S3 bake; until then the weather runs on the stubs here.
 *
 * Positions are zone meters (x east, z south). `fromRad` is where the wind comes from,
 * radians clockwise from north, and implementations blend the two nearest of the 16
 * baked directions.
 */
export interface ShelterField {
  /** The area the maps cover, zone meters. Outside it, values clamp to the edge. */
  readonly bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** 0 = full wind, 1 = fully blocked by land upwind. */
  shelterAt(x: number, z: number, fromRad: number): number;
  /** Open water upwind, real meters (the bake keeps fetch in real geography). */
  fetchAt(x: number, z: number, fromRad: number): number;
  /** Channel funneling strength, 0–1 (0 = none). windAt maps it to a speed factor. */
  funnelAt(x: number, z: number, fromRad: number): number;
}

/** Fetch for open water with no map: a long reach of lake, real meters. */
export const OPEN_FETCH_M = 60_000;

/** No land anywhere: full wind and a long fetch from every direction. */
export const OPEN_WATER: ShelterField = {
  bounds: { minX: -1, minZ: -1, maxX: 1, maxZ: 1 },
  shelterAt: () => 0,
  fetchAt: () => OPEN_FETCH_M,
  funnelAt: () => 0,
};

export interface StubIsland {
  /** Center, zone meters. */
  x: number;
  z: number;
  /** Shoreline radius, meters. */
  radius: number;
  /** Summit height, meters. */
  height: number;
}

/** The lee runs about 15× the obstacle height downwind (plan 02 §11, S3 bakes 15×). */
export const LEE_HEIGHTS = 15;

/**
 * A stand-in shelter field for round islands, so the lee works before the real bake is
 * loaded. The lee is strongest right behind the shore, fades to nothing LEE_HEIGHTS
 * heights downwind, and is as wide as the island with soft edges. Fetch from that side
 * stops at the island's shore.
 */
export function stubIslandShelter(
  islands: readonly StubIsland[],
  halfExtentM = 3000,
  openFetchM = OPEN_FETCH_M,
): ShelterField {
  const behind = (x: number, z: number, fromRad: number, i: StubIsland) => {
    // Unit vector pointing upwind (toward where the wind comes from); north is -z.
    const ux = Math.sin(fromRad);
    const uz = -Math.cos(fromRad);
    const rx = i.x - x;
    const rz = i.z - z;
    const along = rx * ux + rz * uz;
    const across = Math.abs(rx * uz - rz * ux);
    return { along, across, inside: Math.hypot(rx, rz) < i.radius };
  };
  return {
    bounds: { minX: -halfExtentM, minZ: -halfExtentM, maxX: halfExtentM, maxZ: halfExtentM },
    shelterAt(x, z, fromRad) {
      let shelter = 0;
      for (const island of islands) {
        const { along, across, inside } = behind(x, z, fromRad, island);
        if (inside) return 1;
        if (along <= 0) continue;
        const lee = LEE_HEIGHTS * island.height;
        const downwind = Math.max(0, 1 - (along - island.radius) / lee);
        const width = 1 - smoothstep(island.radius * 0.6, island.radius * 1.4, across);
        shelter = Math.max(shelter, Math.min(1, downwind * 1.1) * width);
      }
      return shelter;
    },
    fetchAt(x, z, fromRad) {
      let fetch = openFetchM;
      for (const island of islands) {
        const { along, across, inside } = behind(x, z, fromRad, island);
        if (inside) return 0;
        if (along > 0 && across < island.radius) {
          const shore = along - Math.sqrt(island.radius ** 2 - across ** 2);
          fetch = Math.min(fetch, Math.max(shore, 0));
        }
      }
      return fetch;
    },
    funnelAt: () => 0,
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The stand-in island off the test scene's start, until the Apostles slice loads: big
 * enough that its lee reaches a kilometer downwind in a northwest or northeast wind.
 */
export const TEST_BAY_ISLANDS: readonly StubIsland[] = [
  { x: 700, z: -350, radius: 220, height: 55 },
];
