import type { EventBus } from '../core/events';
import type { InputMapper } from '../core/input';
import type { Rng } from '../core/rng';
import type { ContactKind } from '../sim/chart/traffic';
import type { PriceShockEvent } from '../sim/economy/market';
import type { CargoDelivered } from '../sim/traffic/cargo';
import type { HailNews } from '../sim/traffic/news';
import type { TradeCompletedEvent } from '../sim/economy/trade';
import type { ShipPurchasedEvent, ShipRepairedEvent, UpgradeEvent } from '../sim/shipyard/shipyard';
import type { GameWorld } from '../gameplay/ecs';
import type { LocalWeather } from '../sim/weather/local-weather';
import type { ZoneTerrain } from '../sim/terrain/zone-terrain';
import type { Sea } from '../sim/weather/waves';
import type { WorldState } from '../sim/world-state';

/** Events shared across layers. Each system plan adds its own (plan 01 §3.5). */
export interface GameEvents {
  /** A strategic world tick ran (every 10 game minutes). */
  WorldTick: { gameSeconds: number };
  DayChanged: { day: number };
  /** Chart travel (plan 03 §9). */
  VoyageStarted: { legs: number; lengthM: number; destinationZoneId: string | undefined };
  VoyageArrived: { zoneId: string | undefined };
  /** `kind` and `hostile` from the contact, for the encounter stingers (plan 15 §6.1). */
  EncounterSpotted: { contactId: string; forced: boolean; kind: ContactKind; hostile: boolean };
  EncounterEngaged: { contactId: string; forced: boolean };
  EncounterAvoided: { contactId: string; escaped: boolean };
  /** Open-water arenas (plan 03 §6.3, Phase 3 piece G). */
  ArenaEntered: { contactId: string; kind: string; ships: number };
  ArenaExited: { contactId: string; result: 'left' | 'resolved' | 'caught'; elapsedS: number };
  /** Zones (plan 03 §9): the player left one or arrived in one (Phase 3 piece A). */
  ZoneExited: { zoneId: string };
  ZoneEntered: { zoneId: string; from: 'saved' | 'spawn' | 'entry' | 'dev' };
  /** Sailing (plan 02 §4): the bow or the stern crossed the wind. */
  ShipTacked: { shipId: string | undefined };
  ShipJibed: { shipId: string | undefined; uncontrolled: boolean };
  /** Hazards (plan 02 §6): touching bottom, hitting rock or a pier, knockdown, sinking. */
  ShipGrounded: { shipId: string | undefined; speedKn: number; damage: number; hard: boolean };
  ShipRefloated: { shipId: string | undefined };
  ShipStruck: {
    shipId: string | undefined;
    what: 'rock' | 'pier';
    speedKn: number;
    damage: number;
  };
  ShipKnockedDown: { shipId: string | undefined; riggingDamage: number; hullDamage: number };
  ShipFoundering: { shipId: string | undefined };
  /** Mooring (plan 02 §7). */
  AnchorDropped: { shipId: string | undefined };
  AnchorWeighed: { shipId: string | undefined };
  AnchorDragging: { shipId: string | undefined; dragging: boolean };
  AnchorRefused: { shipId: string | undefined; reason: 'tooDeep' | 'moored' };
  ShipDocked: { shipId: string | undefined; berthId: string };
  ShipCastOff: { shipId: string | undefined; berthId: string };
  DockRefused: {
    shipId: string | undefined;
    reason: 'noBerth' | 'tooFast' | 'anchored' | 'aground';
  };
  /** The economy (plan 05 §11): a trade at a port's market, and a market event. */
  TradeCompleted: TradeCompletedEvent;
  PriceShock: PriceShockEvent;
  /**
   * The traffic (plan 05 §8.1, Phase 4 piece D): a ship's arrival or departure moved a
   * port's stock; the player looked a ship over; a hail brought news (prices and a rumor
   * for the ledger, pieces B and K).
   */
  CargoDelivered: CargoDelivered;
  ShipLookedOver: { shipId: string };
  ShipHailed: { shipId: string; news: HailNews };
  /** Ports (plan 05 §7, Phase 4 piece B): the port screen opened, and the chandlery. */
  PortVisited: { port: string };
  StoresBought: { port: string; item: string; qty: number; totalCents: number };
  /**
   * The shipyard (plan 10 §11, Phase 4 piece G): a new hull bought with the old one traded
   * in, an upgrade fitted or taken out, and repairs at a yard, a chandlery or with a kit.
   */
  ShipPurchased: ShipPurchasedEvent;
  UpgradeInstalled: UpgradeEvent;
  UpgradeRemoved: UpgradeEvent;
  ShipRepaired: ShipRepairedEvent;
}

/** Everything a mode needs; built once at boot and handed to each mode. */
export interface GameContext {
  state: WorldState;
  world: GameWorld;
  rng: Rng;
  input: InputMapper;
  events: EventBus<GameEvents>;
  /** The active zone's waves (plan 04 §6.2); buoyancy and the water shader share it. */
  sea: Sea;
  /** Wind, sea state, visibility and sky for the zone (plan 02 §11); it rebuilds `sea`. */
  weather: LocalWeather;
  /**
   * The active zone's terrain: depth, shoreline and wind maps (plan 03 §8.3). Absent until
   * it loads, or when the zone files can't be fetched.
   */
  terrain?: ZoneTerrain | undefined;
}
