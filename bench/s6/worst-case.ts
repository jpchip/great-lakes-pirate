import { Rng } from '../../src/core/rng';
import { createWorldState } from '../../src/sim/world-state';

/**
 * Spike S6 (plan 01 §11.2): a worst-case WorldState, built deterministically from a
 * seed. Sizes follow plan 16 §5.4 and plan 09 §10, rounded up: 7 hideouts × 1,500
 * pieces, 200 abstract ships, a market per port and good, and generous logbook,
 * newspaper and ice slices. Slice shapes are guesses until their owner plans land;
 * what matters here is the volume and the mix of numbers and strings.
 */

export const HIDEOUTS = 7;
export const PIECES_PER_HIDEOUT = 1_500;
export const SHIPS = 200;
export const PORTS = 16;
export const GOODS = 30;
export const PRICE_HISTORY_WEEKS = 52;
export const ZONES = 6;
export const ICE_GRID = 64;
export const LOGBOOK_ENTRIES = 1_200;
export const NEWSPAPER_EDITIONS = 40;

/**
 * How hideout pieces are written:
 * - `objects`: one JSON object per piece, with named fields and string ids.
 * - `packed`: a per-hideout palette of piece ids plus one flat number array, 7 numbers
 *   per piece (palette index, x, z, level, rotation, variant, paint).
 */
export type PieceEncoding = 'objects' | 'packed';

export const PIECE_FIELDS = 7;

const PIECE_KINDS = [
  'foundation_stone',
  'floor_plank',
  'wall_plank',
  'wall_log',
  'half_wall_plank',
  'door_plank',
  'window_small',
  'fence_rail',
  'railing',
  'roof_gable',
  'roof_hip',
  'roof_flat_tarpaper',
  'stairs_plank',
  'pier_section',
  'piling',
  'mooring_post',
  'storage_rack',
  'strongbox',
  'workbench',
  'still',
  'lantern',
  'crate_stack',
  'barrel',
  'bunk',
];

const WORDS =
  'fog rolled in off the point and the light at raspberry was dark again so we stood off until dawn then ran the channel with whiskey under the nets and a revenue cutter hull down to the east'.split(
    ' ',
  );

function sentence(rng: Rng, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(WORDS[rng.int(0, WORDS.length - 1)] as string);
  return out.join(' ');
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function buildHideout(rng: Rng, index: number, encoding: PieceEncoding) {
  const pieceIds = PIECE_KINDS.map((k) => `piece.${k}`);
  const base = {
    id: `hideout.site_${index}`,
    name: `Hideout ${index}`,
    concealment: rng.int(0, 100),
    storage: Object.fromEntries(
      Array.from({ length: 12 }, (_, g) => [`good.g${g}`, rng.int(0, 400)]),
    ),
    cashCents: rng.int(0, 5_000_000),
  };
  if (encoding === 'packed') {
    const pieces: number[] = [];
    for (let p = 0; p < PIECES_PER_HIDEOUT; p++) {
      pieces.push(
        rng.int(0, pieceIds.length - 1),
        rng.int(0, 47),
        rng.int(0, 47),
        rng.int(0, 2),
        rng.int(0, 3),
        rng.int(0, 3),
        rng.int(0, 11),
      );
    }
    return { ...base, palette: pieceIds, pieces };
  }
  return {
    ...base,
    pieces: Array.from({ length: PIECES_PER_HIDEOUT }, () => ({
      type: pieceIds[rng.int(0, pieceIds.length - 1)] as string,
      x: rng.int(0, 47),
      z: rng.int(0, 47),
      level: rng.int(0, 2),
      rot: rng.int(0, 3),
      variant: rng.int(0, 3),
      paint: rng.int(0, 11),
    })),
  };
}

export interface MarketEntry {
  port: string;
  good: string;
  priceCents: number;
  stock: number;
  demand: number;
  heat: number;
  history: number[];
}

export interface AbstractShip {
  id: string;
  name: string;
  company: string;
  kind: string;
  from: string;
  to: string;
  progress: number;
  speedKn: number;
  lat: number;
  lon: number;
  cargo: { good: string; qty: number }[];
  crew: number;
  hull: number;
  alert: number;
}

export function portId(i: number): string {
  return `port.p${i}`;
}

export function buildWorstCaseState(seed = 's6-worst-case', encoding: PieceEncoding = 'packed') {
  const rng = Rng.fromSeed(seed);
  const state = createWorldState(seed);
  state.environment.clock.gameSeconds = 40 * 86_400;

  const markets: MarketEntry[] = [];
  for (let p = 0; p < PORTS; p++) {
    for (let g = 0; g < GOODS; g++) {
      const price = rng.int(200, 6000);
      markets.push({
        port: portId(p),
        good: `good.g${g}`,
        priceCents: price,
        stock: rng.int(0, 2000),
        demand: round(rng.range(0.5, 1.5), 3),
        heat: round(rng.range(0, 1), 3),
        history: Array.from({ length: PRICE_HISTORY_WEEKS }, () =>
          Math.round(price * rng.range(0.7, 1.3)),
        ),
      });
    }
  }

  const traffic: AbstractShip[] = Array.from({ length: SHIPS }, (_, i) => ({
    id: `ship.s${i}`,
    name: `${sentence(rng, 1)} ${sentence(rng, 1)}`,
    company: `company.c${rng.int(0, 9)}`,
    kind: ['schooner', 'steamer', 'tug', 'freighter', 'fish_tug'][rng.int(0, 4)] as string,
    from: portId(rng.int(0, PORTS - 1)),
    to: portId(rng.int(0, PORTS - 1)),
    progress: round(rng.next(), 4),
    speedKn: round(rng.range(5, 12), 2),
    lat: round(rng.range(46.5, 47.2), 5),
    lon: round(rng.range(-92.2, -90.4), 5),
    cargo: Array.from({ length: rng.int(1, 4) }, () => ({
      good: `good.g${rng.int(0, GOODS - 1)}`,
      qty: rng.int(10, 500),
    })),
    crew: rng.int(3, 24),
    hull: round(rng.next(), 3),
    alert: round(rng.next(), 3),
  }));

  const ice = Array.from({ length: ZONES }, (_, z) => ({
    zone: `zone.z${z}`,
    // Coverage 0–100 and thickness in cm as integers; real ice is mostly zeros or
    // smooth fields, but random values are the compression worst case.
    coverage: Array.from({ length: ICE_GRID * ICE_GRID }, () => rng.int(0, 100)),
    thicknessCm: Array.from({ length: ICE_GRID * ICE_GRID }, () => rng.int(0, 60)),
  }));

  return {
    ...state,
    player: {
      ...state.player,
      purseCents: 1_234_567,
      ship: { id: 'ship.player', hull: 0.82, upgrades: Array.from({ length: 20 }, (_, i) => i) },
      cargo: Array.from({ length: 20 }, (_, g) => ({ good: `good.g${g}`, qty: rng.int(0, 200) })),
      blueprints: Array.from({ length: 30 }, (_, b) => ({
        id: `blueprint.b${b}`,
        pieces: Array.from({ length: 40 * PIECE_FIELDS }, () => rng.int(0, 47)),
      })),
    },
    environment: {
      ...state.environment,
      systems: Array.from({ length: 6 }, () => ({
        lat: rng.range(45, 49),
        lon: rng.range(-93, -84),
        pressureHpa: rng.range(980, 1030),
        vLat: rng.range(-0.1, 0.1),
        vLon: rng.range(-0.1, 0.1),
      })),
      fogBanks: Array.from({ length: 12 }, () => ({
        lat: rng.range(46.5, 47.2),
        lon: rng.range(-92.2, -90.4),
        radiusM: rng.int(500, 8000),
        density: rng.next(),
      })),
      ice,
    },
    hideouts: Array.from({ length: HIDEOUTS }, (_, i) => buildHideout(rng, i, encoding)),
    markets,
    traffic,
    knowledge: Array.from({ length: 400 }, () => ({
      port: portId(rng.int(0, PORTS - 1)),
      good: `good.g${rng.int(0, GOODS - 1)}`,
      priceCents: rng.int(200, 6000),
      seenAtGameSeconds: rng.int(0, 40 * 86_400),
    })),
    wanted: Object.fromEntries(
      Array.from({ length: 8 }, (_, r) => [
        `region.r${r}`,
        { heat: round(rng.range(0, 100), 2), witnesses: rng.int(0, 30) },
      ]),
    ),
    fame: { value: round(rng.range(0, 1000), 2), deeds: rng.int(0, 300) },
    reports: Array.from({ length: 150 }, (_, i) => ({
      id: `report.r${i}`,
      region: `region.r${rng.int(0, 7)}`,
      crime: ['smuggling', 'theft', 'assault', 'piracy'][rng.int(0, 3)] as string,
      confidence: round(rng.next(), 3),
      atGameSeconds: rng.int(0, 40 * 86_400),
    })),
    logbook: Array.from({ length: LOGBOOK_ENTRIES }, (_, i) => ({
      atGameSeconds: i * 2_880,
      kind: ['auto', 'note'][rng.int(0, 1)] as string,
      text: sentence(rng, rng.int(8, 30)),
    })),
    newspapers: Array.from({ length: NEWSPAPER_EDITIONS }, (_, i) => ({
      edition: i,
      paper: ['news.duluth', 'news.ashland', 'news.bayfield'][i % 3] as string,
      headlines: Array.from({ length: 6 }, () => sentence(rng, rng.int(6, 14))),
      body: sentence(rng, 120),
    })),
    stats: Object.fromEntries(
      Array.from({ length: 80 }, (_, i) => [`stat.s${i}`, rng.int(0, 1e6)]),
    ),
  };
}

export type WorstCaseState = ReturnType<typeof buildWorstCaseState>;
