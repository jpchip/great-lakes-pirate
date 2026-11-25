import * as THREE from 'three';
import { CELL_M, DOOR_HEIGHT_M, WALL_M } from '../../sim/district/kit';
import type {
  DistrictBuilding,
  DistrictDoor,
  DistrictModel,
} from '../../gameplay/district/district';
import { box, strut } from '../style/parts';
import { buildingStyle, idHash } from './styles';

/**
 * Signs on a district's buildings (0.7.2; dressed in the 0.9 district polish). Every
 * building with a door and a name (or a use) has a painted board over its door; shops,
 * the saloon and the law hang a blade sign off the wall; warehouses have their names
 * painted big on a blank wall, and a few blank walls on the front street carry a painted
 * advertisement. All of them are painted into one canvas atlas and drawn as one mesh,
 * lit by the district's lamps at night rather than glowing.
 */

/** What a building without a name is called, by its kind. */
const USE: Record<string, string> = {
  fishShed: 'Fish shed',
  iceHouse: 'Ice house',
  warehouse: 'Warehouse',
  packingHouse: 'Packing house',
  cooperage: 'Cooperage',
  saloon: 'Saloon',
  chandlery: 'Chandlery',
  store: 'General store',
  office: 'Harbor office',
  lockup: 'Lockup',
  shed: 'Shed',
};

/** The words on a building's board: its name, or else its use. Undefined for none. */
export function signLabel(b: { name?: string | undefined; kind: string }): string | undefined {
  return b.name ?? USE[b.kind];
}

/** The small line a sign painter added under a shop's name. */
const TRADE: Record<string, string> = {
  saloon: 'Wines · Liquors · Cigars',
  chandlery: 'Cordage · Canvas · Ship Stores',
  store: 'Dry Goods · Groceries · Hardware',
  cooperage: 'Fish Barrels · Kegs · Half Barrels',
  packingHouse: 'Fresh · Salt · Smoked Fish',
};

/** The word on a blade sign hung off the wall, by kind (or by name for the law). */
function bladeWord(b: DistrictBuilding): string | undefined {
  const name = b.def.name ?? '';
  if (/police/i.test(name) || b.def.kind === 'lockup') return 'POLICE';
  if (/boarding/i.test(name)) return 'ROOMS';
  if (/harbor master/i.test(name)) return 'HARBOR MASTER';
  switch (b.def.kind) {
    case 'saloon':
      return 'SALOON';
    case 'chandlery':
      return 'SHIP CHANDLER';
    case 'store':
      return /grocer/i.test(name) ? 'SHIP GROCER' : 'GROCERIES';
    default:
      return undefined;
  }
}

/** Painted advertisements for blank walls: invented local trades of the 1890s. */
const ADS: readonly (readonly [string, string])[] = [
  ['SUPERIOR LAGER', 'Brewed at the Head of the Lakes'],
  ['NORTH STAR TOBACCO', 'Fine Cut · Plug · Smoking'],
  ["DR. LINDQVIST'S LINIMENT", 'For Sailors & Lumbermen'],
  ['LAKE STEAMERS DAILY', 'Freight & Passengers · All Ports'],
  ['STOVES · TINWARE · NAILS', 'Lowest Prices on the Bay'],
  ['BIRCHWOOD ROLLED OATS', 'The Breakfast of the North'],
];

export interface SignPlacement {
  /** The board's middle, district meters. */
  x: number;
  y: number;
  z: number;
  /** Turns the board about the vertical so its face looks out. */
  rotY: number;
  widthM: number;
  heightM: number;
}

/**
 * How far the board stands off the wall's center line: past the wall's own half thickness
 * and the battens and trim on its face, so it isn't buried in the wall.
 */
export const SIGN_OFFSET_M = WALL_M / 2 + 0.06;

/** Where a building's board goes: over the first door, on the wall that door is set in. */
export function signPlacement(b: DistrictBuilding, door: DistrictDoor): SignPlacement {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const heightM = 0.7;
  if (b.def.roof === 'falseFront') {
    // A false front already has a dark board on the street (north) side, 0.9 m tall and
    // 0.12 m deep, its foot 1.2 m under the eaves (kit-meshes roofGeometry): paint on that.
    return {
      x: cx,
      y: b.eavesY - 1.2 + 0.1,
      z: b.minZ - 0.2 - 0.06 - 0.02,
      rotY: Math.PI,
      widthM: Math.min(b.maxX - b.minX - 1, 6) - 0.2,
      heightM,
    };
  }
  // Over the door's lintel, but no higher than just under the eaves.
  // On brick, under the corbelled course below the eaves (kit-meshes `dress`); never down
  // on the door's lintel.
  const brick = b.def.wall?.startsWith('kit.wall_brick') ?? false;
  const y = Math.min(
    Math.max(
      door.y + DOOR_HEIGHT_M + 0.17,
      Math.min(door.y + 2.7, b.eavesY - heightM - (brick ? 0.55 : 0.2)),
    ),
    b.eavesY - heightM - 0.05,
  );
  const wallLen = door.alongX ? b.maxX - b.minX : b.maxZ - b.minZ;
  const widthM = Math.min(wallLen - 0.6, Math.max(door.widthM + 2.4, 3.2));
  if (door.alongX) {
    // A north or south wall: the board faces out along z.
    const out = door.z >= cz ? 1 : -1;
    return {
      x: door.x,
      y,
      z: door.z + out * SIGN_OFFSET_M,
      rotY: out > 0 ? 0 : Math.PI,
      widthM,
      heightM,
    };
  }
  // An east or west wall: the board faces out along x.
  const out = door.x >= cx ? 1 : -1;
  return {
    x: door.x + out * SIGN_OFFSET_M,
    y,
    z: door.z,
    rotY: out > 0 ? Math.PI / 2 : -Math.PI / 2,
    widthM,
    heightM,
  };
}

// --- The look of a sign -------------------------------------------------------------------

export type SignKind = 'board' | 'blade' | 'painted' | 'ad';

interface Look {
  /** Background (none for letters painted straight on a wall). */
  bg: string | undefined;
  fg: string;
  /** Shadow or outline behind the letters. */
  shade: string | undefined;
  /** The border's color; undefined for none. */
  edge: string | undefined;
  /** Ends: square, notched, or rounded. */
  ends: 'square' | 'notched' | 'round';
}

const mix = (a: number, b: number, t: number): string =>
  `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

/** A board's colors by kind: a sign painter's usual pairs. */
function boardLook(b: DistrictBuilding): Look {
  switch (b.def.kind) {
    case 'saloon':
      return { bg: '#24382c', fg: '#e0bf62', shade: '#0f1a13', edge: '#e0bf62', ends: 'notched' };
    case 'chandlery':
      return { bg: '#1f2d45', fg: '#efe7d2', shade: '#0b1322', edge: '#c9a54a', ends: 'round' };
    case 'store':
      return { bg: '#6b2620', fg: '#f0e4c4', shade: '#2e0e0b', edge: '#f0e4c4', ends: 'square' };
    case 'office':
    case 'lockup':
      return { bg: '#1c1b1a', fg: '#d8b75a', shade: undefined, edge: '#d8b75a', ends: 'square' };
    default:
      return { bg: '#e6d8b2', fg: '#2a1d12', shade: undefined, edge: '#3a2a1a', ends: 'square' };
  }
}

export interface SignSpec {
  building: string;
  /** The door a board hangs over. */
  door?: string;
  kind: SignKind;
  lines: readonly string[];
  look: Look;
  placement: SignPlacement;
  /** A blade sign is two faces, back to back. */
  sides: 1 | 2;
}

/** The longest run of blank wall (no door or window) on each side of a building. */
function blankRuns(
  model: DistrictModel,
  b: DistrictBuilding,
): { side: number; from: number; to: number }[] {
  const runs: { side: number; from: number; to: number }[] = [];
  const near = (a: number, c: number): boolean => Math.abs(a - c) < 0.05;
  const mine = model.edges.filter((e) => e.building === b.def.id);
  for (let side = 0; side < 4; side++) {
    const alongX = side === 0 || side === 2;
    const line = side === 0 ? b.minZ : side === 1 ? b.maxX : side === 2 ? b.maxZ : b.minX;
    const lo = alongX ? b.minX : b.minZ;
    const hi = alongX ? b.maxX : b.maxZ;
    const cells: boolean[] = [];
    for (let t = lo + CELL_M / 2; t < hi; t += CELL_M) {
      const e = mine.find((k) =>
        alongX
          ? k.heading === 0 && near(k.z, line) && near(k.x, t)
          : k.heading !== 0 && near(k.x, line) && near(k.z, t),
      );
      cells.push(e !== undefined && e.piece.collider === 'wall');
    }
    let best: [number, number] = [0, 0];
    let start = -1;
    for (let k = 0; k <= cells.length; k++) {
      if (k < cells.length && cells[k]) {
        if (start < 0) start = k;
      } else if (start >= 0) {
        if (k - start > best[1] - best[0]) best = [start, k];
        start = -1;
      }
    }
    if (best[1] > best[0])
      runs.push({ side, from: lo + best[0] * CELL_M, to: lo + best[1] * CELL_M });
  }
  return runs.sort((a, c) => c.to - c.from - (a.to - a.from) || a.side - c.side);
}

/** A sign painted across a run of blank wall, facing out of that side. */
function wallPlacement(
  b: DistrictBuilding,
  run: { side: number; from: number; to: number },
  maxH: number,
): SignPlacement {
  const off = WALL_M / 2 + 0.09;
  const wallH = b.eavesY - b.floorY;
  const y0 = b.floorY + Math.max(1.0, wallH * 0.32);
  const heightM = Math.min(maxH, b.eavesY - 0.4 - y0);
  const widthM = run.to - run.from - 0.8;
  const t = (run.from + run.to) / 2;
  const y = y0;
  switch (run.side) {
    case 0:
      return { x: t, y, z: b.minZ - off, rotY: Math.PI, widthM, heightM };
    case 2:
      return { x: t, y, z: b.maxZ + off, rotY: 0, widthM, heightM };
    case 1:
      return { x: b.maxX + off, y, z: t, rotY: Math.PI / 2, widthM, heightM };
    default:
      return { x: b.minX - off, y, z: t, rotY: -Math.PI / 2, widthM, heightM };
  }
}

const WORKS = new Set(['warehouse', 'packingHouse', 'cooperage', 'iceHouse']);

/**
 * Every sign a district carries, and where: the data side of `buildingSigns`, so a test
 * can check it without a canvas.
 */
export function districtSigns(model: DistrictModel): SignSpec[] {
  const out: SignSpec[] = [];
  let ads = Math.floor(idHash(model.layout.id) * ADS.length);
  let adsLeft = 4;
  for (const b of model.buildings) {
    const label = signLabel(b.def);
    const door = model.doors.find((d) => d.building === b.def.id);
    if (!label || !door) continue;
    const style = buildingStyle(b);
    const trade = TRADE[b.def.kind];
    const runs = blankRuns(model, b);
    // A warehouse's name painted large on its longest blank wall.
    const big = WORKS.has(b.def.kind) ? runs.find((r) => r.to - r.from >= 8) : undefined;
    if (big) {
      const light = new THREE.Color(style.wall).getHSL({ h: 0, s: 0, l: 0 }).l > 0.5;
      const ink = light ? 0x2a2420 : 0xece3cc;
      out.push({
        building: b.def.id,
        kind: 'painted',
        lines: trade ? [label.toUpperCase(), trade] : [label.toUpperCase()],
        look: {
          bg: undefined,
          fg: mix(ink, style.wall, 0.12),
          shade: mix(style.wall, 0x000000, 0.35),
          edge: undefined,
          ends: 'square',
        },
        placement: wallPlacement(b, big, trade ? 1.9 : 1.5),
        sides: 1,
      });
    }
    const word = bladeWord(b);
    const board = big ? undefined : signPlacement(b, door);
    // A blade sign hangs past the end of the board over the door, never through it.
    const hang = word ? bladeSpot(b, door, board) : undefined;
    if (board) {
      if (hang?.shrink) {
        board.widthM -= hang.shrink;
        if (door.alongX) board.x -= (hang.side * hang.shrink) / 2;
        else board.z -= (hang.side * hang.shrink) / 2;
      }
      out.push({
        building: b.def.id,
        kind: 'board',
        door: door.id,
        lines: trade && b.def.roof === 'falseFront' ? [label, trade] : [label],
        look: boardLook(b),
        placement: board,
        sides: 1,
      });
    }
    if (word && hang) out.push(blade(b, door, word, hang.along));
    // An advertisement on a front-street building's blank side.
    if (!WORKS.has(b.def.kind) && b.def.kind !== 'house' && adsLeft > 0) {
      const run = runs.find((r) => r.to - r.from >= 7 && r.side !== 0);
      if (run) {
        const ad = ADS[ads++ % ADS.length] as readonly [string, string];
        adsLeft--;
        const wall = style.wall;
        out.push({
          building: b.def.id,
          kind: 'ad',
          lines: ad,
          look: {
            bg: mix(idHash(b.def.id) < 0.5 ? 0x6b2620 : 0x1f2d45, wall, 0.18),
            fg: mix(0xefe4c6, wall, 0.12),
            shade: undefined,
            edge: mix(0xefe4c6, wall, 0.2),
            ends: 'square',
          },
          placement: wallPlacement(b, run, 2.0),
          sides: 1,
        });
      }
    }
  }
  return out;
}

/** A blade sign hung off the wall beside the door (or off a false front's corner). */
/** Clear of the corner trim at a wall's end. */
const CORNER_M = 0.4;
/** From a board's end to the blade sign's arm. */
const BLADE_GAP_M = 0.35;

/**
 * Where along the door's wall a blade sign hangs (offset from the door), on whichever side
 * of the board has room. With no room either side, the board gives up `shrink` meters on
 * `side` so the sign fits past its end.
 */
export function bladeSpot(
  b: DistrictBuilding,
  door: DistrictDoor,
  board: SignPlacement | undefined,
): { along: number; side: number; shrink: number } {
  if (b.def.roof === 'falseFront') return { along: b.maxX - 0.25 - door.x, side: 1, shrink: 0 };
  const at = door.alongX ? door.x : door.z;
  const lo = (door.alongX ? b.minX : b.minZ) + CORNER_M;
  const hi = (door.alongX ? b.maxX : b.maxZ) - CORNER_M;
  const mid = board ? (door.alongX ? board.x : board.z) : at;
  const half = board ? board.widthM / 2 : door.widthM / 2 + 0.3;
  const right = mid + half + BLADE_GAP_M;
  const left = mid - half - BLADE_GAP_M;
  if (right <= hi && (hi - right >= left - lo || left < lo))
    return { along: right - at, side: 1, shrink: 0 };
  if (left >= lo) return { along: left - at, side: -1, shrink: 0 };
  // Neither end has room: cut the board back on the roomier side.
  const side = hi - (mid + half) >= lo - (mid - half) ? 1 : -1;
  const shrink = side > 0 ? right - hi : lo - left;
  return { along: (side > 0 ? hi : lo) - at, side, shrink };
}

function blade(b: DistrictBuilding, door: DistrictDoor, word: string, along: number): SignSpec {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const reach = 0.95;
  const widthM = word.length > 8 ? 1.5 : 1.1;
  const heightM = 0.62;
  const look = boardLook(b);
  const front = b.def.roof === 'falseFront';
  const y = front ? b.eavesY - 0.9 : Math.min(door.y + 2.55, b.eavesY - heightM - 0.1);
  if (door.alongX) {
    const out = door.z >= cz ? 1 : -1;
    return {
      building: b.def.id,
      kind: 'blade',
      lines: [word],
      look,
      placement: {
        x: door.x + along,
        y,
        z: door.z + out * (WALL_M / 2 + (front ? 0.26 : 0) + reach),
        rotY: Math.PI / 2,
        widthM,
        heightM,
      },
      sides: 2,
    };
  }
  const out = door.x >= cx ? 1 : -1;
  return {
    building: b.def.id,
    kind: 'blade',
    lines: [word],
    look,
    placement: {
      x: door.x + out * (WALL_M / 2 + reach),
      y,
      z: door.z + along,
      rotY: 0,
      widthM,
      heightM,
    },
    sides: 2,
  };
}

// --- Painting -------------------------------------------------------------------------------

const FONT = 'Georgia, "Times New Roman", serif';

/** Letters fitted to a width: condensed first, the way a sign painter would, then smaller. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  size: number,
  weight: string,
  spacing: number,
  fill: string,
  shade: string | undefined,
): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  const set = (px: number): void => {
    (ctx as { letterSpacing?: string }).letterSpacing = `${px}px`;
  };
  set(spacing * s);
  let w = ctx.measureText(text).width;
  while (w > maxW / 0.72 && s > 10) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
    set(spacing * s);
    w = ctx.measureText(text).width;
  }
  const sx = Math.min(1, maxW / Math.max(w, 1));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  if (shade) {
    ctx.fillStyle = shade;
    ctx.fillText(text, s * 0.05, s * 0.06);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
  set(0);
}

function boardPath(ctx: CanvasRenderingContext2D, w: number, h: number, ends: Look['ends']): void {
  const n = h * 0.22;
  ctx.beginPath();
  if (ends === 'notched') {
    ctx.moveTo(n, 0);
    ctx.lineTo(w - n, 0);
    ctx.lineTo(w, n);
    ctx.lineTo(w, h - n);
    ctx.lineTo(w - n, h);
    ctx.lineTo(n, h);
    ctx.lineTo(0, h - n);
    ctx.lineTo(0, n);
  } else if (ends === 'round') {
    const r = h * 0.3;
    ctx.roundRect(0, 0, w, h, r);
  } else ctx.rect(0, 0, w, h);
  ctx.closePath();
}

function anchor(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, c: string): void {
  ctx.save();
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = s * 0.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - s * 0.38, s * 0.1, 0, Math.PI * 2);
  ctx.moveTo(x, y - s * 0.28);
  ctx.lineTo(x, y + s * 0.4);
  ctx.moveTo(x - s * 0.22, y - s * 0.15);
  ctx.lineTo(x + s * 0.22, y - s * 0.15);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y + s * 0.05, s * 0.36, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.restore();
}

/** Paints one sign into its slot of the atlas (w × h px at x, y). */
function paint(
  ctx: CanvasRenderingContext2D,
  sign: SignSpec,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { look, lines } = sign;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (look.bg) {
    boardPath(ctx, w, h, look.ends);
    ctx.fillStyle = look.bg;
    ctx.fill();
    // Grain: a few faint streaks along the board.
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#000';
    for (let k = 1; k < 6; k++)
      ctx.fillRect(0, (k * h) / 6 + ((k * 7) % 5), w, Math.max(1, h * 0.015));
    ctx.globalAlpha = 1;
  }
  if (look.edge) {
    const inset = Math.max(4, h * 0.09);
    ctx.save();
    ctx.translate(inset, inset);
    boardPath(ctx, w - inset * 2, h - inset * 2, look.ends);
    ctx.restore();
    ctx.strokeStyle = look.edge;
    ctx.lineWidth = Math.max(2, h * 0.035);
    ctx.stroke();
  }
  const pad = look.bg ? h * 0.35 : h * 0.05;
  const [main = '', sub] = lines;
  const isBlade = sign.kind === 'blade';
  if (isBlade && /CHANDLER/.test(main)) {
    anchor(ctx, w / 2, h * 0.36, h * 0.42, look.fg);
    fitText(ctx, main, w / 2, h * 0.76, w - pad, h * 0.2, 'bold', 0.08, look.fg, look.shade);
  } else if (sub) {
    const big = sign.kind === 'painted' || sign.kind === 'ad' ? 0.5 : 0.46;
    fitText(ctx, main, w / 2, h * 0.38, w - pad * 2, h * big, 'bold', 0.06, look.fg, look.shade);
    if (sign.kind === 'board' || sign.kind === 'ad') {
      // A rule between the lines, with a diamond in its middle.
      ctx.fillStyle = look.fg;
      ctx.fillRect(w * 0.3, h * 0.66, w * 0.4, Math.max(1, h * 0.02));
      ctx.save();
      ctx.translate(w / 2, h * 0.67);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-h * 0.025, -h * 0.025, h * 0.05, h * 0.05);
      ctx.restore();
    }
    fitText(ctx, sub, w / 2, h * 0.8, w - pad * 2.5, h * 0.17, 'italic', 0.04, look.fg, undefined);
  } else {
    const size = sign.kind === 'painted' ? h * 0.78 : h * 0.56;
    fitText(ctx, main, w / 2, h * 0.53, w - pad * 2, size, 'bold', 0.05, look.fg, look.shade);
    if (look.bg && !isBlade && w / h > 4) {
      // Rosettes at the board's ends.
      ctx.fillStyle = look.edge ?? look.fg;
      for (const ex of [pad * 0.5, w - pad * 0.5]) {
        ctx.beginPath();
        ctx.arc(ex, h / 2, h * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

// --- The mesh -------------------------------------------------------------------------------

/** Pixels per meter of sign, before the atlas shrinks to fit. */
const PPM = 110;
const ATLAS_W = 2048;

export interface BuildingSigns {
  /** One mesh for every sign (`signs`), and the iron the blade signs hang from. */
  meshes: THREE.Mesh[];
  /** Iron brackets for the blade signs, in district meters, for the body mesh. */
  brackets: THREE.BufferGeometry[];
  /** The signs drawn, in order. */
  placed: SignSpec[];
  /**
   * Lights the boards for the hour: full by day, by moonlight and the nearest lit lamps
   * at night. `doused` are lamps put out (indexes into `model.lamps`).
   */
  light(night: number, doused: ReadonlySet<number>): void;
  dispose(): void;
}

/**
 * The signs for every building that has a door, as one mesh (`signs`) over a painted atlas.
 * `dispose` frees the texture and geometry.
 */
export function buildingSigns(model: DistrictModel): BuildingSigns {
  const placed = districtSigns(model);
  // Shelf-pack the slots, shrinking the scale until they fit a 2048² atlas.
  let ppm = PPM;
  let slots: { x: number; y: number; w: number; h: number }[] = [];
  let atlasH = 0;
  for (let tries = 0; tries < 6; tries++) {
    slots = [];
    let x = 0;
    let y = 0;
    let row = 0;
    for (const s of placed) {
      const w = Math.min(ATLAS_W, Math.max(32, Math.round(s.placement.widthM * ppm)));
      const h = Math.max(16, Math.round(s.placement.heightM * ppm));
      if (x + w > ATLAS_W) {
        x = 0;
        y += row + 2;
        row = 0;
      }
      slots.push({ x, y, w, h });
      x += w + 2;
      row = Math.max(row, h);
    }
    atlasH = y + row;
    if (atlasH <= 2048) break;
    ppm *= 0.8;
  }
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(atlasH, 16))));
  const ctx = canvas.getContext('2d');
  if (ctx)
    placed.forEach((s, k) => {
      const slot = slots[k];
      if (slot) paint(ctx, s, slot.x, slot.y, slot.w, slot.h);
    });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  // One quad (or two, back to back) per sign, with uvs into its slot.
  const positions: number[] = [];
  const uvs: number[] = [];
  const centers: THREE.Vector3[] = [];
  const firstVertex: number[] = [];
  const brackets: THREE.BufferGeometry[] = [];
  const corner = new THREE.Vector3();
  placed.forEach((s, k) => {
    const slot = slots[k];
    if (!slot) return;
    const p = s.placement;
    const u0 = slot.x / canvas.width;
    const u1 = (slot.x + slot.w) / canvas.width;
    const v0 = 1 - (slot.y + slot.h) / canvas.height;
    const v1 = 1 - slot.y / canvas.height;
    const center = new THREE.Vector3(p.x, p.y + p.heightM / 2, p.z);
    firstVertex.push(positions.length / 3);
    centers.push(center);
    for (let face = 0; face < s.sides; face++) {
      const rot = p.rotY + face * Math.PI;
      const e = new THREE.Euler(0, rot, 0);
      const quad = [
        [-1, -1, u0, v0],
        [1, -1, u1, v0],
        [1, 1, u1, v1],
        [-1, -1, u0, v0],
        [1, 1, u1, v1],
        [-1, 1, u0, v1],
      ] as const;
      for (const [qx, qy, u, v] of quad) {
        corner.set((qx * p.widthM) / 2, (qy * p.heightM) / 2, face === 0 ? 0 : 0).applyEuler(e);
        positions.push(center.x + corner.x, center.y + corner.y, center.z + corner.z);
        uvs.push(u, v);
      }
    }
    if (s.kind === 'blade') {
      // An iron arm from the wall over the board, and a stay under it.
      const dir = new THREE.Vector3(
        Math.sin(p.rotY + Math.PI / 2),
        0,
        Math.cos(p.rotY + Math.PI / 2),
      );
      const half = p.widthM / 2 + 0.15;
      const top = center.y + p.heightM / 2 + 0.08;
      const wall = new THREE.Vector3(p.x, top, p.z).addScaledVector(dir, -half);
      const tip = new THREE.Vector3(p.x, top, p.z).addScaledVector(dir, half - 0.1);
      // Which way is the wall? Toward the building's middle.
      const b = model.buildings.find((x) => x.def.id === s.building);
      if (b) {
        const toB = new THREE.Vector3((b.minX + b.maxX) / 2 - p.x, 0, (b.minZ + b.maxZ) / 2 - p.z);
        if (toB.dot(dir) < 0) {
          wall.addScaledVector(dir, 2 * half);
          tip.addScaledVector(dir, -2 * (half - 0.1));
        }
      }
      brackets.push(strut(wall, tip, 0.035, 0x2c2b2a));
      brackets.push(
        strut(wall.clone().setY(top - 0.55), tip.clone().lerp(wall, 0.45), 0.025, 0x2c2b2a),
      );
      for (const sx of [-0.35, 0.35]) {
        const at = new THREE.Vector3(p.x, 0, p.z).addScaledVector(dir, sx * p.widthM);
        brackets.push(box(0.025, 0.1, 0.025, at.x, top - 0.1, at.z, 0x2c2b2a));
      }
    }
  });
  firstVertex.push(positions.length / 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const colors = new Float32Array(positions.length).fill(1);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  geo.setAttribute('color', colorAttr);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    vertexColors: true,
    toneMapped: false,
    alphaTest: 0.35,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'signs';
  mesh.matrixAutoUpdate = false;

  // Light by the hour: what reaches each sign from the lamps, worked out once.
  const lampTint = model.lamps.map((l) => new THREE.Color(l.color).multiplyScalar(l.intensity));
  const reach = centers.map((c) =>
    model.lamps.map((l) => {
      const d = Math.hypot(l.x - c.x, l.y - c.y, l.z - c.z);
      const f = Math.max(0, 1 - d / (l.radiusM * 1.5));
      return f * f;
    }),
  );
  let lastKey = '';
  const tint = new THREE.Color();
  const light = (night: number, doused: ReadonlySet<number>): void => {
    const key = `${Math.round(night * 50)}:${[...doused].join(',')}`;
    if (key === lastKey) return;
    lastKey = key;
    const day = 1 - night;
    centers.forEach((_, k) => {
      tint.setRGB(0.17, 0.19, 0.25); // moonlight
      const r = reach[k] ?? [];
      r.forEach((f, j) => {
        if (f <= 0 || doused.has(j)) return;
        const lt = lampTint[j];
        if (!lt) return;
        tint.r += lt.r * f * 1.1;
        tint.g += lt.g * f * 1.1;
        tint.b += lt.b * f * 1.1;
      });
      const rr = Math.min(1.1, day * 0.95 + night * tint.r);
      const gg = Math.min(1.1, day * 0.95 + night * tint.g);
      const bb = Math.min(1.1, day * 0.95 + night * tint.b);
      for (let v = firstVertex[k] ?? 0; v < (firstVertex[k + 1] ?? 0); v++)
        colorAttr.setXYZ(v, rr, gg, bb);
    });
    colorAttr.needsUpdate = true;
  };
  light(0, new Set());

  return {
    meshes: [mesh],
    brackets,
    placed,
    light,
    dispose() {
      geo.dispose();
      tex.dispose();
      mat.dispose();
    },
  };
}
