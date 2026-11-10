import type { Transform } from '../../gameplay/ecs';
import { ColliderSet, type BoxCollider, type Collider } from '../../gameplay/onfoot/colliders';
import type { OnFootZone } from '../../gameplay/onfoot/controller';
import type { GuardSpawn, Route } from '../../gameplay/onfoot/guards';
import { Heightfield } from '../../gameplay/onfoot/heightfield';
import type { Lamp } from '../../gameplay/onfoot/light';
import { LampSet } from '../../gameplay/onfoot/light';
import { NavGrid, type XZ } from '../../gameplay/onfoot/nav';
import type { Surface } from '../../gameplay/onfoot/noise';

/**
 * A greybox docks district for piece D (plan 08 §20.4: "pure sim first, in the spike
 * greybox"): a waterfront street of plain boxes standing in for Bayfield until piece C's
 * kit and layout land. A walled warehouse yard with crates and a lamp over its gate, a
 * second warehouse, a street of lamps, a dark west wharf, and a pier with a moored ship.
 * A watchman walks the yard, another the west warehouse, a constable the street and a
 * sailor keeps the pier. No three.js, so the tests run on it too.
 *
 * Coordinates: x east, z south, meters. Land is z < 20 at 1.5 m; the lake is beyond.
 */

export interface GreyboxDistrict extends OnFootZone {
  spawn: Transform;
  lamps: LampSet;
  nav: NavGrid;
  guards: GuardSpawn[];
  /** Beats for the extra constables and marshals a higher Wanted tier brings. */
  spareBeats: Route[];
  /** Where a watchman runs for the law: the lockup's door. */
  lawPost: XZ;
  /** Out of bounds at night: being seen in here is suspicious (piece E: trespass). */
  restricted: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  /** What's underfoot at a point (piece C tags the kit's colliders). */
  surfaceAt(x: number, z: number, y: number): Surface;
  /** Every box, for the view. */
  boxes: BoxCollider[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const LAND_Y = 1.5;
const SHORE_Z = 20;

function box(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY: number,
  maxY: number,
): BoxCollider {
  return {
    kind: 'box',
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    halfX: (maxX - minX) / 2,
    halfZ: (maxZ - minZ) / 2,
    yaw: 0,
    minY,
    maxY,
  };
}

/** A building on the land: from the ground to its eaves. */
const building = (minX: number, maxX: number, minZ: number, maxZ: number, h = 6): BoxCollider =>
  box(minX, maxX, minZ, maxZ, LAND_Y - 0.5, LAND_Y + h);

/** A crate (0.9 m) or a stack (1.6 m). */
const crate = (x: number, z: number, size = 1.2, h = 0.9): BoxCollider =>
  box(x - size / 2, x + size / 2, z - size / 2, z + size / 2, LAND_Y - 0.1, LAND_Y + h);

const lamp = (x: number, z: number, radiusM = 9, intensity = 0.9, y = LAND_Y + 3.2): Lamp => ({
  x,
  y,
  z,
  radiusM,
  intensity,
  lit: true,
});

export function createGreyboxDistrict(): GreyboxDistrict {
  const bounds = { minX: -56, maxX: 56, minZ: -44, maxZ: 52 };
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  const nx = w + 1;
  const nz = d + 1;
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const z = bounds.minZ + j;
      // The wharf's face drops straight into the lake.
      heights[j * nx + i] = z <= SHORE_Z ? LAND_Y : z <= SHORE_Z + 2 ? -1 : -4;
    }
  }
  const ground = new Heightfield(nx, nz, 1, bounds.minX, bounds.minZ, heights);

  const boxes: BoxCollider[] = [];
  const add = (...b: BoxCollider[]): void => {
    boxes.push(...b);
  };

  // North side of the street: a row of buildings (saloon, chandlery, harbor master, lockup).
  add(
    building(-50, -34, -40, -24, 7),
    building(-30, -16, -40, -24, 6),
    building(-12, 4, -40, -24, 7),
    building(8, 22, -40, -24, 5),
    building(26, 50, -40, -24, 6),
  );
  // The west warehouse, its front to the wharf.
  add(building(-46, -22, -12, 6, 7));
  // The east warehouse and its walled yard (a gate on the west wall, a back gap to the wharf).
  add(building(2, 22, -14, -2, 7));
  const wallH = 2.4;
  add(
    box(0, 0.4, -2, 4.5, LAND_Y - 0.2, LAND_Y + wallH), // west wall north of the gate
    box(0, 0.4, 7.5, 14, LAND_Y - 0.2, LAND_Y + wallH), // west wall south of the gate
    box(0, 26, 13.6, 14, LAND_Y - 0.2, LAND_Y + wallH), // south wall
    box(25.6, 26, -2, 9, LAND_Y - 0.2, LAND_Y + wallH), // east wall (gap at its south end)
    box(22, 26, -2, -1.6, LAND_Y - 0.2, LAND_Y + wallH), // east return to the warehouse
  );
  // Crates in the yard: cover to work through.
  add(
    crate(5, 4),
    crate(6.3, 4),
    crate(5.6, 5.3, 1.2, 1.6),
    crate(12, 9),
    crate(13.2, 9),
    crate(12.6, 7.8, 1.2, 1.6),
    crate(19, 3.5),
    crate(19, 4.7),
    crate(20.5, 11, 1.4, 1.6),
    crate(8, 11.5),
  );
  // Crates and barrels on the wharf, and a shed on the dark west end.
  add(crate(-8, 16), crate(-6.8, 16), crate(-7.4, 17.2, 1.2, 1.6), crate(30, 15), crate(36, 17));
  add(building(-54, -44, 10, 18, 4));

  // The pier: a deck on pilings out into the lake, and a moored ship alongside.
  const pier = box(10, 14, SHORE_Z - 0.5, 46, -3, LAND_Y);
  add(pier);
  const hull = box(15, 20, 24, 44, -3, LAND_Y + 1.3);
  add(hull);

  const colliders = new ColliderSet();
  for (const b of boxes) colliders.add(b as Collider);

  const lamps = new LampSet([
    // Street lamps every 16 m, one out (the dark gap at x = 0).
    lamp(-44, -20),
    lamp(-28, -20),
    lamp(-12, -20),
    { ...lamp(4, -20), lit: false },
    lamp(20, -20),
    lamp(36, -20),
    // The yard gate's lamp and a lit window at the warehouse office.
    lamp(-1, 6, 8, 0.85, LAND_Y + 3),
    lamp(14, -1.5, 5, 0.55, LAND_Y + 2.2),
    // The pier head and the ship's riding light.
    lamp(12, 21, 8, 0.85),
    lamp(17.5, 34, 6, 0.6, LAND_Y + 5),
    // The east wharf; the west wharf is dark.
    lamp(34, 18, 8, 0.8),
  ]);

  const guards: GuardSpawn[] = [
    {
      id: 'watchman.yard',
      type: 'npc.watchman',
      name: 'Yard watchman',
      route: {
        loop: true,
        points: [
          { x: 3, z: 1, waitS: 3, face: Math.PI / 2 },
          { x: 23, z: 1, waitS: 2, face: Math.PI },
          { x: 23, z: 12, waitS: 3, face: -Math.PI / 2 },
          { x: 3, z: 12, waitS: 2, face: 0 },
        ],
      },
    },
    {
      id: 'watchman.west',
      type: 'npc.watchman',
      name: 'Warehouse watchman',
      route: {
        loop: false,
        points: [
          { x: -44, z: 9, waitS: 4, face: Math.PI / 2 },
          { x: -24, z: 9, waitS: 4, face: -Math.PI / 2 },
        ],
      },
      startAt: 1,
    },
    {
      id: 'constable.street',
      type: 'npc.constable',
      name: 'Constable',
      route: {
        loop: true,
        points: [
          { x: -40, z: -18, waitS: 2 },
          { x: 40, z: -18, waitS: 3 },
          { x: 40, z: 17, waitS: 2 },
          { x: 28, z: 17 },
          { x: 28, z: -18 },
        ],
      },
    },
    {
      id: 'sailor.pier',
      type: 'npc.sailor',
      name: 'Sailor on watch',
      route: {
        loop: false,
        points: [
          { x: 12.5, z: 30, waitS: 6, face: Math.PI },
          { x: 12.5, z: 40, waitS: 8, face: 0 },
        ],
      },
    },
  ];

  const spareBeats: Route[] = [
    {
      loop: false,
      points: [
        { x: -40, z: 17, waitS: 3 },
        { x: 26, z: 17, waitS: 3 },
      ],
    },
    {
      loop: true,
      points: [
        { x: -20, z: -18, waitS: 2 },
        { x: -20, z: 12, waitS: 2 },
        { x: -2, z: 12 },
        { x: -2, z: -18 },
      ],
    },
    {
      loop: false,
      points: [
        { x: 30, z: -18, waitS: 4 },
        { x: 30, z: 12, waitS: 4 },
      ],
    },
    {
      loop: true,
      points: [
        { x: 2, z: -20, waitS: 3, face: Math.PI },
        { x: 2, z: 16, waitS: 3, face: 0 },
      ],
    },
  ];

  const zone: OnFootZone = { ground, colliders, waterLevel: 0 };
  const nav = new NavGrid(zone, { ...bounds, cellM: 0.5 });

  return {
    ...zone,
    // Ashore at the pier head, as if just stepped off the boat.
    spawn: { position: { x: 12, y: LAND_Y, z: 26 }, heading: 0 },
    lamps,
    nav,
    guards,
    spareBeats,
    lawPost: { x: 15, z: -22 },
    restricted: [
      { minX: 0, maxX: 26, minZ: -2, maxZ: 14 },
      { minX: -46, maxX: -22, minZ: 6, maxZ: 12 },
      { minX: 14.5, maxX: 20.5, minZ: 23.5, maxZ: 44.5 },
    ],
    surfaceAt(x, z, y) {
      if (y > LAND_Y + 0.05 || (x >= 10 && x <= 14 && z > SHORE_Z - 0.5)) return 'wood';
      if (z > 14 && z <= SHORE_Z) return 'wood'; // the wharf's planking
      if (x > 0 && x < 26 && z > -2 && z < 14) return 'gravel'; // the yard
      return 'dirt';
    },
    boxes,
    bounds,
  };
}

/** Whether a point is in a restricted area. */
export function inRestricted(d: GreyboxDistrict, p: XZ): boolean {
  return d.restricted.some((r) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ);
}
