import type { Chart } from '../core/coords';
import type { EventBus } from '../core/events';
import type { InputMapper } from '../core/input';
import type { Rng } from '../core/rng';
import type { ContactKind } from '../sim/chart/traffic';
import type { PriceShockEvent } from '../sim/economy/market';
import type { CargoDelivered } from '../sim/traffic/cargo';
import type { HailNews } from '../sim/traffic/news';
import type { TradeCompletedEvent } from '../sim/economy/trade';
import type { HotGoodsDetectedEvent } from '../sim/economy/contraband';
import type {
  ContractAcceptedEvent,
  ContractCompletedEvent,
  ContractFailedEvent,
  ContractStolenEvent,
} from '../sim/economy/contracts';
import type { LieUntil } from '../sim/hideouts/lie-at-anchor';
import type { SmugglerDealtEvent } from '../sim/economy/smuggler';
import type { LawEventOf } from '../sim/law/law';
import type { ShipPurchasedEvent, ShipRepairedEvent, UpgradeEvent } from '../sim/shipyard/shipyard';
import type { GameWorld } from '../gameplay/ecs';
import type { LocalWeather } from '../sim/weather/local-weather';
import type { ZoneTerrain } from '../sim/terrain/zone-terrain';
import type { Sea } from '../sim/weather/waves';
import type { Rumor, WorldState } from '../sim/world-state';
import type { Witness } from '../sim/law/witness';

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
   * Rumors (plan 05 §9, Phase 4 piece K): a round bought in a saloon brought talk, or a
   * hailed ship's tip went in the ledger. `costCents` is what the round cost (0 on the
   * house or at sea).
   */
  RumorHeard: { rumor: Rumor; costCents: number };
  /**
   * Contraband (plan 05 §6, Phase 4 piece H): a merchant found out a hot or contraband lot
   * and refused or confiscated it (Phase 5 turns it into Wanted); a contraband lot sold on
   * the quiet; a deal with the island smuggler; where she lies became known.
   */
  HotGoodsDetected: HotGoodsDetectedEvent;
  ContrabandSold: { port: string; good: string; qty: number; totalCents: number };
  SmugglerDealt: SmugglerDealtEvent;
  SmugglerLearned: { anchorage: string; source: string };
  /**
   * Freight contracts (plan 05 §5.2, §11; Phase 4 piece F): taken at a freight agent,
   * delivered at the destination, failed (expired or handed back), or stolen by selling
   * the cargo, which Phase 5 turns into Wanted.
   */
  ContractAccepted: ContractAcceptedEvent;
  ContractCompleted: ContractCompletedEvent;
  ContractFailed: ContractFailedEvent;
  ContractStolen: ContractStolenEvent;
  /**
   * Hideouts (plan 09 §12, Phase 4 piece E): goods or cash moved between the ship and a
   * hideout's storage. `in` is from the ship into the stash; a cargo move sets `good` and
   * `qty`, a cash move `cents`.
   */
  StorageChanged: {
    hideout: string;
    direction: 'in' | 'out';
    good?: string;
    qty?: number;
    cents?: number;
  };
  /** The captain let the clock run on at anchor or alongside (piece E). */
  LayAtAnchor: { until: LieUntil; seconds: number };
  /**
   * The shipyard (plan 10 §11, Phase 4 piece G): a new hull bought with the old one traded
   * in, an upgrade fitted or taken out, and repairs at a yard, a chandlery or with a kit.
   */
  ShipPurchased: ShipPurchasedEvent;
  UpgradeInstalled: UpgradeEvent;
  UpgradeRemoved: UpgradeEvent;
  ShipRepaired: ShipRepairedEvent;
  /**
   * The law (plan 06 §2.1, §10; Phase 5 piece A): a crime committed (witnessed or not), a
   * witness setting off with a report, the report landing (heat or alertness) or stopped
   * on the way, a region's tier changing, the news of a crime spreading heat to the
   * neighbors, Fame moving, and a new hull shedding the old ship's record.
   */
  CrimeCommitted: Omit<LawEventOf<'CrimeCommitted'>, 'type'>;
  Witnessed: Omit<LawEventOf<'Witnessed'>, 'type'>;
  ReportFiled: Omit<LawEventOf<'ReportFiled'>, 'type'>;
  ReportIntercepted: Omit<LawEventOf<'ReportIntercepted'>, 'type'>;
  WantedTierChanged: Omit<LawEventOf<'WantedTierChanged'>, 'type'>;
  HeatSpread: Omit<LawEventOf<'HeatSpread'>, 'type'>;
  FameChanged: Omit<LawEventOf<'FameChanged'>, 'type'>;
  ProfileChanged: Omit<LawEventOf<'ProfileChanged'>, 'type'>;
  /**
   * Detection at sea (plan 06 §7.1, Phase 5 piece B): a watcher spotted the player's ship,
   * matched her profile, or lost her again; the lantern lit, doused, or burned out of oil.
   */
  PlayerSpotted: { witness: Witness };
  PlayerIdentified: { witness: Witness };
  PlayerLostSight: { witnessId: string };
  LanternChanged: { lit: boolean; reason: 'toggled' | 'outOfOil' };
  /**
   * The law at sea (plan 06 §5.1, §8.1; Phase 5 piece C). `PursuitChanged` is the chart
   * lock: a law ship is after the player and her lookout has her (true), or no longer
   * (false, whether she lost you, gave up, let you go or took you). The cutter hails, fires
   * a warning shot or a round at the rigging, searches the hold, and takes the player:
   * `PlayerCaptured` comes before the arena ends with 'caught', and piece D's jail takes
   * it from there. `at` is the world chart frame (the save's).
   */
  PursuitChanged: { pursued: boolean; by: string };
  CutterHailed: { by: string; intent: 'inspect' | 'pursue'; arrest: boolean };
  CutterFired: { by: string; kind: 'warning' | 'rigging'; hit: boolean };
  HoldSearched: {
    by: string;
    region: string;
    found: { good: string; qty: number; kind: 'hot' | 'contraband' }[];
  };
  PlayerCaptured: {
    by: 'law.morrill' | 'law.chartered_tug';
    region: string;
    how: 'surrender' | 'boarded';
    at: Chart;
  };
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
