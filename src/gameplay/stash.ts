import type { Zone, ZoneFrame } from '../core/coords';
import { advanceGameTime, dayAndHour, WORLD_TICK_GAME_SECONDS } from '../core/time';
import type { GameContext } from '../modes/context';
import { pierSite } from '../sim/harbors';
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
  stashCash,
  stashGoods,
  takeCash,
  takeGoods,
  type StashRefusal,
  type StashResult,
} from '../sim/hideouts/stash';
import { stashSnapshot, type StashSnapshot } from '../ui/stash/model';
import type { GameEconomy } from './economy';
import type { ShipHazards } from './hazards';

/**
 * The Stockton stash in the running game (plan 09 §3, plan 05 §2; Phase 4 piece E).
 * Coming alongside a hideout's landing opens its storage screen; anchored in its
 * anchorage, P opens it. Moves between the hold and the storage, and between the purse
 * and the strongbox, raise `StorageChanged`. Lying at anchor (Z, or from the screen) runs
 * the clock on to dawn, dusk or a shift of wind, then saves (plan 09 §3: an autosave
 * point). The screens pause the game; main owns the overlay stack and the keys.
 */

export interface StashActions {
  /** Each returns why it was refused, in a few words, or undefined when it went through. */
  stash(index: number, qty: number): string | undefined;
  take(index: number, qty: number): string | undefined;
  stashCash(cents: number): string | undefined;
  takeCash(cents: number): string | undefined;
  lie(until: LieUntil): string | undefined;
  close(): void;
  castOff(): void;
}

export interface StashControl {
  /** The hideout the ship is moored at (alongside its landing or in its anchorage). */
  readonly hideoutHere: string | undefined;
  readonly openHideout: string | undefined;
  /** The "lie at anchor" choice is open (away from a stash). */
  readonly lieOpen: boolean;
  /** Opens the storage of the hideout the ship is moored at; false if none. */
  openHere(): boolean;
  /** Opens a hideout's storage wherever the ship is (the dev hook). */
  open(hideoutId: string): void;
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
  /** After a lie: the notice to show, and a save. */
  afterLie(text: string): void;
}

const REFUSALS: Record<StashRefusal, string> = {
  badQty: 'Choose how many.',
  noStack: 'That lot is gone.',
  noRoomStash: 'The shed is full.',
  noRoomHold: 'There is no room in the hold.',
  noStrongbox: 'There is no strongbox here.',
  noMoney: "You haven't that much on hand.",
  noCash: "There isn't that much in the strongbox.",
};

export function attachStash(opts: StashControlOptions): StashControl {
  const { ctx, economy, hazards } = opts;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const hideouts = () => (ctx.state.hideouts ??= {});
  let dockedHideout: string | undefined;
  let openHideout: string | undefined;
  let lieOpen = false;

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
      moored: h.mooring === 'docked' ? 'docked' : h.anchor === 'down' ? 'anchored' : 'no',
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
      }),
    );
  };

  const open = (id: string): void => {
    if (!hideouts()[id]) return;
    const wasOpen = !!openHideout || lieOpen;
    if (lieOpen) {
      lieOpen = false;
      opts.showLie(null);
    }
    openHideout = id;
    refresh();
    if (!wasOpen) opts.onOpen(true);
  };
  const close = (): void => {
    if (!openHideout) return;
    openHideout = undefined;
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

  /** One world tick, as the sailing mode runs it. */
  const tick = (): void => {
    const clock = ctx.state.environment.clock;
    const before = dayAndHour(clock.gameSeconds).day;
    const n = advanceGameTime(clock, WORLD_TICK_GAME_SECONDS);
    for (let i = 0; i < n; i++) ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
    const after = dayAndHour(clock.gameSeconds).day;
    if (after !== before) ctx.events.emit('DayChanged', { day: after });
  };
  const lie = (until: LieUntil): string | undefined => {
    const why = refusalText();
    if (why) return why;
    const p = opts.shipPose();
    const seconds = lieAtAnchor(until, now(), tick, () => {
      const w = ctx.weather.windAt(p, now());
      return { fromRad: w.fromRad, speedKn: w.speedKn };
    });
    ctx.weather.tick(now(), p, ctx.sea);
    ctx.events.emit('LayAtAnchor', { until, seconds });
    const text = lieText(until, seconds);
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
      close() {
        close();
        closeLie();
      },
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
