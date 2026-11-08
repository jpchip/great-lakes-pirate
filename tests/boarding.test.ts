import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import {
  adriftDeathChance,
  previewAftermath,
  resolveAftermath,
} from '../src/sim/boarding/aftermath';
import {
  alongside,
  boardingOdds,
  boardRefusal,
  gameBoarding,
  resolveBoarding,
  type BoardedShip,
  type BoardingSide,
} from '../src/sim/boarding/check';
import { createPrize, minutesFor, quickGrab, takeLot } from '../src/sim/boarding/loot';
import {
  afterRobbery,
  lostNow,
  recordLost,
  recordRobbed,
  robbedLately,
} from '../src/sim/boarding/record';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { isLostAt, placeTraffic } from '../src/sim/chart/routes';
import { createContacts } from '../src/sim/chart/traffic';
import { gameEconomy } from '../src/sim/economy/defs';
import { holdUsed, type Hold } from '../src/sim/economy/hold';
import { createMarkets } from '../src/sim/economy/market';
import { SHIP_RECORDS } from '../src/sim/sailing/ships';
import { currentManifest, gameTraffic, runTraffic, type Manifest } from '../src/sim/traffic/cargo';
import type { TrafficState } from '../src/sim/world-state';

const rules = gameBoarding();
const economy = gameEconomy();

const steamer = SHIP_RECORDS.find((r) => r.id === 'ship.package_steamer');
const tug = SHIP_RECORDS.find((r) => r.id === 'ship.fish_tug');

/** A T2 with her swivel and four cannon run out. */
const t2 = (fameTier: number, extra: Partial<BoardingSide> = {}): BoardingSide => ({
  tier: 2,
  swivels: 1,
  cannon: 4,
  fameTier,
  perks: [],
  dark01: 0,
  ...extra,
});

const ship = (over: Partial<BoardedShip> = {}): BoardedShip => ({
  crew: steamer?.combat?.crew ?? 16,
  wounded: 0,
  armed: false,
  morale: steamer?.combat?.moraleBase ?? 70,
  struck: false,
  ...over,
});

describe('getting alongside (plan 07 §6.1)', () => {
  it('grapples only close aboard and under 2 kn relative', () => {
    expect(alongside(rules, 10, 1.5)).toBeUndefined();
    expect(alongside(rules, 80, 0.5)).toBe('notAlongside');
    expect(alongside(rules, 10, 3)).toBe('tooFast');
  });

  it('keeps a T1 off a resisting crew, and says why', () => {
    const resisting = { struck: false, robbed: false, sinking: false, target: true };
    expect(boardRefusal(1, resisting)).toBe('soloResisting');
    expect(boardRefusal(1, { ...resisting, struck: true })).toBeUndefined();
    expect(boardRefusal(2, resisting)).toBeUndefined();
    expect(boardRefusal(2, { ...resisting, robbed: true })).toBe('stripped');
    expect(boardRefusal(2, { ...resisting, sinking: true })).toBe('sinking');
    expect(boardRefusal(2, { ...resisting, target: false })).toBe('notATarget');
  });
});

describe('the boarding check (plan 07 §6.2, §14.3 criterion 2)', () => {
  it('confirms a ship that has struck: Intimidate cannot fail', () => {
    const o = boardingOdds(
      rules,
      { ...t2(0), tier: 1, swivels: 0, cannon: 0 },
      ship({ struck: true }),
    );
    expect(o.intimidate).toBe(1);
  });

  it('lets a T2 take a package steamer by intimidation at medium Fame, after warning shots', () => {
    // Known (tier 2), her nerve shaken to 45 by three or four shots across her bow.
    const known = boardingOdds(rules, t2(2), ship({ morale: 45 }));
    expect(known.intimidate).toBeGreaterThan(0.6);
    // Unknown, and she hasn't been shown a gun: she won't give in to talk.
    const nobody = boardingOdds(rules, t2(0), ship());
    expect(nobody.intimidate).toBeLessThan(0.3);
    expect(known.intimidate).toBeGreaterThan(nobody.intimidate + 0.3);
  });

  it('makes Fight likelier than Intimidate, with no death chance at good odds', () => {
    const o = boardingOdds(rules, t2(0), ship());
    expect(o.fight).toBeGreaterThan(o.intimidate);
    expect(o.fight).toBeGreaterThan(0.5);
    expect(o.death).toBe(0);
  });

  it('shows a small death chance at bad odds, never more than the cap', () => {
    // A T2 with no guns, unknown, against a fresh ore freighter's crew at full nerve.
    const o = boardingOdds(
      rules,
      t2(0, { swivels: 0, cannon: 0 }),
      ship({ crew: 22, morale: 80, armed: true }),
    );
    expect(o.fight).toBeLessThan(rules.death.badOdds);
    expect(o.death).toBeGreaterThan(0);
    expect(o.death).toBeLessThanOrEqual(rules.death.max);
  });

  it('counts Fame, the quarterdeck voice and surprise in the dark as strength', () => {
    const base = boardingOdds(rules, t2(0), ship()).strength;
    expect(boardingOdds(rules, t2(1), ship()).strength).toBeCloseTo(base + rules.fameStrength);
    expect(
      boardingOdds(rules, t2(0, { perks: ['perk.quarterdeck_voice'] }), ship()).strength,
    ).toBeGreaterThan(base);
    expect(boardingOdds(rules, t2(0, { dark01: 1 }), ship()).strength).toBeCloseTo(
      base + rules.surpriseStrength,
    );
  });

  it('a won fight leaves casualties; a lost one is repelled with damage above the floor', () => {
    const her = ship();
    const odds = boardingOdds(rules, t2(1), her);
    const you = { tier: 2, hull: 100, hullMax: 100, herHullMax: steamer?.hullHP ?? 300 };
    let won = 0;
    let lost = 0;
    const rng = Rng.fromSeed('fight');
    for (let i = 0; i < 200; i++) {
      const r = resolveBoarding(rules, 'fight', odds, her, you, rng);
      if (r.option !== 'fight') throw new Error('not a fight');
      if (r.ok) {
        won++;
        expect(r.theirKilled + r.theirWounded).toBeGreaterThan(0);
        expect(r.theirKilled + r.theirWounded).toBeLessThanOrEqual(her.crew);
      } else {
        lost++;
        expect(you.hull - r.hullDamage).toBeGreaterThanOrEqual(
          you.hullMax * rules.repelled.floorShare - 1e-9,
        );
        // Good odds: nobody dies of a lost fight.
        expect(r.killed).toBe(false);
      }
    }
    expect(won).toBeGreaterThan(lost);
    expect(lost).toBeGreaterThan(0);
  });

  it('a T1 takes no hands over the rail and loses none', () => {
    const her = ship({ crew: 5, morale: 20, struck: false });
    const odds = boardingOdds(rules, { ...t2(0), tier: 1, swivels: 1, cannon: 0 }, her);
    const r = resolveBoarding(
      rules,
      'fight',
      odds,
      her,
      { tier: 1, hull: 50, hullMax: 50, herHullMax: tug?.hullHP ?? 80 },
      Rng.fromSeed('t1'),
    );
    expect(r.option === 'fight' && r.oursWounded).toBe(0);
  });
});

describe('looting (plan 07 §7.1)', () => {
  const cargo = [
    { good: 'good.iron_ore', qty: 50 },
    { good: 'good.furs', qty: 4 },
    { good: 'good.dry_goods', qty: 10 },
  ];
  const prize = () =>
    createPrize(rules, economy, {
      shipId: 'ship.test',
      owner: 'company.test',
      region: 'region.chequamegon',
      now: 1000,
      cargo,
      cashCents: 12_000,
    });

  it('lists the cash box first, then valuables, then bulk', () => {
    const p = prize();
    expect(p.lots.map((l) => l.key)).toEqual([
      'cash',
      'good.furs',
      'good.dry_goods',
      'good.iron_ore',
    ]);
    expect(minutesFor(p, 'good.iron_ore', 10)).toBeGreaterThan(minutesFor(p, 'good.furs', 10));
  });

  it('takes what fits, hot with the owner company marks, and takes time', () => {
    const p = prize();
    const you = { cargo: [] as Hold, purse: 0 };
    const r = takeLot(rules, economy, p, you, 20, 'good.iron_ore', 50);
    expect(r).toMatchObject({ ok: true, qty: 20 });
    expect(r.ok && r.minutes).toBeGreaterThan(0);
    expect(holdUsed(you.cargo)).toBe(20);
    expect(you.cargo[0]?.hot).toMatchObject({
      owner: 'company.test',
      region: 'region.chequamegon',
      since: 1000,
    });
    expect(takeLot(rules, economy, p, you, 20, 'good.furs', 1)).toEqual({
      ok: false,
      reason: 'noRoom',
    });
    // A second load of the same good from the same robbery joins its stack.
    const p2 = prize();
    const big = { cargo: [] as Hold, purse: 0 };
    takeLot(rules, economy, p2, big, 100, 'good.furs', 1);
    takeLot(rules, economy, p2, big, 100, 'good.furs', 2);
    expect(big.cargo).toHaveLength(1);
    expect(big.cargo[0]?.qty).toBe(3);
    expect(p2.taken).toEqual([{ good: 'good.furs', qty: 3 }]);
  });

  it('a quick grab takes the cash and the valuables at once, and no bulk', () => {
    const p = prize();
    const you = { cargo: [] as Hold, purse: 500 };
    const got = quickGrab(rules, economy, p, you, 100);
    expect(got.every((g) => g.minutes === 0)).toBe(true);
    expect(you.purse).toBe(12_500);
    expect(you.cargo.map((s) => s.good)).toEqual(['good.furs']);
    expect(p.minutes).toBe(0);
  });
});

describe('the aftermath (plan 07 §7.2, §14.3 criterion 7)', () => {
  const fair = { windKn: 10, month: 6, dark01: 0, voyageS: 4 * 3600 };

  it('delays the report by what you did to them, and sinking with all hands leaves none', () => {
    const go = previewAftermath(rules, 'letGo', fair).reportInS ?? 0;
    const limp = previewAftermath(rules, 'disable', fair).reportInS ?? 0;
    const row = previewAftermath(rules, 'adrift', fair).reportInS ?? 0;
    expect(go).toBe(4 * 3600);
    expect(limp).toBeGreaterThan(go);
    expect(row).toBeGreaterThan(go);
    expect(previewAftermath(rules, 'sinkWithCrew', fair).reportInS).toBeUndefined();
  });

  it('drowns nobody set adrift in fair summer weather', () => {
    expect(adriftDeathChance(rules, fair)).toBe(0);
    const r = resolveAftermath(rules, 'adrift', fair, 16, Rng.fromSeed('fair'));
    expect(r).toMatchObject({ killed: 0, survivors: 16, sinks: true });
  });

  it('shows the boat at risk in a gale, in cold water and in the dark', () => {
    const gale = adriftDeathChance(rules, { ...fair, windKn: 30 });
    const november = adriftDeathChance(rules, { ...fair, month: 10 });
    const both = adriftDeathChance(rules, { windKn: 30, month: 10, dark01: 1 });
    expect(gale).toBeGreaterThan(0);
    expect(november).toBeGreaterThan(0);
    expect(both).toBeGreaterThan(Math.max(gale, november));
    expect(both).toBeLessThanOrEqual(rules.aftermath.adrift.max);
  });

  it('kills every hand sunk with her, and nobody reports it', () => {
    const r = resolveAftermath(rules, 'sinkWithCrew', fair, 7, Rng.fromSeed('x'));
    expect(r).toMatchObject({ killed: 7, survivors: 0, reportInS: undefined });
  });
});

describe('robbed and sunk ships in the traffic slice', () => {
  const geo = westernSuperiorChart();
  const defs = gameTraffic();

  it('takes a sunk ship off the timetable, the chart and the markets for a week', () => {
    const contacts = createContacts(geo.projection, 'boarding-lost', 0);
    const c = contacts.find((k) => k.schedule && k.kind !== 'cutter');
    if (!c) throw new Error('no scheduled contact');
    const ships: TrafficState['ships'] = {};
    const t0 = 2 * SECONDS_PER_GAME_DAY;
    recordLost(ships, c.id, t0, 'sunk', rules.lostDays);
    expect(lostNow(ships, c.id, t0 + 10)).toBe(true);
    expect(lostNow(ships, c.id, t0 + rules.lostDays * SECONDS_PER_GAME_DAY + 1)).toBe(false);

    c.lostAt = ships[c.id]?.lostAt;
    c.lostUntil = ships[c.id]?.lostUntil;
    placeTraffic(contacts, t0 + 3600);
    expect(c.lost).toBe(true);
    expect(c.inPort).toBe(true);
    expect(c.underWay).toBe(false);
    placeTraffic(contacts, t0 + 2 * SECONDS_PER_GAME_DAY);
    expect(c.lost).toBe(false);
    expect(isLostAt(c, t0 - 1)).toBe(false);

    // Her calls while she's on the bottom move no market.
    const markets = createMarkets(economy, t0);
    const until = c.lostUntil ?? t0;
    const withHer = runTraffic(
      defs,
      economy,
      createMarkets(economy, t0),
      [{ ...c, lostUntil: undefined }],
      t0,
      until,
    );
    const without = runTraffic(defs, economy, markets, [c], t0, until);
    expect(without.filter((d) => d.shipId === c.id)).toHaveLength(0);
    expect(withHer.length).toBeGreaterThanOrEqual(without.length);
  });

  it('a robbed ship carries less on that passage only, and her cash box stays empty a while', () => {
    const contacts = createContacts(geo.projection, 'boarding-robbed', 0);
    let m: Manifest | undefined;
    let c = contacts[0];
    for (const k of contacts) {
      if (!k.schedule) continue;
      const got = currentManifest(defs, economy, k, 0);
      if (got && got.cargo.length > 0) {
        m = got;
        c = k;
        break;
      }
    }
    if (!m || !c) throw new Error('no laden ship');
    const line = m.cargo[0];
    if (!line) throw new Error('empty');
    const ships: TrafficState['ships'] = {};
    const take = Math.min(3, line.qty);
    recordRobbed(ships, c.id, 100, [{ good: line.good, qty: take }], 5000, {
      cycle: m.cycle,
      outbound: m.outbound,
    });
    const after = afterRobbery(m, ships, c.id, economy);
    const left = after.cargo.find((l) => l.good === line.good)?.qty ?? 0;
    expect(left).toBe(line.qty - take);
    expect(after.valueCents).toBeLessThan(m.valueCents);
    // Her next passage loads afresh.
    const next = { ...m, cycle: m.cycle + 1 };
    expect(afterRobbery(next, ships, c.id, economy)).toBe(next);
    expect(robbedLately(ships, c.id, 200, rules.robbedDays)).toBe(true);
    expect(
      robbedLately(
        ships,
        c.id,
        100 + rules.robbedDays * SECONDS_PER_GAME_DAY + 1,
        rules.robbedDays,
      ),
    ).toBe(false);
    // Robbed twice on one passage, the takings add up.
    recordRobbed(ships, c.id, 150, [{ good: line.good, qty: 1 }], 0, {
      cycle: m.cycle,
      outbound: m.outbound,
    });
    expect(ships[c.id]?.robbed?.taken[0]?.qty).toBe(take + 1);
    expect(ships[c.id]?.robbed?.cashCents).toBe(5000);
  });
});
