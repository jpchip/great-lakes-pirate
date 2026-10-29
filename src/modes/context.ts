import type { EventBus } from '../core/events';
import type { InputMapper } from '../core/input';
import type { Rng } from '../core/rng';
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
  EncounterSpotted: { contactId: string; forced: boolean };
  EncounterEngaged: { contactId: string; forced: boolean };
  EncounterAvoided: { contactId: string; escaped: boolean };
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
