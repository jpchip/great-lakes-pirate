import type { Fence } from '../../data/schemas/fences';
import type { GameContext } from '../modes/context';
import {
  fenceAccess,
  fenceAt,
  freshFenceState,
  gameFences,
  restockFence,
  sellToFence,
  type FenceSaleRefusal,
  type FenceState,
} from '../sim/economy/fence';
import { formatCents } from '../sim/economy/knowledge';
import { freshContrabandState } from '../sim/economy/smuggler';
import { fameTier, fameTierName, gameLaw, type LawDefs } from '../sim/law/defs';
import { backRoomSnapshot, type BackRoomSnapshot } from '../ui/port/back-room-model';
import { buyGun, gameGuns, gunPriceCents, gunRefusal, type GunRefusal } from '../sim/shipyard/guns';
import { yardSnapshot } from '../ui/port/shipyard-model';
import type { GameEconomy } from './economy';
import type { GameShipyard } from './shipyard';

const GUN_REFUSALS: Record<GunRefusal, string> = {
  fame: "He doesn't see captains nobody's heard of.",
  hull: "She's too small to carry it.",
  noMoney: "You haven't the money.",
  wrongMount: "That gun doesn't go there.",
  noRoom: 'No room left for another of those.',
  unknownWeapon: "He doesn't have that.",
};

/**
 * A port's back room after dark (plan 05 §6.2, plan 10 §6; Phase 6 piece E, decision 1 of
 * plan 07 §14.6). Until the docks districts are walkable (Phase 7) it's a tab on the port
 * screen: at Bayfield from the start, at Duluth once you're Known, and only while the sun
 * is down. The fence buys hot goods and contraband with no detection risk; the shady
 * shipwright in the same room sells the guns, the gun work and the rifle, fitted that
 * night (his hours pass at the screen like the yard's). At high Wanted the fence may sell
 * you out: the law's roll on `FenceDealt` (`gameplay/law.ts`).
 */
export interface BackRoom {
  /** The fence at a port, open to you now or not. */
  fenceAt(port: string): Fence | undefined;
  /** Whether the back room at a port is open to you now. */
  isOpen(port: string): boolean;
  /** The tab, when it's open; the shipwright's gear included when there's a shipyard to fit it. */
  snapshot(port: string): BackRoomSnapshot | undefined;
  /** A line for the saloon tab when the room is shut to you: "after dark", or nothing. */
  hint(port: string): string | undefined;
  /** Sells `qty` CU of a lot to the fence: the refusal, or what came of it, in a line. */
  sell(port: string, index: number, qty: number): string;
  /** Mounts a gun from the shipwright: the refusal, or what came of it, in a line. */
  buyGun(port: string, gunId: string): string;
  /** The captain's Fame tier now. */
  fameTier(): number;
}

export interface BackRoomOptions {
  ctx: GameContext;
  economy: GameEconomy;
  /** The shipyard, for the shady shipwright's fittings; without it he has nothing to show. */
  shipyard?: GameShipyard | undefined;
  /** "some risk" he informs, by the port's Wanted tier (port law); undefined below tier 2. */
  informRisk?: ((port: string) => string | undefined) | undefined;
  law?: LawDefs;
  fences?: readonly Fence[];
}

const REFUSALS: Record<Exclude<FenceSaleRefusal, 'open'>, string> = {
  day: 'The back room is shut till dark.',
  fame: "He doesn't see captains nobody's heard of.",
  badLot: 'That lot is gone.',
  badQty: 'Choose how many CU.',
  noCash: "He hasn't the cash left for that this week.",
  clean: 'Clean goods: he says sell them at the market.',
  contract: "A company's freight: he won't touch it.",
  unknown: "He doesn't deal in that.",
};

export function attachBackRoom(opts: BackRoomOptions): BackRoom {
  const { ctx, economy } = opts;
  const law = opts.law ?? gameLaw();
  const fences = opts.fences ?? gameFences();
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const tier = (): number => fameTier(law, ctx.state.fame.value);
  const stateOf = (fence: Fence): FenceState => {
    const c = (ctx.state.contraband ??= freshContrabandState(now()));
    const all = (c.fences ??= {});
    return (all[fence.id] ??= freshFenceState(fence, now()));
  };
  const at = (port: string): Fence | undefined => fenceAt(port, fences);
  const open = (port: string): Fence | undefined => {
    const f = at(port);
    return f && fenceAccess(f, tier(), now()) === 'open' ? f : undefined;
  };

  return {
    fenceAt: at,
    isOpen: (port) => !!open(port),
    fameTier: tier,
    snapshot(port) {
      const f = open(port);
      if (!f) return undefined;
      const state = stateOf(f);
      restockFence(f, state, now());
      const snap = backRoomSnapshot(economy.defs, f, state, ctx.state.player, now(), tier());
      snap.informRisk = opts.informRisk?.(port);
      if (f.shipwright && opts.shipyard) {
        const sy = opts.shipyard;
        sy.sync();
        snap.guns = gameGuns().map((g) => {
          const why = gunRefusal(economy.defs, ctx.state.player, sy.ship, g, port, tier());
          return {
            id: g.id,
            name: g.name,
            blurb: g.blurb,
            priceCents: gunPriceCents(economy.defs, port, g),
            where: g.mounts.includes('bow')
              ? 'In the bow'
              : g.mounts.length > 1
                ? 'Port and starboard'
                : 'Amidships',
            refusal: why ? GUN_REFUSALS[why] : undefined,
          };
        });
        snap.shipwright = yardSnapshot({
          defs: economy.defs,
          markets: ctx.state.markets,
          owner: ctx.state.player,
          ship: opts.shipyard.ship,
          shipName: ctx.state.player.captain.shipName,
          port,
          place: 'backRoom',
          gameSeconds: now(),
          fameTier: tier(),
          fameName: (t) => fameTierName(law, t),
        });
      }
      return snap;
    },
    hint(port) {
      const f = at(port);
      if (!f) return undefined;
      const access = fenceAccess(f, tier(), now());
      // Nobody tells a captain nobody's heard of that the room is there.
      if (access !== 'day') return undefined;
      return `There's a back room here that opens after dark, if you've something to sell that you'd rather not show at the market.`;
    },
    buyGun(port, gunId) {
      const sy = opts.shipyard;
      if (!sy || !open(port)) return 'The shipwright is shut.';
      sy.sync();
      const r = buyGun(economy.defs, ctx.state.player, sy.ship, port, gunId, tier());
      if (!r.ok) return GUN_REFUSALS[r.reason as GunRefusal] ?? "He won't do that.";
      sy.refit();
      ctx.events.emit('GunBought', r.event);
      return `Mounted: she's armed. He takes ${formatCents(r.event.cents)} and says nothing.`;
    },
    sell(port, index, qty) {
      const f = at(port);
      if (!f) return 'There is no back room here.';
      const r = sellToFence(
        economy.defs,
        f,
        stateOf(f),
        ctx.state.player,
        index,
        qty,
        now(),
        tier(),
      );
      if (!r.ok) return REFUSALS[r.reason];
      economy.syncLoad();
      ctx.events.emit('FenceDealt', r.event);
      const name = economy.defs.goods.get(r.event.good)?.name.toLowerCase() ?? 'goods';
      return `${r.event.qty} CU of ${name} go out the back door; he counts out ${formatCents(r.event.totalCents)}.`;
    },
  };
}
