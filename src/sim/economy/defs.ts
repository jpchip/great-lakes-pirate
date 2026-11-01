import goodsJson from '../../../data/goods.json';
import marketsJson from '../../../data/markets.json';
import portsJson from '../../../data/ports.json';
import shipsJson from '../../../data/ships.json';
import { goodsFileSchema, type Good, type Season } from '../../../data/schemas/goods';
import { marketsFileSchema, type MarketDef } from '../../../data/schemas/markets';
import { portsFileSchema } from '../../../data/schemas/ports';
import { shipsFileSchema } from '../../../data/schemas/ships';
import { calendarDate } from '../../core/time';
import { defaultMarketRules, type MarketRules } from './market-rules';

/**
 * The economy's static definitions (plan 05 §3–4): goods, and each port's market compiled
 * from its profile and the shared rules into per-good base prices, target stocks and
 * spreads. Built once; the sim's state only holds what changes (stock).
 */

export type GoodRole = 'export' | 'neutral' | 'import';

/** One good in one port's market, ready for the price formula. */
export interface MarketGood {
  good: Good;
  role: GoodRole;
  /** The good's base price scaled by its role here, cents per CU. */
  basePriceCents: number;
  /** In-season target stock, CU. The price formula always measures against this. */
  targetStock: number;
}

export interface PortMarket {
  def: MarketDef;
  portId: string;
  spread: number;
  goods: ReadonlyMap<string, MarketGood>;
}

export interface EconomyDefs {
  rules: MarketRules;
  goods: ReadonlyMap<string, Good>;
  markets: ReadonlyMap<string, PortMarket>;
}

function roleOf(def: MarketDef, goodId: string): GoodRole | 'absent' {
  if (def.absent.includes(goodId)) return 'absent';
  if (def.exports.includes(goodId)) return 'export';
  if (def.imports.includes(goodId)) return 'import';
  return 'neutral';
}

export function compileEconomy(
  goodsList: readonly Good[],
  marketDefs: readonly MarketDef[],
  rules: MarketRules = defaultMarketRules(),
): EconomyDefs {
  const goods = new Map(goodsList.map((g) => [g.id, g]));
  const markets = new Map<string, PortMarket>();
  for (const def of marketDefs) {
    for (const id of [...def.exports, ...def.imports, ...def.absent]) {
      if (!goods.has(id)) throw new Error(`${def.id} names unknown good ${id}`);
    }
    const portGoods = new Map<string, MarketGood>();
    for (const good of goodsList) {
      // Contraband never trades openly (plan 05 §6); the smuggler (piece H) deals in it.
      if (good.legal === 'contraband') continue;
      const role = roleOf(def, good.id);
      if (role === 'absent') continue;
      portGoods.set(good.id, {
        good,
        role,
        basePriceCents: good.basePriceCents * rules.priceByRole[role],
        targetStock: rules.depthCu[def.size] * rules.stockByRole[role],
      });
    }
    markets.set(def.port, {
      def,
      portId: def.port,
      spread: rules.spread[def.size],
      goods: portGoods,
    });
  }
  return { rules, goods, markets };
}

let cached: EconomyDefs | undefined;

/** The game's economy from `data/goods.json` and `data/markets.json`. */
export function gameEconomy(): EconomyDefs {
  if (!cached) {
    const markets = marketsFileSchema.parse(marketsJson);
    const ports = new Set(portsFileSchema.parse(portsJson).map((p) => p.id));
    for (const m of markets) {
      if (!ports.has(m.port)) throw new Error(`${m.id} is for unknown port ${m.port}`);
    }
    cached = compileEconomy(goodsFileSchema.parse(goodsJson), markets);
  }
  return cached;
}

let capacities: ReadonlyMap<string, number> | undefined;

/** The player's hold size by ship class, CU (plan 05 §3). */
export function cargoCapacity(shipId = 'ship.t1_schooner'): number {
  capacities ??= new Map(shipsFileSchema.parse(shipsJson).map((s) => [s.id, s.cargoCapacity]));
  const cu = capacities.get(shipId);
  if (cu === undefined) throw new Error(`Unknown ship ${shipId}`);
  return cu;
}

/**
 * The season on the calendar (plan 04 §3.3; 1 game day = 1 week): spring April–May,
 * summer June–August, fall September–November, winter December–March.
 */
export function seasonAt(gameSeconds: number): Season {
  const month = calendarDate(Math.max(gameSeconds, 0)).getUTCMonth();
  if (month >= 3 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}
