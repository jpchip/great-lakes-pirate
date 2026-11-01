import * as THREE from 'three';
import { hullShapeParams, type HullLines } from './hull-lines';
import type { SchoonerLines } from './schooner-lines';
import { TriangleSoup } from './soup';

/**
 * The parametric hull (plan 14 §5): a grid of stations from the transom (t = 0) to the
 * stem (t = 1) and levels from the keel to the sheer, shaped by the class's lines. The
 * stem rakes forward and the transom aft as the levels rise, the entrance is finer low
 * down, and the paint bands sit at fixed heights, so the waterline reads straight. The
 * same generator builds the NPC hulls (npc-ship.ts) from their own lines: a parallel
 * midbody and a box section make a laker out of it.
 */

const STATIONS = 26;
const RAIL_WIDTH = 0.14;
/** Thinnest half-width, at the keel, the stem and the sternpost. */
const KEEL_HALF = 0.09;

export interface HullShape {
  /** Rail top above the waterline at `z`. */
  sheerAt(z: number): number;
  deckAt(z: number): number;
  /** Half-breadth at the rail top at `z` (0 forward of the stem head or aft of the taffrail). */
  railHalfBreadthAt(z: number): number;
  /** The stem head, where the bowsprit leaves the hull. */
  readonly stemHead: THREE.Vector3;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

export function hullShape(l: HullLines): HullShape {
  const half = l.length / 2;
  const tAt = (z: number): number => clamp01((half - z) / l.length);
  const sheer = (t: number): number => sheerAt(l, t);
  return {
    sheerAt: (z) => sheer(tAt(z)),
    deckAt: (z) => sheer(tAt(z)) - l.bulwark,
    railHalfBreadthAt: (z) => (z < -half || z > half ? 0 : halfBreadth(l, tAt(z), 1)),
    stemHead: new THREE.Vector3(0, sheer(1), -half),
  };
}

/** Keel depth (negative) at t: a little drag aft, the forefoot rounding up at the bow. */
function keelAt(l: HullLines, t: number): number {
  const start = hullShapeParams(l).forefootStart;
  const drag = 1.06 - 0.12 * t;
  const forefoot = t > start ? 1 - smooth((t - start) / (1 - start)) * 0.75 : 1;
  return -l.draft * drag * forefoot;
}

/** Half-breadth at station t and level v (0 keel … 1 sheer). */
function halfBreadth(l: HullLines, t: number, v: number): number {
  const p = hullShapeParams(l);
  const section = Math.sin((Math.min(v, 1) * Math.PI) / 2) ** p.sectionPower;
  const full = (l.beam / 2) * section;
  let plan: number;
  if (t < p.runEnd) {
    // The run: the transom is narrow low down and wide at the rail.
    const transom = (l.transomWidth * clamp01((v - 0.3) / 0.7) ** 0.65) / Math.max(section, 1e-3);
    plan = transom + (1 - transom) * Math.sin(((t / p.runEnd) * Math.PI) / 2);
  } else if (t < p.entranceStart) {
    // Parallel midbody (lakers).
    plan = 1;
  } else {
    // The entrance: hollower near the keel than at the rail.
    const k = (t - p.entranceStart) / (1 - p.entranceStart);
    plan = Math.max(0, Math.cos((k * Math.PI) / 2)) ** (0.75 + 0.55 * (1 - v));
  }
  return Math.max(full * plan, KEEL_HALF);
}

/** Bow and stern ends of a level: the stem rakes forward, the transom aft, going up. */
function zAt(l: HullLines, t: number, v: number): number {
  const half = l.length / 2;
  const stern = half - l.transomRake * (1 - v);
  const bow = -half + l.stemRake * (1 - v) ** 1.7;
  return stern + (bow - stern) * t;
}

function sheerAt(l: HullLines, t: number): number {
  return (
    l.freeboard +
    l.sheerBow * Math.max(0, (t - 0.45) / 0.55) ** 2 +
    l.sheerStern * Math.max(0, (0.45 - t) / 0.45) ** 2
  );
}

/** Builds the hull, bulwarks, rail cap and deck into `soup`. */
export function buildHull(l: HullLines, soup: TriangleSoup): void {
  const p = hullShapeParams(l);
  const levelHeights = p.levels;
  const topsides = new THREE.Color(l.paint.topsides);
  const boot = new THREE.Color(l.paint.boot);
  const bottom = new THREE.Color(l.paint.bottom);
  const rail = new THREE.Color(l.paint.rail);
  const inside = new THREE.Color(l.paint.bulwarkInside);
  const deck = new THREE.Color(l.paint.deck);

  // One column of points per station, keel to sheer, starboard side, and where the deck
  // meets the inside of the bulwark: inboard of the flared side, so it never pokes out.
  const columns: THREE.Vector3[][] = [];
  const deckEdge: THREE.Vector3[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const keel = keelAt(l, t);
    const top = sheerAt(l, t);
    const deckY = top - l.bulwark;
    const vDeck = (deckY - keel) / (top - keel);
    const railInside = halfBreadth(l, t, 1) - RAIL_WIDTH;
    deckEdge.push(
      new THREE.Vector3(
        Math.max(Math.min(railInside, halfBreadth(l, t, vDeck) - 0.08), 0.02),
        deckY,
        zAt(l, t, vDeck),
      ),
    );
    const ys = [keel, ...levelHeights.filter((y) => y > keel + 0.02 && y < top - 0.05), top];
    // Every column has the same number of points: collapsed levels repeat the keel.
    while (ys.length < levelHeights.length + 2) ys.splice(1, 0, keel);
    columns.push(
      ys.map((y) => {
        const v = (y - keel) / (top - keel);
        return new THREE.Vector3(halfBreadth(l, t, v), y, zAt(l, t, v));
      }),
    );
  }
  const mirror = (p: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(-p.x, p.y, p.z);
  const bandColor = (a: THREE.Vector3, b: THREE.Vector3): THREE.Color => {
    const y = (a.y + b.y) / 2;
    return y < p.bootBottom ? bottom : y < p.bootTop ? boot : topsides;
  };

  const levels = (columns[0] as THREE.Vector3[]).length;
  for (let i = 0; i < STATIONS; i++) {
    const aft = columns[i] as THREE.Vector3[];
    const fore = columns[i + 1] as THREE.Vector3[];
    for (let j = 0; j < levels - 1; j++) {
      const a0 = aft[j] as THREE.Vector3;
      const a1 = aft[j + 1] as THREE.Vector3;
      const f0 = fore[j] as THREE.Vector3;
      const f1 = fore[j + 1] as THREE.Vector3;
      const color = bandColor(a0, a1);
      // Starboard faces +x; port is the mirror with reversed winding.
      soup.quad(a0, f0, f1, a1, color);
      soup.quad(mirror(a0), mirror(a1), mirror(f1), mirror(f0), color);
    }
    // Keel bottom strip, closing the two sides.
    const ka = aft[0] as THREE.Vector3;
    const kf = fore[0] as THREE.Vector3;
    soup.quad(mirror(ka), mirror(kf), kf, ka, bottom);

    // Rail cap, the inside of the bulwark, and the deck.
    const oa = aft[levels - 1] as THREE.Vector3;
    const of = fore[levels - 1] as THREE.Vector3;
    const inset = (p: THREE.Vector3): THREE.Vector3 =>
      p.clone().setX(Math.max(p.x - RAIL_WIDTH, 0.02));
    const ia = inset(oa);
    const iFore = inset(of);
    const da = deckEdge[i] as THREE.Vector3;
    const df = deckEdge[i + 1] as THREE.Vector3;
    soup.quad(ia, oa, of, iFore, rail);
    soup.quad(mirror(of), mirror(oa), mirror(ia), mirror(iFore), rail);
    soup.quad(da, ia, iFore, df, inside);
    soup.quad(mirror(df), mirror(iFore), mirror(ia), mirror(da), inside);
    soup.quad(mirror(da), da, df, mirror(df), deck);
  }

  // The stem face, closing the two sides forward.
  const bow = columns[STATIONS] as THREE.Vector3[];
  for (let j = 0; j < levels - 1; j++) {
    const s0 = bow[j] as THREE.Vector3;
    const s1 = bow[j + 1] as THREE.Vector3;
    soup.quad(s0, mirror(s0), mirror(s1), s1, bandColor(s0, s1));
  }

  // Transom, facing aft, with the taffrail across its top.
  const stern = columns[0] as THREE.Vector3[];
  for (let j = 0; j < levels - 1; j++) {
    const s0 = stern[j] as THREE.Vector3;
    const s1 = stern[j + 1] as THREE.Vector3;
    soup.quad(mirror(s0), s0, s1, mirror(s1), bandColor(s0, s1));
  }
  const top = stern[levels - 1] as THREE.Vector3;
  const innerTop = top
    .clone()
    .setX(Math.max(top.x - RAIL_WIDTH, 0.02))
    .setZ(top.z - RAIL_WIDTH);
  const innerDeck = deckEdge[0] as THREE.Vector3;
  soup.quad(mirror(top), top, innerTop, mirror(innerTop), rail);
  soup.quad(innerDeck, mirror(innerDeck), mirror(innerTop), innerTop, inside);
}

/** Cabin trunk, hatches, windlass and the wheel, placed by station along the deck. */
export function buildDeckFittings(l: SchoonerLines, shape: HullShape, soup: TriangleSoup): void {
  const house = new THREE.Color(l.paint.house);
  const roof = new THREE.Color(l.paint.bulwarkInside);
  const spar = new THREE.Color(l.paint.spar);
  const half = l.length / 2;
  const at = (station: number): number => -half + station;
  const onDeck = (fromStation: number, toStation: number, width: number, height: number): void => {
    const z0 = at(fromStation);
    const z1 = at(toStation);
    const y = Math.min(shape.deckAt(z0), shape.deckAt(z1)) - 0.05;
    soup.box(
      new THREE.Vector3(-width / 2, y, z0),
      new THREE.Vector3(width / 2, y + height, z1),
      house,
      roof,
    );
  };
  if (l.deck) {
    for (const h of l.deck.houses) onDeck(h.from, h.to, l.beam * h.width, h.height);
  } else {
    // Cabin trunk aft of the mainmast, main and fore hatches.
    onDeck(l.main.station + 1.1, l.main.station + 4.6, l.beam * 0.46, 0.85);
    onDeck(l.fore.station + 1.6, l.fore.station + 3.6, l.beam * 0.32, 0.45);
    onDeck(l.fore.station - 2.6, l.fore.station - 1.5, l.beam * 0.22, 0.4);
  }

  // Windlass across the foredeck.
  const wz = at(l.deck?.windlass ?? 1.6);
  const wy = shape.deckAt(wz) + 0.35;
  soup.spar(
    new THREE.Vector3(-l.beam * 0.17, wy, wz),
    new THREE.Vector3(l.beam * 0.17, wy, wz),
    0.18,
    spar,
    0.18,
  );

  // The wheel: a rim and four spokes on a short pedestal, facing aft.
  const hz = at(l.length - 1.6);
  const hy = shape.deckAt(hz) + 1.05;
  const rim = 0.55;
  const center = new THREE.Vector3(0, hy, hz);
  soup.box(
    new THREE.Vector3(-0.14, shape.deckAt(hz) - 0.05, hz - 0.1),
    new THREE.Vector3(0.14, hy, hz + 0.22),
    house,
  );
  const sides = 10;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = center.clone().add(new THREE.Vector3(Math.cos(a0) * rim, Math.sin(a0) * rim, 0.3));
    const p1 = center.clone().add(new THREE.Vector3(Math.cos(a1) * rim, Math.sin(a1) * rim, 0.3));
    soup.spar(p0, p1, 0.035, spar, 0.035, 4);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI + Math.PI / 8;
    const d = new THREE.Vector3(Math.cos(a) * (rim + 0.12), Math.sin(a) * (rim + 0.12), 0);
    const hub = center.clone().setZ(hz + 0.3);
    soup.spar(hub.clone().add(d), hub.clone().sub(d), 0.025, spar, 0.025, 4);
  }
}

/**
 * A yawl boat hung in davits across the stern (the T2 and up): a small double-ended
 * hull under two iron davits that lean out over the transom, the way the lake
 * schooners carried theirs.
 */
export function buildYawlBoat(l: SchoonerLines, shape: HullShape, soup: TriangleSoup): void {
  const boat = l.deck?.yawlBoat;
  if (!boat) return;
  const half = l.length / 2;
  const dark = new THREE.Color(l.paint.boot);
  const white = new THREE.Color(l.paint.topsides);
  const inside = new THREE.Color(l.paint.deck);
  const iron = new THREE.Color(l.paint.rope);
  const taffrail = shape.sheerAt(half);
  // The boat hangs athwartships, clear aft of the taffrail, its gunwale about level with
  // the rail, low enough that the main boom swings clear over the davits.
  const zc = half + l.transomRake * 0.15 + boat.beam / 2 + 0.25;
  const keel = taffrail - boat.beam * 0.35;
  const depth = boat.beam * 0.42;
  const sections = 8;
  const hb = boat.beam / 2;
  const hl = boat.length / 2;
  // Section half-width and gunwale lift along the boat (u from -1 to 1), double-ended.
  const width = (u: number): number => hb * Math.max(Math.cos((u * Math.PI) / 2) ** 0.7, 0.04);
  const lift = (u: number): number => 0.18 * u * u;
  const ring = (u: number): THREE.Vector3[] => {
    const x = u * hl;
    const w = width(u);
    const top = keel + depth + lift(u);
    return [
      new THREE.Vector3(x, keel + depth * 0.15 * u * u, zc),
      new THREE.Vector3(x, keel + depth * 0.45, zc - w * 0.8),
      new THREE.Vector3(x, top, zc - w),
      new THREE.Vector3(x, keel + depth * 0.45, zc + w * 0.8),
      new THREE.Vector3(x, top, zc + w),
    ];
  };
  for (let i = 0; i < sections; i++) {
    const a = ring(-1 + (2 * i) / sections);
    const b = ring(-1 + (2 * (i + 1)) / sections);
    const [ka, la, ga, ra, sa] = a as [
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
    ];
    const [kb, lb, gb, rb, sb] = b as [
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
    ];
    // Forward side (toward the ship, -z) and after side, bilge then topsides.
    soup.quad(la, lb, kb, ka, dark);
    soup.quad(ga, gb, lb, la, white);
    soup.quad(rb, ra, ka, kb, dark);
    soup.quad(sb, sa, ra, rb, white);
    // The open top, seen from above as the boat's bottom boards.
    soup.quad(sa, sb, gb, ga, inside);
  }
  // Two davits from the quarters, up and out over the boat, with falls down to it.
  for (const side of [-1, 1]) {
    const x = side * hl * 0.62;
    const zFoot = half - 0.6;
    const foot = new THREE.Vector3(x, shape.deckAt(zFoot), zFoot);
    const knee = new THREE.Vector3(x, keel + depth + 0.4, zFoot + 0.3);
    const head = new THREE.Vector3(x, keel + depth + 0.5, zc);
    soup.spar(foot, knee, 0.07, iron, 0.06, 5);
    soup.spar(knee, head, 0.06, iron, 0.05, 5);
    soup.spar(head, new THREE.Vector3(x, keel + depth + 0.05, zc), 0.025, iron, 0.025, 4);
  }
}
