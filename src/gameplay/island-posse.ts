import { Rng } from '../core/rng';
import type { PlacedIsland } from '../sim/islands/on-foot';
import type { AshoreScene } from './onfoot/ashore-scene';
import type { CharacterState } from './onfoot/controller';
import {
  gameNpcs,
  MAX_GUARDS,
  rosterForTier,
  tierScaling,
  type GuardSpawn,
  type NpcDefs,
  type Route,
  type Waypoint,
} from './onfoot/guards';
import { LampSet } from './onfoot/light';
import { NavGrid, type XZ } from './onfoot/nav';
import { DEFAULT_CONTROLLER } from './onfoot/controller';
import type { Surface } from './onfoot/colliders';
import { createStealth, isDown, type Stealth, type StealthEvent } from './onfoot/stealth';
import { skyAt } from './onfoot/watch';

/**
 * The marshal posse on a walkable island (plan 08 §20.4 piece H; plan 06 §5.3–5.4; Phase 9
 * piece F, plan 11 §18). At Wanted tier 4 and up, a while after you set foot on an island
 * the marshals of that tier's roster put in where your boat is (the beached rowboat, or the
 * ship at her anchorage) and sweep outward from it in widening arcs, looking and listening
 * with the watch's own perception (`createStealth`). Quiet for long enough, or the sweep
 * walked to its end, they give up, walk back to their landing and put off.
 *
 * A claimed hideout's build bounds are out of their reach: the grid they walk has the
 * bounds cut out of it, so they never set foot there, and with you inside them they
 * neither see nor hear you. A chase or a search that's on when you cross in is broken off
 * (`BrokeOff`), and if a marshal had you in sight as you went in, the place is spotted.
 *
 * The count is the tier's `marshals` in npc_types.json: 1 at tier 4, 2 at tier 5. Tracks
 * in snow (plan 11 §18 piece M) aren't followed yet.
 */

/** Grid cell for the island's navigation, meters: coarser than the district's bake. */
export const ISLAND_NAV_CELL_M = 2;
/** Seconds ashore before the marshals land: tier 4, and tier 5 and up. */
export const LAND_AFTER_S = { notorious: 45, infamous: 25 };
/** The sweep's arcs, meters out from the landing. */
export const SWEEP_RADII_M = [18, 40, 65, 95];
/** Meters between a sweep's stops along an arc. */
const SWEEP_SPACING_M = 22;
/** Seconds at each stop, looking about. */
const SWEEP_WAIT_S = 3;
/** Seconds with nobody suspicious of anything before they give up: tier 4, tier 5 and up. */
export const GIVE_UP_S = { notorious: 240, infamous: 360 };
/** Seconds the walk back to their boat may take before they're simply gone. */
const LEAVE_MAX_S = 150;
/** Close enough to their boat to be aboard, meters. */
const ABOARD_M = 4;
/** A landing whose sweep has no more stops than this leads nowhere (a ledge, a pit). */
const SWEEP_MIN_STOPS = 6;
/** How far from your boat they'll look for dry ground to land on, meters. */
const LANDING_SEARCH_M = 160;

export type PossePhase = 'coming' | 'searching' | 'leaving' | 'gone';

export type PosseEvent =
  | { type: 'PosseLanded'; at: XZ; count: number }
  | { type: 'PosseBrokeOff'; hideout: string; sawIt: boolean }
  | { type: 'PosseGaveUp' }
  | { type: 'PosseLeft' };

export interface PosseConditions {
  gameSeconds: number;
  cloud01: number;
  fogM: number;
  rain01: number;
  wantedTier: number;
  fame01: number;
}

export interface IslandPosseOptions {
  scene: AshoreScene;
  placed: PlacedIsland;
  seed: string;
  conditions(): PosseConditions;
  /** Where your boat lies (the rowboat beached, or the ship), scene meters. */
  boat?(): XZ | undefined;
  /** The claimed hideout whose build bounds hold a scene point, if any. */
  sanctuary?(at: XZ): string | undefined;
}

/** A ring of walkable points round `c`, in order, for a marshal's beat. */
export function beatRoute(nav: NavGrid, c: XZ, radiusM: number, points = 12): Route | undefined {
  const out: Waypoint[] = [];
  for (let k = 0; k < points; k++) {
    const a = (k / points) * Math.PI * 2;
    const p = { x: c.x + Math.sin(a) * radiusM, z: c.z - Math.cos(a) * radiusM };
    if (!nav.walkable(p)) continue;
    out.push({ x: p.x, z: p.z, face: a + Math.PI, waitS: 2 });
  }
  if (out.length < 3) return undefined;
  return { points: out, loop: true };
}

/** Cuts the hideouts' bounds out of the grid: nobody walks there or is sent there. */
export function closeSanctuaries(nav: NavGrid, inside: (at: XZ) => boolean): number {
  let closed = 0;
  for (let r = 0; r < nav.rows; r++) {
    for (let c = 0; c < nav.cols; c++) {
      const i = r * nav.cols + c;
      if (Number.isNaN(nav.floor[i])) continue;
      const at = { x: nav.minX + (c + 0.5) * nav.cellM, z: nav.minZ + (r + 0.5) * nav.cellM };
      if (!inside(at)) continue;
      nav.floor[i] = Number.NaN;
      closed++;
    }
  }
  return closed;
}

/**
 * Where the marshals put in: the dry ground nearest `from` (out to `maxM`) that's the
 * island's own (not a pier, a ledge or a roof) and leads somewhere, `ok` saying which does.
 */
export function landingNear(
  nav: NavGrid,
  ground: { heightAt(x: number, z: number): number },
  waterLevel: number,
  from: XZ,
  ok: (p: XZ) => boolean = () => true,
  maxM = LANDING_SEARCH_M,
): XZ | undefined {
  const step = nav.cellM;
  const good = (p: XZ): boolean => {
    if (!nav.walkable(p)) return false;
    const c = Math.floor((p.x - nav.minX) / nav.cellM);
    const r = Math.floor((p.z - nav.minZ) / nav.cellM);
    const floor = nav.floor[r * nav.cols + c] ?? Number.NaN;
    const h = ground.heightAt(p.x, p.z);
    return h > waterLevel + 0.1 && Math.abs(floor - h) < 0.3 && ok(p);
  };
  if (good(from)) return { x: from.x, z: from.z };
  for (let r = step; r <= maxM; r += step) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p = { x: from.x + Math.sin(a) * r, z: from.z - Math.cos(a) * r };
      if (good(p)) return p;
    }
  }
  return undefined;
}

/**
 * Each marshal's sweep from the landing: the arcs of `SWEEP_RADII_M`, split between them
 * so each takes his own sector, walked back and forth outward (a plough's furrows) with a
 * look about at each stop. Water, the hideouts' bounds and ground no walk from the
 * landing reaches drop out.
 * The first point of each is the landing.
 */
export function sweepRoutes(nav: NavGrid, landing: XZ, marshals: number): Route[] {
  const n = Math.max(1, marshals);
  /** A walk from the landing gets there (not over a cliff, or across water). */
  const reachable = (p: XZ): boolean => {
    const path = nav.findPath(landing, p);
    const end = path?.[path.length - 1];
    return !!end && Math.hypot(end.x - p.x, end.z - p.z) < nav.cellM * 1.5;
  };
  return Array.from({ length: n }, (_, k) => {
    const points: Waypoint[] = [{ x: landing.x, z: landing.z, waitS: SWEEP_WAIT_S }];
    const a0 = (k / n) * Math.PI * 2;
    const span = (Math.PI * 2) / n;
    SWEEP_RADII_M.forEach((r, ring) => {
      const stops = Math.max(3, Math.round((span * r) / SWEEP_SPACING_M));
      const ringPts: Waypoint[] = [];
      for (let s = 0; s < stops; s++) {
        const a = a0 + ((s + 0.5) / stops) * span;
        const p = { x: landing.x + Math.sin(a) * r, z: landing.z - Math.cos(a) * r };
        if (!nav.walkable(p) || !reachable(p)) continue;
        // Facing outward, away from the landing.
        ringPts.push({ x: p.x, z: p.z, face: a, waitS: SWEEP_WAIT_S });
      }
      if (ring % 2 === 1) ringPts.reverse();
      points.push(...ringPts);
    });
    return { points, loop: false };
  });
}

export interface IslandPosse {
  /** Marshals the tier sends to the island (0 below tier 4). */
  readonly count: number;
  /** On its way, searching, walking back to their boat, or gone. */
  readonly phase: PossePhase;
  /** Where they put in, once they have. */
  readonly landing: XZ | undefined;
  /** The marshals ashore: no guards before they land and once they've gone. */
  readonly stealth: Stealth;
  /** A marshal has you: the fade to the lockup is the caller's. */
  readonly captured: boolean;
  /** A marshal is after you: danger, as in the district (no autosave, the chart locked). */
  readonly pursued: boolean;
  /** Seconds until they land (while coming), or of quiet left before they give up. */
  readonly clockS: number;
  step(
    dt: number,
    player: CharacterState,
    suspect: boolean,
    surface?: Surface,
    lean?: { x: number; z: number },
  ): void;
  /** The marshals' voices and steps, from whichever party's ashore. */
  on(fn: (e: StealthEvent) => void): () => void;
  /** Landed, broke off, gave up, put off. */
  onPosse(fn: (e: PosseEvent) => void): () => void;
  /** For the dev hooks: land now (if the tier sends anyone). */
  land(): boolean;
  /** For the dev hooks: give up now and walk back to the boat. */
  giveUp(): void;
}

const pursuing = (s: string): boolean =>
  s === 'alerted' || s === 'search' || s === 'suspicious' || s === 'fetch';

export function createIslandPosse(opts: IslandPosseOptions): IslandPosse | undefined {
  const { scene, placed } = opts;
  if (placed.mainland) return undefined;
  const nav = new NavGrid(scene, {
    minX: scene.bounds.minX,
    minZ: scene.bounds.minZ,
    maxX: scene.bounds.maxX,
    maxZ: scene.bounds.maxZ,
    cellM: ISLAND_NAV_CELL_M,
  });
  if (opts.sanctuary) {
    const inside = opts.sanctuary;
    closeSanctuaries(nav, (at) => inside(at) !== undefined);
  }
  const defs: NpcDefs = gameNpcs();
  const tierNow = (): number => opts.conditions().wantedTier;
  /** The tier's marshals, on the given beats. */
  const roster = (tier: number, beats: Route[]): GuardSpawn[] =>
    rosterForTier(defs, [], beats, tier).filter((g) => g.type === 'npc.marshal');
  const marshalsAt = (tier: number): number =>
    Math.min(MAX_GUARDS, tierScaling(defs, tier).marshals);

  const empty = (): Stealth =>
    createStealth({ zone: scene, nav, lamps: new LampSet([]), rng: Rng.fromSeed('-') }, defs, []);
  let stealth = empty();
  let phase: PossePhase = 'coming';
  let landing: XZ | undefined;
  let sweeps: Route[] = [];
  let ashoreS = 0;
  let quietS = 0;
  let leavingS = 0;
  let wasIn: string | undefined;
  const listeners = new Set<(e: StealthEvent) => void>();
  const posseListeners = new Set<(e: PosseEvent) => void>();
  const emit = (e: PosseEvent): void => {
    for (const fn of posseListeners) fn(e);
  };
  const infamous = (): boolean => tierNow() >= 5;
  const giveUpAfter = (): number => (infamous() ? GIVE_UP_S.infamous : GIVE_UP_S.notorious);
  const landAfter = (): number => (infamous() ? LAND_AFTER_S.infamous : LAND_AFTER_S.notorious);

  const land = (): boolean => {
    if (phase !== 'coming') return false;
    const tier = tierNow();
    const n = marshalsAt(tier);
    if (n === 0) return false;
    const b = scene.bounds;
    const boat = opts.boat?.() ?? { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    // Ground that leads inland: some of the sweep's first arc is in walking reach.
    const leads = (p: XZ): boolean =>
      (sweepRoutes(nav, p, 1)[0]?.points.length ?? 0) > SWEEP_MIN_STOPS;
    const at = landingNear(nav, scene.ground, scene.waterLevel, boat, leads);
    if (!at) return false;
    sweeps = sweepRoutes(nav, at, n);
    const spawns = roster(tier, sweeps);
    stealth = createStealth(
      {
        zone: scene,
        nav,
        lamps: new LampSet([]),
        rng: Rng.fromSeed(`${opts.seed}:posse:${placed.id}`),
      },
      defs,
      spawns,
      tier,
    );
    for (const g of stealth.guards) {
      const p = g.body.position;
      p.y = scene.ground.heightAt(p.x, p.z);
      g.previous.y = p.y;
    }
    stealth.on((e) => {
      for (const fn of listeners) fn(e);
    });
    landing = at;
    phase = 'searching';
    quietS = 0;
    emit({ type: 'PosseLanded', at, count: spawns.length });
    return true;
  };

  const giveUp = (): void => {
    if (phase !== 'searching' || !landing) return;
    phase = 'leaving';
    leavingS = 0;
    const home: Route = { points: [{ x: landing.x, z: landing.z }], loop: false };
    for (const g of stealth.guards) {
      stealth.breakOff(g.id);
      stealth.reroute(g.id, home);
    }
    emit({ type: 'PosseGaveUp' });
  };

  const gone = (): void => {
    phase = 'gone';
    stealth = empty();
    emit({ type: 'PosseLeft' });
  };

  return {
    get count() {
      return phase === 'gone' ? 0 : landing ? stealth.guards.length : marshalsAt(tierNow());
    },
    get phase() {
      return phase;
    },
    get landing() {
      return landing;
    },
    get stealth() {
      return stealth;
    },
    get captured() {
      return stealth.captured;
    },
    get pursued() {
      return stealth.guards.some((g) => g.state === 'alerted' && g.type.pursues);
    },
    get clockS() {
      if (phase === 'coming') return Math.max(0, landAfter() - ashoreS);
      if (phase === 'searching') return Math.max(0, giveUpAfter() - quietS);
      return 0;
    },
    step(dt, player, suspect, surface, lean) {
      if (phase === 'gone') return;
      if (phase === 'coming') {
        ashoreS += dt;
        if (ashoreS >= landAfter()) land();
        return;
      }
      const p = player.position;
      const hideout = opts.sanctuary?.({ x: p.x, z: p.z });
      // Crossing into a hideout's bounds ends a chase or a search (plan 06 §5.4).
      if (hideout && !wasIn) {
        let after = false;
        let sawIt = false;
        for (const g of stealth.guards) {
          if (g.state === 'alerted' || g.state === 'search') after = true;
          if (g.state === 'alerted' && g.glimpse?.seen) sawIt = true;
        }
        if (after) emit({ type: 'PosseBrokeOff', hideout, sawIt });
      }
      if (hideout) for (const g of stealth.guards) stealth.breakOff(g.id);
      wasIn = hideout;
      const c = opts.conditions();
      stealth.step(dt, {
        player,
        playerParams: DEFAULT_CONTROLLER,
        ...(surface ? { surface } : {}),
        sky: skyAt(c.gameSeconds, c.cloud01),
        fogM: c.fogM,
        rain01: c.rain01,
        gameSeconds: c.gameSeconds,
        carrying: false,
        suspect,
        fame01: c.fame01,
        wantedTier: c.wantedTier,
        ...(lean ? { lean } : {}),
        ...(hideout ? { unseen: true } : {}),
      });
      const onto = stealth.guards.some((g) => pursuing(g.state));
      if (phase === 'searching') {
        quietS = onto ? 0 : quietS + dt;
        // The sweep walked to its end: a non-looping beat turns back at its last stop.
        const swept = stealth.guards.every((g) => g.direction === -1 || isDown(g.state));
        if (quietS >= giveUpAfter() || (swept && !onto)) giveUp();
      } else if (phase === 'leaving' && landing) {
        if (onto) {
          // Seen on the way back: the search is on again.
          phase = 'searching';
          quietS = 0;
          stealth.guards.forEach((g, k) => {
            const r = sweeps[k];
            if (r) stealth.reroute(g.id, r);
          });
          return;
        }
        leavingS += dt;
        const home = landing;
        const aboard = stealth.guards.every(
          (g) =>
            Math.hypot(g.body.position.x - home.x, g.body.position.z - home.z) < ABOARD_M ||
            isDown(g.state),
        );
        if (aboard || leavingS >= LEAVE_MAX_S) gone();
      }
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onPosse(fn) {
      posseListeners.add(fn);
      return () => posseListeners.delete(fn);
    },
    land,
    giveUp,
  };
}
