import type { GameContext } from '../modes/context';
import { gameContracts } from '../sim/economy/contracts';
import { detectionChance, offerKind, riskWord } from '../sim/economy/contraband';
import { portInfo } from '../sim/economy/defs';
import type { CargoStack } from '../sim/economy/hold';
import { formatCents } from '../sim/economy/knowledge';
import { tierIn } from '../sim/law/law';
import {
  informChance,
  payHarborMaster,
  searchFactor,
  searchRoll,
  type HarborDeal,
  type HarborRefusal,
} from '../sim/law/port-law';
import { regionOfPort } from '../sim/law/regions';
import type { Witness } from '../sim/law/witness';
import {
  harborSnapshot,
  ledgerLawSnapshot,
  posterSnapshot,
  regionName,
  reportSnapshot,
  wantedSnapshot,
  type HarborSnapshot,
  type LawViewSources,
  type LedgerLawSnapshot,
  type PosterSnapshot,
  type ReportSnapshot,
  type WantedSnapshot,
} from '../ui/port/harbor-model';
import { runSeed, type GameEconomy } from './economy';
import { emitLaw, type GameLaw } from './law';

/**
 * Port law in the running game (plan 06 §3.3, §5.2; Phase 5 piece E):
 *
 * - **The harbor master** at every port takes a fine (tiers 1–2) or a bribe (3–4) for the
 *   port's region, from the purse, raising `HarborMasterPaid`.
 * - **Docking at tier 2+** means his men go through the hold (`dockCheck`, called when the
 *   ship docks, not when the screen is reopened). Each hot or contraband lot is found by
 *   the merchants' own odds (plan 05 §23) times the tier's search factor; what's found is
 *   taken, and it's a crime he witnesses himself, filed at once. `HoldSearched` either way.
 * - **Receivers inform** at tier 2+: the economy's `informChance` reads the port's tier.
 *   The smuggler's informing is in `gameplay/law.ts`, on the deal itself.
 * - The HUD, the chart, the ledger and the smuggler's screen read their law lines here.
 */
export interface PortLaw {
  /** The port's Wanted region (ports.json `wantedRegion`). */
  regionOf(port: string): string | undefined;
  /** The harbor master's tab at a port; undefined where there's no region. */
  harbor(port: string): HarborSnapshot | undefined;
  /** Pays the fine or bribe on offer: the refusal, or what came of it, in a line. */
  pay(port: string, kind: HarborDeal): string;
  /** The search on docking: notices for the port screen (none below tier 2). */
  dockCheck(port: string): string[];
  poster(port: string): PosterSnapshot | undefined;
  /** "some risk" your receiver (or the smuggler) turns you in, in a region; or undefined. */
  informRisk(region: string): string | undefined;
  /** The port lies in a Most Wanted region: docking there asks first. */
  topTierAt(port: string): boolean;
  /**
   * Why they won't sell you a restricted good (black powder) here: with a WANTED poster up
   * in the port's region (tier 2+; plan 06, Phase 6 piece E). Undefined when they will.
   */
  restricted(port: string, good: string): string | undefined;
  wanted(region: string | undefined): WantedSnapshot | undefined;
  report(): ReportSnapshot | undefined;
  ledger(): LedgerLawSnapshot;
  /** Regions with a tier, for the chart. */
  marks(): { region: string; label: string; tier: number }[];
}

const PAY_REFUSALS: Record<HarborRefusal, string> = {
  clean: 'He has nothing against you.',
  tooNotorious: "He won't take your money. Your name's gone too far for that.",
  noMoney: "You haven't the money.",
  notOffered: 'He wants something else now: look again.',
};

/** The harbor master himself: he saw what his men found. */
function harborMasterAt(port: string): Witness {
  return {
    id: `harbor.${port}`,
    kind: 'harborMaster',
    name: 'the harbor master',
    identification: 'person',
  };
}

/** Restricted goods (black powder) aren't sold to you from this Wanted tier (the poster's). */
export const RESTRICTED_FROM_TIER = 2;

const lotKey = (s: CargoStack): string => `${s.good}|${s.hot?.since ?? 'contraband'}`;

export function attachPortLaw(ctx: GameContext, law: GameLaw, economy: GameEconomy): PortLaw {
  const { defs } = law;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const saloonKeeper = (): boolean => ctx.state.player.captain.background === 'saloon_keeper';
  const view = (): LawViewSources => ({
    defs,
    law: ctx.state,
    gameSeconds: now(),
    shipName: ctx.state.player.captain.shipName,
    captainName: ctx.state.player.captain.name,
  });
  const regionOf = (port: string): string | undefined => {
    const r = regionOfPort(port);
    return r && defs.regionById.has(r) ? r : undefined;
  };
  const tierAt = (region: string): number => tierIn(defs, ctx.state, region);

  economy.informChance = (port) => {
    const region = regionOf(port);
    return region ? informChance(defs, tierAt(region)) : 0;
  };

  const goodName = (good: string): string =>
    (economy.defs.goods.get(good)?.name ?? good).toLowerCase();

  return {
    regionOf,
    harbor(port) {
      const region = regionOf(port);
      if (!region) return undefined;
      return harborSnapshot(view(), region, ctx.state.player.purse, saloonKeeper());
    },
    pay(port, kind) {
      const region = regionOf(port);
      if (!region) return 'There is no harbor master here.';
      const r = payHarborMaster(defs, ctx.state, ctx.state.player, region, kind, saloonKeeper());
      if (!r.ok) return PAY_REFUSALS[r.reason];
      for (const e of r.events) emitLaw(ctx, e);
      ctx.events.emit('HarborMasterPaid', {
        port,
        region,
        kind,
        cents: r.quote.cents,
        heatFrom: r.heatFrom,
        heatTo: r.quote.toHeat,
      });
      const name = regionName(defs, region);
      return kind === 'fine'
        ? `Fine paid, ${formatCents(r.quote.cents)}. The book is clean in ${name}.`
        : `${formatCents(r.quote.cents)} changes hands, and some pages of the book go missing.`;
    },
    dockCheck(port) {
      const region = regionOf(port);
      if (!region) return [];
      const tier = tierAt(region);
      const factor = searchFactor(defs, tier);
      if (factor <= 0) return [];
      const cargo = ctx.state.player.cargo;
      const found: { good: string; qty: number; kind: 'hot' | 'contraband' }[] = [];
      for (let i = cargo.length - 1; i >= 0; i--) {
        const s = cargo[i] as CargoStack;
        const kind = offerKind(economy.defs, s);
        if (!kind) continue;
        const chance = Math.min(0.95, detectionChance(economy.defs, s, port, now()) * factor);
        if (searchRoll(runSeed(ctx), port, now(), lotKey(s)) >= chance) continue;
        found.push({ good: s.good, qty: s.qty, kind });
        cargo.splice(i, 1);
      }
      if (found.length) economy.syncLoad();
      ctx.events.emit('HoldSearched', {
        port,
        region,
        tier,
        found: found.map(({ good, qty }) => ({ good, qty })),
      });
      for (const kind of ['contraband', 'hot'] as const) {
        if (!found.some((f) => f.kind === kind)) continue;
        law.commit({
          crime: kind === 'contraband' ? 'crime.contraband' : 'crime.hot_goods',
          region,
          port,
          witnesses: [harborMasterAt(port)],
        });
      }
      const where = portInfo(port)?.name ?? port;
      if (found.length === 0) {
        return [`The harbor master's men went through your hold at ${where}. They found nothing.`];
      }
      const what = found.map((f) => `${f.qty} CU of ${goodName(f.good)}`).join(' and ');
      return [
        `The harbor master's men went through your hold at ${where} and took ${what}. It goes on your record.`,
      ];
    },
    poster(port) {
      const region = regionOf(port);
      return region ? posterSnapshot(view(), region) : undefined;
    },
    informRisk(region) {
      const p = informChance(defs, tierAt(region));
      return p > 0 ? riskWord(p) : undefined;
    },
    restricted(port, good) {
      if (economy.defs.goods.get(good)?.legal !== 'restricted') return undefined;
      const region = regionOf(port);
      if (!region || tierAt(region) < RESTRICTED_FROM_TIER) return undefined;
      return "Not with your face on the harbor master's board. Nobody here will sell you powder.";
    },
    topTierAt(port) {
      const region = regionOf(port);
      return !!region && tierAt(region) >= defs.wanted.tiers.length - 1;
    },
    wanted: (region) => wantedSnapshot(defs, ctx.state, region),
    report: () => reportSnapshot(defs, ctx.state, now()),
    ledger: () =>
      ledgerLawSnapshot(defs, ctx.state, now(), {
        grudges: ctx.state.player.grudges,
        companyName: (id) => gameContracts().companies.get(id)?.name,
        refuseFrom: defs.actors.companies.refuseContractsFrom,
        wrecks: ctx.state.wrecks?.list,
      }),
    marks() {
      const out: { region: string; label: string; tier: number }[] = [];
      for (const region of Object.keys(ctx.state.wanted)) {
        const w = wantedSnapshot(defs, ctx.state, region);
        if (!w || w.tier < 1) continue;
        out.push({
          region,
          tier: w.tier,
          label: w.top ? `${w.regionName}: MOST WANTED` : `${w.regionName}: ${w.tierName}`,
        });
      }
      return out;
    },
  };
}
