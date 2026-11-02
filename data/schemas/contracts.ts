import { z } from 'zod';
import { idOf } from './common';
import { SEASONS } from './goods';

/**
 * Freight contract templates (plan 05 §5.2, §11 `contracts.json`; Phase 4 piece F). Each
 * template is one shipper's standing business: what it sends, from which ports to which,
 * how much, and in what season. The freight agent's board in each port is drawn from the
 * templates that leave from it (`src/sim/economy/contracts.ts`), and pay, deposit and
 * deadline come from the passage and the rules in `contract-rules.ts`, not from here.
 *
 * - `kind`: plain freight; **rush** (a tight deadline and a bonus); **mail** (small lots,
 *   good pay and double Standing); **fragile** (every hard knock on the way costs pay).
 * - `tier`: an **open** contract is offered to anyone with the port's Standing; a
 *   **company** contract is a firm's better business, offered on Standing with the firm.
 *
 * Every contract has a shipper, so stealing its cargo always burns a company (§5.2).
 */
export const CONTRACT_KINDS = ['freight', 'rush', 'mail', 'fragile'] as const;
export const CONTRACT_TIERS = ['open', 'company'] as const;

/** Contract cargo that isn't a market good, such as the mail. It can't be sold. */
export interface Parcel {
  id: string;
  name: string;
}

export const contractTemplateSchema = z.object({
  id: idOf('contract'),
  company: idOf('company'),
  kind: z.enum(CONTRACT_KINDS),
  tier: z.enum(CONTRACT_TIERS).default('open'),
  /** Ports whose freight agent offers it. */
  from: z.array(idOf('port')).min(1),
  /** Ports it may be bound for; a port in both lists is never sent to itself. */
  to: z.array(idOf('port')).min(1),
  /** The cargo: one of these goods (or parcels), picked per offer. */
  goods: z.array(z.string().regex(/^(good|parcel)\.[a-z0-9_]+$/)).min(1),
  /** CU, inclusive. */
  qty: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  /** Offered only in these seasons; every season when absent. */
  seasons: z.array(z.enum(SEASONS)).optional(),
  /** Standing needed: with the offering port (open) or with the company (company). */
  minStanding: z.number().int().min(0).max(100).default(0),
  /** How often the board draws it against the port's other templates. */
  weight: z.number().positive().default(1),
  /** What the cargo is for, a few words for the board ("Salt for the packing house"). */
  note: z.string().min(1),
});

/** Contract cargo that isn't a market good: the mail. */
export const PARCELS: readonly Parcel[] = [{ id: 'parcel.mail', name: 'Mail sacks' }];

export const contractsFileSchema = z
  .array(contractTemplateSchema)
  .refine((f) => f.every((t) => t.qty[0] <= t.qty[1]), {
    message: 'A template qty range must run low to high',
  });

export type ContractTemplate = z.infer<typeof contractTemplateSchema>;
export type ContractKind = ContractTemplate['kind'];
export type ContractTier = ContractTemplate['tier'];
export type ContractsFile = z.infer<typeof contractsFileSchema>;
