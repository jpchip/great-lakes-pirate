import type { GameContext } from '../modes/context';
import { portInfo } from '../sim/economy/defs';
import { SITES } from '../sim/hideouts/stash';
import { fameTier, wantedTier, type LawDefs } from '../sim/law/defs';
import { regionOfPort } from '../sim/law/regions';
import {
  freshNickname,
  noteDeed,
  notePlace,
  reviewNickname,
  rerollNickname,
  type NicknameChange,
  type NicknameState,
  type NicknameWorld,
} from '../sim/news/nickname';
import { named, paperOfRegion, type NewsDefs, type StoryInput } from '../sim/news/papers';
import { log } from '../sim/run/record';
import type { GameEvents as SandboxEvents } from './events';

/**
 * Your nickname in the running game (plan 12 §6.3; Phase 9 piece B). The record is read off
 * the bus: crimes the papers can pin on you by name (a report that names you or your ship),
 * honest feats, port calls, nights at a hideout. Each game hour the record is read again:
 * at Fame tier 1 the papers coin a name, and it changes as the record does. A coined or
 * changed name is a story in the papers and, while the one letter to the editor is unused,
 * a letter from the editor offering to print it (`event.nickname_letter`).
 */

export const NICKNAME_LETTER = 'event.nickname_letter';

export interface GameNickname {
  readonly state: NicknameState;
  current(): string | undefined;
  /** Reads the record now: the change, if any. */
  check(): NicknameChange | undefined;
  /** The letter to the editor (the dev hook; the letter's choice does it in play). */
  reroll(): NicknameChange | string;
  dispose(): void;
}

export interface NicknameOptions {
  ctx: GameContext;
  law: LawDefs;
  news: NewsDefs;
  events: SandboxEvents;
  /** Adds a story for the papers. */
  story(input: StoryInput): void;
  seed: string;
  notice?(text: string): void;
}

/** A place key's name: a port's, or a hideout site's place. */
export function placeName(place: string): string | undefined {
  if (place.startsWith('port.')) return portInfo(place)?.name;
  return SITES.find((s) => s.id === place)?.place;
}

function placeRegion(place: string): string | undefined {
  if (place.startsWith('port.')) return regionOfPort(place);
  return SITES.find((s) => s.id === place)?.wantedRegion;
}

export function attachNickname(opts: NicknameOptions): GameNickname {
  const { ctx } = opts;
  const defs = opts.news.file.nicknames;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const st = (): NicknameState => (ctx.state.nickname ??= freshNickname());
  const world = (): NicknameWorld => ({
    fameTier: fameTier(opts.law, ctx.state.fame.value),
    captain: ctx.state.player.captain.name,
    seed: opts.seed,
    placeName,
  });
  /** Where the news is: your hottest region, else your haunt's, else Bayfield's. */
  const newsRegion = (): string => {
    let top: { region: string; tier: number } | undefined;
    for (const [region, w] of Object.entries(ctx.state.wanted)) {
      const tier = wantedTier(opts.law, w.heat);
      if (tier > 0 && (!top || tier > top.tier)) top = { region, tier };
    }
    const haunt = st().haunt;
    return top?.region ?? (haunt && placeRegion(haunt)) ?? 'region.chequamegon';
  };

  const announce = (change: NicknameChange, reroll: boolean): void => {
    const s = st();
    const region = newsRegion();
    if (!change.from) s.paper = paperOfRegion(opts.news, region).id;
    const t = now();
    opts.story({
      kind: change.from ? 'renamed' : 'nickname',
      key: `nickname:${t}:${change.to}`,
      at: t,
      region,
      ident: 'person',
      nick: change.to,
      ...(change.from ? { oldNick: change.from } : {}),
    });
    log(
      ctx.state,
      t,
      change.from
        ? `The papers call me ${change.to} now, not ${change.from}.`
        : `The papers have a name for me: ${change.to}.`,
    );
    ctx.events.emit('NicknameChanged', { from: change.from, to: change.to, reroll });
    opts.notice?.(`The papers call you ${change.to}`);
    // The editor's letter, while the one letter to the editor is unwritten.
    const open = opts.events.state.active.some((a) => a.id === NICKNAME_LETTER);
    if (!reroll && !s.rerolled && !open) opts.events.fire(NICKNAME_LETTER);
  };

  const check = (): NicknameChange | undefined => {
    const change = reviewNickname(defs, st(), world(), now());
    if (change) announce(change, false);
    return change;
  };
  const reroll = (): NicknameChange | string => {
    const r = rerollNickname(defs, st(), world(), now());
    if (typeof r !== 'string') announce(r, true);
    return r;
  };

  const ev = ctx.events;
  const crimePorts = new Map<string, string>();
  let lastHour = -1;
  const offs = [
    ev.on('CrimeCommitted', (e) => {
      if (e.port) crimePorts.set(e.crimeId, e.port);
      if (crimePorts.size > 64) crimePorts.delete(crimePorts.keys().next().value ?? '');
    }),
    ev.on('ReportFiled', (e) => {
      if (e.heatAdded <= 0 || !named(e.identification)) return;
      const killed = e.crime === 'crime.killing' ? (e.details?.killed ?? 1) : 0;
      if (!noteDeed(st(), e.crime, { crimeId: e.crimeId, killed })) return;
      const port = crimePorts.get(e.crimeId);
      if (port) notePlace(st(), port, defs.haunt.crime);
      check();
    }),
    ev.on('FeatAccomplished', (e) => {
      if (e.kind === 'moonCussing') return;
      noteDeed(st(), 'feat');
      if (e.port) notePlace(st(), e.port, defs.haunt.crime);
    }),
    ev.on('PortVisited', (e) => notePlace(st(), e.port, defs.haunt.visit)),
    ev.on('SleptAtHideout', (e) => {
      const site = ctx.state.hideouts?.[e.hideout]?.siteId;
      if (site) notePlace(st(), site, defs.haunt.sleep);
    }),
    ev.on('FameChanged', () => check()),
    ev.on('EventResolved', (e) => {
      if (e.id === NICKNAME_LETTER && e.choice === 'write') reroll();
    }),
    ev.on('WorldTick', ({ gameSeconds }) => {
      const hour = Math.floor(gameSeconds / 3600);
      if (hour === lastHour) return;
      lastHour = hour;
      check();
    }),
  ];

  return {
    get state() {
      return st();
    },
    current: () => ctx.state.nickname?.current,
    check,
    reroll,
    dispose: () => offs.forEach((off) => off()),
  };
}
