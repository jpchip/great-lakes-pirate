import districtsJson from '../../data/districts.json';
import { districtsFileSchema } from '../../data/schemas/districts';
import type { EventChoiceDef, EventDef, EventOutcome } from '../../data/schemas/events';
import type { Contact } from '../sim/chart/traffic';
import type { EconomyDefs } from '../sim/economy/defs';
import { adjustStanding, createContractsState } from '../sim/economy/contracts';
import { formatCents } from '../sim/economy/knowledge';
import { shockMarket } from '../sim/economy/market';
import {
  choiceOf,
  createEventsState,
  drawEvent,
  eventDef,
  eventTalk,
  EVENTS,
  expireEvents,
  fillText,
  fireEvent,
  postLetter,
  type ActiveEvent,
  type EventMoment,
  type EventsState,
  type EventTalk,
  type EventWorld,
  type Letter,
} from '../sim/events/events';
import { markSpotted } from '../sim/hideouts/life';
import { SITES } from '../sim/hideouts/stash';
import { fameTier, wantedTier, type LawDefs } from '../sim/law/defs';
import { addHeat, gainFame, type LawEvent } from '../sim/law/law';
import { playerRegion, regionOfPort } from '../sim/law/regions';
import { addStory, type NewsDefs } from '../sim/news/papers';
import type { NewsState } from '../sim/news/state';
import { log } from '../sim/run/record';
import { partOfDay } from '../sim/rumors/rumors';
import { upcomingSailings, portName } from '../sim/traffic/news';
import type { TrafficDefs } from '../sim/traffic/cargo';
import type { GameContext } from '../modes/context';
import { weekLabel } from '../ui/hud/model';
import { emitLaw } from './law';

/**
 * Sandbox events and letters in the running game (plan 12 §5; Phase 9 piece A). Every few
 * game hours the world tick may draw an event whose triggers hold: on a voyage that can be
 * a meeting at sea, and docking at a port can play a short scene there. A fired event
 * changes the sim at once (a price, a payroll in a ship's strongbox, the cutter's sorties,
 * a district's warehouses) and goes out by its channels: talk in the saloons of its region
 * (read by `rumors.ts` through `talk()`), an item for the papers, a letter at the harbor
 * masters', or a scene on paper with choices. A letter's choice is answered on the harbor
 * master's tab; one left unanswered takes the event's default when it ends.
 */

const DISTRICT_PORTS = districtsFileSchema.parse(districtsJson).map((d) => ({
  id: d.id,
  port: d.port,
}));

export interface EventChoiceView {
  id: string;
  label: string;
  /** "$40.00", for a choice that costs. */
  costText: string | undefined;
  affordable: boolean;
}

/** A chart meeting or a scene on docking, on paper. */
export interface EventSceneView {
  key: string;
  kind: 'chart' | 'scene';
  title: string;
  /** "Off Sand Island" or "Bayfield". */
  place: string;
  body: string;
  choices: EventChoiceView[];
  /** What came of the choice; the scene closes after. */
  result: string | undefined;
}

export interface LetterView {
  key: string;
  from: string;
  subject: string;
  body: string;
  dateText: string;
  read: boolean;
  /** Its choices are open. */
  choices: EventChoiceView[];
  result: string | undefined;
}

export interface GameEvents {
  /** Fires an event now (the dev hook): what fired, or why not. */
  fire(id: string, port?: string): ActiveEvent | string;
  /** Runs a draw now, as the tick would. */
  check(moment?: EventMoment): ActiveEvent | undefined;
  /** The scene showing, if any. */
  scene(): EventSceneView | undefined;
  /** Takes a choice in the scene: the refusal, or undefined. */
  choose(choice: string): string | undefined;
  closeScene(): void;
  /** Docked at a port: a scene there may play. */
  docked(port: string): void;
  letters(): LetterView[];
  unread(): number;
  readLetter(key: string): void;
  /** Answers a letter: the refusal, or what came of it. */
  answer(key: string, choice: string): string;
  /** Talk for the saloons. */
  talk(): EventTalk[];
  readonly state: EventsState;
  dispose(): void;
}

export interface EventsOptions {
  ctx: GameContext;
  law: LawDefs;
  economy: EconomyDefs;
  papers?: { defs: NewsDefs; state: NewsState } | undefined;
  traffic?: { defs: TrafficDefs; contacts: readonly Contact[] } | undefined;
  /** The storm signal flies at a port. */
  gale(port: string): boolean;
  /** A moon-cussing night's ship and mark (Phase 9 piece I), if tonight is one. */
  wreckingNight?: EventWorld['wreckingNight'];
  /** Under way on a voyage on the chart, with nothing else in front of it. */
  onVoyage(): boolean;
  /** Shows a scene (or puts it away); `open` changes when one opens or closes. */
  showScene(scene: EventSceneView | undefined): void;
  onSceneOpen(open: boolean): void;
}

export function attachEvents(opts: EventsOptions): GameEvents {
  const { ctx } = opts;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const st = (): EventsState => (ctx.state.events ??= createEventsState(now()));
  const mail = (): Letter[] => (ctx.state.mail ??= []);
  const rand = (): number => ctx.rng.next();
  /** The run's RNG is saved with it (plan 16 §4.4). */
  const saveRng = (): void => {
    ctx.state.environment.rng = ctx.rng.getState();
  };
  let scene: { ev: ActiveEvent; kind: 'chart' | 'scene'; result?: string } | undefined;

  const regionName = (r: string | undefined): string =>
    (r && opts.law.regionById.get(r)?.name) ?? 'these waters';

  const world = (dockedPort?: string): EventWorld => {
    const state = ctx.state;
    let top = { tier: 0, region: undefined as string | undefined };
    for (const [region, w] of Object.entries(state.wanted)) {
      const tier = wantedTier(opts.law, w.heat);
      if (tier > top.tier) top = { tier, region };
    }
    return {
      now: now(),
      fameTier: fameTier(opts.law, state.fame.value),
      topWanted: top,
      regionOf: regionOfPort,
      standing: (port) => state.player.standing?.[port] ?? 0,
      gale: opts.gale,
      hideouts: Object.entries(state.hideouts ?? {}).flatMap(([id, h]) => {
        const site = SITES.find((s) => s.id === h.siteId);
        return site ? [{ id, name: site.place, region: site.wantedRegion }] : [];
      }),
      hereRegion: playerRegion(opts.law, state),
      dockedPort,
      ...(opts.wreckingNight ? { wreckingNight: opts.wreckingNight } : {}),
      sailingFrom: (port, days) => {
        const t = opts.traffic;
        if (!t) return undefined;
        const s = upcomingSailings(t.defs, opts.economy, t.contacts, now(), days).find(
          (x) => x.fromPort === port,
        );
        if (!s) return undefined;
        const name = t.contacts.find((c) => c.id === s.shipId)?.name ?? 'steamer';
        return { ship: s.shipId, name, at: s.at };
      },
    };
  };

  const costOf = (def: EventDef): number | undefined =>
    def.choices?.find((c) => c.costCents !== undefined)?.costCents;

  const values = (ev: ActiveEvent): Record<string, string> => {
    const def = eventDef(ev.id);
    const cost = def && costOf(def);
    return {
      port: portName(ev.port, regionName(ev.region)),
      region: regionName(ev.region),
      ship: ev.shipName ?? 'a steamer',
      cash: ev.cents !== undefined ? formatCents(ev.cents, true) : '',
      when: ev.sailsAt !== undefined ? partOfDay(ev.sailsAt, now()) : 'soon',
      captain: ctx.state.player.captain.name,
      hideout: ev.hideoutName ?? 'your hideout',
      cost: cost !== undefined ? formatCents(cost, true) : '',
      mark: ev.markName ?? 'the islands',
    };
  };
  const fill = (ev: ActiveEvent, t: string): string => fillText(t, values(ev));

  const choiceViews = (def: EventDef): EventChoiceView[] =>
    (def.choices ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      costText: c.costCents ? formatCents(c.costCents, true) : undefined,
      affordable: !c.costCents || ctx.state.player.purse >= c.costCents,
    }));

  // ---- outcomes

  const raise = (events: readonly LawEvent[]): void => {
    for (const e of events) emitLaw(ctx, e);
  };
  const standingPort = (ev: ActiveEvent): string | undefined =>
    ev.port ?? (ev.region ? opts.law.regionById.get(ev.region)?.seat : undefined);

  const apply = (ev: ActiveEvent, outcomes: readonly EventOutcome[]): void => {
    const state = ctx.state;
    const t = now();
    for (const o of outcomes) {
      switch (o.kind) {
        case 'price':
          for (const port of [ev.port, ...(o.ports ?? [])]) {
            if (!port || !opts.economy.markets.get(port)?.goods.has(o.good)) continue;
            const e = shockMarket(opts.economy, state.markets, port, o.good, o.factor, ev.id, t);
            if (e) ctx.events.emit('PriceShock', e);
          }
          break;
        case 'restock':
          for (const d of DISTRICT_PORTS) {
            const w = state.districts?.[d.id];
            if (d.port === ev.port && w) w.containers = {};
          }
          break;
        case 'spotted': {
          const h = ev.hideout ? state.hideouts?.[ev.hideout] : undefined;
          if (h) markSpotted(h, { at: t, by: o.by, ship: state.player.captain.shipName });
          break;
        }
        case 'heat': {
          const region = ev.region ?? playerRegion(opts.law, state);
          if (region) raise(addHeat(opts.law, state, region, o.amount, t));
          break;
        }
        case 'standing': {
          const port = standingPort(ev);
          if (port) {
            adjustStanding(
              (state.player.standing ??= {}),
              (state.contracts ??= createContractsState()),
              port,
              o.amount,
            );
          }
          break;
        }
        case 'fame': {
          const e = gainFame(opts.law, state, o.amount, t);
          if (e) emitLaw(ctx, e);
          break;
        }
        case 'cash': {
          const cents = Math.round(o.cents[0] + (o.cents[1] - o.cents[0]) * rand());
          state.player.purse = Math.max(0, state.player.purse + cents);
          break;
        }
        case 'flag':
          if (!st().flags.includes(o.flag)) st().flags.push(o.flag);
          break;
        case 'log':
          log(state, t, fill(ev, o.text));
          break;
        case 'payroll':
        case 'cutter':
        case 'crewsIdle':
          // Read from the standing event by the sim that asks (boarding, the cutter, the crews).
          break;
      }
    }
  };

  // ---- firing

  const send = (ev: ActiveEvent, def: EventDef): void => {
    const t = now();
    if (def.channels.includes('paper') && opts.papers && ev.region) {
      addStory(opts.papers.defs, opts.papers.state, {
        kind: 'event',
        event: def.id,
        key: ev.key,
        at: t,
        region: ev.region,
        port: ev.port,
        ident: def.paperNames ? 'person' : 'unknown',
      });
    }
    if (def.channels.includes('letter') && def.letter) {
      postLetter(mail(), {
        key: ev.key,
        event: def.id,
        at: t,
        from: fill(ev, def.letter.from),
        subject: fill(ev, def.letter.subject),
        body: fill(ev, def.letter.body),
        read: false,
        open: !!def.choices?.length,
      });
      ctx.events.emit('LetterReceived', { key: ev.key, event: def.id });
    }
  };

  const fire = (
    def: EventDef,
    place: { port: string | undefined; region: string | undefined },
    w: EventWorld,
  ): ActiveEvent => {
    const ev = fireEvent(st(), w, def, place, rand);
    saveRng();
    apply(ev, def.outcomes);
    send(ev, def);
    ctx.events.emit('EventTriggered', {
      id: def.id,
      key: ev.key,
      port: ev.port,
      region: ev.region,
    });
    return ev;
  };

  // ---- scenes

  const sceneView = (): EventSceneView | undefined => {
    if (!scene) return undefined;
    const def = eventDef(scene.ev.id);
    if (!def?.scene) return undefined;
    return {
      key: scene.ev.key,
      kind: scene.kind,
      title: fill(scene.ev, def.scene.title),
      place:
        scene.kind === 'chart'
          ? `At sea, ${regionName(scene.ev.region)}`
          : portName(scene.ev.port, regionName(scene.ev.region)),
      body: fill(scene.ev, def.scene.body),
      choices: scene.result ? [] : choiceViews(def),
      result: scene.result,
    };
  };

  const openScene = (ev: ActiveEvent, kind: 'chart' | 'scene'): void => {
    if (scene) return;
    ev.scenePending = false;
    scene = { ev, kind };
    opts.onSceneOpen(true);
    opts.showScene(sceneView());
  };

  const closeScene = (): void => {
    if (!scene) return;
    // Put away unanswered: the first choice that costs nothing stands (walking on).
    if (!scene.result) {
      const def = eventDef(scene.ev.id);
      const pass = def?.choices
        ?.slice()
        .reverse()
        .find((c) => !c.costCents && !c.outcomes.length);
      if (pass) resolve(scene.ev, pass);
    }
    scene = undefined;
    opts.showScene(undefined);
    opts.onSceneOpen(false);
  };

  const resolve = (ev: ActiveEvent, c: EventChoiceDef): void => {
    if (c.costCents) ctx.state.player.purse -= c.costCents;
    ev.chosen = c.id;
    apply(ev, c.outcomes);
    saveRng();
    ctx.events.emit('EventResolved', { id: ev.id, key: ev.key, choice: c.id });
  };

  const tryChoice = (ev: ActiveEvent, id: string): EventChoiceDef | string => {
    const def = eventDef(ev.id);
    const c = def && choiceOf(def, id);
    if (!def || !c) return 'No such answer.';
    if (ev.chosen) return 'That is settled already.';
    if (c.costCents && ctx.state.player.purse < c.costCents) return "You haven't the money.";
    resolve(ev, c);
    return c;
  };

  /** A meeting at sea fired while you weren't on the chart waits for the next voyage. */
  const pendingAtSea = (): ActiveEvent | undefined =>
    st().active.find(
      (a) => a.scenePending && !!eventDef(a.id)?.channels.includes('chart') && now() < a.until,
    );

  // ---- the tick

  const ended = (ev: ActiveEvent): void => {
    const def = eventDef(ev.id);
    const letter = mail().find((l) => l.key === ev.key);
    if (letter?.open) {
      letter.open = false;
      const c = def && !ev.chosen ? choiceOf(def, def.defaultChoice) : undefined;
      if (c) {
        resolve(ev, c);
        letter.result = c.result;
      }
    }
    if (scene?.ev.key === ev.key && !scene.result) closeScene();
  };

  const check = (moment?: EventMoment): ActiveEvent | undefined => {
    const m: EventMoment = moment ?? (opts.onVoyage() && rand() < 0.5 ? 'voyage' : 'tick');
    const w = world();
    const drawn = drawEvent(st(), w, m, rand);
    saveRng();
    if (!drawn) return undefined;
    const ev = fire(drawn.def, drawn, w);
    if (m === 'voyage' && opts.onVoyage()) openScene(ev, 'chart');
    return ev;
  };

  const offTick = ctx.events.on('WorldTick', () => {
    const t = now();
    for (const ev of expireEvents(st(), t)) ended(ev);
    const s = st();
    if (t >= s.nextCheckAt) {
      s.nextCheckAt = t + EVENTS.rules.checkHours * 3600;
      if (rand() < EVENTS.rules.chance) check();
      saveRng();
    }
    if (!scene && opts.onVoyage()) {
      const ev = pendingAtSea();
      if (ev) openScene(ev, 'chart');
    }
  });

  const docked = (port: string): void => {
    if (scene) return;
    const w = world(port);
    // A scene fired here earlier and not yet played.
    const waiting = st().active.find(
      (a) => a.scenePending && a.port === port && !!eventDef(a.id)?.channels.includes('scene'),
    );
    if (waiting) {
      openScene(waiting, 'scene');
      return;
    }
    if (rand() >= EVENTS.rules.sceneChance) {
      saveRng();
      return;
    }
    const drawn = drawEvent(st(), w, 'dock', rand);
    saveRng();
    if (!drawn) return;
    openScene(fire(drawn.def, drawn, w), 'scene');
  };

  const letterViews = (): LetterView[] =>
    mail().map((l) => {
      const def = eventDef(l.event);
      return {
        key: l.key,
        from: l.from,
        subject: l.subject,
        body: l.body,
        // As the papers and the HUD date it: a game day is a week.
        dateText: weekLabel(l.at),
        read: l.read,
        choices: l.open && def ? choiceViews(def) : [],
        result: l.result,
      };
    });

  return {
    fire(id, port) {
      const def = eventDef(id);
      if (!def) return `No event ${id}`;
      const w = world(port);
      const region = port ? regionOfPort(port) : undefined;
      const place = {
        port: port ?? def.ports?.[0],
        region: region ?? (def.ports?.[0] ? regionOfPort(def.ports[0]) : undefined),
      };
      if (!port && !def.ports) {
        // As the draw would place it: your hottest region, your hideout's, or here.
        if (def.outcomes.some((o) => o.kind === 'cutter')) place.region = w.topWanted.region;
        else if (def.triggers.hideout) place.region = w.hideouts[0]?.region;
        else place.region = w.hereRegion;
      }
      const ev = fire(def, place, w);
      if (def.channels.includes('chart') && opts.onVoyage()) openScene(ev, 'chart');
      if (def.channels.includes('scene') && port) openScene(ev, 'scene');
      return ev;
    },
    check,
    scene: sceneView,
    choose(id) {
      if (!scene || scene.result) return 'Not now';
      const r = tryChoice(scene.ev, id);
      if (typeof r === 'string') {
        opts.showScene(sceneView());
        return r;
      }
      scene.result = fill(scene.ev, r.result);
      opts.showScene(sceneView());
      return undefined;
    },
    closeScene,
    docked,
    letters: letterViews,
    unread: () => mail().filter((l) => !l.read).length,
    readLetter(key) {
      const l = mail().find((x) => x.key === key);
      if (!l || l.read) return;
      l.read = true;
      ctx.events.emit('LetterRead', { key });
    },
    answer(key, id) {
      const l = mail().find((x) => x.key === key);
      if (!l || !l.open) return 'That letter needs no answer.';
      const ev = st().active.find((a) => a.key === key);
      if (!ev) return 'It is too late to answer that.';
      const r = tryChoice(ev, id);
      if (typeof r === 'string') return r;
      l.open = false;
      l.read = true;
      l.result = fill(ev, r.result);
      ctx.events.emit('LetterAnswered', { key, choice: id });
      return l.result;
    },
    talk: () => eventTalk(ctx.state.events, now(), fill),
    get state() {
      return st();
    },
    dispose() {
      offTick();
    },
  };
}
