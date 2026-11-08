import type { EconomyDefs } from '../economy/defs';
import type { Manifest, ManifestLine } from '../traffic/cargo';
import type { TrafficState } from '../world-state';
import { SECONDS_PER_GAME_DAY } from '../../core/time';

/**
 * Robbed, sunk and disabled ships in the traffic slice (plan 07 §14.4 piece D, plan 16).
 * Ships are a pure function of the seed and the clock, so only what a pirate changed is
 * kept, by entity id (a consort's ends `.consort_N`): what was taken on which passage,
 * and the span a ship is off her timetable. `placeTraffic` and `runTraffic` read the span
 * off the contacts (`GameTraffic.syncLost`); the manifest reads the robbery here.
 */

type ShipRecords = TrafficState['ships'];
type ShipRecord = ShipRecords[string];

const recordFor = (ships: ShipRecords, id: string): ShipRecord => (ships[id] ??= {});

/** Her cash and her freight taken on a passage (`cycle`/`outbound` from her manifest). */
export function recordRobbed(
  ships: ShipRecords,
  id: string,
  at: number,
  taken: readonly ManifestLine[],
  cashCents: number,
  passage?: { cycle: number; outbound: boolean },
): void {
  const r = recordFor(ships, id);
  const prev = r.robbed;
  // Robbed twice on one passage: what was taken adds up.
  const same =
    prev && passage && prev.cycle === passage.cycle && prev.outbound === passage.outbound;
  const lines = same ? prev.taken.map((l) => ({ ...l })) : [];
  for (const t of taken) {
    if (t.qty <= 0) continue;
    const l = lines.find((x) => x.good === t.good);
    if (l) l.qty += t.qty;
    else lines.push({ good: t.good, qty: t.qty });
  }
  r.robbed = {
    at,
    ...(passage ? { cycle: passage.cycle, outbound: passage.outbound } : {}),
    taken: lines,
    cashCents: (same ? prev.cashCents : 0) + Math.max(0, Math.round(cashCents)),
  };
}

/** Takes her off the timetable from `at` for `days` game days (a day is a week). */
export function recordLost(
  ships: ShipRecords,
  id: string,
  at: number,
  how: 'sunk' | 'scuttled' | 'disabled',
  days: number,
): void {
  const r = recordFor(ships, id);
  r.lostAt = at;
  r.lostUntil = at + days * SECONDS_PER_GAME_DAY;
  r.lostHow = how;
}

/** Off her timetable for `seconds` (a disabled ship limping in). */
export function recordLimping(ships: ShipRecords, id: string, at: number, seconds: number): void {
  const r = recordFor(ships, id);
  r.lostAt = at;
  r.lostUntil = at + Math.max(0, seconds);
  r.lostHow = 'disabled';
}

export function lostNow(ships: ShipRecords, id: string, now: number): boolean {
  const r = ships[id];
  return !!r?.lostUntil && now < r.lostUntil && now >= (r.lostAt ?? -Infinity);
}

/** Whether she has been robbed on the passage she's on, or lately (her cash box is empty). */
export function robbedLately(
  ships: ShipRecords,
  id: string,
  now: number,
  robbedDays: number,
  passage?: { cycle: number; outbound: boolean },
): boolean {
  const r = ships[id]?.robbed;
  if (!r) return false;
  if (passage && r.cycle === passage.cycle && r.outbound === passage.outbound) return true;
  return now - r.at < robbedDays * SECONDS_PER_GAME_DAY;
}

/**
 * Her manifest, short what was taken from her (or her consort) on this passage. Other
 * passages are left alone: she loads afresh at her next port.
 */
export function afterRobbery(
  m: Manifest,
  ships: ShipRecords,
  contactId: string,
  economy: EconomyDefs,
): Manifest {
  const taken: ManifestLine[] = [];
  for (const [id, r] of Object.entries(ships)) {
    if (id !== contactId && !id.startsWith(`${contactId}.consort_`)) continue;
    const rob = r.robbed;
    if (!rob || rob.cycle !== m.cycle || rob.outbound !== m.outbound) continue;
    taken.push(...rob.taken);
  }
  if (taken.length === 0) return m;
  const cargo = m.cargo
    .map((l) => {
      const gone = taken.filter((t) => t.good === l.good).reduce((n, t) => n + t.qty, 0);
      return { good: l.good, qty: Math.max(0, l.qty - gone) };
    })
    .filter((l) => l.qty > 0);
  let valueCents = 0;
  for (const l of cargo) valueCents += (economy.goods.get(l.good)?.basePriceCents ?? 0) * l.qty;
  return { ...m, cargo, valueCents };
}
