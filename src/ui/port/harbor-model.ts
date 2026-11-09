import { formatCents } from '../../sim/economy/knowledge';
import { fameTier, fameTierName, wantedTierName, type LawDefs } from '../../sim/law/defs';
import { heatIn, tierIn } from '../../sim/law/law';
import {
  harborTerms,
  informChance,
  posterFor,
  holdChecked,
  type HarborDeal,
} from '../../sim/law/port-law';
import type { LawState } from '../../sim/law/state';
import { riskWord } from '../../sim/economy/contraband';
import { durationText } from '../chart/text';

/**
 * What the port law shows (plan 06 §3, plan 13 §12; Phase 5 piece E): the harbor master's
 * tab, the WANTED poster, Fame and Wanted in the ledger, and the HUD's Wanted indicator
 * and report eye. Plain data from the law's state, so the wording is tested without a DOM.
 */

/** A WANTED poster, as the harbor master's board shows it. */
export interface PosterSnapshot {
  tier: number;
  headline: string;
  /** "The schooner Lark" or "Captain Ada Reid". */
  subject: string;
  /** "Master: Captain Ada Reid", or "Of the schooner Lark". */
  detail: string;
  /** "For crimes against the law in Chequamegon Bay". */
  charge: string;
  /** "$300 reward", or undefined below the bounty tier. */
  rewardText: string | undefined;
}

export interface HarborQuoteRow {
  kind: HarborDeal;
  cents: number;
  /** "Pay the fine" or "Grease his palm". */
  label: string;
  /** "Clears your name in Chequamegon Bay." */
  effect: string;
  affordable: boolean;
}

/** The harbor master's tab (plan 06 §3.3, §5.2). */
export interface HarborSnapshot {
  region: string;
  regionName: string;
  tier: number;
  tierName: string;
  heat: number;
  /** The tier's band, for the heat bar: where it starts and where the next begins. */
  tierFrom: number;
  tierTo: number | undefined;
  /** What he'll take, or why he won't. */
  quote: HarborQuoteRow | undefined;
  refusalText: string | undefined;
  /** Reports on their way to this region. */
  reportsComing: number;
  /** Docking here means a check of the hold. */
  holdChecked: boolean;
  /** "some risk" a receiver turns you in here; undefined below the tier. */
  informRisk: string | undefined;
  poster: PosterSnapshot | undefined;
  /** The Saloon Keeper's discount applied. */
  saloonKeeper: boolean;
}

/** The HUD's regional Wanted indicator (plan 13 §4.1). */
export interface WantedSnapshot {
  regionName: string;
  tier: number;
  tierName: string;
  /** The top tier: capture means the rope. */
  top: boolean;
}

/** The report eye: the soonest report on its way, with its timer (plan 06 §2.4). */
export interface ReportSnapshot {
  by: string;
  regionName: string;
  /** "1 h 40 m" of game time. */
  etaText: string;
  /** Reports on their way besides this one. */
  more: number;
  /** Only "someone" was seen: it raises the guard, not the tier. */
  vague: boolean;
}

/** Fame and Wanted in the ledger (plan 13 §12). */
export interface LedgerLawSnapshot {
  fameTier: number;
  fameTierName: string;
  fame: number;
  /** Regions with any heat, hottest first. */
  wanted: { region: string; name: string; tier: number; tierName: string; heat: number }[];
  /** Reports on their way, soonest first. */
  reports: { id: string; text: string }[];
  /**
   * Companies that bear you a grudge, deepest first (Phase 6 piece F): `shunned` when their
   * agents won't deal with you.
   */
  grudges?: { id: string; name: string; value: number; shunned: boolean }[] | undefined;
  /** Wrecks on the lake, newest first (Phase 6 piece F). */
  wrecks?: { id: string; text: string; yours: boolean }[] | undefined;
}

/** What the ledger's law page shows beside the law itself (Phase 6 piece F). */
export interface LedgerLawExtra {
  grudges?: Record<string, number> | undefined;
  companyName?(id: string): string | undefined;
  refuseFrom?: number | undefined;
  wrecks?: readonly { id: string; lore: string; byPlayer: boolean }[] | undefined;
}

export interface LawViewSources {
  defs: LawDefs;
  law: LawState;
  gameSeconds: number;
  shipName: string;
  captainName: string;
}

export function regionName(defs: LawDefs, region: string): string {
  return defs.regionById.get(region)?.name ?? region;
}

export function posterSnapshot(src: LawViewSources, region: string): PosterSnapshot | undefined {
  const p = posterFor(src.defs, src.law, region);
  if (!p) return undefined;
  const ship = `The schooner ${src.shipName}`;
  const captain = `Captain ${src.captainName}`;
  return {
    tier: p.tier,
    headline: p.headline,
    subject: p.subject === 'ship' ? ship : captain,
    detail: p.subject === 'ship' ? `Master: ${captain}` : `Of the schooner ${src.shipName}`,
    charge: `For crimes against the law in ${regionName(src.defs, region)}`,
    rewardText: p.rewardCents > 0 ? `${formatCents(p.rewardCents)} reward` : undefined,
  };
}

const TOO_NOTORIOUS =
  "He won't take your money. Your name's gone too far for that: the marshals want you, and the rope.";

export function harborSnapshot(
  src: LawViewSources,
  region: string,
  purseCents: number,
  saloonKeeper: boolean,
): HarborSnapshot {
  const { defs, law } = src;
  const terms = harborTerms(defs, law, region, saloonKeeper);
  const name = regionName(defs, region);
  const tiers = defs.wanted.tiers;
  const q = terms.quote;
  const crimes = new Map(law.reports.crimes.map((c) => [c.id, c.region]));
  const inform = informChance(defs, terms.tier);
  return {
    region,
    regionName: name,
    tier: terms.tier,
    tierName: wantedTierName(defs, terms.tier),
    heat: Math.round(terms.heat),
    tierFrom: tiers[terms.tier]?.minHeat ?? 0,
    tierTo: tiers[terms.tier + 1]?.minHeat,
    quote: q && {
      kind: q.kind,
      cents: q.cents,
      label: q.kind === 'fine' ? 'Pay the fine' : 'Grease his palm',
      effect:
        q.kind === 'fine'
          ? `Clears your name in ${name}.`
          : `Takes you down to ${wantedTierName(defs, q.toTier)} in ${name}.`,
      affordable: purseCents >= q.cents,
    },
    refusalText:
      terms.refusal === 'clean'
        ? `Nothing on the books against you in ${name}. He nods you through.`
        : terms.refusal === 'tooNotorious'
          ? TOO_NOTORIOUS
          : undefined,
    reportsComing: law.reports.inProgress.filter((r) => crimes.get(r.crimeId) === region).length,
    holdChecked: holdChecked(defs, terms.tier),
    informRisk: inform > 0 ? riskWord(inform) : undefined,
    poster: posterSnapshot(src, region),
    saloonKeeper,
  };
}

/** The HUD's indicator for the region the ship is in. */
export function wantedSnapshot(
  defs: LawDefs,
  law: LawState,
  region: string | undefined,
): WantedSnapshot | undefined {
  if (!region) return undefined;
  const tier = tierIn(defs, law, region);
  return {
    regionName: regionName(defs, region),
    tier,
    tierName: wantedTierName(defs, tier),
    top: tier >= defs.wanted.tiers.length - 1,
  };
}

/** The soonest report on its way, for the eye; undefined with none. */
export function reportSnapshot(
  defs: LawDefs,
  law: LawState,
  gameSeconds: number,
): ReportSnapshot | undefined {
  const pending = [...law.reports.inProgress].sort((a, b) => a.eta - b.eta);
  const r = pending[0];
  if (!r) return undefined;
  const crime = law.reports.crimes.find((c) => c.id === r.crimeId);
  return {
    by: r.witness.name,
    regionName: crime ? regionName(defs, crime.region) : '?',
    etaText: durationText(Math.max(0, r.eta - gameSeconds)),
    more: pending.length - 1,
    vague: r.identification === 'unknown',
  };
}

export function ledgerLawSnapshot(
  defs: LawDefs,
  law: LawState,
  gameSeconds: number,
  extra: LedgerLawExtra = {},
): LedgerLawSnapshot {
  const ft = fameTier(defs, law.fame.value);
  const wanted = Object.keys(law.wanted)
    .map((region) => {
      const heat = heatIn(law, region);
      const tier = tierIn(defs, law, region);
      return {
        region,
        name: regionName(defs, region),
        tier,
        tierName: wantedTierName(defs, tier),
        heat: Math.round(heat),
      };
    })
    .filter((w) => w.heat > 0)
    .sort((a, b) => b.heat - a.heat || a.name.localeCompare(b.name));
  const crimes = new Map(law.reports.crimes.map((c) => [c.id, c.region]));
  const reports = [...law.reports.inProgress]
    .sort((a, b) => a.eta - b.eta)
    .map((r) => {
      const region = crimes.get(r.crimeId);
      return {
        id: r.id,
        text: `${r.witness.name[0]?.toUpperCase() ?? ''}${r.witness.name.slice(1)}, to ${
          region ? regionName(defs, region) : 'the law'
        }: in ${durationText(Math.max(0, r.eta - gameSeconds))}`,
      };
    });
  return {
    fameTier: ft,
    fameTierName: fameTierName(defs, ft),
    fame: Math.round(law.fame.value),
    wanted,
    reports,
    grudges: Object.entries(extra.grudges ?? {})
      .filter(([, v]) => v >= 1)
      .sort((a, b) => b[1] - a[1])
      .map(([id, v]) => ({
        id,
        name: extra.companyName?.(id) ?? id,
        value: Math.round(v),
        shunned: v >= (extra.refuseFrom ?? Infinity),
      })),
    wrecks: [...(extra.wrecks ?? [])]
      .reverse()
      .map((w) => ({ id: w.id, text: w.lore, yours: w.byPlayer })),
  };
}
