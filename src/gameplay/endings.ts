import { SECONDS_PER_GAME_DAY } from '../core/time';
import type { GameContext } from '../modes/context';
import { eventDef } from '../sim/events/events';
import { stashedCash } from '../sim/hideouts/stash';
import { fameTier, wantedTier, type LawDefs } from '../sim/law/defs';
import {
  ENDINGS,
  eligibility,
  endingForChoice,
  offerEvent,
  type Eligibility,
  type EndingKind,
  type EndingWorld,
} from '../sim/run/endings';
import type { RunEndCause, RunEndDetail } from '../sim/run/run-end';
import type { GameEvents as SandboxEvents } from './events';

/**
 * The voluntary endings in the running game (plan 12 §4.2; Phase 9 piece B). Every few game
 * hours the run is weighed for each: when it qualifies and no offer is standing (or cooling
 * down), the offer goes out as a letter at the harbor masters'. Taking a retirement, or the
 * badge, ends the run with its page; "not yet" and the default when it goes unanswered let
 * it be offered again later.
 */

export interface GameEndings {
  eligibility(kind: EndingKind): Eligibility;
  /** Offers it now if it's due (or `force`d, the dev hook): true when the letter went out. */
  offer(kind: EndingKind, force?: boolean): boolean;
  check(): void;
  dispose(): void;
}

export interface EndingsOptions {
  ctx: GameContext;
  law: LawDefs;
  events: SandboxEvents;
  end(cause: RunEndCause, detail?: RunEndDetail): void;
}

export function attachEndings(opts: EndingsOptions): GameEndings {
  const { ctx } = opts;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const world = (): EndingWorld => {
    const s = ctx.state;
    return {
      wealthCents: s.player.purse + stashedCash(s.hideouts),
      fameTier: fameTier(opts.law, s.fame.value),
      wantedTiers: Object.values(s.wanted).map((w) => wantedTier(opts.law, w.heat)),
      standing: s.player.standing ?? {},
    };
  };
  const due = (kind: EndingKind): boolean => {
    const id = offerEvent(kind);
    const st = opts.events.state;
    if (st.active.some((a) => a.id === id)) return false;
    const last = st.cooldowns[id];
    const cool = (eventDef(id)?.cooldownDays ?? 0) * SECONDS_PER_GAME_DAY;
    return last === undefined || now() - last >= cool;
  };
  const offer = (kind: EndingKind, force = false): boolean => {
    if (!force && (!due(kind) || !eligibility(kind, world()).ok)) return false;
    const r = opts.events.fire(offerEvent(kind));
    if (typeof r === 'string') return false;
    ctx.events.emit('EndingOffered', { kind });
    return true;
  };
  const check = (): void => {
    if (ctx.state.jail) return;
    offer('retire');
    offer('lawman');
  };

  let nextAt = 0;
  const offTick = ctx.events.on('WorldTick', ({ gameSeconds }) => {
    if (gameSeconds < nextAt) return;
    nextAt = gameSeconds + ENDINGS.checkHours * 3600;
    check();
  });
  const offResolved = ctx.events.on('EventResolved', (e) => {
    if (!e.choice) return;
    const ending = endingForChoice(e.id, e.choice);
    if (!ending) return;
    // After the harbor master's tab has taken the answer.
    queueMicrotask(() =>
      ending.kind === 'lawman'
        ? opts.end('lawman')
        : opts.end('retired', { retirement: ending.retirement.id }),
    );
  });

  return {
    eligibility: (kind) => eligibility(kind, world()),
    offer,
    check,
    dispose() {
      offTick();
      offResolved();
    },
  };
}
