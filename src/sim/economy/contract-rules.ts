import type { ContractKind } from '../../../data/schemas/contracts';
import type { MarketDef } from '../../../data/schemas/markets';

/**
 * The freight agent's tuning (plan 05 §5.2; Phase 4 piece F), in one place like the
 * market's. Pay is per CU and grows with the passage's real minutes, so a contract pays
 * about as well for its hold space as a good cargo does, without the money tied up or the
 * price risk; the board's one or two offers a game day cap what contracts can add. The balance
 * harness's contracts bot (`runTrader` with `contracts`) checks the whole against the
 * plan 05 §5.3 target: a T2 on the legit path in 8–12 real hours.
 */
export interface ContractRules {
  /** A port's board is drawn fresh every this many game hours. */
  boardHours: number;
  /** Offers on a board by market size; tiny landings have no freight agent. */
  offersBySize: Record<MarketDef['size'], number>;
  /** Pay a CU: a flat part, and a part per real minute of the passage, cents. */
  payBaseCentsPerCu: number;
  payCentsPerCuRealMinute: number;
  /** Pay by kind, and the company tier's premium. */
  kindPay: Record<ContractKind, number>;
  companyPay: number;
  /** Extra pay at Standing 100 with the shipper (company tier) or the port (open). */
  standingPayBonus: number;
  /** The deposit as a share of the pay, before credit. */
  depositShare: number;
  /** Port Standing that halves the deposit, and that waives it (credit, §5.2). */
  depositHalfAt: number;
  depositWaivedAt: number;
  /** Time allowed: the passage's game time × `mult` + `plusHours`, at least `minHours`. */
  allowance: Record<ContractKind, { mult: number; plusHours: number; minHours: number }>;
  /** After the due time, a late window of this share of the allowance pays `latePay`. */
  lateWindowShare: number;
  latePay: number;
  /** Each hard knock (a strike, a knockdown, a hard grounding) on fragile cargo. */
  fragileHitLoss: number;
  /** Standing changes (0–100) on each outcome, for the offering port and the shipper. */
  standing: Record<
    'onTime' | 'late' | 'failed' | 'abandoned',
    { port: number; destination: number; company: number }
  >;
  /** Mail counts double toward Standing (plan 05 §5.2: "good pay and reputation"). */
  mailStanding: number;
  /** Stealing: the shipper drops to 0 for good; the offering port loses this much. */
  theftPortStanding: number;
  /** Shipyard prices fall up to this share at Standing 100 with the port (plan 10 §3). */
  shipyardDiscountMax: number;
  /** Finished contracts the ledger keeps. */
  historyLength: number;
}

export function defaultContractRules(): ContractRules {
  return {
    boardHours: 24,
    offersBySize: { huge: 2, large: 2, medium: 1, small: 1, tiny: 0 },
    payBaseCentsPerCu: 25,
    payCentsPerCuRealMinute: 5,
    kindPay: { freight: 1, rush: 1.5, mail: 2.5, fragile: 1.4 },
    companyPay: 1.25,
    standingPayBonus: 0.1,
    depositShare: 1 / 3,
    depositHalfAt: 30,
    depositWaivedAt: 60,
    allowance: {
      freight: { mult: 3, plusHours: 6, minHours: 12 },
      fragile: { mult: 3, plusHours: 6, minHours: 12 },
      mail: { mult: 2, plusHours: 4, minHours: 8 },
      rush: { mult: 1.5, plusHours: 2, minHours: 4 },
    },
    lateWindowShare: 0.5,
    latePay: 0.5,
    fragileHitLoss: 0.25,
    standing: {
      onTime: { port: 2, destination: 1, company: 3 },
      late: { port: -2, destination: 0, company: -3 },
      failed: { port: -5, destination: -2, company: -8 },
      abandoned: { port: -3, destination: 0, company: -4 },
    },
    mailStanding: 2,
    theftPortStanding: -10,
    shipyardDiscountMax: 0.15,
    historyLength: 12,
  };
}
