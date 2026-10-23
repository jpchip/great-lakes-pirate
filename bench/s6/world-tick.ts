import { Rng } from '../../src/core/rng';
import { PORTS, portId, type WorstCaseState } from './worst-case';

/**
 * A stand-in world tick for the S6 fast-forward timing (plan 01 §3.3). The real tick
 * doesn't exist yet, so this does work of roughly the shape each owner plan describes,
 * on the worst-case state: every market drifts and restocks, every abstract ship
 * advances and trades on arrival, weather systems move, ice grows or melts per cell,
 * and Wanted heat decays. It is deliberately heavier than the real tick should be.
 */
export function createWorldTick(
  state: WorstCaseState,
  /** Ice is a per-cell update; run it every N ticks (1 = every tick, 144 = daily). */
  iceEveryTicks = 1,
): () => void {
  const rng = Rng.fromState(state.environment.rng);
  const marketIndex = new Map(state.markets.map((m) => [`${m.port}|${m.good}`, m]));
  const tickHours = 10 / 60;
  let tickCount = 0;

  return () => {
    for (const m of state.markets) {
      const drift = (rng.next() - 0.5) * 0.02;
      const restock = (1 - m.demand) * 2;
      m.stock = Math.max(0, m.stock + restock);
      m.priceCents = Math.max(50, Math.round(m.priceCents * (1 + drift)));
      m.heat *= 0.999;
    }

    for (const ship of state.traffic) {
      // About 40 km between ports; knots → km per tick.
      ship.progress += (ship.speedKn * 1.852 * tickHours) / 40;
      if (ship.progress >= 1) {
        for (const c of ship.cargo) {
          const m = marketIndex.get(`${ship.to}|${c.good}`);
          if (m) m.stock += c.qty;
        }
        ship.from = ship.to;
        ship.to = portId(rng.int(0, PORTS - 1));
        ship.progress = 0;
      }
      ship.alert = Math.max(0, ship.alert - 0.001);
    }

    for (const s of state.environment.systems) {
      s.lat += s.vLat * tickHours;
      s.lon += s.vLon * tickHours;
      s.pressureHpa += (rng.next() - 0.5) * 0.2;
    }

    tickCount++;
    const iceStep = tickCount % iceEveryTicks === 0 ? 0.01 * iceEveryTicks : 0;
    for (const zone of iceStep ? state.environment.ice : []) {
      const { coverage, thicknessCm } = zone;
      for (let i = 0; i < coverage.length; i++) {
        const t = (thicknessCm[i] as number) + (rng.next() < 0.5 ? -iceStep : iceStep);
        thicknessCm[i] = t < 0 ? 0 : t;
        coverage[i] = t > 0 ? Math.min(100, (coverage[i] as number) + iceStep) : 0;
      }
    }

    for (const w of Object.values(state.wanted)) w.heat *= 0.9995;
  };
}
