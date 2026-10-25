import * as THREE from 'three';

/**
 * A procedural two-masted Great Lakes schooner, about 30 m on deck, for the Phase 0 test
 * scene. It stands in until spike S4 produces the real hull (plan 14). Flat-shaded with
 * vertex colors, so it is two draw calls: the hull and spars, and the sails.
 *
 * Local frame: bow toward -z, starboard +x, waterline at y = 0.
 */

const LENGTH = 30;
const BEAM = 7;
const STATIONS = 14;

const HULL = new THREE.Color(0x24302c);
const BOOT = new THREE.Color(0x8c2f22);
const RAIL = new THREE.Color(0xd9d2c0);
const DECK = new THREE.Color(0xa88a62);
const SPAR = new THREE.Color(0x6b4a2f);
const CANVAS = new THREE.Color(0xe6dcc6);

class TriangleSoup {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color): void {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) this.colors.push(color.r, color.g, color.b);
  }

  /** a-b-c-d counter-clockwise seen from the front face. */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.Color,
  ): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** A six-sided spar from `from` to `to`. */
  spar(from: THREE.Vector3, to: THREE.Vector3, radius: number, color: THREE.Color): void {
    const axis = new THREE.Vector3().subVectors(to, from).normalize();
    const side = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(axis, side).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const ring = (center: THREE.Vector3, r: number): THREE.Vector3[] =>
      Array.from({ length: 6 }, (_, i) => {
        const angle = (i / 6) * Math.PI * 2;
        return center
          .clone()
          .addScaledVector(u, Math.cos(angle) * r)
          .addScaledVector(v, Math.sin(angle) * r);
      });
    const bottom = ring(from, radius);
    const top = ring(to, radius * 0.7);
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      this.quad(
        bottom[i] as THREE.Vector3,
        bottom[j] as THREE.Vector3,
        top[j] as THREE.Vector3,
        top[i] as THREE.Vector3,
        color,
      );
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
}

/** Half-breadth at t (0 = stern, 1 = bow), as a fraction of the beam. */
function halfBreadth(t: number): number {
  if (t < 0.45) return 0.5 * (0.74 + 0.26 * Math.sin((t / 0.45) * (Math.PI / 2)));
  return 0.5 * Math.pow(Math.cos(((t - 0.45) / 0.55) * (Math.PI / 2)), 0.75);
}

const sheer = (t: number): number => 1.5 + 1.1 * t * t;
const keel = (t: number): number => -2.6 * (1 - 0.7 * Math.pow(t, 3));

function hull(soup: TriangleSoup): void {
  // One cross-section per station: keel, bilge, boot top, waterline, sheer (starboard).
  const section = (t: number): THREE.Vector3[] => {
    const z = LENGTH / 2 - t * LENGTH;
    const w = halfBreadth(t) * BEAM;
    const k = keel(t);
    return [
      new THREE.Vector3(0, k, z),
      new THREE.Vector3(w * 0.55, k * 0.85, z),
      new THREE.Vector3(w * 0.92, k * 0.4, z),
      new THREE.Vector3(w, 0.25, z),
      new THREE.Vector3(w * 1.02, sheer(t), z),
    ];
  };
  const bandColor = [HULL, HULL, BOOT, HULL];
  const sections = Array.from({ length: STATIONS + 1 }, (_, i) => section(i / STATIONS));
  const mirror = (p: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(-p.x, p.y, p.z);

  for (let i = 0; i < STATIONS; i++) {
    const aft = sections[i] as THREE.Vector3[];
    const fore = sections[i + 1] as THREE.Vector3[];
    for (let j = 0; j < 4; j++) {
      const color = bandColor[j] as THREE.Color;
      const a0 = aft[j] as THREE.Vector3;
      const a1 = aft[j + 1] as THREE.Vector3;
      const f0 = fore[j] as THREE.Vector3;
      const f1 = fore[j + 1] as THREE.Vector3;
      // Starboard faces +x; port is the mirror with reversed winding.
      soup.quad(a0, f0, f1, a1, color);
      soup.quad(mirror(a0), mirror(a1), mirror(f1), mirror(f0), color);
    }
    // Deck, a little below the rail.
    const as = (aft[4] as THREE.Vector3).clone().setY(sheer(i / STATIONS) - 0.5);
    const fs = (fore[4] as THREE.Vector3).clone().setY(sheer((i + 1) / STATIONS) - 0.5);
    soup.quad(mirror(as), as, fs, mirror(fs), DECK);
    // Rail cap: a thin white strip on top of each side.
    const ar = aft[4] as THREE.Vector3;
    const fr = fore[4] as THREE.Vector3;
    const inset = (p: THREE.Vector3): THREE.Vector3 => p.clone().setX(p.x * 0.94);
    soup.quad(inset(ar), ar, fr, inset(fr), RAIL);
    soup.quad(mirror(fr), mirror(ar), mirror(inset(ar)), mirror(inset(fr)), RAIL);
  }

  // Transom.
  const stern = sections[0] as THREE.Vector3[];
  for (let j = 0; j < 4; j++) {
    const p = stern[j] as THREE.Vector3;
    const q = stern[j + 1] as THREE.Vector3;
    soup.quad(mirror(p), p, q, mirror(q), HULL);
  }
}

function rig(spars: TriangleSoup, sails: TriangleSoup): void {
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const deckAt = (z: number): number => sheer((LENGTH / 2 - z) / LENGTH) - 0.5;

  // Foremast and the slightly taller mainmast, raked aft.
  const fore = { z: -5.5, height: 25 };
  const main = { z: 3.5, height: 27 };
  for (const m of [fore, main]) {
    spars.spar(v(0, deckAt(m.z), m.z), v(0, m.height, m.z + 0.8), 0.22, SPAR);
  }
  // Bowsprit and jib boom.
  spars.spar(
    v(0, sheer(1) - 0.3, -LENGTH / 2 + 0.5),
    v(0, sheer(1) + 1.6, -LENGTH / 2 - 9),
    0.18,
    SPAR,
  );

  // Booms and gaffs, swung a little to port so the sails catch the light.
  const swing = 0.22;
  const gaffRig = (mast: { z: number; height: number }, boomLength: number): void => {
    const tack = v(0, deckAt(mast.z) + 1.4, mast.z + 0.3);
    const clew = v(
      -Math.sin(swing) * boomLength,
      tack.y + 0.4,
      mast.z + Math.cos(swing) * boomLength,
    );
    const throat = v(0, mast.height * 0.72, mast.z + 0.65);
    const gaffLength = boomLength * 0.62;
    const peak = v(
      -Math.sin(swing) * gaffLength,
      throat.y + gaffLength * 0.55,
      mast.z + Math.cos(swing) * gaffLength * 0.85,
    );
    spars.spar(tack, clew, 0.12, SPAR);
    spars.spar(throat, peak, 0.1, SPAR);
    sails.quad(tack, clew, peak, throat, CANVAS);
  };
  gaffRig(fore, 8.5);
  gaffRig(main, 13);

  // Two headsails from the foremast to the bowsprit.
  const foreTop = v(0, fore.height * 0.86, fore.z + 0.7);
  const foreHigh = v(0, fore.height * 0.62, fore.z + 0.5);
  sails.tri(
    foreTop,
    v(-0.9, sheer(1) + 1.2, -LENGTH / 2 - 7.5),
    v(-0.4, deckAt(fore.z - 3) + 1, fore.z - 3.5),
    CANVAS,
  );
  sails.tri(
    foreHigh,
    v(-0.6, sheer(1) + 0.4, -LENGTH / 2 - 2.5),
    v(-0.3, deckAt(fore.z - 1) + 1, fore.z - 1),
    CANVAS,
  );
}

/**
 * `hull: false` builds only the masts, spars and sails, to stand on a hull from the asset
 * pipeline (plan 14 §5: AI hull, procedural rig).
 */
export function createPlaceholderSchooner(options: { hull?: boolean } = {}): THREE.Group {
  const solid = new TriangleSoup();
  const canvas = new TriangleSoup();
  if (options.hull ?? true) hull(solid);
  rig(solid, canvas);

  const group = new THREE.Group();
  group.name = 'placeholder-schooner';
  group.add(
    new THREE.Mesh(
      solid.build(),
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }),
    ),
    new THREE.Mesh(
      canvas.build(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.95,
        side: THREE.DoubleSide,
      }),
    ),
  );
  return group;
}
