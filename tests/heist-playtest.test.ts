import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import bayfieldJson from '../data/districts/bayfield.json';
import districtsJson from '../data/districts.json';
import { districtsFileSchema } from '../data/schemas/districts';
import { buildDistrict } from '../src/gameplay/district/district';
import { DistrictNav } from '../src/gameplay/district/district-nav';
import { decodeGround } from '../src/gameplay/district/ground';
import { DEFAULT_CONTROLLER } from '../src/gameplay/onfoot/controller';
import { gameHeist, rollContents } from '../src/gameplay/onfoot/heist';
import { NavMesh, type NavMeshData } from '../src/sim/district/navmesh';
import { parseLayout } from '../src/sim/district/layout';

/**
 * Phase 7 exit criterion 1 (plan 08 §20.3): a full non-lethal warehouse heist in Bayfield
 * takes 5–15 real minutes from going ashore to casting off. Nobody can hold a stopwatch
 * in the cloud container, so this works the time out from the district as built: the
 * walked distance from the fish pier's gangway to each of Hollister's stacks on the baked
 * navmesh, sneaking in and walking out a crate at a time, the lock and the lifts. The
 * waiting on a guard's back is the player's; a careful one adds a few minutes to this.
 */

const dir = join(import.meta.dirname, '..', 'public', 'districts', 'bayfield');
const groundPath = join(dir, 'ground.bin');
const baked = existsSync(groundPath) && readFileSync(groundPath).byteLength > 200;

const length = (p: { x: number; z: number }[]): number =>
  p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - (p[i]?.x ?? 0), q.z - (p[i]?.z ?? 0)), 0);

describe.skipIf(!baked)('how long the Hollister warehouse takes (§20.3 #1)', () => {
  it('is five to fifteen minutes of walking, picking and carrying', () => {
    const model = buildDistrict(
      parseLayout(structuredClone(bayfieldJson)),
      decodeGround(new Uint8Array(readFileSync(groundPath))),
    );
    const mesh = new NavMesh(
      JSON.parse(readFileSync(join(dir, 'navmesh.json'), 'utf8')) as NavMeshData,
    );
    const nav = new DistrictNav(mesh, (x, z) => model.floorAt(x, z));
    const defs = gameHeist();
    const target = districtsFileSchema
      .parse(districtsJson)[0]
      ?.targets.find((t) => t.building === 'hollister_warehouse');
    if (!target) throw new Error('no Hollister warehouse');
    const gangway = model.mark('gangway.fish_pier');
    const lock = defs.locks.tiers[String(target.lock?.tier ?? 1) as '1'];
    const carry = DEFAULT_CONTROLLER.walkSpeed * defs.loot.carry.walk;
    let seconds = lock?.pickS ?? 0;
    let crates = 0;
    for (const c of target.containers) {
      const mark = model.mark(c.mark);
      const path = nav.findPath(gangway, mark);
      expect(path, c.mark).toBeDefined();
      const m = length(path ?? []);
      const table = defs.tables.get(c.table);
      if (!table) throw new Error(`no table ${c.table}`);
      const n = Object.values(rollContents(table, 'glp-2', 0, 1).crates).reduce((a, b) => a + b, 0);
      crates += n;
      // In sneaking with empty hands, out at a loaded walk, a lift each time.
      seconds += n * (m / DEFAULT_CONTROLLER.sneakSpeed + m / carry + 0.8);
    }
    const minutes = seconds / 60;
    console.log(`Hollister's: ${crates} crates in ${minutes.toFixed(1)} min`);
    expect(crates).toBeGreaterThanOrEqual(3);
    expect(minutes).toBeGreaterThan(5);
    expect(minutes).toBeLessThan(15);
  });
});
