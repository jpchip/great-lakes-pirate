import chartJson from '../../data/chart.json';
import { chartFileSchema } from '../../data/schemas/chart';
import type { DiscoveryKind } from '../../data/schemas/discoveries';
import type { Geo } from '../core/coords';
import type { GameContext } from '../modes/context';
import {
  addClue,
  chartAround,
  chartFromLogbook,
  chartSurvey,
  closeLead,
  createDiscovery,
  curioDef,
  curioDefs,
  discoveriesFile,
  displaySpaces,
  findLead,
  giveCurio,
  isFound,
  legendLeads,
  lookAround,
  markFound,
  markHeard,
  openLead,
  overChartedShoal,
  placeDef,
  placeDefs,
  placeTargets,
  showCurio,
  SITE_SIGHT_M,
  WRECK_SIGHT_M,
  type CurioState,
  type DiscoveryState,
  type DiscoveryTarget,
  type FoundHow,
  type Lead,
  type LeadInput,
  type Lookout,
} from '../sim/discovery/discovery';
import { storeItems } from '../sim/economy/chandlery';
import { siteGeo, SITES } from '../sim/hideouts/stash';
import { LEGEND_RULES, legendDef } from '../sim/legends/legends';
import { LIGHTHOUSES } from '../sim/lighthouses';
import { ISLANDS } from '../sim/islands/on-foot';
import type { LawDefs } from '../sim/law/defs';
import { gainFame } from '../sim/law/law';
import { rumorDefs } from '../sim/rumors/rumors';
import { log } from '../sim/run/record';
import { portName } from '../sim/traffic/news';
import { weekLabel } from '../ui/hud/model';
import { emitLaw } from './law';

/**
 * Discovery and the journal in the running game (plan 11 §7, §11; plan 13 §5; Phase 9
 * piece O). The game looks round for the captain about once a second (from the deck, on
 * foot, or the chart's lookout on a voyage), and whatever's newly in sight goes on the
 * chart with a line in the logbook; Fame for a natural wonder. Saloon talk of a place puts
 * it on as reported, a Lake Survey sheet from the chandlery charts its coves and shoals,
 * and a keeper's log the shoals and wrecks near his light. Legend tales heard open leads
 * with a search circle on the chart. Curios found are kept, and can be set out on the
 * shelves, tables and sea chests of a hideout.
 */

/** A chart mark for something discovered (or reported). */
export interface DiscoveryMark {
  id: string;
  at: Geo;
  label: string;
  kind: DiscoveryKind | 'site' | 'reported';
  /** Coves and shoals: how far they reach, real meters. */
  radiusM?: number | undefined;
}

/** A lead's search circle on the chart. */
export interface LeadMark {
  id: string;
  at: Geo;
  radiusM: number;
  label: string;
  /** Drawn into a map at a cartography table (piece T): an X on the chart. */
  mapped: boolean;
}

export interface JournalLeadRow {
  id: string;
  title: string;
  where: string;
  kindText: string;
  /** "About 3 nautical miles across". */
  areaText: string;
  clues: { text: string; from: string; dateText: string }[];
  closedText: string | undefined;
}

export interface JournalLegendRow {
  id: string;
  name: string;
  /** "Heard in Bayfield, Wk of May 14, 1900". */
  heardText: string;
  line: string;
  /** "Off Long Island", or "Not yet heard" when there's no lead. */
  where: string;
  steps: { text: string; done: boolean }[];
  status: string;
  /** Run down (piece T): the tale explained. */
  told?: string | undefined;
}

export interface JournalDiscoveryRow {
  id: string;
  name: string;
  text: string;
  /** "Sighted", "Through the glass", "Sounded", "From the survey". */
  howText: string;
  dateText: string;
  reported: boolean;
}

export interface JournalDiscoveryGroup {
  kind: string;
  title: string;
  rows: JournalDiscoveryRow[];
  /** "4 of 7 known". */
  countText: string;
}

export interface JournalCurioRow {
  id: string;
  name: string;
  text: string;
  from: string;
  dateText: string;
  /** "Set out at Stockton Stash", or "Aboard, in your sea chest". */
  whereText: string;
}

/** The journal's discovery pages (plan 13 §5 tabs Leads, Legends, Discoveries, Curios). */
export interface JournalDiscovery {
  leads: JournalLeadRow[];
  legends: JournalLegendRow[];
  discoveries: JournalDiscoveryGroup[];
  curios: JournalCurioRow[];
  curiosTotal: number;
}

/** A hideout's Curios tab: what's set out there, what's aboard, and the room. */
export interface HideoutCurios {
  hideout: string;
  spaces: number;
  shown: { id: string; name: string; text: string }[];
  aboard: { id: string; name: string; text: string }[];
}

export interface DiscoveryOptions {
  ctx: GameContext;
  law: LawDefs;
  /** A line on the HUD. */
  notice(text: string): void;
  /** Where the captain looks from now, or undefined when there's nobody to look (a menu). */
  lookout(): Lookout | undefined;
  /**
   * The old wrecks on the bottom (piece U's salvage): not sighted from afar as a wreck with
   * her masts out is, but charted by salvage when seen on the bottom or sounded, and by a
   * keeper's log when they're `logged`.
   */
  oldWrecks?: () => readonly { id: string; name: string; at: Geo; lore: string; logged: boolean }[];
  /** A line on what's been brought up from a wreck, for the journal (piece U). */
  wreckNote?: (id: string) => string | undefined;
}

export interface GameDiscovery {
  readonly state: DiscoveryState;
  readonly leads: Lead[];
  readonly curios: CurioState[];
  /** One look round; returns the ids newly charted. */
  look(lookout?: Lookout): string[];
  /** Is this place, site or wreck on the chart? */
  knows(id: string): boolean;
  /** Is this point over a shoal on the chart (the depth readout warns earlier)? */
  overChartedShoal(at: Geo): boolean;
  marks(): DiscoveryMark[];
  leadMarks(): LeadMark[];
  journal(): JournalDiscovery;
  /** A light station's logbook read (plan 11 §10). */
  logbookRead(lightId: string): string[];
  /** A cache opened (plan 11 §7.3): its curio, and the lead that led there run down. */
  cacheOpened(cacheId: string, where: string, curio: string | undefined): void;
  /** A curio got by other means (the dev hook, later salvage and legends). */
  giveCurio(id: string, from: string): boolean;
  hideoutCurios(hideout: string): HideoutCurios;
  /** Set out (`hideout`) or take aboard (undefined); the refusal, or undefined. */
  setCurio(id: string, hideout: string | undefined): string | undefined;
  /** Opens a lead, or adds a clue to one (piece T's clues come through here). */
  lead(input: LeadInput, toward?: Geo): Lead;
  /** Puts a place on the chart (dev hooks, tests). */
  chart(id: string, how?: FoundHow): boolean;
  dispose(): void;
}

const PORT_GEO = new Map(
  chartFileSchema
    .parse(chartJson)
    .flatMap((f) =>
      f.kind === 'port' ? [[f.id, { lat: f.at[1], lon: f.at[0] }] as [string, Geo]] : [],
    ),
);

/** Within this of where you've been, an older save's places are charted (real meters). */
const VISITED_RADIUS_M = 3000;

const HOW_TEXT: Record<FoundHow, string> = {
  sight: 'Sighted',
  spyglass: 'Through the glass',
  foot: 'Walked it',
  visit: 'Sounded',
  sounding: 'Found by the lead',
  survey: 'From the survey',
  logbook: "From a keeper's log",
  yours: 'Your own',
  start: 'Known',
};

const GROUPS: { kind: DiscoveryKind | 'site' | 'wreck'; title: string }[] = [
  { kind: 'site', title: 'Hideout sites' },
  { kind: 'poi', title: 'Places' },
  { kind: 'wonder', title: 'Natural wonders' },
  { kind: 'anchorage', title: 'Anchorages' },
  { kind: 'shoal', title: 'Shoals' },
  { kind: 'wreck', title: 'Wrecks' },
];

const LEAD_KIND_TEXT: Record<Lead['kind'], string> = {
  legend: 'Legend',
  place: 'A place',
  cache: 'A cache',
  wreck: 'A wreck',
  stash: "A rival's stash",
};

/** "About 3 nm across", from a radius in real meters. */
export function areaText(radiusM: number): string {
  const nm = (2 * radiusM) / 1852;
  if (nm < 0.75) return 'Under a mile across: close enough to search';
  if (nm < 1.5) return 'About a mile across';
  return `About ${Math.round(nm)} miles across`;
}

export function attachDiscovery(opts: DiscoveryOptions): GameDiscovery {
  const { ctx } = opts;
  const state = ctx.state;
  const now = (): number => state.environment.clock.gameSeconds;
  const fresh = !state.discovery;
  const d = (state.discovery ??= createDiscovery());
  const leads = (state.leads ??= []);
  const curios = (state.curios ??= []);
  const legendNames = new Map(rumorDefs().legends.map((l) => [l.id, l.name]));
  const islandName = new Map(ISLANDS.map((i) => [i.id, i.name]));

  const siteTargets = (): DiscoveryTarget[] =>
    SITES.flatMap((s) => {
      const at = siteGeo(s);
      return at ? [{ id: s.id, kind: 'site' as const, at, sightM: SITE_SIGHT_M }] : [];
    });
  const wreckTargets = (): DiscoveryTarget[] =>
    (state.wrecks?.list ?? []).map((w) => ({
      id: w.id,
      kind: 'wreck' as const,
      at: w.at,
      sightM: WRECK_SIGHT_M,
    }));
  const places = placeTargets();
  const oldWrecks = () => opts.oldWrecks?.() ?? [];
  const targets = (): DiscoveryTarget[] => [...places, ...siteTargets(), ...wreckTargets()];

  const nameOf = (id: string): string => {
    const p = placeDef(id);
    if (p) return p.name;
    const s = SITES.find((x) => x.id === id);
    if (s) return s.name;
    const w = state.wrecks?.list.find((x) => x.id === id) ?? oldWrecks().find((x) => x.id === id);
    if (w) return `the wreck of the ${w.name}`;
    return id;
  };

  /** Your own: the hideouts you hold and the wrecks you made (or abandoned). */
  const yours = (): string[] => {
    const out: string[] = [];
    const t = now();
    for (const h of Object.values(state.hideouts ?? {})) {
      if (markFound(d, h.siteId, 'yours', t)) out.push(h.siteId);
    }
    for (const w of state.wrecks?.list ?? []) {
      if (w.byPlayer && markFound(d, w.id, 'yours', t)) out.push(w.id);
    }
    return out;
  };

  // A run from before discovery was kept: what it has been near is on its chart already
  // (the ports it has prices from, its hideouts, the light stations landed at, the caches
  // searched, and where it is now), and every wreck it had on the chart stays there.
  if (fresh) {
    const t = now();
    const visited: Geo[] = [];
    for (const port of Object.keys(state.knowledge.prices)) {
      const at = PORT_GEO.get(port);
      if (at) visited.push(at);
    }
    for (const id of Object.keys(state.lightStations ?? {})) {
      const l = LIGHTHOUSES.find((x) => x.id === id);
      if (l) visited.push(l.at);
    }
    for (const id of Object.keys(state.caches ?? {})) {
      const isl = ISLANDS.find((i) => i.onFoot?.caches.some((c) => c.id === id));
      if (isl) visited.push(isl.at);
    }
    const here = opts.lookout()?.at;
    if (here) visited.push(here);
    chartAround(d, targets(), visited, VISITED_RADIUS_M, t);
    for (const w of state.wrecks?.list ?? []) markFound(d, w.id, 'start', t);
    // The Stockton quarry's cache searched: the quarry's been walked.
    if (state.caches?.['cache.stockton_quarry']) markFound(d, 'poi.stockton_quarry', 'start', t);
  }
  yours();

  const legendFromRumors = (): void => {
    for (const lead of legendLeads(leads, state.knowledge.rumors, legendNames, (p) =>
      portName(p),
    )) {
      ctx.events.emit('LeadUpdated', { id: lead.id, opened: true });
    }
  };
  legendFromRumors();

  const announce = (found: { id: string; how: FoundHow }[]): void => {
    const t = now();
    for (const { id, how } of found) {
      const p = placeDef(id);
      const kind = p?.kind ?? (id.startsWith('site.') ? 'site' : 'wreck');
      const name = nameOf(id);
      const verb =
        kind === 'anchorage' || kind === 'shoal'
          ? 'Sounded and charted'
          : how === 'sounding'
            ? 'Sounded out'
            : how === 'spyglass'
              ? 'Made out through the glass'
              : how === 'foot'
                ? 'Came upon'
                : 'Sighted';
      log(state, t, `${verb} ${lowerFirst(name)}.`);
      opts.notice(`Charted: ${name}`);
      ctx.events.emit('PoiDiscovered', { id, kind, how });
      if (p?.kind === 'wonder') {
        ctx.events.emit('WonderSeen', { id });
        const e = gainFame(opts.law, state, p.fame ?? 0, t);
        if (e) emitLaw(ctx, e);
      }
      // A lead that pointed at it is run down.
      const lead = findLead(leads, id);
      if (lead && closeLead(lead, 'found', t)) {
        ctx.events.emit('LeadUpdated', { id, opened: false });
      }
    }
  };

  const offRumor = ctx.events.on('RumorHeard', ({ rumor }) => {
    if (rumor.kind === 'legend') legendFromRumors();
    if (rumor.kind !== 'place') return;
    const id = rumor.subject ?? rumor.draft;
    if (markHeard(d, id, rumor.port ?? '', now())) {
      opts.notice(`On the chart as reported: ${nameOf(id)}`);
    }
  });

  const offStores = ctx.events.on('StoresBought', ({ item }) => {
    const def = storeItems().find((s) => s.id === item);
    if (!def?.charts) return;
    const ids = chartSurvey(d, def.charts, now());
    const survey = discoveriesFile().surveys.find((s) => s.id === def.charts);
    const name = survey?.name ?? def.name;
    log(
      state,
      now(),
      ids.length
        ? `Bought the ${name}: ${ids.length} anchorages and shoals marked on the chart.`
        : `Bought the ${name}; it had nothing the chart didn't.`,
    );
    for (const id of ids) {
      const p = placeDef(id);
      ctx.events.emit('PoiDiscovered', { id, kind: p?.kind ?? 'shoal', how: 'survey' });
    }
  });

  const placeMark = (id: string): DiscoveryMark | undefined => {
    const p = placeDef(id);
    if (p) {
      return {
        id,
        at: p.at,
        label: p.name,
        kind: isFound(d, id) ? p.kind : 'reported',
        radiusM: p.radiusM,
      };
    }
    const s = SITES.find((x) => x.id === id);
    const at = s && siteGeo(s);
    // Your own hideouts are drawn by the chart already; a site you don't hold is marked.
    if (s && at && !Object.values(state.hideouts ?? {}).some((h) => h.siteId === s.id)) {
      return { id, at, label: s.shortName ?? s.name, kind: 'site' };
    }
    return undefined;
  };

  const hideoutName = (id: string): string => {
    const h = state.hideouts?.[id];
    const s = h && SITES.find((x) => x.id === h.siteId);
    return s?.shortName ?? s?.name ?? id;
  };

  const ctl: GameDiscovery = {
    state: d,
    leads,
    curios,
    look(lookout) {
      const look = lookout ?? opts.lookout();
      const found = yours().map((id) => ({ id, how: 'yours' as FoundHow }));
      if (look) found.push(...lookAround(d, targets(), look, now()));
      // Your own are on the chart without a fanfare.
      announce(found.filter((f) => f.how !== 'yours'));
      return found.map((f) => f.id);
    },
    knows: (id) => isFound(d, id),
    overChartedShoal: (at) => overChartedShoal(d, at),
    marks() {
      const out: DiscoveryMark[] = [];
      for (const id of Object.keys(d.found)) {
        const m = placeMark(id);
        if (m) out.push(m);
      }
      for (const id of Object.keys(d.heard)) {
        if (d.found[id]) continue;
        const m = placeMark(id);
        if (m) out.push({ ...m, kind: 'reported', label: `${m.label} (reported)` });
      }
      return out;
    },
    leadMarks: () =>
      leads
        .filter((l) => !l.closed)
        .map((l) => ({
          id: l.id,
          at: l.center,
          radiusM: l.radiusM,
          label: l.title,
          mapped: state.legends?.maps[l.id] !== undefined,
        })),
    journal() {
      const t = now();
      const leadRows: JournalLeadRow[] = [...leads]
        .sort((a, b) => Number(!!a.closed) - Number(!!b.closed) || b.openedAt - a.openedAt)
        .map((l) => ({
          id: l.id,
          title: l.title,
          where: l.where,
          kindText: LEAD_KIND_TEXT[l.kind],
          areaText: areaText(l.radiusM),
          clues: l.clues.map((c) => ({ text: c.text, from: c.from, dateText: weekLabel(c.at) })),
          closedText: l.closed
            ? l.closed.outcome === 'found'
              ? `Run down, ${weekLabel(l.closed.at)}`
              : `Gone cold, ${weekLabel(l.closed.at)}`
            : undefined,
        }));
      const legends: JournalLegendRow[] = rumorDefs().legends.map((def) => {
        const lead = findLead(leads, def.id);
        const first = lead?.clues[0];
        const area = discoveriesFile().legends.find((a) => a.id === def.id);
        return {
          id: def.id,
          name: lead ? def.name : 'A tale not yet heard',
          heardText: first
            ? `Heard ${first.from.replace(/^saloon talk in /, 'in ')}, ${weekLabel(first.at)}`
            : 'Ask in the saloons.',
          line: first?.text ?? '',
          where: lead ? capitalize(area?.where ?? lead.where) : '',
          // Piece T's steps: the tale, three clues, a map at the table, and the find.
          steps: lead
            ? [
                { text: 'Heard the tale, or found a clue', done: true },
                {
                  text: `Gather clues (${Math.min(lead.clues.length, LEGEND_RULES.mapClues)} of ${LEGEND_RULES.mapClues})`,
                  done: lead.clues.length >= LEGEND_RULES.mapClues,
                },
                {
                  text: 'Draw a map at a cartography table',
                  done: state.legends?.maps[def.id] !== undefined,
                },
                { text: 'Find what the tale is about', done: lead.closed?.outcome === 'found' },
              ]
            : [],
          ...(lead?.closed?.outcome === 'found' && legendDef(def.id)
            ? { told: legendDef(def.id)?.told }
            : {}),
          status: !lead ? '' : lead.closed?.outcome === 'found' ? 'Found' : 'Unsolved',
        };
      });
      // Heard first, in the catalog's order; the unheard ones as blanks at the end.
      legends.sort((a, b) => Number(!a.status) - Number(!b.status));
      const groups: JournalDiscoveryGroup[] = GROUPS.map((g) => {
        const rows: JournalDiscoveryRow[] = [];
        let total = 0;
        const add = (id: string, name: string, text: string): void => {
          const f = d.found[id];
          const h = d.heard[id];
          if (!f && !h) return;
          rows.push({
            id,
            name,
            text,
            howText: f ? HOW_TEXT[f.how] : `Reported in ${portName(h?.port ?? '')}`,
            dateText: weekLabel(f?.at ?? h?.at ?? t),
            reported: !f,
          });
        };
        if (g.kind === 'site') {
          for (const s of SITES) {
            total++;
            add(s.id, s.name, s.blurb);
          }
        } else if (g.kind === 'wreck') {
          for (const w of [...(state.wrecks?.list ?? []), ...oldWrecks()]) {
            total++;
            const note = opts.wreckNote?.(w.id);
            add(w.id, `The ${w.name}`, note ? `${w.lore} ${note}` : w.lore);
          }
        } else {
          for (const p of placeDefs()) {
            if (p.kind !== g.kind) continue;
            total++;
            const isl = p.island ? islandName.get(p.island) : undefined;
            add(p.id, p.name, isl && !p.name.includes(isl) ? `${p.text} (${isl})` : p.text);
          }
        }
        rows.sort((a, b) => Number(a.reported) - Number(b.reported));
        const known = rows.filter((r) => !r.reported).length;
        // Wrecks are as many as the lake has made: no total to chase.
        const countText = g.kind === 'wreck' ? `${known} known` : `${known} of ${total} known`;
        return { kind: g.kind, title: g.title, rows, countText };
      });
      const curioRows: JournalCurioRow[] = curios.map((c) => {
        const def = curioDef(c.id);
        return {
          id: c.id,
          name: def?.name ?? c.id,
          text: def?.text ?? '',
          from: c.from,
          dateText: weekLabel(c.gotAt),
          whereText: c.shownAt
            ? `Set out at ${hideoutName(c.shownAt)}`
            : 'Aboard, in your sea chest',
        };
      });
      return {
        leads: leadRows,
        legends,
        discoveries: groups,
        curios: curioRows,
        curiosTotal: curioDefs().length,
      };
    },
    logbookRead(lightId) {
      const light = LIGHTHOUSES.find((l) => l.id === lightId);
      if (!light) return [];
      const wrecks = [...(state.wrecks?.list ?? []), ...oldWrecks().filter((w) => w.logged)].map(
        (w) => ({ id: w.id, at: w.at }),
      );
      const ids = chartFromLogbook(d, light.at, wrecks, now());
      for (const id of ids) {
        const p = placeDef(id);
        ctx.events.emit('PoiDiscovered', { id, kind: p?.kind ?? 'wreck', how: 'logbook' });
      }
      if (ids.length) {
        log(
          state,
          now(),
          `Copied from the ${light.name} log: ${ids.map((id) => lowerFirst(nameOf(id))).join(', ')}.`,
        );
      }
      return ids;
    },
    cacheOpened(cacheId, where, curio) {
      const t = now();
      if (curio && giveCurio(curios, curio, where, t)) {
        ctx.events.emit('CurioFound', { id: curio });
        log(state, t, `Found ${lowerFirst(curioDef(curio)?.name ?? curio)} in ${where}.`);
      }
      const lead = findLead(leads, cacheId);
      if (lead && closeLead(lead, 'found', t)) {
        ctx.events.emit('LeadUpdated', { id: cacheId, opened: false });
      }
    },
    giveCurio(id, from) {
      const ok = giveCurio(curios, id, from, now());
      if (ok) ctx.events.emit('CurioFound', { id });
      return ok;
    },
    hideoutCurios(hideout) {
      const h = state.hideouts?.[hideout];
      const view = (c: CurioState) => ({
        id: c.id,
        name: curioDef(c.id)?.name ?? c.id,
        text: curioDef(c.id)?.text ?? '',
      });
      return {
        hideout,
        spaces: h ? displaySpaces(h.layout) : 0,
        shown: curios.filter((c) => c.shownAt === hideout).map(view),
        aboard: curios.filter((c) => !c.shownAt).map(view),
      };
    },
    setCurio(id, hideout) {
      const c = curios.find((k) => k.id === id);
      if (!c) return "You don't have that.";
      if (hideout) {
        const room = ctl.hideoutCurios(hideout);
        if (room.spaces === 0)
          return 'Nothing here to set it on: build a shelf, a table or a sea chest.';
        if (c.shownAt !== hideout && room.shown.length >= room.spaces) {
          return 'Every shelf and table here has something on it.';
        }
      }
      showCurio(curios, id, hideout);
      return undefined;
    },
    lead(input, toward) {
      const have = findLead(leads, input.id);
      if (!have) {
        const lead = openLead(leads, input, now());
        ctx.events.emit('LeadUpdated', { id: lead.id, opened: true });
        return lead;
      }
      if (addClue(have, { ...input.clue, toward }, now())) {
        ctx.events.emit('LeadUpdated', { id: have.id, opened: false });
      }
      return have;
    },
    chart(id, how = 'sight') {
      const ok = markFound(d, id, how, now());
      if (ok) announce([{ id, how }]);
      return ok;
    },
    dispose() {
      offRumor();
      offStores();
    },
  };
  return ctl;
}

function lowerFirst(s: string): string {
  return s.startsWith('The ') ? `the ${s.slice(4)}` : s;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Saloon talk of places not yet found or heard of (the `place` rumor kind). */
export function placeTalk(d: DiscoveryState | undefined) {
  return placeDefs()
    .filter((p) => p.talk && !d?.found[p.id] && !d?.heard[p.id])
    .map((p) => ({ id: p.id, ports: p.talk?.ports ?? [], lines: p.talk?.lines ?? [] }));
}
