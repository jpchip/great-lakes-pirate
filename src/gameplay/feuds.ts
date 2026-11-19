import type { FeudDef } from '../../data/schemas/feuds';
import type { GameContext } from '../modes/context';
import {
  createFeud,
  dueBeat,
  enterBeat,
  feudOpen,
  FEUDS,
  noteCrime,
  noteSale,
  pressureOf,
  sellFactor,
  shunsYou,
  yieldFeud,
  type FeudBeat,
  type FeudPressure,
  type FeudState,
} from '../sim/events/feuds';
import type { GameEvents as SandboxEvents } from './events';

/**
 * Feuds in the running game (plan 12 §5.2; Phase 9 piece D): the Hollister feud. Sales at
 * the market, crimes against the company and the clock move it on; each beat fires its
 * sandbox event (a letter from Hollister, talk in the saloons, the papers), and the stage
 * sets what Hollister's buyers pay you for fish at Bayfield, or whether they'll take it at
 * all. Taking Hollister's terms by letter ends it with you giving; enough pressure ends it
 * with Hollister giving.
 */

export interface FeudSellTerms {
  /** A share of the market's price: what the company's buyers pay you. */
  factor: number;
  /** Turned away: why, in a line. */
  refused: string | undefined;
  /** The note on the market row ("Hollister's buyers pay you 60%"). */
  note: string;
}

export interface GameFeuds {
  /** The feud's terms on selling a good at a port, or none where no feud reaches. */
  sellTerms(port: string, good: string): FeudSellTerms | undefined;
  /** Companies whose agents won't deal with you over a feud. */
  shunned(): string[];
  state(id?: string): FeudState;
  pressure(id?: string): FeudPressure;
  /** Moves the feud on now if a beat is due: the beat, or none. */
  check(): FeudBeat | undefined;
  dispose(): void;
}

export interface FeudOptions {
  ctx: GameContext;
  events: SandboxEvents;
  /** A company's short name ("Hollister"). */
  companyName?(company: string): string;
}

export function attachFeuds(opts: FeudOptions): GameFeuds {
  const { ctx, events } = opts;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const feuds = (): Record<string, FeudState> => (ctx.state.feuds ??= {});
  const stateOf = (def: FeudDef): FeudState => (feuds()[def.id] ??= createFeud(now()));
  const standingAt = (def: FeudDef): number => ctx.state.player.standing?.[def.ports[0] ?? ''] ?? 0;
  const short = (def: FeudDef): string => opts.companyName?.(def.company) ?? 'The company';

  const eventFor = (def: FeudDef, beat: FeudBeat): string => {
    switch (beat.kind) {
      case 'gives':
        return def.events.gives[beat.method];
      default:
        return def.events[beat.kind];
    }
  };

  /** Fires every beat that's due, in order (a sale can start it and a crime end it at once). */
  const checkOne = (def: FeudDef): FeudBeat | undefined => {
    const f = stateOf(def);
    let last: FeudBeat | undefined;
    for (let guard = 0; guard < 4; guard++) {
      const beat = dueBeat(def, f, now(), standingAt(def));
      if (!beat) break;
      const fired = events.fire(eventFor(def, beat), def.ports[0]);
      if (typeof fired === 'string') break;
      enterBeat(f, beat, now(), standingAt(def));
      ctx.events.emit('FeudChanged', {
        feud: def.id,
        beat: beat.kind,
        stage: f.stage,
        ...(beat.kind === 'gives' ? { method: beat.method } : {}),
      });
      last = beat;
    }
    return last;
  };
  const check = (): FeudBeat | undefined => {
    let last: FeudBeat | undefined;
    for (const def of FEUDS) last = checkOne(def) ?? last;
    return last;
  };

  const offTrade = ctx.events.on('TradeCompleted', (e) => {
    if (e.side !== 'sell') return;
    for (const def of FEUDS) noteSale(def, stateOf(def), e.port, e.good, e.qty, now());
    check();
  });
  const offCrime = ctx.events.on('CrimeCommitted', (e) => {
    // A copycat's crime (Phase 9 piece E) is no pressure of yours.
    if (!e.company || e.by) return;
    for (const def of FEUDS) {
      if (def.company === e.company) noteCrime(def, stateOf(def), e.crime);
    }
    check();
  });
  const offResolved = ctx.events.on('EventResolved', (e) => {
    for (const def of FEUDS) {
      if (e.id !== def.events.terms || e.choice !== def.events.acceptChoice) continue;
      const f = stateOf(def);
      if (!feudOpen(f)) continue;
      yieldFeud(f, now());
      events.fire(def.events.yielded, def.ports[0]);
      ctx.events.emit('FeudChanged', { feud: def.id, beat: 'yielded', stage: f.stage });
    }
  });
  let lastHour = -1;
  const offTick = ctx.events.on('WorldTick', ({ gameSeconds }) => {
    const hour = Math.floor(gameSeconds / 3600);
    if (hour === lastHour) return;
    lastHour = hour;
    check();
  });

  const pct = (x: number): string => `${Math.round(x * 100)}%`;

  return {
    sellTerms(port, good) {
      for (const def of FEUDS) {
        const f = feuds()[def.id];
        const factor = sellFactor(def, f, port, good);
        if (!f || factor === 1) continue;
        const who = short(def);
        if (factor === 0) {
          return {
            factor,
            refused: `${who}'s buyers won't take your fish at any price.`,
            note: 'Turned away',
          };
        }
        // Undercut or at peace: what Hollister's buyers pay you against the dock's price.
        const note =
          f.stage === 'yielded'
            ? `${who}'s price: ${pct(factor)}`
            : `${who} pays you ${pct(factor)}`;
        return { factor, refused: undefined, note };
      }
      return undefined;
    },
    shunned() {
      return FEUDS.filter((def) => shunsYou(feuds()[def.id])).map((def) => def.company);
    },
    state(id) {
      const def = (id && FEUDS.find((d) => d.id === id)) || FEUDS[0];
      if (!def) throw new Error('No feuds');
      return stateOf(def);
    },
    pressure(id) {
      const def = (id && FEUDS.find((d) => d.id === id)) || FEUDS[0];
      if (!def) throw new Error('No feuds');
      return pressureOf(def, stateOf(def), standingAt(def));
    },
    check,
    dispose() {
      offTrade();
      offCrime();
      offResolved();
      offTick();
    },
  };
}
