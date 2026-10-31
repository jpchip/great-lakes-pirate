import * as THREE from 'three';
import { lampLevel } from '../../sim/lighthouses';
import { addOutlines, creaseNormals, type OutlineSettings } from '../style/outline';
import { PALETTE } from '../style/palette';
import {
  applyStylizedMaterials,
  type StyleLighting,
  type StylizedMaterial,
} from '../style/stylized-material';
import { buildHull, hullShape, type HullShape } from './schooner-hull';
import type { NpcMastLines, NpcShipLines } from './npc-lines';
import { createRunningLights, type Lamp, type RunningLights } from './running-lights';
import { TriangleSoup } from './soup';

/**
 * NPC ships v0 (Phase 3 piece H, plan 14 §5): the steamers and the schooner-barge from
 * the same parametric generator as the player's schooner. The hull comes from the class's
 * lines; deckhouses, hatches, stacks, pole masts, spars and boats are placed by station.
 *
 * Draw calls per ship, before the wake: the solid body (hull, houses, spars, furled
 * canvas) and its ink shell, the windows (dark glass by day, lit from dusk), the rigging
 * lines, the running lights, and for the schooner-barge its set sails and their edge
 * lines. Smoke from every stack goes through one shared system (funnel-smoke.ts).
 *
 * The model is built at full size and drawn at the record's `displayScale` (plan 03 §3.5),
 * so the 400 ft laker shows 104 m long. Local frame: bow toward -z, starboard +x,
 * waterline at y = 0.
 */

export interface NpcShipModel {
  readonly group: THREE.Group;
  readonly lines: NpcShipLines;
  readonly displayScale: number;
  /** Stack tops in the group's frame (scaled), and each stack's drawn radius. */
  readonly stacks: readonly { top: THREE.Vector3; radius: number }[];
  readonly lights: RunningLights;
  /** The set sails, when the class carries them: mirrored to leeward by `update`. */
  readonly sails: THREE.Object3D | undefined;
  /** Triangles in the solid body, windows and sails (the plan 14 §8 budget). */
  readonly triangles: number;
  /**
   * Night lights and the sails' side: `sunElevationDeg` lights the lamps and windows
   * from dusk, `fogDensity` dims the lamps, and `windFromStarboard` sets the booms over.
   */
  update(sunElevationDeg: number, fogDensity: number, windFromStarboard?: boolean): void;
  dispose(): void;
}

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
/** Window panes: size and how far proud of the house side they sit. */
const PANE_W = 0.55;
const PANE_H = 0.6;
const PANE_PROUD = 0.03;

/** Deterministic 0–1 from integers, so the same windows are lit every night. */
function hash01(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function mastPoint(shape: HullShape, l: NpcShipLines, m: NpcMastLines, along: number) {
  const z = -l.length / 2 + m.at;
  const rake = m.rakeDeg * DEG;
  return new THREE.Vector3(0, shape.deckAt(z) + Math.cos(rake) * along, z + Math.sin(rake) * along);
}

export function createNpcShip(l: NpcShipLines, displayScale = 1): NpcShipModel {
  const shape = hullShape(l);
  const half = l.length / 2;
  const at = (station: number): number => -half + station;
  const deckAt = (station: number): number => shape.deckAt(at(station));
  const color = (hex: number): THREE.Color => new THREE.Color(hex);
  const p = l.paint;

  const body = new TriangleSoup();
  // Panes that light up at night; the dark ones are part of the body.
  const lit = new TriangleSoup();
  const canvas = new TriangleSoup();
  const rope: number[] = [];
  const line = (a: THREE.Vector3, b: THREE.Vector3): void => {
    rope.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };

  buildHull(l, body);

  // Hatches: low coamings with their covers, evenly down the cargo deck.
  if (l.hatches) {
    const h = l.hatches;
    const pitch = h.count > 1 ? (h.to - h.from - h.length) / (h.count - 1) : 0;
    for (let i = 0; i < h.count; i++) {
      const z0 = at(h.from + i * pitch);
      const z1 = z0 + h.length;
      const y = Math.min(shape.deckAt(z0), shape.deckAt(z1)) - 0.05;
      body.box(
        new THREE.Vector3(-h.width / 2, y, z0),
        new THREE.Vector3(h.width / 2, y + 0.65, z1),
        color(p.hatch),
        color(PALETTE.deckSteel),
      );
    }
  }

  // Deckhouses, with a row of windows; the base of a raised house is the deck at its
  // forward end, so a stacked tier lines up with the one below.
  const darkGlass = color(PALETTE.glass);
  l.houses.forEach((house, hi) => {
    const z0 = at(house.from);
    const z1 = at(house.to);
    const deck = Math.min(shape.deckAt(z0), shape.deckAt(z1));
    const y0 = deck + (house.base ?? 0) - (house.base ? 0 : 0.05);
    const y1 = deck + (house.base ?? 0) + house.height;
    const w = house.width / 2;
    body.box(
      new THREE.Vector3(-w, y0, z0),
      new THREE.Vector3(w, y1, z1),
      color(house.color ?? p.house),
      color(house.roof ?? p.roof),
    );
    if (!house.windows) return;
    const { spacing, lit: share } = house.windows;
    const wy = y1 - Math.min(0.55, house.height * 0.3) - PANE_H;
    const pane = (center: THREE.Vector3, normal: THREE.Vector3, k: number): void => {
      const side = new THREE.Vector3().crossVectors(UP, normal).multiplyScalar(PANE_W / 2);
      const c = center.clone().addScaledVector(normal, PANE_PROUD);
      const a = c.clone().sub(side);
      const b = c.clone().add(side);
      const top = new THREE.Vector3(0, PANE_H, 0);
      const target = hash01(hi * 37 + k, house.from) < share ? lit : body;
      target.quad(a, b, b.clone().add(top), a.clone().add(top), darkGlass);
    };
    const count = Math.max(1, Math.floor((house.to - house.from - 0.6) / spacing));
    const span = (count - 1) * spacing;
    const mid = (z0 + z1) / 2;
    for (let i = 0; i < count; i++) {
      const z = mid - span / 2 + i * spacing;
      pane(new THREE.Vector3(w, wy, z), new THREE.Vector3(1, 0, 0), i);
      pane(new THREE.Vector3(-w, wy, z), new THREE.Vector3(-1, 0, 0), i + 500);
    }
    // Across the forward end (the pilothouse's windscreen) and the after end.
    const across = Math.max(1, Math.floor((house.width - 0.6) / Math.max(spacing, 0.9)));
    const acrossSpan = (across - 1) * Math.max(spacing, 0.9);
    for (let i = 0; i < across; i++) {
      const x = -acrossSpan / 2 + i * Math.max(spacing, 0.9);
      pane(new THREE.Vector3(x, wy, z0), new THREE.Vector3(0, 0, -1), i + 1000);
      pane(new THREE.Vector3(x, wy, z1), new THREE.Vector3(0, 0, 1), i + 1500);
    }
  });

  // Stacks: raked aft, a painted band, a soot-black top; a steam pipe forward of each.
  const stacks: { top: THREE.Vector3; radius: number }[] = [];
  for (const s of l.stacks) {
    const z = at(s.at);
    const foot = new THREE.Vector3(0, shape.deckAt(z) + (s.base ?? 0) - 0.1, z);
    const dir = new THREE.Vector3(0, Math.cos(s.rakeDeg * DEG), Math.sin(s.rakeDeg * DEG));
    const top = foot.clone().addScaledVector(dir, s.height + 0.1);
    const bandFrom = foot.clone().addScaledVector(dir, s.height * 0.72);
    const capFrom = foot.clone().addScaledVector(dir, s.height * (s.band ? 0.86 : 0.88));
    body.spar(foot, bandFrom, s.radius, color(s.color), s.radius, 10);
    if (s.band) {
      body.spar(bandFrom, capFrom, s.radius, color(s.band), s.radius, 10);
    } else {
      body.spar(bandFrom, capFrom, s.radius, color(s.color), s.radius, 10);
    }
    body.spar(capFrom, top, s.radius, color(s.top), s.radius * 1.04, 10);
    const pipe = foot.clone().add(new THREE.Vector3(0, 0, -s.radius - 0.15));
    body.spar(pipe, pipe.clone().addScaledVector(dir, s.height * 0.95), 0.1, color(s.top), 0.1, 4);
    stacks.push({ top: top.multiplyScalar(displayScale), radius: s.radius * displayScale });
  }

  // Pole masts with their shrouds and a stay; gaffs and booms, the canvas furled on the
  // boom or set as a sail.
  const spar = color(p.spar);
  const cloth = color(p.canvas);
  const mastHeads: THREE.Vector3[] = [];
  for (const m of l.masts) {
    const z = at(m.at);
    const head = mastPoint(shape, l, m, m.height);
    mastHeads.push(head);
    body.spar(mastPoint(shape, l, m, -0.2), head, m.radius, spar, m.radius * 0.55);
    const shroudAt = head.clone().lerp(mastPoint(shape, l, m, 0), 0.18);
    for (const side of [-1, 1]) {
      for (const dz of [-0.9, 0.3]) {
        const zz = z + dz;
        line(
          new THREE.Vector3(side * (shape.railHalfBreadthAt(zz) + 0.04), shape.sheerAt(zz), zz),
          shroudAt.clone().setX(side * m.radius),
        );
      }
    }
    const g = m.gaff;
    if (!g) continue;
    const jaws = mastPoint(shape, l, m, g.gooseneck);
    const boomEnd = jaws.clone().add(new THREE.Vector3(0, 0.4, g.boom));
    body.spar(jaws, boomEnd, 0.13, spar, 0.1);
    const throat = mastPoint(shape, l, m, g.throat);
    if (!l.sailsSet) {
      // Furled: the gaff lowered onto the boom, the canvas bundled between them.
      const low = jaws.clone().addScaledVector(UP, 0.7);
      body.spar(low, low.clone().add(new THREE.Vector3(0, 0.25, g.gaff)), 0.1, spar, 0.08);
      body.spar(
        jaws.clone().add(new THREE.Vector3(0, 0.35, 0.4)),
        jaws.clone().add(new THREE.Vector3(0, 0.55, g.boom * 0.85)),
        0.32,
        cloth,
        0.18,
      );
      continue;
    }
    // Set: the gaff peaked up, the sail between gaff and boom, cambered to leeward (+x).
    const peakAngle = (g.peakDeg + m.rakeDeg) * DEG;
    const peak = throat
      .clone()
      .add(new THREE.Vector3(0, Math.sin(peakAngle) * g.gaff, Math.cos(peakAngle) * g.gaff));
    body.spar(throat, peak, 0.1, spar, 0.08);
    gaffSail(canvas, jaws.clone().addScaledVector(UP, 0.25), boomEnd, peak, throat, cloth);
  }

  // A jib from the bowsprit end to the foremast head, set with the gaff sails.
  const stemHead = shape.stemHead.clone().addScaledVector(UP, -0.15);
  let spritEnd: THREE.Vector3 | undefined;
  if (l.bowsprit) {
    const steeve = l.bowsprit.steeveDeg * DEG;
    const dir = new THREE.Vector3(0, Math.sin(steeve), -Math.cos(steeve));
    spritEnd = stemHead.clone().addScaledVector(dir, l.bowsprit.length);
    body.spar(stemHead.clone().addScaledVector(dir, -2), spritEnd, 0.24, spar, 0.12);
    line(spritEnd, new THREE.Vector3(0, 0.2, -half + l.stemRake * 0.4));
  }
  const fore = mastHeads[0];
  if (fore) line(fore, spritEnd ?? stemHead);
  for (let i = 1; i < mastHeads.length; i++) {
    line(mastHeads[i] as THREE.Vector3, mastHeads[i - 1] as THREE.Vector3);
  }
  if (l.jib && l.sailsSet && spritEnd && fore) {
    const tack = spritEnd.clone().lerp(stemHead, 0.15);
    const head = tack.clone().lerp(fore, 0.86);
    const clew = tack.clone().add(new THREE.Vector3(0, 1.8, l.beam * 0.75));
    gaffSail(canvas, tack, clew, head, head, cloth);
  }

  // Lifeboats: upturned-hull shapes on chocks, port and starboard.
  for (const b of l.boats) {
    const z = at(b.at);
    const y = shape.deckAt(z) + b.base + 0.2;
    for (const side of [-1, 1]) {
      const c = new THREE.Vector3(side * b.x, y, z);
      body.spar(
        c.clone().add(new THREE.Vector3(0, 0.1, -b.length / 2)),
        c.clone().add(new THREE.Vector3(0, 0.1, b.length / 2)),
        0.75,
        color(PALETTE.railWhite),
        0.55,
        6,
      );
    }
  }

  // The cutter's bow gun: a short barrel on a pedestal.
  if (l.gun) {
    const z = at(l.gun.at);
    const y = shape.deckAt(z);
    body.box(
      new THREE.Vector3(-0.35, y - 0.05, z - 0.35),
      new THREE.Vector3(0.35, y + 0.9, z + 0.35),
      color(PALETTE.hullBlack),
    );
    body.spar(
      new THREE.Vector3(0, y + 1, z + 0.6),
      new THREE.Vector3(0, y + 1.15, z - 1.9),
      0.17,
      color(PALETTE.hullBlack),
      0.12,
    );
  }

  // Running lights, at their stations; sidelights on their own side.
  const lamps: Lamp[] = l.lights.map((light) => {
    const x =
      light.kind === 'port' ? -(light.x ?? 0) : light.kind === 'starboard' ? (light.x ?? 0) : 0;
    return {
      kind: light.kind,
      position: new THREE.Vector3(x, deckAt(light.at) + light.height, at(light.at)),
    };
  });

  // Assemble: one scaled frame holds everything.
  const group = new THREE.Group();
  group.name = l.id;
  const frame = new THREE.Group();
  frame.name = `${l.id}-frame`;
  frame.scale.setScalar(displayScale);
  group.add(frame);

  const solid = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
  });
  const hull = new THREE.Mesh(body.build(), solid);
  hull.name = `${l.id}-body`;
  frame.add(hull);

  let windows: THREE.Mesh | undefined;
  if (lit.triangles > 0) {
    windows = new THREE.Mesh(
      lit.build(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }),
    );
    windows.name = `${l.id}-windows`;
    windows.userData['noOutline'] = true;
    frame.add(windows);
  }

  let sails: THREE.Mesh | undefined;
  if (canvas.triangles > 0) {
    sails = new THREE.Mesh(
      canvas.build(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        side: THREE.DoubleSide,
      }),
    );
    sails.name = `${l.id}-sails`;
    frame.add(sails);
  }

  const ropeGeometry = new THREE.BufferGeometry();
  ropeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rope, 3));
  const rigging = new THREE.LineSegments(
    ropeGeometry,
    new THREE.LineBasicMaterial({ color: p.rope, fog: true }),
  );
  rigging.name = `${l.id}-rigging`;
  frame.add(rigging);

  const lights = createRunningLights(lamps, 1.4 / displayScale);
  frame.add(lights.points);

  const triangles = body.triangles + lit.triangles + canvas.triangles;
  const glow = color(PALETTE.windowAmber);
  let litLevel = -1;
  return {
    group,
    lines: l,
    displayScale,
    stacks,
    lights,
    sails,
    triangles,
    update(sunElevationDeg, fogDensity, windFromStarboard) {
      const level = lampLevel(sunElevationDeg);
      lights.update(level, fogDensity);
      if (windows && level !== litLevel) {
        litLevel = level;
        const material = windows.material as THREE.Material & Partial<StylizedMaterial>;
        material.uniforms?.uEmissive.value.copy(glow).multiplyScalar(0.95 * level);
      }
      // Booms and sails go to leeward: the sail mesh is built drawing to starboard.
      if (sails && windFromStarboard !== undefined) sails.scale.x = windFromStarboard ? -1 : 1;
    },
    dispose() {
      group.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.geometry || node === lights.points) return;
        mesh.geometry.dispose();
        if (!node.userData['outline']) (mesh.material as THREE.Material).dispose();
      });
      lights.dispose();
    },
  };
}

/**
 * A four-cornered sail as a cambered patch (a triangle when head = peak), both faces,
 * bellied to +x: tack and clew on the foot, head and peak on the gaff.
 */
function gaffSail(
  soup: TriangleSoup,
  tack: THREE.Vector3,
  clew: THREE.Vector3,
  peak: THREE.Vector3,
  head: THREE.Vector3,
  color: THREE.Color,
): void {
  const N = 4;
  const point = (u: number, v: number): THREE.Vector3 => {
    const foot = tack.clone().lerp(clew, u);
    const top = head.clone().lerp(peak, u);
    const q = foot.lerp(top, v);
    // Deepest a third of the way back from the luff, flat at the edges.
    const chord = tack.distanceTo(clew) * (1 - v) + head.distanceTo(peak) * v + 1;
    q.x += Math.sin(Math.PI * u) ** 1.2 * Math.sin(Math.PI * (0.15 + 0.7 * v)) * chord * 0.08;
    return q;
  };
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = point(i / N, j / N);
      const b = point((i + 1) / N, j / N);
      const c = point((i + 1) / N, (j + 1) / N);
      const d = point(i / N, (j + 1) / N);
      soup.quad(a, b, c, d, color);
    }
  }
}

/**
 * The style B look, as the schooner has it (plan 14 §16): toon bands and ink outlines on
 * the body, edge lines on the sails, the rigging in the shared ink. Windows get no shell.
 */
export function styleNpcShip(
  model: NpcShipModel,
  lighting: StyleLighting,
  outlines: OutlineSettings,
): void {
  creaseNormals(model.group);
  addOutlines(model.group, outlines);
  applyStylizedMaterials(model.group, 'toon', lighting);
  model.group.traverse((node) => {
    if (node instanceof THREE.Line && !(node.material === outlines.lineMaterial)) {
      node.material = outlines.lineMaterial;
    }
  });
}
