// Bakes each docks district's ground and guard navmesh (plan 08 §5.3, §15; Phase 7 piece
// C): `npm run district:bake` (all) or `DISTRICT=bayfield npm run district:bake`.
//
// For each district in data/districts.json:
// 1. samples the zone heightmap under the layout at 1 m (bounds plus the skirt) →
//    public/districts/<bake>/ground.bin
// 2. builds the district from data/districts/<layout> on that ground, hands recast the
//    ground and every collider with the doorways shut, keeps what joins the gangway, links
//    each door's two sides → public/districts/<bake>/navmesh.json
// 3. writes a short report → tools/district/reports/<bake>.md
//
// Needs the zone tiles from Git LFS (`git lfs pull`).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { init } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { it } from 'vitest';
import { buildDistrict } from '../../src/sim/district/district';
import {
  DISTRICTS,
  districtFootprint,
  districtFrame,
  encodeGround,
  sampleGround,
} from '../../src/sim/district/ground';
import { parseLayout } from '../../src/sim/district/layout';
import { finishNavMesh, GUARD_AGENT, navGeometry, type RawNavMesh } from '../../src/sim/district/nav-bake';
import { loadZoneTerrain } from '../../src/sim/terrain/load';
import { manifestFrame } from '../../src/sim/terrain/zones';

const root = join(import.meta.dirname, '..', '..');
/** Voxel size across and up, meters. */
const CS = 0.2;
const CH = 0.1;

it('bakes the districts', async () => {
  await init();
  const only = process.env['DISTRICT'];
  const zoneDir = join(root, 'public', 'world', 'apostles');
  const zone = await loadZoneTerrain(async (p) => new Uint8Array(readFileSync(join(zoneDir, p))));
  const frame = manifestFrame(zone.manifest);

  for (const def of DISTRICTS) {
    if (only && !def.id.endsWith(only)) continue;
    const t0 = performance.now();
    const layout = parseLayout(JSON.parse(readFileSync(join(root, 'data', 'districts', def.layout), 'utf8')));
    const local = districtFrame(def, districtFootprint(def, frame));
    const ground = sampleGround(def, layout, local, zone.terrain);
    const outDir = join(root, 'public', 'districts', def.bake);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'ground.bin'), encodeGround(ground));

    const model = buildDistrict(layout, ground, def.waterLevelM);
    const soup = navGeometry(model);
    const result = generateSoloNavMesh(soup.positions, soup.indices, {
      cs: CS,
      ch: CH,
      walkableSlopeAngle: GUARD_AGENT.maxSlopeDeg,
      walkableHeight: Math.ceil(GUARD_AGENT.heightM / CH),
      walkableClimb: Math.floor(GUARD_AGENT.climbM / CH),
      walkableRadius: Math.ceil(GUARD_AGENT.radiusM / CS),
      maxEdgeLen: Math.round(12 / CS),
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });
    if (!result.success) throw new Error(`${def.id}: recast failed: ${result.error}`);
    const raw = extract(result.navMesh);
    result.navMesh.destroy();

    const gangway = model.mark(def.gangway);
    const { data, report } = finishNavMesh(raw, model, {
      x: gangway.x,
      y: model.floorAt(gangway.x, gangway.z),
      z: gangway.z,
    });
    const json = JSON.stringify(data);
    writeFileSync(join(outDir, 'navmesh.json'), json);

    const ms = performance.now() - t0;
    const lines = [
      `# ${def.name} (${def.id})`,
      '',
      `Baked by \`npm run district:bake\` from data/districts/${def.layout} (layout ${data.layoutHash}).`,
      '',
      `- Ground: ${ground.samplesX} × ${ground.samplesZ} samples at 1 m, ${(encodeGround(ground).byteLength / 1024).toFixed(0)} KB`,
      `- Colliders: ${model.colliders.size}; doors ${model.doors.length}; lamps ${model.lamps.length}; buildings ${model.buildings.length}`,
      `- Recast input: ${soup.indices.length / 3} triangles; voxels ${CS} m × ${CH} m`,
      `- Navmesh: ${report.join('; ')}; ${(json.length / 1024).toFixed(0)} KB`,
      `- Bake time: ${(ms / 1000).toFixed(1)} s`,
      '',
    ];
    mkdirSync(join(root, 'tools', 'district', 'reports'), { recursive: true });
    writeFileSync(join(root, 'tools', 'district', 'reports', `${def.bake}.md`), lines.join('\n'));
    console.log(lines.join('\n'));
  }
});

/** Polygons and neighbors out of a one-tile Detour navmesh. */
function extract(navMesh: import('recast-navigation').NavMesh): RawNavMesh {
  const tile = navMesh.getTile(0);
  const header = tile.header();
  if (!header) throw new Error('navmesh: empty tile');
  const vertCount = header.vertCount();
  const verts: number[] = [];
  for (let k = 0; k < vertCount * 3; k++) verts.push(tile.verts(k));
  const polys: number[][] = [];
  const neis: number[][] = [];
  const polyCount = header.polyCount();
  for (let i = 0; i < polyCount; i++) {
    const p = tile.polys(i);
    if (p.getType() !== 0) continue; // off-mesh connections: none are made
    const n = p.vertCount();
    const vs: number[] = [];
    const ns: number[] = [];
    for (let j = 0; j < n; j++) {
      vs.push(p.verts(j));
      const nei = p.neis(j);
      ns.push(nei === 0 || nei & 0x8000 ? -1 : nei - 1);
    }
    polys.push(vs);
    neis.push(ns);
  }
  return { verts, polys, neis };
}
