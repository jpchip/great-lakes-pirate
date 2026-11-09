import type { EconomyDefs } from '../sim/economy/defs';
import { backgroundDef } from '../sim/character/backgrounds';
import {
  completeStep,
  firstWeekComplete,
  firstWeekLines,
  stepForEvent,
  type FirstWeekLine,
  type FirstWeekStep,
} from '../sim/character/first-week';
import { firstWeekContext } from '../sim/character/new-run';
import { recordFishPrices } from '../sim/character/perks';
import { log } from '../sim/run/record';
import type { GameContext } from '../modes/context';

export const FIRST_WEEK_LOGBOOK_LINE = 'Stood the first week.';

/**
 * The captain in the running game (Phase 4 piece C): the Fisherman's fish prices kept
 * current on the world tick, and the First Week checklist ticked off from the bus. Every
 * event goes through the bus's tap, so steps raised by pieces E, F and K (by name) tick
 * without this file knowing their types.
 */

export interface FirstWeekSnapshot {
  lines: FirstWeekLine[];
  complete: boolean;
  hidden: boolean;
  /** The step just done, for a moment on the tracker. */
  justDone: FirstWeekStep | undefined;
}

export interface CaptainControl {
  /** The checklist as it stands; undefined for a run without one. */
  firstWeek(): FirstWeekSnapshot | undefined;
  /** Put the tracker away (or bring it back); the journal keeps the list. */
  setHidden(hidden: boolean): void;
  /** Drop the finished week's mark from the journal. */
  clearFirstWeek(): void;
  dispose(): void;
}

export function attachCaptain(
  ctx: GameContext,
  defs: EconomyDefs,
  onFirstWeek: (snapshot: FirstWeekSnapshot | undefined) => void,
): CaptainControl {
  const state = ctx.state;
  let justDone: FirstWeekStep | undefined;

  const snapshot = (): FirstWeekSnapshot | undefined => {
    const fw = state.firstWeek;
    if (!fw || fw.cleared) return undefined;
    const c = firstWeekContext(state.player.captain.background);
    return {
      lines: firstWeekLines(fw, c),
      complete: firstWeekComplete(fw),
      hidden: fw.hidden,
      justDone,
    };
  };

  // The Fisherman reads the fish market everywhere, every week (plan 12 §2.2).
  const offTick = ctx.events.on('WorldTick', () => recordFishPrices(state, defs));
  recordFishPrices(state, defs);

  const offTap = ctx.events.tap((type, payload) => {
    const fw = state.firstWeek;
    if (!fw) return;
    const cargoGood = backgroundDef(state.player.captain.background).cargo[0]?.good ?? '';
    const step = stepForEvent(String(type), payload, { cargoGood });
    if (step && completeStep(fw, step)) {
      justDone = step;
      if (firstWeekComplete(fw)) {
        fw.hidden = true;
        log(state, state.environment.clock.gameSeconds, FIRST_WEEK_LOGBOOK_LINE);
      }
      onFirstWeek(snapshot());
    }
  });
  const fw0 = state.firstWeek;
  if (fw0 && firstWeekComplete(fw0) && !fw0.cleared) fw0.hidden = true;
  onFirstWeek(snapshot());

  return {
    firstWeek: snapshot,
    setHidden(hidden) {
      if (!state.firstWeek) return;
      state.firstWeek.hidden = hidden;
      onFirstWeek(snapshot());
    },
    clearFirstWeek() {
      if (!state.firstWeek) return;
      state.firstWeek.cleared = true;
      onFirstWeek(snapshot());
    },
    dispose() {
      offTick();
      offTap();
    },
  };
}
