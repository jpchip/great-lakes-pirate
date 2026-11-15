import type { JailbreakRules } from '../../../data/schemas/jail';
import type { LocksFile, LockTier } from '../../../data/schemas/heist';
import type { Rng } from '../../core/rng';
import { DOOR_HEIGHT_M } from '../../sim/district/kit';
import type { DistrictModel } from '../district/district';
import type { BoxCollider } from './colliders';
import type { CharacterState, ControllerParams } from './controller';
import type { GuardSpawn, Waypoint } from './guards';
import type { Guard, Stealth } from './stealth';

/**
 * The jailbreak (plan 08 §9, §20.4 piece G): the lockup's cell at night, with nothing in
 * your pockets.
 *
 * You start behind a locked cell door of bars. The **jailer** keeps the front room: at his
 * desk with his back to you, then over for a look into the cells, then a while by the bars
 * looking the other way, and round again. Watch him from the cell before you try anything.
 * There are four ways through the door:
 *
 * - **A pick in your boot** (the Poacher's perk): hold F at the door, as at any lock. It
 *   can click, and he can hear it.
 * - **His keys.** While he stands by the bars not looking at you, hold F to lift them off
 *   his belt through the bars; then F at the door once he's gone.
 * - **Bang on the bars.** He comes to where the row was, unlocking the door on his way to
 *   look in. It stands open while he looks: bang at the far end and slip out behind him. If
 *   you're still inside when he's done, he locks it again.
 * - **A promise.** With him in earshot, promise him money from your stash: he turns the key
 *   and looks away until dawn, and you owe it (`promised`). He won't hear it from a man
 *   wanted for too much, or one who's to hang.
 *
 * Out of the cell, anyone who sees you knows what you are. Reach your ship at her pier and
 * cast off, before dawn (the game's side: `ashore.ts`, `capture.ts`). At tier 5 it's the
 * one chance: you start in irons that take time to slip, the jailer hears no promises, and
 * there's another constable in the lockup and a marshal at its door.
 *
 * Pure but for the stealth and the model it acts on: `watch.ts` runs it each tick.
 */

export const JAILER_ID = 'constable.jailer';

const DEG = Math.PI / 180;

function mark(
  model: DistrictModel,
  id: string,
): { x: number; z: number; face: number } | undefined {
  const m = model.marks.find((k) => k.id === id);
  return m && { x: m.x, z: m.z, face: m.headingDeg * DEG };
}

/** The cell you're held in: its door, its floor, and where you start. */
export interface JailCell {
  door: DistrictModel['doors'][number];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  spawn: { x: number; z: number; heading: number };
}

/**
 * Finds the cell behind `rules.cellDoor`: from the door's line to the lockup's wall on the
 * side of `jail.cell`, between the partitions either hand of that mark.
 */
export function jailCell(model: DistrictModel, rules: JailbreakRules): JailCell | undefined {
  const door = model.doors.find((d) => d.id === rules.cellDoor);
  const at = mark(model, 'jail.cell');
  if (!door || !at) return undefined;
  const b = model.buildings.find(
    (k) => at.x > k.minX && at.x < k.maxX && at.z > k.minZ && at.z < k.maxZ,
  );
  if (!b) return undefined;
  // Along the door's wall (u) and across it (v).
  const u = (p: { x: number; z: number }): number => (door.alongX ? p.x : p.z);
  const v = (p: { x: number; z: number }): number => (door.alongX ? p.z : p.x);
  const bu = door.alongX ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
  const bv = door.alongX ? [b.minZ, b.maxZ] : [b.minX, b.maxX];
  const side = Math.sign(v(at) - v(door)) || 1;
  let lo = bu[0] as number;
  let hi = bu[1] as number;
  for (const e of model.edges) {
    // A partition: a wall across the door's line, on the cell's side of it, inside the lockup.
    const across = door.alongX ? e.heading !== 0 : e.heading === 0;
    if (!across || e.piece.collider !== 'wall') continue;
    if ((v(e) - v(door)) * side <= 0 || v(e) < (bv[0] as number) || v(e) > (bv[1] as number)) {
      continue;
    }
    const eu = u(e);
    if (eu <= (bu[0] as number) + 0.1 || eu >= (bu[1] as number) - 0.1) continue;
    if (eu < u(at)) lo = Math.max(lo, eu);
    else hi = Math.min(hi, eu);
  }
  const v0 = v(door);
  const v1 = side > 0 ? (bv[1] as number) : (bv[0] as number);
  const [vMin, vMax] = v0 < v1 ? [v0, v1] : [v1, v0];
  return {
    door,
    minX: door.alongX ? lo : vMin,
    maxX: door.alongX ? hi : vMax,
    minZ: door.alongX ? vMin : lo,
    maxZ: door.alongX ? vMax : hi,
    spawn: { x: at.x, z: at.z, heading: at.face },
  };
}

/**
 * The lockup's own guards on the night of an attempt: the jailer on his round, and at tier
 * 5 the rest. They're added to the district's roster ahead of the Wanted tier's extras.
 */
export function jailGuards(
  model: DistrictModel,
  rules: JailbreakRules,
  execution: boolean,
): GuardSpawn[] {
  const desk = mark(model, 'jail.desk');
  const look = mark(model, 'jail.look');
  const bars = mark(model, 'jail.bars');
  if (!desk || !look || !bars) return [];
  // A guard at a stop looks the way of the stop he's bound for next (`stealth.ts` patrol),
  // so each mark's facing rides on the stop after it.
  const round: Waypoint[] = [
    { x: desk.x, z: desk.z, face: desk.face, waitS: rules.jailer.deskWaitS },
    { x: look.x, z: look.z, face: look.face, waitS: rules.jailer.lookS },
    { x: bars.x, z: bars.z, face: bars.face, waitS: rules.jailer.barsWaitS },
  ].map((p, k, all) => ({ ...p, face: (all[(k + all.length - 1) % all.length] ?? p).face }));
  const out: GuardSpawn[] = [
    {
      id: JAILER_ID,
      type: 'npc.constable',
      name: 'The jailer',
      route: { points: round, loop: true },
      // The night starts with his look into the cells, so there's his round to watch.
      startAt: 1,
    },
  ];
  if (!execution) return out;
  const post = mark(model, 'post.lockup');
  const inside = mark(model, 'jail.guard');
  for (let k = 0; k < rules.execution.constables && inside; k++) {
    // In by the stove, then out to the door for a look at the street, and back.
    const beat: Waypoint[] = [{ ...inside, waitS: 14 }];
    if (post) beat.push({ x: post.x + 1.5 * (k + 1), z: post.z, face: 0, waitS: 6 });
    out.push({
      id: `constable.lockup_${k + 2}`,
      type: 'npc.constable',
      name: 'A constable in the lockup',
      route: { points: beat, loop: false },
    });
  }
  const street = mark(model, 'jail.marshal');
  for (let k = 0; k < rules.execution.marshals && street; k++) {
    // Up and down the street before the lockup.
    out.push({
      id: `marshal.lockup_${k + 1}`,
      type: 'npc.marshal',
      name: 'The marshal come for the hanging',
      route: {
        points: [
          { x: street.x - 7, z: street.z, face: -Math.PI / 2, waitS: 5 },
          { x: street.x + 7, z: street.z, face: Math.PI / 2, waitS: 5 },
        ],
        loop: false,
      },
    });
  }
  return out;
}

export type JailVerb = 'irons' | 'keys' | 'unlock' | 'pick' | 'promise' | 'bang';

export interface JailOffer {
  verb: JailVerb;
  label: string;
  ok: boolean;
  why?: string;
  /** Hold F this long (0: a press). */
  holdS: number;
  done01: number;
}

export type JailbreakEvent =
  | { type: 'IronsSlipped' }
  | { type: 'KeysLifted' }
  | { type: 'CellOpened'; how: 'keys' | 'pick' | 'jailer' | 'promise' }
  | { type: 'CellLocked' }
  | { type: 'BarsBanged' }
  | { type: 'Promised'; cents: number }
  | { type: 'LeftCell' }
  /** Dawn: `tried` is false when you never got the door open or left the cell. */
  | { type: 'Dawn'; tried: boolean };

export interface JailbreakOptions {
  model: DistrictModel;
  stealth: Stealth;
  rules: JailbreakRules;
  locks: LocksFile;
  /** Tier 5: irons, no promise. */
  execution: boolean;
  /** What the jailer would take as a promise, cents, or undefined if he won't hear it. */
  promiseCents: number | undefined;
  /** The Poacher's boot pick. */
  bootPick: boolean;
  /** Game seconds the attempt is over. */
  dawnAt: number;
  rng: Rng;
  notice?(text: string): void;
}

export interface JailContext {
  player: CharacterState;
  gameSeconds: number;
}

export interface Jailbreak {
  readonly cell: JailCell;
  readonly inCell: boolean;
  readonly doorOpen: boolean;
  readonly hasKeys: boolean;
  readonly inIrons: boolean;
  /** You've been out of the cell this attempt. */
  readonly left: boolean;
  /** What F does here, if the jailbreak has a use for it. */
  offer(ctx: JailContext): JailOffer | undefined;
  hold01(): number;
  /** F this tick: true when the jailbreak took it. */
  interact(ctx: JailContext, dt: number, down: boolean, pressed: boolean): boolean;
  step(ctx: JailContext, dt: number): void;
  /** The controller's params: in irons you can't move from the spot. */
  params(base: ControllerParams): ControllerParams;
  /** Being seen now is suspicious: out of your cell, always; in it, never. */
  suspect(): boolean;
  on(fn: (e: JailbreakEvent) => void): () => void;
}

/** You can work the cell door from this far. */
const DOOR_REACH_M = 1.7;
/** He's "not looking" when you're more than this off the way he faces. */
const UNSEEN_RAD = 75 * DEG;
/** He comes to the door to look in from this close. */
const LURE_DOOR_M = 1.6;

function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export function createJailbreak(opts: JailbreakOptions): Jailbreak | undefined {
  const { model, stealth, rules } = opts;
  const cell = jailCell(model, rules);
  if (!cell) return undefined;
  const door = cell.door;
  const lock = opts.locks.tiers[String(rules.cellLock) as '1' | '2' | '3'] as LockTier;
  const listeners = new Set<(e: JailbreakEvent) => void>();
  const emit = (e: JailbreakEvent): void => {
    for (const fn of listeners) fn(e);
  };

  // The door of bars, shut: you can see through it, not walk through it.
  const half = door.widthM / 2;
  const leaf: BoxCollider = {
    kind: 'box',
    x: door.x,
    z: door.z,
    halfX: door.alongX ? half : 0.08,
    halfZ: door.alongX ? 0.08 : half,
    yaw: 0,
    minY: door.y,
    maxY: door.y + DOOR_HEIGHT_M,
    blocksSight: false,
  };
  model.colliders.add(leaf);

  let doorOpen = false;
  let openedBy: 'you' | 'jailer' = 'you';
  let hasKeys = false;
  let ironsS = opts.execution ? rules.irons.slipS : 0;
  let pickedS = 0;
  let holdS = -1;
  let holdVerb: JailVerb | undefined;
  let bangAgainS = 0;
  let luredS = 0;
  let promised = false;
  let left = false;
  let inCell = true;
  let dawned = false;

  const jailer = (): Guard | undefined => stealth.guard(JAILER_ID);
  const within = (p: { x: number; z: number }): boolean =>
    p.x > cell.minX && p.x < cell.maxX && p.z > cell.minZ && p.z < cell.maxZ;
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
    Math.hypot(a.x - b.x, a.z - b.z);
  /** Whether a man standing at `g` facing his way would have `p` in front of him. */
  const looking = (g: Guard, p: { x: number; z: number }): boolean => {
    const to = Math.atan2(p.x - g.body.position.x, -(p.z - g.body.position.z));
    const off = Math.atan2(Math.sin(to - g.body.heading), Math.cos(to - g.body.heading));
    return Math.abs(off) < UNSEEN_RAD;
  };
  const open = (how: 'keys' | 'pick' | 'jailer' | 'promise'): void => {
    doorOpen = true;
    openedBy = how === 'jailer' ? 'jailer' : 'you';
    leaf.disabled = true;
    emit({ type: 'CellOpened', how });
  };
  const pickNeedS = (): number => lock.pickS / opts.locks.bootPick.speed;

  const offer = (ctx: JailContext): JailOffer | undefined => {
    const p = ctx.player.position;
    if (ironsS > 0) {
      return {
        verb: 'irons',
        label: 'Slip the irons',
        ok: true,
        holdS: rules.irons.slipS,
        done01: 1 - ironsS / rules.irons.slipS,
      };
    }
    if (!inCell || doorOpen) return undefined;
    const j = jailer();
    const standing = j && (j.state === 'patrol' || j.state === 'bribed');
    if (j && standing && !hasKeys && dist(j.body.position, p) <= rules.keys.reachM) {
      const unseen = !looking(j, p);
      return {
        verb: 'keys',
        label: 'Lift the keys from his belt',
        ok: unseen,
        ...(unseen ? {} : { why: "He's looking at you" }),
        holdS: rules.keys.liftS,
        done01: 0,
      };
    }
    if (dist(door, p) <= DOOR_REACH_M) {
      if (hasKeys) {
        return { verb: 'unlock', label: 'Unlock the cell door', ok: true, holdS: 0, done01: 0 };
      }
      if (opts.bootPick) {
        const need = pickNeedS();
        return {
          verb: 'pick',
          label: `Pick the cell lock (tier ${rules.cellLock})`,
          ok: true,
          holdS: need,
          done01: Math.min(1, pickedS / need),
        };
      }
    }
    if (
      j &&
      j.state === 'patrol' &&
      !opts.execution &&
      !promised &&
      dist(j.body.position, p) <= rules.promise.talkM
    ) {
      const cents = opts.promiseCents;
      return cents !== undefined
        ? {
            verb: 'promise',
            label: `Promise the jailer ${dollars(cents)} from your stash`,
            ok: true,
            holdS: 0,
            done01: 0,
          }
        : {
            verb: 'promise',
            label: 'Promise the jailer money',
            ok: false,
            why: "He won't hear it from a man wanted for what you are",
            holdS: 0,
            done01: 0,
          };
    }
    return {
      verb: 'bang',
      label: 'Bang on the bars',
      ok: bangAgainS <= 0,
      ...(bangAgainS > 0 ? { why: 'Give it a moment' } : {}),
      holdS: 0,
      done01: 0,
    };
  };

  const done = (verb: JailVerb, ctx: JailContext): void => {
    const p = ctx.player.position;
    switch (verb) {
      case 'irons':
        ironsS = 0;
        emit({ type: 'IronsSlipped' });
        opts.notice?.('The irons are off');
        return;
      case 'keys':
        hasKeys = true;
        emit({ type: 'KeysLifted' });
        opts.notice?.('You have his keys. Wait till he moves off.');
        return;
      case 'unlock':
        open('keys');
        opts.notice?.('The lock turns');
        return;
      case 'pick':
        open('pick');
        opts.notice?.('The lock gives');
        return;
      case 'promise': {
        const cents = opts.promiseCents;
        if (cents === undefined) return;
        promised = true;
        stealth.bribe(JAILER_ID, opts.dawnAt);
        open('promise');
        emit({ type: 'Promised', cents });
        opts.notice?.(`He turns the key and looks the other way. You owe him ${dollars(cents)}.`);
        return;
      }
      case 'bang':
        bangAgainS = rules.bang.cooldownS;
        luredS = 40;
        stealth.noise({
          kind: 'distraction',
          x: p.x,
          y: p.y + 1,
          z: p.z,
          radiusM: rules.bang.radiusM,
          source: 'player',
        });
        emit({ type: 'BarsBanged' });
        return;
    }
  };

  return {
    cell,
    get inCell() {
      return inCell;
    },
    get doorOpen() {
      return doorOpen;
    },
    get hasKeys() {
      return hasKeys;
    },
    get inIrons() {
      return ironsS > 0;
    },
    get left() {
      return left;
    },
    offer,
    hold01() {
      if (holdS < 0 || !holdVerb) return 0;
      if (holdVerb === 'irons') return 1 - ironsS / rules.irons.slipS;
      if (holdVerb === 'pick') return Math.min(1, pickedS / pickNeedS());
      return Math.min(1, holdS / rules.keys.liftS);
    },
    interact(ctx, dt, down, pressed) {
      const o = offer(ctx);
      if (!o) {
        holdS = -1;
        holdVerb = undefined;
        return false;
      }
      if (pressed && o.ok) {
        if (o.holdS > 0) {
          holdS = 0;
          holdVerb = o.verb;
        } else done(o.verb, ctx);
        return true;
      }
      if (holdS >= 0 && holdVerb) {
        if (!down || !o.ok || o.verb !== holdVerb) {
          holdS = -1;
          holdVerb = undefined;
          return true;
        }
        holdS += dt;
        // The irons and a lock keep the work you've done; his keys you start again.
        if (holdVerb === 'irons') {
          ironsS = Math.max(0, ironsS - dt);
          if (ironsS <= 0) {
            done('irons', ctx);
            holdS = -1;
          }
        } else if (holdVerb === 'pick') {
          pickedS += dt;
          if (opts.rng.chance(lock.clickPerS * dt)) {
            const p = ctx.player.position;
            stealth.noise({
              kind: 'lock',
              x: p.x,
              y: p.y + 1,
              z: p.z,
              radiusM: lock.clickM,
              source: 'player',
            });
          }
          if (pickedS >= pickNeedS()) {
            done('pick', ctx);
            holdS = -1;
          }
        } else if (holdS >= o.holdS) {
          done(holdVerb, ctx);
          holdS = -1;
        }
        if (holdS < 0) holdVerb = undefined;
      }
      return true;
    },
    step(ctx, dt) {
      const p = ctx.player.position;
      inCell = within(p);
      if (!inCell && !left) {
        left = true;
        emit({ type: 'LeftCell' });
      }
      bangAgainS = Math.max(0, bangAgainS - dt);
      luredS = Math.max(0, luredS - dt);
      const j = jailer();
      if (j) {
        const at = j.body.position;
        const roused = j.state === 'distracted' || j.state === 'suspicious' || j.state === 'search';
        // Come to see what the row is, he unlocks the door to look in.
        if (!doorOpen && luredS > 0 && roused && dist(at, door) < LURE_DOOR_M) {
          open('jailer');
          opts.notice?.('The jailer unlocks the door to see what the row is');
        }
        // Satisfied, he locks it behind him: if you're still inside, and he's out.
        if (
          doorOpen &&
          openedBy === 'jailer' &&
          (j.state === 'return' || j.state === 'patrol') &&
          inCell &&
          !within(at)
        ) {
          doorOpen = false;
          leaf.disabled = false;
          emit({ type: 'CellLocked' });
          opts.notice?.('The jailer locks you in again');
        }
      }
      if (!dawned && ctx.gameSeconds >= opts.dawnAt) {
        dawned = true;
        emit({ type: 'Dawn', tried: left || doorOpen || hasKeys });
      }
    },
    params(base) {
      return ironsS > 0
        ? { ...base, sneakSpeed: 0, walkSpeed: 0, runSpeed: 0, jumpSpeed: 0 }
        : base;
    },
    suspect: () => !inCell,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
