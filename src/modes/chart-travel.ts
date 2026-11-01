import { zoneToChart, type Chart, type ZoneFrame } from '../core/coords';
import { dayAndHour } from '../core/time';
import { ChartView } from '../render/chart/chart-view';
import { westernSuperiorChart } from '../sim/chart/chart-data';
import {
  createChartSky,
  weatherPicture,
  type ChartWeatherPicture,
} from '../sim/chart/chart-weather';
import {
  clearToZoneEdge,
  distance,
  fromWorldChart,
  toWorldChart,
  zoneAt,
  type ChartZone,
} from '../sim/chart/geography';
import { tradeLaneLines } from '../sim/chart/director';
import { placeTraffic } from '../sim/chart/routes';
import {
  createContacts,
  daylight,
  detourSeconds,
  playerSeesAtM,
  spotRangeM,
  type Encounter,
  type LookoutPref,
} from '../sim/chart/traffic';
import {
  estimateSeconds,
  PROTOTYPE_SCHOONER,
  remainingSeconds,
  restoreVoyage,
  saveVoyage,
  type SavedVoyage,
} from '../sim/chart/voyage';
import { recordChartPosition } from '../sim/location';
import type { Pose } from '../sim/terrain/test-bay';
import { entryPose, findZoneDef, nearestEntry, zoneDef } from '../sim/terrain/zones';
import type { PlayerLocation, WorldState } from '../sim/world-state';
import type { ZoneDef } from '../../data/schemas/zones';
import {
  chartHud,
  type ChartHudSnapshot,
  type ChartNotice,
  type ChartTrip,
} from '../ui/chart/model';
import { attachPlotting } from '../ui/chart/plotting';
import { durationText } from '../ui/chart/text';
import type { Arrival } from '../ui/loading/model';
import {
  allContacts,
  CHART_TIME_SCALE,
  createChartMode,
  readSky,
  sessionShip,
  sessionWeatherFactor,
  type ChartMode,
  type ChartSession,
  type EncounterChoice,
} from './chart';
import type { GameContext } from './context';
import type { Mode, ModeMachine } from './machine';

/**
 * Chart travel in the game (plan 03 §5, §7; Phase 3 piece D): the S8 chart mode wired to
 * the zones. M at the helm opens the chart as a look with the world held (plan 03 §20.5);
 * at the soft edge it takes the ship onto the chart, where a plotted course can be sailed
 * with time compressed. A course into another zone loads that zone at its entry nearest
 * where the course crosses the zone's outline. The ship's chart position and the voyage
 * go in the save.
 */

export interface ChartTravelHost {
  ctx: GameContext;
  machine: ModeMachine;
  /** The full-screen element the chart canvas goes in, above the 3D view. */
  layer: HTMLElement;
  setHud(snapshot: ChartHudSnapshot | undefined): void;
  /** The lookout setting (plan 13 §4.3), kept in the settings store. */
  lookout(): LookoutPref;
  /** The zone loaded now, which the ship left or is sailing in. */
  zone(): { def: ZoneDef; frame: ZoneFrame };
  shipPose(): Pose;
  /** Puts the ship at a pose in the loaded zone, way off. */
  placeShip(pose: Pose): void;
  /**
   * Enters a zone behind the fade to fog. `onLoaded` runs once the zone is in and the ship
   * placed, before the saves on arrival and before the fog lifts.
   */
  enterZone(id: string, pose: Pose, arrival: Arrival, onLoaded: () => void): Promise<void>;
  save(): Promise<void>;
  /** A hostile has the ship detected inside its threat radius: no chart (plan 03 §5.4). */
  pursued(): boolean;
  /**
   * The player meets an encounter in an open-water arena (piece G). It calls
   * `travel.resumeFrom(contactId)` when the ship sails back out onto the chart. Without
   * an arena the meeting is noted and the voyage carries on.
   */
  enterArena?: ((enc: Encounter, travel: ChartTravel) => void) | undefined;
  /** The run's seed: the route graph's traffic follows from it and the clock (piece F). */
  seed: string;
  /** The Morrill hunts and forces meetings (`?cutter=hunt`, dev only until Phase 5). */
  cutterHunts?: boolean;
}

export interface ChartTravel {
  readonly mode: Mode;
  readonly chart: ChartMode;
  readonly session: ChartSession;
  /** How the chart is open; undefined at the helm. */
  readonly trip: ChartTrip | undefined;
  /** Refused M or "Take to the chart" at the helm: why, for the HUD. Undefined when it opened. */
  fromHelm(where: { atEdge: boolean; inHarbor: boolean }): string | undefined;
  /**
   * True when the open lake lies clear ahead of the ship toward the zone's nearest edge
   * on the chart: out of the harbor, not behind a point. Zones that offer the chart well
   * inside their edge (`chartFromM`) ask this too.
   */
  openToLake(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean;
  /** Off the zone at the soft edge and onto the chart, for a voyage. */
  takeToChart(): void;
  /** M in open water: a look at the chart, the world held. */
  openLook(): void;
  /** Back to the helm from a look, or into the zone the ship is in on the chart. */
  back(): void;
  setSail(): boolean;
  heaveTo(): void;
  undo(): void;
  clear(): void;
  answer(choice: EncounterChoice): void;
  dismissNotice(): void;
  /** Show the weather as it stands (0) or forecast this many hours ahead. */
  setForecast(leadHours: number): void;
  /**
   * Back on the chart from an arena: the contact is dealt with and the voyage carries on,
   * unless the cutter caught the ship, which ends it where it stands.
   */
  resumeFrom(contactId: string, result?: 'left' | 'resolved' | 'caught'): void;
  /** Continue a run saved on the chart. */
  resume(location: Extract<PlayerLocation, { mode: 'chart' }>, voyage: SavedVoyage | null): void;
  /**
   * Writes the chart position and the voyage into the state before a save. False at the
   * helm or on a look, where the zone pose is what's saved.
   */
  record(state: WorldState): boolean;
  /** Called at the HUD's rate: samples the chart HUD. */
  sampleHud(): void;
}

/** Where the ship left the zone for the chart, for the way straight back. */
interface Departure {
  zoneId: string;
  pose: Pose;
  chartPos: Chart;
}

/** "Apostle Islands" reads "the Apostle Islands" in a sentence; "Twin Ports" too. */
function placeName(zone: ChartZone): string {
  const name = findZoneDef(zone.id)?.name ?? zone.name;
  return /s$/.test(name) ? `the ${name}` : name;
}

export function createChartTravel(host: ChartTravelHost): ChartTravel {
  const { ctx, machine } = host;
  const geo = westernSuperiorChart();
  const clock = ctx.state.environment.clock;
  const hour = (): number => dayAndHour(clock.gameSeconds).hour;

  const session: ChartSession = {
    geo,
    ship: PROTOTYPE_SCHOONER,
    position: { x: 0, y: 0 },
    heading: 0,
    wind: { from: 0, speedKn: 10 },
    // The route graph's ships, where the clock has them (piece F).
    contacts: createContacts(geo.projection, `${host.seed}-traffic`, clock.gameSeconds),
    // One sky for the zones and the chart (piece E): the run's weather sim.
    sky: createChartSky(ctx.state.environment.weather),
    waypoints: [],
    course: undefined,
    voyage: undefined,
    lookout: host.lookout(),
    timeScale: CHART_TIME_SCALE,
    pending: undefined,
    handled: new Set(),
    quietUntil: 0,
    hostilesHunt: host.cutterHunts ?? false,
  };

  // The trade lanes every master knows (plan 03 §5.2); not the ships on them.
  const knownLanes = tradeLaneLines(geo.projection).lines;

  let trip: ChartTrip | undefined;
  let departure: Departure | undefined;
  let notice: ChartNotice | undefined;
  let arriving = false;
  /** Hours ahead the chart's weather is drawn for; 0 is the weather as it stands. */
  let forecastLead = 0;
  let forecast: ChartWeatherPicture | undefined;

  const canvas = document.createElement('canvas');
  canvas.className = 'chart-canvas';
  canvas.dataset['testid'] = 'chart-canvas';
  host.layer.appendChild(canvas);
  const view = new ChartView(canvas);
  let fitted = false;
  window.addEventListener('resize', () => (fitted = false));

  const plotting = attachPlotting({
    view,
    session,
    canPlot: () => !!trip && !session.voyage && !session.pending && !arriving,
    replot: () => chart.replot(),
  });

  /** The weather picture the chart draws: as it stands, or the forecast at the chosen lead. */
  const pictureNow = (): ChartWeatherPicture | undefined => {
    const sky = session.sky;
    if (!sky) return undefined;
    if (forecastLead === 0) return sky.picture;
    const at = clock.gameSeconds + forecastLead * 3600;
    // A forecast is redrawn once per world tick (the sim only moves then).
    if (!forecast || forecast.leadHours !== forecastLead || Math.abs(forecast.at - at) >= 600) {
      forecast = weatherPicture(sky.state, geo, clock.gameSeconds, forecastLead);
    }
    return forecast;
  };

  const chart = createChartMode(ctx, session, {
    onArrived: (zone) => arrive(zone),
  });

  /** A zone pose on this chart: zones sit in the world chart frame. */
  const onChart = (pose: Pose, frame: ZoneFrame): Chart =>
    fromWorldChart(geo, zoneToChart(pose, frame));
  /** The zone's entry nearest the ship's chart position. */
  const entryNear = (def: ZoneDef) => nearestEntry(def, toWorldChart(geo, session.position));

  /** The zone the ship's chart position is in, if any. */
  const zoneHere = (): ChartZone | undefined => zoneAt(geo, session.position);

  const backLabel = (): string | undefined => {
    if (trip === 'look') return 'Back to the helm';
    if (trip !== 'sea' || session.voyage || arriving) return undefined;
    const zone = zoneHere();
    return zone ? `Into ${placeName(zone)}` : undefined;
  };

  const toHelm = (): void => {
    trip = undefined;
    notice = undefined;
    host.setHud(undefined);
    if (machine.mode === 'chart') machine.transition('sailing');
  };

  const openChart = (kind: ChartTrip): void => {
    const { frame } = host.zone();
    const pose = host.shipPose();
    trip = kind;
    notice = undefined;
    session.position = onChart(pose, frame);
    session.heading = pose.heading;
    // The chart's wind is the sim's (piece E), read where the ship is.
    readSky(session, clock.gameSeconds);
    session.lookout = host.lookout();
    // The traffic sailed on while the ship was in the zone.
    placeTraffic(session.contacts, clock.gameSeconds);
    fitted = false;
    chart.replot();
    machine.transition('chart');
  };

  function arrive(zone: ChartZone | undefined): void {
    if (!zone) {
      notice = {
        title: 'Arrived',
        text: 'You reached your last waypoint in open water. Plot your next leg.',
      };
      void host.save();
      return;
    }
    const def = zoneDef(zone.id);
    const entry = entryNear(def);
    arriving = true;
    void host
      .enterZone(def.id, entryPose(entry), { kind: 'entry', entryName: entry.name }, () => {
        departure = undefined;
        toHelm();
      })
      .finally(() => (arriving = false));
  }

  const travel: ChartTravel = {
    mode: {
      ...chart,
      update(dt) {
        session.lookout = host.lookout();
        const input = ctx.input;
        const free = !session.pending && !notice && !arriving;
        if (free && input.pressed('Confirm')) travel.setSail();
        else if (free && input.pressed('Cancel')) travel.undo();
        else if (free && input.pressed('ToggleChart') && backLabel()) travel.back();
        // On a look the world is held: chart mode only runs the clock under way.
        if (trip === 'sea' && !arriving) chart.update(dt);
      },
      render() {
        if (!fitted && view.width > 0) {
          view.fit(geo.charted.min, geo.charted.max);
          fitted = true;
        }
        const course = session.course;
        const ship = sessionShip(session);
        const eta = session.voyage
          ? durationText(
              remainingSeconds(session.voyage, session.wind, ship) + (session.detourS ?? 0),
            )
          : course && !course.problem && course.legs.length > 0
            ? durationText(estimateSeconds(course, session.wind, ship))
            : undefined;
        const h = hour();
        const weather = sessionWeatherFactor(session);
        const contacts = allContacts(session);
        const visible = new Set<string>();
        for (const c of contacts) {
          if (c.inPort) continue;
          if (distance(session.position, c.pos) <= playerSeesAtM(c, h, weather)) visible.add(c.id);
        }
        view.draw({
          geo,
          position: session.position,
          heading: session.heading,
          course: session.voyage ? undefined : course,
          voyage: session.voyage,
          contacts,
          lanes: knownLanes,
          weather: pictureNow(),
          now: clock.gameSeconds,
          daylight: daylight(h),
          spotRangeM: spotRangeM(h) * weather,
          visible,
          hoverWaypoint: plotting.hoverWaypoint,
          etaLabel: eta,
        });
      },
    },
    chart,
    session,
    get trip() {
      return trip;
    },
    fromHelm({ atEdge, inHarbor }) {
      if (host.pursued()) return 'Chart locked: you are being pursued';
      if (inHarbor) return 'Not in the harbor: put out to open water first';
      if (atEdge) travel.takeToChart();
      else travel.openLook();
      return undefined;
    },
    openToLake(bounds) {
      const { frame } = host.zone();
      return clearToZoneEdge(geo, frame, bounds, host.shipPose());
    },
    takeToChart() {
      if (host.pursued() || machine.mode !== 'sailing') return;
      const { def, frame } = host.zone();
      const pose = host.shipPose();
      departure = { zoneId: def.id, pose: { ...pose }, chartPos: onChart(pose, frame) };
      openChart('sea');
      // Autosave on the transition (plan 16 §4.1).
      void host.save();
    },
    openLook() {
      if (machine.mode !== 'sailing') return;
      openChart('look');
    },
    back() {
      if (trip === 'look') {
        toHelm();
        return;
      }
      const zone = zoneHere();
      if (trip !== 'sea' || session.voyage || arriving || !zone) return;
      const { def } = host.zone();
      session.waypoints = [];
      chart.replot();
      if (zone.id === def.id) {
        // Straight back where the ship left, if it hasn't moved; otherwise in at an entry.
        const left =
          departure?.zoneId === def.id && distance(departure.chartPos, session.position) < 1
            ? departure.pose
            : entryPose(entryNear(def));
        host.placeShip(left);
        departure = undefined;
        toHelm();
        void host.save();
        return;
      }
      arrive(zone);
    },
    setSail() {
      if (trip !== 'sea' || session.voyage || session.pending || arriving || host.pursued()) {
        return false;
      }
      if (!chart.setSail()) return false;
      notice = undefined;
      void host.save();
      return true;
    },
    heaveTo() {
      if (!session.voyage || session.pending) return;
      session.voyage = undefined;
      session.waypoints = [];
      chart.replot();
      void host.save();
    },
    undo() {
      if (!trip || session.voyage || session.pending) return;
      session.waypoints.pop();
      chart.replot();
    },
    clear() {
      if (!trip || session.voyage || session.pending) return;
      session.waypoints = [];
      chart.replot();
    },
    answer(choice) {
      const enc = session.pending;
      if (!enc) return;
      const { outcome, escaped } = chart.resolve(choice);
      if (escaped === true) {
        const lost = durationText(detourSeconds(enc, session.voyage?.speedKn ?? 0));
        const slipped = enc.contact.hostile && enc.hunts !== false;
        notice = {
          title: slipped ? 'Slipped away' : 'Steered clear',
          text:
            enc.contact.kind === 'storm'
              ? `You bear away round the squall and lose ${lost} getting back on your course.`
              : `You give ${enc.contact.name} a wide berth and lose ${lost} getting back on your course.`,
        };
      }
      if (outcome !== 'arena') return;
      if (host.enterArena) {
        host.enterArena(enc, travel);
        return;
      }
      // No open-water arenas until piece G: note the meeting and sail on.
      chart.resumeFrom(enc.contact.id);
      notice = {
        title: escaped === false ? `No slipping ${enc.contact.name}` : enc.contact.name,
        text: 'You close and look her over, then stand on. (Open-water arenas come with Phase 3 piece G.)',
      };
    },
    dismissNotice() {
      notice = undefined;
    },
    setForecast(leadHours) {
      forecastLead = Math.max(0, leadHours);
      forecast = undefined;
    },
    resumeFrom(contactId, result) {
      chart.resumeFrom(contactId);
      if (result === 'caught') {
        // Boarded and searched; with no Wanted until Phase 5 she lets you go, voyage over.
        session.voyage = undefined;
        session.waypoints = [];
        chart.replot();
        const name = allContacts(session).find((c) => c.id === contactId)?.name ?? 'The cutter';
        notice = {
          title: 'Boarded',
          text: `${name} put a boarding party aboard, searched the hold and let you go. Plot your next leg.`,
        };
      }
      if (machine.mode !== 'chart') machine.transition('chart');
    },
    resume(location, saved) {
      trip = 'sea';
      departure = undefined;
      session.position = fromWorldChart(geo, location.chartPos);
      session.heading = location.heading;
      placeTraffic(session.contacts, clock.gameSeconds);
      session.waypoints = [];
      session.course = undefined;
      session.voyage = saved ? restoreVoyage(geo, saved) : undefined;
      if (session.voyage) {
        session.position = { ...session.voyage.position };
        session.heading = session.voyage.heading;
      }
      readSky(session, clock.gameSeconds);
      fitted = false;
      machine.transition('chart');
    },
    record(state) {
      if (trip !== 'sea') {
        state.voyage = null;
        return false;
      }
      // The save keeps the world chart frame, which the zones' entries share.
      recordChartPosition(
        state,
        toWorldChart(geo, session.position),
        session.heading,
        host.zone().def.id,
      );
      state.voyage = session.voyage ? saveVoyage(geo, session.voyage) : null;
      return true;
    },
    sampleHud() {
      if (machine.mode !== 'chart' || !trip) return;
      host.setHud(
        chartHud({
          session,
          trip,
          gameSeconds: clock.gameSeconds,
          backLabel: backLabel(),
          notice,
          locked: host.pursued(),
          forecastLead,
        }),
      );
    },
  };
  return travel;
}
