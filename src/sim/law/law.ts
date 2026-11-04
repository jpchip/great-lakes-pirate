import { Rng } from '../../core/rng';
import { SECONDS_PER_GAME_DAY, dayAndHour } from '../../core/time';
import type { CrimeDef } from '../../../data/schemas/law';
import { crimeDef, fameTier, tierDef, wantedTier, type LawDefs } from './defs';
import type { LawState, OpenCrime, RegionWanted, Report } from './state';
import { IDENTIFICATION_ORDER, type Identification, type Witness } from './witness';

/**
 * The crime pipeline (plan 06 §2.1; Phase 5 piece A):
 *
 *   crime committed ─► witnessed? ─► identified how well? ─► a report travels ─► heat
 *
 * Unseen crimes stay unseen. Each witness carries its own report, landing after a delay
 * by kind (§2.4); a report can be intercepted before it lands. A report adds the crime's
 * heat × its identification factor to the region, less whatever an earlier report on the
 * same crime already added, so two keepers seeing one deal don't count it twice. Reports
 * that only saw "someone" raise the region's alertness, never its tier.
 *
 * The world tick files reports that are due, spreads the news of the heaviest crimes to
 * the neighbors (§3.4), and lets heat and Fame decay (§3.3, §4.1).
 *
 * Everything here is plain state in, events out; the game layer (`gameplay/law.ts`)
 * raises the events on the bus.
 */

/** Hours after dusk a keeper won't row to town until dawn (with `dawnHour`). */
const NIGHT_FROM_HOUR = 20;

/** What the law needs from the run besides its own slices. */
export interface LawWorld {
  law: LawState;
  /** Standing by port or company (plan 05 §5.2); identified crimes lower it. */
  standing: Record<string, number>;
  /** The run's seed: the same crime gets the same report delays after a reload. */
  seed: string;
}

export interface WitnessRef {
  id: string;
  kind: Witness['kind'];
  name: string;
}

export type LawEvent =
  | {
      type: 'CrimeCommitted';
      crimeId: string;
      crime: string;
      region: string;
      port: string | undefined;
      witnesses: number;
      at: number;
    }
  | {
      type: 'Witnessed';
      crimeId: string;
      reportId: string;
      witness: WitnessRef;
      identification: Identification;
      eta: number;
    }
  | {
      type: 'ReportFiled';
      crimeId: string;
      crime: string;
      region: string;
      reportId: string;
      witness: WitnessRef;
      identification: Identification;
      heatAdded: number;
      alertAdded: number;
    }
  | { type: 'ReportIntercepted'; crimeId: string; reportId: string; witness: WitnessRef }
  | { type: 'WantedTierChanged'; region: string; from: number; to: number; heat: number }
  | { type: 'HeatSpread'; crimeId: string; from: string; to: string[]; heat: number }
  | { type: 'FameChanged'; value: number; delta: number; tierFrom: number; tierTo: number }
  | { type: 'ProfileChanged'; hull: number; classId: string; name: string; shed: number };

export type LawEventOf<T extends LawEvent['type']> = Extract<LawEvent, { type: T }>;

export interface CrimeInput {
  crime: string;
  region: string;
  /** The port it happened at or is reported to (Standing); else the region's seat. */
  port?: string;
  /** Who saw it. A `traced` crime is named to you whoever saw it, or nobody. */
  witnesses: readonly Witness[];
}

export function regionWanted(law: LawState, region: string): RegionWanted {
  let w = law.wanted[region];
  if (!w) {
    w = { heat: 0, shipHeat: 0, alert: 0 };
    law.wanted[region] = w;
  }
  return w;
}

export function heatIn(law: LawState, region: string): number {
  return law.wanted[region]?.heat ?? 0;
}

export function tierIn(defs: LawDefs, law: LawState, region: string): number {
  return wantedTier(defs, heatIn(law, region));
}

function factor(defs: LawDefs, id: Identification): number {
  return defs.wanted.identification[id] ?? 0;
}

function stronger(a: Identification, b: Identification): Identification {
  return IDENTIFICATION_ORDER.indexOf(a) >= IDENTIFICATION_ORDER.indexOf(b) ? a : b;
}

/** When a witness's report lands (plan 06 §2.4), game seconds. */
export function reportEta(defs: LawDefs, witness: Witness, at: number, rng: Rng): number {
  const rule = defs.actors.witnesses[witness.kind];
  const delay = (witness.reporting && rule?.byReporting?.[witness.reporting]) || rule?.delay;
  if (!delay) return at;
  let start = at;
  if (delay.atDawn) {
    const { day, hour } = dayAndHour(at);
    const dawn = defs.actors.dawnHour;
    if (hour >= NIGHT_FROM_HOUR) start = (day + 1) * SECONDS_PER_GAME_DAY + dawn * 3600;
    else if (hour < dawn) start = day * SECONDS_PER_GAME_DAY + dawn * 3600;
  }
  const hours = delay.maxH > delay.minH ? rng.range(delay.minH, delay.maxH) : delay.minH;
  return start + hours * 3600;
}

/**
 * Commits a crime (plan 06 §2.1). With no witnesses it's gone at once: nothing comes of
 * it. Otherwise each witness sets off with a report. A witness who files at once (the
 * cutter, standing right there) is filed in this call.
 */
export function commitCrime(
  defs: LawDefs,
  world: LawWorld,
  input: CrimeInput,
  now: number,
): LawEvent[] {
  const def = crimeDef(defs, input.crime);
  if (!defs.regionById.has(input.region)) throw new Error(`Unknown region ${input.region}`);
  const { law } = world;
  const id = `crime-${law.reports.nextId++}`;
  const events: LawEvent[] = [
    {
      type: 'CrimeCommitted',
      crimeId: id,
      crime: def.id,
      region: input.region,
      port: input.port,
      witnesses: input.witnesses.length,
      at: now,
    },
  ];
  if (input.witnesses.length === 0) return events;
  law.reports.crimes.push({
    id,
    crime: def.id,
    region: input.region,
    ...(input.port ? { port: input.port } : {}),
    at: now,
    hull: law.profiles.ship.hull,
    filed: 0,
    named: false,
  });
  for (const w of input.witnesses) {
    const rng = Rng.fromSeed(`${world.seed}|report|${id}|${w.id}`);
    const report: Report = {
      id: `report-${law.reports.nextId++}`,
      crimeId: id,
      witness: { id: w.id, kind: w.kind, name: w.name },
      identification: def.traced ? 'person' : w.identification,
      eta: reportEta(defs, w, now, rng),
    };
    law.reports.inProgress.push(report);
    events.push({
      type: 'Witnessed',
      crimeId: id,
      reportId: report.id,
      witness: report.witness,
      identification: report.identification,
      eta: report.eta,
    });
  }
  events.push(...fileDue(defs, world, now));
  return events;
}

/** Applies a heat change to a region, with a tier change event if it crossed one. */
function moveHeat(
  defs: LawDefs,
  law: LawState,
  region: string,
  delta: number,
  shipDelta: number,
  events: LawEvent[],
): void {
  const w = regionWanted(law, region);
  const from = wantedTier(defs, w.heat);
  w.heat = Math.max(0, w.heat + delta);
  w.shipHeat = Math.min(w.heat, Math.max(0, w.shipHeat + shipDelta));
  const to = wantedTier(defs, w.heat);
  const floor = tierDef(defs, to).decayFloor;
  if (delta > 0 && floor > (w.floor ?? 0)) w.floor = floor;
  if (to !== from) events.push({ type: 'WantedTierChanged', region, from, to, heat: w.heat });
}

/** Adds Fame (a deed that names you, or piece F's headlines). */
export function gainFame(
  defs: LawDefs,
  law: LawState,
  amount: number,
  now: number,
): LawEvent | undefined {
  if (amount <= 0) return undefined;
  const tierFrom = fameTier(defs, law.fame.value);
  law.fame.value += amount;
  law.fame.lastNotableAt = now;
  return {
    type: 'FameChanged',
    value: law.fame.value,
    delta: amount,
    tierFrom,
    tierTo: fameTier(defs, law.fame.value),
  };
}

function fileReport(
  defs: LawDefs,
  world: LawWorld,
  report: Report,
  crime: OpenCrime,
  now: number,
  events: LawEvent[],
): void {
  const { law } = world;
  const def = crimeDef(defs, crime.crime);
  let id = report.identification;
  // No disguise, but a new hull: a report on the old ship only describes "a schooner".
  if (id === 'ship' && crime.hull !== law.profiles.ship.hull) id = 'schooner';
  let heatAdded = 0;
  let alertAdded = 0;
  if (id === 'unknown') {
    alertAdded = def.heat * factor(defs, 'unknown');
    regionWanted(law, crime.region).alert += alertAdded;
  } else {
    const f = factor(defs, id);
    heatAdded = def.heat * Math.max(0, f - crime.filed);
    crime.filed = Math.max(crime.filed, f);
    if (heatAdded > 0) {
      moveHeat(defs, law, crime.region, heatAdded, id === 'ship' ? heatAdded : 0, events);
    }
    if (!crime.named && (id === 'ship' || id === 'person')) {
      crime.named = true;
      nameCrime(defs, world, crime, def, now, events);
    }
    if (def.news && crime.newsAt === undefined && heatAdded > 0) {
      crime.newsAt = now + defs.wanted.spread.delayHours * 3600;
    }
  }
  // Fresh heat holds for the grace period from when the law hears of it.
  if (heatAdded > 0) regionWanted(law, crime.region).lastCrimeAt = now;
  events.push({
    type: 'ReportFiled',
    crimeId: crime.id,
    crime: crime.crime,
    region: crime.region,
    reportId: report.id,
    witness: report.witness,
    identification: id,
    heatAdded,
    alertAdded,
  });
}

/** A crime named to you: Standing in the port (§4.3) and the Fame it brings (§4.1). */
function nameCrime(
  defs: LawDefs,
  world: LawWorld,
  crime: OpenCrime,
  def: CrimeDef,
  now: number,
  events: LawEvent[],
): void {
  const port = crime.port ?? defs.regionById.get(crime.region)?.seat;
  if (port && def.standing > 0) {
    world.standing[port] = Math.max(0, (world.standing[port] ?? 0) - def.standing);
  }
  const fame = gainFame(defs, world.law, def.fame, now);
  if (fame) events.push(fame);
}

/** Files every report whose time has come. */
export function fileDue(defs: LawDefs, world: LawWorld, now: number): LawEvent[] {
  const { reports } = world.law;
  const events: LawEvent[] = [];
  const due = reports.inProgress.filter((r) => r.eta <= now).sort((a, b) => a.eta - b.eta);
  if (due.length === 0) return events;
  reports.inProgress = reports.inProgress.filter((r) => r.eta > now);
  for (const r of due) {
    const crime = reports.crimes.find((c) => c.id === r.crimeId);
    if (crime) fileReport(defs, world, r, crime, now, events);
  }
  pruneCrimes(world.law);
  return events;
}

/** Drops crimes with nothing left in flight: no report on its way, no news to spread. */
function pruneCrimes(law: LawState): void {
  const pending = new Set(law.reports.inProgress.map((r) => r.crimeId));
  law.reports.crimes = law.reports.crimes.filter(
    (c) => pending.has(c.id) || c.newsAt !== undefined,
  );
}

/**
 * Stops a report before it lands (plan 06 §2.4: catch, intimidate or bribe the witness,
 * or overtake the keeper's boat). Returns undefined if there's no such report.
 */
export function interceptReport(world: LawWorld, reportId: string): LawEvent | undefined {
  const { reports } = world.law;
  const r = reports.inProgress.find((x) => x.id === reportId);
  if (!r) return undefined;
  reports.inProgress = reports.inProgress.filter((x) => x !== r);
  pruneCrimes(world.law);
  return { type: 'ReportIntercepted', crimeId: r.crimeId, reportId: r.id, witness: r.witness };
}

/** The news of the heaviest crimes reaches the neighbors (§3.4); more so with Fame. */
function spreadNews(defs: LawDefs, world: LawWorld, now: number, events: LawEvent[]): void {
  const { law } = world;
  const { fraction, perFameTier } = defs.wanted.spread;
  let any = false;
  for (const c of law.reports.crimes) {
    if (c.newsAt === undefined || c.newsAt > now) continue;
    c.newsAt = undefined;
    any = true;
    const region = defs.regionById.get(c.region);
    if (!region || region.neighbors.length === 0) continue;
    const share = Math.min(1, fraction + perFameTier * fameTier(defs, law.fame.value));
    const heat = crimeDef(defs, c.crime).heat * c.filed * share;
    if (heat <= 0) continue;
    for (const n of region.neighbors) {
      moveHeat(defs, law, n, heat, 0, events);
      const w = regionWanted(law, n);
      w.lastCrimeAt = Math.max(w.lastCrimeAt ?? now, now);
    }
    events.push({
      type: 'HeatSpread',
      crimeId: c.id,
      from: c.region,
      to: [...region.neighbors],
      heat,
    });
  }
  if (any) pruneCrimes(law);
}

/**
 * Heat decays per game hour (§3.3): faster away from the region, not at all for a grace
 * period after a crime there, slower at higher tiers, and never below tier 3 by decay
 * alone once at tier 4+.
 */
function decayHeat(
  defs: LawDefs,
  law: LawState,
  hours: number,
  here: string | undefined,
  now: number,
  events: LawEvent[],
): void {
  const { decay } = defs.wanted;
  for (const [region, w] of Object.entries(law.wanted)) {
    const present = region === here;
    if (present) w.lastSeenAt = now;
    w.alert = Math.max(0, w.alert - decay.alertPerHour * hours);
    if (w.heat <= 0) continue;
    if (w.lastCrimeAt !== undefined && now - w.lastCrimeAt < decay.graceHours * 3600) continue;
    const tier = tierDef(defs, wantedTier(defs, w.heat));
    const rate = tier.decayPerHour * (present ? decay.presentFactor : 1);
    const floor = Math.min(w.heat, Math.max(tier.decayFloor, w.floor ?? 0));
    const next = Math.max(floor, w.heat - rate * hours);
    if (next === w.heat) continue;
    const kept = w.heat > 0 ? next / w.heat : 0;
    const from = wantedTier(defs, w.heat);
    w.shipHeat *= kept;
    w.heat = next;
    const to = wantedTier(defs, w.heat);
    if (to !== from) events.push({ type: 'WantedTierChanged', region, from, to, heat: w.heat });
  }
  if (here) regionWanted(law, here).lastSeenAt = now;
}

/** Fame fades after a grace period with nothing notable; legends fade more slowly. */
function decayFame(
  defs: LawDefs,
  law: LawState,
  hours: number,
  now: number,
  events: LawEvent[],
): void {
  const { fame } = law;
  if (fame.value <= 0) return;
  const { graceDays, perDay, legendPerDay } = defs.fame.decay;
  if (now - (fame.lastNotableAt ?? 0) < graceDays * SECONDS_PER_GAME_DAY) return;
  const tierFrom = fameTier(defs, fame.value);
  const top = tierFrom === defs.fame.tiers.length - 1;
  const before = fame.value;
  fame.value *= Math.pow(1 - (top ? legendPerDay : perDay), hours / 24);
  if (fame.value < 0.01) fame.value = 0;
  const tierTo = fameTier(defs, fame.value);
  if (tierTo !== tierFrom) {
    events.push({
      type: 'FameChanged',
      value: fame.value,
      delta: fame.value - before,
      tierFrom,
      tierTo,
    });
  }
}

/**
 * The law's world tick: reports land, news spreads, heat and Fame decay. `hours` is the
 * game time the tick covers; `here` is the player's region (or undefined off the map).
 */
export function tickLaw(
  defs: LawDefs,
  world: LawWorld,
  now: number,
  hours: number,
  here: string | undefined,
): LawEvent[] {
  const events = fileDue(defs, world, now);
  spreadNews(defs, world, now, events);
  decayHeat(defs, world.law, hours, here, now, events);
  decayFame(defs, world.law, hours, now, events);
  return events;
}

/**
 * A genuinely new hull (plan 06 §2.3): the heat tied to the old ship's profile goes, and
 * reports still on their way about her only describe "a schooner". The personal record
 * stays. Renaming or repainting changes nothing.
 */
export function replaceShip(
  defs: LawDefs,
  law: LawState,
  classId: string,
  name: string,
  now: number,
): LawEvent[] {
  const events: LawEvent[] = [];
  let shed = 0;
  for (const [region, w] of Object.entries(law.wanted)) {
    if (w.shipHeat <= 0) continue;
    shed += w.shipHeat;
    moveHeat(defs, law, region, -w.shipHeat, -w.shipHeat, events);
  }
  const ship = law.profiles.ship;
  law.profiles.ship = { hull: ship.hull + 1, classId, name, since: now };
  events.push({ type: 'ProfileChanged', hull: ship.hull + 1, classId, name, shed });
  return events;
}

/** Sets a region's heat outright (the dev panel; piece D's reset to tier 1 after jail). */
export function setHeat(defs: LawDefs, law: LawState, region: string, heat: number): LawEvent[] {
  const events: LawEvent[] = [];
  const w = regionWanted(law, region);
  const ship = w.heat > 0 ? w.shipHeat / w.heat : 0;
  moveHeat(defs, law, region, heat - w.heat, heat * ship - w.shipHeat, events);
  // Set outright (a bribe, a fine, time served): the floor is the new tier's own.
  const floor = tierDef(defs, wantedTier(defs, w.heat)).decayFloor;
  if (floor > 0) w.floor = floor;
  else delete w.floor;
  return events;
}

/** Sets a region to the bottom of a tier (the dev panel). */
export function setTier(defs: LawDefs, law: LawState, region: string, tier: number): LawEvent[] {
  const t = tierDef(defs, tier);
  return setHeat(defs, law, region, t.minHeat);
}

/** How likely people in port are to know your face, 0–1 (plan 06 §2.3: grows with Fame). */
export function recognition(defs: LawDefs, law: LawState): number {
  const top = defs.fame.tiers.length - 1;
  return top > 0 ? fameTier(defs, law.fame.value) / top : 0;
}

/** The strongest identification among witnesses (for a summary line). */
export function bestIdentification(witnesses: readonly Witness[]): Identification | undefined {
  let best: Identification | undefined;
  for (const w of witnesses) best = best ? stronger(w.identification, best) : w.identification;
  return best;
}
