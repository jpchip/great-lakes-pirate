import type { WreckingMark } from '../../data/schemas/wrecking';
import { chartToZone, type Chart, type ZoneFrame } from '../core/coords';
import { SECONDS_PER_GAME_DAY } from '../core/time';
import type { GameContext } from '../modes/context';
import { chartVisibilityAt, chartWindAt } from '../sim/chart/chart-weather';
import {
  WORLD_PROJECTION,
  lerpChart,
  distance,
  toWorldChart,
  type ChartGeography,
} from '../sim/chart/geography';
import { isLostAt, lanePlace } from '../sim/chart/routes';
import type { Contact } from '../sim/chart/traffic';
import type { EconomyDefs } from '../sim/economy/defs';
import { regionAtGeo } from '../sim/law/regions';
import type { Witness } from '../sim/law/witness';
import { STATION_RULES, keepersOnDuty, lightDef } from '../sim/light-stations';
import { log } from '../sim/run/record';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import { currentManifest, type Manifest, type TrafficDefs } from '../sim/traffic/cargo';
import { cloudAt } from '../sim/weather/weather';
import { moonAt, sunAt } from '../sim/weather/celestial';
import { freshWrecks, recordWreck } from '../sim/wrecks';
import {
  MARKS,
  RIG_REFUSALS,
  WRECK_RULES,
  freshWrecking,
  markById,
  markInReach,
  moonCussingNight,
  rigsLit,
  setRig,
  stepWrecking,
  strandedNow,
  type MarkConditions,
  type PassingShip,
  type Stranding,
  type WreckingOutcome,
  type WreckingState,
  type WreckingWorld,
} from '../sim/wrecking';
import { APOSTLES_ID, defFrame, zoneDef } from '../sim/terrain/zones';
import type { StoryInput } from '../sim/news/papers';
import type { GameLaw } from './law';

/**
 * Wrecking in the running game (plan 06 §6.2, plan 11 §18.4 piece I). The sim
 * (`sim/wrecking.ts`) judges the ships passing the marks on the world tick; this applies
 * what comes of it:
 *
 * - **A stranded ship** goes off her timetable (`lostHow: 'stranded'`) until her owners'
 *   tug pulls her off and she's repaired; meanwhile she lies on the mark's shoal in the
 *   zone, struck, to be boarded from the deep side like any struck ship.
 * - **A broken one** is a wreck site (`how: 'wrecked'`), her cargo still in her.
 * - **The law** hears only what was seen: the false light (`crime.false_light`) from the
 *   keeper or her survivors, and the drowned as a killing on top. Unseen, the papers print a
 *   ship ashore in the night and nothing more.
 * - **An investigation** after several near one light: heat in its region (`addHeat`) and
 *   the *Morrill* ordered there (`investigated`, read by the law's ships).
 * - The Moon-Cusser Ambition counts it (`FeatAccomplished` `moonCussing`), and the
 *   logbook keeps it.
 */

export interface WreckingDeps {
  ctx: GameContext;
  law: GameLaw;
  seed: string;
  geo: ChartGeography;
  traffic: { contacts: readonly Contact[]; defs: TrafficDefs; syncLost(): void };
  economy: EconomyDefs;
  papers?: { story(input: StoryInput): void } | undefined;
  /** Your ship in a zone: where, and whether her lamps are lit. Undefined ashore or off it. */
  playerAt?(): { zoneId: string; x: number; z: number; lit: boolean } | undefined;
}

export interface GameWrecking {
  readonly state: WreckingState;
  /** Judges the ships passing since the last step (the world tick). */
  step(): WreckingOutcome[];
  /** Where each mark's rig stands in a zone's frame. */
  rigSpots(frame: ZoneFrame): Map<string, { x: number; z: number }>;
  /** Where a ship stranded at a mark lies, bow on to the rig, in a zone's frame. */
  shoalPose(markId: string, frame: ZoneFrame): { x: number; z: number; heading: number };
  /** The mark in reach of your ship, with why a rig can't be set there (or undefined: it can). */
  offer(
    at: { x: number; z: number },
    frame: ZoneFrame,
  ): { mark: WreckingMark; refusal: string | undefined } | undefined;
  /** F at a mark: sets a rig from the lockers. The notice to show. */
  setRig(at: { x: number; z: number }, frame: ZoneFrame): string;
  /** Rigs burning now, for the lights in the zone. */
  lit(): { mark: string; until: number }[];
  stranded(): Stranding[];
  /** A stranded ship's hold and crew as she went aground, for boarding her. */
  manifestOf(s: Stranding): Manifest | undefined;
  /** The moon-cussing night's ship and mark, if tonight's one (the events' trigger). */
  wreckingNight():
    { ship: string; name: string; at: number; mark: string; region: string } | undefined;
  /**
   * The dev hook: puts a passing ship of the traffic on a mark's shoal now, as if fooled
   * (`witnessed`: her survivors saw the light). Her name, or why not.
   */
  devStrand(markId: string, witnessed?: boolean): string;
  /** The conditions at a mark now (the dev hook). */
  conditions(markId: string): MarkConditions | undefined;
  dispose(): void;
}

const DEG = Math.PI / 180;

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function attachWrecking(deps: WreckingDeps): GameWrecking {
  const { ctx, geo } = deps;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const state = (): WreckingState => (ctx.state.wrecking ??= freshWrecking(now()));
  const recordOf = (classId: string) => SHIP_RECORDS.find((r) => r.id === classId);
  const shoalChart = new Map(MARKS.map((m) => [m.id, geo.projection.geoToChart(m.shoal)]));
  const regionName = (r: string): string => deps.law.defs.regionById.get(r)?.name ?? r;

  const conditions = (mark: WreckingMark, t: number): MarkConditions => {
    const p = shoalChart.get(mark.id) as Chart;
    const w = ctx.state.environment.weather;
    const moon = moonAt(t);
    const cloud = cloudAt(w, toWorldChart(geo, p), t);
    const moon01 = moon.illumination01 * smooth(0, 8 * DEG, moon.elevationRad) * (1 - 0.7 * cloud);
    return {
      sunDeg: sunAt(t).elevationRad / DEG,
      moon01,
      visM: chartVisibilityAt(w, geo, p, t),
      windKn: chartWindAt(w, geo, p, t).speedKn,
    };
  };

  /** Her place on her lane at `t`, without moving the live contacts. */
  const shipsAt = (t: number): PassingShip[] => {
    const out: PassingShip[] = [];
    for (const c of deps.traffic.contacts) {
      const s = c.schedule;
      if (!s || c.patrol || !c.classId || !recordOf(c.classId)?.combat?.target) continue;
      if (isLostAt(c, t)) continue;
      const place = lanePlace(s, t);
      if (!place.underWay || place.hidden) continue;
      const a = s.points[place.leg] as Chart;
      const b = s.points[place.leg + 1] as Chart;
      const len = distance(a, b);
      const pos = lerpChart(a, b, len > 0 ? Math.min(place.progressM / len, 1) : 0);
      out.push({ id: c.id, name: c.name, classId: c.classId, pos, underWay: true });
    }
    return out;
  };

  const manifestAt = (shipId: string, t: number) => {
    const c = deps.traffic.contacts.find((x) => x.id === shipId);
    return c ? currentManifest(deps.traffic.defs, deps.economy, c, t) : undefined;
  };

  const lightState = (light: string) => ctx.state.lightStations?.[light];

  const world: WreckingWorld = {
    seed: deps.seed,
    ships: shipsAt,
    toChart: (p) => geo.projection.geoToChart(p),
    conditions,
    dousedSince(light, t) {
      const st = lightState(light);
      const at = st?.dousedAt;
      if (at === undefined || at > t) return undefined;
      const def = lightDef(light);
      // A keeper at his post sees his lamp out and lights it again.
      if (def && t >= at + STATION_RULES.relightMin * 60 && keepersOnDuty(def, st, t) > 0) {
        return undefined;
      }
      return at;
    },
    keeperWatching(light, t) {
      const def = lightDef(light);
      return !!def && keepersOnDuty(def, lightState(light), t) > 0;
    },
    regionOfLight(light) {
      const def = lightDef(light);
      return def ? regionAtGeo(deps.law.defs, def.at) : 'region.apostles';
    },
    crewOf: (classId) => recordOf(classId)?.combat?.crew ?? 6,
    cargoOf: (shipId, t) => (manifestAt(shipId, t)?.cargo ?? []).map((l) => ({ ...l })),
    playerNear(mark, t) {
      if (t !== now()) return undefined;
      const p = deps.playerAt?.();
      if (!p || p.zoneId !== APOSTLES_ID) return undefined;
      const spot = spotsFor(apostlesFrame()).get(mark.id);
      if (!spot || Math.hypot(spot.x - p.x, spot.z - p.z) > WRECK_RULES.nearM) return undefined;
      return p.lit ? 'seen' : 'near';
    },
  };

  let frameCache: ZoneFrame | undefined;
  const apostlesFrame = (): ZoneFrame => (frameCache ??= defFrame(zoneDef(APOSTLES_ID)));

  const toZone = (p: { lat: number; lon: number }, frame: ZoneFrame) =>
    chartToZone(WORLD_PROJECTION.geoToChart(p), frame);

  const spotsFor = (frame: ZoneFrame): Map<string, { x: number; z: number }> =>
    new Map(MARKS.map((m) => [m.id, toZone(m.rig, frame)]));

  const shoalPose = (markId: string, frame: ZoneFrame) => {
    const m = markById(markId);
    if (!m) return { x: 0, z: 0, heading: 0 };
    const s = toZone(m.shoal, frame);
    const r = toZone(m.rig, frame);
    return { x: s.x, z: s.z, heading: Math.atan2(r.x - s.x, -(r.z - s.z)) };
  };

  // --- What comes of a night's work -------------------------------------------------------

  const lostFor = (s: Stranding, how: 'stranded' | 'wrecked', untilS: number): void => {
    const t = (ctx.state.traffic ??= { deliveredTo: now(), ships: {} });
    const r = (t.ships[s.shipId] ??= {});
    r.lostAt = s.at;
    r.lostUntil = untilS;
    r.lostHow = how;
  };

  const witnessesFor = (
    o: Extract<WreckingOutcome, { type: 'stranded' | 'broken' }>,
    mark: WreckingMark,
  ): Witness[] => {
    const light = lightDef(mark.light);
    return o.witnesses.map((w) =>
      w.kind === 'keeper'
        ? {
            id: `${mark.light}.wreck`,
            kind: 'keeper' as const,
            name: `the ${light?.name.replace(/ Light$/, '') ?? 'island'} keeper`,
            identification: w.ident,
            ...(light ? { reporting: light.reporting } : {}),
          }
        : {
            id: `${o.stranding.shipId}.survivors`,
            kind: 'crew' as const,
            name: `the ${o.stranding.name}'s survivors`,
            identification: w.ident,
          },
    );
  };

  const apply = (o: WreckingOutcome): void => {
    if (o.type === 'rigOut') return;
    if (o.type === 'investigation') {
      deps.law.addHeat(o.region, WRECK_RULES.investigation.heat);
      deps.papers?.story({
        kind: 'investigation',
        key: `investigation:${o.light}:${o.until}`,
        at: now(),
        region: o.region,
        ident: 'unknown',
      });
      log(
        ctx.state,
        now(),
        `Word of an inquiry into the wrecks in ${regionName(o.region)}: the Morrill's been sent.`,
      );
      return;
    }
    const s = o.stranding;
    const mark = markById(s.mark);
    if (!mark) return;
    const owner = manifestAt(s.shipId, s.at)?.owner;
    if (owner && !s.owner) s.owner = owner;
    const broken = o.type === 'broken';
    const repair = WRECK_RULES.repairDays * SECONDS_PER_GAME_DAY;
    if (broken) {
      lostFor(s, 'wrecked', s.at + WRECK_RULES.brokenDays * SECONDS_PER_GAME_DAY);
      const z = toZone(mark.shoal, apostlesFrame());
      const record = recordOf(s.classId);
      ctx.state.wrecks ??= freshWrecks();
      recordWreck(ctx.state.wrecks, {
        shipId: s.shipId,
        name: s.name,
        classId: s.classId,
        className: record?.name ?? 'ship',
        ...(s.owner ? { owner: s.owner } : {}),
        ...(s.owner ? { ownerName: deps.traffic.defs.factions.get(s.owner)?.name } : {}),
        how: 'wrecked',
        byPlayer: true,
        at: mark.shoal,
        zone: { id: APOSTLES_ID, x: z.x, z: z.z },
        region: o.region,
        regionName: regionName(o.region),
        now: s.at,
        drowned: s.drowned,
        cargo: s.cargo,
      });
    } else {
      lostFor(s, 'stranded', s.until + repair);
    }
    deps.traffic.syncLost();

    // The law hears what was seen.
    const witnesses = witnessesFor(o, mark);
    const details = {
      victim: s.name,
      victimClass: s.classId,
      ...(s.owner ? { owner: s.owner } : {}),
      ...(s.drowned > 0 ? { killed: s.drowned } : {}),
    };
    if (witnesses.length > 0) {
      deps.law.commit({
        crime: 'crime.false_light',
        region: o.region,
        witnesses,
        ...(s.owner ? { company: s.owner } : {}),
        details,
      });
      if (s.drowned > 0) {
        deps.law.commit({
          crime: 'crime.killing',
          region: o.region,
          witnesses,
          ...(s.owner ? { company: s.owner } : {}),
          details,
        });
      }
    } else {
      // Nobody saw a light: a ship ashore in the night, the lake's doing for all anyone knows.
      const cls = recordOf(s.classId)?.name.toLowerCase();
      deps.papers?.story({
        kind: 'wreck',
        key: `wreck:${s.id}`,
        at: s.at,
        region: o.region,
        ident: 'unknown',
        victim: cls ? `the ${cls} ${s.name}` : s.name,
        ...(s.drowned > 0 ? { killed: s.drowned } : {}),
      });
    }
    ctx.events.emit('FeatAccomplished', { kind: 'moonCussing', region: o.region });
    const dead =
      s.drowned > 0 ? ` ${s.drowned} ${s.drowned === 1 ? 'hand' : 'hands'} drowned.` : '';
    log(
      ctx.state,
      s.at,
      broken
        ? `The ${s.name} steered for the light at ${mark.name} and broke up on the shoal.${dead}`
        : `The ${s.name} steered for the light at ${mark.name} and went hard aground.${dead}`,
    );
  };

  // A stranded ship boarded and let go stays where she lies; one scuttled is gone.
  const offAftermath = ctx.events.on('AftermathChosen', (e) => {
    const st = ctx.state.wrecking;
    const s = st?.strandings.find((x) => x.shipId === e.shipId && now() < x.until);
    if (!st || !s) return;
    if (e.choice === 'adrift' || e.choice === 'sinkWithCrew') {
      st.strandings = st.strandings.filter((x) => x !== s);
      return;
    }
    s.boarded = true;
    lostFor(s, 'stranded', s.until + WRECK_RULES.repairDays * SECONDS_PER_GAME_DAY);
    deps.traffic.syncLost();
  });

  const step = (): WreckingOutcome[] => {
    const out = stepWrecking(state(), world, now());
    for (const o of out) apply(o);
    return out;
  };
  const offTick = ctx.events.on('WorldTick', () => {
    step();
  });

  const lockers = (): Record<string, number> => ctx.state.player.stores;

  const offer: GameWrecking['offer'] = (at, frame) => {
    const mark = markInReach(at, spotsFor(frame));
    if (!mark) return undefined;
    const t = now();
    let refusal: string | undefined;
    if ((lockers()['store.false_light'] ?? 0) <= 0) refusal = RIG_REFUSALS.noRig;
    else if (sunAt(t).elevationRad / DEG > WRECK_RULES.nightSunDeg) {
      refusal = RIG_REFUSALS.daylight;
    } else if (rigsLit(state(), t).some((r) => r.mark === mark.id)) {
      refusal = RIG_REFUSALS.alreadySet;
    }
    return { mark, refusal };
  };

  return {
    get state() {
      return state();
    },
    step,
    rigSpots: spotsFor,
    shoalPose,
    offer,
    setRig(at, frame) {
      const o = offer(at, frame);
      if (!o) return RIG_REFUSALS.notAtMark;
      if (o.refusal) return o.refusal;
      const r = setRig(state(), o.mark, now(), (t) => sunAt(t).elevationRad / DEG);
      if (!r.ok) return RIG_REFUSALS[r.reason];
      const stores = lockers();
      stores['store.false_light'] = Math.max(0, (stores['store.false_light'] ?? 0) - 1);
      log(ctx.state, now(), `Hung a false light at ${o.mark.name}.`);
      const hours = Math.max(1, Math.round((r.until - now()) / 3600));
      return `The false light burns at ${o.mark.name}: about ${hours} hours of kerosene, or till dawn.`;
    },
    lit: () => rigsLit(state(), now()).map((r) => ({ mark: r.mark, until: r.until })),
    stranded: () => strandedNow(state(), now()),
    manifestOf(s) {
      const m = manifestAt(s.shipId, s.at);
      if (!m) return undefined;
      let valueCents = 0;
      for (const l of s.cargo) {
        valueCents += (deps.economy.goods.get(l.good)?.basePriceCents ?? 0) * l.qty;
      }
      return {
        ...m,
        cargo: s.cargo.map((l) => ({ ...l })),
        valueCents,
        crew: Math.max(0, s.crew - s.drowned),
      };
    },
    wreckingNight() {
      const w = moonCussingNight(world, now(), moonAt(now()).illumination01);
      if (!w) return undefined;
      return {
        ship: w.shipId,
        name: w.name,
        at: w.at,
        mark: w.mark.name,
        region: world.regionOfLight(w.mark.light),
      };
    },
    devStrand(markId, witnessed = false) {
      const mark = markById(markId);
      if (!mark) return `No mark ${markId}`;
      const t = now();
      const prefer = ['ship.package_steamer', 'ship.schooner_barge', 'ship.fish_tug'];
      const c = [...deps.traffic.contacts]
        .filter((x) => x.classId && prefer.includes(x.classId) && !isLostAt(x, t))
        .sort((a, b) => prefer.indexOf(a.classId ?? '') - prefer.indexOf(b.classId ?? ''))[0];
      if (!c?.classId) return 'No ship to strand';
      const st = state();
      const crew = recordOf(c.classId)?.combat?.crew ?? 6;
      const stranding: Stranding = {
        id: `stranding-${st.nextId++}`,
        shipId: c.id,
        name: c.name,
        classId: c.classId,
        mark: mark.id,
        at: t,
        until: t + WRECK_RULES.strandedDays * SECONDS_PER_GAME_DAY,
        by: 'rig',
        crew,
        drowned: 0,
        cargo: (manifestAt(c.id, t)?.cargo ?? [])
          .map((l) => ({ good: l.good, qty: Math.round(l.qty) }))
          .filter((l) => l.qty > 0),
      };
      st.strandings.push(stranding);
      st.count++;
      apply({
        type: 'stranded',
        stranding,
        region: world.regionOfLight(mark.light),
        witnesses: witnessed ? [{ kind: 'crew', ident: 'unknown' }] : [],
        windKn: 0,
      });
      return c.name;
    },
    conditions(markId) {
      const m = markById(markId);
      return m ? conditions(m, now()) : undefined;
    },
    dispose() {
      offTick();
      offAftermath();
    },
  };
}
