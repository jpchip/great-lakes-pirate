import type { Geo } from '../core/coords';
import type { GameContext } from '../modes/context';
import { discoveriesFile, findLead, type LeadInput } from '../sim/discovery/discovery';
import { ISLANDS } from '../sim/islands/on-foot';
import {
  CACHE_FILE,
  cacheNote,
  clueDef,
  CLUES,
  darkOfTheMoon,
  documentClue,
  HOARD_LEGEND,
  LEGEND_RULES,
  legendCash,
  legendDef,
  LEGENDS,
  legendSpotGeo,
  logbookClues,
  mapRefusal,
  seededCache,
  stockedCaches,
  type PlacedLegends,
  type PlacedLegendSpot,
} from '../sim/legends/legends';
import { createLegends, type LegendsState } from '../sim/legends/state';
import { rumorDefs } from '../sim/rumors/rumors';
import { log } from '../sim/run/record';
import type { ClueDef, LegendDef } from '../../data/schemas/legends';
import type { GameDiscovery } from './discovery';

/**
 * Clues and legends in the running game (plan 11 §7–9; §18.4 piece T). The sources hand
 * their clues here: a light station's log read or taken, the papers in a district's desks,
 * the marks in the land read with F. Each opens its lead or shrinks its circle (piece O).
 * Three clues and a cartography table make a lead a map with an X. At the spot, F held
 * digs, or opens the hiding place, and the legend pays: its cash, its curio, a story in the
 * papers (and with it Fame), and for some a hideout site or a fence's introduction.
 */

export interface LegendPrompt {
  text: string;
  /** Held this long, s (a dig); absent, a press. */
  holdS?: number;
  act(): void;
}

/** A beaten copycat's hoard: what's in it, and taking it. */
export interface Hoard {
  lead: string;
  rival: string;
  cents: number;
  goods: { good: string; qty: number }[];
  take(): void;
}

export interface LegendsDeps {
  ctx: GameContext;
  discovery: Pick<GameDiscovery, 'lead' | 'giveCurio' | 'cacheOpened' | 'chart' | 'knows'> & {
    readonly leads: GameDiscovery['leads'];
  };
  runSeed(): number;
  notice(text: string): void;
  /** The legends' spots and clue marks in the loaded zone. */
  placed(): PlacedLegends | undefined;
  /** Where a wreck lies (the Lucerne). */
  wreckAt?(id: string): Geo | undefined;
  /** Where a seeded cache's first spot lies on the chart, when its island is loaded. */
  cacheGeo?(id: string): Geo | undefined;
  /** The ice's top in a cave when it's an ice cave; undefined if not. */
  iceTop?(cave: string): number | undefined;
  /** The moon's lit share (0 new … 1 full) and the sun's elevation, radians. */
  sky(): { moon: number; sunEl: number };
  /** The beaten rival camping at this camp, with an open stash lead: his hoard. */
  hoard?(camp: string): Hoard | undefined;
  /** Game time passes (drawing a map). */
  passTime(gameSeconds: number): void;
}

export interface MapRow {
  lead: string;
  title: string;
  where: string;
  clues: number;
  need: number;
  refusal: string | undefined;
}

export interface GameLegends {
  readonly state: LegendsState;
  /** A light station's log read or taken: its clues, in words for the notice. */
  logbook(light: string): string | undefined;
  /** A box's papers in a district: a clue, or a note about a cache, in words. */
  papers(district: string, box: string): string | undefined;
  /** F on foot at (x, y, z): read a mark, dig, or search a hiding place. */
  prompt(at: { x: number; y: number; z: number }): LegendPrompt | undefined;
  /**
   * The grapple hooked on a wreck: a legend's strongbox comes up instead of her cargo when
   * the lead knows where to hook. The notice's text, or undefined.
   */
  wreckHooked(wreck: string): string | undefined;
  /** The cartography table's maps: the open leads, with why one can't be drawn yet. */
  maps(): MapRow[];
  /** Draws a lead into a map; the refusal, or undefined. */
  drawMap(lead: string): string | undefined;
  /** Mapped: when. */
  mapped(lead: string): number | undefined;
  /** A fence a legend introduced you to. */
  contact(fence: string): boolean;
  /** Seeded caches stocked this run. */
  stocked(cache: string): boolean;
  /** The steps of a legend for the journal. */
  steps(legend: string): { text: string; done: boolean }[];
  /** For the dev hooks and tests: a clue found by id. */
  giveClue(id: string): string | undefined;
  /** For the dev hooks: the spots and marks in the zone. */
  here(): PlacedLegends | undefined;
}

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export function attachLegends(deps: LegendsDeps): GameLegends {
  const { ctx } = deps;
  const state = ctx.state;
  const now = (): number => state.environment.clock.gameSeconds;
  const st = (): LegendsState => (state.legends ??= createLegends());
  const legendNames = new Map(rumorDefs().legends.map((l) => [l.id, l.name]));
  let stockedFor: { seed: number; set: Set<string> } | undefined;
  const stockedSet = (): Set<string> => {
    const seed = deps.runSeed();
    if (stockedFor?.seed !== seed) stockedFor = { seed, set: stockedCaches(seed) };
    return stockedFor.set;
  };

  /** The lead a legend's clue opens, its circle where the tale sets it. */
  const legendLead = (
    def: LegendDef,
    clue: { text: string; from: string },
  ): LeadInput | undefined => {
    const area = discoveriesFile().legends.find((l) => l.id === def.id);
    if (!area) return undefined;
    return {
      id: def.id,
      kind: 'legend',
      title: legendNames.get(def.id) ?? def.name,
      where: area.where,
      center: area.at,
      radiusM: area.radiusM,
      clue,
    };
  };

  /** A clue found: its lead opened or narrowed, its curio kept. True when it's new. */
  const found = (clue: ClueDef): boolean => {
    const s = st();
    if (s.clues.includes(clue.id)) return false;
    s.clues.push(clue.id);
    const def = legendDef(clue.lead);
    const text = { text: clue.text, from: clue.from };
    if (def) {
      const input = legendLead(def, text);
      if (input) deps.discovery.lead(input, legendSpotGeo(def, deps.wreckAt));
    } else {
      const cache = seededCache(clue.lead);
      if (cache) deps.discovery.lead(cacheLead(cache.id, text));
    }
    if (clue.curio) deps.discovery.giveCurio(clue.curio, clue.from);
    log(state, now(), `A clue, from ${clue.from}: ${clue.text}`);
    ctx.events.emit('ClueFound', { clue: clue.id, lead: clue.lead });
    return true;
  };

  const cacheLead = (id: string, clue: { text: string; from: string }): LeadInput => {
    const cache = seededCache(id);
    const island = ISLANDS.find((i) => i.id === cache?.island);
    const center = deps.cacheGeo?.(id) ?? island?.at ?? { lat: 0, lon: 0 };
    return {
      id,
      kind: 'cache',
      title: cache?.name ?? id,
      where: cache?.where ?? '',
      center,
      radiusM: CACHE_FILE.leadRadiusM,
      clue,
    };
  };

  /** The spot's lead id: a legend's, or the stash lead of the beaten rival at a camp. */
  const spotLead = (s: PlacedLegendSpot): string | undefined =>
    s.legend === HOARD_LEGEND ? deps.hoard?.(s.lead)?.lead : s.lead;

  /** A legend's payoff found at its spot (or a beaten copycat's hoard). */
  const pay = (s: PlacedLegendSpot): void => {
    const def = legendDef(s.legend);
    if (!def) return;
    const t = now();
    const ls = st();
    let cents: number;
    let lead = s.lead;
    let where = s.name;
    if (s.legend === HOARD_LEGEND) {
      const h = deps.hoard?.(s.lead);
      if (!h) return;
      lead = h.lead;
      cents = h.cents;
      where = `${h.rival}'s hoard`;
      h.take();
    } else {
      cents = legendCash(def, deps.runSeed());
    }
    state.player.purse += cents;
    ls.done[lead] = t;
    // The curio and the lead run down (piece O's way for a cache).
    deps.discovery.cacheOpened(lead, where, def.curio);
    if (def.fence && !ls.contacts.includes(def.fence)) ls.contacts.push(def.fence);
    if (def.site && !deps.discovery.knows(def.site)) deps.discovery.chart(def.site, 'logbook');
    deps.notice(def.found.replace('{cash}', money(cents)));
    log(state, t, `Found ${lowerFirst(def.name)}: ${money(cents)}. ${def.told}`);
    ctx.events.emit('Dug', { lead, found: true });
    // The legend itself, the first time (a second hoard is only money).
    if (ls.done[def.id] === undefined || def.id === lead) {
      ls.done[def.id] = t;
      ctx.events.emit('LegendCompleted', { id: def.id, lead, cents });
    }
  };

  const isDone = (s: PlacedLegendSpot): boolean => {
    if (s.legend === HOARD_LEGEND) {
      // An empty camp's turned ground can always be dug (and found empty).
      const lead = spotLead(s);
      return lead !== undefined && st().done[lead] !== undefined;
    }
    return st().done[s.legend] !== undefined;
  };

  const spotPrompt = (s: PlacedLegendSpot): LegendPrompt => {
    const holdS = LEGEND_RULES.digHoldS;
    if (s.kind === 'cave') {
      return {
        text: `Search ${s.name}`,
        holdS,
        act: () => {
          const sky = deps.sky();
          const ice = s.cave ? deps.iceTop?.(s.cave) !== undefined : false;
          if (!ice && !darkOfTheMoon(sky.moon, sky.sunEl)) {
            deps.notice(
              sky.sunEl >= 0
                ? 'Nothing but wet rock by daylight.'
                : 'Too much moon on the water to see anything in the rock.',
            );
            return;
          }
          pay(s);
        },
      };
    }
    if (s.legend === HOARD_LEGEND && !deps.hoard?.(s.lead)) {
      return {
        text: 'Dig where the ground has been turned',
        holdS,
        act: () => {
          deps.notice("Somebody's dug here and filled it in again. Nothing in it now.");
          ctx.events.emit('Dug', { lead: s.lead, found: false });
        },
      };
    }
    return {
      text: s.kind === 'dig' ? `Dig ${s.name}` : `Search ${s.name}`,
      holdS,
      act: () => pay(s),
    };
  };

  const api: GameLegends = {
    get state() {
      return st();
    },
    logbook(light) {
      const fresh = logbookClues(light).filter((c) => found(c));
      if (!fresh.length) return undefined;
      return fresh.length === 1
        ? 'A clue in it for your journal.'
        : `${fresh.length} clues in it for your journal.`;
    },
    papers(district, box) {
      const s = st();
      const clue = documentClue(district, s.clues);
      // A legend's clue among them, if there's one left in this district's papers; then
      // now and then a note about a stocked cache (by the seed and the box).
      if (clue && boxHolds(deps.runSeed(), box)) {
        found(clue);
        return `a paper that bears on a legend: ${clue.text}`;
      }
      const note = cacheNote(deps.runSeed(), box, s.notes);
      if (!note) return undefined;
      s.notes.push(note.id);
      deps.discovery.lead(cacheLead(note.id, { text: note.note, from: 'papers taken in a desk' }));
      ctx.events.emit('ClueFound', { clue: `note:${note.id}`, lead: note.id });
      return `a note about a cache: ${note.note}`;
    },
    prompt(at) {
      const placed = deps.placed();
      if (!placed) return undefined;
      const s = st();
      for (const m of placed.marks) {
        if (s.clues.includes(m.clue)) continue;
        if (Math.hypot(at.x - m.x, at.z - m.z) > LEGEND_RULES.markReachM) continue;
        if (Math.abs(at.y - m.y) > 2) continue;
        const clue = clueDef(m.clue);
        if (!clue) continue;
        return {
          text: `Look at ${m.name}`,
          act: () => {
            if (found(clue)) deps.notice(clue.text);
          },
        };
      }
      for (const spot of placed.spots) {
        if (isDone(spot)) continue;
        if (Math.hypot(at.x - spot.x, at.z - spot.z) > LEGEND_RULES.reachM) continue;
        const floor =
          spot.kind === 'cave' && spot.cave
            ? Math.max(spot.y, deps.iceTop?.(spot.cave) ?? -Infinity)
            : spot.y;
        if (Math.abs(at.y - floor) > 1.8) continue;
        return spotPrompt(spot);
      }
      return undefined;
    },
    wreckHooked(wreck) {
      for (const def of LEGENDS) {
        if (def.spot.kind !== 'wreck' || def.spot.wreck !== wreck) continue;
        if (st().done[def.id] !== undefined) continue;
        const lead = findLead(deps.discovery.leads, def.id);
        // The box comes up once you know where in her to hook: the lead's three clues.
        if (!lead || lead.clues.length < LEGEND_RULES.mapClues) continue;
        const cents = legendCash(def, deps.runSeed());
        state.player.purse += cents;
        const t = now();
        st().done[def.id] = t;
        deps.discovery.cacheOpened(
          def.id,
          `the wreck of the ${def.name.replace(/^The /, '').replace(/'s .*$/, '')}`,
          def.curio,
        );
        log(state, t, `Found ${lowerFirst(def.name)}: ${money(cents)}. ${def.told}`);
        ctx.events.emit('LegendCompleted', { id: def.id, lead: def.id, cents });
        return def.found.replace('{cash}', money(cents));
      }
      return undefined;
    },
    maps() {
      const s = st();
      return deps.discovery.leads
        .filter(
          (l) =>
            !l.closed && s.maps[l.id] === undefined && (l.kind === 'legend' || l.kind === 'cache'),
        )
        .map((l) => ({
          lead: l.id,
          title: l.title,
          where: l.where,
          clues: l.clues.length,
          need: LEGEND_RULES.mapClues,
          refusal: mapRefusal(l, s.maps) ?? (spotGeo(l.id) ? undefined : 'Nothing to fix it to.'),
        }));
    },
    drawMap(id) {
      const lead = findLead(deps.discovery.leads, id);
      if (!lead) return 'No such lead.';
      const why = mapRefusal(lead, st().maps);
      if (why) return why;
      const at = spotGeo(id);
      if (!at) return 'Nothing to fix it to.';
      deps.passTime(LEGEND_RULES.mapHours * 3600);
      lead.center = { lat: at.lat, lon: at.lon };
      lead.radiusM = LEGEND_RULES.mapRadiusM;
      st().maps[id] = now();
      log(
        state,
        now(),
        `Drew a map of ${lowerFirst(lead.title)} at the cartography table: X marks the spot.`,
      );
      ctx.events.emit('MapDrawn', { lead: id });
      ctx.events.emit('LeadUpdated', { id, opened: false });
      return undefined;
    },
    mapped: (lead) => st().maps[lead],
    contact: (fence) => st().contacts.includes(fence),
    stocked: (cache) => stockedSet().has(cache),
    steps(legend) {
      const lead = findLead(deps.discovery.leads, legend);
      if (!lead) return [];
      const need = LEGEND_RULES.mapClues;
      return [
        { text: 'Heard the tale, or found a clue', done: true },
        {
          text: `Gather clues (${Math.min(lead.clues.length, need)} of ${need})`,
          done: lead.clues.length >= need,
        },
        { text: 'Draw a map at a cartography table', done: st().maps[legend] !== undefined },
        { text: 'Find what the tale is about', done: st().done[legend] !== undefined },
      ];
    },
    giveClue(id) {
      const clue = clueDef(id);
      if (!clue) return `No clue ${id}`;
      return found(clue) ? undefined : 'Found already';
    },
    here: () => deps.placed(),
  };

  /** A lead's spot on the chart, for its map's X. */
  function spotGeo(id: string): Geo | undefined {
    const def = legendDef(id);
    if (def) return legendSpotGeo(def, deps.wreckAt);
    if (seededCache(id)) return deps.cacheGeo?.(id);
    return undefined;
  }

  return api;
}

/**
 * Whether a box's papers bear on a legend: about one box in two, by the seed and the box,
 * so a district's clues turn up over a few nights' work.
 */
function boxHolds(runSeed: number, box: string): boolean {
  let h = 2166136261 ^ runSeed;
  for (let i = 0; i < box.length; i++) h = Math.imul(h ^ box.charCodeAt(i), 16777619);
  return (h >>> 0) % 2 === 0;
}

function lowerFirst(s: string): string {
  return s.startsWith('The ') ? `the ${s.slice(4)}` : s;
}

/** Every clue in the files, for the tests. */
export const ALL_CLUES = CLUES;
