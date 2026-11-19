import type { GameContext } from '../modes/context';
import { gameEconomy } from '../sim/economy/defs';
import { formatCents } from '../sim/economy/knowledge';
import { portInfo } from '../sim/economy/defs';
import { crimeDef, fameTier, fameTierName, tierDef, type LawDefs } from '../sim/law/defs';
import { log, statsOf } from '../sim/run/record';
import { hideoutPlace } from '../sim/hideouts/stash';

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
  const place = (hideout: string): string => hideoutPlace(hideout) ?? 'the hideout';
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
    ev.on('CrimeCommitted', (e) => {
      if (!e.by) stats().crimes += 1;
    }),
    ev.on('ReportFiled', (e) => {
      if (e.heatAdded <= 0) return;
      const what = crimeDef(defs, e.crime).name.toLowerCase();
      // A copycat's work laid at your door (Phase 9 piece E).
      const theirs = e.by ? ', laid at my door, though it was none of my doing' : '';
      write(`Word reached the law in ${region(e.region)}: ${what}${theirs}.`);
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
    ev.on('JailbreakSucceeded', (e) =>
      write(
        e.execution
          ? `Broke out of ${port(e.port)}'s lockup the night before the rope.`
          : `Broke out of ${port(e.port)}'s lockup.`,
      ),
    ),
    ev.on('JailbreakFailed', (e) => {
      if (!e.execution) {
        write(
          `Recaptured breaking out at ${port(e.port)}: ${e.weeks} week${e.weeks === 1 ? '' : 's'} more.`,
        );
      }
    }),
    ev.on('Released', (e) =>
      write(
        e.how === 'bail'
          ? 'Out on bail.'
          : `Out of the lockup after ${e.weeks} week${e.weeks === 1 ? '' : 's'}.`,
      ),
    ),
    // Hideout life (Phase 8 piece F).
    ev.on('SleptAtHideout', (e) =>
      write(`Lay low at ${place(e.hideout)} while ${region(e.region)} cooled.`),
    ),
    ev.on('PursuitEndedAtHideout', (e) =>
      write(
        e.by === 'npc.marshal'
          ? `Made ${place(e.hideout)} with the marshals close behind; they broke off.`
          : `Made ${place(e.hideout)} with ${e.by === 'law.morrill' ? 'the Morrill' : 'the tug'} astern; she broke off.`,
      ),
    ),
    ev.on('HideoutSpotted', (e) => write(`Seen lying at ${place(e.hideout)}. There'll be talk.`)),
    // Poker night (Phase 9 piece C): a side stake won or lost, and a palmed card seen.
    ev.on('PokerPlayed', (e) => {
      if (e.side === 'you' && e.stake)
        write(`Won ${e.stake} at the card table in ${port(e.port)}.`);
      if (e.side === 'him' && e.stake) write(`Lost ${e.stake} at cards in ${port(e.port)}.`);
    }),
    ev.on('PokerCheatCaught', (e) =>
      write(
        e.how === 'swing'
          ? `Caught palming a card at ${port(e.port)}, and fought my way out of the saloon.`
          : `Caught palming a card at ${port(e.port)}, and thrown out on my ear.`,
      ),
    ),
    ev.on('SalvageTaken', (e) =>
      write(`Carried ${e.qty} CU of ${good(e.good).toLowerCase()} out of the ruins.`),
    ),
  ];
  return () => offs.forEach((off) => off());
}
