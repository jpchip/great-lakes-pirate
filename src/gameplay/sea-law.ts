import type { BoardingRules } from '../../data/schemas/boarding';
import type { GameContext } from '../modes/context';
import { previewAftermath, resolveAftermath } from '../sim/boarding/aftermath';
import { gameBoarding } from '../sim/boarding/check';
import { monthAt } from '../sim/chart/routes';
import { fameTier, topWantedTier } from '../sim/law/defs';
import { tierIn } from '../sim/law/law';
import {
  crewIdentification,
  crewReportAt,
  crewWitness,
  sightingIdentification,
  thirdParties,
  type SeaCrime,
} from '../sim/law/sea-crimes';
import type { CrimeDetails } from '../sim/law/state';
import type { Identification, Witness } from '../sim/law/witness';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import { formatCents } from '../sim/economy/knowledge';
import { log } from '../sim/run/record';
import { freshWrecks, recordWreck, type Wreck, type WreckHow } from '../sim/wrecks';
import { PLAYER_ID } from './combat';
import type { Detection } from './detection';
import type { Entity } from './ecs';
import type { GameLaw } from './law';
import type { LawAtSea } from './law-at-sea';

/**
 * The law and the world answer piracy (plan 07 §7, §14.4 row F; Phase 6 piece F). It
 * listens to piece A's gunfire and piece D's boarding and turns them into the law's crimes:
 *
 * - **Firing on a ship** (a warning shot across her bow counts), **killing** (any death
 *   aboard a ship you fired on, boarded or sank: one crime an encounter, the dead counted),
 *   **piracy** (her hold looted) and **sinking** (scuttled or shot under), each once a ship.
 *   Each is committed when it happens, with whoever has you in sight as witnesses (piece B's
 *   watchers; the looting screen's ships in sight), and her own crew as a witness held back
 *   until they're free to talk.
 * - **Her crew** reports when you let them go: at her next port (piece D's report time),
 *   later if disabled or set adrift, never if they went down with her. A ship that got away
 *   or that you left lying reports at her port too.
 * - **Gunfire** is heard: every watcher in earshot turns to look.
 * - **Firing on the law** (the Morrill or the tug): the region goes to Most Wanted at once,
 *   and the cutter shoots to sink (`LawAtSea.firedOn`).
 * - **Wrecks**: every ship that goes down is recorded where she lies (chart, ledger, mast).
 *
 * Company grudges and Standing come from the law core when the crime is named to you; the
 * papers print from the reports (`ReportFiled` carries the details).
 */

export interface SeaLawDeps {
  ctx: GameContext;
  law: GameLaw;
  detection: Detection;
  lawAtSea: LawAtSea;
  /** The NPC ships on the water now (arena or zone). */
  ships(): readonly Entity[];
  isLawShip(e: Entity): boolean;
  nameOf(id: string): string;
  /** Her owning company (her manifest's), if she has one. */
  ownerOf(id: string): string | undefined;
  ownerName?(company: string): string | undefined;
  /** What she still carries (for her wreck). */
  cargoOf?(id: string): readonly { good: string; qty: number }[];
  /** The zone, or undefined in an arena (an arena's wrecks have no mast to stand). */
  zoneId(): string | undefined;
  /** The chart's lat/lon of a point on the water now. */
  geoAt(x: number, z: number): { lat: number; lon: number } | undefined;
  dark01(): number;
  windKn(x: number, z: number): number;
  notice(text: string): void;
  /** A good's name, for the logbook. */
  goodName?(good: string): string;
  rules?: BoardingRules;
}

export interface SeaLaw {
  /** Encounters still open (their crews yet to report), for the dev hook and tests. */
  incidents(): {
    shipId: string;
    crimes: Record<string, string>;
    killed: number;
    boarded: boolean;
  }[];
  /** Lets every open encounter's crew go now (leaving the water, the dev hook). */
  closeAll(): void;
  /** Records a wreck (the abandon-ship flow records yours). */
  wreck(input: Omit<Parameters<typeof recordWreck>[1], 'now'>): Wreck;
  dispose(): void;
}

interface Incident {
  shipId: string;
  name: string;
  classId: string;
  owner: string | undefined;
  region: string;
  /** Crime → the open crime's id, its crew still to report. */
  crimes: Map<SeaCrime, string>;
  killed: number;
  boarded: boolean;
  lastAt: number;
  goods?: { good: string; qty: number }[];
  cashCents?: number;
}

/** A round falling within this of a ship was fired on her (across her bow), meters. */
const FIRED_ON_M = 150;
/** ...and within this of a law ship, on her. */
const FIRED_ON_LAW_M = 90;
/** Ships within this of the prize while you loot her are in sight (piece D's count). */
const IN_SIGHT_M = 2000;

const recordOf = (classId: string | undefined) => SHIP_RECORDS.find((r) => r.id === classId);

export function attachSeaLaw(deps: SeaLawDeps): SeaLaw {
  const { ctx, law, detection } = deps;
  const rules = deps.rules ?? gameBoarding();
  const sea = law.defs.actors.sea;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const incidents = new Map<string, Incident>();
  /** Ships scuttled: their sinking was committed at the scuttling. */
  const scuttled = new Set<string>();
  /** Law ships already fired on this water (the crime is once). */
  const firedOnLaw = new Set<string>();
  /** Hands drowned with each ship or from her boat, until her wreck is recorded. */
  const drownedOf = new Map<string, number>();

  const shipById = (id: string): Entity | undefined => deps.ships().find((e) => e.id === id);

  const conditionsAt = (x: number, z: number) => ({
    windKn: deps.windKn(x, z),
    month: monthAt(now()),
    dark01: deps.dark01(),
  });

  /** When a crew left afloat reports, her passage unknown (piece D's default passage). */
  const defaultReportAt = (): number | undefined => {
    const p = previewAftermath(rules, 'letGo', { windKn: 0, month: monthAt(now()), dark01: 0 });
    return crewReportAt(now(), p.reportInS);
  };

  const watcherIdent = (id: string): Identification | undefined => {
    const w = detection.watchers.find((x) => x.observer.id === id);
    if (!w || w.sight.by === 'none') return undefined;
    if (w.meter.identified) return 'ship';
    if (w.awareness === 'spotted') return w.meter.byLanternOnly ? 'unknown' : 'schooner';
    return undefined;
  };

  const crewIdentOf = (inc: Incident): Identification =>
    crewIdentification({
      boarded: inc.boarded,
      watcher: watcherIdent(inc.shipId),
      fameTier: fameTier(law.defs, ctx.state.fame.value),
      knowsFromTier: sea.crewKnowsFromFameTier,
    });

  const incidentFor = (shipId: string): Incident | undefined => {
    let inc = incidents.get(shipId);
    if (inc) return inc;
    const e = shipById(shipId);
    const region = law.region();
    if (!region || !law.defs.regionById.has(region)) return undefined;
    const classId = e?.npc?.classId ?? '';
    inc = {
      shipId,
      name: deps.nameOf(shipId),
      classId,
      owner: deps.ownerOf(shipId),
      region,
      crimes: new Map(),
      killed: 0,
      boarded: false,
      lastAt: now(),
    };
    incidents.set(shipId, inc);
    return inc;
  };

  const openCrime = (id: string) => ctx.state.reports.crimes.find((c) => c.id === id);

  const details = (inc: Incident): CrimeDetails => ({
    victim: inc.name,
    ...(inc.classId ? { victimClass: inc.classId } : {}),
    ...(inc.owner ? { owner: inc.owner } : {}),
    ...(inc.killed > 0 ? { killed: inc.killed } : {}),
    ...(inc.goods?.length ? { goods: inc.goods.map((g) => ({ ...g })) } : {}),
    ...(inc.cashCents ? { cashCents: inc.cashCents } : {}),
  });

  /** Commits a crime at sea once an encounter, her crew held back as the late witness. */
  const act = (shipId: string, crime: SeaCrime, extra: readonly Witness[] = []): void => {
    const inc = incidentFor(shipId);
    if (!inc) return;
    inc.lastAt = now();
    const open = inc.crimes.get(crime);
    if (open) {
      // The same crime again (more dead): the papers tell the latest count.
      const c = openCrime(open);
      if (c) c.details = details(inc);
      return;
    }
    const witnesses = thirdParties([...detection.witnesses(), ...extra], new Set([shipId]));
    const events = law.commit({
      crime,
      region: inc.region,
      witnesses,
      pending: crewWitness(shipId, inc.name, crewIdentOf(inc), deps.zoneId()),
      company: inc.owner,
      details: details(inc),
    });
    const committed = events.find((e) => e.type === 'CrimeCommitted');
    if (committed?.type === 'CrimeCommitted') inc.crimes.set(crime, committed.crimeId);
  };

  /** Her crew is free to talk at `at` (or never): every crime of the encounter's report goes. */
  const close = (inc: Incident, at: number | undefined): void => {
    incidents.delete(inc.shipId);
    for (const id of inc.crimes.values()) law.releasePending(id, at);
  };

  /** The crew now knows you better (they had you on their deck): their pending reports say so. */
  const boarded = (shipId: string): void => {
    const inc = incidents.get(shipId) ?? incidentFor(shipId);
    if (!inc) return;
    inc.boarded = true;
    const ident = crewIdentOf(inc);
    for (const id of inc.crimes.values()) {
      const c = openCrime(id);
      if (c?.pending) c.pending.identification = ident;
    }
  };

  /** A law ship fired on: Most Wanted in the region, and she shoots to sink. */
  const fireOnLaw = (e: Entity): void => {
    const id = e.id;
    if (!id || firedOnLaw.has(id)) return;
    if (!deps.lawAtSea.firedOn(id)) return;
    firedOnLaw.add(id);
    write('Fired on the law.');
    const region = law.region();
    if (!region || !law.defs.regionById.has(region)) return;
    const name =
      e.npc?.classId === 'ship.cutter_morrill' ? 'the revenue cutter Morrill' : 'the law';
    law.commit({
      crime: 'crime.attack_law',
      region,
      witnesses: [{ id, kind: 'cutter', name, identification: 'person' }],
    });
    const top = topWantedTier(law.defs);
    if (tierIn(law.defs, ctx.state, region) < top) law.setTier(region, top);
    deps.notice(
      `You've fired on ${name}! Every hand of the law is after you, and she'll sink you.`,
    );
  };

  /** The ship a round fell across, if any: the nearest within reach of the splash. */
  const firedOn = (at: { x: number; z: number }): Entity | undefined => {
    let best: Entity | undefined;
    let bestD = Infinity;
    for (const e of deps.ships()) {
      const t = e.transform;
      if (!t || !e.id || e.npc?.derelict) continue;
      const law = deps.isLawShip(e);
      if (!law && !recordOf(e.npc?.classId)?.combat?.target) continue;
      const d = Math.hypot(t.position.x - at.x, t.position.z - at.z);
      if (d <= (law ? FIRED_ON_LAW_M : FIRED_ON_M) && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  };

  const firedOnShip = (e: Entity): void => {
    if (!e.id) return;
    if (deps.isLawShip(e)) fireOnLaw(e);
    else act(e.id, 'crime.firing_on_ship');
  };

  /** The other ships in sight of her while you loot, as witnesses of what they could make out. */
  const inSight = (shipId: string): Witness[] => {
    const e = shipById(shipId);
    const p = e?.transform?.position;
    const player = ctx.world.with('playerControlled', 'transform').first?.transform.position;
    if (!p) return [];
    const out: Witness[] = [];
    for (const o of deps.ships()) {
      if (o === e || !o.id || !o.transform || o.npc?.derelict) continue;
      if (o.npc?.towedBy === shipId || e?.npc?.towedBy === o.id) continue;
      const d = Math.hypot(o.transform.position.x - p.x, o.transform.position.z - p.z);
      if (d > IN_SIGHT_M) continue;
      const toYou = player
        ? Math.hypot(o.transform.position.x - player.x, o.transform.position.z - player.z)
        : d;
      out.push({
        id: o.id,
        kind: deps.isLawShip(o) ? 'cutter' : 'crew',
        name: `the ${deps.nameOf(o.id)}`,
        identification: sightingIdentification(toYou, deps.dark01(), sea.identifyM),
        distanceM: Math.round(toYou),
      });
    }
    return out;
  };

  const wreck: SeaLaw['wreck'] = (input) => {
    ctx.state.wrecks ??= freshWrecks();
    return recordWreck(ctx.state.wrecks, { ...input, now: now() });
  };

  const wreckOf = (
    e: { shipId: string; classId: string; at: { x: number; z: number } },
    how: WreckHow,
    byPlayer: boolean,
    drowned: number,
  ): void => {
    const geo = deps.geoAt(e.at.x, e.at.z);
    if (!geo) return;
    const record = recordOf(e.classId);
    const owner = deps.ownerOf(e.shipId);
    const zoneId = deps.zoneId();
    const region = law.region();
    wreck({
      shipId: e.shipId,
      name: deps.nameOf(e.shipId),
      classId: e.classId,
      className: record?.name ?? 'ship',
      owner,
      ownerName: owner ? deps.ownerName?.(owner) : undefined,
      how,
      byPlayer,
      at: geo,
      zone: zoneId ? { id: zoneId, x: e.at.x, z: e.at.z } : undefined,
      region,
      regionName: region ? law.defs.regionById.get(region)?.name : undefined,
      drowned,
      cargo: deps.cargoOf?.(e.shipId) ?? [],
    });
  };

  /** The logbook is the combat log (plan 07 §14.5: the dead counted by number and ship). */
  const write = (text: string): void => log(ctx.state, now(), text);
  const CAUSE: Record<string, string> = {
    shot: 'by your fire',
    boiler: 'when her boiler burst',
    boarding: 'in the fight for her deck',
    adrift: 'when her boat swamped',
    sunk: 'battened below as she sank',
  };

  const ev = ctx.events;
  const offs = [
    // Gunfire carries: every watcher in earshot looks for you.
    ev.on('WeaponFired', (e) => {
      if (e.by === PLAYER_ID) detection.hear(e.at, sea.earshotM);
    }),
    ev.on('ShotLanded', (e) => {
      if (e.by !== PLAYER_ID) return;
      const hit = e.on === 'ship' && e.shipId ? shipById(e.shipId) : undefined;
      const target = hit ?? firedOn(e.at);
      if (target) firedOnShip(target);
    }),
    ev.on('CrewCasualties', (e) => {
      if (e.by !== PLAYER_ID || e.killed <= 0) return;
      const ship = shipById(e.shipId);
      if (ship && deps.isLawShip(ship)) {
        fireOnLaw(ship);
        return;
      }
      const name = deps.nameOf(e.shipId);
      write(
        `${e.killed} of the ${name}'s crew killed ${CAUSE[e.cause] ?? ''}${e.wounded > 0 ? `, ${e.wounded} wounded` : ''}.`,
      );
      const inc = incidentFor(e.shipId);
      if (!inc) return;
      inc.killed += e.killed;
      if (e.cause === 'sunk' || e.cause === 'adrift') {
        drownedOf.set(e.shipId, (drownedOf.get(e.shipId) ?? 0) + e.killed);
      }
      act(e.shipId, 'crime.killing');
    }),
    ev.on('ShipSurrendered', (e) => boarded(e.shipId)),
    ev.on('ShipLooted', (e) => {
      const inc = incidentFor(e.shipId);
      if (!inc) return;
      inc.goods = e.goods.map((g) => ({ ...g }));
      inc.cashCents = e.cashCents;
      const what = e.goods.map((g) => `${g.qty} CU of ${deps.goodName?.(g.good) ?? g.good}`);
      if (e.cashCents > 0) what.push(formatCents(e.cashCents));
      write(`Took the ${inc.name}: ${what.length > 0 ? what.join(', ') : 'nothing worth having'}.`);
      act(e.shipId, 'crime.piracy', inSight(e.shipId));
    }),
    ev.on('ShipScuttled', (e) => {
      scuttled.add(e.shipId);
      act(e.shipId, 'crime.sinking');
    }),
    ev.on('AftermathChosen', (e) => {
      const name = deps.nameOf(e.shipId);
      write(
        e.choice === 'letGo'
          ? `Let the ${name} go on her way.`
          : e.choice === 'disable'
            ? `Cut up the ${name}'s rigging and left her wallowing.`
            : e.choice === 'adrift'
              ? `Put the ${name}'s crew in their boat and scuttled her.`
              : `Sank the ${name} with her crew battened below.`,
      );
      const inc = incidents.get(e.shipId);
      if (!inc) return;
      close(inc, crewReportAt(now(), e.reportInS));
    }),
    ev.on('ShipFled', (e) => {
      const inc = incidents.get(e.shipId);
      if (inc) close(inc, defaultReportAt());
    }),
    ev.on('ShipSunk', (e) => {
      const wasScuttled = scuttled.delete(e.shipId);
      const byPlayer = e.by === PLAYER_ID;
      if (byPlayer && !wasScuttled) write(`Sent the ${deps.nameOf(e.shipId)} to the bottom.`);
      if (byPlayer && !wasScuttled) {
        // Shot under: her crew takes to the boat, with the weather's say over who lives.
        const ship = shipById(e.shipId);
        if (ship && deps.isLawShip(ship)) fireOnLaw(ship);
        else act(e.shipId, 'crime.sinking');
        const inc = incidents.get(e.shipId);
        if (inc) {
          const r = resolveAftermath(
            rules,
            'adrift',
            conditionsAt(e.at.x, e.at.z),
            e.crewAboard,
            ctx.rng,
          );
          if (r.killed > 0) {
            ev.emit('CrewCasualties', {
              shipId: e.shipId,
              by: PLAYER_ID,
              killed: r.killed,
              wounded: 0,
              cause: 'adrift',
              lethal: true,
            });
            deps.notice(`Her boat swamps: ${r.killed} of her crew drown.`);
          }
          close(inc, r.survivors > 0 ? crewReportAt(now(), r.reportInS) : undefined);
        }
      }
      const drowned = drownedOf.get(e.shipId) ?? 0;
      drownedOf.delete(e.shipId);
      wreckOf(e, wasScuttled ? 'scuttled' : byPlayer ? 'sunk' : 'foundered', byPlayer, drowned);
    }),
    // Leaving the water lets every crew go about its business: they report at their port.
    ev.on('ZoneExited', () => closeAll()),
    ev.on('ArenaEntered', () => closeAll()),
    ev.on('ArenaExited', () => closeAll()),
    ev.on('WorldTick', () => {
      const t = now();
      for (const inc of [...incidents.values()]) {
        if (t - inc.lastAt >= sea.quietH * 3600) close(inc, defaultReportAt());
      }
    }),
  ];

  const closeAll = (): void => {
    const at = defaultReportAt();
    for (const inc of [...incidents.values()]) close(inc, at);
    firedOnLaw.clear();
  };

  // A crew still held back from a session that ended (the tab closed mid-encounter) sets off.
  for (const c of [...ctx.state.reports.crimes]) {
    if (c.pending) law.releasePending(c.id, defaultReportAt());
  }

  return {
    incidents: () =>
      [...incidents.values()].map((i) => ({
        shipId: i.shipId,
        crimes: Object.fromEntries(i.crimes),
        killed: i.killed,
        boarded: i.boarded,
      })),
    closeAll,
    wreck,
    dispose: () => offs.forEach((off) => off()),
  };
}
