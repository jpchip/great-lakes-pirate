import { z } from 'zod';
import { idOf } from './common';
import { WITNESS_KINDS } from './law';
import { geoSchema } from './zones';

/**
 * Copycat rivals (plan 12 §7, plan 07 §8.1; plan 11 §18.4 piece E; `rival_templates.json`).
 * None at the start: once the papers have made you Known (Fame tier 2) a copycat takes up
 * the trade, and up to three sail at once at tiers 3–4. Each is drawn from these templates:
 * a period name and the papers' nickname for them, a personality, a ship a tier at most
 * below yours, a lane where you've been robbing, and a camp on a standard or minor island
 * where they keep their stash.
 *
 * **Methods** are the ways a ship (or a warehouse, or the law) is robbed. Your crimes fill
 * your record by method; a rival copies your leading ones, leaned by their personality.
 * Blame goes by method: the more a rival's raid looks like your work, the likelier the
 * crew says "a schooner" (you) rather than "persons unknown"; and the more your crime looks
 * like theirs, the likelier the weak reports go down against them.
 */

export const RIVAL_PERSONALITIES = ['brute', 'sly', 'showman', 'smuggler'] as const;
export type RivalPersonality = (typeof RIVAL_PERSONALITIES)[number];

export const RIVAL_METHODS = [
  'boarding',
  'guns',
  'sinking',
  'wrecking',
  'smuggling',
  'burglary',
] as const;
export type RivalMethod = (typeof RIVAL_METHODS)[number];

const shares = z.partialRecord(z.enum(RIVAL_METHODS), z.number().nonnegative());

export const rivalMethodSchema = z.object({
  id: z.enum(RIVAL_METHODS),
  /** "boards and strips them", for the papers and the journal. */
  label: z.string().min(1),
  /** Your crimes that count to this method in your record. */
  crimes: z.array(idOf('crime')).min(1),
  /** What a rival commits on a raid by this method, in order. */
  rivalCrimes: z.array(idOf('crime')).min(1),
  /** A raid by this method robs a ship on the rival's lane (else it's ashore or a light). */
  victim: z.boolean(),
  /** Who sees a raid that robs no ship (a watchman, a keeper, a merchant). */
  witness: z.enum(WITNESS_KINDS),
  /** The share of her hold a raid takes, 0–1 (a victim raid). */
  takes: z.number().min(0).max(1).default(0),
  /** A raid sinks her, off her timetable this many game days. */
  sinksDays: z.number().positive().optional(),
});
export type RivalMethodDef = z.infer<typeof rivalMethodSchema>;

export const personalitySchema = z.object({
  id: z.enum(RIVAL_PERSONALITIES),
  name: z.string().min(1),
  /** The journal's line on them. */
  text: z.string().min(1),
  /** What they lean to, before they copy you. */
  lean: shares,
  /** Game days between raids, on average. */
  raidDays: z.number().positive(),
  /** Their own notoriety per point of a raid's heat: the law closes on them faster. */
  heatFactor: z.number().positive(),
  /** The chance a day, once they're settled, that they write proposing a parley. */
  parley: z.number().min(0).max(1),
  /** Which parley they propose: a truce, or a split of the lake. */
  proposes: z.enum(['truce', 'split']),
  /** The chance they betray what was agreed. */
  betray: z.number().min(0).max(1),
  /** The chance a raid of theirs makes a story under their own name in the papers. */
  papers: z.number().min(0).max(1),
  /** Nicknames the papers give them. */
  nicknames: z.array(z.string().min(1)).min(1),
});
export type PersonalityDef = z.infer<typeof personalitySchema>;

export const rivalShipSchema = z.object({
  /** The player tier she's matched to (plan 12 §7: −1 to +0 of yours). */
  tier: z.number().int().min(1).max(3),
  classId: idOf('ship'),
  names: z.array(z.string().min(1)).min(1),
});

export const rivalCampSchema = z.object({
  id: idOf('camp'),
  /** "Cat Island", for the journal and the papers. */
  name: z.string().min(1),
  /** "the lee of Cat Island", where the lead says the stash lies. */
  where: z.string().min(1),
  island: idOf('island'),
  /** The anchorage: where their stash is. */
  at: geoSchema,
});
export type RivalCampDef = z.infer<typeof rivalCampSchema>;

export const rivalTemplatesSchema = z
  .object({
    rules: z.object({
      /** The first comes once your Fame reaches this tier. */
      emergeFameTier: z.number().int().nonnegative(),
      /** At most this many at once, by your Fame tier (index = tier). */
      maxByFameTier: z.array(z.number().int().nonnegative()).min(1),
      /** Game days at the tier before the first (or the next) one appears. */
      emergeAfterDays: z.number().nonnegative(),
      /** And at least this long between one appearing and the next. */
      againDays: z.number().nonnegative(),
      /** The share of a newcomer's methods copied from yours; the rest is their lean. */
      copyShare: z.number().min(0).max(1),
      /** Your record by method halves over this many game days. */
      recordHalfLifeDays: z.number().positive(),
      blame: z.object({
        /** A rival's raid is put to "a schooner" (you) at this times your share of the method. */
        onYou: z.number().min(0).max(1),
        /** Your crime goes down against a rival at this times their share of its method. */
        onThem: z.number().min(0).max(1),
      }),
      /** The law closing on them: a day's chance, at base and per point of their notoriety. */
      caught: z.object({
        base: z.number().min(0).max(1),
        perHeat: z.number().nonnegative(),
        max: z.number().min(0).max(1),
        /** Their notoriety falls by this share a game day. */
        decayPerDay: z.number().min(0).max(1),
      }),
      /** Lost in a gale: the chance a game hour while the storm signal flies in their region. */
      galeLossPerHour: z.number().min(0).max(1),
      /** They retire after this many game days with your Fame below `emergeFameTier`. */
      retireAfterDays: z.number().positive(),
      /** A raid needs the lane's season at least this busy (no prizes in the ice). */
      minSeason: z.number().min(0).max(1),
      /** Fame for beating one (the papers add theirs), and the stash lead's circle. */
      defeatFame: z.number().nonnegative(),
      leadRadiusM: z.number().positive(),
      parley: z.object({
        /** Game days settled before they may write. */
        afterDays: z.number().nonnegative(),
        /** A broken bargain shows this many game days after the meeting. */
        betrayAfterDays: z.number().positive(),
        /** The heat their tip-off puts on you in your hottest region. */
        betrayHeat: z.number().positive(),
        /** Selling them to the law: their notoriety jumps by this. */
        sellHeat: z.number().positive(),
        /** The saloon each region's parley is met in. */
        ports: z.record(idOf('region'), idOf('port')),
      }),
      /** No camp lies closer than this to a hideout site, real meters. */
      keepClearM: z.number().positive(),
    }),
    methods: z.array(rivalMethodSchema).min(1),
    personalities: z.array(personalitySchema).min(1),
    names: z.object({
      first: z.array(z.string().min(1)).min(3),
      last: z.array(z.string().min(1)).min(3),
    }),
    ships: z.array(rivalShipSchema).min(1),
    camps: z.array(rivalCampSchema).min(3),
    /**
     * Hideout sites not yet in `sites.json` (piece W brings the other five): camps keep
     * clear of them too, so a rival is never near a hideout.
     */
    avoid: z.array(z.object({ name: z.string().min(1), at: geoSchema })),
    /** The sandbox events each beat fires (`events.json`, `draw: false`). */
    events: z.object({
      emerges: idOf('event'),
      strikes: idOf('event'),
      parley: idOf('event'),
      meetChoice: z.string().min(1),
      meet: z.record(z.enum(['truce', 'split']), idOf('event')),
      /** The meeting's choices: take the bargain, or sell them to the constable. */
      acceptChoice: z.string().min(1),
      sellChoice: z.string().min(1),
      betrays: idOf('event'),
      caught: idOf('event'),
      lost: idOf('event'),
      retires: idOf('event'),
      defeated: idOf('event'),
    }),
  })
  .superRefine((f, ctx) => {
    for (const m of RIVAL_METHODS) {
      if (!f.methods.some((d) => d.id === m)) {
        ctx.addIssue({ code: 'custom', message: `no method ${m}` });
      }
    }
    for (const p of RIVAL_PERSONALITIES) {
      if (!f.personalities.some((d) => d.id === p)) {
        ctx.addIssue({ code: 'custom', message: `no personality ${p}` });
      }
    }
    const crimes = new Set<string>();
    for (const m of f.methods) {
      for (const c of m.crimes) {
        if (crimes.has(c)) ctx.addIssue({ code: 'custom', message: `${c} in two methods` });
        crimes.add(c);
      }
      if (m.victim && m.takes <= 0 && !m.sinksDays) {
        ctx.addIssue({ code: 'custom', message: `${m.id} robs a ship of nothing` });
      }
    }
    const ids = new Set<string>();
    for (const c of f.camps) {
      if (ids.has(c.id)) ctx.addIssue({ code: 'custom', message: `duplicate camp ${c.id}` });
      ids.add(c.id);
    }
  });
export type RivalTemplates = z.infer<typeof rivalTemplatesSchema>;
