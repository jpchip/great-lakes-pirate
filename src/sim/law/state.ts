import { z } from 'zod';
import { IDENTIFICATIONS, WITNESS_KINDS } from '../../../data/schemas/law';

/**
 * The law's saved slices (plan 06 §10; Phase 5 piece A, save v7): Wanted by region, Fame,
 * the ship's profile, reports in progress with the crimes they're about, and jail.
 */

/**
 * One region's Wanted (plan 06 §10 `wanted[regionId]`). `heat` sets the tier; `shipHeat`
 * is the part of it tied to your ship's profile, which goes when you replace the hull
 * (§2.3); `alert` is unidentified crime ("someone did it"), which raises the region's
 * guard but never the tier.
 */
export const regionWantedSchema = z.object({
  heat: z.number().nonnegative(),
  shipHeat: z.number().nonnegative(),
  alert: z.number().nonnegative(),
  /**
   * Decay alone won't take heat below this: set once the region reaches tier 4 (it won't
   * drop below tier 3 without a bribe, a fine or time served; plan 06 §3.3).
   */
  floor: z.number().nonnegative().optional(),
  /** When heat last landed here (a report filed, or news), for decay's grace period. */
  lastCrimeAt: z.number().optional(),
  /** When the player was last in the region. */
  lastSeenAt: z.number().optional(),
});
export type RegionWanted = z.infer<typeof regionWantedSchema>;

export const wantedSchema = z.record(z.string(), regionWantedSchema);
export type WantedState = z.infer<typeof wantedSchema>;

/** Fame (plan 06 §4, §10 `fame`). */
export const fameSchema = z.object({
  value: z.number().nonnegative(),
  lastNotableAt: z.number().optional(),
});
export type FameState = z.infer<typeof fameSchema>;

/**
 * What the law knows your ship by (plan 06 §2.3, §10 `profiles.ship`). No disguise: only
 * a new hull (`hull` counts them) stops old reports matching. Personal recognition
 * follows from Fame (`recognition`), so it isn't stored.
 */
export const profilesSchema = z.object({
  ship: z.object({
    hull: z.number().int().positive(),
    classId: z.string(),
    name: z.string(),
    since: z.number(),
  }),
});
export type ProfilesState = z.infer<typeof profilesSchema>;

const witnessRefSchema = z.object({
  id: z.string(),
  kind: z.enum(WITNESS_KINDS),
  name: z.string(),
});

/** A crime the law hasn't finished with: a report on its way, or its news. */
export const openCrimeSchema = z.object({
  id: z.string(),
  crime: z.string(),
  region: z.string(),
  port: z.string().optional(),
  at: z.number(),
  /** The hull you sailed when it happened. */
  hull: z.number().int().positive(),
  /** The best identification factor already filed (so two reports don't add twice). */
  filed: z.number().min(0).max(1),
  /** Standing and Fame were applied (once, at the first report that names you). */
  named: z.boolean(),
  /** When its news spreads to the neighbors (§3.4); absent once it has, or if none. */
  newsAt: z.number().optional(),
});
export type OpenCrime = z.infer<typeof openCrimeSchema>;

/** A witness carrying a report to the region's authority (plan 06 §2.4, §10). */
export const reportSchema = z.object({
  id: z.string(),
  crimeId: z.string(),
  witness: witnessRefSchema,
  identification: z.enum(IDENTIFICATIONS),
  /** When it lands, game seconds. */
  eta: z.number(),
});
export type Report = z.infer<typeof reportSchema>;

export const reportsSchema = z.object({
  nextId: z.number().int().positive(),
  inProgress: z.array(reportSchema),
  crimes: z.array(openCrimeSchema),
});
export type ReportsState = z.infer<typeof reportsSchema>;

/**
 * Jail (plan 06 §8, plan 12 §8.1; Phase 5 piece D). Null when free. Taken at sea, the
 * captain is held in the lockup (`port`) for a sentence by the region's tier and heat;
 * cargo and cash on hand were confiscated, the ship impounded. At tier 5 it's the rope:
 * `execution`, with no sentence to serve. `word` is bail sent for from a strongbox.
 */
export const jailSchema = z
  .object({
    /** Where you were taken, and the lockup you're held in. */
    region: z.string(),
    port: z.string(),
    since: z.number(),
    /** When the sentence is up (game seconds); with bail on its way, when it comes. */
    releaseAt: z.number(),
    /** Who took you and how (piece C's `PlayerCaptured`). */
    by: z.string().default('law.morrill'),
    how: z.enum(['surrender', 'boarded']).default('surrender'),
    /** The region's tier and heat when you were taken. */
    tier: z.number().int().min(0).default(0),
    heat: z.number().nonnegative().default(0),
    /** Weeks to serve (a game day each); 0 for the rope. */
    sentenceWeeks: z.number().int().nonnegative().default(0),
    bailCents: z.number().int().nonnegative().default(0),
    /** What the harbor wants for the ship on release. */
    impoundCents: z.number().int().nonnegative().default(0),
    execution: z.boolean().default(false),
    confiscated: z
      .object({
        cargo: z.array(z.object({ good: z.string(), qty: z.number().int().positive() })),
        cashCents: z.number().int().nonnegative(),
      })
      .default({ cargo: [], cashCents: 0 }),
    /** Bail sent for by messenger: from which hideout, what it cost and when it comes. */
    word: z
      .object({
        hideout: z.string(),
        sentAt: z.number(),
        arrivesAt: z.number(),
        paidCents: z.number().int().nonnegative(),
      })
      .optional(),
    /** Days added to work off an impound fee nobody could pay. */
    workOffDays: z.number().int().nonnegative().default(0),
  })
  .nullable();
export type JailState = z.infer<typeof jailSchema>;

export interface LawState {
  wanted: WantedState;
  fame: FameState;
  profiles: ProfilesState;
  reports: ReportsState;
  jail: JailState;
}

/** A fresh run's law: Clean everywhere, unknown, on her first hull. */
export function createLawState(classId: string, shipName: string, now: number): LawState {
  return {
    wanted: {},
    fame: { value: 0 },
    profiles: { ship: { hull: 1, classId, name: shipName, since: now } },
    reports: { nextId: 1, inProgress: [], crimes: [] },
    jail: null,
  };
}
