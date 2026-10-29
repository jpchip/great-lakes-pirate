import * as THREE from 'three';
import type { SailingState } from '../../sim/sailing/controller';
import { addOutlines, creaseNormals, type OutlineSettings } from '../style/outline';
import { applyStylizedMaterials, type StyleLighting } from '../style/stylized-material';
import { apparentWindFlow, boomTarget, sailHoists, sailShape, swingBoom } from './rig-state';
import { SailMesh, type SailCorners } from './sail-mesh';
import { buildDeckFittings, buildHull, hullShape, type HullShape } from './schooner-hull';
import type { HeadsailLines, MastLines, SchoonerLines } from './schooner-lines';
import { TriangleSoup } from './soup';
import { Streamers } from './streamers';

/**
 * The procedural T1 schooner (plan 14 §5, plan 02 §9 and §13): the parametric hull, a
 * two-masted gaff rig and its sails, built from one `SchoonerLines` record. `update`
 * poses it for a sailing state each frame:
 *
 * - Sails per level (Furled, Reefed, Half, Full) from `sailSetting`, so a sail change
 *   animates as the controller eases the setting: gaffs climb the masts, headsails run
 *   up their stays, furled canvas gathers on the booms and at the tacks.
 * - Booms swing to the sheet (auto-trim's ideal, or the manual trim) on the leeward side
 *   and come across on a tack or slam over on a jibe; the sails' belly follows the boom.
 * - In irons the sails swap to the slack luffing shape and the booms flog on the centerline.
 * - The masthead pennant and the shroud telltales stream with the apparent wind.
 *
 * Built with standard materials, so it also draws in the spike scenes; `styleSchooner`
 * gives it the style B look (toon bands, ink outlines and sail edge lines).
 *
 * Local frame: bow toward -z, starboard +x, waterline at y = 0.
 */

/** The parts of the sailing state the rig reads. */
export type RigInput = Pick<
  SailingState,
  'sailSetting' | 'windAngle' | 'windKn' | 'speed' | 'inIrons' | 'manualTrim' | 'trim' | 'idealTrim'
>;

export interface SchoonerModel {
  readonly group: THREE.Group;
  readonly lines: SchoonerLines;
  /** Pose the rig. `time` (seconds) drives the flutter; `dt` the boom swing. */
  update(state: RigInput, time: number, dt: number): void;
  /** Snap the booms to their targets (no swing), e.g. for a still frame. */
  settle(state: RigInput, time: number): void;
  /** Named sails, for tests and the contact sheet. */
  readonly sails: Readonly<Record<SailName, SailMesh>>;
}

export type SailName = 'fore' | 'main' | 'foreTopsail' | 'mainTopsail' | 'staysail' | 'jib';

const UP = new THREE.Vector3(0, 1, 0);
const AFT = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** A point on a raked mast, `along` meters above its step. */
function mastPoint(shape: HullShape, l: SchoonerLines, m: MastLines, along: number): THREE.Vector3 {
  const z = -l.length / 2 + m.station;
  const rake = m.rakeDeg * DEG;
  return new THREE.Vector3(0, shape.deckAt(z) + Math.cos(rake) * along, z + Math.sin(rake) * along);
}

interface GaffRig {
  lines: MastLines;
  mast: THREE.Group;
  swing: THREE.Group;
  gaff: THREE.Object3D;
  bundle: THREE.Object3D;
  sail: SailMesh;
  topsail: SailMesh;
  /** Current signed boom angle, radians; positive swings the boom end to starboard. */
  angle: number;
  /** Boom end rise, local y, so the boom steeves up a little aft despite the rake. */
  boomRise: number;
}

interface Headsail {
  lines: HeadsailLines;
  tack: THREE.Vector3;
  /** Head with the sail fully hoisted, on its stay. */
  head: THREE.Vector3;
  sail: SailMesh;
  bundle: THREE.Object3D;
}

/** A unit-radius spar along +z from 0 to `length`, for objects scaled or posed whole. */
function sparMesh(
  length: number,
  radius: number,
  topRadius: number,
  color: THREE.Color,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const soup = new TriangleSoup();
  soup.spar(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, length), radius, color, topRadius);
  const mesh = new THREE.Mesh(soup.build(), material);
  mesh.name = name;
  return mesh;
}

export function createSchooner(l: SchoonerLines): SchoonerModel {
  const shape = hullShape(l);
  const half = l.length / 2;
  const spar = new THREE.Color(l.paint.spar);
  const canvasColor = new THREE.Color(l.paint.canvas);

  const solid = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
  });
  const cloth = new THREE.MeshStandardMaterial({
    color: canvasColor,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: l.paint.rope, fog: true });

  const group = new THREE.Group();
  group.name = 'schooner';

  // Hull, deck fittings and the fixed spars: one mesh.
  const fixed = new TriangleSoup();
  buildHull(l, fixed);
  buildDeckFittings(l, shape, fixed);
  for (const m of [l.fore, l.main]) {
    const step = mastPoint(shape, l, m, -0.2);
    const hounds = mastPoint(shape, l, m, m.height);
    const truck = mastPoint(shape, l, m, m.height + m.topmast);
    fixed.spar(step, hounds.clone().addScaledVector(UP, 0.6), 0.2, spar, 0.15);
    fixed.spar(mastPoint(shape, l, m, m.height - 1.2), truck, 0.11, spar, 0.06);
    // Crosstrees and a cap at the hounds.
    fixed.spar(hounds.clone().setX(-0.95), hounds.clone().setX(0.95), 0.06, spar, 0.06, 4);
    fixed.box(
      hounds.clone().add(new THREE.Vector3(-0.22, 0.45, -0.3)),
      hounds.clone().add(new THREE.Vector3(0.22, 0.65, 0.3)),
      spar,
    );
  }
  const steeve = l.bowspritSteeveDeg * DEG;
  const sprit = new THREE.Vector3(0, Math.sin(steeve), -Math.cos(steeve));
  const stem = shape.stemHead.clone().addScaledVector(UP, -0.12);
  const spritEnd = stem.clone().addScaledVector(sprit, l.bowsprit);
  fixed.spar(stem.clone().addScaledVector(sprit, -2.2), spritEnd, 0.17, spar, 0.08);
  const hull = new THREE.Mesh(fixed.build(), solid);
  hull.name = 'schooner-hull';
  group.add(hull);

  // The gaff rigs: a raked mast frame, and a swing frame about the mast for the boom.
  const rig = (m: MastLines, name: string): GaffRig => {
    const mast = new THREE.Group();
    mast.position.copy(mastPoint(shape, l, m, 0));
    mast.rotation.x = m.rakeDeg * DEG;
    mast.name = `${name}-mast`;
    const swing = new THREE.Group();
    swing.position.y = m.gooseneck;
    swing.rotation.order = 'YXZ';
    mast.add(swing);
    group.add(mast);

    const boomRise = Math.tan(m.rakeDeg * DEG) * m.boom + 0.3;
    const boom = sparMesh(m.boom, 0.11, 0.08, spar, solid, `${name}-boom`);
    boom.rotation.x = -Math.atan2(boomRise, m.boom);
    swing.add(boom);
    const gaff = sparMesh(m.gaff, 0.09, 0.06, spar, solid, `${name}-gaff`);
    swing.add(gaff);
    const bundle = sparMesh(m.boom * 0.86, 1, 0.55, canvasColor, solid, `${name}-furl`);
    bundle.position.set(0, 0.2, 0.45);
    bundle.rotation.x = boom.rotation.x;
    swing.add(bundle);

    const sail = new SailMesh(cloth, edgeMaterial, `${name}-sail`);
    const topsail = new SailMesh(cloth, edgeMaterial, `${name}-topsail`);
    swing.add(sail.mesh, topsail.mesh);
    return { lines: m, mast, swing, gaff, bundle, sail, topsail, angle: 0, boomRise };
  };
  const fore = rig(l.fore, 'fore');
  const main = rig(l.main, 'main');

  // Headsails on their stays: the staysail from the fore hounds to the stem, the jib from
  // the fore topmast head to the end of the bowsprit.
  const foreHounds = mastPoint(shape, l, l.fore, l.fore.height);
  const foreTruck = mastPoint(shape, l, l.fore, l.fore.height + l.fore.topmast);
  const foreDeck = shape.deckAt(-half + l.fore.station);
  const headsail = (h: HeadsailLines, stayTop: THREE.Vector3, name: string): Headsail => {
    const tack = stem.clone().addScaledVector(sprit, h.tackOut).addScaledVector(UP, 0.15);
    const k = (foreDeck + h.headHeight - tack.y) / (stayTop.y - tack.y);
    const head = tack.clone().lerp(stayTop, k);
    const sail = new SailMesh(cloth, edgeMaterial, `${name}-sail`);
    group.add(sail.mesh);
    // Lowered, the hanked sail gathers at the foot of its stay.
    const bundle = sparMesh(1.3, 1, 0.5, canvasColor, solid, `${name}-furl`);
    bundle.position.copy(tack);
    bundle.quaternion.setFromUnitVectors(AFT, head.clone().sub(tack).normalize());
    group.add(bundle);
    return { lines: h, tack, head, sail, bundle };
  };
  const staysail = headsail(l.staysail, foreHounds, 'staysail');
  const jib = headsail(l.jib, foreTruck, 'jib');

  // Standing rigging: shrouds, stays, the bobstay and the bowsprit shrouds.
  const rope: number[] = [];
  const line = (a: THREE.Vector3, b: THREE.Vector3): void => {
    rope.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  const chainplate = (z: number, side: number): THREE.Vector3 =>
    new THREE.Vector3(side * (shape.railHalfBreadthAt(z) + 0.04), shape.sheerAt(z) - 0.3, z);
  const telltaleAnchors: THREE.Vector3[] = [];
  for (const m of [l.fore, l.main]) {
    const hounds = mastPoint(shape, l, m, m.height);
    const truck = mastPoint(shape, l, m, m.height + m.topmast);
    const z = -half + m.station;
    for (const side of [-1, 1]) {
      for (const dz of [-0.8, 0, 0.8]) {
        line(chainplate(z + dz + 0.3, side), hounds.clone().setX(side * 0.25));
      }
      // Topmast shrouds over the crosstree ends.
      line(hounds.clone().setX(side * 0.95), truck.clone().setX(side * 0.06));
      // A wool telltale on the middle shroud, at eye height above the rail.
      const foot = chainplate(z + 0.3, side);
      const top = hounds.clone().setX(side * 0.25);
      telltaleAnchors.push(foot.lerp(top, 2.4 / (top.y - foot.y)));
    }
  }
  const mainHounds = mastPoint(shape, l, l.main, l.main.height);
  const mainTruck = mastPoint(shape, l, l.main, l.main.height + l.main.topmast);
  line(foreHounds, staysail.tack);
  line(foreTruck, spritEnd);
  line(mainHounds, foreHounds.clone().addScaledVector(UP, 0.4));
  line(mainTruck, foreTruck);
  line(spritEnd, new THREE.Vector3(0, 0.15, -half + l.stemRake * 0.5));
  for (const side of [-1, 1]) {
    line(stem.clone().addScaledVector(sprit, l.bowsprit * 0.6), chainplate(-half + 1.2, side));
    // Backstays from the main topmast to the quarters.
    line(mainTruck.clone().setX(side * 0.06), chainplate(half - 2.4, side));
  }
  const standing = new THREE.BufferGeometry();
  standing.setAttribute('position', new THREE.Float32BufferAttribute(rope, 3));
  const rigging = new THREE.LineSegments(standing, edgeMaterial);
  rigging.name = 'schooner-rigging';
  group.add(rigging);

  // Running rigging that moves: the four sheets.
  const sheetPositions = new Float32Array(4 * 2 * 3);
  const sheetGeometry = new THREE.BufferGeometry();
  sheetGeometry.setAttribute('position', new THREE.BufferAttribute(sheetPositions, 3));
  const sheets = new THREE.LineSegments(sheetGeometry, edgeMaterial);
  sheets.name = 'schooner-sheets';
  sheets.frustumCulled = false;
  group.add(sheets);

  // Pennant at the main truck and the telltales, in one streamer mesh.
  const streamers = new Streamers(new THREE.Color(l.paint.pennant), [
    { anchor: mainTruck.clone().addScaledVector(UP, 0.2), length: 4.2, width: 0.42, taper: 1 },
    ...telltaleAnchors.map((anchor) => ({ anchor, length: 0.75, width: 0.07, taper: 0.4 })),
  ]);
  group.add(streamers.mesh);

  const flow = { x: 0, z: 0 };
  const belly = new THREE.Vector3();
  const corners: SailCorners = {
    tack: new THREE.Vector3(),
    clew: new THREE.Vector3(),
    peak: new THREE.Vector3(),
    head: new THREE.Vector3(),
  };
  const gaffDir = new THREE.Vector3();
  const v = new THREE.Vector3();

  const poseGaffRig = (
    r: GaffRig,
    hoist: number,
    topsail: number,
    luffing: boolean,
    windSide: number,
    time: number,
  ): void => {
    const m = r.lines;
    // Flogging in irons: the boom works a little either side of the centerline.
    const flog = luffing && hoist > 0 ? 0.05 * Math.sin(time * 4.1 + m.station) : 0;
    r.swing.rotation.y = r.angle + flog;

    const low = 0.55;
    const throat = low + (m.throat - m.gooseneck - low) * hoist;
    // Lowered, the gaff comes down nearly level onto the furled sail.
    const peak = 0.06 + ((m.peakDeg + m.rakeDeg) * DEG - 0.06) * smooth(hoist);
    r.gaff.position.set(0, throat, 0.12);
    r.gaff.rotation.x = -peak;
    gaffDir.set(0, Math.sin(-r.gaff.rotation.x), Math.cos(r.gaff.rotation.x));

    const furl = 1 - hoist;
    r.bundle.visible = furl > 0.04;
    const radius = 0.05 + 0.2 * furl;
    r.bundle.scale.set(radius, radius, 1);

    const side = r.angle > 0.02 ? 1 : r.angle < -0.02 ? -1 : windSide;
    belly.set(side, 0, 0);
    r.sail.visible = hoist > 0.02;
    if (r.sail.visible) {
      corners.tack.set(0, 0.22, 0.3);
      corners.clew.set(0, r.boomRise * ((m.boom - 0.3) / m.boom) + 0.22, m.boom - 0.3);
      corners.head.set(0, throat - 0.12, 0.3);
      corners.peak
        .copy(r.gaff.position)
        .addScaledVector(gaffDir, m.gaff - 0.25)
        .addScaledVector(UP, -0.12);
      r.sail.shape(`${hoist.toFixed(3)}|${side}|${luffing}`, corners, {
        belly,
        camber: l.camber,
        luffing,
      });
    }
    r.topsail.visible = topsail > 0.02 && hoist > 0.98;
    if (r.topsail.visible) {
      // A triangle: tack at the gaff jaws, head up the topmast, clew at the gaff end.
      corners.tack.set(0, throat + 0.35, 0.3);
      corners.head
        .set(0, m.height + m.topmast - m.gooseneck - 0.4, 0.28)
        .lerp(corners.tack, 1 - topsail);
      corners.clew
        .copy(r.gaff.position)
        .addScaledVector(gaffDir, m.gaff - 0.1)
        .lerp(corners.tack, 1 - topsail);
      corners.peak.copy(corners.head);
      r.topsail.shape(`${topsail.toFixed(3)}|${side}|${luffing}`, corners, {
        belly,
        camber: l.camber * 0.8,
        luffing,
      });
    }
  };

  const poseHeadsail = (
    h: Headsail,
    hoist: number,
    sheetAngle: number,
    luffing: boolean,
    windSide: number,
  ): void => {
    h.bundle.visible = hoist < 0.96;
    const radius = 0.04 + 0.1 * (1 - hoist);
    h.bundle.scale.set(radius, radius, 1);
    h.sail.visible = hoist > 0.02;
    if (!h.sail.visible) return;
    const f = h.lines;
    corners.tack.copy(h.tack);
    corners.head.lerpVectors(h.tack, h.head, hoist);
    corners.peak.copy(corners.head);
    corners.clew
      .set(Math.sin(sheetAngle) * f.foot, f.clewRise, Math.cos(sheetAngle) * f.foot)
      .multiplyScalar(hoist)
      .add(h.tack);
    const side = sheetAngle > 0.02 ? 1 : sheetAngle < -0.02 ? -1 : windSide;
    belly
      .subVectors(corners.clew, corners.tack)
      .cross(v.subVectors(corners.head, corners.tack))
      .normalize();
    if (belly.x * side < 0) belly.negate();
    h.sail.shape(`${hoist.toFixed(3)}|${sheetAngle.toFixed(3)}|${luffing}`, corners, {
      belly,
      camber: l.camber * 0.85,
      luffing,
    });
  };

  const sheetEnd = new THREE.Vector3();
  const headClew = new THREE.Vector3();
  const writeSheet = (i: number, from: THREE.Vector3, to: THREE.Vector3): void => {
    sheetPositions.set([from.x, from.y, from.z, to.x, to.y, to.z], i * 6);
  };
  const boomEnd = (r: GaffRig, out: THREE.Vector3): THREE.Vector3 => {
    r.mast.updateMatrix();
    r.swing.updateMatrix();
    out.set(0, r.boomRise * 0.95, r.lines.boom - 0.35);
    return out.applyMatrix4(r.swing.matrix).applyMatrix4(r.mast.matrix);
  };
  const poseSheets = (hoists: { staysail: number; jib: number }, lee: number): void => {
    for (const [i, r] of [fore, main].entries()) {
      const end = boomEnd(r, v);
      const z = Math.min(end.z, half - 0.5);
      writeSheet(i, end, sheetEnd.set(0, shape.deckAt(z) + 0.1, z));
    }
    for (const [i, h] of [staysail, jib].entries()) {
      const hoist = i === 0 ? hoists.staysail : hoists.jib;
      if (hoist <= 0.02) {
        writeSheet(2 + i, h.tack, h.tack);
        continue;
      }
      const sheetAngle = headsailSheet(fore.angle);
      const clew = headClew
        .set(
          Math.sin(sheetAngle) * h.lines.foot,
          h.lines.clewRise,
          Math.cos(sheetAngle) * h.lines.foot,
        )
        .multiplyScalar(hoist)
        .add(h.tack);
      const z = Math.min(clew.z + 1.8, half);
      writeSheet(2 + i, clew, sheetEnd.set(lee * shape.railHalfBreadthAt(z), shape.sheerAt(z), z));
    }
    sheetGeometry.getAttribute('position').needsUpdate = true;
  };

  const pose = (state: RigInput, time: number, dt: number | undefined): void => {
    const hoists = sailHoists(state.sailSetting, l.reefedHoist);
    const luffing = sailShape(state) === 'luffing';
    const windSide = Number.isFinite(state.windAngle) && state.windAngle < 0 ? 1 : -1;
    const jibing = Number.isFinite(state.windAngle) && Math.abs(state.windAngle) > Math.PI / 2;
    for (const r of [fore, main]) {
      const target = boomTarget(state, hoists.gaff);
      if (dt === undefined) r.angle = target;
      else {
        const crossing = Math.sign(target) !== Math.sign(r.angle) && r.angle !== 0;
        r.angle = swingBoom(r.angle, target, dt, crossing && jibing);
      }
    }
    poseGaffRig(fore, hoists.gaff, hoists.topsail, luffing, windSide, time);
    poseGaffRig(main, hoists.gaff, hoists.topsail, luffing, windSide, time);
    const sheetAngle = headsailSheet(fore.angle);
    poseHeadsail(staysail, hoists.staysail, sheetAngle, luffing, windSide);
    poseHeadsail(jib, hoists.jib, sheetAngle, luffing, windSide);
    poseSheets(hoists, Math.sign(sheetAngle) || windSide);
    streamers.update(apparentWindFlow(state, flow), time);
  };

  return {
    group,
    lines: l,
    sails: {
      fore: fore.sail,
      main: main.sail,
      foreTopsail: fore.topsail,
      mainTopsail: main.topsail,
      staysail: staysail.sail,
      jib: jib.sail,
    },
    update: (state, time, dt) => pose(state, time, dt),
    settle: (state, time) => pose(state, time, undefined),
  };
}

/** Headsails sheet a little closer than the foresail's boom. */
function headsailSheet(foreBoomAngle: number): number {
  return foreBoomAngle * 0.75;
}

/**
 * The style B look (plan 14 §16): toon bands with creased normals, inverted-hull ink
 * outlines on the hull and spars, and the sails' and rigging's lines in the shared ink.
 */
export function styleSchooner(
  model: SchoonerModel,
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
