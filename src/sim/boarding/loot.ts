import type { BoardingRules } from '../../../data/schemas/boarding';
import type { EconomyDefs } from '../economy/defs';
import { holdFree, type Hold } from '../economy/hold';
import type { ManifestLine } from '../traffic/cargo';

/**
 * Looting a taken ship (plan 07 §7.1; Phase 6 piece D): a transfer screen on the market's
 * pattern, her manifest against your hold. Valuables are listed first, then bulk; each CU
 * swung across takes game time by its category, and her cash box a few minutes. A quick
 * grab takes the cash and the valuables that fit at once. Everything taken is hot, with
 * the owning company's marks on it. Pure over the prize and the player's hold and purse.
 */

export interface LootLot {
  /** `cash` for her cash box, otherwise the good's id. */
  key: string;
  good?: string;
  name: string;
  category: string;
  /** CU still aboard her (the cash box: 1 until taken). */
  qty: number;
  /** The cash box's money, cents. */
  cents?: number;
  /** Game minutes to take one CU (or the whole box). */
  minutesPerCu: number;
  /** A quick grab takes it. */
  quick: boolean;
  /** Its worth at base prices a CU, cents (the box: its cash). */
  unitCents: number;
}

export interface Prize {
  /** Her entity id (a consort's ends `.consort_N`). */
  shipId: string;
  owner: string | undefined;
  /** The Wanted region she was taken in: the hot goods' region. */
  region: string;
  /** Game seconds she was taken: every lot off her is stolen then. */
  since: number;
  lots: LootLot[];
  /** What's come across so far. */
  taken: ManifestLine[];
  cashCents: number;
  /** Game minutes spent at it. */
  minutes: number;
}

export function createPrize(
  rules: BoardingRules,
  economy: EconomyDefs,
  p: {
    shipId: string;
    owner: string | undefined;
    region: string;
    now: number;
    cargo: readonly ManifestLine[];
    cashCents: number;
  },
): Prize {
  const order = rules.loot.order;
  const rank = (cat: string): number => {
    const i = order.indexOf(cat);
    return i < 0 ? order.length : i;
  };
  const lots: LootLot[] = [];
  for (const line of p.cargo) {
    if (line.qty <= 0) continue;
    const g = economy.goods.get(line.good);
    const category = g?.category ?? 'bulk';
    const same = lots.find((l) => l.good === line.good);
    if (same) {
      same.qty += line.qty;
      continue;
    }
    lots.push({
      key: line.good,
      good: line.good,
      name: g?.name ?? line.good,
      category,
      qty: line.qty,
      minutesPerCu: rules.loot.minutesPerCu[category] ?? 4,
      quick: rules.loot.quickGrab.includes(category),
      unitCents: g?.basePriceCents ?? 0,
    });
  }
  // Valuables first, then the dearest of each kind.
  lots.sort((a, b) => rank(a.category) - rank(b.category) || b.unitCents - a.unitCents);
  if (p.cashCents > 0) {
    lots.unshift({
      key: 'cash',
      name: 'Her cash box',
      category: 'cash',
      qty: 1,
      cents: p.cashCents,
      minutesPerCu: rules.loot.cashBoxMinutes,
      quick: true,
      unitCents: p.cashCents,
    });
  }
  return {
    shipId: p.shipId,
    owner: p.owner,
    region: p.region,
    since: p.now,
    lots,
    taken: [],
    cashCents: 0,
    minutes: 0,
  };
}

export type LootRefusal = 'gone' | 'noRoom' | 'badQty';

export type LootResult =
  | { ok: true; key: string; qty: number; cents: number; minutes: number }
  | { ok: false; reason: LootRefusal };

/** The player's side: the hold, its size and the purse. */
export interface Looter {
  cargo: Hold;
  purse: number;
}

/** Puts `qty` CU of a stolen good in the hold, with this robbery's other lots of it. */
function stow(
  economy: EconomyDefs,
  rules: BoardingRules,
  prize: Prize,
  hold: Hold,
  good: string,
  qty: number,
): void {
  const same = hold.find(
    (s) => s.good === good && s.hot && s.hot.since === prize.since && s.hot.owner === prize.owner,
  );
  if (same) {
    same.qty += qty;
    return;
  }
  hold.push({
    good,
    qty,
    hot: {
      region: prize.region,
      heat: rules.loot.heat,
      traceability: economy.goods.get(good)?.traceability ?? 0.5,
      since: prize.since,
      ...(prize.owner ? { owner: prize.owner } : {}),
    },
  });
}

/** Swings `qty` CU of a lot across (or takes her cash box), as far as the hold has room. */
export function takeLot(
  rules: BoardingRules,
  economy: EconomyDefs,
  prize: Prize,
  you: Looter,
  capacity: number,
  key: string,
  qty: number,
  instant = false,
): LootResult {
  const lot = prize.lots.find((l) => l.key === key);
  if (!lot || lot.qty <= 0) return { ok: false, reason: 'gone' };
  if (!(qty > 0)) return { ok: false, reason: 'badQty' };
  if (key === 'cash') {
    const cents = lot.cents ?? 0;
    lot.qty = 0;
    you.purse += cents;
    prize.cashCents += cents;
    const minutes = instant ? 0 : lot.minutesPerCu;
    prize.minutes += minutes;
    return { ok: true, key, qty: 1, cents, minutes };
  }
  const n = Math.min(Math.floor(qty), lot.qty, holdFree(you.cargo, capacity));
  if (n <= 0) return { ok: false, reason: 'noRoom' };
  lot.qty -= n;
  stow(economy, rules, prize, you.cargo, lot.good ?? key, n);
  const line = prize.taken.find((l) => l.good === lot.good);
  if (line) line.qty += n;
  else prize.taken.push({ good: lot.good ?? key, qty: n });
  const minutes = instant ? 0 : lot.minutesPerCu * n;
  prize.minutes += minutes;
  return { ok: true, key, qty: n, cents: 0, minutes };
}

/** A quick grab (§7.1): the cash box and the valuables that fit, at once. */
export function quickGrab(
  rules: BoardingRules,
  economy: EconomyDefs,
  prize: Prize,
  you: Looter,
  capacity: number,
): Extract<LootResult, { ok: true }>[] {
  const out: Extract<LootResult, { ok: true }>[] = [];
  for (const lot of prize.lots) {
    if (!lot.quick || lot.qty <= 0) continue;
    const r = takeLot(rules, economy, prize, you, capacity, lot.key, lot.qty, true);
    if (r.ok) out.push(r);
  }
  return out;
}

/** Game minutes it would take to clear a lot into the hold as it stands. */
export function minutesFor(prize: Prize, key: string, qty: number): number {
  const lot = prize.lots.find((l) => l.key === key);
  if (!lot) return 0;
  return key === 'cash' ? lot.minutesPerCu : lot.minutesPerCu * Math.min(qty, lot.qty);
}

/** What she still carries, for the record and her manifest. */
export function leftAboard(prize: Prize): ManifestLine[] {
  return prize.lots
    .filter((l) => l.good && l.qty > 0)
    .map((l) => ({ good: l.good as string, qty: l.qty }));
}
