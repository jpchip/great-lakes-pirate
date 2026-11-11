import locksJson from '../../../data/locks.json';
import lootJson from '../../../data/loot_tables.json';
import {
  locksFileSchema,
  lootTablesFileSchema,
  type HeistTarget,
  type LockTier,
  type LocksFile,
  type LootTable,
  type LootTablesFile,
} from '../../../data/schemas/heist';
import { Rng } from '../../core/rng';
import { dayAndHour, SECONDS_PER_GAME_DAY } from '../../core/time';
import { seasonAt } from '../../sim/economy/defs';
import type { DistrictWorld } from '../../sim/world-state';
import { DOOR_HEIGHT_M } from '../../sim/district/kit';
import type { DistrictModel } from '../district/district';
import type { BoxCollider } from './colliders';
import type { CharacterState, ControllerParams } from './controller';
import { withinHours } from './conduct';
import type { Stealth } from './stealth';
import type { OnFootTools, Pockets } from './tools';

/**
 * Locks, loot and carrying (plan 08 §6.1, §7, §8, §15; Phase 7 piece E, part two): the
 * district's targets made breakable.
 *
 * - **Locked doors.** A target's doors are locked in its hours (the warehouses from 7 p.m.
 *   to 6 a.m., the shops when they shut): a leaf across the opening you can't walk or see
 *   through. **Hold F** to pick it (2, 4 or 7 s by tier; let go and the progress waits for
 *   you), with a chance each second of a click a guard nearby can hear and of a snapped
 *   pick. Or take the crowbar in hand and hold F: a second or two, heard 15 m off, and the
 *   broken lock is found at dawn. From inside you slip the bolt. An opened door stays open
 *   that night; the next it's locked again (a forced one mended).
 * - **Containers** stand at the layout's loot marks: crates of the owner's goods, a cash
 *   box, papers. A strongbox has its own lock. Hold F to lift a crate (1 CU, in your arms:
 *   slow, loud, no crouching, unmistakable), or to rifle a box for its cash and papers. A
 *   shipping schedule among the papers is a rumor of a sailing (`documents`).
 * - **Carrying a crate** to the gangway, F stows it aboard (`stow`): hot, with its owner's
 *   marks. F anywhere else puts it down, where it can be picked up again (or the lake has
 *   it). Each crate lifted comes out of the port's market stock (`takeStock`).
 * - **What's left behind:** every theft, and every forced lock, is an `ItemStolen` /
 *   `LockForced` event; `foot-law.ts` makes a burglary of it, reported at dawn from the
 *   evidence unless a guard saw you.
 *
 * Everything the containers and doors remember lives in the save's `districts` record, so
 * an emptied warehouse stays empty when you come back, until it's stocked again.
 */

export interface HeistDefs {
  locks: LocksFile;
  loot: LootTablesFile;
  tables: ReadonlyMap<string, LootTable>;
}

let cached: HeistDefs | undefined;

export function gameHeist(): HeistDefs {
  if (!cached) {
    const locks = locksFileSchema.parse(locksJson);
    const loot = lootTablesFileSchema.parse(lootJson);
    cached = { locks, loot, tables: new Map(loot.tables.map((t) => [t.id, t])) };
  }
  return cached;
}

/** A crate in your arms, or put down somewhere. */
export interface Crate {
  good: string;
  /** The company whose marks are on it. */
  owner: string | undefined;
  /** The building it came out of. */
  building: string;
  /** Game seconds it was lifted. */
  since: number;
}

export type HeistVerb =
  'pick' | 'force' | 'unbolt' | 'openBox' | 'forceBox' | 'lift' | 'rifle' | 'stow' | 'putDown';

export interface HeistOffer {
  verb: HeistVerb;
  label: string;
  ok: boolean;
  why?: string;
  /** Hold F this long (0: a press). */
  holdS: number;
  /** Progress already made (a part-picked lock). */
  done01: number;
}

export type HeistEvent =
  | { type: 'LockPicked'; lock: string; building: string; tier: number }
  | { type: 'LockForced'; lock: string; building: string; owner: string | undefined }
  | { type: 'PickBroken'; lock: string; left: number }
  | { type: 'LockClicked'; lock: string }
  | {
      type: 'ItemStolen';
      building: string;
      owner: string | undefined;
      /** A crate lifted, or a box's cash and papers. */
      good?: string;
      cashCents?: number;
      documents?: boolean;
    }
  | { type: 'CrateLifted'; good: string; building: string }
  | { type: 'CrateStowed'; good: string; owner: string | undefined }
  | { type: 'CrateDropped'; good: string; sunk: boolean };

export interface HeistHooks {
  /** Puts a crate in the hold (hot, with its marks). A refusal ("The hold is full"), or none. */
  stow(crate: Crate): string | undefined;
  /** A crate lifted comes out of the port's market stock. */
  takeStock?(good: string, qty: number): void;
  /** Reads a shipping schedule: the rumor it gave, in words, or nothing worth knowing. */
  readPapers?(): string | undefined;
  /** Where you can stow a crate (the gangway), district-local meters. */
  stowPoints(): readonly { x: number; y: number; z: number }[];
  /** The captain has a perk (the Poacher's boot pick, the Lumberjack's back). */
  perk?(id: string): boolean;
  notice?(text: string): void;
}

export interface HeistOptions {
  model: DistrictModel;
  targets: readonly HeistTarget[];
  /** The save's record for this district (mutated in place). */
  world: DistrictWorld;
  stealth: Stealth;
  tools: OnFootTools | undefined;
  pockets: Pockets;
  hooks: HeistHooks;
  seed: string;
  defs?: HeistDefs;
}

/** What the heist knows each tick. */
export interface HeistContext {
  player: CharacterState;
  gameSeconds: number;
}

export interface Heist {
  readonly carrying: Crate | undefined;
  /** What F does here, if anything. */
  offer(ctx: HeistContext): HeistOffer | undefined;
  /** How far the held F has got, 0–1, for the HUD's ring (a part-picked lock shows its work). */
  hold01(ctx: HeistContext): number;
  /**
   * F this tick, held and pressed: true when the heist took it. A pick's progress stays
   * when you let go; anything else held starts again.
   */
  interact(ctx: HeistContext, dt: number, down: boolean, pressed: boolean): boolean;
  /** Each tick: doors lock and unlock with the hours. */
  step(ctx: HeistContext): void;
  /** The controller's params while you carry (slower, no crouching). */
  params(base: ControllerParams): ControllerParams;
  /** What a container holds now (the dev hooks, tests). */
  contents(mark: string, gameSeconds: number): ContainerContents | undefined;
  /** Whether a door is locked now. */
  locked(doorId: string, gameSeconds: number): boolean;
  /** The doors that lock, for the dev hooks. */
  readonly doors: readonly HeistDoor[];
  readonly containers: readonly HeistContainer[];
  /** Crates put down in the district tonight. */
  readonly dropped: readonly (Crate & { x: number; y: number; z: number })[];
  on(fn: (e: HeistEvent) => void): () => void;
}

export interface HeistDoor {
  id: string;
  building: string;
  tier: number;
  x: number;
  y: number;
  z: number;
  alongX: boolean;
  leaf: BoxCollider;
}

export interface HeistContainer {
  mark: string;
  building: string;
  owner: string | undefined;
  table: LootTable;
  lock: number | undefined;
  x: number;
  y: number;
  z: number;
}

export interface ContainerContents {
  crates: Record<string, number>;
  cashCents: number;
  documents: boolean;
  /** Its own lock is shut. */
  locked: boolean;
}

/** You can reach a door or a container from this far. */
export const HEIST_REACH_M = 1.7;
/** And stow a crate this close to the gangway. */
export const STOW_REACH_M = 2.4;
/** The night a moment belongs to runs from noon to noon. */
export function nightOf(gameSeconds: number): number {
  return Math.floor((gameSeconds - SECONDS_PER_GAME_DAY / 2) / SECONDS_PER_GAME_DAY);
}

/** Leaves added to each district model once: the model's colliders can't be taken out. */
const leaves = new WeakMap<DistrictModel, Map<string, BoxCollider>>();

function doorLeaf(model: DistrictModel, door: DistrictModel['doors'][number]): BoxCollider {
  let byDoor = leaves.get(model);
  if (!byDoor) {
    byDoor = new Map();
    leaves.set(model, byDoor);
  }
  let leaf = byDoor.get(door.id);
  if (!leaf) {
    const half = door.widthM / 2;
    leaf = {
      kind: 'box',
      x: door.x,
      z: door.z,
      halfX: door.alongX ? half : 0.08,
      halfZ: door.alongX ? 0.08 : half,
      yaw: 0,
      minY: door.y,
      maxY: door.y + DOOR_HEIGHT_M,
      disabled: true,
    };
    model.colliders.add(leaf);
    byDoor.set(door.id, leaf);
  }
  return leaf;
}

/** The crates, cash and papers a table rolls for one stocking. */
export function rollContents(
  table: LootTable,
  seed: string,
  cycle: number,
  seasonMul: number,
): { crates: Record<string, number>; cashCents: number; documents: boolean } {
  const rng = Rng.fromSeed(`${seed}:${table.id}:${cycle}`);
  const crates: Record<string, number> = {};
  for (const c of table.crates) {
    const n = Math.round(rng.range(c.min, c.max + 0.999) * seasonMul - 0.499);
    if (n > 0) crates[c.good] = (crates[c.good] ?? 0) + Math.floor(n);
  }
  const [lo, hi] = table.cashCents;
  const cashCents = hi > 0 ? Math.round(rng.range(lo, hi) / 100) * 100 : 0;
  return { crates, cashCents, documents: rng.chance(table.documents) };
}

function goodWord(good: string): string {
  return good.replace(/^good\./, '').replace(/_/g, ' ');
}

export function createHeist(opts: HeistOptions): Heist {
  const { model, world, stealth, tools, pockets, hooks } = opts;
  const defs = opts.defs ?? gameHeist();
  const listeners = new Set<(e: HeistEvent) => void>();
  const emit = (e: HeistEvent): void => {
    for (const fn of listeners) fn(e);
  };
  const cycleS = defs.loot.restockDays * SECONDS_PER_GAME_DAY;
  const tier = (n: number): LockTier => defs.locks.tiers[String(n) as '1' | '2' | '3'] as LockTier;
  const targetOf = new Map(opts.targets.map((t) => [t.building, t]));

  const doors: HeistDoor[] = [];
  for (const d of model.doors) {
    const t = d.building ? targetOf.get(d.building) : undefined;
    if (!t || !d.building) continue;
    doors.push({
      id: d.id,
      building: d.building,
      tier: t.lock.tier,
      x: d.x,
      y: d.y,
      z: d.z,
      alongX: d.alongX,
      leaf: doorLeaf(model, d),
    });
  }
  const containers: HeistContainer[] = [];
  for (const t of opts.targets) {
    for (const c of t.containers) {
      const table = defs.tables.get(c.table);
      const m = model.marks.find((k) => k.id === c.mark);
      if (!table || !m) continue;
      containers.push({
        mark: c.mark,
        building: t.building,
        owner: t.owner,
        table,
        lock: c.lock,
        x: m.x,
        y: model.floorAt(m.x, m.z),
        z: m.z,
      });
    }
  }

  let carrying: Crate | undefined;
  const dropped: (Crate & { x: number; y: number; z: number })[] = [];
  /** Seconds of picking done on each lock (doors by id, boxes by mark), kept while you're here. */
  const picked = new Map<string, number>();
  let holdS = -1;
  let holdKey = '';

  const has = (perk: string): boolean => hooks.perk?.(perk) ?? false;
  const bootPick = (): boolean => has(defs.locks.bootPick.perk);
  const picks = (): number => (bootPick() ? Infinity : (pockets.stores[defs.locks.picks] ?? 0));
  const crowbarInHand = (): boolean =>
    tools?.selected.kind === 'force' && (tools.count(tools.selected) ?? 0) > 0;

  const doorLocked = (d: HeistDoor, t: number): boolean => {
    const target = targetOf.get(d.building);
    if (!target) return false;
    const { hour } = dayAndHour(t);
    if (!withinHours(hour, target.lock.hours)) return false;
    const opened = world.doors[d.id];
    return !(opened && opened.night === nightOf(t));
  };

  const record = (c: HeistContainer, t: number): DistrictWorld['containers'][string] => {
    let r = world.containers[c.mark];
    if (!r || t >= r.restockAt) {
      const cycle = Math.floor(t / cycleS);
      r = {
        taken: {},
        cash: false,
        documents: false,
        opened: false,
        restockAt: (cycle + 1) * cycleS,
      };
      world.containers[c.mark] = r;
    }
    return r;
  };

  const contents = (c: HeistContainer, t: number): ContainerContents => {
    const r = world.containers[c.mark];
    const live = r && t < r.restockAt ? r : undefined;
    const cycle = live ? Math.round(live.restockAt / cycleS) - 1 : Math.floor(t / cycleS);
    const season = defs.loot.season[seasonAt(cycle * cycleS)] ?? 1;
    const roll = rollContents(c.table, `${opts.seed}:${c.mark}`, cycle, season);
    const crates: Record<string, number> = {};
    for (const [good, n] of Object.entries(roll.crates)) {
      const left = n - (live?.taken[good] ?? 0);
      if (left > 0) crates[good] = left;
    }
    return {
      crates,
      cashCents: live?.cash ? 0 : roll.cashCents,
      documents: live?.documents ? false : roll.documents,
      locked: c.lock !== undefined && !live?.opened,
    };
  };

  const near = <T extends { x: number; y: number; z: number }>(
    list: readonly T[],
    p: { x: number; y: number; z: number },
    reach: number,
  ): T | undefined => {
    let best: T | undefined;
    let bestD = reach;
    for (const o of list) {
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d <= bestD && Math.abs(o.y - p.y) < 1.6) {
        bestD = d;
        best = o;
      }
    }
    return best;
  };

  const inside = (building: string, p: { x: number; y: number; z: number }): boolean =>
    model.buildingAt(p.x, p.y + 0.5, p.z)?.def.id === building;

  /** A lock's offer: pick, or force with the crowbar in hand. */
  const lockOffer = (
    key: string,
    n: number,
    what: string,
    box: boolean,
  ): HeistOffer & { key: string } => {
    const lt = tier(n);
    if (crowbarInHand()) {
      return {
        key,
        verb: box ? 'forceBox' : 'force',
        label: `Force the ${what} with the crowbar`,
        ok: true,
        holdS: lt.forceS,
        done01: 0,
      };
    }
    const speed = bootPick() ? defs.locks.bootPick.speed : 1;
    const need = lt.pickS / speed;
    const done = picked.get(key) ?? 0;
    const base = {
      key,
      verb: box ? ('openBox' as const) : ('pick' as const),
      label: `Pick the ${what} (tier ${n})`,
      holdS: need,
      done01: Math.min(1, done / need),
    };
    return picks() > 0
      ? { ...base, ok: true }
      : { ...base, ok: false, why: 'No lockpicks: try the crowbar' };
  };

  const offerAt = (ctx: HeistContext): (HeistOffer & { key: string }) | undefined => {
    const p = ctx.player.position;
    const t = ctx.gameSeconds;
    if (tools?.carrying || ctx.player.swimming) return undefined;
    if (carrying) {
      const stow = near(hooks.stowPoints(), p, STOW_REACH_M);
      return stow
        ? {
            key: 'stow',
            verb: 'stow',
            label: `Stow the ${goodWord(carrying.good)} aboard`,
            ok: true,
            holdS: 0,
            done01: 0,
          }
        : {
            key: 'put',
            verb: 'putDown',
            label: 'Put the crate down',
            ok: true,
            holdS: 0,
            done01: 0,
          };
    }
    // A crate someone put down.
    const crate = near(dropped, p, HEIST_REACH_M);
    if (crate) {
      return {
        key: `dropped:${dropped.indexOf(crate)}`,
        verb: 'lift',
        label: `Pick up the ${goodWord(crate.good)}`,
        ok: true,
        holdS: defs.loot.carry.liftS,
        done01: 0,
      };
    }
    const box = near(containers, p, HEIST_REACH_M);
    if (box) {
      const c = contents(box, t);
      if (c.locked)
        return lockOffer(
          `box:${box.mark}`,
          box.lock ?? 1,
          box.table.name.replace(/^the /, ''),
          true,
        );
      if (c.cashCents > 0 || c.documents) {
        return {
          key: `rifle:${box.mark}`,
          verb: 'rifle',
          label: `Go through ${box.table.name}`,
          ok: true,
          holdS: defs.loot.carry.takeS,
          done01: 0,
        };
      }
      const good = Object.keys(c.crates)[0];
      if (good) {
        return {
          key: `lift:${box.mark}`,
          verb: 'lift',
          label: `Lift a crate of ${goodWord(good)} (${Object.values(c.crates).reduce((a, b) => a + b, 0)} left)`,
          ok: true,
          holdS: defs.loot.carry.liftS,
          done01: 0,
        };
      }
      return {
        key: `empty:${box.mark}`,
        verb: 'lift',
        label: `${capital(box.table.name)}: empty`,
        ok: false,
        why: 'Nothing left',
        holdS: 0,
        done01: 0,
      };
    }
    const door = near(doors, p, HEIST_REACH_M);
    if (door && doorLocked(door, t)) {
      if (inside(door.building, p)) {
        return {
          key: `door:${door.id}`,
          verb: 'unbolt',
          label: 'Slip the bolt',
          ok: true,
          holdS: 0,
          done01: 0,
        };
      }
      return lockOffer(`door:${door.id}`, door.tier, 'lock', false);
    }
    return undefined;
  };

  const take = (box: HeistContainer, t: number, what: 'crate' | 'rifle'): void => {
    const r = record(box, t);
    const c = contents(box, t);
    if (what === 'rifle') {
      if (c.cashCents > 0) pockets.purse += c.cashCents;
      r.cash = true;
      let read: string | undefined;
      if (c.documents) {
        r.documents = true;
        read = hooks.readPapers?.();
      }
      emit({
        type: 'ItemStolen',
        building: box.building,
        owner: box.owner,
        ...(c.cashCents > 0 ? { cashCents: c.cashCents } : {}),
        ...(c.documents ? { documents: true } : {}),
      });
      const cash = c.cashCents > 0 ? `$${(c.cashCents / 100).toFixed(2)}` : '';
      const papers = c.documents ? (read ? `a schedule: ${read}` : 'papers of no use') : '';
      hooks.notice?.(`You take ${[cash, papers].filter(Boolean).join(' and ') || 'nothing'}`);
      return;
    }
    const good = Object.keys(c.crates)[0];
    if (!good) return;
    r.taken[good] = (r.taken[good] ?? 0) + 1;
    carrying = { good, owner: box.owner, building: box.building, since: t };
    hooks.takeStock?.(good, 1);
    emit({ type: 'ItemStolen', building: box.building, owner: box.owner, good });
    emit({ type: 'CrateLifted', good, building: box.building });
  };

  const openLock = (key: string, ctx: HeistContext, how: 'picked' | 'forced'): void => {
    const t = ctx.gameSeconds;
    if (key.startsWith('door:')) {
      const door = doors.find((d) => `door:${d.id}` === key);
      if (!door) return;
      world.doors[door.id] = { how, night: nightOf(t) };
      door.leaf.disabled = true;
      const owner = targetOf.get(door.building)?.owner;
      emit(
        how === 'picked'
          ? { type: 'LockPicked', lock: door.id, building: door.building, tier: door.tier }
          : { type: 'LockForced', lock: door.id, building: door.building, owner },
      );
    } else {
      const box = containers.find((c) => `box:${c.mark}` === key);
      if (!box) return;
      record(box, t).opened = true;
      emit(
        how === 'picked'
          ? { type: 'LockPicked', lock: box.mark, building: box.building, tier: box.lock ?? 1 }
          : { type: 'LockForced', lock: box.mark, building: box.building, owner: box.owner },
      );
    }
    picked.delete(key);
  };

  const noiseAt = (
    radiusM: number,
    kind: 'lock' | 'crate',
    at: { x: number; y: number; z: number },
  ): void => stealth.noise({ kind, x: at.x, y: at.y, z: at.z, radiusM, source: 'player' });

  /** Does what a pressed or fully held offer does. */
  const act = (o: HeistOffer & { key: string }, ctx: HeistContext): void => {
    const p = ctx.player.position;
    const t = ctx.gameSeconds;
    switch (o.verb) {
      case 'stow': {
        if (!carrying) return;
        const why = hooks.stow(carrying);
        if (why) {
          hooks.notice?.(why);
          return;
        }
        emit({ type: 'CrateStowed', good: carrying.good, owner: carrying.owner });
        noiseAt(4, 'crate', p);
        carrying = undefined;
        return;
      }
      case 'putDown': {
        if (!carrying) return;
        const h = ctx.player.heading;
        const x = p.x + Math.sin(h) * 0.8;
        const z = p.z - Math.cos(h) * 0.8;
        const floor = model.floorAt(x, z);
        const sunk = floor < model.waterLevel - 0.3;
        if (!sunk) dropped.push({ ...carrying, x, y: floor, z });
        emit({ type: 'CrateDropped', good: carrying.good, sunk });
        noiseAt(sunk ? 10 : 5, 'crate', p);
        carrying = undefined;
        return;
      }
      case 'lift': {
        if (o.key.startsWith('dropped:')) {
          const k = Number(o.key.slice(8));
          const crate = dropped[k];
          if (!crate) return;
          dropped.splice(k, 1);
          carrying = {
            good: crate.good,
            owner: crate.owner,
            building: crate.building,
            since: crate.since,
          };
          return;
        }
        const box = containers.find((c) => `lift:${c.mark}` === o.key);
        if (box) take(box, t, 'crate');
        return;
      }
      case 'rifle': {
        const box = containers.find((c) => `rifle:${c.mark}` === o.key);
        if (box) take(box, t, 'rifle');
        return;
      }
      case 'unbolt':
        openLock(o.key, ctx, 'picked');
        return;
      case 'force':
      case 'forceBox': {
        const n = o.key.startsWith('door:')
          ? (doors.find((d) => `door:${d.id}` === o.key)?.tier ?? 1)
          : (containers.find((c) => `box:${c.mark}` === o.key)?.lock ?? 1);
        noiseAt(tier(n).forceM, 'lock', p);
        openLock(o.key, ctx, 'forced');
        return;
      }
      case 'pick':
      case 'openBox':
        openLock(o.key, ctx, 'picked');
        return;
    }
  };

  const rng = Rng.fromSeed(`${opts.seed}:heist:${model.layout.id}`);

  const self: Heist = {
    get carrying() {
      return carrying;
    },
    offer(ctx) {
      const o = offerAt(ctx);
      if (!o) return undefined;
      return {
        verb: o.verb,
        label: o.label,
        ok: o.ok,
        ...(o.why !== undefined ? { why: o.why } : {}),
        holdS: o.holdS,
        done01: o.done01,
      };
    },
    hold01(ctx) {
      const o = offerAt(ctx);
      if (!o || o.holdS <= 0) return 0;
      if (o.verb === 'pick' || o.verb === 'openBox') return o.done01;
      return holdKey === o.key && holdS >= 0 ? Math.min(1, holdS / o.holdS) : 0;
    },
    interact(ctx, dt, down, pressed) {
      const o = offerAt(ctx);
      if (!o) {
        holdS = -1;
        return false;
      }
      if (!o.ok) return pressed;
      const picking = o.verb === 'pick' || o.verb === 'openBox';
      if (o.holdS <= 0) {
        if (pressed) act(o, ctx);
        return pressed;
      }
      if (picking) {
        if (!down) return pressed;
        // Hold-to-pick: the work done stays on the lock when you let go.
        const lockKey = o.key;
        const n = lockKey.startsWith('door:')
          ? (doors.find((d) => `door:${d.id}` === lockKey)?.tier ?? 1)
          : (containers.find((c) => `box:${c.mark}` === lockKey)?.lock ?? 1);
        const lt = tier(n);
        const done = (picked.get(lockKey) ?? 0) + dt;
        picked.set(lockKey, done);
        if (rng.chance(lt.clickPerS * dt)) {
          noiseAt(lt.clickM, 'lock', ctx.player.position);
          emit({ type: 'LockClicked', lock: lockKey });
        }
        if (!bootPick() && rng.chance(lt.breakPerS * dt)) {
          const left = Math.max(0, (pockets.stores[defs.locks.picks] ?? 0) - 1);
          pockets.stores[defs.locks.picks] = left;
          emit({ type: 'PickBroken', lock: lockKey, left });
          hooks.notice?.(left > 0 ? `A pick snaps (${left} left)` : 'Your last pick snaps');
          if (left <= 0) return true;
        }
        if (done >= o.holdS) act(o, ctx);
        return true;
      }
      // Any other hold starts again if you let go or it changes.
      if (pressed || holdKey !== o.key) {
        holdKey = o.key;
        holdS = pressed ? 0 : -1;
      }
      if (holdS >= 0) {
        if (!down) holdS = -1;
        else if ((holdS += dt) >= o.holdS) {
          holdS = -1;
          act(o, ctx);
        }
      }
      return down || pressed;
    },
    step(ctx) {
      for (const d of doors) d.leaf.disabled = !doorLocked(d, ctx.gameSeconds);
    },
    params(base) {
      if (!carrying) return base;
      const c = defs.loot.carry;
      const strong = has(c.strongBack.perk) ? c.strongBack.speed : 1;
      return {
        ...base,
        walkSpeed: base.walkSpeed * Math.min(1, c.walk * strong),
        runSpeed: base.runSpeed * Math.min(1, c.run * strong),
      };
    },
    contents(mark, t) {
      const c = containers.find((k) => k.mark === mark);
      return c ? contents(c, t) : undefined;
    },
    locked(doorId, t) {
      const d = doors.find((k) => k.id === doorId);
      return d ? doorLocked(d, t) : false;
    },
    doors,
    containers,
    dropped,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return self;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
