import * as THREE from 'three';
import type { PlacedCave, PlacedCaveNode } from '../../sim/caves/caves';
import { PALETTE } from '../style/palette';
import { STYLE_LIGHT_GLSL, type StyleLighting } from '../style/stylized-material';

/**
 * The sea caves drawn (plan 11 §5, §18.4 piece S): each passage's rock swept along its
 * nodes, bedded red sandstone darkening to black the deeper in it goes, its floor, a flared
 * lip where it comes out of the cliff, and a domed end where it closes. The terrain shader
 * cuts the cliff away where the passage runs (cave-clip.ts), so this is the cave you see
 * from the water and walk in. In winter an ice cave's water is a sheet of ice under a
 * fringe of icicles.
 *
 * All the zone's rock is one mesh and each cave's ice another, so a cave costs a draw
 * call or two (plan 11 §18.3 criterion 12: a cave ≤ 40).
 */

export interface CaveView {
  readonly group: THREE.Group;
  readonly triangles: number;
  readonly drawCalls: number;
  /** Shows each ice cave's ice (by cave id) and frosts the rock while any is frozen. */
  setFrozen(frozen: ReadonlySet<string>): void;
  dispose(): void;
}

/** Stations along the passage every this many meters. */
const STATION_M = 0.9;
/** How far in the light goes: full at the mouth, near black by here. */
const DARK_M = 16;
/** The least light deep in a cave (ambient that finds its way round). */
const DEEP_SHADE = 0.12;
const ICE_HEX = 0xc8dce6;
const ICICLE_HEX = 0xe6f0f5;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A small smooth noise along the passage, by station distance and a ring index. */
function noise(s: number, k: number): number {
  const f = (n: number): number => {
    const v = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const i = Math.floor(s);
  const u = s - i;
  const w = u * u * (3 - 2 * u);
  return lerp(f(i), f(i + 1), w);
}

interface Station {
  x: number;
  z: number;
  /** Unit tangent into the cave, and right of it. */
  tx: number;
  tz: number;
  rx: number;
  rz: number;
  hw: number;
  floor: number;
  roof: number;
  /** Meters along the passage, and in from the nearest opening. */
  along: number;
  depth: number;
}

/** The roofed runs of a cave, each a list of node indices. */
function roofedRuns(nodes: readonly PlacedCaveNode[]): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  for (let k = 0; k < nodes.length; k++) {
    if (nodes[k]?.roof !== undefined) run.push(k);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length >= 2);
}

function stationsOf(nodes: readonly PlacedCaveNode[], run: readonly number[]): Station[] {
  const out: Station[] = [];
  let along = 0;
  const dir = (a: PlacedCaveNode, b: PlacedCaveNode): { x: number; z: number } => {
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  };
  for (let r = 0; r + 1 < run.length; r++) {
    const a = nodes[run[r] as number] as PlacedCaveNode;
    const b = nodes[run[r + 1] as number] as PlacedCaveNode;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / STATION_M));
    const d = dir(a, b);
    // At a joint the tangent is the two segments' mean, so the rings don't cross.
    const prev = r > 0 ? dir(nodes[run[r - 1] as number] as PlacedCaveNode, a) : d;
    const next = r + 2 < run.length ? dir(b, nodes[run[r + 2] as number] as PlacedCaveNode) : d;
    for (let i = r === 0 ? 0 : 1; i <= steps; i++) {
      const t = i / steps;
      let tx = d.x;
      let tz = d.z;
      if (i === 0) {
        tx = prev.x + d.x;
        tz = prev.z + d.z;
      } else if (i === steps) {
        tx = d.x + next.x;
        tz = d.z + next.z;
      }
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      out.push({
        x: lerp(a.x, b.x, t),
        z: lerp(a.z, b.z, t),
        tx,
        tz,
        rx: -tz,
        rz: tx,
        hw: lerp(a.hw, b.hw, t),
        floor: lerp(a.floor, b.floor, t),
        roof: lerp(a.roof ?? 0, b.roof ?? 0, t),
        along: along + len * t,
        depth: 0,
      });
    }
    along += len;
  }
  return out;
}

/** A growing triangle soup: position, normal, color and how much light reaches it. */
class Soup {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly shade: number[] = [];
  vertex(x: number, y: number, z: number, c: THREE.Color, shade: number): void {
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    this.shade.push(shade);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('shade', new THREE.Float32BufferAttribute(this.shade, 1));
    g.computeVertexNormals();
    return g;
  }
}

interface RingVertex {
  x: number;
  y: number;
  z: number;
  c: THREE.Color;
  shade: number;
}

const SANDSTONE = new THREE.Color(PALETTE.sandstone);
const SANDSTONE_DARK = new THREE.Color(PALETTE.sandstoneDark);
const WET_ROCK = new THREE.Color(PALETTE.wetRock);
const SAND = new THREE.Color(PALETTE.beachSand);
const WET_SAND = new THREE.Color(PALETTE.wetSand);

/** Rock's color at a height: dark and wet at the waterline, bedded red above. */
function rockColor(y: number, grain: number): THREE.Color {
  const bed = Math.floor((y + grain * 0.5) / 0.9) % 2 === 0 ? SANDSTONE : SANDSTONE_DARK;
  const wet = 1 - Math.min(1, Math.max(0, (y - 0.3) / 0.9));
  return bed.clone().lerp(WET_ROCK, wet * 0.85);
}

/** The cross-section's points at a station: wall foot, wall, the arch, the other wall. */
function ring(st: Station, k: number, scale = 1, lift = 0): RingVertex[] {
  const out: RingVertex[] = [];
  const spring = st.floor + (st.roof - st.floor) * 0.45;
  const foot = st.floor - 1.2;
  const pts: { lat: number; y: number; nx: number; ny: number }[] = [
    { lat: -1, y: foot, nx: -1, ny: 0 },
    { lat: -1, y: st.floor + 0.2, nx: -1, ny: 0 },
    { lat: -1, y: spring, nx: -1, ny: 0 },
  ];
  const ARCH = 7;
  for (let a = 1; a < ARCH; a++) {
    const th = Math.PI - (a / ARCH) * Math.PI;
    pts.push({
      lat: Math.cos(th),
      y: spring + Math.sin(th) * (st.roof - spring),
      nx: Math.cos(th),
      ny: Math.sin(th),
    });
  }
  pts.push({ lat: 1, y: spring, nx: 1, ny: 0 });
  pts.push({ lat: 1, y: st.floor + 0.2, nx: 1, ny: 0 });
  pts.push({ lat: 1, y: foot, nx: 1, ny: 0 });
  const shade = Math.max(DEEP_SHADE, 1 - st.depth / DARK_M);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as (typeof pts)[number];
    // Pocked rock: out from the walkable edge, never into it.
    const bump = noise(st.along * 0.45, i * 3 + k * 17) * 0.45 + 0.05;
    const lat = (p.lat * st.hw + p.nx * bump) * scale;
    const y = st.floor + (p.y - st.floor) * scale + p.ny * bump + lift;
    out.push({
      x: st.x + st.rx * lat,
      y,
      z: st.z + st.rz * lat,
      c: rockColor(y, noise(st.along * 0.2, i)),
      shade,
    });
  }
  return out;
}

function quad(s: Soup, a: RingVertex, b: RingVertex, c: RingVertex, d: RingVertex): void {
  // a-b on one ring, d-c on the next: two triangles, wound to face into the passage.
  for (const v of [a, d, b, b, d, c]) s.vertex(v.x, v.y, v.z, v.c, v.shade);
}

function joinRings(s: Soup, r0: RingVertex[], r1: RingVertex[]): void {
  for (let i = 0; i + 1 < r0.length; i++) {
    quad(
      s,
      r0[i] as RingVertex,
      r0[i + 1] as RingVertex,
      r1[i + 1] as RingVertex,
      r1[i] as RingVertex,
    );
  }
}

/** A domed end: each ring point drawn in to a point a little further on. */
function capRing(s: Soup, r: RingVertex[], st: Station, sign: number): void {
  const tip = {
    x: st.x + st.tx * sign * st.hw * 0.7,
    y: st.floor + (st.roof - st.floor) * 0.45,
    z: st.z + st.tz * sign * st.hw * 0.7,
  };
  const shade = r[0]?.shade ?? DEEP_SHADE;
  const c = rockColor(tip.y, 0.5);
  for (let i = 0; i + 1 < r.length; i++) {
    const a = r[i] as RingVertex;
    const b = r[i + 1] as RingVertex;
    s.vertex(a.x, a.y, a.z, a.c, a.shade);
    s.vertex(b.x, b.y, b.z, b.c, b.shade);
    s.vertex(tip.x, tip.y, tip.z, c, shade);
  }
}

/** The floor across a station pair: a strip of a few cells, sand above the lake. */
function floorStrip(s: Soup, a: Station, b: Station): void {
  const ACROSS = 4;
  const at = (st: Station, j: number): RingVertex => {
    const lat = (j / ACROSS - 0.5) * 2 * (st.hw + 0.3);
    const y = st.floor + noise(st.along * 0.6, j + 40) * 0.08;
    const c =
      st.floor > 0.15
        ? SAND.clone().lerp(WET_SAND, Math.max(0, 0.6 - st.floor) * 1.5)
        : WET_ROCK.clone();
    return {
      x: st.x + st.rx * lat,
      y,
      z: st.z + st.rz * lat,
      c,
      shade: Math.max(DEEP_SHADE, 1 - st.depth / DARK_M),
    };
  };
  for (let j = 0; j < ACROSS; j++) {
    const a0 = at(a, j);
    const a1 = at(a, j + 1);
    const b0 = at(b, j);
    const b1 = at(b, j + 1);
    for (const v of [a0, a1, b1, a0, b1, b0]) s.vertex(v.x, v.y, v.z, v.c, v.shade);
  }
}

/** An open stretch with a dry floor (a prefab's opening above the lake): its ledge. */
function ledge(s: Soup, a: PlacedCaveNode, b: PlacedCaveNode): void {
  if (Math.max(a.floor, b.floor) < 0.1) return;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const tx = (b.x - a.x) / len;
  const tz = (b.z - a.z) / len;
  const st = (n: PlacedCaveNode, along: number): Station => ({
    x: n.x,
    z: n.z,
    tx,
    tz,
    rx: -tz,
    rz: tx,
    hw: n.hw,
    floor: n.floor,
    roof: n.floor + 3,
    along,
    depth: 0,
  });
  floorStrip(s, st(a, 0), st(b, len));
}

export interface CaveMeshData {
  rock: THREE.BufferGeometry;
  /** The ice sheet over its water and the icicles under its roof, for an ice cave. */
  ice: THREE.BufferGeometry | undefined;
}

/** One cave's rock and its winter ice, in zone meters. */
export function caveMeshData(cave: PlacedCave, iceTop = 0.12): CaveMeshData {
  const rock = new Soup();
  const ice = new Soup();
  const nodes = cave.nodes;
  for (let k = 0; k + 1 < nodes.length; k++) {
    const a = nodes[k] as PlacedCaveNode;
    const b = nodes[k + 1] as PlacedCaveNode;
    if (a.roof === undefined || b.roof === undefined) ledge(rock, a, b);
  }
  const iceColor = new THREE.Color(ICE_HEX);
  const icicle = new THREE.Color(ICICLE_HEX);
  for (const run of roofedRuns(nodes)) {
    const stations = stationsOf(nodes, run);
    const first = run[0] as number;
    const last = run[run.length - 1] as number;
    const openStart = first > 0;
    const openEnd = last < nodes.length - 1;
    // How far in from the nearest opening each station is.
    const total = stations[stations.length - 1]?.along ?? 0;
    for (const st of stations) {
      const fromStart = openStart ? st.along : Infinity;
      const fromEnd = openEnd ? total - st.along : Infinity;
      st.depth = Math.min(fromStart, fromEnd);
      if (!Number.isFinite(st.depth)) st.depth = DARK_M;
    }
    const rings = stations.map((st, i) => ring(st, i));
    for (let i = 0; i + 1 < stations.length; i++) {
      joinRings(rock, rings[i] as RingVertex[], rings[i + 1] as RingVertex[]);
      floorStrip(rock, stations[i] as Station, stations[i + 1] as Station);
    }
    // The ends: a lip flaring out of the cliff, the prefab's own frame, or a domed end.
    const ends: [Station, RingVertex[], number, boolean, boolean][] = [
      [stations[0] as Station, rings[0] as RingVertex[], -1, openStart, !!nodes[first]?.lip],
      [
        stations[stations.length - 1] as Station,
        rings[rings.length - 1] as RingVertex[],
        1,
        openEnd,
        !!nodes[last]?.lip,
      ],
    ];
    for (const [st, r, sign, open, lip] of ends) {
      if (!open) {
        capRing(rock, r, st, sign);
        continue;
      }
      if (!lip) continue;
      const out = { ...st, x: st.x + st.tx * sign * 0.8, z: st.z + st.tz * sign * 0.8 };
      const flare = ring(out, 99, 1.55);
      if (sign < 0) joinRings(rock, flare, r);
      else joinRings(rock, r, flare);
    }
    // Winter: the ice over the water and icicles off the roof.
    for (let i = 0; i + 1 < stations.length; i++) {
      const a = stations[i] as Station;
      const b = stations[i + 1] as Station;
      if (Math.min(a.floor, b.floor) < iceTop) {
        const fa = { ...a, floor: iceTop, along: a.along };
        const fb = { ...b, floor: iceTop, along: b.along };
        const before = ice.pos.length;
        floorStrip(ice, fa, fb);
        for (let v = before / 3; v < ice.pos.length / 3; v++) {
          ice.col[v * 3] = iceColor.r;
          ice.col[v * 3 + 1] = iceColor.g;
          ice.col[v * 3 + 2] = iceColor.b;
        }
      }
      if (i % 2 === 0) {
        for (let j = 0; j < 3; j++) {
          const h = noise(a.along * 1.7, j * 5 + 7);
          const lat = (noise(a.along * 2.3, j * 11) - 0.5) * a.hw * 1.2;
          const len = 0.3 + h * 1.1;
          const x = a.x + a.rx * lat;
          const z = a.z + a.rz * lat;
          const across = Math.abs(lat) / a.hw;
          const spring = a.floor + (a.roof - a.floor) * 0.45;
          const top = spring + Math.sqrt(Math.max(0, 1 - across * across)) * (a.roof - spring);
          const shade = Math.max(0.35, 1 - a.depth / DARK_M);
          const w = 0.07 + h * 0.06;
          // A thin three-sided spike down from the rock.
          for (let s = 0; s < 3; s++) {
            const a0 = (s / 3) * Math.PI * 2;
            const a1 = ((s + 1) / 3) * Math.PI * 2;
            ice.vertex(x + Math.cos(a0) * w, top + 0.1, z + Math.sin(a0) * w, icicle, shade);
            ice.vertex(x + Math.cos(a1) * w, top + 0.1, z + Math.sin(a1) * w, icicle, shade);
            ice.vertex(x, top - len, z, icicle, shade);
          }
        }
      }
    }
  }
  // The caches' cairns: a few stones on the floor at each spot that isn't winter's.
  const stone = new THREE.Color(PALETTE.slopeRock);
  for (const cache of cave.caches) {
    if (cache.def.winter) continue;
    for (const spot of cache.spots) {
      const box = new THREE.BoxGeometry(0.7, 0.35, 0.6).toNonIndexed();
      const top = new THREE.BoxGeometry(0.45, 0.3, 0.4).toNonIndexed();
      top.rotateY(0.6);
      top.translate(0, 0.32, 0);
      for (const g of [box, top]) {
        g.translate(spot.x, spot.y + 0.17, spot.z);
        const p = g.getAttribute('position');
        for (let v = 0; v < p.count; v++) {
          rock.vertex(p.getX(v), p.getY(v), p.getZ(v), stone, 0.6);
        }
        g.dispose();
      }
    }
  }
  return { rock: rock.geometry(), ice: ice.pos.length ? ice.geometry() : undefined };
}

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float shade;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vColor;
varying float vShade;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vShade = shade;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${STYLE_LIGHT_GLSL}
uniform float uFrost;
uniform vec3 uFrostColor;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vColor;
varying float vShade;
void main() {
  vec3 n = normalize(vWorldNormal);
  if (!gl_FrontFacing) n = -n;
  // The sun reaches in only as far as the mouth lets it; deeper, a little ambient.
  vec3 light = styleLight(n, vWorldPos) * vShade;
  // Frozen spray on the rock near the waterline in an ice cave.
  float frost = uFrost * (1.0 - smoothstep(0.4, 2.2, vWorldPos.y));
  vec3 albedo = mix(vColor, uFrostColor, frost * 0.7);
  gl_FragColor = vec4(albedo * light, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function caveMaterial(
  lighting: StyleLighting,
  frost: THREE.IUniform<number>,
): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...lighting.uniforms,
      uFrost: frost,
      uFrostColor: { value: new THREE.Color(ICE_HEX) },
    },
    defines: { STYLE_TOON: '', STYLE_WRAP: '' },
    vertexShader,
    fragmentShader,
    vertexColors: true,
    // Seen from inside and, over a low cliff, from above.
    side: THREE.DoubleSide,
    fog: true,
  });
  m.name = 'cave-rock';
  return m;
}

export function createCaveView(caves: readonly PlacedCave[], lighting: StyleLighting): CaveView {
  const group = new THREE.Group();
  group.name = 'caves';
  const frost = { value: 0 };
  const material = caveMaterial(lighting, { value: 0 });
  const iceMaterial = caveMaterial(lighting, frost);
  material.uniforms['uFrost'] = frost;
  const rocks: THREE.BufferGeometry[] = [];
  const ices = new Map<string, THREE.Mesh>();
  let triangles = 0;
  for (const cave of caves) {
    const data = caveMeshData(cave);
    rocks.push(data.rock);
    if (data.ice) {
      const mesh = new THREE.Mesh(data.ice, iceMaterial);
      mesh.name = `cave-ice-${cave.id}`;
      mesh.visible = false;
      ices.set(cave.id, mesh);
      group.add(mesh);
      triangles += data.ice.getAttribute('position').count / 3;
    }
  }
  let rockMesh: THREE.Mesh | undefined;
  if (rocks.length) {
    const pos: number[] = [];
    const col: number[] = [];
    const shade: number[] = [];
    for (const g of rocks) {
      pos.push(...(g.getAttribute('position').array as Float32Array));
      col.push(...(g.getAttribute('color').array as Float32Array));
      shade.push(...(g.getAttribute('shade').array as Float32Array));
      g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
    g.computeVertexNormals();
    rockMesh = new THREE.Mesh(g, material);
    rockMesh.name = 'cave-rock';
    group.add(rockMesh);
    triangles += pos.length / 9;
  }
  return {
    group,
    triangles,
    get drawCalls() {
      let n = rockMesh ? 1 : 0;
      for (const m of ices.values()) if (m.visible) n++;
      return n;
    },
    setFrozen(frozen) {
      let any = false;
      for (const [id, mesh] of ices) {
        mesh.visible = frozen.has(id);
        any ||= mesh.visible;
      }
      frost.value = any ? 1 : 0;
    },
    dispose() {
      rockMesh?.geometry.dispose();
      for (const m of ices.values()) m.geometry.dispose();
      material.dispose();
      iceMaterial.dispose();
    },
  };
}
