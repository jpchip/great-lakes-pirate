import type { GameContext } from '../modes/context';
import { gameEconomy } from '../sim/economy/defs';
import { formatCents } from '../sim/economy/knowledge';
import { portInfo } from '../sim/economy/defs';
import { crimeDef, fameTier, fameTierName, tierDef, type LawDefs } from '../sim/law/defs';
import { log, statsOf } from '../sim/run/record';

/**
 * The run's record in the running game (plan 12 §9–10; Phase 5 piece D): the counters the
 * end screen's summary reads and the logbook it exports, written from events on the bus.
 * The logbook keeps what a captain would write down: ports made, trades and contracts, the
 * smuggler, the law's word reaching town, the lockup.
 */
/** Who took you on foot (Phase 7 piece D), for the log. */
const ON_FOOT_CAPTOR: Record<string, string> = {
  'npc.watchman': 'a night watchman',
  'npc.constable': 'a constable',
  'npc.marshal': 'a marshal',
};

export function attachRecord(ctx: GameContext, defs: LawDefs): () => void {
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const stats = () => statsOf(ctx.state, now());
  const write = (text: string): void => log(ctx.state, now(), text);
  const good = (id: string): string => gameEconomy().goods.get(id)?.name ?? id;
  const port = (id: string): string => portInfo(id)?.name ?? id;
  const region = (id: string): string => defs.regionById.get(id)?.name ?? id;
  const ev = ctx.events;
  const offs = [
    ev.on('PortVisited', (e) => write(`Made fast at ${port(e.port)}.`)),
    ev.on('TradeCompleted', (e) => {
      if (e.side === 'sell') stats().earnedCents += e.totalCents;
      const verb = e.side === 'sell' ? 'Sold' : 'Bought';
      write(
        `${verb} ${e.qty} CU of ${good(e.good)} at ${port(e.port)} for ${formatCents(e.totalCents)}.`,
      );
    }),
    ev.on('ContrabandSold', (e) => {
      stats().earnedCents += e.totalCents;
      write(`Let ${e.qty} CU of ${good(e.good)} go quietly at ${port(e.port)}.`);
    }),
    ev.on('ContractCompleted', (e) => {
      const s = stats();
      s.contracts += 1;
      s.earnedCents += e.payCents;
      write(
        `Delivered ${e.qty} CU of ${good(e.good)} to ${port(e.to)}${e.late ? ', late' : ''}: paid ${formatCents(e.payCents)}.`,
      );
    }),
    ev.on('ContractStolen', (e) =>
      write(`Sold off a contract's ${good(e.good)} at ${port(e.port)}.`),
    ),
    ev.on('SmugglerDealt', (e) => {
      if (e.side === 'fence') stats().earnedCents += e.totalCents;
      write(
        e.side === 'buy'
          ? `Took ${e.qty} CU of ${good(e.good)} off the island smuggler after dark.`
          : `Passed ${e.qty} CU of ${good(e.good)} to the island smuggler.`,
      );
    }),
    ev.on('CrimeCommitted', () => (stats().crimes += 1)),
    ev.on('ReportFiled', (e) => {
      if (e.heatAdded <= 0) return;
      write(
        `Word reached the law in ${region(e.region)}: ${crimeDef(defs, e.crime).name.toLowerCase()}.`,
      );
    }),
    ev.on('WantedTierChanged', (e) => {
      const s = stats();
      s.peakTier = Math.max(s.peakTier, e.to);
      if (e.to > e.from) write(`${region(e.region)} has me ${tierDef(defs, e.to).name}.`);
    }),
    ev.on('FameChanged', (e) => {
      const s = stats();
      s.peakFame = Math.max(s.peakFame, e.value);
      if (e.tierTo > e.tierFrom)
        write(`The lake calls me ${fameTierName(defs, fameTier(defs, e.value))}.`);
    }),
    ev.on('ShipPurchased', () =>
      write(`Bought a new hull and renamed her ${ctx.state.player.captain.shipName}.`),
    ),
    ev.on('PlayerCaptured', (e) =>
      write(
        e.how === 'subdued'
          ? `Taken ashore by ${ON_FOOT_CAPTOR[e.by] ?? 'the law'} in ${region(e.region)}.`
          : `${e.how === 'surrender' ? 'Hove to for' : 'Boarded by'} the ${e.by === 'law.morrill' ? 'revenue cutter Morrill' : 'chartered tug'} in ${region(e.region)}.`,
      ),
    ),
    ev.on('Jailed', (e) => {
      stats().captures += 1;
      write(
        e.execution
          ? `Sentenced to hang at ${port(e.port)}.`
          : `Locked up at ${port(e.port)}: ${e.sentenceWeeks} week${e.sentenceWeeks === 1 ? '' : 's'}.`,
      );
    }),
    ev.on('Fined', (e) =>
      write(
        `Fined ${formatCents(e.cents)} by ${ON_FOOT_CAPTOR[e.by] ?? 'the law'} in ${region(e.region)}.`,
      ),
    ),
    ev.on('BailSent', (e) =>
      write(`Sent word for bail: ${formatCents(e.cents)} from the strongbox.`),
    ),
    ev.on('Released', (e) =>
      write(
        e.how === 'bail'
          ? 'Out on bail.'
          : `Out of the lockup after ${e.weeks} week${e.weeks === 1 ? '' : 's'}.`,
      ),
    ),
  ];
  return () => offs.forEach((off) => off());
}
