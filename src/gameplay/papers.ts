import type { GameContext } from '../modes/context';
import type { PaperDef } from '../../data/schemas/newspapers';
import { calendarDate, dayAndHour } from '../core/time';
import { westernSuperiorChart } from '../sim/chart/chart-data';
import { forecastAt, type ChartForecast } from '../sim/chart/chart-weather';
import type { ChartGeography } from '../sim/chart/geography';
import { legAlongM, legArriveAt, nodeAt, pointAlong, type PatrolLanes } from '../sim/chart/patrol';
import { portInfo } from '../sim/economy/defs';
import { formatCents } from '../sim/economy/knowledge';
import type { LawDefs } from '../sim/law/defs';
import type { LawShipsState } from '../sim/law/patrol';
import { gameJail } from '../sim/law/jail';
import { regionAtGeo, regionOfPort } from '../sim/law/regions';
import {
  addStory,
  gameNews,
  homePaper,
  isMostWanted,
  latestEdition,
  mostWantedPage,
  papersSoldAt,
  pressDay,
  pressDayAt,
  type MostWantedPage,
  type NewsDefs,
  type PressWorld,
  type StoryInput,
} from '../sim/news/papers';
import { freshNews, type Edition, type NewsState } from '../sim/news/state';
import { portStormSignal, stormSignalPorts, type StormSignal } from '../sim/news/storm-signal';
import { chartWindAt } from '../sim/chart/chart-weather';
import { compassPoint } from '../ui/chart/text';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import type { GameLaw } from './law';
import { emitLaw, lawWorld } from './law';

/**
 * The papers in the running game (plan 12 §6, plan 06 §9; Phase 5 piece F). It turns the
 * bus's news into stories, sends the four papers to press each game day at dawn (printing
 * raises Fame and the papers' extra heat), sells them at the port screen, shows the tier-5
 * front page once per region, and gives the paper boy his shout (piece H's hook,
 * `PaperCried`).
 *
 * Escaping the cutter has no event of its own: a pursuit that began with her hail and ends
 * with her losing you, with no capture for an hour after, is an escape.
 */

/** A paper on the port screen's newsstand. */
export interface PaperStand {
  papers: {
    id: string;
    name: string;
    priceCents: number;
    /** You've bought its latest edition. */
    read: boolean;
    edition: Edition | undefined;
  }[];
}

export interface GamePapers {
  readonly defs: NewsDefs;
  /** The papers sold at a port, with the latest edition of each. */
  stand(port: string): PaperStand;
  /** Buys a paper's latest edition: why not, or undefined. */
  buy(port: string, paper: string): string | undefined;
  /** The paper boy's shout on arriving, once an edition (`PaperCried`). */
  cry(port: string): void;
  /** The port's storm signal now. */
  signal(port: string): StormSignal | undefined;
  /** Ports (ids) flying the storm signal now. */
  signals(): string[];
  /** Prints today's editions now, or a later day's (the dev panel). */
  pressNow(daysAhead?: number): Edition[];
  /** The Most Wanted page waiting to be shown, if any (taken once). */
  takeFrontPage(): MostWantedPage | undefined;
  readonly state: NewsState;
  dispose(): void;
}

export interface PapersOptions {
  ctx: GameContext;
  law: GameLaw;
  seed: string;
  goodName(good: string): string;
  /** The law's ships, for the cutter sightings column. */
  lawShips?: { lanes: PatrolLanes } | undefined;
  /** The tier-5 front page is ready: show it when the game can. */
  onFrontPage?: ((page: MostWantedPage) => void) | undefined;
  defs?: NewsDefs | undefined;
  geo?: ChartGeography | undefined;
  /** A company's name for the piracy headlines (Phase 6 piece F). */
  ownerName?: ((company: string) => string | undefined) | undefined;
}

const POINT_WORDS: Record<string, string> = { N: 'north', E: 'east', S: 'south', W: 'west' };

/** "north-northwest", "southwest", "east". */
export function compassWords(radians: number): string {
  const p = compassPoint(radians);
  const w = [...p].map((c) => POINT_WORDS[c] ?? c);
  if (w.length === 3) return `${w[0]}-${w[1]}${w[2]}`;
  return w.join('');
}

/** The paper's weather outlook for its town, from the chart's forecast a day ahead. */
export function outlookWords(f: ChartForecast, town: string): string {
  const dir = compassWords(f.windFrom);
  const hi = f.windHighKn;
  const wind =
    hi < 6
      ? 'light and variable winds'
      : hi < 14
        ? `gentle ${dir} winds`
        : hi < 22
          ? `fresh ${dir} winds`
          : hi < 34
            ? `strong ${dir} winds`
            : `a ${dir} gale`;
  const what: string[] = [wind];
  if (f.squall) what.push('squalls and thunder');
  else if (f.rain) what.push('rain');
  if (f.visibilityM < 1000) what.push('thick fog on the lake');
  const trend =
    f.barometer.trend === 'falling fast'
      ? ' The barometer is falling fast: mariners should be on their guard.'
      : f.barometer.trend === 'rising fast'
        ? ' The glass is rising fast, and a hard blow may come behind the low.'
        : '';
  return `For ${town} and vicinity: ${what.join(', ')}.${trend}`;
}

/** The cutter sightings column from her saved leg (and the tier-5 tug's charter). */
export function cutterColumn(
  defs: NewsDefs,
  law: LawDefs,
  lanes: PatrolLanes,
  ships: LawShipsState | undefined,
  geo: ChartGeography,
  t: number,
): string[] {
  const lines: string[] = [];
  const words = defs.file.cutter;
  const fill = (key: string, v: Record<string, string>): string | undefined =>
    words[key]?.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
  const leg = ships?.morrill.leg;
  const lane = leg && lanes.get(leg.lane);
  if (leg && lane) {
    const speed = law.actors.cutter.speedKn;
    const along = legAlongM(leg, speed, t);
    const pos = pointAlong(lane, along).pos;
    const region = law.regionById.get(regionAtGeo(law, geo.projection.chartToGeo(pos)))?.name;
    const end = leg.toM >= leg.fromM ? lane.to : lane.from;
    const lying = nodeAt(lane, along);
    const arrived = t >= legArriveAt(leg, speed);
    const v = { region: region ?? 'the lake', to: end.name, where: lying?.name ?? end.name };
    let line: string | undefined;
    if (leg.purpose === 'away' || leg.purpose === 'winter' || leg.purpose === 'coal') {
      line = fill(leg.purpose, v);
    } else if (leg.purpose === 'shelter') {
      line = fill('shelter', v);
    } else if (lying && (t < leg.departAt || arrived)) {
      line = fill(lying.role === 'port' ? 'port' : 'lie', v);
    } else {
      line = fill(leg.purpose === 'lie' ? 'lie' : leg.purpose, v);
    }
    if (line) lines.push(line);
  }
  const tug = ships?.tug;
  if (tug && tug.until > t) {
    const name = law.regionById.get(tug.region)?.name ?? 'the region';
    lines.push(defs.file.tug.replace('{region}', name));
  }
  return lines;
}

function portNames(geo: ChartGeography, ids: readonly string[]): string[] {
  return ids.map((id) => portInfo(id)?.name ?? geo.ports.find((p) => p.id === id)?.name ?? id);
}

export function attachPapers(opts: PapersOptions): GamePapers {
  const { ctx, law } = opts;
  const defs = opts.defs ?? gameNews();
  const geo = opts.geo ?? westernSuperiorChart();
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const state = (): NewsState => (ctx.state.newspapers ??= freshNews(pressDayAt(defs, now()) - 1));
  const add = (input: StoryInput): void => {
    addStory(defs, state(), input);
  };
  let frontPage: MostWantedPage | undefined;
  let signalCache: { tick: number; ports: string[] } | undefined;
  /** Ports and editions the paper boy has already cried (not saved). */
  const cried = new Set<string>();
  /** A pursuit in progress, for the escape story. */
  let pursuit: { region: string; lostAt: number | undefined } | undefined;
  /** Where each crime happened at (CrimeCommitted carries the port; ReportFiled doesn't). */
  const crimePorts = new Map<string, string>();

  const world = (): PressWorld => ({
    law: law.defs,
    lawWorld: lawWorld(ctx.state, opts.seed),
    captain: ctx.state.player.captain.name,
    ship: ctx.state.player.captain.shipName,
    seed: opts.seed,
    goodName: opts.goodName,
    cutter: () =>
      opts.lawShips
        ? cutterColumn(defs, law.defs, opts.lawShips.lanes, ctx.state.lawShips, geo, now())
        : [],
    weather: (paper: PaperDef) => {
      const t = now();
      const home = geo.ports.find((p) => p.id === paper.sold[0]);
      const w = ctx.state.environment.weather;
      const text = home ? outlookWords(forecastAt(w, geo, home.pos, t, 24), paper.town) : '';
      return { text, signals: portNames(geo, stormSignalPorts(w, geo, t)) };
    },
  });

  const press = (day: number): Edition[] => {
    const { editions, events } = pressDay(defs, world(), state(), day);
    for (const e of events) emitLaw(ctx, e);
    for (const ed of editions) {
      const name = defs.paperById.get(ed.paper)?.name ?? ed.paper;
      ctx.events.emit('NewspaperPrinted', {
        paper: ed.paper,
        name,
        day: ed.day,
        headline: ed.lead.headline,
        aboutYou: ed.lead.aboutYou || ed.briefs.some((b) => b.aboutYou),
      });
    }
    return editions;
  };
  /** Prints the day's editions once their hour has come (a missed day only prints its latest). */
  const catchUp = (): void => {
    const day = pressDayAt(defs, now());
    if (day > state().printedDay) press(day);
  };

  const ev = ctx.events;
  const offs = [
    ev.on('CrimeCommitted', (e) => {
      if (e.port) crimePorts.set(e.crimeId, e.port);
    }),
    ev.on('ReportFiled', (e) => {
      if (e.heatAdded <= 0 && e.alertAdded <= 0) return;
      const at = now();
      // The law's own search: the seizure story says it, with the goods.
      if (e.witness.kind === 'cutter' || e.witness.kind === 'harborMaster') {
        add({
          kind: 'seizure',
          key: `seizure:${e.region}:${dayAndHour(at).day}`,
          at,
          region: e.region,
          ident: 'ship',
          heat: e.heatAdded,
        });
        return;
      }
      const d = e.details;
      const cls = d?.victimClass && SHIP_RECORDS.find((r) => r.id === d.victimClass)?.name;
      add({
        kind: 'crime',
        key: `crime:${e.crimeId}`,
        at,
        region: e.region,
        port: crimePorts.get(e.crimeId),
        ident: e.heatAdded > 0 ? e.identification : 'unknown',
        crime: e.crime,
        heat: e.heatAdded,
        // A crime at sea (Phase 6 piece F): her name, her owners, what was taken, the dead.
        ...(d?.victim ? { victim: cls ? `the ${cls.toLowerCase()} ${d.victim}` : d.victim } : {}),
        ...(d?.owner ? { owner: opts.ownerName?.(d.owner) ?? d.owner } : {}),
        ...(d?.goods ? { goods: d.goods } : {}),
        ...(d?.killed ? { killed: d.killed } : {}),
        ...(d?.cashCents ? { cashCents: d.cashCents } : {}),
      });
    }),
    ev.on('HoldSearched', (e) => {
      if (e.found.length === 0 || !e.region) return;
      const at = now();
      add({
        kind: 'seizure',
        key: `seizure:${e.region}:${dayAndHour(at).day}`,
        at,
        region: e.region,
        port: 'port' in e ? e.port : undefined,
        ident: 'ship',
        goods: e.found.map((f) => ({ good: f.good, qty: f.qty })),
      });
    }),
    ev.on('WantedTierChanged', (e) => {
      const at = now();
      const s = state();
      if (e.to > e.from && e.to >= 3) {
        const top = isMostWanted(law.defs, e.to);
        add({
          kind: top ? 'mostWanted' : 'wanted',
          key: `${top ? 'mostWanted' : 'wanted'}:${e.region}:${e.to}:${dayAndHour(at).day}`,
          at,
          region: e.region,
          ident: 'person',
          tier: e.to,
        });
        if (top && !s.mostWantedShown.includes(e.region)) {
          s.mostWantedShown.push(e.region);
          frontPage = mostWantedPage(defs, world(), e.region, at);
          opts.onFrontPage?.(frontPage);
        }
      }
      // Once the region has cooled to Hunted or below, it can make the front page again.
      if (e.to <= 3) s.mostWantedShown = s.mostWantedShown.filter((r) => r !== e.region);
    }),
    ev.on('Jailed', (e) => {
      if (e.execution) return;
      const at = now();
      add({
        kind: 'captured',
        key: `captured:${at}`,
        at,
        region: e.region,
        port: e.port,
        ident: 'person',
      });
    }),
    ev.on('Released', () => {
      const at = now();
      add({
        kind: 'released',
        key: `released:${at}`,
        at,
        region: gameJail().lockup.region,
        port: gameJail().lockup.port,
        ident: 'person',
      });
    }),
    ev.on('HarborMasterPaid', (e) => {
      if (e.kind !== 'fine') return;
      const at = now();
      add({
        kind: 'fined',
        key: `fined:${e.port}:${dayAndHour(at).day}`,
        at,
        region: e.region,
        port: e.port,
        ident: 'person',
      });
    }),
    ev.on('CutterHailed', (e) => {
      if (e.intent !== 'pursue' || e.by !== 'law.morrill') return;
      const region = law.region();
      if (region) pursuit = { region, lostAt: undefined };
    }),
    ev.on('PursuitChanged', (e) => {
      if (!pursuit || e.by !== 'law.morrill') return;
      pursuit.lostAt = e.pursued ? undefined : now();
    }),
    ev.on('PlayerCaptured', () => (pursuit = undefined)),
    ev.on('ContractCompleted', (e) => {
      if (e.late || e.acceptedAt === undefined || e.dueAt === undefined) return;
      const at = now();
      const allowed = e.dueAt - e.acceptedAt;
      if (allowed <= 0 || at - e.acceptedAt > allowed * defs.file.feats.recordShare) return;
      const region = regionOfPort(e.to);
      if (!region) return;
      add({
        kind: 'recordRun',
        key: `record:${e.contractId}`,
        at,
        region,
        port: e.to,
        ident: 'person',
      });
    }),
    ev.on('PortVisited', ({ port }) => {
      const at = now();
      const region = regionOfPort(port);
      if (!region) return;
      const s = state();
      const date = calendarDate(at);
      const year = date.getUTCFullYear();
      const f = defs.file.feats;
      if (s.firstBoatYear !== year && f.iceOutMonths.includes(date.getUTCMonth())) {
        s.firstBoatYear = year;
        add({ kind: 'firstBoat', key: `firstBoat:${year}`, at, region, port, ident: 'person' });
      }
      const p = geo.ports.find((x) => x.id === port);
      const w = ctx.state.environment.weather;
      if (
        p &&
        portStormSignal(w, geo, port, at) &&
        chartWindAt(w, geo, p.pos, at).speedKn >= f.galeKn
      ) {
        add({
          kind: 'galeRun',
          key: `gale:${port}:${dayAndHour(at).day}`,
          at,
          region,
          port,
          ident: 'person',
        });
      }
    }),
    ev.on('WorldTick', () => {
      const t = now();
      if (pursuit?.lostAt !== undefined && t - pursuit.lostAt >= 3600) {
        add({
          kind: 'escape',
          key: `escape:${pursuit.lostAt}`,
          at: pursuit.lostAt,
          region: pursuit.region,
          ident: 'ship',
        });
        pursuit = undefined;
      }
      catchUp();
    }),
  ];
  // A new run (or a save from before the papers) has today's papers at once.
  catchUp();

  const stand = (port: string): PaperStand => {
    const s = state();
    return {
      papers: papersSoldAt(defs, port).map((p) => {
        const edition = latestEdition(s, p.id);
        return {
          id: p.id,
          name: p.name,
          priceCents: p.priceCents,
          read: !!edition && s.read[p.id] === edition.day,
          edition,
        };
      }),
    };
  };

  return {
    defs,
    stand,
    buy(port, paperId) {
      const p = defs.paperById.get(paperId);
      if (!p || !p.sold.includes(port)) return "That paper isn't sold here.";
      const edition = latestEdition(state(), paperId);
      if (!edition) return 'The papers are not in yet.';
      const s = state();
      if (s.read[paperId] === edition.day) return undefined;
      const player = ctx.state.player;
      if (player.purse < p.priceCents) return `You haven't ${formatCents(p.priceCents)}.`;
      player.purse -= p.priceCents;
      s.read[paperId] = edition.day;
      ctx.events.emit('NewspaperBought', { port, paper: paperId, cents: p.priceCents });
      return undefined;
    },
    cry(port) {
      const p = homePaper(defs, port);
      const edition = p && latestEdition(state(), p.id);
      if (!p || !edition || state().read[p.id] === edition.day) return;
      const key = `${port}|${p.id}|${edition.day}`;
      if (cried.has(key)) return;
      cried.add(key);
      ctx.events.emit('PaperCried', {
        port,
        paper: p.id,
        headline: edition.lead.headline,
        aboutYou: edition.lead.aboutYou,
      });
    },
    signal: (port) => portStormSignal(ctx.state.environment.weather, geo, port, now()),
    signals() {
      // The signals change by the world tick at most.
      const tick = Math.floor(now() / 600);
      if (signalCache?.tick !== tick) {
        signalCache = { tick, ports: stormSignalPorts(ctx.state.environment.weather, geo, now()) };
      }
      return signalCache.ports;
    },
    pressNow: (daysAhead = 0) => press(dayAndHour(now()).day + daysAhead),
    takeFrontPage() {
      const p = frontPage;
      frontPage = undefined;
      return p;
    },
    get state() {
      return state();
    },
    dispose: () => offs.forEach((off) => off()),
  };
}
