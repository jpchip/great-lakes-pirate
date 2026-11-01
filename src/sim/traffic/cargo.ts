import factionsJson from '../../../data/factions.json';
import flowsJson from '../../../data/flows.json';
import { factionsFileSchema, type Faction } from '../../../data/schemas/factions';
import { flowsFileSchema, type FlowDef } from '../../../data/schemas/flows';
import type { RouteLane } from '../../../data/schemas/routes';
import type { ShipRecord } from '../../../data/schemas/ships';
import { SHIP_RECORDS } from '../sailing/ships';
import {
  cycleS,
  cycleStartS,
  hash01,
  monthAt,
  sailsInCycle,
  westernSuperiorRoutes,
  type LaneSchedule,
  type RouteGraph,
} from '../chart/routes';
import type { Contact } from '../chart/traffic';
import type { EconomyDefs } from '../economy/defs';

/**
 * Cargo on the lake's traffic (plan 05 §8.1, Phase 4 piece D). Every ship on the route
 * graph carries what its lane's flow sends that way: a manifest drawn from the run's seed,
 * the ship, the passage and the month, so it is a pure function of the clock like the
 * ship's place (`routes.ts`). Nothing about a manifest is saved unless something changes
 * it (`TrafficState`). Owners come from the lane's fleet.
 */

export interface TrafficDefs {
  flows: readonly FlowDef[];
  /** Flow by `${lane}|${from}`: what a ship leaving `from` on `lane` loads. */
  byLeg: ReadonlyMap<string, FlowDef>;
  /** Owners by lane. */
  owners: ReadonlyMap<string, readonly string[]>;
  factions: ReadonlyMap<string, Faction>;
  /** Port id by route node, for the nodes that are ports. */
  portOf: ReadonlyMap<string, string>;
}

export function compileTraffic(
  graph: RouteGraph,
  features = flowsFileSchema.parse(flowsJson),
  factionList: readonly Faction[] = factionsFileSchema.parse(factionsJson),
): TrafficDefs {
  const factions = new Map(factionList.map((f) => [f.id, f]));
  const lanes = new Map(graph.lanes.map((l) => [l.id, l]));
  const flows: FlowDef[] = [];
  const byLeg = new Map<string, FlowDef>();
  const owners = new Map<string, readonly string[]>();
  for (const f of features) {
    const lane = lanes.get(f.lane);
    if (!lane) throw new Error(`${f.id}: no lane ${f.lane}`);
    if (f.kind === 'fleet') {
      for (const o of f.owners) if (!factions.has(o)) throw new Error(`${f.id}: no ${o}`);
      owners.set(f.lane, f.owners);
      continue;
    }
    const ends = [lane.from, lane.to];
    if (!ends.includes(f.from) || !ends.includes(f.to) || f.from === f.to) {
      throw new Error(`${f.id}: ${f.from}→${f.to} isn't a way along ${lane.id}`);
    }
    const key = `${f.lane}|${f.from}`;
    if (byLeg.has(key)) throw new Error(`${f.id}: a second flow from ${f.from} on ${f.lane}`);
    byLeg.set(key, f);
    flows.push(f);
  }
  const portOf = new Map<string, string>();
  for (const [id, node] of graph.nodes) if (node.port) portOf.set(id, node.port);
  return { flows, byLeg, owners, factions, portOf };
}

let cached: TrafficDefs | undefined;

/** The game's flows and companies over the western Superior route graph. */
export function gameTraffic(): TrafficDefs {
  cached ??= compileTraffic(westernSuperiorRoutes());
  return cached;
}

/** A crew for each class, for the manifest (plan 05 §8.1: crew and armament). */
const CREW: Readonly<Record<string, number>> = {
  'ship.ore_freighter': 22,
  'ship.package_steamer': 28,
  'ship.schooner_barge': 7,
  'ship.fish_tug': 5,
  'ship.cutter_morrill': 40,
};

export interface ManifestLine {
  good: string;
  qty: number;
}

/** What a ship carries on one passage (plan 05 §8.1, §11 `traffic.voyages[]`). */
export interface Manifest {
  shipId: string;
  owner: string | undefined;
  /** Route nodes she sails from and to on this passage. */
  from: string;
  to: string;
  /** The ports at either end, when they are ports. */
  fromPort: string | undefined;
  toPort: string | undefined;
  /** Her hold and her consort's together, CU. Empty in ballast. */
  cargo: ManifestLine[];
  /** At base prices, cents. */
  valueCents: number;
  crew: number;
  /** Only the revenue cutter is armed in Phase 4 (plan 07 brings the rest). */
  armed: boolean;
  /** The passage: the timetable cycle and the direction. */
  cycle: number;
  outbound: boolean;
}

function record(id: string): ShipRecord {
  const r = SHIP_RECORDS.find((s) => s.id === id);
  if (!r) throw new Error(`No ship class ${id}`);
  return r;
}

/** A ship's hold with her consort's, CU. */
export function holdCu(c: Pick<Contact, 'classId' | 'consorts'>): number {
  if (!c.classId) return 0;
  let cu = record(c.classId).cargoCapacity;
  for (const k of c.consorts ?? []) cu += record(k.classId).cargoCapacity;
  return cu;
}

/** The company that owns a ship for the whole run, from her lane's fleet. */
export function ownerOf(defs: TrafficDefs, s: LaneSchedule): string | undefined {
  const list = defs.owners.get(s.laneId);
  if (!list || list.length === 0) return undefined;
  return list[Math.floor(hash01(`${s.key}:owner`) * list.length)] ?? list[0];
}

function weightOf(line: FlowDef['cargo'][number], month: number): number {
  return line.weight * (line.months?.[month] ?? 1);
}

/** Picks a line by weight with a 0–1 draw; undefined when every weight is zero. */
function pick<T>(lines: readonly T[], weights: readonly number[], u: number): T | undefined {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  let x = u * total;
  for (let i = 0; i < lines.length; i++) {
    x -= weights[i] ?? 0;
    if (x < 0) return lines[i];
  }
  return lines[lines.length - 1];
}

/**
 * The manifest for one passage of a ship: cycle `cycle`, outbound (from home) or back.
 * Bulk flows fill the hold with one good; mixed flows share it among up to three.
 */
export function manifestFor(
  defs: TrafficDefs,
  economy: EconomyDefs,
  c: Pick<Contact, 'id' | 'classId' | 'consorts' | 'schedule'>,
  cycle: number,
  outbound: boolean,
): Manifest | undefined {
  const s = c.schedule;
  if (!s || !c.classId) return undefined;
  const from = outbound ? s.homeNode : s.awayNode;
  const to = outbound ? s.awayNode : s.homeNode;
  const flow = defs.byLeg.get(`${s.laneId}|${from}`);
  const leaves = cycleStartS(s, cycle) + (outbound ? 0 : s.lengthM / s.speedMs + s.dwellAwayS);
  const month = monthAt(leaves);
  const key = `${s.key}:${cycle}:${outbound ? 'out' : 'back'}`;
  const cargo: ManifestLine[] = [];
  if (flow) {
    const cap = holdCu(c) * flow.load * (0.85 + 0.15 * hash01(`${key}:fill`));
    const weights = flow.cargo.map((l) => weightOf(l, month));
    const kinds = flow.mixed ? Math.min(3, flow.cargo.length) : 1;
    const chosen: string[] = [];
    for (let i = 0; i < kinds; i++) {
      const w = weights.map((x, j) => (chosen.includes(flow.cargo[j]?.good ?? '') ? 0 : x));
      const line = pick(flow.cargo, w, hash01(`${key}:good${i}`));
      if (line) chosen.push(line.good);
    }
    // Mixed freight splits the hold unevenly: the first good takes the most.
    const shares = chosen.map((_, i) => (chosen.length === 1 ? 1 : 0.5 ** (i + 1)));
    const sum = shares.reduce((a, b) => a + b, 0);
    chosen.forEach((good, i) => {
      const qty = Math.floor((cap * (shares[i] ?? 0)) / sum);
      if (qty > 0) cargo.push({ good, qty });
    });
  }
  let valueCents = 0;
  for (const l of cargo) valueCents += (economy.goods.get(l.good)?.basePriceCents ?? 0) * l.qty;
  return {
    shipId: c.id,
    owner: ownerOf(defs, s),
    from,
    to,
    fromPort: defs.portOf.get(from),
    toPort: defs.portOf.get(to),
    cargo,
    valueCents,
    crew: CREW[c.classId] ?? 6,
    armed: c.classId === 'ship.cutter_morrill',
    cycle,
    outbound,
  };
}

/**
 * The manifest a ship holds at `gameSeconds`: the passage she's on, or the one she's
 * loading for while she lies at an end (her next one out, or the run home).
 */
export function currentManifest(
  defs: TrafficDefs,
  economy: EconomyDefs,
  c: Contact,
  gameSeconds: number,
): Manifest | undefined {
  const s = c.schedule;
  if (!s) return undefined;
  const k = Math.floor((gameSeconds + s.phaseS) / cycleS(s));
  const u = gameSeconds - cycleStartS(s, k);
  const transit = s.lengthM / s.speedMs;
  // Laid up this cycle, she lies at home loading for her next run out.
  if (!sailsInCycle(s, k)) return manifestFor(defs, economy, c, k + 1, true);
  // Out, then lying away (loading for home), then home, then lying home (for the next run).
  if (u < transit) return manifestFor(defs, economy, c, k, true);
  if (u < 2 * transit + s.dwellAwayS) return manifestFor(defs, economy, c, k, false);
  return manifestFor(defs, economy, c, k + 1, true);
}

/** A ship arriving at or leaving an end of her lane. */
export interface TrafficCall {
  shipId: string;
  kind: 'arrive' | 'depart';
  node: string;
  at: number;
  cycle: number;
  outbound: boolean;
}

/**
 * The calls a ship's timetable makes in (t0, t1], in order. A cycle she lies up makes
 * none. Long gaps are cut to the last `maxCycles` cycles (a fast-forward of weeks).
 */
export function callsBetween(
  s: LaneSchedule,
  shipId: string,
  t0: number,
  t1: number,
  maxCycles = 8,
): TrafficCall[] {
  const out: TrafficCall[] = [];
  if (!(t1 > t0)) return out;
  const transit = s.lengthM / s.speedMs;
  const k1 = Math.floor((t1 + s.phaseS) / cycleS(s));
  const k0 = Math.max(Math.floor((t0 + s.phaseS) / cycleS(s)), k1 - maxCycles + 1);
  for (let k = k0; k <= k1; k++) {
    if (!sailsInCycle(s, k)) continue;
    const start = cycleStartS(s, k);
    const calls: [TrafficCall['kind'], string, number, boolean][] = [
      ['depart', s.homeNode, start, true],
      ['arrive', s.awayNode, start + transit, true],
      ['depart', s.awayNode, start + transit + s.dwellAwayS, false],
      ['arrive', s.homeNode, start + 2 * transit + s.dwellAwayS, false],
    ];
    for (const [kind, node, at, outbound] of calls) {
      if (at > t0 && at <= t1) out.push({ shipId, kind, node, at, cycle: k, outbound });
    }
  }
  return out;
}

/** What a call did to a port's market, for the event and the tests. */
export interface CargoDelivered {
  shipId: string;
  port: string;
  kind: 'arrive' | 'depart';
  cargo: ManifestLine[];
  at: number;
}

/**
 * A call's effect on its port's market (plan 05 §8.1): an arrival adds what she carried,
 * a departure takes what she loaded, each scaled by the flow's `impact` against the
 * port's in-season target stock. Goods the port doesn't trade are left alone.
 */
export function applyCall(
  defs: TrafficDefs,
  economy: EconomyDefs,
  markets: Record<string, Record<string, { stock: number }>>,
  c: Contact,
  call: TrafficCall,
): CargoDelivered | undefined {
  const s = c.schedule;
  const port = defs.portOf.get(call.node);
  if (!s || !port) return undefined;
  const manifest = manifestFor(defs, economy, c, call.cycle, call.outbound);
  if (!manifest || manifest.cargo.length === 0) return undefined;
  const flow = defs.byLeg.get(`${s.laneId}|${manifest.from}`);
  const pm = economy.markets.get(port);
  if (!flow || !pm || flow.impact <= 0) return undefined;
  const hold = holdCu(c);
  const moved: ManifestLine[] = [];
  for (const line of manifest.cargo) {
    const mg = pm.goods.get(line.good);
    const st = markets[port]?.[line.good];
    if (!mg || !st) continue;
    const delta = mg.targetStock * flow.impact * (line.qty / hold);
    st.stock =
      call.kind === 'arrive'
        ? st.stock + delta
        : Math.max(economy.rules.minStockCu, st.stock - delta);
    moved.push(line);
  }
  if (moved.length === 0) return undefined;
  return { shipId: c.id, port, kind: call.kind, cargo: moved, at: call.at };
}

/**
 * Runs every ship's calls in (t0, t1] against the markets, in time order. Returns what
 * moved. Allocation is per call; a world tick holds a handful at most.
 */
export function runTraffic(
  defs: TrafficDefs,
  economy: EconomyDefs,
  markets: Record<string, Record<string, { stock: number }>>,
  contacts: readonly Contact[],
  t0: number,
  t1: number,
): CargoDelivered[] {
  const calls: { c: Contact; call: TrafficCall }[] = [];
  for (const c of contacts) {
    if (!c.schedule) continue;
    for (const call of callsBetween(c.schedule, c.id, t0, t1)) calls.push({ c, call });
  }
  calls.sort((a, b) => a.call.at - b.call.at);
  const out: CargoDelivered[] = [];
  for (const { c, call } of calls) {
    const d = applyCall(defs, economy, markets, c, call);
    if (d) out.push(d);
  }
  return out;
}

/** Lanes with no flow either way sail empty (fishing grounds to grounds, the patrol). */
export function laneFlows(defs: TrafficDefs, lane: RouteLane): FlowDef[] {
  return defs.flows.filter((f) => f.lane === lane.id);
}
