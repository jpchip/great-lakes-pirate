import type { JailFile } from '../../data/schemas/jail';
import type { Chart } from '../core/coords';
import {
  advanceGameTime,
  dayAndHour,
  WORLD_TICK_GAME_SECONDS,
  SECONDS_PER_GAME_DAY,
} from '../core/time';
import type { GameContext, GameEvents } from '../modes/context';
import type { GameEconomy } from './economy';
import type { GameLaw } from './law';
import { emitLaw } from './law';
import { gameEconomy, portInfo } from '../sim/economy/defs';
import { formatCents } from '../sim/economy/knowledge';
import { siteDef } from '../sim/hideouts/stash';
import { tierDef, wantedTier } from '../sim/law/defs';
import {
  gameJail,
  imprison,
  release,
  sendWord,
  settleImpound,
  strongboxes,
  wordCost,
  wordRefusal,
  type Jailed,
  type WordRefusal,
} from '../sim/law/jail';
import { regionAtChart } from '../sim/law/regions';
import { dateText } from '../sim/run/run-end';
import type { JailActions, JailSnapshot, ReleaseSnapshot } from '../ui/jail/model';

/**
 * Capture, jail and release in the running game (plan 06 §8, plan 12 §8.1; Phase 5 piece
 * D). Piece C's cutter raises `PlayerCaptured` when she takes the ship; once the arena has
 * ended, the game calls `takeNow` and the captain is in the lockup (or bound for the rope
 * at tier 5) with the jail screen up. Serving the sentence or bail sent for by word runs
 * the clock on as a batch (the world ticks: prices, traffic, decay), then the release
 * screen tells what changed, and the ship is back alongside the lockup's pier.
 */

export type CaptureEvent = GameEvents['PlayerCaptured'];

export interface CaptureOptions {
  ctx: GameContext;
  law: GameLaw;
  economy: GameEconomy;
  /** The run's seed: the messenger's delay is the same after a reload. */
  seed: string;
  jail?: JailFile;
  /** Shows the jail screen (undefined closes it). */
  show(snapshot: JailSnapshot | undefined): void;
  /** The jail screen opened or closed: pause the game and take the keys. */
  onOpen(open: boolean): void;
  /** After the clock ran on: the weather catches up. */
  afterSkip(): void;
  /** Where the cutter is on the chart, for the release news. */
  cutterAt(): Chart | undefined;
  /** Puts the ship back alongside the lockup's pier, out of the impound. */
  backAboard(): Promise<void>;
  /** The run is over (the rope). */
  endRun(cause: 'executed'): Promise<void>;
  save(): Promise<void>;
}

export interface CaptureControl {
  /** A capture waiting for the arena to end. */
  readonly pending: CaptureEvent | undefined;
  readonly open: boolean;
  /** Jails the pending capture now (or the one given). */
  takeNow(e?: CaptureEvent): void;
  /** Shows the jail screen for a run loaded in jail. */
  resume(): void;
  actions: JailActions;
  dispose(): void;
}

const WORD_REFUSALS: Record<WordRefusal, string> = {
  execution: 'Nobody posts bail for a captain the law means to hang.',
  sent: 'Word is already on its way.',
  noStrongbox: 'You have no strongbox to send word to.',
  short: "There isn't enough in the strongbox for bail, the ship and the messenger.",
};

const JAILBREAK_NOT_YET =
  'No way out of the lockup yet: the jailbreak comes with the docks district in a later version.';
const GALLOWS_NOT_YET =
  'ONE CHANCE: the jailbreak before the hanging comes with the docks district in a later version. Not yet.';

function byName(by: string): string {
  return by === 'law.chartered_tug' ? 'the chartered tug' : 'the revenue cutter Morrill';
}

function weeks(n: number): string {
  return `${n} week${n === 1 ? '' : 's'}`;
}

export function attachCapture(opts: CaptureOptions): CaptureControl {
  const { ctx, law } = opts;
  const defs = law.defs;
  const jail = opts.jail ?? gameJail();
  const state = ctx.state;
  const now = (): number => state.environment.clock.gameSeconds;
  const regionName = (id: string): string => defs.regionById.get(id)?.name ?? id;
  const lockupName = (): string => jail.lockup.name;
  let pending: CaptureEvent | undefined;
  let open = false;
  let released: ReleaseSnapshot | undefined;

  /** One world tick, as the sailing mode runs it. */
  const tick = (): void => {
    const clock = state.environment.clock;
    const before = dayAndHour(clock.gameSeconds).day;
    const n = advanceGameTime(clock, WORLD_TICK_GAME_SECONDS);
    for (let i = 0; i < n; i++) ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
    const after = dayAndHour(clock.gameSeconds).day;
    if (after !== before) ctx.events.emit('DayChanged', { day: after });
  };
  const runOnTo = (until: number): void => {
    while (now() < until) tick();
    opts.afterSkip();
  };

  const taken = (j: Jailed): string =>
    `Taken by ${byName(j.by)} in ${regionName(j.region)}, the week of ${dateText(j.since)}`;
  const confiscated = (j: Jailed): string[] => {
    const goods = gameEconomy().goods;
    const lines = j.confiscated.cargo.map(
      (c) => `${c.qty} CU of ${goods.get(c.good)?.name ?? c.good}`,
    );
    if (j.confiscated.cashCents > 0) lines.push(`${formatCents(j.confiscated.cashCents)} in cash`);
    return lines.length > 0 ? lines : ['Nothing: the hold and the purse were empty'];
  };

  const snapshot = (): JailSnapshot | undefined => {
    if (released) return released;
    const j = state.jail;
    if (!j) return undefined;
    if (j.execution) {
      return {
        kind: 'gallows',
        lockup: lockupName(),
        taken: taken(j),
        confiscated: confiscated(j),
        jailbreak: GALLOWS_NOT_YET,
      };
    }
    const refusal = wordRefusal(jail, state, undefined);
    const cost = wordCost(jail, j);
    return {
      kind: 'cell',
      lockup: lockupName(),
      taken: taken(j),
      tierName: tierDef(defs, j.tier).name,
      sentenceWeeks: j.sentenceWeeks,
      releaseText: `Out the week of ${dateText(j.releaseAt)}`,
      confiscated: confiscated(j),
      bail: formatCents(j.bailCents, true),
      impound: formatCents(j.impoundCents, true),
      wordFee: formatCents(jail.sendWord.feeCents, true),
      wordTotal: formatCents(cost, true),
      wordOptions: strongboxes(state).map((b) => ({
        hideout: b.id,
        name: siteDef(state.hideouts?.[b.id]?.siteId ?? '')?.shortName ?? b.id,
        cash: `${formatCents(b.cash, true)} in the strongbox`,
        enough: b.cash >= cost,
      })),
      wordSent: j.word ? `Word is on its way: out ${dateText(j.word.arrivesAt)}` : undefined,
      wordRefusal: refusal && refusal !== 'execution' ? WORD_REFUSALS[refusal] : undefined,
      jailbreak: JAILBREAK_NOT_YET,
    };
  };

  const refresh = (): void => opts.show(snapshot());
  const setOpen = (next: boolean): void => {
    if (open === next) return;
    open = next;
    opts.onOpen(next);
  };

  const takeNow = (e = pending): void => {
    pending = undefined;
    if (!e || state.jail) return;
    const j = imprison(defs, jail, state, { region: e.region, by: e.by, how: e.how }, now());
    opts.economy.syncLoad();
    ctx.events.emit('Jailed', {
      region: j.region,
      port: j.port,
      tier: j.tier,
      sentenceWeeks: j.sentenceWeeks,
      execution: j.execution,
    });
    released = undefined;
    setOpen(true);
    refresh();
    // In the lockup (or awaiting the rope) is saved at once: a reload comes back to it.
    void opts.save();
  };

  /** The prices at the lockup's port, to tell what moved while you were inside. */
  const pricesAt = (): Map<string, number> =>
    new Map(opts.economy.prices(jail.lockup.port).map((p) => [p.good, p.sellCents]));
  const tiers = (): Map<string, number> =>
    new Map(Object.entries(state.wanted).map(([r, w]) => [r, wantedTier(defs, w.heat)]));

  const letOut = (): void => {
    const j = state.jail;
    if (!j || j.execution) return;
    const before = { prices: pricesAt(), tiers: tiers(), at: now() };
    const paidFrom = j.word ? undefined : settleImpound(jail, state);
    runOnTo(state.jail?.releaseAt ?? now());
    const r = release(defs, jail, state, now());
    for (const e of r.events) emitLaw(ctx, e);
    const served = Math.max(1, Math.round(r.insideS / SECONDS_PER_GAME_DAY));
    ctx.events.emit('Released', { how: r.how, region: r.region, weeks: served });
    released = {
      kind: 'released',
      title: r.how === 'bail' ? 'Out on bail' : 'Time served',
      lead:
        r.how === 'bail'
          ? `Word came back with the money after ${weeks(served)} in ${lockupName()}. ${regionName(r.region)} has you down as ${tierDef(defs, wantedTier(defs, r.heatAfter)).name} now.`
          : `${weeks(served)} in ${lockupName()}${r.workOffDays > 0 ? `, ${weeks(r.workOffDays)} of it working off the ship's fee on the coal dock` : ''}. ${regionName(r.region)} has you down as ${tierDef(defs, wantedTier(defs, r.heatAfter)).name} now.`,
      inside: insideNews(before),
      ship:
        r.how === 'bail'
          ? `The ${state.player.captain.shipName} is alongside at ${portInfo(jail.lockup.port)?.name ?? 'the pier'}, paid out of the impound with the bail.`
          : paidFrom
            ? `The ${state.player.captain.shipName} is alongside, the impound fee paid out of the strongbox at ${siteDef(state.hideouts?.[paidFrom]?.siteId ?? '')?.shortName ?? 'the stash'}.`
            : r.workOffDays > 0
              ? `The ${state.player.captain.shipName} is alongside, her fee worked off.`
              : `The ${state.player.captain.shipName} is alongside.`,
    };
    refresh();
    void opts.save();
  };

  /** "While you were inside..." (plan 12 §8.1): the date, prices, the cutter, Wanted. */
  const insideNews = (before: {
    prices: Map<string, number>;
    tiers: Map<string, number>;
    at: number;
  }): string[] => {
    const lines = [
      `It's the week of ${dateText(now())}; you went in the week of ${dateText(before.at)}.`,
    ];
    const after = pricesAt();
    const goods = gameEconomy().goods;
    const moves = [...after]
      .map(([good, cents]) => ({ good, cents, was: before.prices.get(good) ?? cents }))
      .filter((m) => m.was > 0 && Math.abs(m.cents - m.was) / m.was >= 0.1)
      .sort((a, b) => Math.abs(b.cents - b.was) / b.was - Math.abs(a.cents - a.was) / a.was)
      .slice(0, 3);
    const port = portInfo(jail.lockup.port)?.name ?? 'port';
    if (moves.length === 0) lines.push(`Prices at ${port} are much as they were.`);
    for (const m of moves) {
      lines.push(
        `${goods.get(m.good)?.name ?? m.good} at ${port} ${m.cents > m.was ? 'went up' : 'fell'} to ${formatCents(m.cents)} a CU (was ${formatCents(m.was)}).`,
      );
    }
    const cutter = opts.cutterAt();
    if (cutter)
      lines.push(`The Morrill was last seen in ${regionName(regionAtChart(defs, cutter))}.`);
    const now_ = tiers();
    for (const [region, was] of before.tiers) {
      const is = now_.get(region) ?? 0;
      if (is < was) {
        lines.push(`${regionName(region)} has cooled to ${tierDef(defs, is).name}.`);
      }
    }
    return lines;
  };

  const offs = [
    ctx.events.on('PlayerCaptured', (e) => {
      if (!state.jail && !pending) pending = e;
    }),
  ];

  const actions: JailActions = {
    serve() {
      if (!state.jail || state.jail.execution || released) return;
      letOut();
    },
    sendWord(hideout) {
      const j = state.jail;
      if (!j || released) return;
      const why = sendWord(jail, state, hideout, opts.seed, now());
      if (why) {
        refresh();
        return;
      }
      ctx.events.emit('BailSent', { hideout, cents: j.word?.paidCents ?? 0 });
      letOut();
    },
    jailbreak() {
      refresh();
    },
    hang() {
      if (!state.jail?.execution) return;
      void opts.endRun('executed');
    },
    leave() {
      if (!released) return;
      released = undefined;
      opts.show(undefined);
      void opts.backAboard().finally(() => setOpen(false));
    },
  };

  return {
    get pending() {
      return pending;
    },
    get open() {
      return open;
    },
    takeNow,
    resume() {
      if (!state.jail) return;
      setOpen(true);
      refresh();
    },
    actions,
    dispose: () => offs.forEach((off) => off()),
  };
}
