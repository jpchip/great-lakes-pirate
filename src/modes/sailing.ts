import { DEFAULT_COMPRESSION } from '../core/coords';
import type { EventBus } from '../core/events';
import type { InputMapper } from '../core/input';
import { dayAndHour, advanceClock, R_SAILING } from '../core/time';
import { buoyancySystem } from '../gameplay/buoyancy';
import { bobSystem, snapshotTransforms, velocitySystem, type Entity } from '../gameplay/ecs';
import { hazardSystem, onShipJibed } from '../gameplay/hazards';
import { heelSystem, sailingSystem, zoneEdgeSystem, type WindSampler } from '../gameplay/sailing';
import { IDLE_COMMAND, type SailingCommand } from '../sim/sailing/controller';
import {
  IDLE_MOORING,
  type HazardEvent,
  type MooringBerth,
  type MooringCommand,
} from '../sim/sailing/hazards';
import type { Dock } from '../sim/terrain/test-bay';
import type { TerrainBounds } from '../sim/terrain/zone-terrain';
import { seaScaleAt } from '../sim/weather/waves';
import type { GameContext, GameEvents } from './context';
import type { Mode } from './machine';

const ORIGIN = { x: 0, z: 0 };

export interface SailingView {
  /** `seaTime` is the wave clock at this frame, between the last two ticks. */
  render(alpha: number, seaTime: number, frameSeconds: number): void;
}

export interface SailingModeOptions {
  view?: SailingView | undefined;
  /** The wind at a zone point: `ctx.weather.windAt` at the current game time. */
  wind: WindSampler;
  /** Piers and their berths in the zone (plan 02 §7); none means open water. Swappable. */
  docks?: readonly Dock[];
  berths?: readonly MooringBerth[];
  /** A playtest speed-up for the clock and the weather only (`?timewarp=`); 1 by default. */
  timeWarp?: { factor: number };
  /**
   * An open-water arena in play (Phase 3 piece G): steers its ships and applies its rules
   * after the player's ship has moved, and holds the player inside while pursued.
   * Swappable: set while an arena runs, undefined in a zone.
   */
  arena?: SailingArena | undefined;
}

export interface SailingArena {
  step(dt: number): void;
  holdBounds(): TerrainBounds | undefined;
}

/** The player's helm orders from the plan 02 §2 bindings. */
export function playerCommand(input: InputMapper, out: SailingCommand): SailingCommand {
  out.steer = (input.isDown('SteerStarboard') ? 1 : 0) - (input.isDown('SteerPort') ? 1 : 0);
  out.raiseSail = input.pressed('RaiseSail');
  out.lowerSail = input.pressed('LowerSail');
  out.trimIn = input.isDown('TrimIn');
  out.trimOut = input.isDown('TrimOut');
  out.toggleSweeps = input.pressed('Sweeps');
  return out;
}

/** The player's anchor and dock orders: X held, F pressed (plan 02 §2). */
export function playerMooring(input: InputMapper, out: MooringCommand): MooringCommand {
  out.anchor = input.isDown('Anchor');
  out.interact = input.pressed('Interact');
  return out;
}

/** Puts a hazard on the event bus for the HUD, audio and later the newspaper. */
export function emitHazard(
  events: EventBus<GameEvents>,
  shipId: string | undefined,
  ev: HazardEvent,
): void {
  switch (ev.kind) {
    case 'grounded':
      return events.emit('ShipGrounded', {
        shipId,
        speedKn: ev.speedKn,
        damage: ev.damage,
        hard: ev.hard,
      });
    case 'refloated':
      return events.emit('ShipRefloated', { shipId });
    case 'struck':
      return events.emit('ShipStruck', {
        shipId,
        what: ev.what,
        speedKn: ev.speedKn,
        damage: ev.damage,
      });
    case 'knockdown':
      return events.emit('ShipKnockedDown', {
        shipId,
        riggingDamage: ev.riggingDamage,
        hullDamage: ev.hullDamage,
      });
    case 'foundering':
      return events.emit('ShipFoundering', { shipId });
    case 'anchorDropped':
      return events.emit('AnchorDropped', { shipId });
    case 'anchorWeighed':
      return events.emit('AnchorWeighed', { shipId });
    case 'anchorDragging':
      return events.emit('AnchorDragging', { shipId, dragging: ev.dragging });
    case 'anchorRefused':
      return events.emit('AnchorRefused', { shipId, reason: ev.reason });
    case 'docked':
      return events.emit('ShipDocked', { shipId, berthId: ev.berthId });
    case 'castOff':
      return events.emit('ShipCastOff', { shipId, berthId: ev.berthId });
    case 'dockRefused':
      return events.emit('DockRefused', { shipId, reason: ev.reason });
  }
}

/**
 * Sailing mode: runs the clock at R = 24, the world tick and the entity systems, with
 * the player's schooner on the plan 02 sailing model.
 */
export function createSailingMode(ctx: GameContext, options: SailingModeOptions): Mode {
  let elapsed = 0;
  let lastDt = 0;
  const scale = { rate: R_SAILING, compression: DEFAULT_COMPRESSION };
  const helm: SailingCommand = { ...IDLE_COMMAND };
  const commandFor = (e: Entity): SailingCommand =>
    e.playerControlled ? playerCommand(ctx.input, helm) : IDLE_COMMAND;
  const mooring: MooringCommand = { ...IDLE_MOORING };
  const mooringFor = (e: Entity): MooringCommand =>
    e.playerControlled ? playerMooring(ctx.input, mooring) : IDLE_MOORING;
  const hazardEnv = {
    get terrain() {
      return ctx.terrain;
    },
    // Read each tick: a zone change swaps them (Phase 3 piece A).
    get docks() {
      return options.docks ?? [];
    },
    get berths() {
      return options.berths ?? [];
    },
  };

  return {
    id: 'sailing',
    enter() {
      ctx.input.context = 'sailing';
    },
    update(dt) {
      snapshotTransforms(ctx.world);
      elapsed += dt;
      lastDt = dt;
      ctx.sea.time += dt;

      const clock = ctx.state.environment.clock;
      const dayBefore = dayAndHour(clock.gameSeconds).day;
      const warp = options.timeWarp?.factor ?? 1;
      const worldTicks = advanceClock(clock, dt, R_SAILING * warp);
      for (let i = 0; i < worldTicks; i++) {
        ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
      }
      const dayAfter = dayAndHour(clock.gameSeconds).day;
      if (dayAfter !== dayBefore) ctx.events.emit('DayChanged', { day: dayAfter });

      // The sea follows the wind; anchor it on the player so the surface never jumps there.
      const player = ctx.world.with('playerControlled', 'transform').first;
      ctx.weather.tick(clock.gameSeconds, player?.transform.position ?? ORIGIN, ctx.sea);

      sailingSystem(
        ctx.world,
        commandFor,
        options.wind,
        ctx.sea,
        scale,
        dt,
        (e, ev) => {
          if (ev.kind === 'tack') ctx.events.emit('ShipTacked', { shipId: e.id });
          else {
            onShipJibed(e, ev.uncontrolled);
            ctx.events.emit('ShipJibed', { shipId: e.id, uncontrolled: ev.uncontrolled });
          }
        },
        (x, z) => seaScaleAt(ctx.sea, x, z),
      );
      hazardSystem(ctx.world, mooringFor, hazardEnv, options.wind, scale, dt, (e, ev) =>
        emitHazard(ctx.events, e.id, ev),
      );
      options.arena?.step(dt);
      if (ctx.terrain) zoneEdgeSystem(ctx.world, ctx.terrain.bounds);
      const held = options.arena?.holdBounds();
      if (held) zoneEdgeSystem(ctx.world, held);
      velocitySystem(ctx.world, dt);
      bobSystem(ctx.world, elapsed);
      buoyancySystem(ctx.world, ctx.sea, dt);
      heelSystem(ctx.world);
    },
    render(alpha, frameSeconds) {
      options.view?.render(alpha, ctx.sea.time - (1 - alpha) * lastDt, frameSeconds);
    },
  };
}
