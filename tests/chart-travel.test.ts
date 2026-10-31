import { describe, expect, it } from 'vitest';
import { zoneToChart, type Chart } from '../src/core/coords';
import { CHART_TIME_SCALE, type ChartSession } from '../src/modes/chart';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { clearToZoneEdge, fromWorldChart, toWorldChart } from '../src/sim/chart/geography';
import { offersChart } from '../src/sim/terrain/zone-edge';
import type { Contact, Encounter } from '../src/sim/chart/traffic';
import {
  estimateSeconds,
  planCourse,
  PROTOTYPE_SCHOONER,
  remainingSeconds,
  restoreVoyage,
  saveVoyage,
  startVoyage,
  stepVoyage,
} from '../src/sim/chart/voyage';
import { recordChartPosition, resolveStart } from '../src/sim/location';
import {
  defFrame,
  setPieceAt,
  setPieceFootprint,
  spawnPose,
  zoneDef,
} from '../src/sim/terrain/zones';
import { createWorldState, worldStateSchema } from '../src/sim/world-state';
import { chartHud, encounterCard } from '../src/ui/chart/model';
import { nearestLeg } from '../src/ui/chart/plotting';

/** Phase 3 piece D: the chart in the game. */

const geo = westernSuperiorChart();
const at = (lat: number, lon: number): Chart => geo.projection.geoToChart({ lat, lon });
const offDuluth = at(46.8, -91.96);
const northOfSand = at(47.17, -91.0);
const bayfield = geo.ports.find((p) => p.id === 'port.bayfield')?.pos as Chart;
const wind = { from: 5.5, speedKn: 12 };

function session(waypoints: Chart[] = [northOfSand, bayfield]): ChartSession {
  return {
    geo,
    ship: PROTOTYPE_SCHOONER,
    position: offDuluth,
    heading: 0,
    wind,
    contacts: [],
    waypoints,
    course: planCourse(geo, offDuluth, waypoints),
    voyage: undefined,
    lookout: 'threatsAndPrizes',
    timeScale: CHART_TIME_SCALE,
    pending: undefined,
    handled: new Set(),
    quietUntil: 0,
  };
}

const hud = (s: ChartSession, trip: 'look' | 'sea', locked = false) =>
  chartHud({
    session: s,
    trip,
    gameSeconds: 8 * 3600,
    backLabel: undefined,
    notice: undefined,
    locked,
  });

describe('the voyage in the save', () => {
  it('comes back where it was, with the same time to go', () => {
    const course = planCourse(geo, offDuluth, [northOfSand, bayfield]);
    const voyage = startVoyage(course, 100);
    stepVoyage(voyage, 4 * 3600, wind, PROTOTYPE_SCHOONER);
    const state = createWorldState('voyage');
    state.voyage = saveVoyage(geo, voyage);
    recordChartPosition(state, voyage.position, voyage.heading, 'zone.twin_ports');
    // Through JSON and the schema, as a save goes.
    const loaded = worldStateSchema.parse(JSON.parse(JSON.stringify(state)));
    if (!loaded.voyage) throw new Error('voyage lost');
    const back = restoreVoyage(geo, loaded.voyage);
    expect(back?.leg).toBe(voyage.leg);
    expect(back?.position.x).toBeCloseTo(voyage.position.x, 3);
    expect(back?.position.y).toBeCloseTo(voyage.position.y, 3);
    expect(back?.startedAt).toBe(100);
    if (!back) throw new Error('voyage lost on load');
    expect(remainingSeconds(back, wind, PROTOTYPE_SCHOONER)).toBeCloseTo(
      remainingSeconds(voyage, wind, PROTOTYPE_SCHOONER),
      3,
    );
  });

  it('drops a voyage that no longer plans, keeping the ship where it was', () => {
    // A straight line across the Bayfield peninsula runs aground.
    expect(
      restoreVoyage(geo, {
        points: [at(46.88, -91.2), at(46.85, -90.7)].map((p) => toWorldChart(geo, p)),
        leg: 0,
        progressM: 0,
        startedAt: 0,
      }),
    ).toBeUndefined();
  });

  it('a new run has no voyage, and remaining time starts at the estimate', () => {
    expect(createWorldState('x').voyage).toBeNull();
    const course = planCourse(geo, offDuluth, [northOfSand, bayfield]);
    const voyage = startVoyage(course, 0);
    expect(remainingSeconds(voyage, wind, PROTOTYPE_SCHOONER)).toBeCloseTo(
      estimateSeconds(course, wind, PROTOTYPE_SCHOONER),
      6,
    );
  });

  it('loads the zone the ship left behind the chart, at its entry nearest the ship', () => {
    const start = resolveStart({
      mode: 'chart',
      chartPos: toWorldChart(geo, offDuluth),
      heading: 1,
      fromZoneId: 'zone.twin_ports',
    });
    expect(start.zoneId).toBe('zone.twin_ports');
    expect(start.from).toBe('entry');
  });

  it('puts a zone pose and the chart in the same place', () => {
    // The Apostles' west entry is north of Sand Island on the chart too.
    const def = zoneDef('zone.apostles');
    const entry = def.entries.find((e) => e.id.endsWith('_west'));
    if (!entry) throw new Error('no west entry');
    const p = fromWorldChart(geo, zoneToChart(entry, defFrame(def)));
    const ll = geo.projection.chartToGeo(p);
    expect(ll.lat).toBeGreaterThan(46.9);
    expect(ll.lat).toBeLessThan(47.1);
    expect(ll.lon).toBeGreaterThan(-91.1);
    expect(ll.lon).toBeLessThan(-90.8);
  });
});

describe('the chart HUD', () => {
  it('lets a voyage set out only from the soft edge, not on a look', () => {
    const s = session();
    const sea = hud(s, 'sea');
    expect(sea.canSail).toBe(true);
    expect(sea.statusText).toMatch(/^Course \d+\.\d nm in 2 legs to Apostles & Chequamegon Bay$/);
    expect(sea.etaText).toMatch(/^ETA \d\d:\d\d \(\d+ h \d\d m\)$/);
    const look = hud(s, 'look');
    expect(look.canSail).toBe(false);
    expect(look.sailLabel).toMatch(/zone edge/);
    // The course can still be laid on a look, for when the ship gets to the edge.
    expect(look.canEdit).toBe(true);
  });

  it('says why a course is refused, and locks while pursued', () => {
    const aground = session([at(46.85, -90.7)]);
    aground.position = at(46.88, -91.2);
    aground.course = planCourse(geo, aground.position, aground.waypoints);
    const h = hud(aground, 'sea');
    expect(h.canSail).toBe(false);
    expect(h.problem).toMatch(/runs aground/);
    const locked = hud(session(), 'sea', true);
    expect(locked.canSail).toBe(false);
    expect(locked.locked).toBe(true);
  });

  it('shows the voyage under way with the time left', () => {
    const s = session();
    if (!s.course) throw new Error('no course');
    s.voyage = startVoyage(s.course, 0);
    stepVoyage(s.voyage, 3600, wind, PROTOTYPE_SCHOONER);
    const h = hud(s, 'sea');
    expect(h.underWay).toBe(true);
    expect(h.canHeave).toBe(true);
    expect(h.canEdit).toBe(false);
    expect(h.statusText).toMatch(/^Under way [NSEW]+ at \d+\.\d kn, \d+\.\d nm to go$/);
  });

  it('offers the right choices on the encounter card', () => {
    const s = session();
    const contact = (over: Partial<Contact>): Contact => ({
      id: 'c',
      kind: 'freighter',
      name: 'Maritana',
      pos: northOfSand,
      heading: 0,
      speedKn: 8,
      conspicuity: 1.3,
      hostile: false,
      threat: false,
      prize: true,
      ...over,
    });
    const enc = (c: Contact, forced = false): Encounter =>
      ({ contact: c, forced, distanceM: 9000, bearing: 0 }) as Encounter;

    const prize = encounterCard(enc(contact({})), s, 12 * 3600);
    expect(prize).toMatchObject({ kind: 'Prize', avoidLabel: 'Steer clear', canIgnore: true });
    const cutter = contact({
      kind: 'cutter',
      name: 'Revenue cutter Morrill',
      hostile: true,
      threat: true,
      prize: false,
    });
    const spotted = encounterCard(enc(cutter), s, 12 * 3600);
    expect(spotted.avoidLabel).toMatch(/^Avoid \(\d+%\)$/);
    expect(spotted.canIgnore).toBe(false);
    const forced = encounterCard(enc(cutter, true), s, 12 * 3600);
    expect(forced.avoidLabel).toBeUndefined();
    expect(forced.canIgnore).toBe(false);
    expect(forced.forcedText).toBeTruthy();
  });
});

describe('plotting', () => {
  it('inserts a waypoint into the leg it falls on', () => {
    const a = { x: 0, y: 0 };
    const wps = [
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
    ];
    expect(nearestLeg(a, wps, { x: 500, y: 20 })).toBe(0);
    expect(nearestLeg(a, wps, { x: 990, y: 600 })).toBe(1);
  });
});

describe('no chart in a harbor', () => {
  it('finds the harbor set piece the ship is in, and none at the spawn', () => {
    const def = zoneDef('zone.apostles');
    const frame = defFrame(def);
    for (const piece of def.setPieces) {
      const fp = setPieceFootprint(piece, frame);
      // Just off the anchor, over the water.
      const off = {
        x: fp.anchor.x + Math.sin(fp.bearing) * piece.seawardM * 0.5,
        z: fp.anchor.z - Math.cos(fp.bearing) * piece.seawardM * 0.5,
      };
      expect(setPieceAt(def, frame, off)?.id, piece.id).toBe(piece.id);
      const far = {
        x: fp.anchor.x + Math.sin(fp.bearing) * (piece.seawardM + 200),
        z: fp.anchor.z - Math.cos(fp.bearing) * (piece.seawardM + 200),
      };
      expect(setPieceAt(def, frame, far)?.id, piece.id).not.toBe(piece.id);
    }
    expect(setPieceAt(def, frame, spawnPose(def))).toBeUndefined();
  });
});

describe('taking to the chart in the small North Shore zones', () => {
  const half = (id: string) => {
    const def = zoneDef(id);
    const h = (def.bake.tilesX * def.bake.tileSamples * def.bake.sailingSampleM) / 2;
    return { def, bounds: { minX: -h, maxX: h, minZ: -h, maxZ: h } };
  };
  /** A point `m` meters off a set piece's anchor along its bearing (negative: behind it). */
  const off = (id: string, piece: string, m: number) => {
    const { def } = half(id);
    const sp = def.setPieces.find((p) => p.id === piece);
    if (!sp) throw new Error(piece);
    const fp = setPieceFootprint(sp, defFrame(def));
    return { x: fp.anchor.x + Math.sin(fp.bearing) * m, z: fp.anchor.z - Math.cos(fp.bearing) * m };
  };

  it('offers the chart well inside the edge, but only where the edge is set so', () => {
    const b = { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 };
    expect(offersChart(b, { fogFadeM: 600, edgeVisibilityM: 350 }, 0, 1000)).toBe(false);
    expect(offersChart(b, { fogFadeM: 600, edgeVisibilityM: 350 }, 0, 1800)).toBe(true);
    expect(offersChart(b, { fogFadeM: 600, edgeVisibilityM: 350, chartFromM: 1500 }, 0, 1000)).toBe(
      true,
    );
    expect(zoneDef('zone.apostles').edge.chartFromM).toBeUndefined();
  });

  it('in the Twin Ports: just out of the Duluth canal, but not in the harbor behind it', () => {
    const { def, bounds } = half('zone.twin_ports');
    const frame = defFrame(def);
    const lake = off('zone.twin_ports', 'setpiece.duluth_canal', 400);
    const harbor = off('zone.twin_ports', 'setpiece.duluth_canal', -500);
    expect(offersChart(bounds, def.edge, lake.x, lake.z)).toBe(true);
    expect(clearToZoneEdge(geo, frame, bounds, lake)).toBe(true);
    expect(clearToZoneEdge(geo, frame, bounds, harbor)).toBe(false);
  });

  it('in Two Harbors: just out of Agate Bay', () => {
    const { def, bounds } = half('zone.two_harbors');
    const frame = defFrame(def);
    const lake = off('zone.two_harbors', 'setpiece.two_harbors', 500);
    expect(offersChart(bounds, def.edge, lake.x, lake.z)).toBe(true);
    expect(clearToZoneEdge(geo, frame, bounds, lake)).toBe(true);
  });
});
