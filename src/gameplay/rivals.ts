import type { RivalMethod } from '../../data/schemas/rivals';
import type { ChartProjection, Geo } from '../core/coords';
import type { GameContext } from '../modes/context';
import {
  createTraffic,
  lanePlace,
  laneLonLats,
  monthAt,
  westernSuperiorRoutes,
} from '../sim/chart/routes';
import type { Contact } from '../sim/chart/traffic';
import { recordLost, recordRobbed, robbedLately } from '../sim/boarding/record';
import type { ActiveEvent } from '../sim/events/events';
import { siteGeo, SITES } from '../sim/hideouts/stash';
import { crimeDef, type LawDefs } from '../sim/law/defs';
import { gainFame } from '../sim/law/law';
import { regionAtGeo } from '../sim/law/regions';
import type { Identification, Witness } from '../sim/law/witness';
import { portInfo } from '../sim/economy/defs';
import {
  acceptParley,
  activeRivals,
  agreeToMeet,
  betray,
  betrayalDue,
  blameRival,
  campOf,
  canEmerge,
  createRivalsState,
  defeatRival,
  emergeRival,
  endRival,
  leaveCheck,
  methodDef,
  noteRaid,
  noteYourCrime,
  offerParley,
  parleyDue,
  parleyLapsed,
  personalityOf,
  pinnedOnYou,
  raidDue,
  raidLater,
  raidMethod,
  retiring,
  rivalName,
  RIVALS,
  sellToLaw,
  stashLead,
  topMethod,
  trackFame,
  yourTopRegion,
  type HuntingLane,
  type Rival,
  type RivalsState,
} from '../sim/rivals/rivals';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import { fameTier } from '../sim/law/defs';
import type { GameEvents as SandboxEvents } from './events';
import type { GameLaw } from './law';
import { emitLaw } from './law';
import type { GameTraffic } from './traffic';

/**
 * Copycat rivals in the running game (plan 12 §7, plan 07 §8.1; Phase 9 piece E). On the
 * world tick, once an hour:
 *
 * - Your Fame's clocks are kept and a rival appears when one is due (the papers and the
 *   saloons tell of it).
 * - Each rival is a traffic ship: one of three chart contacts (`ship.rival_1..3`) sailing
 *   the timetable of the lane they hunt, off the water while the slot is empty. Meet her
 *   and she's a target like any other, armed, with a crew that won't go to the law.
 * - Their raids rob the ships of their lane (her hold short what they took, sunk if they
 *   sink her) or rob ashore and at the lights, through the law's crime pipeline with the
 *   crew as the witness. A raid that looks like your work is put to "a schooner".
 * - Your crimes are put down to a rival in the region by `law.blame`.
 * - They leave by the law, a gale or retirement; a parley comes by letter and is met in a
 *   saloon; beaten, they give Fame and a lead to their stash.
 *
 * Never near a hideout: the camps keep clear of every site, and no rival sets foot in one.
 */

export const RIVAL_SLOTS = [1, 2, 3] as const;
export const rivalContactId = (slot: number): string => `ship.rival_${slot}`;
/** Off the water: the slot's ship is nowhere until a rival takes her. */
const NEVER = 1e15;

/** The three rival ships' contacts, off the water: add them to the traffic's list. */
export function createRivalContacts(): Contact[] {
  return RIVAL_SLOTS.map((slot) => ({
    id: rivalContactId(slot),
    kind: 'rival',
    name: 'A black schooner',
    classId: 'ship.rival_schooner',
    pos: { x: 0, y: 0 },
    heading: 0,
    speedKn: 0,
    conspicuity: 0.8,
    hostile: false,
    threat: true,
    prize: true,
    inPort: true,
    lostAt: 0,
    lostUntil: NEVER,
    lost: true,
  }));
}

/** The prize lanes (trade and fishing), with the Wanted regions each runs through. */
export function huntingLanes(law: LawDefs): HuntingLane[] {
  const graph = westernSuperiorRoutes();
  return graph.lanes
    .filter((l) => l.use === 'trade' || l.use === 'fishing')
    .map((lane) => {
      const pts = laneLonLats(graph, lane);
      const regions: string[] = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [a, b] = [pts[i], pts[i + 1]] as [[number, number], [number, number]];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          const r = regionAtGeo(law, { lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t });
          if (!regions.includes(r)) regions.push(r);
        }
      }
      const m = pts[Math.floor(pts.length / 2)] as [number, number];
      const n = pts[Math.max(0, Math.floor(pts.length / 2) - 1)] as [number, number];
      const mid: Geo = { lon: (m[0] + n[0]) / 2, lat: (m[1] + n[1]) / 2 };
      return { id: lane.id, regions, mid };
    });
}

export interface RivalView {
  id: string;
  name: string;
  nick: string;
  personality: string;
  ship: string;
  region: string;
  camp: string;
  method: string;
  status: string;
  raids: number;
  parley: string | undefined;
}

export interface GameRivals {
  readonly state: RivalsState;
  /** A rival's ship (by contact id), for sea-law and the cards. */
  isRival(contactId: string): boolean;
  rivalOfContact(contactId: string): Rival | undefined;
  /** The papers' name for a rival. */
  who(id: string): string | undefined;
  list(): RivalView[];
  /** Runs the hour's checks now (the dev hook). */
  check(): void;
  /** A rival now, whatever your Fame (the dev hook). */
  emerge(): Rival | undefined;
  /** Their raid now (the dev hook). */
  raid(id: string, method?: RivalMethod): string | undefined;
  /** Their letter now (the dev hook). */
  parley(id: string): boolean;
  /** Beaten (the dev hook, as the encounter would). */
  defeat(id: string, how?: 'taken' | 'sunk'): boolean;
  leave(id: string, how: 'caught' | 'lost' | 'retired'): boolean;
  /** Puts their ship back on her timetable, or off the water (after a load). */
  sync(): void;
  dispose(): void;
}

export interface RivalsOptions {
  ctx: GameContext;
  law: GameLaw;
  events: SandboxEvents;
  traffic: GameTraffic;
  projection: ChartProjection;
  /** The run's traffic seed. */
  seed: string;
  /** The storm signal flies at a port. */
  gale(port: string): boolean;
  /** Opens a lead (piece O). */
  lead?(input: {
    id: string;
    kind: 'stash';
    title: string;
    where: string;
    center: Geo;
    radiusM: number;
    clue: { text: string; from: string };
  }): void;
  notice?(text: string): void;
}

export function attachRivals(opts: RivalsOptions): GameRivals {
  const { ctx, law, events, traffic } = opts;
  const defs = RIVALS;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const st = (): RivalsState => (ctx.state.rivals ??= createRivalsState(now()));
  const rand = (): number => ctx.rng.next();
  const saveRng = (): void => {
    ctx.state.environment.rng = ctx.rng.getState();
  };
  const lanes = huntingLanes(law.defs);
  const ships = () => (ctx.state.traffic ??= { deliveredTo: now(), ships: {} }).ships;
  const regionName = (r: string): string => law.defs.regionById.get(r)?.name ?? 'these waters';
  const fame = (): number => fameTier(law.defs, ctx.state.fame.value);
  const playerTier = (): number =>
    SHIP_RECORDS.find((r) => r.id === ctx.state.player.ship?.classId)?.tier ?? 1;
  const keepClear = SITES.flatMap((s) => {
    const g = siteGeo(s);
    return g ? [g] : [];
  });
  const byId = (id: string | undefined): Rival | undefined =>
    id ? st().list.find((r) => r.id === id) : undefined;

  // --- Words for the events, the letters and the papers.

  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const wordsOf = (r: Rival): Record<string, string> => {
    const camp = campOf(r, defs);
    const base: Record<string, string> = {
      rival: rivalName(r),
      nick: r.nick,
      rivalShip: `the ${r.shipName}`,
      camp: camp?.name ?? 'the islands',
      campWhere: camp?.where ?? 'among the islands',
      method: methodDef(topMethod(r), defs).label,
      parleyPort: portInfo(r.parley?.port ?? '')?.name ?? 'the saloon',
      region: regionName(r.region),
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(base)) {
      out[k] = v;
      out[cap(k)] = cap(v);
      out[k.toUpperCase()] = v.toUpperCase();
    }
    return out;
  };
  events.setWords((ev: ActiveEvent) => {
    const r = byId(ev.rival);
    return r ? wordsOf(r) : {};
  });

  const fire = (id: string, r: Rival, port?: string, quiet?: boolean): ActiveEvent | undefined => {
    const ev = events.fire(id, port, { rival: r.id, region: r.region, ...(quiet ? { quiet } : {}) });
    return typeof ev === 'string' ? undefined : ev;
  };

  // --- Their ships on the water.

  const sync = (): void => {
    const s = ships();
    for (const slot of RIVAL_SLOTS) {
      const id = rivalContactId(slot);
      const c = traffic.contacts.find((x) => x.id === id);
      if (!c) continue;
      const r = activeRivals(st()).find((x) => x.slot === slot);
      if (!r) {
        s[id] = { lostAt: 0, lostUntil: NEVER };
        continue;
      }
      const lane = westernSuperiorRoutes().lanes.find((l) => l.id === r.lane);
      if (!lane) continue;
      if (c.schedule?.laneId !== `lane.rival_${slot}` || c.name !== r.shipName) {
        const graph = westernSuperiorRoutes();
        const own = {
          ...lane,
          id: `lane.rival_${slot}`,
          fleet: [{ classId: r.classId, count: 1, names: [r.shipName] }],
        };
        const built = createTraffic(
          opts.projection,
          `${opts.seed}:${r.id}`,
          { nodes: graph.nodes, lanes: [own], pois: [] },
          false,
        )[0];
        if (built) {
          Object.assign(c, built, { id, kind: 'rival', threat: true, prize: true, hostile: false });
        }
      }
      // Back on her timetable (unless something sank her and she's lying low).
      const rec = s[id];
      if (rec && rec.lostUntil === NEVER) delete s[id];
    }
    traffic.syncLost();
  };

  // --- Raids.

  const VICTIM_LANE = (r: Rival): string => r.lane;

  const victimFor = (r: Rival): Contact | undefined => {
    const t = now();
    const candidates = traffic.contacts.filter((c) => {
      const s = c.schedule;
      if (!s || s.laneId !== VICTIM_LANE(r) || c.lost) return false;
      if (robbedLately(ships(), c.id, t, 1)) return false;
      const place = lanePlace(s, t);
      return place.underWay && !place.laidUp;
    });
    return candidates[Math.floor(rand() * candidates.length) % Math.max(1, candidates.length)];
  };

  const raid = (r: Rival, forced?: RivalMethod): string | undefined => {
    const method = forced ?? raidMethod(r, rand);
    const m = methodDef(method, defs);
    const t = now();
    let victim: Contact | undefined;
    let haul = { cents: 0, goods: [] as { good: string; qty: number }[] };
    if (m.victim) {
      victim = victimFor(r);
      if (!victim) {
        raidLater(r, t, rand);
        saveRng();
        return undefined;
      }
      const man = traffic.manifest(victim.id);
      const hold = SHIP_RECORDS.find((x) => x.id === r.classId)?.cargoCapacity ?? 20;
      let room = hold;
      const taken: { good: string; qty: number }[] = [];
      for (const l of man?.cargo ?? []) {
        const qty = Math.min(room, Math.floor(l.qty * m.takes));
        if (qty <= 0) continue;
        taken.push({ good: l.good, qty });
        room -= qty;
      }
      const cash = SHIP_RECORDS.find((x) => x.id === victim?.classId)?.combat?.cashCents ?? [0, 0];
      const cents = Math.round(cash[0] + (cash[1] - cash[0]) * rand() * m.takes);
      recordRobbed(
        ships(),
        victim.id,
        t,
        taken,
        cents,
        man ? { cycle: man.cycle, outbound: man.outbound } : undefined,
      );
      if (m.sinksDays) recordLost(ships(), victim.id, t, 'sunk', m.sinksDays);
      traffic.syncLost();
      haul = { cents, goods: taken };
    }
    const pinned = pinnedOnYou(st(), r, method, rand, defs);
    const ident: Identification = pinned ? 'schooner' : 'unknown';
    const witness: Witness = victim
      ? { id: `crew.${victim.id}`, kind: 'crew', name: `the crew of the ${victim.name}`, identification: ident }
      : { id: `${m.witness}.${r.id}`, kind: m.witness, name: `a ${m.witness}`, identification: ident };
    let heat = 0;
    for (const crime of m.rivalCrimes) {
      heat += crimeDef(law.defs, crime).heat;
      law.commit({
        crime,
        region: r.region,
        witnesses: [witness],
        by: r.id,
        ...(victim
          ? {
              details: {
                victim: victim.name,
                ...(victim.classId ? { victimClass: victim.classId } : {}),
                ...(haul.goods.length ? { goods: haul.goods } : {}),
                ...(haul.cents ? { cashCents: haul.cents } : {}),
              },
            }
          : {}),
      });
    }
    noteRaid(r, heat, haul, t, rand, defs);
    ctx.events.emit('RivalRaided', {
      id: r.id,
      method,
      crimes: [...m.rivalCrimes],
      ...(victim ? { victim: victim.id } : {}),
      pinned,
    });
    // A showman's raids make the papers under his own name.
    if (!pinned && rand() < personalityOf(r, defs).papers * 0.5) fire(defs.events.strikes, r);
    saveRng();
    return victim?.id ?? method;
  };

  // --- Beats.

  const emerge = (): Rival | undefined => {
    const r = emergeRival(
      st(),
      {
        now: now(),
        lanes,
        playerTier: playerTier(),
        keepClear,
        hereRegion: law.region(),
      },
      rand,
      defs,
    );
    saveRng();
    if (!r) return undefined;
    // A new hand in the slot: what the last one's ship went through is forgotten.
    Reflect.deleteProperty(ships(), rivalContactId(r.slot));
    sync();
    fire(defs.events.emerges, r);
    ctx.events.emit('RivalEmerged', {
      id: r.id,
      name: rivalName(r),
      region: r.region,
      personality: r.personality,
    });
    return r;
  };

  const leave = (r: Rival, how: 'caught' | 'lost' | 'retired'): void => {
    endRival(st(), r, how, now());
    sync();
    const ev = { caught: defs.events.caught, lost: defs.events.lost, retired: defs.events.retires };
    fire(ev[how], r);
    ctx.events.emit('RivalLeft', { id: r.id, how });
  };

  const defeat = (r: Rival, how: 'taken' | 'sunk'): void => {
    if (r.status !== 'active') return;
    defeatRival(st(), r, how, now());
    sync();
    const f = gainFame(law.defs, ctx.state, defs.rules.defeatFame, now());
    if (f) emitLaw(ctx, f);
    fire(defs.events.defeated, r);
    const lead = stashLead(r, defs);
    if (lead && opts.lead) {
      opts.lead({
        ...lead,
        kind: 'stash',
        clue: {
          text: `${r.first} ${r.last}'s crew talked: he keeps his stash ${lead.where}.`,
          from: `The crew of the ${r.shipName}`,
        },
      });
    }
    ctx.events.emit('RivalDefeated', { id: r.id, how });
    opts.notice?.(`You've beaten ${rivalName(r)}. His crew says he keeps a stash ${lead?.where ?? ''}.`);
  };

  const offer = (r: Rival): void => {
    offerParley(r, now(), defs);
    fire(defs.events.parley, r);
    const p = r.parley;
    if (p?.kind && p.port) ctx.events.emit('ParleyOffered', { id: r.id, kind: p.kind, port: p.port });
  };

  const stage = (r: Rival): void => {
    if (r.parley) ctx.events.emit('ParleyChanged', { id: r.id, stage: r.parley.stage });
  };

  let lastHour = Math.floor(now() / 3600);
  const check = (hours = 1): void => {
    const t = now();
    const s = st();
    trackFame(s, fame(), t, defs);
    for (const r of activeRivals(s)) {
      if (raidDue(r, t)) {
        const lane = westernSuperiorRoutes().lanes.find((l) => l.id === r.lane);
        const season = lane?.season[monthAt(t)] ?? 1;
        if (season < defs.rules.minSeason) raidLater(r, t, rand);
        else raid(r);
      }
      const how = leaveCheck(
        r,
        { now: t, hours, gale: opts.gale(defs.rules.parley.ports[r.region] ?? 'port.bayfield') },
        rand,
        defs,
      );
      if (how) {
        leave(r, how);
        continue;
      }
      if (parleyDue(r, t, hours, rand, defs)) offer(r);
      // A meeting nobody came to (the scene's event is over).
      const p = r.parley;
      if (p?.stage === 'meeting' && t - p.at > 4 * 24 * 3600) {
        parleyLapsed(r, 'stood_up', t);
        stage(r);
      }
      if (betrayalDue(r, t)) {
        betray(r, t);
        const region = yourTopRegion(s) ?? law.region();
        if (region) law.addHeat(region, defs.rules.parley.betrayHeat);
        fire(defs.events.betrays, r);
        sync();
        stage(r);
      }
    }
    const old = retiring(s, t, defs);
    if (old) leave(old, 'retired');
    if (canEmerge(s, fame(), t, defs)) emerge();
    saveRng();
  };

  const offs = [
    ctx.events.on('WorldTick', ({ gameSeconds }) => {
      const hour = Math.floor(gameSeconds / 3600);
      if (hour === lastHour) return;
      const hours = Math.min(24 * 30, Math.max(1, hour - lastHour));
      lastHour = hour;
      check(hours);
    }),
    ctx.events.on('CrimeCommitted', (e) => {
      if (e.by) return;
      noteYourCrime(st(), e.crime, e.region, now(), defs);
    }),
    ctx.events.on('EventResolved', (e) => {
      const ev = events.state.active.find((a) => a.key === e.key);
      const r = byId(ev?.rival);
      if (!r) return;
      if (e.id === defs.events.parley) {
        if (e.choice === defs.events.meetChoice) {
          agreeToMeet(r, now());
          const kind = r.parley?.kind ?? 'truce';
          fire(defs.events.meet[kind], r, r.parley?.port, true);
        } else parleyLapsed(r, 'declined', now());
        stage(r);
      } else if (e.id === defs.events.meet.truce || e.id === defs.events.meet.split) {
        if (e.choice === defs.events.acceptChoice) {
          acceptParley(r, lanes, yourTopRegion(st()) ?? law.region(), now(), rand, defs, activeRivals(st()));
          sync();
        } else if (e.choice === defs.events.sellChoice) sellToLaw(r, now(), defs);
        else parleyLapsed(r, 'refused', now());
        saveRng();
        stage(r);
      }
    }),
    // Beaten at sea: struck or boarded, or sent to the bottom.
    ctx.events.on('ShipSurrendered', (e) => {
      const r = rivalOf(e.shipId);
      if (r) defeat(r, 'taken');
    }),
    ctx.events.on('BoardingSucceeded', (e) => {
      const r = rivalOf(e.shipId);
      if (r) defeat(r, 'taken');
    }),
    ctx.events.on('ShipSunk', (e) => {
      const r = rivalOf(e.shipId);
      if (r) defeat(r, 'sunk');
    }),
    ctx.events.on('ShipScuttled', (e) => {
      const r = rivalOf(e.shipId);
      if (r) defeat(r, 'sunk');
    }),
  ];

  const rivalOf = (contactId: string): Rival | undefined =>
    activeRivals(st()).find((r) => rivalContactId(r.slot) === contactId);

  // Your crimes put down to a rival by their method.
  law.blame = (input) => {
    const r = blameRival(st(), input.crime, input.region, rand, defs);
    saveRng();
    return r?.id;
  };

  sync();

  return {
    get state() {
      return st();
    },
    isRival: (id) => !!rivalOf(id),
    rivalOfContact: rivalOf,
    who(id) {
      const r = byId(id);
      return r ? `the pirate ${rivalName(r)}` : undefined;
    },
    list: () =>
      st().list.map((r) => ({
        id: r.id,
        name: rivalName(r),
        nick: r.nick,
        personality: personalityOf(r, defs).name,
        ship: r.shipName,
        region: regionName(r.region),
        camp: campOf(r, defs)?.name ?? '',
        method: methodDef(topMethod(r), defs).label,
        status: r.status,
        raids: r.raids,
        parley: r.parley?.stage,
      })),
    check: () => check(1),
    emerge,
    raid(id, method) {
      const r = byId(id);
      return r && r.status === 'active' ? raid(r, method) : undefined;
    },
    parley(id) {
      const r = byId(id);
      if (!r || r.status !== 'active' || r.parley) return false;
      offer(r);
      return true;
    },
    defeat(id, how = 'taken') {
      const r = byId(id);
      if (!r || r.status !== 'active') return false;
      defeat(r, how);
      return true;
    },
    leave(id, how) {
      const r = byId(id);
      if (!r || r.status !== 'active') return false;
      leave(r, how);
      return true;
    },
    sync,
    dispose() {
      offs.forEach((off) => off());
      law.blame = undefined;
      events.setWords(undefined);
    },
  };
}
