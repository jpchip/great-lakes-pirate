import type { HideoutCurios } from './discovery';
import type { Zone, ZoneFrame } from '../core/coords';
import { advanceGameTime, dayAndHour, WORLD_TICK_GAME_SECONDS } from '../core/time';
import type { GameContext } from '../modes/context';
import { pierSite } from '../sim/harbors';
import {
  CRAFT_REFUSALS,
  craft,
  recipeDef,
  settleProduction,
  stationDef,
  stashThing,
  takeThing,
  THING_REFUSALS,
  thingName,
} from '../sim/hideouts/crafting';
import { sailShipRecord } from '../sim/sailing/ships';
import {
  buildShipAtSlipway,
  installAtSlipway,
  repairAtSlipway,
  SLIPWAY_REFUSALS,
} from '../sim/hideouts/slipway';
import { upgradeDef } from '../sim/shipyard/fit';
import {
  LIE_REFUSALS,
  lieAtAnchor,
  lieRefusal,
  lieText,
  type LieRefusal,
  type LieUntil,
} from '../sim/hideouts/lie-at-anchor';
import {
  hideoutIdOf,
  siteAnchoredAt,
  siteDef,
  type HideoutState,
  stashCash,
  stashGoods,
  takeCash,
  takeGoods,
  type StashRefusal,
  type StashResult,
} from '../sim/hideouts/stash';
import { spanText, stashSnapshot, type StashSnapshot } from '../ui/stash/model';
import type { Hold } from '../sim/economy/hold';
import type { GameEconomy } from './economy';
import type { ShipHazards } from './hazards';

/**
 * The Stockton stash in the running game (plan 09 §3, plan 05 §2; Phase 4 piece E).
 * Coming alongside a hideout's landing opens its storage screen; anchored in its
 * anchorage, P opens it. Moves between the hold and the storage, and between the purse
 * and the strongbox, raise `StorageChanged`. Lying at anchor (Z, or from the screen) runs
 * the clock on an hour, a watch, or to dawn, dusk or a shift of wind, then saves (plan 09 §3: an autosave
 * point). The screens pause the game; main owns the overlay stack and the keys.
 */

export interface StashActions {
  /** Each returns why it was refused, in a few words, or undefined when it went through. */
  stash(index: number, qty: number): string | undefined;
  take(index: number, qty: number): string | undefined;
  stashCash(cents: number): string | undefined;
  takeCash(cents: number): string | undefined;
  lie(until: LieUntil): string | undefined;
  /**
   * Makes `batches` of a recipe at a station here (Phase 8 piece E): the clock runs on
   * while the work is done, or the still is loaded. Re-crating names the hot lot.
   */
  craft(recipe: string, batches: number, stackIndex?: number): string | undefined;
  /** Takes stores made here aboard into the lockers, or leaves some from the lockers. */
  takeThing(id: string, qty: number): string | undefined;
  stashThing(id: string, qty: number): string | undefined;
  /**
   * The slipway (Phase 8 piece G): haul her out and make her sound, fit an upgrade kept
   * here, or, shipless, build a new schooner. Each runs the clock on by the work.
   */
  slipwayRepair(): string | undefined;
  slipwayInstall(upgrade: string): string | undefined;
  buildShip(): string | undefined;
  /** Shipless at a hideout: give it up and make for the nearest yard's worn hull. */
  toYard(): void;
  close(): void;
  castOff(): void;
  /** Alongside the hideout's landing: close the screen and step down onto the pier. */
  goAshore(): void;
  /** Sets a curio out here (`show`), or takes it back aboard (Phase 9 piece O). */
  setCurio(id: string, show: boolean): string | undefined;
}

export interface StashControl {
  /** The hideout the ship is moored at (alongside its landing or in its anchorage). */
  readonly hideoutHere: string | undefined;
  readonly openHideout: string | undefined;
  /** The "lie at anchor" choice is open (away from a stash). */
  readonly lieOpen: boolean;
  /** How the ship lies now, for the choice's title: at anchor, alongside, or neither. */
  readonly moored: 'anchored' | 'docked' | 'no';
  /** What the last lie came to, in a line ("You lay alongside until dawn (5 h)."). */
  readonly lastLieText: string | undefined;
  /** Opens the storage of the hideout the ship is moored at; false if none. */
  openHere(): boolean;
  /** Opens a hideout's storage wherever the ship is (the dev hook); `tab` picks the view. */
  open(hideoutId: string, tab?: StashTab): void;
  close(): void;
  /** Why lying at anchor is refused now, or undefined. */
  lieRefusal(): LieRefusal | undefined;
  /** Opens the lie-at-anchor choice, or returns why not. */
  openLie(): string | undefined;
  closeLie(): void;
  actions: StashActions;
  dispose(): void;
}

export interface StashControlOptions {
  ctx: GameContext;
  economy: GameEconomy;
  hazards: ShipHazards;
  berthPier(berthId: string): string | undefined;
  shipPose(): Zone;
  speedMs(): number;
  /** The loaded zone and its frame; undefined off a zone (the greybox, an arena). */
  zone(): { id: string; frame: ZoneFrame } | undefined;
  /** The nearest ship under way, zone meters (Infinity for none). */
  nearestUnderWayM(p: Zone): number;
  showStash(snapshot: StashSnapshot | undefined): void;
  showLie(refusal: string | undefined | null): void;
  onOpen(open: boolean): void;
  castOff(): void;
  /** After a lie or a spell of work: the notice to show, and a save. */
  afterLie(text: string): void;
  /** A still's batch ran off at a hideout: the notice to show. */
  onProduced?(text: string): void;
  /**
   * The ship's condition and fit (Phase 8 piece G): `sync` writes the hazard state into
   * `player.ship` before the slipway's sums, `refit` puts `player.ship` back on her after.
   */
  shipyard?: { sync(): void; refit(): void };
  /** A new schooner is off the ways at a hideout: put the captain aboard her there. */
  launched?(hideoutId: string): void;
  /** Shipless at a hideout, making for the yard instead. */
  toYard?(hideoutId: string): void;
  /** Going ashore from the pier the ship lies at: whether it's offered, and doing it. */
  ashore?: { offered(): boolean; go(): void };
  /** Curios set out at a hideout (Phase 9 piece O); without it no Curios tab. */
  curios?: {
    view(hideout: string): HideoutCurios;
    set(id: string, hideout: string | undefined): string | undefined;
  };
}

/** Which view of the stash screen opens: the shed, the stations, or the slipway. */
export type StashTab = 'storage' | 'workshop' | 'slipway' | 'curios';

const REFUSALS: Record<StashRefusal, string> = {
  badQty: 'Choose how many.',
  noStack: 'That lot is gone.',
  noRoomStash: 'The shed is full.',
  noRoomHold: 'There is no room in the hold.',
  noStrongbox: 'There is no strongbox here.',
  noMoney: "You haven't that much on hand.",
  noCash: "There isn't that much in the strongbox.",
};

/** One world tick, as the sailing mode runs it: the clock on, `WorldTick`, `DayChanged`. */
export function runWorldTick(ctx: GameContext): void {
  const clock = ctx.state.environment.clock;
  const before = dayAndHour(clock.gameSeconds).day;
  const n = advanceGameTime(clock, WORLD_TICK_GAME_SECONDS);
  for (let i = 0; i < n; i++) ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
  const after = dayAndHour(clock.gameSeconds).day;
  if (after !== before) ctx.events.emit('DayChanged', { day: after });
}

export function attachStash(opts: StashControlOptions): StashControl {
  const { ctx, economy, hazards } = opts;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const hideouts = () => (ctx.state.hideouts ??= {});
  let dockedHideout: string | undefined;
  let openHideout: string | undefined;
  let openTab: StashTab | undefined;
  let lieOpen = false;
  let lastLieText: string | undefined;
  const moored = (): 'anchored' | 'docked' | 'no' => {
    const h = hazards.state;
    return h.mooring === 'docked' ? 'docked' : h.anchor === 'down' ? 'anchored' : 'no';
  };

  const hideoutHere = (): string | undefined => {
    const h = hazards.state;
    if (dockedHideout && h.mooring === 'docked') return dockedHideout;
    if (h.anchor !== 'down') return undefined;
    const z = opts.zone();
    if (!z) return undefined;
    const site = siteAnchoredAt(z.id, z.frame, opts.shipPose());
    const id = site && hideoutIdOf(site.id);
    return id && hideouts()[id] ? id : undefined;
  };

  const refusal = (): LieRefusal | undefined => {
    const h = hazards.state;
    const p = opts.shipPose();
    const wind = ctx.weather.windAt(p, now());
    return lieRefusal({
      moored: moored(),
      speedMs: opts.speedMs(),
      dragging: h.dragging,
      aground: h.aground,
      shelter01: wind.shelter01,
      windKn: wind.speedKn,
      nearestUnderWayM: opts.nearestUnderWayM(p),
    });
  };
  const refusalText = (): string | undefined => {
    const r = refusal();
    return r && LIE_REFUSALS[r];
  };

  /** Shipless (piece G): the captain's ship is gone and they're ashore at a hideout. */
  const shipless = (): boolean => !!ctx.state.player.shipless;
  /** The crew's tier, by the hull's (plan 09 §6.3: the invisible crew comes with her). */
  const crewTier = (): number => {
    const ship = ctx.state.player.ship;
    if (shipless()) return 1;
    return ship ? (sailShipRecord(ship.classId).tier ?? 1) : 1;
  };
  /** Her ship is moored at this hideout, so the slipway can haul her out. */
  const shipHere = (id: string): boolean => !shipless() && hideoutHere() === id;
  /** Materials for work here: the storage, then the hold when she's moored here. */
  const sources = (id: string, h: HideoutState): Hold[] =>
    shipHere(id) ? [h.storage.goods, ctx.state.player.cargo] : [h.storage.goods];

  /** Runs every hideout's still on to now; what ran off goes into its storage. */
  const settleAll = (): void => {
    for (const [id, h] of Object.entries(hideouts())) {
      for (const done of settleProduction(h, now())) {
        ctx.events.emit('ProductionCompleted', {
          hideout: id,
          station: done.station,
          recipe: done.recipe,
          goods: done.goods,
        });
        const name = recipeDef(done.recipe)?.name ?? done.recipe;
        const place = siteDef(h.siteId)?.place ?? 'the hideout';
        opts.onProduced?.(`A batch of ${name.toLowerCase()} has run off at ${place}.`);
        if (id === openHideout) refresh();
      }
    }
  };

  /** Alongside (not at anchor) with a landing to walk: the screen offers going ashore. */
  const canGoAshore = (): boolean =>
    !shipless() && moored() === 'docked' && !!opts.ashore?.offered();

  const refresh = (): void => {
    if (!openHideout) return;
    const h = hideouts()[openHideout];
    if (!h) return;
    opts.showStash(
      stashSnapshot({
        defs: economy.defs,
        hideoutId: openHideout,
        hideout: h,
        player: ctx.state.player,
        holdCapacity: economy.capacity,
        gameSeconds: now(),
        lieRefusal: refusalText(),
        sources: sources(openHideout, h),
        stores: ctx.state.player.stores,
        crewTier: crewTier(),
        ship: ctx.state.player.ship,
        shipName: ctx.state.player.captain.shipName,
        shipless: shipless(),
        shipHere: shipHere(openHideout),
        tab: openTab,
        canGoAshore: canGoAshore(),
        curios: opts.curios?.view(openHideout),
      }),
    );
  };

  const open = (id: string, tab?: StashTab): void => {
    if (!hideouts()[id]) return;
    const wasOpen = !!openHideout || lieOpen;
    if (lieOpen) {
      lieOpen = false;
      opts.showLie(null);
    }
    // A fresh screen opens on the tab asked for; shipless, the slipway is what matters.
    if (!wasOpen || tab) openTab = tab ?? (shipless() ? 'slipway' : undefined);
    openHideout = id;
    opts.shipyard?.sync();
    refresh();
    if (!wasOpen) opts.onOpen(true);
  };
  const close = (): void => {
    if (!openHideout) return;
    openHideout = undefined;
    openTab = undefined;
    opts.showStash(undefined);
    opts.onOpen(false);
  };
  const closeLie = (): void => {
    if (!lieOpen) return;
    lieOpen = false;
    opts.showLie(null);
    opts.onOpen(false);
  };

  const offDocked = ctx.events.on('ShipDocked', ({ shipId, berthId }) => {
    if (shipId !== 'ship.player') return;
    const pier = opts.berthPier(berthId);
    const site = pier ? pierSite(pier) : undefined;
    dockedHideout = site ? hideoutIdOf(site) : undefined;
    if (dockedHideout) open(dockedHideout);
  });
  const offCastOff = ctx.events.on('ShipCastOff', ({ shipId }) => {
    if (shipId === 'ship.player') dockedHideout = undefined;
  });
  const offZone = ctx.events.on('ZoneExited', () => (dockedHideout = undefined));
  // The still works on while you're away (plan 09 §7.3): settled on load and every tick.
  const offTick = ctx.events.on('WorldTick', () => settleAll());
  settleAll();

  const settle = (direction: 'in' | 'out', r: StashResult): string | undefined => {
    if (!r.ok) return REFUSALS[r.reason];
    const hideout = openHideout as string;
    ctx.events.emit('StorageChanged', {
      hideout,
      direction,
      ...(r.good !== undefined ? { good: r.good, qty: r.qty } : {}),
      ...(r.cents !== undefined ? { cents: r.cents } : {}),
    });
    economy.syncLoad();
    refresh();
    return undefined;
  };
  const current = () => (openHideout ? hideouts()[openHideout] : undefined);

  const tick = (): void => runWorldTick(ctx);
  /** The clock run on through a spell of work, world ticks and weather with it. */
  const runFor = (seconds: number): void => {
    const ticks = Math.max(1, Math.round(seconds / WORLD_TICK_GAME_SECONDS));
    for (let k = 0; k < ticks; k++) tick();
    ctx.weather.tick(now(), opts.shipPose(), ctx.sea);
  };
  const work = () => ({ crewTier: crewTier(), gameSeconds: now() });
  /** Why the slipway can't take her: she's not here, or there's no ship. */
  const haulRefusal = (id: string): string | undefined => {
    if (shipless()) return SLIPWAY_REFUSALS.shipless;
    if (!shipHere(id)) return 'Bring her into the anchorage or alongside first.';
    return undefined;
  };
  const goodsText = (goods: Record<string, number>): string =>
    Object.entries(goods)
      .map(([g, n]) => `${n} ${economy.defs.goods.get(g)?.name.toLowerCase() ?? g}`)
      .join(', ');

  const lie = (until: LieUntil): string | undefined => {
    const why = refusalText();
    if (why) return why;
    const p = opts.shipPose();
    const how = moored() === 'docked' ? 'docked' : 'anchored';
    const seconds = lieAtAnchor(until, now(), tick, () => {
      const w = ctx.weather.windAt(p, now());
      return { fromRad: w.fromRad, speedKn: w.speedKn };
    });
    ctx.weather.tick(now(), p, ctx.sea);
    ctx.events.emit('LayAtAnchor', { until, seconds });
    const text = lieText(until, seconds, how);
    lastLieText = text;
    if (lieOpen) closeLie();
    refresh();
    opts.afterLie(text);
    return undefined;
  };

  return {
    get hideoutHere() {
      return hideoutHere();
    },
    get openHideout() {
      return openHideout;
    },
    get lieOpen() {
      return lieOpen;
    },
    get moored() {
      return moored();
    },
    get lastLieText() {
      return lastLieText;
    },
    openHere() {
      const id = hideoutHere();
      if (!id) return false;
      open(id);
      return true;
    },
    open,
    close,
    lieRefusal: refusal,
    openLie() {
      if (openHideout || lieOpen) return undefined;
      const why = refusalText();
      if (why) return why;
      lieOpen = true;
      opts.showLie(undefined);
      opts.onOpen(true);
      return undefined;
    },
    closeLie,
    actions: {
      stash(index, qty) {
        const h = current();
        if (!h) return 'The shed is shut.';
        return settle('in', stashGoods(ctx.state.player.cargo, h, index, qty));
      },
      take(index, qty) {
        const h = current();
        if (!h) return 'The shed is shut.';
        return settle('out', takeGoods(ctx.state.player.cargo, economy.capacity, h, index, qty));
      },
      stashCash(cents) {
        const h = current();
        if (!h) return 'The shed is shut.';
        return settle('in', stashCash(ctx.state.player, h, cents));
      },
      takeCash(cents) {
        const h = current();
        if (!h) return 'The shed is shut.';
        return settle('out', takeCash(ctx.state.player, h, cents));
      },
      lie,
      craft(recipeId, batches, stackIndex) {
        const id = openHideout;
        const h = current();
        if (!id || !h) return 'The shed is shut.';
        const r = craft(h, recipeId, batches, sources(id, h), {
          crewTier: crewTier(),
          gameSeconds: now(),
          stackIndex,
        });
        if (!r.ok) return CRAFT_REFUSALS[r.reason];
        const def = recipeDef(r.recipe);
        ctx.events.emit('ItemCrafted', {
          hideout: id,
          recipe: r.recipe,
          ...(def ? { station: def.station } : {}),
          seconds: r.seconds,
          batches: r.batches,
          goods: r.goods,
          things: r.things,
        });
        economy.syncLoad();
        const name = def?.name.toLowerCase() ?? r.recipe;
        let text: string;
        if (r.seconds > 0) {
          const ticks = Math.max(1, Math.round(r.seconds / WORLD_TICK_GAME_SECONDS));
          for (let k = 0; k < ticks; k++) tick();
          ctx.weather.tick(now(), opts.shipPose(), ctx.sea);
          const made = [
            ...Object.entries(r.goods).map(
              ([g, n]) => `${n} CU of ${economy.defs.goods.get(g)?.name ?? g}`,
            ),
            ...Object.entries(r.things).map(([t, n]) => `${n} × ${thingName(t)}`),
          ];
          const span = spanText(r.seconds);
          const at = (def && stationDef(def.station)?.name.toLowerCase()) ?? 'bench';
          text = def?.recrate
            ? `You re-crated ${r.batches} CU in plain crates (${span}).`
            : `You worked ${span} at the ${at}: ${made.join(', ')}.`;
        } else {
          text = `You loaded the still with ${r.batches} batch${r.batches > 1 ? 'es' : ''} of ${name}.`;
        }
        refresh();
        opts.afterLie(text);
        return undefined;
      },
      takeThing(thingId, qty) {
        const h = current();
        if (!h) return 'The shed is shut.';
        const r = takeThing(h, ctx.state.player, thingId, qty);
        if (!r.ok) return THING_REFUSALS[r.reason];
        refresh();
        return undefined;
      },
      stashThing(thingId, qty) {
        const h = current();
        if (!h) return 'The shed is shut.';
        const r = stashThing(h, ctx.state.player, thingId, qty);
        if (!r.ok) return THING_REFUSALS[r.reason];
        refresh();
        return undefined;
      },
      slipwayRepair() {
        const id = openHideout;
        const h = current();
        if (!id || !h) return 'The shed is shut.';
        const why = haulRefusal(id);
        if (why) return why;
        opts.shipyard?.sync();
        const ship = ctx.state.player.ship;
        if (!ship) return SLIPWAY_REFUSALS.shipless;
        const r = repairAtSlipway(h, ship, sources(id, h), work());
        if (!r.ok) return SLIPWAY_REFUSALS[r.reason];
        opts.shipyard?.refit();
        economy.syncLoad();
        runFor(r.event.seconds);
        ctx.events.emit('ShipRepaired', {
          port: id,
          how: 'slipway',
          hull01: 1,
          rigging01: 1,
          costCents: 0,
          hours: r.event.seconds / 3600,
        });
        const text = `You hauled her out and worked ${spanText(r.event.seconds)} on the ways: she's sound (${goodsText(r.event.used)}).`;
        refresh();
        opts.afterLie(text);
        return undefined;
      },
      slipwayInstall(upgrade) {
        const id = openHideout;
        const h = current();
        if (!id || !h) return 'The shed is shut.';
        const why = haulRefusal(id);
        if (why) return why;
        opts.shipyard?.sync();
        const ship = ctx.state.player.ship;
        if (!ship) return SLIPWAY_REFUSALS.shipless;
        const r = installAtSlipway(h, ship, upgrade, work());
        if (!r.ok) return SLIPWAY_REFUSALS[r.reason];
        opts.shipyard?.refit();
        runFor(r.event.seconds);
        ctx.events.emit('UpgradeInstalled', {
          port: id,
          upgrade,
          cents: 0,
          hours: r.event.seconds / 3600,
        });
        const name = upgradeDef(upgrade)?.name.toLowerCase() ?? upgrade;
        const text = `You fitted the ${name} on the ways (${spanText(r.event.seconds)}).`;
        refresh();
        opts.afterLie(text);
        return undefined;
      },
      buildShip() {
        const id = openHideout;
        const h = current();
        if (!id || !h) return 'The shed is shut.';
        const r = buildShipAtSlipway(h, shipless(), [h.storage.goods], now());
        if (!r.ok) return SLIPWAY_REFUSALS[r.reason];
        runFor(r.event.seconds);
        const player = ctx.state.player;
        player.ship = r.event.ship;
        delete player.shipless;
        opts.shipyard?.refit();
        ctx.events.emit('ShipLaunched', {
          from: 'slipway',
          hideout: id,
          classId: r.event.ship.classId,
        });
        close();
        opts.launched?.(id);
        const place = siteDef(h.siteId)?.place ?? 'the hideout';
        opts.afterLie(
          `${spanText(r.event.seconds)} on the ways at ${place}, and she's launched: the ${player.captain.shipName}, a schooner of your own building.`,
        );
        return undefined;
      },
      toYard() {
        const id = openHideout;
        if (!id || !shipless()) return;
        close();
        opts.toYard?.(id);
      },
      close() {
        close();
        closeLie();
      },
      castOff() {
        close();
        // Shipless there's nothing to cast off: F just closes the screen.
        if (!shipless()) opts.castOff();
      },
      goAshore() {
        if (!canGoAshore()) return;
        close();
        opts.ashore?.go();
      },
      setCurio(id, show) {
        if (!openHideout || !opts.curios) return 'Nowhere to set it out.';
        const why = opts.curios.set(id, show ? openHideout : undefined);
        refresh();
        return why;
      },
    },
    dispose() {
      offDocked();
      offCastOff();
      offZone();
      offTick();
    },
  };
}
