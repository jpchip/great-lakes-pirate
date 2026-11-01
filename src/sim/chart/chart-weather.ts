import { METERS_PER_NAUTICAL_MILE, type Chart } from '../../core/coords';
import {
  barometerAt,
  fogBanksAt,
  precipitationAt,
  pressureAt,
  squallAt,
  STORM_CELL_DRIFT_MS,
  thunderstormAt,
  visibilityAt,
  windAt,
  type BarometerReading,
  type FogBank,
  type WeatherState,
} from '../weather/weather';
import {
  distance,
  fromWorldChart,
  toWorldChart,
  type ChartGeography,
  type Rect,
} from './geography';
import { DAY_SPOT_NM, type Contact } from './traffic';
import { chartSpeedKn, type ChartShip, type ChartWind, type PlannedCourse } from './voyage';

/**
 * Weather on the chart (plan 04 §12, §15; plan 03 §20.4 piece E). The S9 sim already runs
 * in the lake-wide chart frame, so the chart reads it rather than keeping weather of its
 * own: the wind under the ship, the fog banks and storm cells it can meet, the pressure
 * field it draws as isobars, and a forecast that runs the sim's systems forward.
 *
 * Positions here are in the chart geography's frame; the sim is asked in the world frame
 * through `toWorldChart`, the way a zone asks it through its own frame, so the chart and
 * the zone read the same weather at the same place and time.
 */

const HOUR = 3600;

// ---------------------------------------------------------------------------------
// Point queries

/** The chart's wind at a chart point: the sim's, as a zone in open water would read it. */
export function chartWindAt(
  state: WeatherState,
  geo: ChartGeography,
  p: Chart,
  t: number,
): ChartWind {
  const w = windAt(state, toWorldChart(geo, p), t);
  return { from: w.fromRad, speedKn: w.speedKn };
}

/** Weather visibility at a chart point, meters (fog, rain and haze; not the night). */
export function chartVisibilityAt(
  state: WeatherState,
  geo: ChartGeography,
  p: Chart,
  t: number,
): number {
  return visibilityAt(state, toWorldChart(geo, p), t);
}

/**
 * How far the lookouts see in this weather, as a share of their clear-day range: 1 in
 * clear air, and down to the fog's own few hundred meters inside a bank. It scales the
 * spotting both ways, so fog hides the ship from the cutter as much as it hides the cutter.
 */
export function visibilityFactor(visibilityM: number): number {
  return Math.max(0.01, Math.min(1, visibilityM / (DAY_SPOT_NM * METERS_PER_NAUTICAL_MILE)));
}

// ---------------------------------------------------------------------------------
// Storm cells and fog banks as the chart sees them

/**
 * Squall intensity that counts as a storm cell on the chart: the cores of the sim's storm
 * patches, which are tens of kilometers across at lower intensity.
 */
export const SQUALL_CELL_MIN = 0.55;
/** A storm cell is drawn and met no larger than this, meters (a big thunderstorm's anvil). */
export const MAX_CELL_RADIUS_M = 16_000;
/** Grid spacing for sampling the sim across the chart, meters. */
export const FIELD_CELL_M = 5000;

/** A squall or thunderstorm cell, found where `squallAt` stands high. */
export interface StormCell {
  id: number;
  pos: Chart;
  radiusM: number;
  /** Peak squall intensity, 0–1. */
  strength: number;
  /** Thunder and lightning (summer) rather than a cold squall in a gale's rain. */
  thunder: boolean;
}

/** A fog bank on the chart: where its wall stands (half strength) and how formed it is. */
export interface ChartFogBank {
  id: number;
  kind: FogBank['kind'];
  pos: Chart;
  /** The bank's whole reach, where the fog runs out. */
  radiusM: number;
  /** Where the fog is half strength: the wall a zone draws (plan 04 §25). */
  wallM: number;
  strength: number;
}

/** A pressure system, for the chart's L and H and its forecast track. */
export interface ChartPressureCentre {
  id: number;
  kind: 'low' | 'high';
  pos: Chart;
  /** Velocity, m/s on the chart. */
  vx: number;
  vy: number;
  radiusM: number;
  /** Central pressure, hPa. */
  hpa: number;
}

/** The sim sampled on a grid over the chart. Row-major from `origin` (the south-west corner). */
export interface WeatherField {
  origin: Chart;
  cellM: number;
  cols: number;
  rows: number;
  /** hPa. */
  pressure: Float32Array;
  /** 0–1. */
  rain: Float32Array;
  squall: Float32Array;
  /** The vector the air moves along, knots (x east, y north). */
  windX: Float32Array;
  windY: Float32Array;
}

/** Everything the chart draws and meets of the weather, at one game time. */
export interface ChartWeatherPicture {
  /** Game time this picture is for (now, or a forecast lead ahead). */
  at: number;
  /** Hours ahead of now; 0 for the weather as it stands. */
  leadHours: number;
  field: WeatherField;
  cells: StormCell[];
  fogBanks: ChartFogBank[];
  centres: ChartPressureCentre[];
}

/** Sample the sim on a grid over `bounds`. About 1,300 points over the western lake. */
export function sampleField(
  state: WeatherState,
  geo: ChartGeography,
  bounds: Rect,
  t: number,
  cellM = FIELD_CELL_M,
): WeatherField {
  const cols = Math.max(2, Math.ceil((bounds.max.x - bounds.min.x) / cellM) + 1);
  const rows = Math.max(2, Math.ceil((bounds.max.y - bounds.min.y) / cellM) + 1);
  const n = cols * rows;
  const field: WeatherField = {
    origin: { ...bounds.min },
    cellM,
    cols,
    rows,
    pressure: new Float32Array(n),
    rain: new Float32Array(n),
    squall: new Float32Array(n),
    windX: new Float32Array(n),
    windY: new Float32Array(n),
  };
  const world = worldGrid(geo, bounds, cellM, cols, rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const p = { x: world[2 * k] as number, y: world[2 * k + 1] as number };
      field.pressure[k] = pressureAt(state, p, t);
      const rain = precipitationAt(state, p, t);
      field.rain[k] = rain;
      field.squall[k] = rain < 0.1 ? 0 : squallAt(state, p, t);
      const w = windAt(state, p, t);
      field.windX[k] = w.toKn.x;
      field.windY[k] = w.toKn.y;
    }
  }
  return field;
}

/** The grid's points in the sim's (world) frame, projected once per chart and grid. */
const worldGrids = new WeakMap<ChartGeography, { key: string; xy: Float64Array }>();
function worldGrid(
  geo: ChartGeography,
  bounds: Rect,
  cellM: number,
  cols: number,
  rows: number,
): Float64Array {
  const key = `${bounds.min.x},${bounds.min.y},${cellM},${cols},${rows}`;
  const cached = worldGrids.get(geo);
  if (cached?.key === key) return cached.xy;
  const xy = new Float64Array(cols * rows * 2);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const w = toWorldChart(geo, { x: bounds.min.x + i * cellM, y: bounds.min.y + j * cellM });
      xy[2 * (j * cols + i)] = w.x;
      xy[2 * (j * cols + i) + 1] = w.y;
    }
  }
  worldGrids.set(geo, { key, xy });
  return xy;
}

/** Bilinear sample of one of the field's layers at a chart point (clamped to the grid). */
export function fieldValue(field: WeatherField, layer: Float32Array, p: Chart): number {
  const fx = Math.min(Math.max((p.x - field.origin.x) / field.cellM, 0), field.cols - 1);
  const fy = Math.min(Math.max((p.y - field.origin.y) / field.cellM, 0), field.rows - 1);
  const i = Math.min(Math.floor(fx), field.cols - 2);
  const j = Math.min(Math.floor(fy), field.rows - 2);
  const u = fx - i;
  const v = fy - j;
  const at = (a: number, b: number): number => layer[b * field.cols + a] as number;
  return (
    at(i, j) * (1 - u) * (1 - v) +
    at(i + 1, j) * u * (1 - v) +
    at(i, j + 1) * (1 - u) * v +
    at(i + 1, j + 1) * u * v
  );
}

/**
 * Storm cells from the field: connected squares where the squall intensity passes
 * SQUALL_CELL_MIN, each made a disc of the same area. A big gale can stand several.
 */
export function findStormCells(field: WeatherField, thunder: (p: Chart) => boolean): StormCell[] {
  const { cols, rows, cellM } = field;
  const seen = new Uint8Array(cols * rows);
  const cells: StormCell[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (seen[start] || (field.squall[start] as number) < SQUALL_CELL_MIN) continue;
    // Flood fill this patch, weighting the centre by intensity.
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    let wsum = 0;
    let sx = 0;
    let sy = 0;
    let peak = 0;
    while (stack.length > 0) {
      const k = stack.pop() as number;
      const s = field.squall[k] as number;
      const i = k % cols;
      const j = (k - i) / cols;
      count++;
      wsum += s;
      sx += s * i;
      sy += s * j;
      peak = Math.max(peak, s);
      const next = [
        i > 0 ? k - 1 : -1,
        i < cols - 1 ? k + 1 : -1,
        j > 0 ? k - cols : -1,
        j < rows - 1 ? k + cols : -1,
      ];
      for (const m of next) {
        if (m < 0 || seen[m] || (field.squall[m] as number) < SQUALL_CELL_MIN) continue;
        seen[m] = 1;
        stack.push(m);
      }
    }
    const pos = {
      x: field.origin.x + (sx / wsum) * cellM,
      y: field.origin.y + (sy / wsum) * cellM,
    };
    cells.push({
      id: 0,
      pos,
      radiusM: Math.min(
        Math.sqrt((count * cellM * cellM) / Math.PI) + cellM / 2,
        MAX_CELL_RADIUS_M,
      ),
      strength: peak,
      thunder: thunder(pos),
    });
  }
  return cells.sort((a, b) => b.strength - a.strength).slice(0, MAX_CELLS);
}

/** The chart tracks at most this many storm cells at once (the strongest). */
export const MAX_CELLS = 6;

/**
 * Give this tick's storm cells the ids of last tick's, so a cell keeps its name and the
 * lookouts don't report it twice. A cell inherits from the nearest old one that could have
 * drifted there; the rest get new ids.
 */
export function trackCells(
  previous: readonly StormCell[],
  next: StormCell[],
  dtSeconds: number,
  newId: () => number,
): StormCell[] {
  const taken = new Set<number>();
  const drift = STORM_CELL_DRIFT_MS * Math.max(dtSeconds, 0);
  for (const cell of next) {
    let best: StormCell | undefined;
    let bestD = Infinity;
    for (const old of previous) {
      if (taken.has(old.id)) continue;
      // Cells drift east; allow for that and for the patch changing shape.
      const d = distance({ x: old.pos.x + drift, y: old.pos.y }, cell.pos);
      if (d < Math.max(old.radiusM, cell.radiusM) + FIELD_CELL_M && d < bestD) {
        best = old;
        bestD = d;
      }
    }
    if (best) {
      cell.id = best.id;
      taken.add(best.id);
    } else {
      cell.id = newId();
    }
  }
  return next;
}

/** The sim's fog banks that reach the charted area, at game time `t`. */
export function chartFogBanks(state: WeatherState, geo: ChartGeography, t: number): ChartFogBank[] {
  const { min, max } = geo.charted;
  const out: ChartFogBank[] = [];
  for (const b of fogBanksAt(state, t)) {
    const pos = fromWorldChart(geo, { x: b.x, y: b.y });
    const dx = Math.max(min.x - pos.x, 0, pos.x - max.x);
    const dy = Math.max(min.y - pos.y, 0, pos.y - max.y);
    if (Math.hypot(dx, dy) >= b.radius) continue;
    out.push({
      id: b.id,
      kind: b.kind,
      pos,
      radiusM: b.radius,
      wallM: 0.75 * b.radius,
      strength: b.strength,
    });
  }
  return out;
}

/** Systems whose centres lie within this of the chart are drawn (or pointed to at its edge). */
const CENTRE_REACH_M = 1_600_000;

/** The pressure systems near enough to matter, with their central pressure at `t`. */
export function pressureCentres(
  state: WeatherState,
  geo: ChartGeography,
  t: number,
): ChartPressureCentre[] {
  const dt = t - state.tickSeconds;
  const mid = toWorldChart(geo, {
    x: (geo.charted.min.x + geo.charted.max.x) / 2,
    y: (geo.charted.min.y + geo.charted.max.y) / 2,
  });
  const out: ChartPressureCentre[] = [];
  for (const s of state.systems) {
    if (s.age + dt <= 0 || s.age + dt >= s.life) continue;
    const world = { x: s.x + s.vx * dt, y: s.y + s.vy * dt };
    if (Math.hypot(world.x - mid.x, world.y - mid.y) > CENTRE_REACH_M) continue;
    const hpa = pressureAt(state, world, t);
    // A system still forming barely shows, and a high in a deep low's trough is no high:
    // leave them off until they have a centre to speak of.
    if (s.kind === 'low' ? hpa > 1010 : hpa < 1016) continue;
    out.push({
      id: s.id,
      kind: s.kind,
      pos: fromWorldChart(geo, world),
      vx: s.vx,
      vy: s.vy,
      radiusM: s.radius,
      hpa,
    });
  }
  return out;
}

/**
 * The weather picture at `now + leadHours`. The forecast runs the sim's systems and fog
 * banks forward on their present tracks, which is what a forecaster in 1900 did by hand.
 * It can't know the lows not yet formed, or a bank's drift changing with the wind, so a
 * forecast is drawn with uncertainty that grows with the lead (`forecastSpreadM`).
 */
export function weatherPicture(
  state: WeatherState,
  geo: ChartGeography,
  now: number,
  leadHours = 0,
  /** Last tick's cells, to carry their ids over (the chart's own picture, not a forecast). */
  previous?: { cells: readonly StormCell[]; at: number; newId: () => number },
): ChartWeatherPicture {
  const at = now + leadHours * HOUR;
  const field = sampleField(state, geo, geo.charted, at);
  const thunder = (p: Chart): boolean => isThunder(state, toWorldChart(geo, p), at);
  let cells = findStormCells(field, thunder);
  if (previous) {
    cells = trackCells(previous.cells, cells, at - previous.at, previous.newId);
  } else {
    // A one-off picture (a forecast): ids by rank, since nothing tracks them.
    cells.forEach((c, i) => (c.id = i + 1));
  }
  return {
    at,
    leadHours,
    field,
    cells,
    fogBanks: chartFogBanks(state, geo, at),
    centres: pressureCentres(state, geo, at),
  };
}

/** Most of the squall at a point is summer thunder rather than a cold squall in a gale. */
function isThunder(state: WeatherState, worldP: Chart, t: number): boolean {
  const squall = squallAt(state, worldP, t);
  return squall > 0 && thunderstormAt(state, worldP, t) > 0.5 * squall;
}

/** How far a forecast position may be off after `leadHours`, meters. */
export function forecastSpreadM(leadHours: number): number {
  return 12_000 + 4_000 * Math.max(leadHours, 0);
}

/** The ± share on a forecast wind speed after `leadHours`. */
export function forecastWindSpread(leadHours: number): number {
  return Math.min(0.5, 0.12 + 0.02 * Math.max(leadHours, 0));
}

// ---------------------------------------------------------------------------------
// Contacts: what the lookouts report of the weather

/** Squalls show far off: the anvil cloud, the black line under it, the lightning. */
const SQUALL_CONSPICUITY = 2;
/** A fog bank is seen at its edge, as a gray wall, no farther than an ordinary contact. */
const FOG_CONSPICUITY = 1;

/**
 * The storm cells and fog banks as chart contacts, so the lookouts report them and the
 * encounter card offers them like any other sighting. `known` carries contacts over by id,
 * so their last-seen record (and the lookouts' memory of them) survives the refresh.
 */
export function weatherContacts(
  picture: ChartWeatherPicture,
  known: ReadonlyMap<string, Contact>,
): Contact[] {
  const out: Contact[] = [];
  for (const cell of picture.cells) {
    const id = `weather.squall.${cell.id}`;
    const c = known.get(id) ?? {
      id,
      kind: 'storm' as const,
      name: cell.thunder ? 'Thunder squall' : 'Squall line',
      pos: cell.pos,
      heading: Math.PI / 2,
      speedKn: STORM_CELL_DRIFT_MS / (METERS_PER_NAUTICAL_MILE / 3600),
      conspicuity: SQUALL_CONSPICUITY,
      hostile: false,
      threat: true,
      prize: false,
    };
    c.pos = cell.pos;
    c.radiusM = cell.radiusM;
    out.push(c);
  }
  for (const bank of picture.fogBanks) {
    // A bank still forming or lifting is haze, not a wall to report.
    if (bank.strength < 0.5) continue;
    const id = `weather.fog.${bank.id}`;
    const c = known.get(id) ?? {
      id,
      kind: 'fog' as const,
      name: bank.kind === 'radiation' ? 'Ground fog' : 'Fog bank',
      pos: bank.pos,
      heading: 0,
      speedKn: 0,
      conspicuity: FOG_CONSPICUITY,
      hostile: false,
      threat: true,
      prize: false,
    };
    c.pos = bank.pos;
    c.radiusM = bank.wallM;
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------------
// The forecast the HUD reads

export interface ChartForecast {
  barometer: BarometerReading;
  /** Hours ahead the outlook is for. */
  leadHours: number;
  /** The wind expected then, with its spread. */
  windFrom: number;
  windLowKn: number;
  windHighKn: number;
  rain: boolean;
  /** A squall or thunderstorm expected at the ship's position then. */
  squall: boolean;
  /** Visibility expected then, meters. */
  visibilityM: number;
}

/** The outlook at a chart point `leadHours` ahead, from the systems on their tracks. */
export function forecastAt(
  state: WeatherState,
  geo: ChartGeography,
  p: Chart,
  now: number,
  leadHours: number,
): ChartForecast {
  const world = toWorldChart(geo, p);
  const at = now + leadHours * HOUR;
  const w = windAt(state, world, at);
  const spread = forecastWindSpread(leadHours);
  return {
    barometer: barometerAt(state, world, now),
    leadHours,
    windFrom: w.fromRad,
    windLowKn: Math.max(0, w.speedKn * (1 - spread)),
    windHighKn: w.speedKn * (1 + spread),
    rain: precipitationAt(state, world, at) > 0.25,
    squall: squallAt(state, world, at) >= SQUALL_CELL_MIN,
    visibilityM: visibilityAt(state, world, at),
  };
}

/** Weather met along a laid course: the first squall or fog the ship would sail into. */
export interface CourseWeather {
  kind: 'squall' | 'fog' | 'gale';
  /** Game hours from setting out. */
  hours: number;
  pos: Chart;
}

/** Fog thick enough to call out on a course, meters. */
const COURSE_FOG_M = 1500;
/** The longest step `courseWeather` takes along a course, meters. */
const COURSE_STEP_M = 2500;
/** Wind worth a warning on a course, knots (a gale, Beaufort 8). */
const COURSE_GALE_KN = 34;

/**
 * Sails the course forward in half-hour steps (2.5 km at most) at the forecast wind and reports the first
 * squall, fog or gale on it. Like the forecast, it trusts the systems' present tracks.
 */
export function courseWeather(
  state: WeatherState,
  geo: ChartGeography,
  course: PlannedCourse,
  ship: ChartShip,
  now: number,
  stepHours = 0.5,
): CourseWeather | undefined {
  let t = now;
  const maxHours = 48;
  for (const leg of course.legs) {
    let along = 0;
    while (along < leg.lengthM) {
      const frac = along / leg.lengthM;
      const pos = {
        x: leg.from.x + (leg.to.x - leg.from.x) * frac,
        y: leg.from.y + (leg.to.y - leg.from.y) * frac,
      };
      const world = toWorldChart(geo, pos);
      const hours = (t - now) / HOUR;
      if (hours > maxHours) return undefined;
      if (squallAt(state, world, t) >= SQUALL_CELL_MIN) return { kind: 'squall', hours, pos };
      if (visibilityAt(state, world, t) < COURSE_FOG_M) return { kind: 'fog', hours, pos };
      const wind = windAt(state, world, t);
      if (wind.speedKn >= COURSE_GALE_KN) return { kind: 'gale', hours, pos };
      const speed = Math.max(
        chartSpeedKn(leg.heading, { from: wind.fromRad, speedKn: wind.speedKn }, ship),
        0.5,
      );
      // Half an hour's sailing, or 2.5 km if that is less, so a small bank isn't stepped over.
      const ms = speed * (METERS_PER_NAUTICAL_MILE / 3600);
      const step = Math.min(ms * stepHours * HOUR, COURSE_STEP_M);
      along += step;
      t += step / ms;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------
// The chart's sky: the sim's state and what the chart last read of it

export interface ChartSky {
  /** The run's weather (WorldState.environment.weather), advanced on the chart's world tick. */
  readonly state: WeatherState;
  /** The weather as it stands, refreshed each world tick. */
  picture: ChartWeatherPicture | undefined;
  /** Storm cells and fog banks as contacts. */
  contacts: Contact[];
  /** Visibility at the ship, meters. */
  visibilityM: number;
  nextCellId: number;
}

export function createChartSky(state: WeatherState): ChartSky {
  return {
    state,
    picture: undefined,
    contacts: [],
    visibilityM: visibilityAt(state, { x: 0, y: 0 }, state.tickSeconds),
    nextCellId: 1,
  };
}

/** Read the sim again: the picture, its contacts and the visibility at the ship. */
export function refreshSky(sky: ChartSky, geo: ChartGeography, ship: Chart, now: number): void {
  const newId = (): number => sky.nextCellId++;
  // The first picture has nothing to track from, so its cells all take new ids.
  const last = sky.picture;
  sky.picture = weatherPicture(sky.state, geo, now, 0, {
    cells: last?.cells ?? [],
    at: last?.at ?? now,
    newId,
  });
  const known = new Map(sky.contacts.map((c) => [c.id, c]));
  sky.contacts = weatherContacts(sky.picture, known);
  sky.visibilityM = chartVisibilityAt(sky.state, geo, ship, now);
}
