import { z } from 'zod';
import { idOf } from './common';
import { geoSchema } from './zones';

/**
 * Discovery (plan 11 §11, §14; plan 03 §5.2; Phase 9 piece O): what the chart keeps from
 * the captain until it's found. The Lake Survey printed the coast and its soundings, so
 * those are always on the chart; what the fog of war covers is the places on it: points
 * of interest, natural wonders, the coves you can lie in and the shoals that aren't on the
 * survey sheet. Hideout sites come from `sites.json` and wrecks from the save, so they
 * aren't listed here.
 *
 * Ranges are real meters (the chart's), not zone meters: a zone's 1 m is `compression`
 * real meters there.
 */

export const DISCOVERY_KINDS = ['poi', 'wonder', 'anchorage', 'shoal'] as const;
export type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];

export const discoveryDefSchema = z.object({
  id: z.string().regex(/^(poi|wonder|anchorage|shoal)\.[a-z0-9_]+$/),
  kind: z.enum(DISCOVERY_KINDS),
  name: z.string().min(1),
  at: geoSchema,
  /** The island it's on or off, for the journal. */
  island: idOf('island').optional(),
  /**
   * A lookout notes it from this far by day in clear weather (POIs and wonders). Coves and
   * shoals aren't charted by looking: they're charted by sailing into `radiusM`.
   */
  sightM: z.number().positive().optional(),
  /** How far the cove or shoal reaches: sail inside it to chart it, real meters. */
  radiusM: z.number().positive().optional(),
  /** The Lake Survey sheet that has it, if one does (anchorages and shoals). */
  survey: idOf('survey').optional(),
  /** Fame for being the one to see it (wonders; plan 11 §7.1 "small Fame"). */
  fame: z.number().nonnegative().optional(),
  /** The journal's line. */
  text: z.string().min(1),
  /**
   * Saloon talk of it (a `place` rumor; plan 05 §9): the ports that tell it and the lines.
   * Heard, it goes on the chart as reported until it's seen.
   */
  talk: z
    .object({ ports: z.array(idOf('port')).min(1), lines: z.array(z.string().min(1)).min(1) })
    .optional(),
});
export type DiscoveryDef = z.infer<typeof discoveryDefSchema>;

/** A Lake Survey sheet sold at a chandlery: it charts its coves and shoals. */
export const surveyDefSchema = z.object({
  id: idOf('survey'),
  name: z.string().min(1),
});

/**
 * Where each legend is told to lie (plan 11 §8), for the lead its first telling opens: a
 * large circle the clues of piece T shrink.
 */
export const legendAreaSchema = z.object({
  id: idOf('legend'),
  at: geoSchema,
  radiusM: z.number().positive(),
  /** "Off Long Island", for the journal. */
  where: z.string().min(1),
});

export const discoveriesFileSchema = z
  .object({
    places: z.array(discoveryDefSchema),
    surveys: z.array(surveyDefSchema),
    legends: z.array(legendAreaSchema),
    /** The smallest a lead's circle shrinks to before it's a map (real meters). */
    leadMinRadiusM: z.number().positive(),
    /** Each clue takes the circle down to this share of what it was. */
    leadShrink: z.number().gt(0).lt(1),
  })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    for (const p of f.places) {
      if (ids.has(p.id)) ctx.addIssue({ code: 'custom', message: `duplicate place ${p.id}` });
      ids.add(p.id);
      if (!p.id.startsWith(`${p.kind}.`)) {
        ctx.addIssue({ code: 'custom', message: `${p.id} is not a ${p.kind}` });
      }
      const water = p.kind === 'anchorage' || p.kind === 'shoal';
      if (water && !p.radiusM) {
        ctx.addIssue({ code: 'custom', message: `${p.id} needs radiusM` });
      }
      if (!water && !p.sightM) ctx.addIssue({ code: 'custom', message: `${p.id} needs sightM` });
      if (p.survey && !f.surveys.some((s) => s.id === p.survey)) {
        ctx.addIssue({ code: 'custom', message: `${p.id}: unknown ${p.survey}` });
      }
    }
  });
export type DiscoveriesFile = z.infer<typeof discoveriesFileSchema>;

/** Curios (plan 11 §7.1, §14 `curios.json`): unique things to keep and show at a hideout. */
export const curioDefSchema = z.object({
  id: idOf('curio'),
  name: z.string().min(1),
  /** The catalog's line: what it is and where such a thing comes from. */
  text: z.string().min(1),
});
export type CurioDef = z.infer<typeof curioDefSchema>;
export const curiosFileSchema = z.array(curioDefSchema);
