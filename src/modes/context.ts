import type { EventBus } from '../core/events';
import type { InputMapper } from '../core/input';
import type { Rng } from '../core/rng';
import type { GameWorld } from '../gameplay/ecs';
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
}
