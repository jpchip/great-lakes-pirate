import { Rng } from '../core/rng';
import type { PlacedIsland } from '../sim/islands/on-foot';
import type { AshoreScene } from './onfoot/ashore-scene';
import type { CharacterState } from './onfoot/controller';
import {
  gameNpcs,
  rosterForTier,
  type GuardSpawn,
  type Route,
  type Waypoint,
} from './onfoot/guards';
import { LampSet } from './onfoot/light';
import { NavGrid, type XZ } from './onfoot/nav';
import { DEFAULT_CONTROLLER } from './onfoot/controller';
import type { Surface } from './onfoot/colliders';
import { createStealth, type Stealth } from './onfoot/stealth';
import { skyAt } from './onfoot/watch';

/**
 * The marshal posse on a walkable island (plan 08 §20.4 piece H; plan 08 §5.2): at Wanted
 * tier 4 and up the marshals of that tier's roster walk the island's ground, round the
 * quarry and along the shore, and search for you like the Bayfield watch does. The
 * posse uses the same stealth machinery (`createStealth`) as the district, on the
 * island's built scene and a grid navigation over it, so no district model is needed.
 *
 * The count is the tier's `marshals` in npc_types.json: 1 at tier 4, 2 at tier 5.
 */

/** Grid cell for the island's navigation, meters: coarser than the district's bake. */
export const ISLAND_NAV_CELL_M = 2;
/** The two beats the marshals walk, meters from the quarry's derrick. */
const INNER_RADIUS_M = 24;
const OUTER_RADIUS_M = 44;
const BEAT_POINTS = 12;
const BEAT_WAIT_S = 2;

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
  tier: number;
  seed: string;
  conditions(): PosseConditions;
}

/** A ring of walkable points round `c`, in order, for a marshal's beat. */
export function beatRoute(
  nav: NavGrid,
  c: XZ,
  radiusM: number,
  points = BEAT_POINTS,
): Route | undefined {
  const out: Waypoint[] = [];
  for (let k = 0; k < points; k++) {
    const a = (k / points) * Math.PI * 2;
    const p = { x: c.x + Math.sin(a) * radiusM, z: c.z - Math.cos(a) * radiusM };
    if (!nav.walkable(p)) continue;
    out.push({ x: p.x, z: p.z, face: a + Math.PI, waitS: BEAT_WAIT_S });
  }
  if (out.length < 3) return undefined;
  return { points: out, loop: true };
}

/** The island's marshal beats: the quarry's inner and outer rings, where they're walkable. */
export function posseBeats(nav: NavGrid, placed: PlacedIsland): Route[] {
  const derrick = placed.pieces.find((p) => p.kind === 'derrick');
  if (!derrick) return [];
  const c = { x: derrick.x, z: derrick.z };
  return [INNER_RADIUS_M, OUTER_RADIUS_M]
    .map((r) => beatRoute(nav, c, r))
    .filter((r): r is Route => r !== undefined);
}

export interface IslandPosse {
  /** Marshals on the island at this tier (0 below tier 4). */
  readonly count: number;
  readonly stealth: Stealth;
  /** A marshal has you: the fade to the lockup is the caller's. */
  readonly captured: boolean;
  step(dt: number, player: CharacterState, suspect: boolean, surface?: Surface): void;
}

export function createIslandPosse(opts: IslandPosseOptions): IslandPosse | undefined {
  const { scene, placed, tier } = opts;
  const nav = new NavGrid(scene, {
    minX: scene.bounds.minX,
    minZ: scene.bounds.minZ,
    maxX: scene.bounds.maxX,
    maxZ: scene.bounds.maxZ,
    cellM: ISLAND_NAV_CELL_M,
  });
  const defs = gameNpcs();
  const beats = posseBeats(nav, placed);
  // Marshals only: the tier's roster with no base guards, on the island's beats.
  const roster: GuardSpawn[] = rosterForTier(defs, [], beats, tier).filter(
    (g) => g.type === 'npc.marshal',
  );
  if (roster.length === 0) return undefined;
  const stealth = createStealth(
    {
      zone: scene,
      nav,
      lamps: new LampSet([]),
      rng: Rng.fromSeed(`${opts.seed}:posse:${placed.id}`),
    },
    defs,
    roster,
    tier,
  );
  for (const g of stealth.guards) {
    const p = g.body.position;
    p.y = scene.ground.heightAt(p.x, p.z);
    g.previous.y = p.y;
  }
  return {
    count: roster.length,
    stealth,
    get captured() {
      return stealth.captured;
    },
    step(dt, player, suspect, surface) {
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
      });
    },
  };
}
