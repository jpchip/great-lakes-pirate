import { buyStores } from '../sim/economy/chandlery';
import { portInfo } from '../sim/economy/defs';
import { recordPrices } from '../sim/economy/knowledge';
import type { TradeSide } from '../sim/economy/market';
import type { TradeRefusal } from '../sim/economy/trade';
import { pierPort } from '../sim/harbors';
import { stashedCash } from '../sim/hideouts/stash';
import type { LieUntil } from '../sim/hideouts/lie-at-anchor';
import type { StoreRefusal } from '../sim/economy/chandlery';
import type { OfferRefusal, OfferResult } from '../sim/economy/contraband';
import { formatCents } from '../sim/economy/knowledge';
import type { GameContext } from '../modes/context';
import {
  ledgerSnapshot,
  portSnapshot,
  type LedgerSnapshot,
  type PortSnapshot,
} from '../ui/port/model';
import type { PortActions } from '../ui/port/PortScreen';
import type { GameEconomy } from './economy';
import { contractsOf, type GameContracts } from './contracts';
import { cargoName, companyName, type AcceptRefusal } from '../sim/economy/contracts';
import type { ShipHazards } from './hazards';
import type { RumorControl } from './rumors';
import type { GameShipyard } from './shipyard';

/**
 * Ports at the pier (plan 05 §7, Phase 4 piece B). Docking at a berth on one of a port's
 * piers opens its port screen; every visit to its market writes all its prices into the
 * captain's ledger (plan 05 §4.3), and so does every trade, so the ledger always holds
 * what you last saw. The screen and the journal pause the game while open; the caller
 * (main) owns the overlay stack and the input context, through `onOpen`.
 */

export interface PortControl {
  /** The port the ship lies at, docked; undefined under way. */
  readonly dockedPort: string | undefined;
  /** The port whose screen is open. */
  readonly openPort: string | undefined;
  readonly journalOpen: boolean;
  /** Opens the screen of the port the ship is docked at; false if there's none. */
  openDocked(): boolean;
  /** Opens a port's screen directly (the dev hook). */
  open(port: string): void;
  close(): void;
  openJournal(): void;
  closeJournal(): void;
  actions: PortActions;
  dispose(): void;
}

export interface PortControlOptions {
  ctx: GameContext;
  economy: GameEconomy;
  /** The freight agent (piece F); without it the screen has no freight tab. */
  contracts?: GameContracts | undefined;
  hazards: ShipHazards;
  /** The saloons' talk (piece K); without it no port shows a saloon. */
  rumors?: RumorControl | undefined;
  /** The shipyard, chandlery fittings and repairs (piece G); without it those don't show. */
  shipyard?: GameShipyard | undefined;
  /** The pier a berth belongs to, from the zone's berths. */
  berthPier(berthId: string): string | undefined;
  /** Show or hide the screens. */
  showPort(snapshot: PortSnapshot | undefined): void;
  showJournal(snapshot: LedgerSnapshot | undefined): void;
  /** A screen opened (true) or the last one closed (false): pause and take the keys. */
  onOpen(open: boolean): void;
  /** "Cast off" on the port screen: press F at the helm for the next tick. */
  castOff(): void;
  /**
   * Waiting alongside (the lie-at-anchor clock, `gameplay/stash`): why it's refused now,
   * running it (the refusal, or undefined), and the line the last wait came to. Without
   * it the screen offers no wait.
   */
  wait?:
    | {
        refusal(): string | undefined;
        lie(until: LieUntil): string | undefined;
        lastText(): string | undefined;
      }
    | undefined;
}

const TRADE_REFUSALS: Record<TradeRefusal, string> = {
  badQty: 'Choose how many CU.',
  notTraded: "They don't deal in that here.",
  noStock: "They haven't that much to sell.",
  noMoney: "You haven't the money.",
  noRoom: 'There is no room in the hold.',
  noCargo: "You haven't that much to sell.",
};

const OFFER_REFUSALS: Record<OfferRefusal, string> = {
  badLot: 'Nobody needs persuading to buy that.',
  notTraded: "They don't deal in that here, honest or otherwise.",
  turnedAway: "They've turned you away once this week. Nobody here will look at it now.",
  tooHot:
    "Your receiver won't touch goods that fresh and that well marked. Let them cool, or take them to the smuggler.",
};

/** What came of offering a lot, in a line for the screen. */
export function offerMessage(r: OfferResult, portName: string): string {
  if (!r.ok) return OFFER_REFUSALS[r.reason];
  const what = `${r.qty} CU of ${r.good === 'good.untaxed_whiskey' ? 'untaxed whiskey' : 'it'}`;
  if (r.outcome === 'sold') {
    if (r.receiver === 'known') {
      return `Your receiver takes it for ${formatCents(r.totalCents)}, no questions asked.`;
    }
    const sold =
      r.kind === 'hot'
        ? `No questions asked: sold for ${formatCents(r.totalCents)}.`
        : `Sold on the quiet for ${formatCents(r.totalCents)}.`;
    return `${sold} The merchant says to bring more: you have a receiver in ${portName}.`;
  }
  if (r.outcome === 'refused') {
    return r.kind === 'hot'
      ? `The merchant knows those marks and won't touch them. Word will be round ${portName} by nightfall.`
      : `The merchant won't have ${what} in the store. Word will be round ${portName} by nightfall.`;
  }
  return r.kind === 'hot'
    ? `The merchant knows those marks and sends for the constable's man: ${r.qty} CU taken off you.`
    : `The merchant sends for the revenue man: ${what} taken off you.`;
}

const ACCEPT_REFUSALS: Record<AcceptRefusal, string> = {
  unknown: 'That offer is gone from the board.',
  locked: "They don't know you well enough for that one yet.",
  noRoom: 'There is no room in the hold for it.',
  noMoney: "You haven't the deposit.",
};

const STEAL_REFUSALS = {
  unknown: 'That contract is not yours.',
  notTraded: 'No one here buys that.',
  noCargo: 'None of that cargo is aboard.',
} as const;

const STORE_REFUSALS: Record<StoreRefusal, string> = {
  badQty: 'Choose how many.',
  unknown: "The chandler doesn't stock that.",
  full: 'The lockers are full.',
  noMoney: "You haven't the money.",
};

export function attachPorts(opts: PortControlOptions): PortControl {
  const { ctx, economy, hazards } = opts;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  let dockedPort: string | undefined;
  let openPort: string | undefined;
  let journalOpen = false;
  /** What happened on arriving at the open port, shown until the screen closes. */
  let notices: string[] = [];
  const contractSources = () => {
    if (!opts.contracts) return undefined;
    const { contracts, captain } = contractsOf(ctx.state);
    return { defs: opts.contracts.defs, state: contracts, standing: captain.standing };
  };

  const snapshot = (port: string): PortSnapshot => {
    const player = ctx.state.player;
    const snap = portSnapshot({
      defs: economy.defs,
      markets: ctx.state.markets,
      knowledge: ctx.state.knowledge.prices,
      trader: player,
      capacity: economy.capacity,
      load01: hazards.state.cargo01,
      cargoSpeedLoss: hazards.cls.rules.cargoSpeedLoss,
      port,
      gameSeconds: now(),
      rumors: ctx.state.knowledge.rumors,
      saloon:
        opts.rumors && portInfo(port)?.services.includes('tavern')
          ? opts.rumors.terms(port)
          : undefined,
      refusals: ctx.state.contraband?.refusals,
      receivers: ctx.state.contraband?.receivers,
      contracts: (() => {
        const c = contractSources();
        return c && { ...c, board: opts.contracts?.board(port) ?? [] };
      })(),
      notices,
      ship: opts.shipyard && {
        state: (opts.shipyard.sync(), opts.shipyard.ship),
        name: player.captain.shipName,
      },
    });
    snap.stashedCents = stashedCash(ctx.state.hideouts);
    if (opts.wait) {
      snap.canWait = true;
      snap.waitRefusal = opts.wait.refusal();
    }
    return snap;
  };
  /** Writes down this port's prices as they stand now (plan 05 §4.3). */
  const note = (port: string): void => {
    recordPrices(ctx.state.knowledge.prices, economy.defs, ctx.state.markets, port, now());
  };
  const refresh = (): void => {
    if (openPort) opts.showPort(snapshot(openPort));
  };

  const open = (port: string): void => {
    if (!portInfo(port)) return;
    // The journal gives way to the port screen: closed properly, since it may have let the
    // ship sail on (docking can finish behind it), where the port screen holds the world.
    if (journalOpen && !openPort) {
      journalOpen = false;
      opts.showJournal(undefined);
      opts.onOpen(false);
    }
    const wasOpen = !!openPort;
    if (openPort !== port) notices = [];
    openPort = port;
    if (economy.defs.markets.has(port)) note(port);
    if (opts.contracts) notices = [...notices, ...arrivalNotices(port)];
    ctx.events.emit('PortVisited', { port });
    refresh();
    if (!wasOpen) opts.onOpen(true);
  };
  const close = (): void => {
    if (!openPort) return;
    openPort = undefined;
    notices = [];
    opts.showPort(undefined);
    opts.onOpen(false);
  };

  const offDocked = ctx.events.on('ShipDocked', ({ shipId, berthId }) => {
    if (shipId !== 'ship.player') return;
    const pier = opts.berthPier(berthId);
    dockedPort = pier ? pierPort(pier) : undefined;
    if (dockedPort) open(dockedPort);
  });
  const offCastOff = ctx.events.on('ShipCastOff', ({ shipId }) => {
    if (shipId === 'ship.player') dockedPort = undefined;
  });
  // A zone change takes the ship off the pier without a cast-off.
  const offZone = ctx.events.on('ZoneExited', () => (dockedPort = undefined));

  /** Deliveries and handed-back cargo on arriving, in a line each. */
  const arrivalNotices = (port: string): string[] => {
    const c = opts.contracts;
    if (!c) return [];
    const a = c.arrive(port);
    const name = (good: string): string => cargoName(economy.defs, c.defs, good).toLowerCase();
    return [
      ...a.delivered.map(
        (d) =>
          `Delivered ${d.contract.qty} CU of ${name(d.contract.good)} for ${companyName(c.defs, d.contract.company)}: paid ${formatCents(d.payCents)}${d.depositCents ? ` and the ${formatCents(d.depositCents)} deposit back` : ''}${d.late ? ' (late: half pay)' : ''}.`,
      ),
      ...a.returned.map(
        (r) =>
          `Handed back ${name(r.good)} for ${companyName(c.defs, r.company)}: the contract failed.`,
      ),
    ];
  };

  const trade = (side: TradeSide, good: string, qty: number): string | undefined => {
    const port = openPort;
    if (!port) return 'The market is closed.';
    const r = side === 'buy' ? economy.buy(port, good, qty) : economy.sell(port, good, qty);
    if (!r.ok) return TRADE_REFUSALS[r.reason];
    note(port);
    refresh();
    return undefined;
  };

  /** Shipyard and chandlery work at the open port; the screen refreshes after it. */
  const yardWork = (
    work: (y: GameShipyard, port: string) => string | undefined,
  ): string | undefined => {
    const port = openPort;
    if (!port || !opts.shipyard) return 'The yard is closed.';
    const refused = work(opts.shipyard, port);
    if (!refused && economy.defs.markets.has(port)) note(port);
    refresh();
    return refused;
  };

  return {
    get dockedPort() {
      return dockedPort;
    },
    get openPort() {
      return openPort;
    },
    get journalOpen() {
      return journalOpen;
    },
    openDocked() {
      if (!dockedPort || hazards.state.mooring !== 'docked') return false;
      open(dockedPort);
      return true;
    },
    open,
    close,
    openJournal() {
      if (journalOpen || openPort) return;
      journalOpen = true;
      opts.showJournal(
        ledgerSnapshot(
          economy.defs,
          ctx.state.knowledge.prices,
          now(),
          contractSources(),
          ctx.state.contraband?.receivers,
          ctx.state.knowledge.rumors,
          { cargo: ctx.state.player.cargo, capacity: economy.capacity },
        ),
      );
      opts.onOpen(true);
    },
    closeJournal() {
      if (!journalOpen) return;
      journalOpen = false;
      opts.showJournal(undefined);
      opts.onOpen(false);
    },
    actions: {
      buy: (good, qty) => trade('buy', good, qty),
      sell: (good, qty) => trade('sell', good, qty),
      quote: (good, qty, side) =>
        openPort ? economy.quote(openPort, good, qty, side).totalCents : 0,
      offer(index) {
        const port = openPort;
        if (!port) return 'The market is closed.';
        const r = economy.offer(port, index);
        if (r.ok && r.outcome === 'sold') note(port);
        refresh();
        return offerMessage(r, portInfo(port)?.name ?? port);
      },
      buyStores(item, qty) {
        const port = openPort;
        if (!port) return 'The chandlery is closed.';
        const r = buyStores(economy.defs, ctx.state.player, port, item, qty);
        if (!r.ok) return STORE_REFUSALS[r.reason];
        ctx.events.emit('StoresBought', {
          port,
          item: r.item,
          qty: r.qty,
          totalCents: r.totalCents,
        });
        refresh();
        return undefined;
      },
      buyRound() {
        const port = openPort;
        if (!port || !opts.rumors) return 'The saloon is closed.';
        const r = opts.rumors.buyRound(port);
        refresh();
        return r.ok ? undefined : r.reason;
      },
      acceptContract(offerId) {
        const port = openPort;
        if (!port || !opts.contracts) return 'The freight agent is closed.';
        const r = opts.contracts.accept(port, offerId);
        if (!r.ok) return ACCEPT_REFUSALS[r.reason];
        refresh();
        // The offer moves to In hand on the screen; that says it went through.
        return undefined;
      },
      abandonContract(contractId) {
        const port = openPort;
        if (!port || !opts.contracts) return 'The freight agent is closed.';
        const why = opts.contracts.abandon(contractId, port);
        if (why) return why === 'noAgent' ? 'There is no freight agent here.' : 'No such contract.';
        refresh();
        return 'Handed back. The deposit is theirs.';
      },
      stealContract(contractId) {
        const port = openPort;
        if (!port || !opts.contracts) return 'The market is closed.';
        const why = opts.contracts.steal(contractId, port);
        if (why) return STEAL_REFUSALS[why];
        note(port);
        refresh();
        return undefined;
      },
      buyHull(classId) {
        return yardWork((y, port) => y.buyHull(port, classId));
      },
      fit(upgrade, place) {
        return yardWork((y, port) => y.install(port, upgrade, place));
      },
      unfit(upgrade, place) {
        return yardWork((y, port) => y.remove(port, upgrade, place));
      },
      repair(place) {
        return yardWork((y, port) => y.repair(port, place));
      },
      close,
      castOff() {
        close();
        opts.castOff();
      },
      wait(until) {
        const port = openPort;
        if (!port || !opts.wait) return "You can't wait here.";
        const refused = opts.wait.lie(until);
        if (refused) return refused;
        // The clock ran on behind the screen: the market has moved and the board changed.
        // Arrival notices belong to the arrival, so they go.
        notices = [];
        if (economy.defs.markets.has(port)) note(port);
        refresh();
        return opts.wait.lastText();
      },
    },
    dispose() {
      offDocked();
      offCastOff();
      offZone();
    },
  };
}
