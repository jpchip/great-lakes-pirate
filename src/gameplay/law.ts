import type { GameContext, GameEvents } from '../modes/context';
import { WORLD_TICK_GAME_SECONDS } from '../core/time';
import { gameSmuggler } from '../sim/economy/smuggler';
import { gameLaw, type LawDefs } from '../sim/law/defs';
import {
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
import { playerRegion, regionOfPort } from '../sim/law/regions';
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
 *   observers say was watching (nobody, until piece B lands). One crime a night.
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
  setHeat(region: string, heat: number): LawEvent[];
  setTier(region: string, tier: number): LawEvent[];
  dispose(): void;
}

/** A merchant at the port's market (plan 06 §2.4: tells the police, ~30–60 min). */
function merchantAt(port: string): Witness {
  return { id: `merchant.${port}`, kind: 'merchant', name: 'a merchant', identification: 'person' };
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
    region: () => playerRegion(defs, ctx.state),
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
        witnesses: [merchantAt(e.port)],
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
    ctx.events.on('SmugglerDealt', () => {
      const t = now();
      if (t - lastDealAt < DEAL_WINDOW_S) return;
      lastDealAt = t;
      const region = gameSmuggler().anchorage.region;
      if (!defs.regionById.has(region)) return;
      law.commit({ crime: 'crime.smuggler_deal', region, witnesses: law.witnesses.witnesses() });
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
