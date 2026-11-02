import { advanceGameTime, dayAndHour } from '../core/time';
import type { GameContext } from '../modes/context';
import type { HandlingRecord } from '../sim/sailing/handling';
import type { HazardRules } from '../sim/sailing/hazard-rules';
import { compileHazardClass } from '../sim/sailing/hazards';
import { compileSailingClass, type SailingClass } from '../sim/sailing/ship-class';
import { sailShipRecord } from '../sim/sailing/ships';
import { fitShip, type Instruments, type ShipFit } from '../sim/shipyard/fit';
import {
  buyHull,
  defaultShipState,
  installUpgrade,
  kitFor,
  PATCH_KIT,
  removeUpgrade,
  repairShip,
  useKit,
  type FitSource,
  type RepairPlace,
  type ShipState,
  type ShipyardRefusal,
} from '../sim/shipyard/shipyard';
import type { Buoyancy } from './buoyancy';
import { createBuoyancy } from './buoyancy';
import type { GameEconomy } from './economy';
import type { ShipHazards } from './hazards';
import type { SailingShip } from './sailing';

/**
 * The shipyard in the running game (plan 10, Phase 4 piece G). It keeps the player's ship
 * entity on her class and fit: a new hull or an upgrade rebuilds the sailing and hazard
 * classes from the fitted record, resizes the hold, and keeps the damage as a share of
 * each pool. `player.ship` holds the condition for the save; `sync()` writes the hazard
 * state's HP into it before a save or a shipyard sum. Yard work takes game time, which
 * passes as a time skip at the screen (plan 10 §6) with every world tick run.
 */
export interface GameShipyard {
  readonly ship: ShipState;
  readonly fit: ShipFit;
  readonly instruments: Instruments;
  /** Writes the hazard state's hull and rigging into `player.ship`. */
  sync(): void;
  /** Each returns why it was refused, in a few words, or undefined when it went through. */
  buyHull(port: string, classId: string): string | undefined;
  install(port: string, upgrade: string, source: FitSource): string | undefined;
  remove(port: string, upgrade: string, source: FitSource): string | undefined;
  repair(port: string, place: RepairPlace): string | undefined;
  /** Uses the kit the ship needs most at sea (K): a line for the HUD notice. */
  useKit(): string;
  /** Applies `player.ship` to the entity again (a reload, the dev hook). */
  refit(): void;
}

export interface ShipyardOptions {
  ctx: GameContext;
  economy: GameEconomy;
  sailing: SailingShip;
  hazards: ShipHazards;
  buoyancy: Buoyancy;
  handling: HandlingRecord;
  rules: HazardRules;
  /**
   * Adjusts each rebuilt sailing class, for what isn't the ship's own: the captain's
   * perks (piece C) ride on top of the hull and its upgrades.
   */
  adjustClass?(cls: SailingClass): SailingClass;
  /** Her class changed: the view rebuilds her model. */
  onHullChanged(classId: string): void;
  /** Her instruments changed: the camera's spyglass, the chart's forecast. */
  onInstruments?(instruments: Instruments): void;
}

const REFUSALS: Record<ShipyardRefusal, string> = {
  sameHull: 'You already sail her.',
  notForSale: "The yard doesn't build that.",
  noMoney: "You haven't the money.",
  cargoStuck: "Contract or hot cargo won't fit the new hold. Deliver or sell it first.",
  unknown: "They've never heard of it.",
  notHere: "That isn't fitted here.",
  fitted: 'She has one already.',
  noSlot: 'No free slot for it on this hull.',
  notFitted: "She hasn't one.",
  sound: 'She needs no repair.',
  noKit: 'No kit in the lockers.',
  kitCap: 'That needs a yard now: kits only patch so far.',
};

export function attachShipyard(opts: ShipyardOptions): GameShipyard {
  const { ctx, economy, sailing, hazards } = opts;
  const player = ctx.state.player;
  player.ship ??= defaultShipState();
  const ship = (): ShipState => player.ship ?? (player.ship = defaultShipState());
  let fit: ShipFit = fitShip(sailShipRecord(ship().classId), opts.rules, ship().upgrades);
  let classId = '';

  const sync = (): void => {
    const s = ship();
    s.hull01 = Math.min(1, Math.max(0, hazards.state.hull / hazards.cls.hullHP));
    s.rigging01 = Math.min(1, Math.max(0, hazards.state.rigging / hazards.cls.riggingHP));
  };

  const refit = (): void => {
    const s = ship();
    const base = sailShipRecord(s.classId);
    fit = fitShip(base, opts.rules, s.upgrades);
    const compiled = compileSailingClass(fit.record, opts.handling);
    sailing.cls = opts.adjustClass ? opts.adjustClass(compiled) : compiled;
    hazards.cls = compileHazardClass(fit.record, fit.rules);
    hazards.state.hull = s.hull01 * hazards.cls.hullHP;
    hazards.state.rigging = s.rigging01 * hazards.cls.riggingHP;
    hazards.state.foundering = hazards.state.foundering && hazards.state.hull <= 0;
    economy.setCapacity(fit.record.cargoCapacity);
    if (s.classId !== classId) {
      const changed = classId !== '';
      classId = s.classId;
      Object.assign(opts.buoyancy, createBuoyancy(base.buoyancy));
      if (changed) opts.onHullChanged(classId);
    }
    opts.onInstruments?.(fit.instruments);
  };

  /** Yard time: the clock moves on and every world tick due runs (plan 10 §6). */
  const skip = (hours: number): void => {
    if (hours <= 0) return;
    const clock = ctx.state.environment.clock;
    const dayBefore = dayAndHour(clock.gameSeconds).day;
    const ticks = advanceGameTime(clock, hours * 3600);
    for (let i = 0; i < ticks; i++)
      ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
    const dayAfter = dayAndHour(clock.gameSeconds).day;
    if (dayAfter !== dayBefore) ctx.events.emit('DayChanged', { day: dayAfter });
  };

  refit();

  return {
    get ship() {
      return ship();
    },
    get fit() {
      return fit;
    },
    get instruments() {
      return fit.instruments;
    },
    sync,
    refit,
    buyHull(port, to) {
      sync();
      const r = buyHull(
        economy.defs,
        ctx.state.markets,
        player,
        ship(),
        port,
        to,
        ctx.state.environment.clock.gameSeconds,
      );
      if (!r.ok) return REFUSALS[r.reason];
      refit();
      ctx.events.emit('ShipPurchased', r.event);
      return undefined;
    },
    install(port, upgrade, source) {
      sync();
      const r = installUpgrade(economy.defs, player, ship(), port, upgrade, source);
      if (!r.ok) return REFUSALS[r.reason];
      refit();
      skip(r.event.hours);
      ctx.events.emit('UpgradeInstalled', r.event);
      return undefined;
    },
    remove(port, upgrade, source) {
      sync();
      const r = removeUpgrade(player, ship(), port, upgrade, source);
      if (!r.ok) return REFUSALS[r.reason];
      refit();
      skip(r.event.hours);
      ctx.events.emit('UpgradeRemoved', r.event);
      return undefined;
    },
    repair(port, place) {
      sync();
      const r = repairShip(economy.defs, player, ship(), port, place);
      if (!r.ok) return REFUSALS[r.reason];
      refit();
      skip(r.event.hours);
      ctx.events.emit('ShipRepaired', r.event);
      return undefined;
    },
    useKit() {
      sync();
      const s = ship();
      const kit = kitFor(player, s);
      const r = useKit(player, s, kit);
      if (!r.ok) {
        if (s.hull01 >= 1 - 1e-9 && s.rigging01 >= 1 - 1e-9) return 'She is sound.';
        if (r.reason === 'noKit')
          return kit === PATCH_KIT ? 'No patch kits aboard.' : 'No mend kits aboard.';
        return REFUSALS[r.reason];
      }
      refit();
      ctx.events.emit('ShipRepaired', r.event);
      const left = player.stores[kit] ?? 0;
      return r.event.how === 'patchKit'
        ? `Patched the hull: ${Math.round(s.hull01 * 100)}%. ${left} patch kit${left === 1 ? '' : 's'} left.`
        : `Mended the rigging: ${Math.round(s.rigging01 * 100)}%. ${left} mend kit${left === 1 ? '' : 's'} left.`;
    },
  };
}
