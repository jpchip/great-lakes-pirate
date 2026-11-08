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
import type { FenceDealtEvent } from '../sim/economy/fence';
import type { GunBoughtEvent } from '../sim/shipyard/guns';
import type { LawEventOf } from '../sim/law/law';
import type { ShipPurchasedEvent, ShipRepairedEvent, UpgradeEvent } from '../sim/shipyard/shipyard';
import type { GameWorld } from '../gameplay/ecs';
import type { LocalWeather } from '../sim/weather/local-weather';
import type { ZoneTerrain } from '../sim/terrain/zone-terrain';
import type { Sea } from '../sim/weather/waves';
import type { Rumor, WorldState } from '../sim/world-state';
import type { Witness } from '../sim/law/witness';
import type { Chart } from '../core/coords';
import type { DamagePool } from '../../data/schemas/combat';
import type { HitLocation } from '../sim/combat/hull';

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
  /** A lot sold to a port fence in his back room (Phase 6 piece E). */
  FenceDealt: FenceDealtEvent;
  /** A gun mounted by the shady shipwright (Phase 6 piece E). */
  GunBought: GunBoughtEvent;
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
   * Port law (plan 06 §3.3, §5.2; Phase 5 piece E): a fine or a bribe paid to a harbor
   * master, and his men's search of the hold on docking at tier 2+ (what they took).
   */
  HarborMasterPaid: {
    port: string;
    region: string;
    kind: 'fine' | 'bribe';
    cents: number;
    heatFrom: number;
    heatTo: number;
  };
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
  /**
   * `at` is where the round fell, zone meters: the column of water across the bow or close
   * aboard, or the player's ship on a hit (piece H places the splash or the torn rigging
   * there). The tug's rifles leave it out.
   */
  CutterFired: {
    by: string;
    kind: 'warning' | 'rigging';
    hit: boolean;
    at?: { x: number; z: number };
  };
  /**
   * A search of the hold. In port (piece E) the harbor master's men search on docking;
   * at sea (piece C) the cutter or the tug searches while alongside. `found` at sea names
   * the kind of goods; in port it doesn't.
   */
  HoldSearched:
    | {
        port: string;
        region: string;
        tier: number;
        found: { good: string; qty: number }[];
      }
    | {
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
  /**
   * Jail and the run's end (plan 06 §10, plan 12 §10; piece D): taken to the lockup (or
   * the gallows), bail sent for, let out, and the run over.
   */
  Jailed: { region: string; port: string; tier: number; sentenceWeeks: number; execution: boolean };
  BailSent: { hideout: string; cents: number };
  Released: { how: 'served' | 'bail'; region: string; weeks: number };
  RunEnded: { cause: 'executed' | 'abandoned' | 'killed' };
  /**
   * The papers (plan 12 §6; Phase 5 piece F): a paper's day's edition went to press (its
   * lead headline, and whether any of it is about you), you bought one at a port, and the
   * paper boy on the pier crying the latest edition you haven't read as the port screen
   * opens (piece H's shout).
   */
  NewspaperPrinted: {
    paper: string;
    name: string;
    day: number;
    headline: string;
    aboutYou: boolean;
  };
  NewspaperBought: { port: string; paper: string; cents: number };
  PaperCried: { port: string; paper: string; headline: string; aboutYou: boolean };
  /**
   * Targets and their will (plan 07 §5, §8.2; Phase 6 piece C). `TargetStateChanged` is
   * every turn of a target's captain (`sim/targets/morale` phases) with the meter and why;
   * `MoraleBroken` is her striking her colors (heaved to under a white flag: piece D's
   * boarding confirms the surrender); `ShipFled` is a runner that got clear. `TowCut` is
   * a hawser parted by a shot; `ShipsCollided` two hulls meeting (a shove, no damage).
   * `shipId` is the entity id (a consort's ends `.consort_N`).
   */
  TargetStateChanged: { shipId: string; from: string; to: string; morale: number; why: string };
  MoraleBroken: { shipId: string; classId: string; morale: number; why: string };
  ShipFled: { shipId: string; classId: string };
  TowCut: { leaderId: string; consortId: string };
  ShipsCollided: { a: string; b: string; speedKn: number };
  /**
   * Combat (plan 07 §10; Phase 6 piece A). A gun or a broadside fired (`rounds` balls, from
   * `at`, zone meters, laid on `bearing`, radians from north); each ball falling in the sea
   * or striking a ship; the damage a hit did to one of her pools; the hands killed and
   * wounded aboard her (every death is the law's, piece F); a steamer's boiler bursting;
   * and an NPC ship going under after she foundered (`ShipFoundering` comes first).
   * `by` is who fired: `ship.player` or the ship's entity id.
   */
  WeaponFired: {
    by: string;
    weapon: string;
    ammo: string;
    mount: string;
    rounds: number;
    warning: boolean;
    at: { x: number; z: number };
    bearing: number;
  };
  ShotLanded: {
    by: string;
    ammo: string;
    on: 'water' | 'ship';
    shipId?: string;
    at: { x: number; y: number; z: number };
  };
  ShipHit: {
    shipId: string;
    by: string;
    weapon: string;
    ammo: string;
    location: HitLocation;
    pool: DamagePool;
    damage: number;
    at: { x: number; y: number; z: number };
  };
  CrewCasualties: {
    shipId: string;
    by: string;
    killed: number;
    wounded: number;
    /** Phase 6 piece D adds a boarding fight, the boat set adrift, and sunk with her. */
    cause: 'shot' | 'boiler' | 'boarding' | 'adrift' | 'sunk';
    /** True when anyone died: the lethal flag for the law and the log (plan 07 §4.3). */
    lethal: boolean;
  };
  BoilerExploded: { shipId: string; by: string; killed: number; at: { x: number; z: number } };
  ShipSunk: {
    shipId: string;
    classId: string;
    by: string;
    /** Hands still aboard when she went (the rest had been killed). */
    crewAboard: number;
    at: { x: number; z: number };
  };
  /**
   * Boarding, looting and the aftermath (plan 07 §6, §7; Phase 6 piece D). `ShipSurrendered`
   * is a surrender confirmed aboard (she had struck, was intimidated, or was fought for);
   * `BoardingAttempted` an option tried with its odds; a fight won or lost; what was taken
   * (`goods` hot with `owner`'s marks); and what was done with her and her crew, with
   * when they can tell the law (`reportInS`, game seconds; undefined: nobody will).
   */
  ShipSurrendered: { shipId: string; classId: string; how: 'struck' | 'intimidated' | 'fought' };
  BoardingAttempted: {
    shipId: string;
    option: 'intimidate' | 'fight';
    chance: number;
    deathChance: number;
  };
  BoardingSucceeded: { shipId: string; option: 'confirm' | 'intimidate' | 'fight' };
  BoardingRepelled: { shipId: string; hullDamage: number; killed: boolean };
  ShipLooted: {
    shipId: string;
    owner: string | undefined;
    region: string;
    goods: { good: string; qty: number }[];
    cashCents: number;
    valueCents: number;
    minutes: number;
    quick: boolean;
  };
  CrewSetAdrift: { shipId: string; crew: number; killed: number; deathChance: number };
  ShipScuttled: { shipId: string; withCrew: boolean };
  AftermathChosen: {
    shipId: string;
    owner: string | undefined;
    choice: 'letGo' | 'disable' | 'adrift' | 'sinkWithCrew';
    killed: number;
    survivors: number;
    reportInS: number | undefined;
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
