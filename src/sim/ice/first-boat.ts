import { cycleAt, cycleStartS, sailsInCycle } from '../chart/routes';
import type { Contact } from '../chart/traffic';
import { calendarMs, gameSecondsAt } from './season';

/**
 * The first-boat-in race (plan 05 §3, plan 12 §5.2; piece K): the first ship of the traffic
 * to make `port` at or after `after` (its ice-out), by the timetable, and when. A ship's
 * arrivals are the ends of her runs: the far end of her lane on the way out, home on the
 * way back. Undefined when none comes before `until`.
 */
export function firstArrivalAfter(
  contacts: readonly Contact[],
  port: string,
  after: number,
  until: number,
): { ship: string; at: number } | undefined {
  let best: { ship: string; at: number } | undefined;
  // A year on at most: the next ice-out is another race.
  until = Math.min(until, gameSecondsAt(calendarMs(after) + 365 * 86_400_000));
  for (const c of contacts) {
    const s = c.schedule;
    if (!s?.ice || c.hostile) continue;
    const [home, away] = s.ice.ends;
    if (home.port !== port && away.port !== port) continue;
    const transit = s.lengthM / s.speedMs;
    for (let k = cycleAt(s, after) - 1; k <= cycleAt(s, until); k++) {
      const t0 = cycleStartS(s, k);
      if (best && t0 > best.at) break;
      if (!sailsInCycle(s, k)) continue;
      const arrivals: number[] = [];
      if (away.port === port) arrivals.push(t0 + transit);
      if (home.port === port) arrivals.push(t0 + 2 * transit + s.dwellAwayS);
      for (const at of arrivals) {
        if (at < after || at > until) continue;
        if (!best || at < best.at) best = { ship: c.name, at };
      }
    }
  }
  return best;
}
