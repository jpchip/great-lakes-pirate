import { calendarDate } from '../core/time';
import type { GameContext } from '../modes/context';
import {
  AMBITIONS,
  ambitionDef,
  ambitionProgress,
  bumpCounter,
  checkAmbitions,
  clearMark,
  counterForEvent,
  createAmbitions,
  isDone,
  piecesAt,
  pinAmbition,
  rewardText,
  stopMostWanted,
  trackMostWanted,
  unpinAmbition,
  type AmbitionsState,
  type AmbitionWorld,
} from '../sim/character/ambitions';
import { fameTier, fameTierName, topWantedTier, wantedTier, type LawDefs } from '../sim/law/defs';
import { gainFame } from '../sim/law/law';
import { log } from '../sim/run/record';
import type { AmbitionCategory, AmbitionDef } from '../../data/schemas/ambitions';
import { emitLaw } from './law';

/**
 * Ambitions in the running game (plan 12 §4.1; Phase 8 piece H). Counts the bus's feats
 * (by name, through its tap), keeps the Most Wanted clock on the world tick, and checks
 * every goal whenever something it measures may have moved. A goal met is done whether
 * it was pinned or not: the reward is paid (cash to the purse, Fame through the law), the
 * logbook gets its line, and `AmbitionCompleted` sends the papers their story.
 */

const CATEGORY_NAMES: Record<AmbitionCategory, string> = {
  wealth: 'Wealth',
  infamy: 'Infamy',
  trade: 'Trade',
  seamanship: 'Seamanship',
  builder: 'Builder',
};

/** How long the HUD shows a goal just done, game seconds (about two real minutes at sea). */
const JUST_DONE_S = 2 * 3600;

export interface AmbitionRow {
  id: string;
  name: string;
  text: string;
  category: AmbitionCategory;
  categoryName: string;
  pinned: boolean;
  fraction: number;
  progress: string;
  reward: string;
}

export interface AmbitionMark {
  id: string;
  name: string;
  category: AmbitionCategory;
  /** "A bank draft". */
  markName: string;
  legend: string;
  /** "Wk of Jun 4, 1900". */
  dateText: string;
  reward: string;
}

export interface AmbitionsSnapshot {
  maxPinned: number;
  /** Pinned, in pin order. */
  pinned: AmbitionRow[];
  /** Every goal not yet done, in catalog order. */
  open: AmbitionRow[];
  /** Done and not cleared, newest first. */
  marks: AmbitionMark[];
  /** Done in all (cleared ones too). */
  doneCount: number;
  total: number;
  folded: boolean;
  /** One just done, for a moment on the HUD. */
  justDone: { name: string; reward: string } | undefined;
  /** Why the last pin was refused, if it was. */
  refusal: string | undefined;
}

export interface AmbitionsControl {
  snapshot(): AmbitionsSnapshot;
  pin(id: string): string | undefined;
  unpin(id: string): void;
  clearMark(id: string): void;
  setFolded(folded: boolean): void;
  /** Checks every goal now (after a dev hook moves the state). */
  check(): AmbitionDef[];
  readonly state: AmbitionsState;
  dispose(): void;
}

export function weekText(gameSeconds: number): string {
  const d = calendarDate(gameSeconds);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `Wk of ${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function attachAmbitions(
  ctx: GameContext,
  lawDefs: LawDefs,
  onChange: (snapshot: AmbitionsSnapshot) => void,
): AmbitionsControl {
  const state = ctx.state;
  const amb = (state.ambitions ??= createAmbitions());
  const now = (): number => state.environment.clock.gameSeconds;
  let justDone: { name: string; reward: string; at: number } | undefined;
  let refusal: string | undefined;

  const world = (): AmbitionWorld => {
    const hideouts = Object.values(state.hideouts ?? {});
    return {
      now: now(),
      hideoutCashCents: hideouts.reduce((sum, h) => sum + (h.storage?.cash ?? 0), 0),
      fameTier: fameTier(lawDefs, state.fame.value),
      fameTierName: (t) => fameTierName(lawDefs, t),
      portStanding: Object.entries(state.player.standing ?? {})
        .filter(([id]) => id.startsWith('port.'))
        .map(([, v]) => v),
      hideouts: hideouts.length,
      maxHideoutPieces: hideouts.reduce((m, h) => Math.max(m, piecesAt(h)), 0),
    };
  };

  const row = (def: AmbitionDef, w: AmbitionWorld): AmbitionRow => {
    const p = ambitionProgress(def, amb, w);
    return {
      id: def.id,
      name: def.name,
      text: def.text,
      category: def.category,
      categoryName: CATEGORY_NAMES[def.category],
      pinned: amb.pinned.includes(def.id),
      fraction: p.fraction,
      progress: p.text,
      reward: rewardText(def),
    };
  };

  const snapshot = (): AmbitionsSnapshot => {
    const w = world();
    const marks: AmbitionMark[] = [];
    for (const d of [...amb.done].reverse()) {
      const def = ambitionDef(d.id);
      if (!def || amb.cleared.includes(d.id)) continue;
      const mark = AMBITIONS.marks[def.category];
      marks.push({
        id: def.id,
        name: def.name,
        category: def.category,
        markName: mark.name,
        legend: mark.legend,
        dateText: weekText(d.at),
        reward: rewardText(def),
      });
    }
    const showJust = justDone && now() - justDone.at < JUST_DONE_S ? justDone : undefined;
    return {
      maxPinned: AMBITIONS.maxPinned,
      pinned: amb.pinned.flatMap((id) => {
        const def = ambitionDef(id);
        return def ? [row(def, w)] : [];
      }),
      open: AMBITIONS.ambitions.filter((a) => !isDone(amb, a.id)).map((a) => row(a, w)),
      marks,
      doneCount: amb.done.length,
      total: AMBITIONS.ambitions.length,
      folded: !!amb.folded,
      justDone: showJust && { name: showJust.name, reward: showJust.reward },
      refusal,
    };
  };

  const notify = (): void => onChange(snapshot());

  const pay = (def: AmbitionDef): void => {
    const t = now();
    state.player.purse += def.reward.cents;
    if (def.reward.fame > 0) {
      const e = gainFame(lawDefs, state, def.reward.fame, t);
      if (e) emitLaw(ctx, e);
    }
    log(state, t, def.logbook);
    justDone = { name: def.name, reward: rewardText(def), at: t };
    ctx.events.emit('AmbitionCompleted', {
      id: def.id,
      category: def.category,
      cents: def.reward.cents,
      fame: def.reward.fame,
    });
  };

  const check = (): AmbitionDef[] => {
    const done = checkAmbitions(amb, world());
    for (const def of done) pay(def);
    return done;
  };

  /** The fingerprint of what the HUD shows, so a tick that moved nothing doesn't redraw. */
  let shown = '';
  const refresh = (force = false): void => {
    const done = check();
    const s = snapshot();
    const key = JSON.stringify([s.pinned.map((r) => r.progress), s.justDone, s.marks.length]);
    if (force || done.length || key !== shown) {
      shown = key;
      onChange(s);
    }
  };

  const mostWantedRegions = (): string[] => {
    const top = topWantedTier(lawDefs);
    return Object.entries(state.wanted)
      .filter(([, w]) => wantedTier(lawDefs, w.heat) >= top)
      .map(([r]) => r);
  };

  const offs = [
    ctx.events.on('WorldTick', () => {
      if (!state.jail) trackMostWanted(amb, mostWantedRegions(), now());
      refresh();
    }),
    // Taken: you weren't at large after all, and the week starts again.
    ctx.events.on('PlayerCaptured', () => stopMostWanted(amb)),
    ctx.events.on('Jailed', () => stopMostWanted(amb)),
    ctx.events.tap((type, payload) => {
      if (type === 'AmbitionCompleted' || type === 'AmbitionPinned') return;
      const counter = counterForEvent(String(type), payload, now());
      if (counter) bumpCounter(amb, counter);
      if (
        counter ||
        type === 'StorageChanged' ||
        type === 'FameChanged' ||
        type === 'ContractCompleted'
      ) {
        refresh();
      }
    }),
  ];
  // Regions already Most Wanted on load start their clock now.
  if (!state.jail) trackMostWanted(amb, mostWantedRegions(), now());
  // A goal met while it wasn't counted (a run from before Ambitions) is done on load.
  check();
  notify();

  return {
    snapshot,
    pin(id) {
      refusal = pinAmbition(amb, id);
      if (!refusal) ctx.events.emit('AmbitionPinned', { id, pinned: true });
      notify();
      return refusal;
    },
    unpin(id) {
      refusal = undefined;
      if (unpinAmbition(amb, id)) ctx.events.emit('AmbitionPinned', { id, pinned: false });
      notify();
    },
    clearMark(id) {
      clearMark(amb, id);
      notify();
    },
    setFolded(folded) {
      amb.folded = folded;
      notify();
    },
    check() {
      const done = check();
      notify();
      return done;
    },
    state: amb,
    dispose() {
      for (const off of offs) off();
    },
  };
}
