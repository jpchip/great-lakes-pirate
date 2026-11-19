import { z } from 'zod';
import { idOf } from './common';

/**
 * Poker night (plan 12 §5.3, plan 11 §18.4 piece C; `poker.json`): five-card draw at a
 * saloon's card table after dark, against two or three captains drawn from `captains`.
 * Limit betting in antes, one draw, a shown pot. A captain may put up a marker on a hand
 * (a lot of his cargo, a freight contract he carries, a map to a cache) as a side stake
 * you match with cash, a lot of your own or a contract of yours. Cheating is a sleight
 * check against the table's eyes; caught, it's a beating or a brawl (assault).
 */

export const POKER_STYLES = ['tight', 'loose', 'bold', 'cagey'] as const;
export type PokerStyle = (typeof POKER_STYLES)[number];

export const MARKER_KINDS = ['cargo', 'contract', 'map'] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

const styleSchema = z.object({
  /** Facing a bet, he folds below this strength (0–1, the hand's rank among all hands). */
  fold: z.number().min(0).max(1),
  /** With nothing to call, he bets above this. */
  bet: z.number().min(0).max(1),
  /** Facing a bet, he raises above this. */
  raise: z.number().min(0).max(1),
  /** The chance he bets or raises on nothing. */
  bluff: z.number().min(0).max(1),
});

export const pokerCaptainSchema = z.object({
  id: idOf('gambler'),
  /** "Captain Abel Hale". Fictional (plan 05 §10). */
  name: z.string().min(1),
  /** His boat, for the table's line: "of the *Ida May*". */
  ship: z.string().min(1),
  style: z.enum(POKER_STYLES),
  /** How sharp he is for a sleight of hand, 0–1. */
  eye: z.number().min(0).max(1),
  /** His tells: shown when his hand is strong and when it's weak. */
  tells: z.object({ strong: z.string().min(1), weak: z.string().min(1) }),
  /** The chance his tell tells the truth; otherwise it shows the other one. */
  honesty: z.number().min(0).max(1),
  /** Ports whose saloons he sits in. */
  ports: z.array(idOf('port')).min(1),
});
export type PokerCaptain = z.infer<typeof pokerCaptainSchema>;

export const pokerFileSchema = z
  .object({
    rules: z.object({
      /** Game hours the table sits, [from, to) (wraps past midnight). */
      hours: z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)]),
      /** Hands dealt in a night before the keeper puts out the lamps. */
      handsPerNight: z.number().int().positive(),
      /** The ante by port, cents; `default` elsewhere. */
      anteCents: z.record(z.string(), z.number().int().positive()),
      /** Poker night (the event) at a port multiplies its ante. */
      eventAnte: z.number().min(1),
      /** A bet, in antes, before the draw and after it (limit poker). */
      betAntes: z.tuple([z.number().int().positive(), z.number().int().positive()]),
      /** Bets and raises a round, the opening bet included. */
      raisesPerRound: z.number().int().positive(),
      /** Cards you may draw; with an ace kept, one more. */
      maxDraw: z.number().int().min(0).max(5),
      /** Captains at the table, [min, max]. */
      seats: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
      /** A captain's stack at sitting down, in antes. */
      stackAntes: z.tuple([z.number().int().positive(), z.number().int().positive()]),
      /** Below this many antes a captain leaves the table. */
      leaveAntes: z.number().int().positive(),
      /** The noise on a captain's read of his own hand. */
      noise: z.number().min(0).max(0.5),
      styles: z.record(z.enum(POKER_STYLES), styleSchema),
      markers: z.object({
        /** The chance a night's table has a captain with a marker; certain on poker night. */
        chance: z.number().min(0).max(1),
        /** Weights in the draw, where the kind can be had at all. */
        weights: z.record(z.enum(MARKER_KINDS), z.number().nonnegative()),
        /** A cargo marker's CU. */
        cargoQty: z.tuple([z.number().int().positive(), z.number().int().positive()]),
        /** Your own stake must be worth this share of his marker, at least. */
        matchShare: z.number().min(0).max(2),
      }),
      sleight: z.object({
        /** The chance a palmed card goes unseen, before the eyes at the table. */
        base: z.number().min(0).max(1),
        /** Taken off it for each captain still in the hand, times his eye. */
        perEye: z.number().min(0).max(1),
        /** Taken off it for each card you've palmed at this table tonight. */
        perCheat: z.number().min(0).max(1),
        /** The chance never goes below or above these. */
        floor: z.number().min(0).max(1),
        ceiling: z.number().min(0).max(1),
      }),
      caught: z.object({
        /** Game days you're barred from the port's table. */
        barredDays: z.number().positive(),
        /** Standing at the port, either way. */
        standing: z.number(),
        /** Taking your licking costs this share of your purse besides the pot (a fine-ish). */
        beatingShare: z.number().min(0).max(1),
        /** Swinging first is this crime. */
        crime: idOf('crime'),
      }),
    }),
    captains: z.array(pokerCaptainSchema).min(3),
  })
  .superRefine((f, ctx) => {
    if (f.rules.seats[0] > f.rules.seats[1]) {
      ctx.addIssue({ code: 'custom', message: 'seats: min above max' });
    }
    const ids = new Set<string>();
    for (const c of f.captains) {
      if (ids.has(c.id)) ctx.addIssue({ code: 'custom', message: `duplicate captain ${c.id}` });
      ids.add(c.id);
    }
    if (f.rules.anteCents['default'] === undefined) {
      ctx.addIssue({ code: 'custom', message: 'anteCents needs a default' });
    }
  });
export type PokerFile = z.infer<typeof pokerFileSchema>;
export type PokerRules = PokerFile['rules'];
