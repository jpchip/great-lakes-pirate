import type { AftermathChoice } from '../../sim/boarding/aftermath';

/**
 * What the boarding screens show (plan 13 "boarding panel, looting, aftermath"; Phase 6
 * piece D): the panel's odds before you commit, her hold against yours, and the four
 * choices for her and her crew with what each costs. Built by `gameplay/boarding.ts`.
 */
export interface BoardingSnapshot {
  stage: 'panel' | 'loot' | 'aftermath';
  shipId: string;
  shipName: string;
  className: string;
  ownerName?: string;
  struck: boolean;
  /** Hands alive aboard her, of them wounded; and killed so far. */
  crew: number;
  wounded: number;
  killed: number;
  morale: number;
  /** A T1: you alone. */
  solo: boolean;
  odds: {
    strength: number;
    defense: number;
    intimidate: number;
    fight: number;
    death: number;
    parts: { label: string; value: number }[];
  };
  intimidateTried: boolean;
  message?: string;
  loot?: {
    lots: {
      key: string;
      name: string;
      category: string;
      qty: number;
      cents?: number;
      minutesPerCu: number;
      quick: boolean;
      unitCents: number;
    }[];
    usedCu: number;
    capacity: number;
    purseCents: number;
    /** Game minutes spent aboard her so far. */
    minutes: number;
    takenCu: number;
    takenCents: number;
    /** Other ships in sight while you work. */
    inSight: number;
  };
  aftermath?: {
    options: {
      choice: AftermathChoice;
      label: string;
      text: string;
      reportText: string;
      deathChance: number;
      allHands: boolean;
    }[];
    weatherText: string;
  };
}

export interface BoardingActions {
  intimidate(): void;
  fight(): void;
  withdraw(): void;
  /** Swings `qty` CU of a lot across; returns why not, or undefined. */
  take(key: string, qty: number): string | undefined;
  quickGrab(): void;
  doneLooting(): void;
  choose(choice: AftermathChoice): void;
  /** Esc: withdraw, stop looting, or let them go. */
  close(): void;
}

/** "62%", or "under 1%" for a small but real chance. */
export function pct(p: number): string {
  if (p <= 0) return '0%';
  if (p < 0.01) return 'under 1%';
  return `${Math.round(p * 100)}%`;
}
