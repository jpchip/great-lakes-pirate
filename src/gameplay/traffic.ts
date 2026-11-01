import type { ShipRecord } from '../../data/schemas/ships';
import { chartToZone, knotsToMs, sceneSpeed, type Chart, type ZoneFrame } from '../core/coords';
import { dayAndHour, R_SAILING } from '../core/time';
import type { GameContext } from '../modes/context';
import { cycleStartS, placeTraffic, westernSuperiorRoutes } from '../sim/chart/routes';
import type { Contact } from '../sim/chart/traffic';
import { gameEconomy, type EconomyDefs } from '../sim/economy/defs';
import type { HarborLayout } from '../sim/harbors';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import {
  assignBerths,
  drawnSize,
  harborForPort,
  pierSideKey,
  sideOfBerth,
  type BerthTerrain,
  type NpcBerth,
} from '../sim/traffic/berths';
import {
  currentManifest,
  gameTraffic,
  runTraffic,
  type Manifest,
  type TrafficDefs,
} from '../sim/traffic/cargo';
import { hail as hailNews, type HailNews } from '../sim/traffic/news';
import type { TrafficState } from '../sim/world-state';
import { shipCard, type ShipCard } from '../ui/hud/ship-card';
import { cloneTransform, type Entity } from './ecs';
import { createNpcShipEntity } from './npc-ships';

/**
 * The lake's traffic in the running game (plan 05 §8, plan 01 §3.4; Phase 4 piece D).
 *
 * - **Cargo moves markets.** On every world tick, each ship's arrivals and departures
 *   since the last one add to and take from the ports' stock (`runTraffic`).
 * - **Ships materialize in the loaded zone.** A ship whose timetable has her on water the
 *   zone covers sails there at her place on the clock, and one lying in a port the zone
 *   holds lies alongside a pier; each collapses back to the timetable when she leaves.
 * - **"Look her over" and hailing.** F near a ship (with no berth to dock at) reads her
 *   manifest; H hails her in daylight for her last port's prices and a rumor.
 */

/** "Look her over" reaches this far in a zone or an arena, meters (arena.ts's own range). */
export const LOOK_RANGE_M = 160;
/** A hail carries this far, meters. */
export const HAIL_RANGE_M = 400;
/** A tow line, meters: a consort sails this far astern of her steamer. */
const TOW_M = 60;
/** Water an under-way ship needs beyond her draft to be shown in a zone. */
const UNDER_KEEL_M = 0.5;

export interface TrafficZone {
  /** The zone's frame in the world chart frame (zones sit there; the route graph doesn't). */
  frame: ZoneFrame;
  /** A route graph (chart geography) point in the world chart frame (`toWorldChart`). */
  toWorld(p: Chart): Chart;
  terrain: (BerthTerrain & { contains(x: number, z: number): boolean }) | undefined;
  harbors: readonly HarborLayout[];
}

/** A materialized ship: the contact she is, or the consort of one. */
interface Shown {
  entity: Entity;
  contact: Contact;
  record: ShipRecord;
  berthed: boolean;
}

export interface NearShip {
  id: string;
  contact: Contact | undefined;
  entity: Entity;
  distanceM: number;
}

export interface GameTraffic {
  readonly contacts: readonly Contact[];
  readonly defs: TrafficDefs;
  /** Ship entities in the zone now, by id. */
  readonly shown: ReadonlyMap<string, { entity: Entity; berthed: boolean }>;
  /** Pier sides the traffic holds: the player's berths there are withdrawn. */
  readonly takenSides: ReadonlySet<string>;
  /** The loaded zone, or undefined in an arena or on the chart. */
  setZone(zone: TrafficZone | undefined): void;
  /**
   * Puts every ship where the clock has her and the zone's ships where they show. The
   * player's berth (if docked) keeps its pier side. Returns true when the pier sides the
   * traffic holds changed.
   */
  step(playerBerthId: string | undefined): boolean;
  /** The nearest NPC ship entity within `rangeM` of a point (zone or arena). */
  nearest(at: { x: number; z: number }, rangeM: number): NearShip | undefined;
  manifest(contactId: string): Manifest | undefined;
  /** "Look her over": the card for a ship by entity id. */
  lookOver(entityId: string): ShipCard;
  /** Hails a ship: her card with the news (or why there was none). */
  hail(entityId: string): ShipCard;
  /** Moves the markets for every call since the last tick. */
  deliver(gameSeconds: number): void;
  dispose(): void;
}

function recordOf(id: string): ShipRecord {
  const r = SHIP_RECORDS.find((s) => s.id === id);
  if (!r) throw new Error(`No ship class ${id}`);
  return r;
}

/** The contact an entity id belongs to: a consort's is her steamer's. */
function contactIdOf(entityId: string): string {
  return entityId.replace(/\.consort_\d+$/, '');
}

export function attachTraffic(
  ctx: GameContext,
  contacts: Contact[],
  defs: TrafficDefs = gameTraffic(),
  economy: EconomyDefs = gameEconomy(),
): GameTraffic {
  const graph = westernSuperiorRoutes();
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const clock = ctx.state.environment.clock;
  const traffic = (): TrafficState =>
    (ctx.state.traffic ??= { deliveredTo: clock.gameSeconds, ships: {} });

  const deliver = (gameSeconds: number): void => {
    const t = traffic();
    if (gameSeconds <= t.deliveredTo) return;
    const done = runTraffic(defs, economy, ctx.state.markets, contacts, t.deliveredTo, gameSeconds);
    t.deliveredTo = gameSeconds;
    for (const d of done) ctx.events.emit('CargoDelivered', d);
  };
  const offTick = ctx.events.on('WorldTick', ({ gameSeconds }) => deliver(gameSeconds));

  let zone: TrafficZone | undefined;
  const shown = new Map<string, Shown>();
  let berths = new Map<string, NpcBerth>();
  let berthKey = '';
  let takenSides = new Set<string>();

  const clear = (): void => {
    for (const s of shown.values()) ctx.world.remove(s.entity);
    shown.clear();
    berths = new Map();
    berthKey = '';
    takenSides = new Set();
  };

  /** Shows a ship at a pose, or moves her there. */
  const show = (
    id: string,
    contact: Contact,
    record: ShipRecord,
    pose: { x: number; z: number; heading: number },
    speedKn: number,
    berthed: boolean,
  ): void => {
    let s = shown.get(id);
    if (!s) {
      const entity = createNpcShipEntity(record, pose.x, pose.z, pose.heading, speedKn);
      entity.id = id;
      ctx.world.add(entity);
      s = { entity, contact, record, berthed };
      shown.set(id, s);
    }
    const t = s.entity.transform;
    if (!t) return;
    // A ship that jumped (berth to lane, or a fresh place) mustn't streak across the water.
    const jumped = Math.hypot(t.position.x - pose.x, t.position.z - pose.z) > 50;
    t.position.x = pose.x;
    t.position.z = pose.z;
    t.heading = pose.heading;
    if (jumped || s.berthed !== berthed) s.entity.previousTransform = cloneTransform(t);
    s.berthed = berthed;
    const npc = s.entity.npc;
    if (npc) npc.speedKn = speedKn;
    const v = s.entity.velocity;
    if (v) {
      // Only the wake and the smoke read it: the timetable places her.
      const scene = sceneSpeed(knotsToMs(speedKn), R_SAILING, zone?.frame.compression ?? 8);
      v.x = Math.sin(pose.heading) * scene;
      v.z = -Math.cos(pose.heading) * scene;
    }
  };

  const deepEnough = (x: number, z: number, record: ShipRecord): boolean => {
    const terrain = zone?.terrain;
    if (!terrain || !terrain.contains(x, z)) return false;
    return terrain.depthAt(x, z) >= record.draftFullM + UNDER_KEEL_M;
  };

  /** The node a ship lying at an end of her lane is at. */
  const lyingNode = (c: Contact): string | undefined => {
    const s = c.schedule;
    const lane = c.lane;
    if (!s || !lane) return undefined;
    return lane.leg === 0 && lane.progressM === 0 ? s.homeNode : s.awayNode;
  };

  const step = (playerBerthId: string | undefined): boolean => {
    const now = clock.gameSeconds;
    placeTraffic(contacts, now);
    if (!zone) return false;
    const seen = new Set<string>();
    // Ships in port at a harbor here, by harbor, in a stable order.
    const inPort = new Map<HarborLayout, { id: string; record: ShipRecord; contact: Contact }[]>();
    for (const c of contacts) {
      if (!c.schedule || !c.classId) continue;
      const record = recordOf(c.classId);
      const consorts = (c.consorts ?? []).map((k, i) => ({
        id: `${c.id}.consort_${i + 1}`,
        record: recordOf(k.classId),
      }));
      if (c.inPort) {
        const node = lyingNode(c);
        const port = node ? defs.portOf.get(node) : undefined;
        const harbor = port ? harborForPort(zone.harbors, port) : undefined;
        if (!harbor) continue;
        const list = inPort.get(harbor) ?? [];
        list.push({ id: c.id, record, contact: c });
        for (const k of consorts) list.push({ ...k, contact: c });
        inPort.set(harbor, list);
        continue;
      }
      const p = chartToZone(zone.toWorld(c.pos), zone.frame);
      if (!deepEnough(p.x, p.z, record)) continue;
      // Her heading in the zone: the two charts' projections differ a little.
      const ahead = chartToZone(
        zone.toWorld({
          x: c.pos.x + Math.sin(c.heading) * 1000,
          y: c.pos.y + Math.cos(c.heading) * 1000,
        }),
        zone.frame,
      );
      const heading = Math.atan2(ahead.x - p.x, -(ahead.z - p.z));
      const speed = c.underWay ? c.speedKn : 0;
      show(c.id, c, record, { x: p.x, z: p.z, heading }, speed, false);
      seen.add(c.id);
      // Her consort in tow, astern.
      let back = drawnSize(record).lengthM / 2;
      for (const k of consorts) {
        const len = drawnSize(k.record).lengthM;
        back += TOW_M + len / 2;
        const kx = p.x - Math.sin(heading) * back;
        const kz = p.z + Math.cos(heading) * back;
        back += len / 2;
        if (!deepEnough(kx, kz, k.record)) continue;
        show(k.id, c, k.record, { x: kx, z: kz, heading }, speed, false);
        seen.add(k.id);
      }
    }
    // Berths: laid out again only when who's in port, or the player's berth, changes.
    const player = playerBerthId ? sideOfBerth(playerBerthId) : undefined;
    const taken = new Set<string>();
    if (player) taken.add(pierSideKey(player.pierId, player.side));
    const key =
      [...inPort.values()].map((l) => l.map((s) => s.id).join(',')).join(';') +
      `|${[...taken].join(',')}`;
    if (key !== berthKey) {
      berthKey = key;
      berths = new Map();
      for (const [harbor, list] of inPort) {
        list.sort((a, b) => a.id.localeCompare(b.id));
        for (const [id, b] of assignBerths(harbor, list, zone.terrain, taken)) berths.set(id, b);
      }
    }
    for (const list of inPort.values()) {
      for (const s of list) {
        const b = berths.get(s.id);
        if (!b) continue;
        show(s.id, s.contact, s.record, b.pose, 0, true);
        seen.add(s.id);
      }
    }
    for (const [id, s] of shown) {
      if (seen.has(id)) continue;
      ctx.world.remove(s.entity);
      shown.delete(id);
    }
    const sides = new Set<string>();
    for (const [id, b] of berths) if (shown.has(id)) sides.add(pierSideKey(b.pierId, b.side));
    const changed = sides.size !== takenSides.size || [...sides].some((k) => !takenSides.has(k));
    takenSides = sides;
    return changed;
  };

  const manifest = (contactId: string): Manifest | undefined => {
    const c = byId.get(contactId);
    return c ? currentManifest(defs, economy, c, clock.gameSeconds) : undefined;
  };

  const cardFor = (entityId: string, news?: HailNews | 'dark' | 'told'): ShipCard => {
    const contact = byId.get(contactIdOf(entityId));
    const consort = entityId !== contactIdOf(entityId);
    const entity = [...ctx.world.entities].find((e) => e.id === entityId);
    const classId = entity?.npc?.classId ?? contact?.classId ?? '';
    const record = SHIP_RECORDS.find((r) => r.id === classId);
    const name = consort
      ? (contact?.consorts?.[0]?.name ?? 'A consort')
      : (contact?.name ?? record?.name ?? 'A ship');
    const m = contact ? manifest(contact.id) : undefined;
    const owner = m?.owner ? defs.factions.get(m.owner) : undefined;
    return shipCard({
      shipId: entityId,
      name,
      className: consort ? `${record?.name ?? 'Consort'}, in tow` : (record?.name ?? 'Ship'),
      manifest: m,
      owner,
      nodes: graph.nodes,
      goodNames: (id) => (economy.goods.get(id)?.name ?? id).toLowerCase(),
      lyingAt: contact?.inPort ? 'port' : undefined,
      news,
    });
  };

  return {
    contacts,
    defs,
    get shown() {
      return shown;
    },
    get takenSides() {
      return takenSides;
    },
    setZone(next) {
      clear();
      zone = next;
    },
    step,
    nearest(at, rangeM) {
      let best: NearShip | undefined;
      for (const e of ctx.world.entities) {
        if (!e.npc || !e.transform || !e.id || e.npc.derelict) continue;
        const d = Math.hypot(e.transform.position.x - at.x, e.transform.position.z - at.z);
        if (d > rangeM || (best && d >= best.distanceM)) continue;
        best = { id: e.id, contact: byId.get(contactIdOf(e.id)), entity: e, distanceM: d };
      }
      return best;
    },
    manifest,
    lookOver(entityId) {
      ctx.events.emit('ShipLookedOver', { shipId: contactIdOf(entityId) });
      return cardFor(entityId);
    },
    hail(entityId) {
      const id = contactIdOf(entityId);
      const contact = byId.get(id);
      const now = clock.gameSeconds;
      if (!contact) return cardFor(entityId, 'told');
      const m = manifest(id);
      const record = (traffic().ships[id] ??= {});
      // Her news is told once a passage: the passage began when she last left a port.
      const s = contact.schedule;
      const passageStart =
        s && m
          ? cycleStartS(s, m.cycle) + (m.outbound ? 0 : s.lengthM / s.speedMs + s.dwellAwayS)
          : now;
      if (record.hailedAt !== undefined && record.hailedAt >= Math.min(passageStart, now)) {
        return cardFor(entityId, 'told');
      }
      const news = hailNews(
        defs,
        economy,
        ctx.state.markets,
        contacts,
        contact,
        now,
        dayAndHour(now).hour,
      );
      if (!news) return cardFor(entityId, 'dark');
      record.hailedAt = now;
      ctx.events.emit('ShipHailed', { shipId: id, news });
      return cardFor(entityId, news);
    },
    deliver,
    dispose() {
      offTick();
      clear();
    },
  };
}
