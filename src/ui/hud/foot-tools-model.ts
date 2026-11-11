import type { Conduct } from '../../gameplay/onfoot/conduct';
import type { Offer, OnFootTools } from '../../gameplay/onfoot/tools';

/**
 * The tool belt, the conduct line and the prompt (plan 13 §4.2, plan 08 §12; Phase 7
 * piece E), from the tools and conduct as they are: what's in hand and how many, what a
 * guard would make of you if he saw you now, and what F does.
 */

export interface BeltSlot {
  id: string;
  key: string;
  name: string;
  /** "×2", "$50" for the purse, "" for one always to hand, "none". */
  count: string;
  selected: boolean;
  empty: boolean;
  /**
   * Off the belt for now: none of it on you and not in hand (part two's nine tools don't
   * fit beside the light gem otherwise). Its key still takes it in hand, to be told "none".
   */
  hidden: boolean;
}

export interface PromptView {
  key: string;
  label: string;
  ok: boolean;
  why: string;
  /** Hold progress 0–1, for a hold ring. */
  hold01: number;
}

export interface FootToolsSnapshot {
  belt: BeltSlot[];
  /** "Suspicious if seen: Trespassing", empty when nothing's amiss. */
  conduct: string;
  prompt: PromptView | undefined;
  carrying: boolean;
  /** What's in your arms (piece E part two's crates): "A crate of salted fish", or empty. */
  load: string;
}

export function footToolsHud(
  tools: OnFootTools,
  conduct: Conduct,
  offer: Offer | undefined,
  hold01: number,
  purseCents: number,
  /** A lock, a crate or the gangway's prompt (heist.ts), when it's what F does instead. */
  heist?: { prompt: PromptView | undefined; load: string },
): FootToolsSnapshot {
  const belt = tools.defs.belt.map((t, i) => {
    const n = tools.count(t);
    const money = t.kind === 'bribe';
    return {
      id: t.id,
      key: String(i + 1),
      name: t.name,
      count: money
        ? `$${Math.floor(purseCents / 100)}`
        : n === Infinity
          ? ''
          : n > 0
            ? `×${n}`
            : 'none',
      selected: tools.selected.id === t.id,
      empty: money ? purseCents <= 0 : n <= 0,
      hidden: !money && n <= 0 && tools.selected.id !== t.id,
    };
  });
  return {
    belt,
    conduct: conduct.suspect ? `Suspicious if seen: ${conduct.words}` : '',
    prompt: heist?.prompt ?? toolPrompt(offer, hold01),
    carrying: tools.carrying !== undefined || !!heist?.load,
    load: heist?.load ?? '',
  };
}

function toolPrompt(offer: Offer | undefined, hold01: number): PromptView | undefined {
  return offer
    ? {
        key: 'F',
        label: offer.label,
        ok: offer.ok,
        why: offer.why ?? '',
        hold01: offer.holdS > 0 ? Math.min(1, hold01) : 0,
      }
    : undefined;
}
