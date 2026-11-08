import type { GameContext, GameEvents } from '../modes/context';
import { WORLD_TICK_GAME_SECONDS } from '../core/time';
import { gameSmuggler, smugglerById } from '../sim/economy/smuggler';
import { gameLaw, type LawDefs } from '../sim/law/defs';
import {
  tierIn,
  commitCrime,
  fileDue,
  interceptReport,
  replaceShip,
  setHeat,
  setTier,
  tickLaw,
  type CrimeInput,
  type LawEvent,
  type LawWorld,
} from '../sim/law/law';
import { informChance, informRoll } from '../sim/law/port-law';
import { playerRegion, regionOfPort } from '../sim/law/regions';
import { nightOf } from '../sim/economy/smuggler';
import {
  NO_WITNESSES,
  type Identification,
  type Witness,
  type WitnessKind,
  type WitnessSource,
} from '../sim/law/witness';
import type { WorldState } from '../sim/world-state';

/**
 * The law in the running game (plan 06 §2–4; Phase 5 piece A). It turns Phase 4's crimes
 * into the pipeline's input and raises what comes out on the bus:
 *
 * - `HotGoodsDetected`: a merchant found out a hot lot (selling hot goods) or contraband
 *   (smuggling). He saw you, so it's named to you, and he tells the harbor master within
 *   the hour.
 * - `ContractStolen`: always traced; the freight agent's word goes up the line.
 * - `SmugglerDealt`: dealing with the island smuggler, seen by whoever piece B's
 *   observers say was watching. One crime a night. At Wanted tier 2+ in her waters she
 *   may inform on you herself (piece E), by the same odds as a receiver.
 * - A receiver who turned you in (`HotGoodsDetected` with `informed`) is the witness.
 *
 * Piece C's cutter commits `crime.contraband` through `commit` when her hold search finds
 * it. The world tick files reports, spreads news and decays heat and Fame.
 */
export interface GameLaw {
  readonly defs: LawDefs;
  /** Who's watching at sea (piece B wires its observers in here). */
  witnesses: WitnessSource;
  commit(input: CrimeInput): LawEvent[];
  intercept(reportId: string): LawEvent | undefined;
  /** Lands every report on its way now (the dev panel). */
  fileAll(): LawEvent[];
  /** The player's region now. */
  region(): string | undefined;
  /**
   * Where the ship is right now, when the game can say (its live pose in the zone or on
   * the chart). Without it the region comes from the saved location, which only moves at
   * a save.
   */
  locate: (() => string | undefined) | undefined;
  setHeat(region: string, heat: number): LawEvent[];
  setTier(region: string, tier: number): LawEvent[];
  dispose(): void;
}

/** A merchant at the port's market (plan 06 §2.4: tells the police, ~30–60 min). */
function merchantAt(port: string): Witness {
  return { id: `merchant.${port}`, kind: 'merchant', name: 'a merchant', identification: 'person' };
}

/** Your receiver, who sent for the law instead (Phase 5 piece E). */
function receiverAt(port: string): Witness {
  return {
    id: `receiver.${port}`,
    kind: 'informant',
    name: 'your receiver',
    identification: 'person',
  };
}

/** The smuggler, selling you to the revenue man (plan 05 §23.4; Phase 5 piece E). */
export const SMUGGLER_INFORMANT: Witness = {
  id: 'informant.smuggler',
  kind: 'informant',
  name: 'the smuggler',
  identification: 'person',
};

/** A port fence, selling you to the law (plan 05 §6.2; Phase 6 piece E). */
function fenceInformant(fence: string): Witness {
  return {
    id: `informant.${fence}`,
    kind: 'informant',
    name: 'the fence',
    identification: 'person',
  };
}

/** The shipper's freight agent; contract theft is always traced (plan 06 §2.2). */
function freightAgentOf(company: string): Witness {
  return {
    id: `agent.${company}`,
    kind: 'freightAgent',
    name: 'the freight agent',
    identification: 'person',
  };
}

/** A stand-in witness for the dev panel and console. */
export function devWitness(kind: WitnessKind, identification: Identification): Witness {
  return { id: `dev.${kind}`, kind, name: `a ${kind} (dev)`, identification };
}

/** A smuggler deal within this long of the last one is the same night's business. */
const DEAL_WINDOW_S = 6 * 3600;

export function lawWorld(state: WorldState, seed: string): LawWorld {
  state.player.standing ??= {};
  return {
    law: state,
    standing: state.player.standing,
    seed,
  };
}

/** Raises a law event on the bus. */
export function emitLaw(ctx: GameContext, e: LawEvent): void {
  const { type, ...payload } = e;
  (ctx.events.emit as (t: keyof GameEvents, p: unknown) => void)(type, payload);
}

export function attachLaw(
  ctx: GameContext,
  /** The run's seed (the traffic's): report delays are the same after a reload. */
  seed: string,
  defs: LawDefs = gameLaw(),
): GameLaw {
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const world = (): LawWorld => lawWorld(ctx.state, seed);
  const raise = (events: LawEvent[]): LawEvent[] => {
    for (const e of events) emitLaw(ctx, e);
    return events;
  };
  let lastDealAt = -Infinity;
  const lastFenceAt = new Map<string, number>();

  const law: GameLaw = {
    defs,
    witnesses: NO_WITNESSES,
    commit: (input) => raise(commitCrime(defs, world(), input, now())),
    intercept(reportId) {
      const e = interceptReport(world(), reportId);
      if (e) emitLaw(ctx, e);
      return e;
    },
    fileAll() {
      for (const r of ctx.state.reports.inProgress) r.eta = Math.min(r.eta, now());
      return raise(fileDue(defs, world(), now()));
    },
    locate: undefined,
    region: () => law.locate?.() ?? playerRegion(defs, ctx.state),
    setHeat: (region, heat) => raise(setHeat(defs, ctx.state, region, heat)),
    setTier: (region, tier) => raise(setTier(defs, ctx.state, region, tier)),
    dispose: () => offs.forEach((off) => off()),
  };

  const offs = [
    ctx.events.on('HotGoodsDetected', (e) => {
      const region = e.region ?? regionOfPort(e.port);
      if (!region || !defs.regionById.has(region)) return;
      law.commit({
        crime: e.kind === 'contraband' ? 'crime.contraband' : 'crime.hot_goods',
        region,
        port: e.port,
        witnesses: [e.informed ? receiverAt(e.port) : merchantAt(e.port)],
      });
    }),
    ctx.events.on('ContractStolen', (e) => {
      const region = regionOfPort(e.port);
      if (!region || !defs.regionById.has(region)) return;
      law.commit({
        crime: 'crime.contract_theft',
        region,
        port: e.port,
        witnesses: [freightAgentOf(e.company)],
      });
    }),
    ctx.events.on('SmugglerDealt', (e) => {
      const t = now();
      if (t - lastDealAt < DEAL_WINDOW_S) return;
      lastDealAt = t;
      const anchorage = (smugglerById(e.smuggler) ?? gameSmuggler()).anchorage;
      const region = anchorage.region;
      if (!defs.regionById.has(region)) return;
      const witnesses = [...law.witnesses.witnesses()];
      // With the law after you in her waters, she may sell you to the revenue man.
      const p = informChance(defs, tierIn(defs, ctx.state, region));
      if (p > 0 && informRoll(seed, anchorage.id, nightOf(t), 'smuggler') < p) {
        witnesses.push(SMUGGLER_INFORMANT);
      }
      law.commit({ crime: 'crime.smuggler_deal', region, witnesses });
    }),
    // A fence's back room (Phase 6 piece E): nobody sees a deal made indoors after dark, but
    // with the law after you in the port's region he may sell you out, once a night's
    // business, on the receivers' odds (Phase 5 piece E).
    ctx.events.on('FenceDealt', (e) => {
      const t = now();
      if (t - (lastFenceAt.get(e.fence) ?? -Infinity) < DEAL_WINDOW_S) return;
      lastFenceAt.set(e.fence, t);
      const region = regionOfPort(e.port);
      if (!region || !defs.regionById.has(region)) return;
      const p = informChance(defs, tierIn(defs, ctx.state, region));
      if (p <= 0 || informRoll(seed, e.fence, nightOf(t), 'fence') >= p) return;
      law.commit({
        crime: 'crime.fence_deal',
        region,
        port: e.port,
        witnesses: [fenceInformant(e.fence)],
      });
    }),
    ctx.events.on('ShipPurchased', (e) => {
      raise(replaceShip(defs, ctx.state, e.classId, ctx.state.player.captain.shipName, now()));
    }),
    ctx.events.on('WorldTick', ({ gameSeconds }) => {
      raise(tickLaw(defs, world(), gameSeconds, WORLD_TICK_GAME_SECONDS / 3600, law.region()));
    }),
  ];
  // A report due while the game was closed lands on load.
  raise(fileDue(defs, world(), now()));
  return law;
}
