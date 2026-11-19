import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import type { LighthouseDef } from '../../../data/schemas/lighthouses';
import type { LightStationRules } from '../../../data/schemas/light_stations';
import {
  STATION_RULES,
  houseCash,
  houseStocked,
  lampOut,
  living,
  logbookHere,
  oilLeft,
  onDuty,
  stationKeepers,
  welcomeAt,
  type PlacedPoint,
  type PlacedStation,
} from '../../sim/light-stations';
import type { LightStationState } from '../../sim/world-state';
import type { Witness } from '../../sim/law/witness';
import { footToolsHud, type FootToolsSnapshot } from '../../ui/hud/foot-tools-model';
import type { AshoreScene } from './ashore-scene';
import { CONDUCT_WORDS, isNight, type Conduct, type ConductReason } from './conduct';
import { DEFAULT_CONTROLLER, type CharacterState, type ControllerParams } from './controller';
import { createFootLaw, nextDawn, type FootLawHooks } from './foot-law';
import { compileNpcs, gameNpcs, type GuardSpawn, type NpcDefs, type Route } from './guards';
import type { Crate } from './heist';
import { LampSet } from './light';
import { NavGrid, type XZ } from './nav';
import { createStealth, isDown, type Guard } from './stealth';
import { createTools, gameTools, type Pockets, type ToolContext } from './tools';
import { skyAt, type Watch, type WatchConditions } from './watch';

/**
 * A lighthouse station on foot (plan 11 §10, §18.4 piece H; plan 06 §6.2): the keepers who
 * live there walking the station by day and keeping the lamp by night, and what you can
 * do there. It answers the district watch's `Watch`, so the tool belt, the HUD's prompt,
 * the stealth readout and the voices work here as they do in Bayfield.
 *
 * - **Keepers** are guards on the watch's machinery: they see and hear as the watch does,
 *   don't chase, and report as their station's reporting speed says. By day every keeper
 *   at his post walks the station; by night the one on watch keeps the lantern room and
 *   the rest are asleep in the house.
 * - **The tower:** F at its door climbs the stair (a skeleton tower's ladder) to the
 *   gallery, and F there, looking away from the lamp, comes down again.
 * - **The lamp:** at night, looking at it from the gallery, hold F to put it out (crime
 *   `crime.light_doused`); out, hold F to light it. A keeper at his post lights it again
 *   after a while (`settleStation`).
 * - **The oil house:** kerosene, a can at a time in your arms to the boat, hot.
 * - **The house:** the keepers' savings, the logbook (read, or taken), and at night the
 *   keepers asleep there, tied up where they lie with a rope apiece.
 * - **Day visits:** at low Wanted a keeper welcomes you by day: F, face to face, talks of
 *   the weather and the ships, and lets you look at the log.
 * - **What becomes of a keeper** (coshed, tied, drunk, bribed or killed) is the save's,
 *   so the light at sea goes unwatched, and dark when doused, until he's back.
 */

export interface StationHooks {
  /** A can of kerosene into the hold, hot; the refusal if it won't go. */
  stow(crate: Crate): string | undefined;
  /** A shipping line from the log: the next sailings the keepers have noted. */
  schedule(): string | undefined;
  /** The keepers' weather: what the glass and the sky say for tomorrow. */
  weather(): string;
  notice(text: string): void;
  /** Cash found (the logbook line and the stats). */
  found?(cents: number): void;
  /** Something at the station changed (a lamp out or lit): the light at sea redraws. */
  changed?(): void;
}

export interface StationWatchOptions {
  station: PlacedStation;
  scene: AshoreScene;
  /** The save's record for this light (made if absent). */
  record(): LightStationState;
  conditions(): WatchConditions;
  tier: number;
  seed: string;
  runSeed(): number;
  pockets: Pockets;
  hasWeapon?(id: string): boolean;
  law?: FootLawHooks & { region(): string };
  hooks: StationHooks;
  rules?: LightStationRules;
  /** Overrides conduct when it returns a value (the dev hook `__glpFoot.suspect`). */
  suspect?(): boolean | undefined;
}

/** What F does at the station now. */
export interface StationOffer {
  label: string;
  ok: boolean;
  why?: string;
  holdS: number;
  act(): void;
}

export interface StationOnFoot {
  readonly station: PlacedStation;
  /** The can of kerosene in your arms. */
  readonly carrying: Crate | undefined;
  offer(player: CharacterState): StationOffer | undefined;
  /** At the rowboat with a can: put it in the hold. */
  boatPrompt(): { text: string; act(): void } | undefined;
  /** Up on the gallery. */
  aloft(player: CharacterState): boolean;
}

/** What a keeper reads in his glass for tomorrow (plan 11 §10: weather knowledge). */
export function keeperWeather(
  trend: 'rising fast' | 'rising' | 'steady' | 'falling' | 'falling fast' | undefined,
): string {
  switch (trend) {
    case 'falling fast':
      return 'The glass is falling fast: a blow before morning.';
    case 'falling':
      return 'The glass is falling: weather coming.';
    case 'rising fast':
      return 'The glass is rising fast: wind behind the clearing.';
    case 'rising':
      return 'The glass is rising: fair tomorrow.';
    case 'steady':
      return 'The glass is steady.';
    default:
      return '';
  }
}

/** You can reach a door or a keeper from this far. */
const REACH_M = 1.9;
/** The lantern room is up here: anything over this above the ground by the tower. */
const ALOFT_M = 4;
/** A can of kerosene is a load: slower, no running. */
const CAN_SPEED = 0.75;

function spotNoticeForReporting(reporting: LighthouseDef['reporting']): string {
  switch (reporting) {
    case 'fast':
      return 'He can signal the town within the hour.';
    case 'medium':
      return 'Word will reach town in a few hours.';
    case 'slow':
      return 'He will row to town at dawn.';
  }
}
/** The nav grid round a station: this far either side of the tower. */
const NAV_HALF_M = 70;
const KEROSENE = 'good.kerosene';

function headingTo(a: XZ, b: XZ): number {
  return Math.atan2(b.x - a.x, -(b.z - a.z));
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** The keeper type with this station's loyalty: how far a man here can be bought. */
function stationNpcs(loyalty: number): NpcDefs {
  const base = gameNpcs();
  return compileNpcs({
    ...base.file,
    types: base.file.types.map((t) => (t.id === 'npc.keeper' ? { ...t, bribeChance: loyalty } : t)),
  });
}

/** The walkable point nearest `p` within a few meters (a door's step can be a wall's cell). */
export function snapWalkable(nav: NavGrid, p: XZ, reachM = 4): XZ | undefined {
  if (nav.walkable(p)) return p;
  for (let r = 0.5; r <= reachM; r += 0.5) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const q = { x: p.x + Math.sin(a) * r, z: p.z - Math.cos(a) * r };
      if (nav.walkable(q)) return q;
    }
  }
  return undefined;
}

/** A keeper's round of the station by day: the house, the oil house, the tower, the landing. */
export function dayRound(st: PlacedStation, nav: NavGrid): Route | undefined {
  const pts: XZ[] = [st.doors.house, st.doors.oil, st.doors.tower];
  if (st.landing && !st.bluff) {
    const fx = Math.sin(st.light.seaward);
    const fz = -Math.cos(st.light.seaward);
    // The landing's inner end, where it meets the beach.
    pts.push({
      x: st.landing.x - fx * (st.landing.d / 2 - 1.5),
      z: st.landing.z - fz * (st.landing.d / 2 - 1.5),
    });
  }
  const points = pts
    .map((p) => snapWalkable(nav, p))
    .filter((p): p is XZ => p !== undefined)
    .map((p) => ({ x: p.x, z: p.z, waitS: 6 }));
  return points.length >= 2 ? { points, loop: true } : undefined;
}

/** The keeper on watch walks round the lantern, looking out at each quarter. */
export function watchRound(st: PlacedStation): Route {
  const l = st.gallery.lamp;
  const s = st.gallery.stand;
  const r = Math.hypot(s.x - l.x, s.z - l.z);
  const a0 = headingTo(l, s);
  const points = [0, 1, 2, 3].map((k) => {
    const a = a0 + (k * Math.PI) / 2;
    return { x: l.x + Math.sin(a) * r, z: l.z - Math.cos(a) * r, waitS: 18, face: a };
  });
  return { points, loop: true };
}

export function createStationWatch(opts: StationWatchOptions): Watch & {
  readonly station: StationOnFoot;
} {
  const { station: st, scene } = opts;
  const rules = opts.rules ?? STATION_RULES;
  const light = st.light.def;
  const short = light.name.replace(/ Light$/, '');
  const record = opts.record;
  const now = (): number => opts.conditions().gameSeconds;
  const t0 = now();
  const nightAtLanding = isNight(skyAt(t0, opts.conditions().cloud01));

  const nav = new NavGrid(scene, {
    minX: st.light.x - NAV_HALF_M,
    minZ: st.light.z - NAV_HALF_M,
    maxX: st.light.x + NAV_HALF_M,
    maxZ: st.light.z + NAV_HALF_M,
    cellM: 1,
    // The gallery is a floor too, for the keeper on watch (not joined to the ground).
    maxRiseM: light.tower.heightM + 2,
  });

  // Who's where: living keepers at their posts. By night one keeps the lamp, the rest sleep.
  const keepers = stationKeepers(light).filter((k) => living(record(), k.id, t0, rules));
  const fit = keepers.filter((k) => {
    const f = record().keepers[k.id];
    return !(f?.downUntil !== undefined && t0 < f.downUntil);
  });
  const spawns: GuardSpawn[] = [];
  const sleepers: string[] = [];
  const round = dayRound(st, nav);
  if (nightAtLanding) {
    const [onWatch, ...rest] = fit;
    if (onWatch) {
      spawns.push({
        id: onWatch.id,
        type: 'npc.keeper',
        name: `the keeper, ${onWatch.name}`,
        route: watchRound(st),
      });
    }
    sleepers.push(...rest.map((k) => k.id));
  } else if (round) {
    fit.forEach((k, i) =>
      spawns.push({
        id: k.id,
        type: 'npc.keeper',
        name: `the keeper, ${k.name}`,
        route: round,
        startAt: i % round.points.length,
      }),
    );
  }
  const defs = stationNpcs(opts.station.def.loyalty);
  const stealth = createStealth(
    {
      zone: scene,
      nav,
      lamps: new LampSet([]),
      rng: Rng.fromSeed(`${opts.seed}:station:${light.id}`),
    },
    defs,
    spawns,
    opts.tier,
  );
  for (const g of stealth.guards) {
    const p = g.body.position;
    p.y = nightAtLanding ? st.gallery.stand.y : Math.max(scene.ground.heightAt(p.x, p.z), p.y);
    g.previous.y = p.y;
    const f = record().keepers[g.id];
    if (f?.bribedUntil !== undefined && t0 < f.bribedUntil) stealth.bribe(g.id, f.bribedUntil);
  }

  let carrying: Crate | undefined;
  const tools = createTools(
    stealth,
    opts.pockets,
    scene,
    Rng.fromSeed(`${opts.seed}:tools:${light.id}`),
    gameTools(),
    {
      ...(opts.hasWeapon ? { hasWeapon: opts.hasWeapon } : {}),
      handsFull: () => carrying !== undefined,
    },
  );

  let lastConduct: Conduct | undefined;
  const footLaw = opts.law
    ? createFootLaw(
        stealth,
        tools,
        opts.law,
        {
          get region() {
            return opts.law?.region() ?? '';
          },
          reporting: light.reporting,
        },
        () => lastConduct?.reason,
      )
    : undefined;

  // --- The station's own crimes: found by the keepers, reported as the station reports.
  const incidents = new Map<string, string>();
  const keepersFind = (t: number): Witness => ({
    id: `evidence.${light.id}`,
    kind: 'keeper',
    name: `the ${short} keepers`,
    identification: 'unknown',
    reporting: light.reporting,
    reportAt: nextDawn(t),
  });
  const seenNow = (): Witness[] =>
    stealth.witnessAct().map((g) => ({
      id: g.id,
      kind: 'keeper' as const,
      name: g.name,
      identification: g.identified ? ('person' as const) : ('unknown' as const),
      reporting: light.reporting,
    }));
  const crime = (
    key: string,
    id: string,
    details?: { goods?: { good: string; qty: number }[]; cashCents?: number; victim?: string },
  ): void => {
    const law = opts.law;
    const region = law?.region();
    if (!law || !region) return;
    const witnesses = [keepersFind(now()), ...seenNow()];
    const open = incidents.get(key);
    if (open) {
      for (const w of witnesses.slice(1)) law.addWitness(open, w);
      return;
    }
    const evs = law.commit({
      crime: id,
      region,
      witnesses,
      details: { victim: light.name, ...details },
    });
    const c = evs.find((e) => e.type === 'CrimeCommitted');
    if (c?.type === 'CrimeCommitted') incidents.set(key, c.crimeId);
  };

  // --- Where you are.
  const nearPt = (p: CharacterState, q: PlacedPoint, reach = REACH_M): boolean =>
    Math.hypot(p.position.x - q.x, p.position.z - q.z) <= reach &&
    Math.abs(p.position.y - q.y) < 1.2;
  const aloft = (p: CharacterState): boolean =>
    p.position.y > st.light.groundM + ALOFT_M &&
    Math.hypot(p.position.x - st.gallery.lamp.x, p.position.z - st.gallery.lamp.z) < 4;
  const onGrounds = (p: CharacterState): boolean =>
    Math.hypot(p.position.x - st.light.x, p.position.z - st.light.z) <= rules.groundsM;
  const night = (): boolean => isNight(skyAt(now(), opts.conditions().cloud01));
  const welcome = (): boolean => !night() && welcomeAt(opts.conditions().wantedTier, rules);

  const conductNow = (p: CharacterState): Conduct => {
    let reason: ConductReason | undefined;
    if (tools.carrying) reason = 'body';
    else if (carrying) reason = 'loot';
    else if (tools.armed()) reason = 'armed';
    else if (aloft(p)) reason = 'trespass';
    else if (onGrounds(p) && !welcome()) reason = 'trespass';
    return reason
      ? { suspect: true, reason, words: CONDUCT_WORDS[reason], area: undefined }
      : { suspect: false, reason: undefined, words: '', area: undefined };
  };

  /** Keepers' fates into the save, as they happen: the light at sea reads them. */
  const syncFates = (t: number): void => {
    const rec = record();
    for (const g of stealth.guards) {
      const f = (rec.keepers[g.id] ??= {});
      if (g.state === 'dead') f.diedAt ??= t;
      else if (isDown(g.state)) f.downUntil = Math.max(g.untilGame, t + 60);
      else if (g.state === 'drunk') f.downUntil = Math.max(g.untilGame, g.sleepUntil, nextDawn(t));
      else if (g.state === 'bribed') f.bribedUntil = g.untilGame;
      if (Object.keys(f).length === 0) Reflect.deleteProperty(rec.keepers, g.id);
    }
  };

  const toolContext = (player: CharacterState): ToolContext => {
    const c = opts.conditions();
    return {
      player,
      gameSeconds: c.gameSeconds,
      wantedTier: c.wantedTier,
      fame01: c.fame01,
      light01: stealth.readout().light.level01,
    };
  };

  const teleport = (p: CharacterState, to: PlacedPoint, heading: number): void => {
    p.position.x = to.x;
    p.position.y = to.y + 0.05;
    p.position.z = to.z;
    p.velocity.x = 0;
    p.velocity.y = 0;
    p.velocity.z = 0;
    p.heading = heading;
  };

  const sleepersTied = (): boolean => sleepers.every((id) => !onDuty(record(), id, now(), rules));
  const readLog = (): void => {
    const line = opts.hooks.schedule();
    opts.hooks.notice(
      line
        ? `The ${short} log: ${line}. ${opts.hooks.weather()}`
        : `The ${short} log: nothing passing worth noting. ${opts.hooks.weather()}`,
    );
  };
  let readThisLanding = false;

  /** The keeper face to face with you, standing, by day. */
  const keeperWatching = (): boolean => stealth.guards.some((g) => g.state === 'alerted');

  const blockedByWatcher = (label: string): StationOffer => ({
    label,
    ok: false,
    why: 'The keeper is watching',
    holdS: 0,
    act() {},
  });

  const keeperToTalk = (p: CharacterState): Guard | undefined => {
    if (!welcome()) return undefined;
    for (const g of stealth.guards) {
      if (g.state !== 'patrol' && g.state !== 'return') continue;
      const gp = g.body.position;
      if (Math.hypot(gp.x - p.position.x, gp.z - p.position.z) > 2.2) continue;
      return g;
    }
    return undefined;
  };

  const offer = (p: CharacterState): StationOffer | undefined => {
    if (carrying || tools.carrying || !p.grounded || p.swimming) return undefined;
    const t = now();
    const rec = record();
    if (aloft(p)) {
      const lamp = st.gallery.lamp;
      const facing =
        Math.abs(wrap(p.heading - headingTo(p.position, lamp))) < Math.PI / 3 &&
        Math.hypot(p.position.x - lamp.x, p.position.z - lamp.z) <= st.gallery.reachM;
      if (facing) {
        if (keeperWatching()) {
          return blockedByWatcher(lampOut(rec) ? 'Light the lamp' : 'Put out the lamp');
        }
        if (lampOut(rec)) {
          return {
            label: 'Light the lamp',
            ok: true,
            holdS: rules.lightS,
            act: () => {
              delete rec.dousedAt;
              opts.hooks.notice(`${short} burns again`);
            },
          };
        }
        if (!night()) {
          return {
            label: 'Put out the lamp',
            ok: false,
            why: 'It burns from dusk',
            holdS: 0,
            act() {},
          };
        }
        return {
          label: 'Put out the lamp',
          ok: true,
          holdS: rules.douseS,
          act: () => {
            rec.dousedAt = now();
            stealth.noiseAt('douse', lamp);
            crime(`douse:${light.id}`, 'crime.light_doused');
            opts.hooks.notice(`${short} is dark`);
          },
        };
      }
      return {
        label: st.ladder ? 'Climb down the ladder' : 'Go down the stair',
        ok: true,
        holdS: rules.climbS,
        act: () => teleport(p, st.doors.tower, headingTo(st.gallery.lamp, st.doors.tower)),
      };
    }
    const talk = keeperToTalk(p);
    const today = dayAndHour(t).day;
    const talked = rec.talkedAt !== undefined && dayAndHour(rec.talkedAt).day === today;
    // Once he's told you the news, F falls through to the doors behind him.
    if (talk && !talked) {
      return {
        label: `Talk with ${talk.name.replace(/^the keeper, /, '')}`,
        ok: true,
        holdS: 0,
        act: () => {
          rec.talkedAt = now();
          const c = opts.conditions();
          stealth.faceToFace(talk.id, stealth.readout().light.level01, c.fame01);
          readLog();
        },
      };
    }
    const bluff = st.bluff;
    if (bluff && nearPt(p, bluff.foot, 2.4)) {
      return {
        label: 'Climb the stair up the bluff',
        ok: true,
        holdS: rules.climbS,
        act: () => teleport(p, bluff.head, headingTo(bluff.head, st.light)),
      };
    }
    if (bluff && nearPt(p, bluff.head, 2.4)) {
      return {
        label: 'Go down to the landing',
        ok: true,
        holdS: rules.climbS,
        act: () => teleport(p, bluff.foot, headingTo(st.light, bluff.foot)),
      };
    }
    if (nearPt(p, st.doors.tower)) {
      return {
        label: st.ladder
          ? 'Climb the ladder to the lantern'
          : 'Climb the stair to the lantern room',
        ok: true,
        holdS: rules.climbS,
        act: () =>
          teleport(p, st.gallery.stand, headingTo(st.gallery.stand, st.gallery.lamp) + Math.PI),
      };
    }
    if (nearPt(p, st.doors.oil)) {
      const left = oilLeft(st.def, rec, t, rules);
      const oilLabel = `Take a can of kerosene (${left} left)`;
      if (keeperWatching()) return blockedByWatcher(oilLabel);
      return {
        label: oilLabel,
        ok: left > 0,
        ...(left > 0 ? {} : { why: 'The oil house is empty' }),
        holdS: rules.oilS,
        act: () => {
          const tt = now();
          const o = rec.oilTaken;
          rec.oilTaken =
            o && tt - o.since < rules.restockDays * 86400
              ? { count: o.count + 1, since: o.since }
              : { count: 1, since: tt };
          carrying = { good: KEROSENE, owner: undefined, building: light.id, since: tt };
          stealth.noiseAt('crate', st.doors.oil);
          crime(`oil:${light.id}`, 'crime.petty_theft', {
            goods: [{ good: KEROSENE, qty: rec.oilTaken.count }],
          });
        },
      };
    }
    if (nearPt(p, st.doors.house)) {
      if (keeperWatching()) {
        if (night() && sleepers.length && !sleepersTied()) {
          return blockedByWatcher(
            `Tie up the sleeping keeper${sleepers.length > 1 ? 's' : ''}`,
          );
        }
        if (!readThisLanding && logbookHere(rec, t, rules)) {
          return blockedByWatcher('Read the logbook');
        }
        if (houseStocked(rec, t, rules)) {
          return blockedByWatcher("Search the keepers' house");
        }
        if (logbookHere(rec, t, rules)) {
          return blockedByWatcher('Take the logbook');
        }
        return blockedByWatcher("Search the keepers' house");
      }
      // At night the keepers off watch are asleep in there.
      if (night() && sleepers.length && !sleepersTied()) {
        const need = sleepers.filter((id) => onDuty(rec, id, t, rules)).length;
        const rope = opts.pockets.stores['store.rope'] ?? 0;
        return {
          label: `Tie up the sleeping keeper${need > 1 ? 's' : ''}`,
          ok: rope >= need,
          ...(rope >= need ? {} : { why: `${need} length${need > 1 ? 's' : ''} of rope` }),
          holdS: rules.houseS,
          act: () => {
            const tt = now();
            opts.pockets.stores['store.rope'] = rope - need;
            for (const id of sleepers) {
              const f = (rec.keepers[id] ??= {});
              f.downUntil = tt + 6 * 3600;
            }
            stealth.noiseAt('blow', st.doors.house);
            crime(`sleepers:${light.id}`, 'crime.assault', { victim: `the ${short} keepers` });
          },
        };
      }
      if (!readThisLanding && logbookHere(rec, t, rules)) {
        return {
          label: 'Read the logbook',
          ok: true,
          holdS: rules.readS,
          act: () => {
            readThisLanding = true;
            readLog();
          },
        };
      }
      if (houseStocked(rec, t, rules)) {
        return {
          label: "Search the keepers' house",
          ok: true,
          holdS: rules.houseS,
          act: () => {
            const tt = now();
            const cents = houseCash(st.def, opts.runSeed(), tt, rules);
            rec.houseRobbedAt = tt;
            opts.pockets.purse += cents;
            opts.hooks.found?.(cents);
            stealth.noiseAt('crate', st.doors.house);
            crime(`house:${light.id}`, 'crime.burglary', { cashCents: cents });
            opts.hooks.notice(`$${(cents / 100).toFixed(2)} in the keepers' tin box`);
          },
        };
      }
      if (logbookHere(rec, t, rules)) {
        return {
          label: 'Take the logbook',
          ok: true,
          holdS: rules.takeS,
          act: () => {
            rec.logbookTakenAt = now();
            crime(`log:${light.id}`, 'crime.petty_theft');
            opts.hooks.notice(`The ${short} logbook is yours`);
          },
        };
      }
      return {
        label: "Search the keepers' house",
        ok: false,
        why: 'Nothing left worth taking',
        holdS: 0,
        act() {},
      };
    }
    return undefined;
  };

  // --- F, held and pressed.
  let holdS = -1;
  let stationHoldS = -1;
  let heldLabel: string | undefined;

  const stationOnFoot: StationOnFoot = {
    station: st,
    get carrying() {
      return carrying;
    },
    offer,
    aloft,
    boatPrompt() {
      if (!carrying) return undefined;
      const crate = carrying;
      return {
        text: 'Put the kerosene in the boat',
        act: () => {
          const refused = opts.hooks.stow(crate);
          if (refused) opts.hooks.notice(refused);
          else carrying = undefined;
        },
      };
    },
  };

  let spotWarned = false;
  stealth.on((e) => {
    if (e.type !== 'PlayerSpotted' || spotWarned) return;
    spotWarned = true;
    opts.hooks.notice(`You've been seen. ${spotNoticeForReporting(light.reporting)}`);
  });

  /** A hostile tool beats the station; a word or a coin to a keeper waits for the talk. */
  const toolFirst = (player: CharacterState): boolean => {
    const o = tools.offer(toolContext(player));
    if (!o || tools.lowPriority(o)) return false;
    // A word that would come to nothing doesn't stand between you and the station's work.
    if (!o.ok && (o.verb === 'bribe' || o.verb === 'whiskey') && offer(player)) return false;
    if ((o.verb === 'bribe' || o.verb === 'whiskey') && offer(player)?.label.startsWith('Talk'))
      return false;
    return true;
  };

  return {
    stealth,
    tier: opts.tier,
    station: stationOnFoot,
    get pursued() {
      return false;
    },
    get searched() {
      return stealth.guards.some((g) => g.state === 'search');
    },
    step(dt, player, lean) {
      const c = opts.conditions();
      lastConduct = conductNow(player);
      const forced = opts.suspect?.();
      stealth.step(dt, {
        player,
        playerParams: DEFAULT_CONTROLLER,
        ...(scene.surfaceAt
          ? { surface: scene.surfaceAt(player.position.x, player.position.z) }
          : {}),
        sky: skyAt(c.gameSeconds, c.cloud01),
        fogM: c.fogM,
        rain01: c.rain01,
        gameSeconds: c.gameSeconds,
        carrying: carrying !== undefined || tools.carrying !== undefined,
        suspect: forced ?? lastConduct.suspect,
        fame01: c.fame01,
        wantedTier: c.wantedTier,
        ...(lean ? { lean } : {}),
      });
      tools.step(toolContext(player));
      syncFates(c.gameSeconds);
    },
    readout: () => stealth.readout(),
    on: (fn) => stealth.on(fn),
    tools,
    footLaw,
    get conduct() {
      return lastConduct;
    },
    arrestReason: () => lastConduct?.reason,
    offer: (player) => tools.offer(toolContext(player)),
    interact(dt, player, down, pressed, otherPrompt = false) {
      if (toolFirst(player)) {
        stationHoldS = -1;
        const o = tools.offer(toolContext(player));
        if (!o) return false;
        if (pressed) {
          if (o.holdS > 0) holdS = 0;
          else tools.use(toolContext(player));
          return true;
        }
        if (holdS >= 0) {
          if (!down || !o.ok || o.holdS <= 0) holdS = -1;
          else if ((holdS += dt) >= o.holdS) {
            tools.use(toolContext(player));
            holdS = -1;
          }
        }
        return true;
      }
      holdS = -1;
      const s = otherPrompt ? undefined : offer(player);
      if (!s) {
        stationHoldS = -1;
        // A throw, last of all.
        const o = tools.offer(toolContext(player));
        if (o && !otherPrompt && pressed && o.ok) tools.use(toolContext(player));
        return !!o && !otherPrompt;
      }
      if (pressed && s.ok) {
        if (s.holdS <= 0) {
          s.act();
          opts.hooks.changed?.();
        } else {
          stationHoldS = 0;
          heldLabel = s.label;
        }
        return true;
      }
      if (stationHoldS >= 0) {
        if (!down || !s.ok || s.label !== heldLabel) stationHoldS = -1;
        else if ((stationHoldS += dt) >= s.holdS) {
          stationHoldS = -1;
          s.act();
          opts.hooks.changed?.();
        }
      }
      return true;
    },
    heist: undefined,
    jailbreak: undefined,
    moored: [],
    alongside: () => false,
    crews: () => [],
    crowd: () => [],
    standCrew: () => 'Not now',
    params(base: ControllerParams): ControllerParams {
      return carrying
        ? { ...base, walkSpeed: base.walkSpeed * CAN_SPEED, runSpeed: base.walkSpeed * CAN_SPEED }
        : base;
    },
    onHeist: () => () => undefined,
    toolsHud(player, otherPrompt = false): FootToolsSnapshot | undefined {
      const o = tools.offer(toolContext(player));
      const first = toolFirst(player);
      const s = first || otherPrompt ? undefined : offer(player);
      const shown =
        first || !s ? (o && (!tools.lowPriority(o) || !otherPrompt) ? o : undefined) : undefined;
      const hold01 = shown && shown.holdS > 0 && holdS >= 0 ? holdS / shown.holdS : 0;
      return footToolsHud(
        tools,
        lastConduct ?? conductNow(player),
        shown,
        hold01,
        opts.pockets.purse,
        {
          prompt: s
            ? {
                key: 'F',
                label: s.label,
                ok: s.ok,
                why: s.why ?? '',
                hold01:
                  stationHoldS >= 0 && s.holdS > 0 && s.label === heldLabel
                    ? Math.min(1, stationHoldS / s.holdS)
                    : 0,
              }
            : undefined,
          load: carrying ? 'Carrying a can of kerosene' : '',
        },
      );
    },
    onTool: (fn) => tools.on(fn),
    lamps: [],
    douseOffer: () => undefined,
    douseLamp: () => undefined,
  };
}
