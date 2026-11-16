import type { HideoutPieceInput } from '../../render/hideout/hideout-view';
import { CELL_M, LEVEL_M, PIECES, ROOF_RISE_M } from '../../render/hideout/pieces';

/**
 * Sample hideouts for the kit's dev page and `bench.hideout` (Phase 8 piece B): the
 * catalog (every piece in every material, in rows), and a walled compound of storehouses,
 * piers and yard pieces grown to any piece count, laid out with the grid conventions piece
 * A hands over (cells centered on their footprint, edges on the edge midpoint with rot =
 * the side they're on, roofs at the eave plus riseM).
 */

export type Layout = [string, HideoutPieceInput][];

/** Every piece in every material: one row per piece, a column per material. */
export function catalogLayout(): Layout {
  const out: Layout = [];
  const cols = 6;
  let row = 0;
  let col = 0;
  for (const def of PIECES) {
    const big = def.footprint[0] > 1 || def.footprint[1] > 1;
    for (const m of def.materials) {
      const x = col * 9;
      const z = row * 9;
      const base: HideoutPieceInput = { id: def.id, material: m, x, y: 0, z };
      if (def.extend) base.extendM = 0.8;
      if (def.placement === 'roof') base.y = 0.3;
      if (def.id === 'build.wall_gable' || def.id === 'build.wall_gable_peak') base.y = 0;
      out.push([`${def.id}:${m}`, base]);
      col++;
      if (col >= cols || big) {
        col = 0;
        row += big ? 2 : 1;
      }
    }
    if (col !== 0 && def.materials.length > 1) {
      col = 0;
      row++;
    }
  }
  return out;
}

interface House {
  x0: number;
  z0: number;
  w: number;
  d: number;
  levels: number;
  wall: string;
  roof: string;
  base: string;
}

let seed = 1;
function rand(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

/** A building on foundations: walls with doors and windows, a floor up, a gable roof. */
function house(h: House, out: Layout, tag: string, groundAt: (x: number, z: number) => number) {
  const k = (s: string): string => `${tag}:${s}`;
  const cx = (i: number): number => h.x0 + (i + 0.5) * CELL_M;
  const cz = (j: number): number => h.z0 + (j + 0.5) * CELL_M;
  const floorY = 0.6;
  for (let i = 0; i < h.w; i++)
    for (let j = 0; j < h.d; j++) {
      const x = cx(i);
      const z = cz(j);
      out.push([
        k(`f${i},${j}`),
        {
          id: 'build.foundation',
          material: h.base,
          x,
          y: floorY,
          z,
          extendM: Math.max(0, floorY - 0.6 - groundAt(x, z) + 0.2),
        },
      ]);
      for (let l = 1; l < h.levels; l++)
        out.push([
          k(`fl${l}:${i},${j}`),
          { id: 'build.floor', material: 'plank', x, y: floorY + l * LEVEL_M, z },
        ]);
    }
  // Walls round each level; the front (-z) has the door.
  const doorAt = Math.floor(h.w / 2);
  for (let l = 0; l < h.levels; l++) {
    const y = floorY + l * LEVEL_M;
    const edge = (name: string, x: number, z: number, rot: number, along: number) => {
      let id = 'build.wall';
      const r = rand();
      if (l === 0 && rot === 0 && along === doorAt) id = 'build.wall_door';
      else if (r < 0.35) id = 'build.wall_window';
      out.push([k(`${name}${l}`), { id, material: h.wall, x, y, z, rot }]);
      if (id === 'build.wall_door')
        out.push([
          k(`${name}${l}d`),
          { id: rand() < 0.5 ? 'build.door_plank' : 'build.door_iron', x, y, z, rot },
        ]);
      if (id === 'build.wall_window') {
        out.push([k(`${name}${l}w`), { id: 'build.window_glazed', x, y, z, rot }]);
        if (rand() < 0.4) out.push([k(`${name}${l}s`), { id: 'build.shutters', x, y, z, rot }]);
      }
    };
    for (let i = 0; i < h.w; i++) {
      edge(`n${i}:`, cx(i), h.z0, 0, i);
      edge(`s${i}:`, cx(i), h.z0 + h.d * CELL_M, 2, i);
    }
    for (let j = 0; j < h.d; j++) {
      edge(`w${j}:`, h.x0, cz(j), 3, j);
      edge(`e${j}:`, h.x0 + h.w * CELL_M, cz(j), 1, j);
    }
  }
  // A gable roof, ridge along x, and the gable ends.
  const eave = floorY + h.levels * LEVEL_M;
  for (let j = 0; j < h.d; j++) {
    const fromFront = j;
    const fromBack = h.d - 1 - j;
    const ridge = h.d % 2 === 1 && fromFront === fromBack;
    const front = fromFront < fromBack;
    const rise = ROOF_RISE_M * Math.min(fromFront, fromBack);
    for (let i = 0; i < h.w; i++) {
      out.push([
        k(`r${i},${j}`),
        {
          id: ridge ? 'build.roof_ridge' : 'build.roof_slope',
          material: h.roof,
          x: cx(i),
          y: eave,
          z: cz(j),
          rot: ridge || front ? 0 : 2,
          riseM: rise,
        },
      ]);
    }
    for (const [side, x] of [
      ['gw', h.x0],
      ['ge', h.x0 + h.w * CELL_M],
    ] as const) {
      out.push([
        k(`${side}${j}`),
        {
          id: ridge ? 'build.wall_gable_peak' : 'build.wall_gable',
          material: h.wall,
          x,
          y: eave,
          z: cz(j),
          rot: ridge ? (side === 'gw' ? 3 : 1) : front ? 1 : 3,
          riseM: rise,
        },
      ]);
    }
  }
  out.push([
    k('chimney'),
    {
      id: 'build.chimney',
      material: 'brownstone',
      x: cx(h.w - 1),
      y: eave,
      z: cz(0),
      riseM: 0,
    },
  ]);
  // Inside: what a storehouse and bunkhouse hold.
  const inside = [
    'build.bunk',
    'build.stove',
    'build.strongbox',
    'build.crate_stack',
    'build.shelving',
    'build.barrel_rack',
    'build.table',
    'build.chair',
    'build.lantern_wall',
    'build.workbench',
    'build.distillery',
    'build.cooperage',
    'build.smithy',
    'build.chest',
    'build.rug',
    'build.fireplace',
  ];
  let n = 0;
  for (let l = 0; l < h.levels; l++)
    for (let i = 0; i < h.w; i++)
      for (let j = 1; j < h.d; j++) {
        if ((i + j + l) % 2 === 1) continue;
        const id = inside[(n + Math.floor(rand() * inside.length)) % inside.length] as string;
        out.push([
          k(`p${l}:${i},${j}`),
          {
            id,
            x: cx(i),
            y: floorY + l * LEVEL_M + 0.02,
            z: cz(j),
            yawDeg: 90 * Math.floor(rand() * 4),
          },
        ]);
        n++;
      }
}

/**
 * A walled compound grown to `count` pieces: storehouses in rows, a pier with pilings, a
 * slipway, a palisade with a gate, lanterns, the well and the signal lantern.
 */
export function compoundLayout(count: number, groundAt = defaultGround): Layout {
  // Grow house by house; the houses go last so a cut-off count trims a house's insides,
  // never the pier or palisade.
  for (let houses = 1; houses < 64; houses++) {
    const all = compound(houses, groundAt);
    if (all.length >= count) return all.slice(0, count);
  }
  return compound(64, groundAt);
}

function compound(houses: number, groundAt: (x: number, z: number) => number): Layout {
  seed = 7;
  const homes: Layout = [];
  const out: Layout = [];
  const walls = ['plank', 'log', 'brownstone', 'tarpaper'];
  const roofs = ['shingle', 'plank', 'tarpaper', 'turf'];
  // The pier and slipway first, out over the water at -z.
  const pierX = 6;
  for (let j = 0; j < 10; j++) {
    const z = -3 - j * CELL_M;
    const id = j === 9 ? 'build.pier_t' : 'build.pier';
    out.push([
      `pier${j}`,
      { id, x: pierX, y: 1.2, z, rot: 0, extendM: Math.max(0.2, 1.2 - 0.35 - groundAt(pierX, z)) },
    ]);
    if (j % 3 === 2)
      out.push([`moor${j}`, { id: 'build.mooring_post', x: pierX + 0.7, y: 1.2, z: z + 0.6 }]);
  }
  for (const [k, x] of [
    ['pc0', pierX - CELL_M],
    ['pc1', pierX + CELL_M],
  ] as const) {
    const z = -3 - 9 * CELL_M;
    out.push([
      k,
      {
        id: 'build.pier_corner',
        x,
        y: 1.2,
        z,
        rot: k === 'pc0' ? 0 : 1,
        extendM: Math.max(0.2, 0.85 - groundAt(x, z)),
      },
    ]);
  }
  out.push([
    'pierLadder',
    { id: 'build.pier_ladder', x: pierX + 1, y: 1.2, z: -3 - 5 * CELL_M, rot: 1 },
  ]);
  out.push(['slipway', { id: 'build.slipway', x: -10, y: 1.0, z: -5, rot: 2 }]);
  for (let j = 0; j < 4; j++)
    out.push([
      `pile${j}`,
      {
        id: 'build.piling',
        x: -4,
        y: 0.9,
        z: -2 - j * 3,
        extendM: Math.max(0.5, 0.9 - groundAt(-4, -2 - j * 3)),
      },
    ]);

  // Storehouses in rows inland.
  let b = 0;
  const yard: Layout = [];
  const cols = 4;
  while (b < houses) {
    const bx = (b % cols) * 16 - 26;
    const bz = Math.floor(b / cols) * 18 + 6;
    const w = 3 + (b % 2);
    const d = 3 + ((b >> 1) % 2);
    house(
      {
        x0: bx,
        z0: bz,
        w,
        d,
        levels: b % 3 === 0 ? 1 : 2,
        wall: walls[b % 4] as string,
        roof: roofs[(b + 1) % 4] as string,
        base: b % 2 ? 'brownstone' : 'timber',
      },
      homes,
      `h${b}`,
      groundAt,
    );
    // Yard pieces in front of each house.
    const yx = bx + 1;
    const yz = bz - 2;
    yard.push([`y${b}:lamp`, { id: 'build.lantern', x: yx, y: 0, z: yz, yawDeg: 45 }]);
    yard.push([
      `y${b}:rain`,
      { id: 'build.rain_barrel', x: bx + w * CELL_M - 0.6, y: 0, z: bz - 0.6 },
    ]);
    yard.push([`y${b}:path0`, { id: 'build.path_stones', x: bx + 3, y: 0, z: bz - 1 }]);
    yard.push([`y${b}:path1`, { id: 'build.path_stones', x: bx + 3, y: 0, z: bz - 3 }]);
    if (b % 2 === 0)
      yard.push([`y${b}:nets`, { id: 'build.nets', x: bx + 6, y: 0, z: bz - 3, yawDeg: 15 }]);
    if (b % 3 === 1)
      yard.push([
        `y${b}:bay`,
        { id: 'build.warehouse_bay', x: bx + 11, y: 0, z: bz + 4, yawDeg: 270 },
      ]);
    if (b % 4 === 2)
      yard.push([`y${b}:anchor`, { id: 'build.anchor', x: bx - 1, y: 0, z: bz - 1.5 }]);
    b++;
  }
  out.push(...yard);
  out.push(['well', { id: 'build.well', x: -2, y: 0, z: 2 }]);
  out.push(['signal', { id: 'build.signal_lantern', x: 14, y: 0, z: 1 }]);
  out.push(['wheel', { id: 'build.ships_wheel', x: 4, y: 0, z: 1.5 }]);
  out.push(['figurehead', { id: 'build.figurehead', x: 9, y: 0, z: 1.5, yawDeg: 180 }]);
  // A palisade round the landward side, a gate on the shore, brush screens.
  const minX = -30;
  const maxX = 40;
  const maxZ = 6 + Math.ceil(b / cols) * 18;
  for (let x = minX; x < maxX; x += CELL_M) {
    out.push([`pal:s${x}`, { id: 'build.palisade', x: x + 1, y: 0, z: maxZ, rot: 2 }]);
    if (x === 0) out.push([`gate`, { id: 'build.gate', x: x + 1, y: 0, z: 3, rot: 0 }]);
    else if (x % 6 === 0)
      out.push([`brush${x}`, { id: 'build.brush_screen', x: x + 1, y: 0, z: 3, rot: 0 }]);
    else out.push([`rail${x}`, { id: 'build.rail_fence', x: x + 1, y: 0, z: 3, rot: 0 }]);
  }
  for (let z = 4; z < maxZ; z += CELL_M) {
    out.push([`pal:w${z}`, { id: 'build.palisade', x: minX, y: 0, z: z + 1, rot: 3 }]);
    out.push([`pal:e${z}`, { id: 'build.palisade', x: maxX, y: 0, z: z + 1, rot: 1 }]);
  }
  return [...out, ...homes];
}

/** A shore: the lake bed below z 0, rising to land behind. */
export function defaultGround(_x: number, z: number): number {
  return z < 0 ? Math.max(-4, z * 0.18) : Math.min(0.4, z * 0.04);
}
