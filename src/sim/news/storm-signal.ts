import type { Chart } from '../../core/coords';
import { toWorldChart, type ChartGeography } from '../chart/geography';
import { sunAt } from '../weather/celestial';
import { pressureTendency, TREND_FAST_HPA, windAt, type WeatherState } from '../weather/weather';

/**
 * Port storm signals (plan 04 §5.4; Phase 5 piece F). Since 1871 the Great Lakes ports
 * flew a red flag with a black square by day, and a red light at night, when a big low was
 * coming. In the game a port flies it on the forecast rule of plan 04 §15: the barometer
 * **falling fast** (3 hPa or more in 3 hours) at the port, which about nine storms in ten
 * give some nine hours ahead. It stays up a couple of hours after the fall eases, and
 * while a gale blows there.
 */

/** Hours back the signal stays up after the barometer was last falling fast. */
const HOLD_HOURS = 2;
/** It flies while the wind is at gale force (Beaufort 8). */
const GALE_KN = 34;

export type StormSignal = 'flag' | 'light';

/** Is the storm signal up at a world-frame point? */
export function stormSignalUp(state: WeatherState, p: Chart, t: number): boolean {
  for (let h = 0; h <= HOLD_HOURS; h++) {
    if (pressureTendency(state, p, t - h * 3600) <= -TREND_FAST_HPA) return true;
  }
  return windAt(state, p, t).speedKn >= GALE_KN;
}

/** By day the flag, after dark the red light. */
export function signalShown(t: number): StormSignal {
  return sunAt(t).elevationRad > 0 ? 'flag' : 'light';
}

/** The ports (chart geography ids) flying the storm signal now. */
export function stormSignalPorts(state: WeatherState, geo: ChartGeography, t: number): string[] {
  return geo.ports
    .filter((p) => stormSignalUp(state, toWorldChart(geo, p.pos), t))
    .map((p) => p.id);
}

/** One port's signal, or undefined when it isn't flying (or the chart doesn't have it). */
export function portStormSignal(
  state: WeatherState,
  geo: ChartGeography,
  port: string,
  t: number,
): StormSignal | undefined {
  const p = geo.ports.find((x) => x.id === port);
  if (!p || !stormSignalUp(state, toWorldChart(geo, p.pos), t)) return undefined;
  return signalShown(t);
}
