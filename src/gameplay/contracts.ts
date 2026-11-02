import {
  abandonContract,
  acceptContract,
  arriveAt,
  boardOffers,
  createContractsState,
  expireContracts,
  gameContracts,
  knockFragile,
  stealContract,
  type AbandonRefusal,
  type AcceptResult,
  type Arrival,
  type BoardOffer,
  type BoardSources,
  type ContractCaptain,
  type ContractDefs,
  type ContractsState,
  type StealRefusal,
} from '../sim/economy/contracts';
import { passageTable, type PassageTable } from '../sim/economy/passages';
import type { GameContext } from '../modes/context';
import type { WorldState } from '../sim/world-state';
import type { GameEconomy } from './economy';

/**
 * Freight contracts in the running game (plan 05 §5.2; Phase 4 piece F). The port screen's
 * freight agent tab reads the board and takes offers through this; docking delivers; the
 * world tick fails contracts past their late window; hard knocks with fragile cargo aboard
 * cost pay. Every change raises its event on the bus: `ContractAccepted`,
 * `ContractCompleted`, `ContractFailed` and `ContractStolen` (for Phase 5's Wanted).
 */
export interface GameContracts {
  defs: ContractDefs;
  readonly state: ContractsState;
  board(port: string): BoardOffer[];
  accept(port: string, offerId: string): AcceptResult;
  /** Docked at a port: deliveries and handing back failed cargo. */
  arrive(port: string): Arrival;
  abandon(contractId: string, port: string): AbandonRefusal | undefined;
  steal(contractId: string, port: string): StealRefusal | undefined;
  dispose(): void;
}

/** The contracts slice and Standing, made if a save predates them. */
export function contractsOf(state: WorldState): {
  contracts: ContractsState;
  captain: ContractCaptain;
} {
  state.contracts ??= createContractsState();
  state.player.standing ??= {};
  return {
    contracts: state.contracts,
    captain: state.player as WorldState['player'] & ContractCaptain,
  };
}

export function attachContracts(
  ctx: GameContext,
  economy: GameEconomy,
  /** The run's seed (the traffic's): boards are the same after a reload. */
  seed: string,
  defs: ContractDefs = gameContracts(),
  passages: PassageTable = passageTable(),
): GameContracts {
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const sources = (): BoardSources => {
    const { contracts, captain } = contractsOf(ctx.state);
    return {
      defs,
      econ: economy.defs,
      passages,
      seed,
      state: contracts,
      standing: captain.standing,
      gameSeconds: now(),
    };
  };
  const failed = (events: ReturnType<typeof expireContracts>): void => {
    for (const e of events) ctx.events.emit('ContractFailed', e);
  };

  const offTick = ctx.events.on('WorldTick', ({ gameSeconds }) => {
    const { contracts, captain } = contractsOf(ctx.state);
    failed(expireContracts(defs, contracts, captain.standing, gameSeconds));
  });
  const knock = (shipId: string | undefined): void => {
    if (shipId !== undefined && shipId !== 'ship.player') return;
    const { contracts, captain } = contractsOf(ctx.state);
    knockFragile(contracts, captain.cargo);
  };
  const offStruck = ctx.events.on('ShipStruck', ({ shipId }) => knock(shipId));
  const offKnocked = ctx.events.on('ShipKnockedDown', ({ shipId }) => knock(shipId));
  const offGrounded = ctx.events.on('ShipGrounded', ({ shipId, hard }) => {
    if (hard) knock(shipId);
  });

  return {
    defs,
    get state() {
      return contractsOf(ctx.state).contracts;
    },
    board: (port) => boardOffers(sources(), port),
    accept(port, offerId) {
      const { captain } = contractsOf(ctx.state);
      const r = acceptContract(sources(), captain, economy.capacity, port, offerId);
      if (r.ok) {
        economy.syncLoad();
        ctx.events.emit('ContractAccepted', r.event);
      }
      return r;
    },
    arrive(port) {
      const { contracts, captain } = contractsOf(ctx.state);
      const a = arriveAt(defs, contracts, captain, port, now());
      failed(a.failed);
      for (const e of a.events) ctx.events.emit('ContractCompleted', e);
      if (a.delivered.length || a.returned.length) economy.syncLoad();
      return a;
    },
    abandon(contractId, port) {
      const { contracts, captain } = contractsOf(ctx.state);
      const r = abandonContract(defs, contracts, captain, contractId, port, now());
      if (!r.ok) return r.reason;
      economy.syncLoad();
      ctx.events.emit('ContractFailed', r.event);
      return undefined;
    },
    steal(contractId, port) {
      const { contracts, captain } = contractsOf(ctx.state);
      const r = stealContract(
        defs,
        economy.defs,
        ctx.state.markets,
        contracts,
        captain,
        contractId,
        port,
        now(),
      );
      if (!r.ok) return r.reason;
      economy.syncLoad();
      ctx.events.emit('TradeCompleted', r.trade);
      ctx.events.emit('ContractStolen', r.event);
      return undefined;
    },
    dispose() {
      offTick();
      offStruck();
      offKnocked();
      offGrounded();
    },
  };
}
