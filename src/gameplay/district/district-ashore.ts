import type { DistrictDef } from '../../../data/schemas/districts';
import { NavMesh, type NavMeshData } from '../../sim/district/navmesh';
import { parseLayout, type DistrictLayout } from '../../sim/district/layout';
import type { Pose } from '../../sim/terrain/test-bay';
import { bearingBox, type AshoreScene } from '../onfoot/ashore-scene';
import type { BoxCollider } from '../onfoot/colliders';
import type { Heightfield } from '../onfoot/heightfield';
import { buildDistrict, type DistrictModel } from './district';
import { DistrictNav } from './district-nav';
import { decodeGround, DISTRICTS, type DistrictFrame } from './ground';

/**
 * A docks district as the scene you walk when you go ashore at its harbor (plan 08 §2,
 * §20.4 pieces A and C; Phase 7). Piece A's stand-in builds every landing from the zone's
 * terrain and the harbor kit; at a harbor with a district (Bayfield), a berth whose gangway
 * lies inside the district lands you in it instead: the kit's piers, warehouses, lamps and
 * the baked navmesh the guards walk.
 *
 * The district runs in its own local meters (x along the shore, z inland), so the on-foot
 * sim, the camera and the guards all work there; `frame` turns places into the zone's
 * meters for the renderer and the save.
 */

/** Everything loaded once for a district: the layout, the baked ground and navmesh. */
export interface DistrictAssets {
  def: DistrictDef;
  layout: DistrictLayout;
  ground: Heightfield;
  /** Missing only if the district was never baked (a dev checkout without LFS). */
  navmesh: NavMeshData | undefined;
}

export interface DistrictLanding {
  def: DistrictDef;
  model: DistrictModel;
  nav: DistrictNav | undefined;
  frame: DistrictFrame;
  /** The district as an ashore scene in local meters: the schooner's hull added. */
  scene: AshoreScene;
}

export function districtForHarbor(harborId: string): DistrictDef | undefined {
  return DISTRICTS.find((d) => d.harbor === harborId);
}

const layouts = import.meta.glob<unknown>('../../../data/districts/*.json', {
  eager: true,
  import: 'default',
});

export function districtLayout(def: DistrictDef): DistrictLayout {
  const json = layouts[`../../../data/districts/${def.layout}`];
  if (!json) throw new Error(`district ${def.id}: no layout ${def.layout}`);
  return parseLayout(structuredClone(json));
}

/** Reads a baked file by its path under `public/` (fetch in the game, the disk in tests). */
export type ReadBaked = (path: string) => Promise<Uint8Array | undefined>;

export const fetchBaked: ReadBaked = async (path) => {
  const base = import.meta.env.BASE_URL ?? '/';
  const r = await fetch(`${base}${path}`);
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined;
};

const cache = new Map<string, Promise<DistrictAssets | undefined>>();

/** The district's layout, ground and navmesh, loaded once and kept. */
export function loadDistrictAssets(
  def: DistrictDef,
  read: ReadBaked = fetchBaked,
): Promise<DistrictAssets | undefined> {
  let p = cache.get(def.id);
  if (!p) {
    p = (async () => {
      const dir = `districts/${def.bake}/`;
      const [groundBytes, navBytes] = await Promise.all([
        read(`${dir}ground.bin`),
        read(`${dir}navmesh.json`),
      ]);
      // An LFS pointer is a hundred-odd bytes of text: not baked here.
      if (!groundBytes || groundBytes.byteLength < 200) return undefined;
      const navmesh = navBytes
        ? (JSON.parse(new TextDecoder().decode(navBytes)) as NavMeshData)
        : undefined;
      return { def, layout: districtLayout(def), ground: decodeGround(groundBytes), navmesh };
    })().catch(() => undefined);
    cache.set(def.id, p);
  }
  return p;
}

/** The schooner's hull as a box in the district's frame. */
export function shipCollider(
  frame: DistrictFrame,
  pose: Pose,
  hull: { lengthM: number; beamM: number; deckM: number },
): BoxCollider {
  const at = frame.toLocal(pose);
  return bearingBox(
    at.x,
    at.z,
    frame.headingToLocal(pose.heading),
    hull.beamM,
    hull.lengthM,
    -2.5,
    hull.deckM + 1,
    'wood',
  );
}

/** Builds the district for one landing, with the schooner alongside. */
export function landInDistrict(
  assets: DistrictAssets,
  frame: DistrictFrame,
  ship: BoxCollider | undefined,
): DistrictLanding {
  const model = buildDistrict(assets.layout, assets.ground, assets.def.waterLevelM);
  if (ship) model.colliders.add(ship);
  const nav = assets.navmesh
    ? new DistrictNav(new NavMesh(assets.navmesh), (x, z) => model.floorAt(x, z))
    : undefined;
  const scene: AshoreScene = {
    ground: model.ground,
    colliders: model.colliders,
    waterLevel: model.waterLevel,
    ladders: [],
    surfaceAt: (x, z) => model.surfaceAt(x, z),
    bounds: { minX: model.minX, minZ: model.minZ, maxX: model.maxX, maxZ: model.maxZ },
    ship,
  };
  return { def: assets.def, model, nav, frame, scene };
}

/** Whether a local point is on the district's walkable ground (inside its bounds). */
export function insideDistrict(model: DistrictModel, x: number, z: number, padM = 2): boolean {
  return (
    x > model.minX + padM && x < model.maxX - padM && z > model.minZ + padM && z < model.maxZ - padM
  );
}
