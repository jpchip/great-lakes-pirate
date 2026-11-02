import type { GameContext } from '../modes/context';
import { westernSuperiorChart } from '../sim/chart/chart-data';
import type { Contact } from '../sim/chart/traffic';
import type { EconomyDefs } from '../sim/economy/defs';
import {
  addRumor,
  hailRumor,
  noteHeardPrices,
  reliabilityBonus,
  saloonTerms,
  tellRumor,
  type RumorWorld,
  type SaloonTerms,
} from '../sim/rumors/rumors';
import type { SmugglerSpot } from '../sim/rumors/sources';
import type { TrafficDefs } from '../sim/traffic/cargo';
import type { Rumor } from '../sim/world-state';

/**
 * Rumors in play (plan 05 §9; Phase 4 piece K). In a port with a saloon, a round at the
 * bar buys a rumor drawn from the live sim, up to the day's talk; the Saloon Keeper's
 * first round is on the house and their talk runs truer (plan 12 §2.2). A price tip
 * writes its price into the ledger as heard; so does a hailed ship's news (piece D),
 * whose shipment tip goes in with the rumors.
 */

export interface RumorControl {
  /** What a round costs at this port's saloon now, and the talk left today. */
  terms(port: string): SaloonTerms;
  /** Buys a round: the rumor it brought, or why there was none. */
  buyRound(port: string): { ok: true; rumor: Rumor } | { ok: false; reason: string };
  dispose(): void;
}

export interface RumorControlOptions {
  ctx: GameContext;
  economy: EconomyDefs;
  traffic?: { defs: TrafficDefs; contacts: readonly Contact[] } | undefined;
  smugglerAnchorage?: (() => SmugglerSpot | undefined) | undefined;
}

export function attachRumors(opts: RumorControlOptions): RumorControl {
  const { ctx, economy } = opts;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const rumors = (): Rumor[] => ctx.state.knowledge.rumors;
  const background = () => ctx.state.player.captain.background;
  const world = (): RumorWorld => ({
    economy,
    markets: ctx.state.markets,
    traffic: opts.traffic,
    weather: { state: ctx.state.environment.weather, geo: westernSuperiorChart() },
    smugglerAnchorage: opts.smugglerAnchorage,
  });

  const offHail = ctx.events.on('ShipHailed', ({ shipId, news }) => {
    const t = now();
    if (news.prices) {
      noteHeardPrices(
        ctx.state.knowledge.prices,
        news.prices.port,
        news.prices.prices,
        news.prices.seenAt,
        'hail',
      );
    }
    const name = opts.traffic?.contacts.find((c) => c.id === shipId)?.name ?? 'ship';
    const rumor = hailRumor(news, name, t);
    if (rumor && !rumors().some((r) => r.draft === rumor.draft)) {
      addRumor(rumors(), rumor);
      ctx.events.emit('RumorHeard', { rumor, costCents: 0 });
    }
  });

  const terms = (port: string): SaloonTerms =>
    saloonTerms(economy, rumors(), port, now(), background());

  return {
    terms,
    buyRound(port) {
      const t = terms(port);
      if (t.roundsLeft <= 0) return { ok: false, reason: "The bar's talked out for today." };
      const player = ctx.state.player;
      if (player.purse < t.roundCents) return { ok: false, reason: "You haven't the money." };
      const told = tellRumor(world(), rumors(), port, now(), () => ctx.rng.next(), {
        reliabilityBonus: reliabilityBonus(background()),
      });
      // The run's RNG is saved with it (plan 16 §4.4): a reload doesn't replay the talk.
      ctx.state.environment.rng = ctx.rng.getState();
      if (!told) return { ok: false, reason: 'Nobody has anything new to tell.' };
      player.purse -= t.roundCents;
      addRumor(rumors(), told.rumor);
      if (told.price) {
        const p = told.price;
        noteHeardPrices(ctx.state.knowledge.prices, p.port, [p], p.seenAt, 'rumor');
      }
      ctx.events.emit('RumorHeard', { rumor: told.rumor, costCents: t.roundCents });
      return { ok: true, rumor: told.rumor };
    },
    dispose() {
      offHail();
    },
  };
}
