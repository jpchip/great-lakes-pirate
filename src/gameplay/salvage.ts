import { chartToZone, type Geo, type ZoneFrame } from '../core/coords';
import { Rng } from '../core/rng';
import type { GameContext } from '../modes/context';
import { discoveriesFile, worldChart, worldGeo } from '../sim/discovery/discovery';
import { addToHold, holdFree } from '../sim/economy/hold';
import { rumorDefs } from '../sim/rumors/rumors';
import { log } from '../sim/run/record';
import {
  ageDaysOld,
  ageDaysRecent,
  castChance,
  castGrapple,
  castRefusal,
  cargoLeft,
  depthSpike,
  freshSalvage,
  oldWrecks,
  pickedClean,
  progressOf,
  SALVAGE_RULES,
  seenOnBottom,
  wreckClaim,
  type CastResult,
  type OldWreck,
  type SalvageState,
  type SalvageTarget,
  type WreckClaim,
} from '../sim/salvage';
import type { Wreck } from '../sim/wrecks';
import type { GameDiscovery } from './discovery';
import type { GameEconomy } from './economy';
import type { GameLaw } from './law';

/**
 * Salvage in the running game (plan 11 §6; Phase 9 piece U). The lake's wrecks are the
 * old ones on the bottom (the *Lucerne* and the record's others, and a few invented each
 * run) and the run's own (`state.wrecks`: sunk, scuttled, foundered, wrecked, your own
 * abandoned ship). Each is:
 *
 * - **Found** by sight on the bottom (by day, calm, clear and shallow), or by the lead line
 *   as you pass over her: the depth readout spikes by her hull's relief. Either charts her
 *   (piece O's discovery: a line in the logbook, her mark on the chart, a lead run down). A
 *   keeper's log charts the old wrecks the keepers know of.
 * - **Worked** from an anchored ship within the grapple's reach: F casts the grapple and
 *   hook. The line's down a few real seconds (the HUD says so); the cast takes 40 game
 *   minutes and hooks something by a chance (shallower, calmer, by day, a fresher wreck
 *   all help). A hooked cast brings up a few CU of her cargo (an old one's sound or spoiled
 *   by its age and kind), or now and then her papers or a curio.
 * - **The law**: old, abandoned wrecks are anybody's and your own lost ship is yours; a
 *   recent wreck's cargo comes up under her owners' marks (hot), and one you sank is hot
 *   too. Seen at a hot wreck, it's `crime.wreck_plunder`; seen at one you sank, more heat
 *   on top (her wreck keeps your stay suspicious).
 * - **Her papers** are a clue (plan 11 §7.2): the *Lucerne*'s to her legend's lead, a seeded
 *   wreck's to the next one's. Piece T makes more of them.
 */

export interface SalvageSite {
  id: string;
  name: string;
  at: Geo;
  /** Where she lies in the loaded zone, zone meters. */
  x: number;
  z: number;
  old: boolean;
  deep: boolean;
  claim: WreckClaim | 'old';
  /** The run's wreck, when she is one. */
  wreck?: Wreck | undefined;
  oldWreck?: OldWreck | undefined;
  target: SalvageTarget;
  lore: string;
}

export interface SalvageOffer {
  site: SalvageSite;
  depthM: number;
  /** Why the grapple can't go down, or undefined: it can. */
  refusal: string | undefined;
}

export interface CastOutcome {
  site: string;
  result: CastResult;
  minutes: number;
  chance: number;
  hot: boolean;
  text: string;
}

export interface SalvageDeps {
  ctx: GameContext;
  law: GameLaw;
  economy: Pick<GameEconomy, 'defs' | 'capacity' | 'syncLoad'>;
  discovery: Pick<GameDiscovery, 'knows' | 'chart' | 'giveCurio' | 'lead'>;
  seed: string;
  /** The loaded zone, when there's one to work in (not an arena). */
  zone(): { id: string; frame: ZoneFrame } | undefined;
  /** Water depth there, meters, or undefined off the zone's terrain. */
  depthAt(x: number, z: number): number | undefined;
  /** Significant wave height there, meters. */
  hsAt(x: number, z: number): number;
  /** Your ship in the zone when you're at the helm, else undefined. */
  ship(): { x: number; z: number } | undefined;
  /** Her anchor is down and holding. */
  anchored(): boolean;
  /** 0 night … 1 day; how far one sees through the weather, meters. */
  daylight(): number;
  visibilityM(): number;
  passTime(gameSeconds: number): void;
  notice(text: string): void;
  /**
   * The grapple hooked at a wreck: a legend's strongbox up instead of what she'd give
   * (piece T: the Lucerne's). Its line, or undefined.
   */
  strongbox?(wreck: string): string | undefined;
}

export interface GameSalvage {
  readonly state: SalvageState;
  /** The old wrecks of this run. */
  readonly old: readonly OldWreck[];
  /** Every wreck lying in the loaded zone. */
  sites(): SalvageSite[];
  /** One look over the side: wrecks seen on the bottom or sounded, charted. Returns their ids. */
  look(): string[];
  /** The depth readout's spike at a point, meters (0 over clear bottom). */
  spikeAt(x: number, z: number): number;
  /** The wreck in the grapple's reach of your anchored ship, found, with why not. */
  offer(): SalvageOffer | undefined;
  /** The HUD chip at anchor over a wreck. */
  chip(): string | undefined;
  /** F at anchor: the grapple goes down. True when it was this (the notice is shown). */
  start(): boolean;
  /** The line's down: is it, and on which wreck. */
  working(): string | undefined;
  /** Real seconds pass: the cast comes up when its time is done. */
  update(realS: number): CastOutcome | undefined;
  /** One cast at once (the dev hook; `chance` overrides the odds). */
  castNow(chance?: number): CastOutcome | string;
  /** Found old wrecks for the chart. */
  marks(): { at: Geo; label: string; kind: 'wreck' }[];
  /** The journal's line on what's come up from her. */
  note(id: string): string | undefined;
  /** Her cargo still in her. */
  left(id: string): { good: string; qty: number }[];
}

const CALENDAR_YEAR_DAYS = 365.25;

export function attachSalvage(deps: SalvageDeps): GameSalvage {
  const { ctx } = deps;
  const state = ctx.state;
  const rules = SALVAGE_RULES;
  const now = (): number => state.environment.clock.gameSeconds;
  const salvage = (): SalvageState => (state.salvage ??= freshSalvage());
  const old = oldWrecks(deps.seed);
  const goodName = (id: string): string =>
    (deps.economy.defs.goods.get(id)?.name ?? id).toLowerCase();
  let working: { id: string; leftS: number; chance?: number | undefined } | undefined;

  const siteOf = (frame: ZoneFrame, zoneId: string, w: Wreck | OldWreck): SalvageSite => {
    const isRun = 'shipId' in w;
    const p =
      isRun && w.zone && w.zone.id === zoneId
        ? { x: w.zone.x, z: w.zone.z }
        : chartToZone(worldChart(w.at), frame);
    const t = now();
    const ageDays = isRun ? ageDaysRecent(w.sunkAt, t) : ageDaysOld(w.lostMs, t);
    return {
      id: w.id,
      name: w.name,
      at: w.at,
      x: p.x,
      z: p.z,
      old: !isRun,
      deep: !isRun && w.deep,
      claim: isRun ? wreckClaim(w) : 'old',
      wreck: isRun ? w : undefined,
      oldWreck: isRun ? undefined : w,
      lore: w.lore,
      target: {
        id: w.id,
        cargo: w.cargo,
        papers: !isRun && !!w.papers,
        curio: isRun ? undefined : w.curio,
        ageDays,
      },
    };
  };

  const sites = (): SalvageSite[] => {
    const z = deps.zone();
    if (!z) return [];
    const out: SalvageSite[] = [];
    for (const w of [...old, ...(state.wrecks?.list ?? [])]) {
      const s = siteOf(z.frame, z.id, w);
      if (deps.depthAt(s.x, s.z) !== undefined) out.push(s);
    }
    return out;
  };

  const depthOf = (s: SalvageSite): number => Math.max(0, deps.depthAt(s.x, s.z) ?? 0);

  const offer = (): SalvageOffer | undefined => {
    const ship = deps.ship();
    if (!ship || !deps.anchored()) return undefined;
    let best: { s: SalvageSite; d: number } | undefined;
    for (const s of sites()) {
      if (!deps.discovery.knows(s.id)) continue;
      const d = Math.hypot(s.x - ship.x, s.z - ship.z);
      if (d <= rules.reachM && (!best || d < best.d)) best = { s, d };
    }
    if (!best) return undefined;
    const s = best.s;
    const depthM = depthOf(s);
    const p = salvage().wrecks[s.id];
    const refusal = castRefusal(rules, {
      depthM,
      hsM: deps.hsAt(ship.x, ship.z),
      deep: s.deep,
      holdFree: holdFree(state.player.cargo, deps.economy.capacity),
      pickedClean: pickedClean(s.target, p),
      findsLeft:
        (s.target.papers && p?.papersAt === undefined) ||
        (!!s.target.curio && p?.curioAt === undefined),
    });
    return { site: s, depthM, refusal };
  };

  const hotFor = (s: SalvageSite, good: string) => {
    const w = s.wreck;
    if (!w || (s.claim !== 'owned' && s.claim !== 'victim')) return undefined;
    return {
      region: w.region ?? deps.law.region() ?? 'region.apostles',
      heat: rules.hotHeat,
      traceability: deps.economy.defs.goods.get(good)?.traceability ?? 0.5,
      since: w.sunkAt,
      ...(w.owner ? { owner: w.owner } : {}),
    };
  };

  /** Seen at a hot wreck: the law hears, once a day a wreck. */
  const lawAt = (s: SalvageSite): void => {
    const w = s.wreck;
    if (!w || (s.claim !== 'owned' && s.claim !== 'victim')) return;
    const p = progressOf(salvage(), s.id, now());
    const t = now();
    if (p.crimeAt !== undefined && t - p.crimeAt < rules.crimeEveryHours * 3600) return;
    const witnesses = deps.law.witnesses.witnesses();
    if (witnesses.length === 0) return;
    p.crimeAt = t;
    const region = w.region ?? deps.law.region() ?? 'region.apostles';
    deps.law.commit({
      crime: rules.crime,
      region,
      witnesses,
      ...(w.owner ? { company: w.owner } : {}),
    });
    if (s.claim === 'victim' && rules.ownVictimHeat > 0) {
      deps.law.addHeat(region, rules.ownVictimHeat);
      log(state, t, `Seen over the wreck of the ${w.name}, that you put there.`);
    }
  };

  const papersLead = (s: SalvageSite): void => {
    const papers = s.oldWreck?.papers;
    if (!papers) return;
    const from = `the wreck of the ${s.name}`;
    const lead = papers.lead;
    if (lead?.startsWith('legend.')) {
      const area = discoveriesFile().legends.find((l) => l.id === lead);
      if (!area) return;
      deps.discovery.lead(
        {
          id: lead,
          kind: 'legend',
          title: rumorDefs().legends.find((l) => l.id === lead)?.name ?? lead,
          where: area.where,
          center: area.at,
          radiusM: area.radiusM,
          clue: { text: papers.text, from },
        },
        s.at,
      );
      return;
    }
    const other = lead ? old.find((w) => w.id === lead) : undefined;
    if (!other || deps.discovery.knows(other.id)) return;
    // A circle round where she went down, its middle off her by the seed (the papers say
    // where she was, not where she lies).
    const rng = Rng.fromSeed(`${deps.seed}|papers|${other.id}`);
    const radiusM = 2500;
    const ang = rng.range(0, Math.PI * 2);
    const off = rng.range(0, radiusM * 0.6);
    const c = worldChart(other.at);
    const center = {
      x: c.x + Math.cos(ang) * off,
      y: c.y + Math.sin(ang) * off,
    };
    const geo = worldGeo(center);
    deps.discovery.lead({
      id: other.id,
      kind: 'wreck',
      title: `The ${other.name}`,
      where: other.where,
      center: geo,
      radiusM,
      clue: { text: papers.text, from },
    });
  };

  const finish = (id: string, forced?: number): CastOutcome | string => {
    const s = sites().find((x) => x.id === id);
    const ship = deps.ship();
    if (!s || !ship) return 'No wreck under you.';
    const depthM = depthOf(s);
    const hsM = deps.hsAt(ship.x, ship.z);
    const p = progressOf(salvage(), s.id, now());
    const daylight = deps.daylight();
    const chance =
      forced ??
      castChance(rules, {
        depthM,
        hsM,
        daylight,
        ageYears: s.target.ageDays / CALENDAR_YEAR_DAYS,
      });
    const rng = Rng.fromSeed(`${deps.seed}|grapple|${s.id}|${p.casts}`);
    const free = holdFree(state.player.cargo, deps.economy.capacity);
    const minutes = rules.attemptMinutes;
    deps.passTime(minutes * 60);
    const t = now();
    const result = castGrapple(rules, s.target, p, chance, rng, free, t);
    let text: string;
    let hot = false;
    const box = result.hooked ? deps.strongbox?.(s.id) : undefined;
    if (box) {
      text = `${box} (${minutes} min)`;
      ctx.events.emit('WreckWorked', { wreck: s.id, kind: 'curio', qty: 0, spoiled: 0, hot });
      deps.notice(text);
      return { site: s.id, result, minutes, chance, hot, text };
    }
    if (!result.hooked) {
      text = `The grapple came up empty from the ${s.name} (${minutes} min).`;
      ctx.events.emit('WreckWorked', { wreck: s.id, kind: 'nothing', qty: 0, spoiled: 0, hot });
    } else if (result.kind === 'cargo') {
      const name = goodName(result.good);
      const h = hotFor(s, result.good);
      hot = !!h;
      if (result.sound > 0) {
        addToHold(state.player.cargo, {
          good: result.good,
          qty: result.sound,
          ...(h ? { hot: h } : {}),
        });
        deps.economy.syncLoad();
        lawAt(s);
      }
      const marks = h ? (s.wreck?.owner ? ", her owners' marks on it" : ', hot') : '';
      text =
        result.sound > 0 && result.spoiled > 0
          ? `Up from the ${s.name}: ${result.sound} CU of ${name}${marks}, and ${result.spoiled} spoiled, over the side (${minutes} min).`
          : result.sound > 0
            ? `Up from the ${s.name}: ${result.sound} CU of ${name}${marks} (${minutes} min).`
            : `Up from the ${s.name}: ${result.spoiled} CU of ${name}, spoiled past saving. Over the side (${minutes} min).`;
      log(state, t, text.replace(/ \(\d+ min\)\.$/, '.'));
      ctx.events.emit('WreckWorked', {
        wreck: s.id,
        kind: 'cargo',
        good: result.good,
        qty: result.sound,
        spoiled: result.spoiled,
        hot,
      });
    } else if (result.kind === 'papers') {
      const papers = s.oldWreck?.papers;
      text = `The grapple brought up ${papers?.name ?? 'her papers'} from the ${s.name}: a lead for the journal.`;
      log(state, t, `Grappled ${papers?.name ?? 'her papers'} from the wreck of the ${s.name}.`);
      papersLead(s);
      ctx.events.emit('WreckWorked', { wreck: s.id, kind: 'papers', qty: 0, spoiled: 0, hot });
    } else {
      deps.discovery.giveCurio(result.curio, `the wreck of the ${s.name}`);
      text = `Something odd in the grapple's flukes, from the ${s.name}: a curio for the sea chest.`;
      log(state, t, `Grappled a curio from the wreck of the ${s.name}.`);
      ctx.events.emit('WreckWorked', { wreck: s.id, kind: 'curio', qty: 0, spoiled: 0, hot });
    }
    if (pickedClean(s.target, p)) {
      text += ' Nothing more in her worth the grapple.';
      log(state, t, `Picked the wreck of the ${s.name} clean.`);
    }
    deps.notice(text);
    return { site: s.id, result, minutes, chance, hot, text };
  };

  const api: GameSalvage = {
    get state() {
      return salvage();
    },
    old,
    sites,
    look() {
      const ship = deps.ship();
      if (!ship) return [];
      const out: string[] = [];
      const hsM = deps.hsAt(ship.x, ship.z);
      const daylight = deps.daylight();
      const visibilityM = deps.visibilityM();
      for (const s of sites()) {
        if (deps.discovery.knows(s.id)) continue;
        const distM = Math.hypot(s.x - ship.x, s.z - ship.z);
        const depthM = s.deep ? Number.POSITIVE_INFINITY : depthOf(s);
        if (seenOnBottom(rules, { distM, depthM, hsM, daylight, visibilityM })) {
          if (deps.discovery.chart(s.id, 'sight')) out.push(s.id);
        } else if (depthSpike(rules, distM) > 0) {
          if (deps.discovery.chart(s.id, 'sounding')) out.push(s.id);
        }
      }
      return out;
    },
    spikeAt(x, z) {
      let m = 0;
      for (const s of sites()) m = Math.max(m, depthSpike(rules, Math.hypot(s.x - x, s.z - z)));
      return m;
    },
    offer,
    chip() {
      if (working) {
        const s = sites().find((x) => x.id === working?.id);
        return `Dragging the grapple over the ${s?.name ?? 'wreck'}…`;
      }
      const o = offer();
      if (!o) return undefined;
      return o.refusal
        ? `The wreck of the ${o.site.name}, ${Math.round(o.depthM)} m down`
        : `F cast the grapple · the ${o.site.name}, ${Math.round(o.depthM)} m down`;
    },
    start() {
      if (working) return true;
      const o = offer();
      if (!o) return false;
      if (o.refusal) {
        deps.notice(o.refusal);
        return true;
      }
      working = { id: o.site.id, leftS: rules.workRealS };
      ctx.events.emit('GrappleCast', { wreck: o.site.id });
      deps.notice(`The grapple's down on the ${o.site.name}…`);
      return true;
    },
    working: () => working?.id,
    update(realS) {
      if (!working) return undefined;
      if (!deps.anchored() || !deps.ship()) {
        working = undefined;
        deps.notice('The grapple came in: she has to lie at anchor to work a wreck.');
        return undefined;
      }
      working.leftS -= realS;
      if (working.leftS > 0) return undefined;
      const w = working;
      working = undefined;
      const r = finish(w.id, w.chance);
      return typeof r === 'string' ? undefined : r;
    },
    castNow(chance) {
      const o = offer();
      if (!o) return 'Not anchored over a wreck you know.';
      if (o.refusal) return o.refusal;
      ctx.events.emit('GrappleCast', { wreck: o.site.id });
      return finish(o.site.id, chance);
    },
    marks() {
      return old
        .filter((w) => deps.discovery.knows(w.id))
        .map((w) => ({ at: w.at, label: `Wreck of the ${w.name}`, kind: 'wreck' as const }));
    },
    note(id) {
      const p = salvage().wrecks[id];
      if (!p || p.casts === 0) return undefined;
      const raised = p.raised.reduce((n, l) => n + l.qty, 0);
      const spoiled = p.spoiled.reduce((n, l) => n + l.qty, 0);
      const parts = [`Grappled ${p.casts} ${p.casts === 1 ? 'time' : 'times'}`];
      if (raised) parts.push(`${raised} CU raised`);
      if (spoiled) parts.push(`${spoiled} spoiled`);
      if (p.papersAt !== undefined) parts.push('her papers recovered');
      const w = old.find((x) => x.id === id) ?? state.wrecks?.list.find((x) => x.id === id);
      const clean =
        w &&
        pickedClean(
          {
            id,
            cargo: w.cargo,
            papers: 'papers' in w && !!w.papers,
            curio: 'curio' in w ? w.curio : undefined,
            ageDays: 0,
          },
          p,
        );
      return `${parts.join(', ')}.${clean ? ' Picked clean.' : ''}`;
    },
    left(id) {
      const w = old.find((x) => x.id === id) ?? state.wrecks?.list.find((x) => x.id === id);
      return w ? cargoLeft(w.cargo, salvage().wrecks[id]) : [];
    },
  };
  return api;
}
