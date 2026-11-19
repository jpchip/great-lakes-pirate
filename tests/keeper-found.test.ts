import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import {
  STATION_RULES,
  bodyFound,
  emptyStation,
  keeperId,
  logSighting,
  loggedTie,
  noteLoneDeath,
} from '../src/sim/light-stations';
import { lightStationStateSchema } from '../src/sim/world-state';

const DAY = SECONDS_PER_GAME_DAY;
const lone = { id: 'light.raspberry', keepers: 1 };
const pair = { id: 'light.test', keepers: 2 };
const T = 100 * DAY + 23 * 3600;

describe('a keeper nobody is left to find', () => {
  it("isn't reported at once: he's found a week or two on", () => {
    const st = emptyStation();
    st.keepers[keeperId(lone.id, 0)] = { diedAt: T };
    expect(noteLoneDeath(lone, st, T, 'seed')).toBe(true);
    const u = st.unfound;
    expect(u).toBeDefined();
    const [lo, hi] = STATION_RULES.foundDays;
    expect((u?.findAt ?? 0) - T).toBeGreaterThanOrEqual(lo * DAY);
    expect((u?.findAt ?? 0) - T).toBeLessThanOrEqual(hi * DAY);
    expect(bodyFound(st, T + 1)).toBeUndefined();
    const f = bodyFound(st, T + hi * DAY);
    expect(f).toEqual({ diedAt: T, killed: 1, ident: 'unknown' });
    expect(st.unfound).toBeUndefined();
    // Found once only.
    expect(bodyFound(st, T + 30 * DAY)).toBeUndefined();
    expect(lightStationStateSchema.parse(st)).toEqual(st);
  });

  it('is seeded: the same run finds him on the same day', () => {
    const a = emptyStation();
    const b = emptyStation();
    a.keepers[keeperId(lone.id, 0)] = { diedAt: T };
    b.keepers[keeperId(lone.id, 0)] = { diedAt: T };
    noteLoneDeath(lone, a, T, 'seed');
    noteLoneDeath(lone, b, T, 'seed');
    expect(a.unfound).toEqual(b.unfound);
  });

  it('leaves it to the living when a keeper is still at the station', () => {
    const st = emptyStation();
    st.keepers[keeperId(pair.id, 0)] = { diedAt: T };
    expect(noteLoneDeath(pair, st, T, 'seed')).toBe(false);
    st.keepers[keeperId(pair.id, 1)] = { diedAt: T + 60 };
    expect(noteLoneDeath(pair, st, T + 60, 'seed')).toBe(true);
    expect(st.unfound?.killed).toBe(2);
    expect(st.unfound?.diedAt).toBe(T);
  });
});

describe("the keepers' log", () => {
  it('ties the killing to your ship if she was logged shortly before', () => {
    const st = emptyStation();
    logSighting(st, T - 3 * 3600, 'schooner');
    expect(loggedTie(st, T)).toBe('schooner');
    // The better sighting within the hour stands.
    logSighting(st, T - 3 * 3600 + 600, 'ship');
    logSighting(st, T - 3 * 3600 + 1200, 'unknown');
    expect(loggedTie(st, T)).toBe('ship');
  });

  it('names a visitor by day', () => {
    const st = emptyStation();
    logSighting(st, T - 12 * 3600, 'person');
    st.keepers[keeperId(lone.id, 0)] = { diedAt: T };
    noteLoneDeath(lone, st, T, 'seed');
    expect(bodyFound(st, T + 30 * DAY)?.ident).toBe('person');
  });

  it('says nothing of a ship logged long before, or after', () => {
    const st = emptyStation();
    logSighting(st, T - (STATION_RULES.logTieDays + 1) * DAY, 'ship');
    expect(loggedTie(st, T)).toBe('unknown');
    logSighting(st, T + 3600, 'ship');
    expect(loggedTie(st, T)).toBe('unknown');
  });

  it('goes with the logbook: taken after the entry, nothing ties it to you', () => {
    const st = emptyStation();
    logSighting(st, T - 3600, 'ship');
    st.logbookTakenAt = T + 600;
    expect(loggedTie(st, T)).toBe('unknown');
    // A book taken before you were logged is the old one: the new one has you.
    st.logbookTakenAt = T - 2 * 3600;
    expect(loggedTie(st, T)).toBe('ship');
  });
});
