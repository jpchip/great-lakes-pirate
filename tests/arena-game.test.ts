import { describe, expect, it } from 'vitest';
import { chartToZone, zoneToChart, type Chart } from '../src/core/coords';
import {
  ARENA_HALF_M,
  CAUGHT_RANGE_M,
  LOOK_HOLD_S,
  SQUALL_RIDE_S,
  arenaStatus,
  createArenaRun,
  layoutArena,
  stepArenaRun,
  type ArenaInputs,
} from '../src/sim/arena/arena';
import { coastRuns } from '../src/sim/arena/coast';
import {
  CONTACT_CLASS,
  DEV_ARENA_AT_GEO,
  DEV_ENCOUNTERS,
  arenaFromChartEncounter,
  devEncounter,
} from '../src/sim/arena/encounter';
import { OPEN_LAKE, clearArenaCentre, sampleArenaLand } from '../src/sim/arena/land';
import {
  PASSING_MARGIN_M,
  createHelm,
  steerShips,
  type SteeredShip,
  type Traffic,
} from '../src/sim/arena/steering';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { distance, isWater } from '../src/sim/chart/geography';
import type { Contact, ContactKind } from '../src/sim/chart/traffic';
import { SHIP_RECORDS } from '../src/sim/sailing/ships';
import { arenaFrame } from '../src/sim/arena/arena';

const DEG = Math.PI / 180;
const geo = westernSuperiorChart();
const devAt = geo.projection.geoToChart(DEV_ARENA_AT_GEO);

function record(id: string) {
  const r = SHIP_RECORDS.find((s) => s.id === id);
  if (!r) throw new Error(id);
  return r;
}

function ship(id: string, x: number, z: number, heading: number, hunting = false): SteeredShip {
  const r = record(id);
  const kn = r.propulsion === 'steam' ? r.engineSpeedKn : r.hullMaxSpeedKn;
  return {
    x,
    z,
    vx: 0,
    vz: 0,
    heading,
    lengthM: r.lengthM * r.displayScale,
    helm: createHelm(r, heading, kn, hunting),
  };
}

/** Moves the ships on their velocities, the way the velocity system does. */
function run(
  ships: SteeredShip[],
  seconds: number,
  player?: Traffic,
  land = OPEN_LAKE,
  each?: () => void,
): void {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    steerShips(ships, player, land, dt);
    for (const s of ships) {
      s.x += s.vx * dt;
      s.z += s.vz * dt;
    }
    if (player) {
      player.x += player.vx * dt;
      player.z += player.vz * dt;
    }
    each?.();
  }
}

describe('arena encounters', () => {
  it('has a dev check for every kind §20.3 criterion 5 names', () => {
    for (const id of DEV_ENCOUNTERS) {
      const enc = devEncounter(id, devAt, 0);
      expect(enc.at).toEqual(devAt);
      if (id === 'squall' || id === 'fogbank') expect(enc.ships).toHaveLength(0);
      else expect(enc.ships.length).toBeGreaterThan(0);
      for (const s of enc.ships) expect(() => record(s.classId)).not.toThrow();
    }
    // Every NPC class in ships.json can be met.
    const met = new Set(
      DEV_ENCOUNTERS.flatMap((id) => devEncounter(id, devAt, 0).ships.map((s) => s.classId)),
    );
    for (const r of SHIP_RECORDS.filter((r) => r.role === 'npc')) expect(met.has(r.id)).toBe(true);
    expect(devEncounter('derelict', devAt, 0).ships[0]?.derelict).toBe(true);
    expect(devEncounter('cutter', devAt, 0).ships[0]?.hostile).toBe(true);
  });

  it('turns an S8 chart encounter into an arena', () => {
    const kinds: ContactKind[] = ['freighter', 'steamer', 'tug', 'cutter', 'derelict', 'storm'];
    for (const kind of kinds) {
      const contact: Contact = {
        id: `c.${kind}`,
        kind,
        name: kind,
        pos: devAt,
        heading: 1,
        speedKn: 9,
        conspicuity: 1,
        hostile: kind === 'cutter',
        threat: kind === 'cutter',
        prize: false,
      };
      const enc = arenaFromChartEncounter(
        { contact, forced: false, distanceM: 5000, bearing: 0.5 },
        devAt,
        2,
      );
      expect(enc.contactId).toBe(contact.id);
      expect(enc.playerHeading).toBe(2);
      if (kind === 'storm') {
        expect(enc.kind).toBe('squall');
        continue;
      }
      expect(enc.ships[0]?.classId).toBe(CONTACT_CLASS[kind]);
      expect(enc.ships[0]?.heading).toBe(1);
      if (kind === 'derelict') expect(enc.ships[0]?.speedKn).toBe(0);
    }
  });

  it('puts the player off on the bearing the ship was sighted on, as they sailed', () => {
    const enc = devEncounter('freighter', devAt, 40 * DEG);
    const layout = layoutArena(enc, devAt, OPEN_LAKE);
    const p = layout.player;
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(650, 0);
    // The ship is on the player's bearing.
    const b = Math.atan2(0 - p.x, -(0 - p.z));
    expect(Math.cos(b - enc.bearing)).toBeCloseTo(1, 5);
    expect(p.heading).toBe(enc.playerHeading);
    expect(layout.ships[0]?.pose).toMatchObject({ x: 0, z: 0 });
    // The convoy's consort sits astern of the freighter.
    const convoy = layoutArena(devEncounter('convoy', devAt, 0), devAt, OPEN_LAKE);
    expect(convoy.ships).toHaveLength(3);
  });
});

describe('arena land', () => {
  it('the default check point is open water', () => {
    expect(isWater(geo, devAt)).toBe(true);
    const land = sampleArenaLand(geo, arenaFrame(devAt), 900);
    expect(land.allWater).toBe(true);
  });

  it('samples the chart land mask the same as isWater', () => {
    // Off Two Harbors, where the North Shore runs through the arena.
    const at = geo.projection.geoToChart({ lat: 47.0, lon: -91.62 });
    const frame = arenaFrame(at);
    const land = sampleArenaLand(geo, frame, ARENA_HALF_M);
    expect(land.allWater).toBe(false);
    let agree = 0;
    let total = 0;
    for (let x = -1400; x <= 1400; x += 97) {
      for (let z = -1400; z <= 1400; z += 101) {
        total++;
        if (land.isLand(x, z) === !isWater(geo, zoneToChart({ x, z }, frame))) agree++;
      }
    }
    // Cells are 25 m; points near the shore can fall either side.
    expect(agree / total).toBeGreaterThan(0.97);
  });

  it('moves an arena met against the shore out into clear water', () => {
    const at = geo.projection.geoToChart({ lat: 47.0, lon: -91.62 });
    const centre = clearArenaCentre(geo, at, 900);
    expect(distance(centre, at)).toBeGreaterThan(0);
    expect(distance(centre, at)).toBeLessThan(20_000);
    const land = sampleArenaLand(geo, arenaFrame(centre), 900);
    expect(land.allWater).toBe(true);
    // Open water stays where it is.
    expect(clearArenaCentre(geo, devAt, 900)).toEqual(devAt);
  });

  it('draws coast silhouettes with the land on their inland side', () => {
    const at = geo.projection.geoToChart({ lat: 46.9, lon: -91.4 });
    const frame = arenaFrame(at);
    const runs = coastRuns(geo, frame);
    expect(runs.length).toBeGreaterThan(0);
    let inland = 0;
    let n = 0;
    for (const r of runs) {
      for (const p of r.points) {
        expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(6000);
        n++;
        const c: Chart = zoneToChart({ x: p.x + p.nx * 30, z: p.z + p.nz * 30 }, frame);
        if (!isWater(geo, c)) inland++;
      }
    }
    expect(n).toBeGreaterThan(50);
    expect(inland / n).toBeGreaterThan(0.85);
    // An island too: the Apostles from off Sand Island.
    const off = arenaFrame(geo.projection.geoToChart({ lat: 47.05, lon: -90.98 }));
    const isl = coastRuns(geo, off).filter((r) => r.ringId.startsWith('island'));
    expect(isl.length).toBeGreaterThan(0);
    const q = isl[0]?.points[0];
    if (q)
      expect(isWater(geo, zoneToChart({ x: q.x + q.nx * 30, z: q.z + q.nz * 30 }, off))).toBe(
        false,
      );
    expect(chartToZone(off.origin, off)).toEqual({ x: 0, z: -0 });
  });
});

describe('arena steering', () => {
  it('two steamers meeting end on both give way to starboard and pass clear', () => {
    const a = ship('ship.package_steamer', 0, 900, 0);
    const b = ship('ship.ore_freighter', 20, -900, Math.PI);
    let closest = Infinity;
    run([a, b], 240, undefined, OPEN_LAKE, () => {
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
    });
    expect(closest).toBeGreaterThan((a.lengthM + b.lengthM) / 2);
    expect(closest).toBeGreaterThan(PASSING_MARGIN_M);
    // And both came back to their courses after.
    expect(Math.cos(a.heading - 0)).toBeGreaterThan(0.95);
    expect(Math.cos(b.heading - Math.PI)).toBeGreaterThan(0.95);
  });

  it('gives way to the player standing on across its bow', () => {
    const tug = ship('ship.fish_tug', -500, 0, Math.PI / 2);
    const player: Traffic = { x: 0, z: 400, vx: 0, vz: -4, lengthM: 30 };
    let closest = Infinity;
    run([tug], 150, player, OPEN_LAKE, () => {
      closest = Math.min(closest, Math.hypot(tug.x - player.x, tug.z - player.z));
    });
    expect(closest).toBeGreaterThan(30);
  });

  it('steers clear of the shore it is heading for', () => {
    const at = geo.projection.geoToChart({ lat: 46.99, lon: -91.62 });
    const frame = arenaFrame(at);
    const land = sampleArenaLand(geo, frame, ARENA_HALF_M + 400);
    // Find a heading straight at the land from a water spot.
    let start = { x: 0, z: 0 };
    for (let r = 0; r < 1400 && land.isLand(start.x, start.z); r += 50) start = { x: 0, z: r };
    let heading = 0;
    for (let k = 0; k < 36; k++) {
      const h = k * 10 * DEG;
      if (land.isLand(start.x + Math.sin(h) * 700, start.z - Math.cos(h) * 700)) {
        heading = h;
        break;
      }
    }
    const s = ship('ship.package_steamer', start.x, start.z, heading);
    let ashore = false;
    run([s], 180, undefined, land, () => {
      // Past the arena's edge the voyage has resumed; the grid ends a little beyond it.
      const inside = Math.max(Math.abs(s.x), Math.abs(s.z)) < ARENA_HALF_M;
      if (inside && land.isLand(s.x, s.z)) ashore = true;
    });
    expect(ashore).toBe(false);
  });

  it('the hunting cutter runs down a ship hove to', () => {
    const cutter = ship('ship.cutter_morrill', 0, 0, 0, true);
    const player: Traffic = { x: 600, z: 300, vx: 0, vz: 0, lengthM: 30 };
    let caught = false;
    run([cutter], 120, player, OPEN_LAKE, () => {
      if (Math.hypot(cutter.x - player.x, cutter.z - player.z) < CAUGHT_RANGE_M) caught = true;
    });
    expect(caught).toBe(true);
  });

  it('a derelict lies still', () => {
    const r = record('ship.schooner_barge');
    const wreck: SteeredShip = {
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      heading: 1,
      lengthM: r.lengthM,
      helm: createHelm(r, 1, 0),
    };
    run([wreck], 30);
    expect(Math.hypot(wreck.x, wreck.z)).toBe(0);
    expect(wreck.helm.state).toBe('stopped');
  });
});

describe('arena rules', () => {
  const inputs = (x: number, z: number, ships: ArenaInputs['ships'] = []): ArenaInputs => ({
    player: { x, z },
    ships,
    lookHeld: false,
    chartPressed: false,
  });

  it('sailing off the edge goes back to the chart', () => {
    const r = createArenaRun(devEncounter('freighter', devAt, 0));
    stepArenaRun(r, inputs(0, -1400), 0.1);
    expect(r.result).toBeUndefined();
    expect(arenaStatus(r, inputs(0, -1400))).toContain('Sail on for the chart');
    stepArenaRun(r, inputs(0, -ARENA_HALF_M - 1), 0.1);
    expect(r.result).toBe('left');
  });

  it('looking a ship over resolves the encounter', () => {
    const r = createArenaRun(devEncounter('steamer', devAt, 0));
    const near = inputs(0, 100, [{ id: 'dev.steamer', x: 0, z: 0, hunting: false }]);
    expect(arenaStatus(r, near)).toContain('Hold F to look her over');
    for (let t = 0; t < LOOK_HOLD_S + 0.2; t += 0.1)
      stepArenaRun(r, { ...near, lookHeld: true }, 0.1);
    expect(r.resolved).toBe(true);
    stepArenaRun(r, inputs(ARENA_HALF_M + 5, 0), 0.1);
    expect(r.result).toBe('resolved');
  });

  it('a hunting cutter locks the chart and holds the edge until shaken off', () => {
    const r = createArenaRun(devEncounter('cutter', devAt, 0, true));
    const hunter = { id: 'dev.cutter', x: 0, z: -ARENA_HALF_M + 400, hunting: true };
    const atEdge = { ...inputs(0, -ARENA_HALF_M - 2, [hunter]), chartPressed: true };
    stepArenaRun(r, atEdge, 0.1);
    expect(r.pursued).toBe(true);
    expect(r.result).toBeUndefined();
    expect(arenaStatus(r, atEdge)).toContain('Chart locked: the cutter has you');
    // Out of range, and away.
    stepArenaRun(r, inputs(0, -ARENA_HALF_M - 2, [{ ...hunter, z: 0 }]), 0.1);
    expect(r.result).toBe('left');
    // Caught close aboard.
    const c = createArenaRun(devEncounter('cutter', devAt, 0, true));
    stepArenaRun(c, inputs(0, 0, [{ ...hunter, z: 20 }]), 0.1);
    expect(c.result).toBe('caught');
  });

  it('a squall is ridden out', () => {
    const r = createArenaRun(devEncounter('squall', devAt, 0));
    for (let t = 0; t < SQUALL_RIDE_S + 0.5; t += 0.5) stepArenaRun(r, inputs(0, 0), 0.5);
    expect(r.resolved).toBe(true);
    expect(arenaStatus(r, inputs(0, 0))).toContain('Squall passed');
  });
});
