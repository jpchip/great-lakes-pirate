import { buyStores } from '../sim/economy/chandlery';
import { portInfo } from '../sim/economy/defs';
import { recordPrices } from '../sim/economy/knowledge';
import type { TradeSide } from '../sim/economy/market';
import type { TradeRefusal } from '../sim/economy/trade';
import { pierPort } from '../sim/harbors';
import { stashedCash } from '../sim/hideouts/stash';
import type { StoreRefusal } from '../sim/economy/chandlery';
import type { GameContext } from '../modes/context';
import {
  ledgerSnapshot,
  portSnapshot,
  type LedgerSnapshot,
  type PortSnapshot,
} from '../ui/port/model';
import type { PortActions } from '../ui/port/PortScreen';
import type { GameEconomy } from './economy';
import type { ShipHazards } from './hazards';

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
  hazards: ShipHazards;
  /** The pier a berth belongs to, from the zone's berths. */
  berthPier(berthId: string): string | undefined;
  /** Show or hide the screens. */
  showPort(snapshot: PortSnapshot | undefined): void;
  showJournal(snapshot: LedgerSnapshot | undefined): void;
  /** A screen opened (true) or the last one closed (false): pause and take the keys. */
  onOpen(open: boolean): void;
  /** "Cast off" on the port screen: press F at the helm for the next tick. */
  castOff(): void;
}

const TRADE_REFUSALS: Record<TradeRefusal, string> = {
  badQty: 'Choose how many CU.',
  notTraded: "They don't deal in that here.",
  noStock: "They haven't that much to sell.",
  noMoney: "You haven't the money.",
  noRoom: 'There is no room in the hold.',
  noCargo: "You haven't that much to sell.",
};

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
    });
    snap.stashedCents = stashedCash(ctx.state.hideouts);
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
    const wasOpen = !!openPort || journalOpen;
    if (journalOpen) {
      journalOpen = false;
      opts.showJournal(undefined);
    }
    openPort = port;
    if (economy.defs.markets.has(port)) note(port);
    ctx.events.emit('PortVisited', { port });
    refresh();
    if (!wasOpen) opts.onOpen(true);
  };
  const close = (): void => {
    if (!openPort) return;
    openPort = undefined;
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

  const trade = (side: TradeSide, good: string, qty: number): string | undefined => {
    const port = openPort;
    if (!port) return 'The market is closed.';
    const r = side === 'buy' ? economy.buy(port, good, qty) : economy.sell(port, good, qty);
    if (!r.ok) return TRADE_REFUSALS[r.reason];
    note(port);
    refresh();
    return undefined;
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
      opts.showJournal(ledgerSnapshot(economy.defs, ctx.state.knowledge.prices, now()));
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
      close,
      castOff() {
        close();
        opts.castOff();
      },
    },
    dispose() {
      offDocked();
      offCastOff();
      offZone();
    },
  };
}
