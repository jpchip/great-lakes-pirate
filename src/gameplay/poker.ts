import type { MarkerKind, PokerCaptain, PokerFile } from '../../data/schemas/poker';
import { dayAndHour, SECONDS_PER_GAME_DAY } from '../core/time';
import type { GameContext } from '../modes/context';
import {
  adjustStanding,
  cargoName,
  createContractsState,
  type BoardOffer,
  type ContractDefs,
} from '../sim/economy/contracts';
import { portInfo } from '../sim/economy/defs';
import {
  addToHold,
  holdFree,
  isClean,
  takeCleanFromHold,
  type CargoStack,
} from '../sim/economy/hold';
import { formatCents } from '../sim/economy/knowledge';
import { unitPrices } from '../sim/economy/market';
import { createPokerState, type PokerState } from '../sim/poker/state';
import { ISLANDS, rollCache } from '../sim/islands/on-foot';
import type { CrimeInput } from '../sim/law/law';
import type { Witness } from '../sim/law/witness';
import {
  dealHand,
  dealRefusal,
  gamePoker,
  maxSpend,
  openTable,
  settleCaught,
  yourAction,
  yourDraw,
  YOU,
  type BetAction,
  type Marker,
  type TableState,
} from '../sim/poker/table';
import {
  cardTableSnapshot,
  type CardTableSnapshot,
  type StakeOption,
} from '../ui/port/cards-model';
import { contractsOf } from './contracts';
import type { GameEconomy } from './economy';
import { withinHours } from './onfoot/conduct';

/**
 * Poker night in the running game (plan 12 §5.3; Phase 9 piece C). A saloon's card table
 * sits after dark (`poker.json`'s hours): a tab on the port screen where the port has a
 * saloon, and a table you walk up to in Bayfield's saloon. Tonight's table is the sim's
 * (`sim/poker/table.ts`), kept here for the night; the save keeps only what outlives it:
 * where you're barred, the maps you've won, and the night's tallies.
 *
 * The stakes: cash moves as it's bet. A captain's marker is a side stake you match with
 * cash, a lot from your hold or a contract of yours: the winner of the two takes both. A
 * lot of cargo goes into the hold clean; a contract becomes yours, its cargo aboard and no
 * deposit asked; a map is a true rumor of where a cache lies (a lead, once piece O brings
 * leads). Caught palming a card, you take your licking (the pot and stake lost, a beating
 * from your purse) or swing first (your money back, and an assault before the room). Either
 * way you're barred from that table for a while and your name suffers in the port.
 *
 * Raises `PokerPlayed` after every hand and `PokerCheatCaught` when you're seen.
 */

/** The event that makes a night a big game (`events.json`). */
export const POKER_NIGHT_EVENT = 'event.poker_night';

export interface GamePoker {
  /** The table sits at a port now (it has a saloon, it's evening, and you're not barred). */
  isOpen(port: string): boolean;
  /** A line for the saloon tab about the game, or undefined. */
  hint(port: string): string | undefined;
  /** The card table, while it sits. */
  snapshot(port: string): CardTableSnapshot | undefined;
  /** Deals you a hand, with a side stake (`StakeOption.key`) or none: the refusal. */
  deal(port: string, stake?: string): string | undefined;
  bet(port: string, action: BetAction): string | undefined;
  draw(port: string, discards: readonly number[], palm: boolean): string | undefined;
  /** Caught: take your licking or swing first. What came of it. */
  caught(port: string, how: 'licking' | 'swing'): string | undefined;
  /** Tonight's table at a port (the dev hook and the tests). */
  table(port: string): TableState | undefined;
  readonly state: PokerState;
}

export interface PokerOptions {
  ctx: GameContext;
  economy: GameEconomy;
  /** The freight agent's defs and board, for contracts staked and won. */
  contracts?: { defs: ContractDefs; board(port: string): BoardOffer[] } | undefined;
  /** The run's seed (the traffic's), so a night's table is the same after a reload. */
  seed: string;
  /** The weather's noise seed, which hides the caches (`rollCache`). */
  runSeed(): number;
  /** The law: an assault at the table. */
  commit?: ((input: CrimeInput) => void) | undefined;
  regionOf(port: string): string | undefined;
  file?: PokerFile;
}

/** The room at the saloon: whoever's drinking there sees a brawl. */
function saloonCrowd(port: string): Witness {
  return {
    id: `saloon.${port}`,
    kind: 'merchant',
    name: 'the whole saloon',
    identification: 'person',
  };
}

export function attachPoker(opts: PokerOptions): GamePoker {
  const { ctx, economy } = opts;
  const file = opts.file ?? gamePoker();
  const rules = file.rules;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const st = (): PokerState => (ctx.state.poker ??= createPokerState());
  const tables = new Map<string, TableState>();
  /** What you staked on the hand in play: settled when it ends. */
  let staked: { port: string; his: Marker; yours: Marker; escrow: number } | undefined;

  const nightAt = (t: number): number => {
    const { day, hour } = dayAndHour(t);
    return hour < 12 ? day - 1 : day;
  };
  const evening = (): boolean => withinHours(dayAndHour(now()).hour, rules.hours);
  const hasSaloon = (port: string): boolean => !!portInfo(port)?.services.includes('tavern');
  const barred = (port: string): boolean => (st().barred[port] ?? -Infinity) > now();
  const bigNight = (port: string): boolean =>
    (ctx.state.events?.active ?? []).some(
      (a) => a.id === POKER_NIGHT_EVENT && a.port === port && now() >= a.at && now() < a.until,
    );
  const sellCents = (port: string, good: string): number => {
    const p = unitPrices(economy.defs, ctx.state.markets, port, good, now());
    return p?.sellCents ?? economy.defs.goods.get(good)?.basePriceCents ?? 100;
  };
  const goodName = (good: string): string =>
    (economy.defs.goods.get(good)?.name ?? good).toLowerCase();
  const portName = (port: string): string => portInfo(port)?.name ?? port;
  /** A contract's cargo by name: a good, or the mail. */
  const cargo = (id: string): string =>
    opts.contracts ? cargoName(economy.defs, opts.contracts.defs, id).toLowerCase() : goodName(id);

  /** A marker for a captain to put up, of a kind, where one can be had here. */
  const markerFor =
    (port: string, night: number) =>
    (kind: MarkerKind, owner: PokerCaptain, rng: { int(a: number, b: number): number }) => {
      if (kind === 'cargo') {
        const pm = economy.defs.markets.get(port);
        const goods = pm
          ? [...pm.goods.values()].filter((g) => g.good.category !== 'contraband')
          : [];
        if (!goods.length) return undefined;
        const g = goods[rng.int(0, goods.length - 1)];
        if (!g) return undefined;
        // Nobody stakes more than your ship could carry off: it'd be no bet at all.
        const qty = Math.max(
          1,
          Math.min(economy.capacity, rng.int(rules.markers.cargoQty[0], rules.markers.cargoQty[1])),
        );
        return {
          kind,
          owner: owner.id,
          good: g.good.id,
          qty,
          // A round sum: a captain's guess at what it'd fetch.
          valueCents: Math.max(100, Math.round((qty * sellCents(port, g.good.id)) / 100) * 100),
          label: `${qty} CU of ${goodName(g.good.id)} out of ${owner.ship}'s hold`,
        } satisfies Marker;
      }
      if (kind === 'contract') {
        const board = (opts.contracts?.board(port) ?? []).filter(
          (o) => o.terms.qty <= economy.capacity,
        );
        if (!board.length) return undefined;
        const t = board[rng.int(0, board.length - 1)]?.terms;
        if (!t) return undefined;
        return {
          kind,
          owner: owner.id,
          good: t.good,
          qty: t.qty,
          contract: `${port}#poker#${night}`,
          valueCents: t.payCents,
          label: `his contract: ${t.qty} CU of ${cargo(t.good)} for ${portName(t.to)}, paying ${formatCents(t.payCents)}`,
          terms: t,
        } satisfies Marker;
      }
      // A map: to a cache nobody's dug up yet, and whose map you haven't won.
      const caches = ISLANDS.flatMap((i) =>
        (i.onFoot?.caches ?? []).map((c) => ({ c, island: i.name })),
      ).filter(({ c }) => !ctx.state.caches?.[c.id]?.looted && !st().maps.includes(c.id));
      if (!caches.length) return undefined;
      const pick = caches[rng.int(0, caches.length - 1)];
      if (!pick) return undefined;
      const [lo, hi] = pick.c.cashCents;
      return {
        kind,
        owner: owner.id,
        cache: pick.c.id,
        valueCents: Math.round((lo + hi) / 2 / 100) * 100,
        label: `a map to ${pick.c.name.toLowerCase()} on ${pick.island}`,
      } satisfies Marker;
    };

  const tableAt = (port: string): TableState | undefined => {
    if (!hasSaloon(port)) return undefined;
    const night = nightAt(now());
    const key = `${port}:${night}`;
    let t = tables.get(key);
    if (!t) {
      // Last night's tables are put away.
      for (const k of [...tables.keys()]) if (k.startsWith(`${port}:`)) tables.delete(k);
      t = openTable(
        { port, night, seed: opts.seed, big: bigNight(port), marker: markerFor(port, night) },
        file,
      );
      tables.set(key, t);
    }
    return t;
  };

  /** What you could put up against his marker now. */
  const stakeOptions = (port: string, his: Marker): StakeOption[] => {
    const player = ctx.state.player;
    const need = Math.ceil(his.valueCents * rules.markers.matchShare);
    const out: StakeOption[] = [];
    const ante = tableAt(port)?.anteCents ?? 0;
    const room = holdFree(player.cargo, economy.capacity);
    const roomFor = his.qty ?? 0;
    const noRoom = roomFor > room ? `No room aboard for ${roomFor} CU if you win it.` : undefined;
    const cashNeed = his.valueCents + maxSpend(rules, ante);
    out.push({
      key: 'cash',
      label: `${formatCents(his.valueCents)} in cash`,
      refusal:
        noRoom ??
        (player.purse < cashNeed ? `You'd want ${formatCents(cashNeed)} to hand.` : undefined),
    });
    player.cargo.forEach((s: CargoStack, i) => {
      if (!isClean(s) || s.qty <= 0) return;
      const per = sellCents(port, s.good);
      const qty = Math.min(s.qty, Math.ceil(need / Math.max(1, per)));
      const value = qty * per;
      if (value < need) return;
      out.push({
        key: `cargo:${i}`,
        label: `${qty} CU of your ${goodName(s.good)} (${formatCents(value)})`,
        refusal: noRoom,
      });
    });
    for (const k of ctx.state.contracts?.active ?? []) {
      if (k.status !== 'active' || k.payCents < need) continue;
      out.push({
        key: `contract:${k.id}`,
        label: `your contract: ${k.qty} CU of ${cargo(k.good)} for ${portName(k.to)} (${formatCents(k.payCents)})`,
        refusal: noRoom,
      });
    }
    return out;
  };

  const yourMarker = (port: string, key: string, his: Marker): Marker | string => {
    const player = ctx.state.player;
    const opt = stakeOptions(port, his).find((o) => o.key === key);
    if (!opt) return "That won't cover his marker.";
    if (opt.refusal) return opt.refusal;
    if (key === 'cash') {
      return { kind: 'cash', owner: YOU, valueCents: his.valueCents, label: opt.label };
    }
    if (key.startsWith('cargo:')) {
      const s = player.cargo[Number(key.slice(6))];
      if (!s) return 'That lot is gone.';
      const per = sellCents(port, s.good);
      const need = Math.ceil(his.valueCents * rules.markers.matchShare);
      const qty = Math.min(s.qty, Math.ceil(need / Math.max(1, per)));
      return {
        kind: 'cargo',
        owner: YOU,
        good: s.good,
        qty,
        valueCents: qty * per,
        label: `${qty} CU of your ${goodName(s.good)}`,
      };
    }
    const id = key.slice('contract:'.length);
    const k = ctx.state.contracts?.active.find((c) => c.id === id);
    if (!k) return 'That contract is gone.';
    return {
      kind: 'contract',
      owner: YOU,
      contract: k.id,
      good: k.good,
      qty: k.qty,
      valueCents: k.payCents,
      label: `your contract for ${portName(k.to)}`,
    };
  };

  /** Moves the markers once a side stake is settled. Returns the line for it. */
  const settleSide = (port: string, side: 'you' | 'him' | 'split'): string => {
    const s = staked;
    staked = undefined;
    if (!s) return '';
    const player = ctx.state.player;
    const who = tableAt(port)?.seats.find((x) => x.id === s.his.owner)?.def.name ?? 'He';
    if (side === 'split') {
      player.purse += s.escrow;
      return 'The side stake is a wash: each keeps his own.';
    }
    if (side === 'him') {
      // Your stake goes to him. Cash already left your purse.
      if (s.yours.kind === 'cargo' && s.yours.good) {
        takeCleanFromHold(player.cargo, s.yours.good, s.yours.qty ?? 0);
      } else if (s.yours.kind === 'contract' && s.yours.contract) {
        loseContract(s.yours.contract);
      }
      economy.syncLoad();
      return `${who} takes ${s.yours.label}.`;
    }
    player.purse += s.escrow;
    const his = s.his;
    if (his.kind === 'cargo' && his.good) {
      addToHold(player.cargo, { good: his.good, qty: his.qty ?? 0 });
    } else if (his.kind === 'contract') {
      winContract(port, his);
    } else if (his.kind === 'map' && his.cache) {
      winMap(port, his.cache, who);
    }
    economy.syncLoad();
    return `You win ${his.label}.`;
  };

  const loseContract = (id: string): void => {
    const c = ctx.state.contracts;
    const k = c?.active.find((x) => x.id === id);
    if (!c || !k) return;
    const cargo = ctx.state.player.cargo;
    for (let i = cargo.length - 1; i >= 0; i--) if (cargo[i]?.contract === id) cargo.splice(i, 1);
    c.active = c.active.filter((x) => x !== k);
    // Another captain carries it now: the shipper's no worse off, and nor is your name.
    c.history.unshift({
      id: k.id,
      company: k.company,
      from: k.from,
      to: k.to,
      good: k.good,
      qty: k.qty,
      outcome: 'abandoned',
      at: now(),
      payCents: 0,
    });
    c.tally.abandoned += 1;
  };

  const winContract = (port: string, m: Marker): void => {
    const t = m.terms;
    if (!t || !m.contract) return;
    const c = (ctx.state.contracts ??= createContractsState());
    const t0 = now();
    c.active.push({
      ...t,
      id: m.contract,
      from: port,
      depositCents: 0,
      acceptedAt: t0,
      dueAt: t0 + t.allowSeconds,
      expiresAt: t0 + t.allowSeconds + t.lateSeconds,
      status: 'active',
      hits: 0,
    });
    addToHold(ctx.state.player.cargo, { good: t.good, qty: t.qty, contract: m.contract });
  };

  const winMap = (port: string, cacheId: string, from: string): void => {
    st().maps.push(cacheId);
    for (const island of ISLANDS) {
      const cache = island.onFoot?.caches.find((c) => c.id === cacheId);
      if (!cache) continue;
      const spot = cache.spots[rollCache(cache, opts.runSeed()).spot]?.name ?? 'a cairn';
      const rumors = ctx.state.knowledge.rumors;
      rumors.unshift({
        id: `poker.map.${cacheId}`,
        kind: 'legend',
        source: 'saloon',
        port,
        heardAt: now(),
        text: `A map won at cards from ${from}: ${cache.name.toLowerCase()} on ${island.name} lies under ${spot}.`,
        teller: 'a map won at cards',
        reliability: 1,
        truth: true,
        draft: `poker:map:${cacheId}`,
        subject: cacheId,
      });
      return;
    }
  };

  /** After a hand: the side stake, the tallies and the bus. Returns the side stake's line. */
  const finish = (port: string, t: TableState): string | undefined => {
    const hand = t.hand;
    const result = hand?.result;
    if (!hand || !result) return undefined;
    const side = result.side;
    const his = staked?.his;
    const yours = staked?.yours;
    const line = side ? settleSide(port, side) : undefined;
    if (line) hand.log.push(line);
    st().hands += 1;
    st().netCents += result.netCents;
    const wonCargo = side === 'you' && (his?.kind === 'cargo' || his?.kind === 'contract');
    ctx.events.emit('PokerPlayed', {
      port,
      netCents: result.netCents,
      side,
      marker: his?.kind,
      stake: side === 'you' ? his?.label : side === 'him' ? yours?.label : undefined,
      wonCargo,
      cheated: !!hand.palmed,
    });
    return line;
  };

  const withTable = (
    port: string,
    run: (t: TableState) => string | undefined,
  ): string | undefined => {
    if (!hasSaloon(port)) return 'There is no saloon here.';
    if (barred(port)) return "You're not welcome at the card table here.";
    const t = tableAt(port);
    if (!t) return 'Nobody is playing.';
    const before = t.hand?.phase;
    const why = run(t);
    if (why) return why;
    if (t.hand?.phase === 'done' && before !== 'done') finish(port, t);
    return undefined;
  };

  return {
    isOpen: (port) => hasSaloon(port) && evening() && !barred(port),
    hint(port) {
      if (!hasSaloon(port)) return undefined;
      if (barred(port)) return "After last time, you're not welcome at the card table here.";
      if (!evening()) return 'Most nights after supper there are cards at the back table.';
      return bigNight(port)
        ? "There's a big game at the card table tonight."
        : 'There are cards at the back table tonight.';
    },
    snapshot(port) {
      if (!hasSaloon(port) || barred(port)) return undefined;
      const t = tableAt(port);
      if (!t) return undefined;
      // Past the hours, a hand in play is still seen out.
      if (!evening() && (!t.hand || t.hand.phase === 'done' || t.hand.phase === 'caught')) {
        if (t.hand?.phase !== 'caught') return undefined;
      }
      const player = ctx.state.player;
      const offer =
        t.offer && !t.over && (!t.hand || t.hand.phase === 'done') ? t.offer : undefined;
      return cardTableSnapshot(t, player.purse, file, {
        stakeOptions: offer ? stakeOptions(port, offer) : [],
        dealRefusal: evening() ? dealRefusal(t, player.purse, file) : 'The game is breaking up.',
        captainName: (id) => t.seats.find((s) => s.id === id)?.def.name ?? id,
      });
    },
    deal(port, stake) {
      if (!evening()) return 'The game is breaking up for the night.';
      return withTable(port, (t) => {
        let side: { his: Marker; yours: Marker } | undefined;
        if (stake && t.offer) {
          const yours = yourMarker(port, stake, t.offer);
          if (typeof yours === 'string') return yours;
          side = { his: t.offer, yours };
        }
        const why = dealRefusal(t, ctx.state.player.purse, file);
        if (why) return why;
        const escrow = side?.yours.kind === 'cash' ? side.yours.valueCents : 0;
        ctx.state.player.purse -= escrow;
        const h = dealHand(t, ctx.state.player, side, file);
        if (typeof h === 'string') {
          ctx.state.player.purse += escrow;
          return h;
        }
        if (side) staked = { port, his: side.his, yours: side.yours, escrow };
        return undefined;
      });
    },
    bet: (port, action) => withTable(port, (t) => yourAction(t, ctx.state.player, action, file)),
    draw: (port, discards, palm) => withTable(port, (t) => yourDraw(t, discards, palm, file)),
    caught(port, how) {
      const t = tableAt(port);
      if (!t || t.hand?.phase !== 'caught') return 'Nobody saw anything.';
      const player = ctx.state.player;
      const r = settleCaught(t, player, how);
      if (!r) return undefined;
      const c = rules.caught;
      st().barred[port] = now() + c.barredDays * SECONDS_PER_GAME_DAY;
      const { contracts, captain } = contractsOf(ctx.state);
      adjustStanding(captain.standing, contracts, port, c.standing);
      let line = r.text;
      if (how === 'licking') {
        const beating = Math.floor(player.purse * c.beatingShare);
        player.purse -= beating;
        if (beating > 0) line += ` Your purse is ${formatCents(beating)} lighter when you come to.`;
      } else {
        const region = opts.regionOf(port);
        if (region) {
          opts.commit?.({ crime: c.crime, region, port, witnesses: [saloonCrowd(port)] });
        }
      }
      ctx.events.emit('PokerCheatCaught', { port, how });
      const side = finish(port, t);
      if (side) line += ` ${side}`;
      return line;
    },
    table: (port) => tableAt(port),
    get state() {
      return st();
    },
  };
}
