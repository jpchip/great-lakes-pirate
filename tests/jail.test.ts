import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { acquireTabLock } from '../src/core/tab-lock';
import { gameLaw, tierDef, wantedTier } from '../src/sim/law/defs';
import {
  captureOutcome,
  gameJail,
  imprison,
  release,
  sendWord,
  settleImpound,
  wordCost,
  wordRefusal,
} from '../src/sim/law/jail';
import { setHeat } from '../src/sim/law/law';
import { LOGBOOK_MAX, log } from '../src/sim/run/record';
import { buildLastRun, logbookMarkdown } from '../src/sim/run/run-end';
import { createWorldState, parseWorldState, type WorldState } from '../src/sim/world-state';
import { logbookFileName } from '../src/ui/end/EndScreen';

const defs = gameLaw();
const jail = gameJail();
const APOSTLES = 'region.apostles';
const STOCKTON = 'hideout.stockton';
const NOON = 12 * 3600;

function run(heat: number): WorldState {
  const s = createWorldState('jail-test', NOON);
  setHeat(defs, s, APOSTLES, heat);
  s.player.purse = 4321;
  s.player.cargo = [
    { good: 'good.whiskey', qty: 4 },
    { good: 'good.rope_canvas', qty: 2 },
  ];
  return s;
}

function stockton(s: WorldState) {
  const h = s.hideouts?.[STOCKTON];
  if (!h) throw new Error('no Stockton stash');
  return h;
}

const capture = { region: APOSTLES, by: 'law.morrill', how: 'surrender' as const };

describe('capture outcomes (plan 06 §8.2, plan 12 §8.1)', () => {
  it('sentences by tier, longer and dearer as heat rises through it', () => {
    const t1 = captureOutcome(defs, jail, tierDef(defs, 1).minHeat);
    const t2lo = captureOutcome(defs, jail, tierDef(defs, 2).minHeat);
    const t2hi = captureOutcome(defs, jail, tierDef(defs, 3).minHeat - 1);
    const t4 = captureOutcome(defs, jail, tierDef(defs, 4).minHeat + 100);
    expect(t1).toMatchObject({ kind: 'jail', tier: 1, sentenceWeeks: 1 });
    expect(t2lo).toMatchObject({ kind: 'jail', tier: 2, sentenceWeeks: 2, bailCents: 6000 });
    expect(t2hi).toMatchObject({ kind: 'jail', tier: 2, sentenceWeeks: 3 });
    if (t2hi.kind !== 'jail' || t4.kind !== 'jail' || t2lo.kind !== 'jail') throw new Error();
    expect(t2hi.bailCents).toBeGreaterThan(t2lo.bailCents);
    expect(t2hi.bailCents).toBeLessThanOrEqual(15000);
    expect(t4.sentenceWeeks).toBeGreaterThanOrEqual(8);
    expect(t4.sentenceWeeks).toBeLessThanOrEqual(12);
    expect(t4.impoundCents).toBe(
      jail.impound.baseCents + jail.impound.perWeekCents * t4.sentenceWeeks,
    );
  });

  it('hangs at tier 5', () => {
    expect(captureOutcome(defs, jail, tierDef(defs, 5).minHeat)).toEqual({
      kind: 'execution',
      tier: 5,
      heat: tierDef(defs, 5).minHeat,
    });
  });
});

describe('jail (plan 12 §8.1)', () => {
  it('confiscates cargo and cash, ends the voyage, and leaves the stash alone', () => {
    const s = run(tierDef(defs, 2).minHeat);
    stockton(s).storage.cash = 9999;
    s.voyage = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      leg: 0,
      progressM: 0,
      startedAt: 0,
    };
    const j = imprison(defs, jail, s, capture, NOON);
    expect(s.player.cargo).toEqual([]);
    expect(s.player.purse).toBe(0);
    expect(s.voyage).toBeNull();
    expect(stockton(s).storage.cash).toBe(9999);
    expect(j.confiscated).toEqual({
      cargo: [
        { good: 'good.whiskey', qty: 4 },
        { good: 'good.rope_canvas', qty: 2 },
      ],
      cashCents: 4321,
    });
    expect(j.port).toBe(jail.lockup.port);
    expect(j.releaseAt).toBe(NOON + j.sentenceWeeks * SECONDS_PER_GAME_DAY);
    expect(j.execution).toBe(false);
  });

  it('serving the sentence brings the region down to tier 1, the fee from the strongbox', () => {
    const s = run(tierDef(defs, 3).minHeat + 50);
    stockton(s).storage.cash = 50_000;
    const j = imprison(defs, jail, s, capture, NOON);
    expect(settleImpound(jail, s)).toBe(STOCKTON);
    expect(stockton(s).storage.cash).toBe(50_000 - j.impoundCents);
    const out = j.releaseAt;
    const r = release(defs, jail, s, out);
    expect(r.how).toBe('served');
    expect(r.insideS).toBe(j.sentenceWeeks * SECONDS_PER_GAME_DAY);
    expect(wantedTier(defs, s.wanted[APOSTLES]?.heat ?? 0)).toBe(1);
    expect(s.jail).toBeNull();
    expect(r.events.some((e) => e.type === 'WantedTierChanged')).toBe(true);
  });

  it('works off a fee nobody can pay on the coal dock', () => {
    const s = run(tierDef(defs, 2).minHeat);
    stockton(s).storage.cash = 0;
    const j = imprison(defs, jail, s, capture, NOON);
    const sentenceEnd = j.releaseAt;
    expect(settleImpound(jail, s)).toBeUndefined();
    const days = Math.ceil(j.impoundCents / jail.impound.workOffCentsPerDay);
    expect(s.jail?.workOffDays).toBe(days);
    expect(s.jail?.releaseAt).toBe(sentenceEnd + days * SECONDS_PER_GAME_DAY);
    // Settling twice adds nothing more.
    settleImpound(jail, s);
    expect(s.jail?.releaseAt).toBe(sentenceEnd + days * SECONDS_PER_GAME_DAY);
  });

  it('sends word for bail from the strongbox: out early, and the region down to tier 1', () => {
    const s = run(tierDef(defs, 4).minHeat);
    const j = imprison(defs, jail, s, capture, NOON);
    const cost = wordCost(jail, j);
    stockton(s).storage.cash = cost - 1;
    expect(wordRefusal(jail, s, STOCKTON)).toBe('short');
    expect(sendWord(jail, s, STOCKTON, 'seed', NOON)).toBe('short');
    stockton(s).storage.cash = cost + 100;
    expect(sendWord(jail, s, STOCKTON, 'seed', NOON)).toBeUndefined();
    expect(stockton(s).storage.cash).toBe(100);
    const word = s.jail?.word;
    if (!word) throw new Error('no word');
    const [lo, hi] = jail.sendWord.delayHours;
    expect(word.arrivesAt - NOON).toBeGreaterThanOrEqual(lo * 3600);
    expect(word.arrivesAt - NOON).toBeLessThanOrEqual(hi * 3600);
    expect(s.jail?.releaseAt).toBe(word.arrivesAt);
    expect(wordRefusal(jail, s, STOCKTON)).toBe('sent');
    // No fee to settle or work off: bail paid it.
    expect(settleImpound(jail, s)).toBeUndefined();
    expect(s.jail?.workOffDays).toBe(0);
    const heat = s.wanted[APOSTLES]?.heat ?? 0;
    expect(heat).toBeGreaterThan(tierDef(defs, 1).minHeat);
    const r = release(defs, jail, s, word.arrivesAt);
    expect(r.how).toBe('bail');
    expect(s.wanted[APOSTLES]?.heat).toBe(tierDef(defs, 1).minHeat);
  });

  it('the messenger takes as long after a reload', () => {
    const delay = (): number => {
      const s = run(tierDef(defs, 2).minHeat);
      imprison(defs, jail, s, capture, NOON);
      stockton(s).storage.cash = 1_000_000;
      sendWord(jail, s, STOCKTON, 'same-seed', NOON);
      return s.jail?.word?.arrivesAt ?? 0;
    };
    expect(delay()).toBe(delay());
  });

  it('at tier 5 there is no bail and no release: the rope', () => {
    const s = run(tierDef(defs, 5).minHeat + 20);
    stockton(s).storage.cash = 1_000_000;
    const j = imprison(defs, jail, s, capture, NOON);
    expect(j.execution).toBe(true);
    expect(j.sentenceWeeks).toBe(0);
    expect(wordRefusal(jail, s, STOCKTON)).toBe('execution');
    expect(() => release(defs, jail, s, NOON)).toThrow();
  });

  it('keeps the jail through a save round trip', () => {
    const s = run(tierDef(defs, 2).minHeat);
    imprison(defs, jail, s, capture, NOON);
    const back = parseWorldState(JSON.parse(JSON.stringify(s)));
    expect(back.jail).toEqual(s.jail);
    // A save from before piece D (jail null, no record) loads with an empty record.
    const old = JSON.parse(JSON.stringify(createWorldState('old', 0))) as Record<string, unknown>;
    delete old['stats'];
    delete old['logbook'];
    const loaded = parseWorldState(old);
    expect(loaded.stats?.crimes).toBe(0);
    expect(loaded.logbook).toEqual([]);
  });
});

describe("the run's end (plan 12 §9, plan 16 §3)", () => {
  it('prints the hanging on the front page with the run summary and logbook', () => {
    const s = run(tierDef(defs, 5).minHeat);
    s.player.captain = { name: 'Ida Bergquist', shipName: 'Kittiwake', background: 'fisherman' };
    imprison(defs, jail, s, capture, NOON);
    log(s, NOON, 'Hove to for the revenue cutter Morrill in Apostle Islands.');
    log(s, NOON + 60, 'Sentenced to hang at Bayfield.');
    const end = 3 * SECONDS_PER_GAME_DAY + 6 * 3600;
    const last = buildLastRun(defs, s, 'executed', end, new Date('2026-11-04T12:00:00Z'));
    expect(last.frontPage.headline).toBe('IDA BERGQUIST HANGED AT BAYFIELD');
    expect(last.frontPage.paper).toBe("The Bayfield Fishermen's Weekly");
    expect(last.frontPage.body.join(' ')).not.toMatch(/\b(he|his|him)\b/i);
    expect(last.summary.find((r) => r.label === 'How it ended')?.value).toBe('Hanged');
    expect(last.summary.find((r) => r.label === 'Survived')?.value).toMatch(/^3 weeks/);
    expect(last.logbook).toContain(
      '# The logbook of Captain Ida Bergquist, master of the Kittiwake',
    );
    expect(last.logbook).toContain('## Week of May 7, 1900');
    expect(last.logbook).toContain('- 12:00 Hove to for the revenue cutter Morrill');
    expect(last.logbook).toContain('IDA BERGQUIST HANGED AT BAYFIELD');
    expect(logbookFileName('Ida Bergquist')).toBe('logbook-ida-bergquist.md');
  });

  it('abandoning makes its own front page', () => {
    const s = run(0);
    const last = buildLastRun(defs, s, 'abandoned', NOON, new Date());
    expect(last.frontPage.headline).toMatch(/LAID UP$/);
    expect(last.summary.find((r) => r.label === 'How it ended')?.value).toBe('Gave up the lake');
  });

  it('keeps the logbook short and skips a line written twice', () => {
    const s = createWorldState('log', 0);
    log(s, 0, 'Made fast at Bayfield.');
    log(s, 1, 'Made fast at Bayfield.');
    expect(s.logbook).toHaveLength(1);
    for (let i = 0; i < LOGBOOK_MAX + 20; i++) log(s, i, `line ${i}`);
    expect(s.logbook).toHaveLength(LOGBOOK_MAX);
    expect(s.logbook?.[0]?.text).toBe('line 20');
    expect(logbookMarkdown('A', 'B', [], 'The end')).toContain('*The end*');
  });
});

describe('the single-tab lock (plan 16 §4.4)', () => {
  /** A lock manager like the browser's, for one lock name. */
  function fakeLocks() {
    let held = false;
    const waiters: (() => void)[] = [];
    return {
      release() {
        held = false;
        waiters.shift()?.();
      },
      request(
        _name: string,
        options: { ifAvailable?: boolean; signal?: AbortSignal },
        callback: (lock: unknown) => unknown,
      ): Promise<unknown> {
        if (!held) {
          held = true;
          return Promise.resolve(callback({}));
        }
        if (options.ifAvailable) return Promise.resolve(callback(null));
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          waiters.push(() => {
            held = true;
            resolve(callback({}));
          });
        });
      },
    };
  }

  it('lets the first tab play and turns a second away', async () => {
    const locks = fakeLocks();
    expect(await acquireTabLock(locks, 'glp-run', 20)).toBe(true);
    expect(await acquireTabLock(locks, 'glp-run', 20)).toBe(false);
  });

  it('takes the lock over from a reload that lets go in time', async () => {
    const locks = fakeLocks();
    expect(await acquireTabLock(locks, 'glp-run', 20)).toBe(true);
    const second = acquireTabLock(locks, 'glp-run', 500);
    setTimeout(() => locks.release(), 10);
    expect(await second).toBe(true);
  });

  it('plays without the Web Locks API', async () => {
    expect(await acquireTabLock(undefined)).toBe(true);
  });
});
