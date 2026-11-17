import type { SiteDef } from '../../data/schemas/sites';
import type { Zone, ZoneFrame } from '../core/coords';
import type { GameContext } from '../modes/context';
import { addToHold, holdFree, holdUsed, type Hold } from '../sim/economy/hold';
import {
  concealmentOf,
  markSpotted,
  recentlySpotted,
  returnSalvage,
  salvageLeft,
  sleepSeconds,
  sleepText,
  spotRangeM,
  spottedNow,
  spottedUntil,
  takeSalvage,
  type Concealment,
  type SleepUntil,
} from '../sim/hideouts/life';
import { siteToZone } from '../sim/hideouts/site-frame';
import {
  hideoutIdOf,
  siteAnchorage,
  siteAnchoredAt,
  SITES,
  storageCapacity,
} from '../sim/hideouts/stash';
import type { PlacedPoiPiece } from '../sim/islands/on-foot';
import { tierIn } from '../sim/law/law';
import type { SpottedTalk } from '../sim/rumors/rumors';
import { sunAt } from '../sim/weather/celestial';
import type { Hideouts } from './hideouts';
import type { GameLaw } from './law';
import type { ControllerParams } from './onfoot/controller';
import { runWorldTick } from './stash';

/**
 * Hideout life in the running game (plan 09 §3, §6.2, §8; plan 06 §3.3, §5.4; Phase 8
 * piece F). The rules are `sim/hideouts/life.ts`; this wires them to the zone, the law and
 * the screens:
 *
 * - **Sleep.** F at a built bunk opens the sleep choice (dawn, noon, dusk, eight hours).
 *   The clock runs on in world ticks with the law told you're laying low in the site's
 *   region, then the game saves. Refused with the law on your tail.
 * - **Pursuit ends at the anchorage** (`refuge`): the law at sea asks which hideout's
 *   anchorage holds the ship; inside one, pursuers break off and the chart lock lifts.
 * - **Leaving saves**: sailing out of a hideout's anchorage, or casting off its pier.
 * - **Being spotted**: while your ship lies at a site or you're ashore in it, a ship under
 *   way that passes inside the site's sight range ties you to it (`HideoutSpotted`). So
 *   does a pursuer who watched you reach it. The talk is in `spottedTalk` for the saloons,
 *   and the *Morrill*'s patrol reads `spottedRegion`.
 * - **Salvage**: F at the quarry's dressed blocks or the camp's lumber piles lifts a load
 *   (slow walking, no crouching); F at a storage piece of yours stacks it in the stores, or
 *   at the rowboat puts it in the hold. Going aboard any other way leaves it on the pile.
 */

export interface HideoutLifeDeps {
  ctx: GameContext;
  law: GameLaw;
  hideouts: Hideouts;
  /** The loaded zone and its frame; undefined off a zone (the chart, an arena). */
  zone(): { id: string; frame: ZoneFrame } | undefined;
  /** The player's ship in zone meters, when she's on the zone's water. */
  shipPose(): Zone | undefined;
  /** The hideout the ship is moored at (alongside its pier or anchored in its anchorage). */
  mooredAt(): string | undefined;
  /** Ships under way in the zone, zone meters, and what to call them ("the tug Sophia"). */
  shipsUnderWay(): Iterable<{ id: string; x: number; z: number; name: string }>;
  /** Where you stand ashore, zone meters (not in the rowboat); undefined aboard. */
  standing(): { x: number; y: number; z: number } | undefined;
  /** The walked islands' prefab pieces in the zone (the salvage piles among them). */
  islandPieces(): Iterable<PlacedPoiPiece>;
  /** Why sleeping is refused now (the law on your tail), or undefined. */
  blocked(): string | undefined;
  /** The ship's hold and its capacity, for a load put in the rowboat. */
  hold(): { cargo: Hold; capacity: number };
  showSleep(view: SleepView | undefined): void;
  onOpen(open: boolean): void;
  notice(text: string): void;
  save(): void;
  /** Something moved into storage or the hold: the HUD's load. */
  changed(): void;
}

/** What the sleep choice shows. */
export interface SleepView {
  hideout: string;
  place: string;
  region: string;
  regionName: string;
  tierName: string;
  heat: number;
  /** "three times as fast as away". */
  factor: number;
  message: string | undefined;
}

export interface SleepActions {
  sleep(until: SleepUntil): string | undefined;
  close(): void;
}

export interface HideoutLife {
  readonly sleepOpen: boolean;
  /** F at a bunk: opens the choice, or says why not. */
  openSleep(hideoutId: string): void;
  actions: SleepActions;
  /** The hideout whose anchorage holds the ship now. */
  refuge(): string | undefined;
  /** A hideout's concealment now, for the build palette. */
  concealment(hideoutId: string): Concealment | undefined;
  /** Spotted this week: for the build palette ("Seen 2 days ago"). */
  spotted(hideoutId: string): { by: string; at: number; until: number } | undefined;
  /** The saloons' talk of your hideouts seen this week. */
  spottedTalk(): SpottedTalk[];
  /** A Wanted region holding a hideout spotted this week (the cutter leans there). */
  spottedRegion(region: string): boolean;
  /** Salvage on foot: the prompt at a pile, zone meters. */
  salvagePrompt(at: { x: number; y: number; z: number }): { text: string; act(): void } | undefined;
  /** In your arms: what the storage prompt says and does. */
  carrying(): { text: string; stow(hideoutId: string): void } | undefined;
  /** At the rowboat with a load: put it in the hold. */
  boatPrompt(): { text: string; act(): void } | undefined;
  /** The walker's params while carrying. */
  params(base: ControllerParams): ControllerParams;
  readonly load: { good: string; qty: number; hideout: string } | undefined;
  /** Each frame: spotting, the autosave on leaving, a load left behind. */
  step(dt: number): void;
  dispose(): void;
}

/** Spotting is looked at this often, real seconds. */
const SPOT_EVERY_S = 1;
/** Within this of a pile's footprint, you can lift from it. */
const PILE_REACH_M = 1.6;
/** Carrying a load slows you as a crate does (plan 08 §7). */
const CARRY_WALK = 0.7;
const CARRY_RUN = 0.65;

const LAW_NAMES: Record<string, string> = {
  'law.morrill': 'the Morrill',
  'law.chartered_tug': 'the chartered tug',
};

function siteOf(hideoutId: string): SiteDef | undefined {
  return SITES.find((s) => hideoutIdOf(s.id) === hideoutId);
}

/** "Presque Isle bay, on Stockton Island". */
function whereOf(site: SiteDef): string {
  const [bay, place] = site.name.split(', ');
  return place ? `${bay}, on ${place}` : site.name;
}

function night(t: number): boolean {
  return sunAt(t).elevationRad < 0;
}

export function attachHideoutLife(deps: HideoutLifeDeps): HideoutLife {
  const { ctx, law, hideouts } = deps;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const states = () => ctx.state.hideouts ?? {};
  let sleepAt: string | undefined;
  let message: string | undefined;
  let spotClock = 0;
  let wasHome: string | undefined;
  let load: { good: string; qty: number; hideout: string; name: string } | undefined;

  const regionName = (r: string): string => law.defs.regionById.get(r)?.name ?? r;

  const view = (): SleepView | undefined => {
    const site = sleepAt ? siteOf(sleepAt) : undefined;
    if (!sleepAt || !site) return undefined;
    const region = site.wantedRegion;
    const tier = tierIn(law.defs, ctx.state, region);
    return {
      hideout: sleepAt,
      place: site.place,
      region,
      regionName: regionName(region),
      tierName: law.defs.wanted.tiers[tier]?.name ?? '',
      heat: Math.round(ctx.state.wanted[region]?.heat ?? 0),
      factor: law.defs.wanted.decay.layLowFactor,
      message,
    };
  };

  const closeSleep = (): void => {
    if (!sleepAt) return;
    sleepAt = undefined;
    message = undefined;
    deps.showSleep(undefined);
    deps.onOpen(false);
  };

  const sleep = (until: SleepUntil): string | undefined => {
    const id = sleepAt;
    const site = id ? siteOf(id) : undefined;
    if (!id || !site) return 'There is no bunk here.';
    const why = deps.blocked();
    if (why) {
      message = why;
      deps.showSleep(view());
      return why;
    }
    const region = site.wantedRegion;
    const before = ctx.state.wanted[region]?.heat ?? 0;
    const tierBefore = tierIn(law.defs, ctx.state, region);
    const seconds = sleepSeconds(until, now());
    const ticks = Math.max(1, Math.round(seconds / 600));
    law.layLow = region;
    try {
      for (let k = 0; k < ticks; k++) runWorldTick(ctx);
    } finally {
      law.layLow = undefined;
    }
    const at = deps.standing() ?? deps.shipPose();
    if (at) ctx.weather.tick(now(), at, ctx.sea);
    ctx.events.emit('SleptAtHideout', { hideout: id, region, seconds: ticks * 600 });
    const after = ctx.state.wanted[region]?.heat ?? 0;
    const tierAfter = tierIn(law.defs, ctx.state, region);
    let text = sleepText(until, ticks * 600);
    if (tierAfter < tierBefore) {
      text += ` The law in ${regionName(region)} has cooled to ${law.defs.wanted.tiers[tierAfter]?.name ?? ''}.`;
    } else if (before - after >= 1) {
      text += ` The talk in ${regionName(region)} is dying down.`;
    }
    closeSleep();
    deps.notice(text);
    deps.save();
    return undefined;
  };

  const refuge = (): string | undefined => {
    const z = deps.zone();
    const p = deps.shipPose();
    if (!z || !p) return undefined;
    const site = siteAnchoredAt(z.id, z.frame, p);
    const id = site && hideoutIdOf(site.id);
    return id && states()[id] ? id : undefined;
  };

  const concealment = (hideoutId: string): Concealment | undefined => {
    const s = hideouts.site(hideoutId);
    if (!s) return undefined;
    return concealmentOf(s.site, s.grid, {
      night: night(now()),
      shipHere: deps.mooredAt() === hideoutId || refuge() === hideoutId,
    });
  };

  const spot = (): void => {
    const t = now();
    const standing = deps.standing();
    const ashoreIn = standing ? hideouts.siteAt(standing)?.hideoutId : undefined;
    const home = deps.mooredAt() ?? refuge();
    const z = deps.zone();
    if (!z) return;
    for (const s of hideouts.sites()) {
      if (s.hideoutId !== home && s.hideoutId !== ashoreIn) continue;
      if (recentlySpotted(s.state, t)) continue;
      const c = concealment(s.hideoutId);
      if (!c) continue;
      const range = spotRangeM(c.value, night(t));
      const a = siteAnchorage(s.site, z.frame);
      const mid = siteToZone(s.frame, s.frame.cols, s.frame.rows / 2);
      for (const ship of deps.shipsUnderWay()) {
        const d = Math.min(
          a ? Math.hypot(ship.x - a.x, ship.z - a.z) : Infinity,
          Math.hypot(ship.x - mid.x, ship.z - mid.z),
        );
        if (d > range) continue;
        ctx.events.emit('HideoutSpotted', { hideout: s.hideoutId, by: ship.name });
        break;
      }
    }
  };

  const offSpotted = ctx.events.on('HideoutSpotted', ({ hideout, by }) => {
    const h = states()[hideout];
    const site = siteOf(hideout);
    if (!h || !site) return;
    const who = LAW_NAMES[by] ?? by;
    const ship = ctx.state.player.captain.shipName;
    if (!markSpotted(h, { at: now(), by: who, ship })) return;
    const shown = who.charAt(0).toUpperCase() + who.slice(1);
    deps.notice(`${shown} saw the ${ship} lying at ${site.place}. Word will get about.`);
  });

  // ---- Salvage

  const pileSite = (at: { x: number; z: number }): SiteDef | undefined => {
    for (const piece of deps.islandPieces()) {
      const site = SITES.find(
        (s) => s.salvage && s.salvage.poi === piece.poi && s.salvage.kinds.includes(piece.kind),
      );
      if (!site) continue;
      const fx = Math.sin(piece.bearing);
      const fz = -Math.cos(piece.bearing);
      const dx = at.x - piece.x;
      const dz = at.z - piece.z;
      const right = Math.abs(dx * -fz + dz * fx);
      const out = Math.abs(dx * fx + dz * fz);
      if (right <= piece.widthM / 2 + PILE_REACH_M && out <= piece.depthM / 2 + PILE_REACH_M) {
        return site;
      }
    }
    return undefined;
  };

  const salvagePrompt = (at: { x: number; y: number; z: number }) => {
    const site = pileSite(at);
    const s = site?.salvage;
    if (!site || !s) return undefined;
    const id = hideoutIdOf(site.id);
    const h = states()[id];
    if (load) {
      if (load.hideout !== id) return undefined;
      return {
        text: `Put the ${load.name} back`,
        act: () => {
          const h2 = states()[id];
          if (h2 && load) returnSalvage(h2, load.qty, now());
          load = undefined;
        },
      };
    }
    // The ruins are yours to strip once the site is yours.
    if (!h) return undefined;
    const left = salvageLeft(site, h, now());
    if (left <= 0) {
      return {
        text: `Nothing more worth taking this season`,
        act: () => deps.notice(`You've taken the best of the ${s.name} this season.`),
      };
    }
    return {
      text: `Take a load of ${s.name} (${left} CU left this season)`,
      act: () => {
        const qty = takeSalvage(site, h, now());
        if (qty <= 0) return;
        load = { good: s.good, qty, hideout: id, name: s.name };
        deps.notice(`You shoulder ${qty} CU of ${s.name}.`);
      },
    };
  };

  const stowStores = (hideoutId: string): void => {
    const h = states()[hideoutId];
    if (!load || !h) return;
    const room = storageCapacity(h) - holdUsed(h.storage.goods);
    if (room < load.qty) {
      deps.notice('The stores are full.');
      return;
    }
    addToHold(h.storage.goods, { good: load.good, qty: load.qty });
    ctx.events.emit('SalvageTaken', {
      hideout: load.hideout,
      good: load.good,
      qty: load.qty,
      to: 'stores',
    });
    deps.notice(`You stack the ${load.name} in the stores.`);
    load = undefined;
    deps.changed();
  };

  const stowBoat = (): void => {
    if (!load) return;
    const { cargo, capacity } = deps.hold();
    if (holdFree(cargo, capacity) < load.qty) {
      deps.notice('There is no room in the hold.');
      return;
    }
    addToHold(cargo, { good: load.good, qty: load.qty });
    ctx.events.emit('SalvageTaken', {
      hideout: load.hideout,
      good: load.good,
      qty: load.qty,
      to: 'hold',
    });
    deps.notice(`You lay the ${load.name} in the boat; it goes into the hold.`);
    load = undefined;
    deps.changed();
  };

  const offZone = ctx.events.on('ZoneExited', () => {
    wasHome = undefined;
  });

  return {
    get sleepOpen() {
      return !!sleepAt;
    },
    openSleep(hideoutId) {
      if (sleepAt) return;
      if (load) {
        deps.notice(`Put the ${load.name} down first.`);
        return;
      }
      const why = deps.blocked();
      if (why) {
        deps.notice(why);
        return;
      }
      sleepAt = hideoutId;
      message = undefined;
      deps.showSleep(view());
      deps.onOpen(true);
    },
    actions: { sleep, close: closeSleep },
    refuge,
    concealment,
    spotted(hideoutId) {
      const h = states()[hideoutId];
      if (!h?.spotted || !spottedNow(h, now())) return undefined;
      return { by: h.spotted.by, at: h.spotted.at, until: spottedUntil(h) ?? 0 };
    },
    spottedTalk() {
      const out: SpottedTalk[] = [];
      for (const [id, h] of Object.entries(states())) {
        if (!h.spotted || !spottedNow(h, now())) continue;
        const site = siteOf(id);
        if (!site) continue;
        const r = law.defs.regionById.get(site.wantedRegion);
        out.push({
          hideout: id,
          where: whereOf(site),
          by: h.spotted.by,
          ship: h.spotted.ship,
          at: h.spotted.at,
          until: spottedUntil(h) ?? h.spotted.at,
          regions: [site.wantedRegion, ...(r?.neighbors ?? [])],
        });
      }
      return out;
    },
    spottedRegion(region) {
      for (const [id, h] of Object.entries(states())) {
        if (spottedNow(h, now()) && siteOf(id)?.wantedRegion === region) return true;
      }
      return false;
    },
    salvagePrompt,
    carrying() {
      if (!load) return undefined;
      return { text: `Stack the ${load.name} in the stores`, stow: stowStores };
    },
    boatPrompt() {
      if (!load) return undefined;
      return { text: `Put the ${load.name} in the boat`, act: stowBoat };
    },
    params(base) {
      if (!load) return base;
      return {
        ...base,
        walkSpeed: base.walkSpeed * CARRY_WALK,
        runSpeed: base.runSpeed * CARRY_RUN,
      };
    },
    get load() {
      return load && { good: load.good, qty: load.qty, hideout: load.hideout };
    },
    step(dt) {
      // A load left ashore when you went aboard goes back on the pile.
      if (load && !deps.standing()) {
        const h = states()[load.hideout];
        if (h) returnSalvage(h, load.qty, now());
        deps.notice(`You left the ${load.name} on the shore.`);
        load = undefined;
      }
      // Sailing out of a hideout's anchorage, or casting off its pier, saves (plan 09 §3).
      const home = deps.mooredAt() ?? refuge();
      if (wasHome && !home) deps.save();
      wasHome = home;
      spotClock += dt;
      if (spotClock >= SPOT_EVERY_S) {
        spotClock = 0;
        spot();
      }
    },
    dispose() {
      offSpotted();
      offZone();
    },
  };
}
