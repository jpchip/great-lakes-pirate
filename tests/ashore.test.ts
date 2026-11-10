import { describe, expect, it } from 'vitest';
import { buildAshoreScene, beachStep, gangwayAt } from '../src/gameplay/onfoot/ashore-scene';
import { roofOver } from '../src/gameplay/onfoot/camera';
import { ColliderSet, type Collider } from '../src/gameplay/onfoot/colliders';
import {
  climbDownLadder,
  createCharacter,
  DEFAULT_CONTROLLER,
  ladderTopNear,
  stepCharacter,
  type CharacterState,
  type Ladder,
  type MoveInput,
  type OnFootZone,
} from '../src/gameplay/onfoot/controller';
import { Heightfield } from '../src/gameplay/onfoot/heightfield';
import {
  coldDrainPerS,
  DEADLY_FALL_MS,
  fallDamage,
  heal,
  MAX_HEALTH,
  SAFE_FALL_MS,
  secondsToDrown,
} from '../src/sim/ashore/body';
import {
  createRowboat,
  launchRefusal,
  ROWBOAT,
  stepRowboat,
  swamped,
} from '../src/sim/ashore/rowboat';
import type { PlacedPier } from '../src/sim/harbors';

const DT = 1 / 60;
const NORTH = 0;
const forward: MoveInput = { forward: 1, right: 0, run: false, crouch: false };
const still: MoveInput = { forward: 0, right: 0, run: false, crouch: false };
const back: MoveInput = { forward: -1, right: 0, run: false, crouch: false };

function zone(
  colliders: Collider[] = [],
  height: (x: number, z: number) => number = () => 0,
  waterLevel = -10,
  ladders: Ladder[] = [],
): OnFootZone {
  const n = 65;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) heights[j * n + i] = height(i - 32, j - 32);
  const set = new ColliderSet();
  for (const c of colliders) set.add(c);
  return {
    ground: new Heightfield(n, n, 1, -32, -32, heights),
    colliders: set,
    waterLevel,
    ladders,
  };
}

function box(
  x: number,
  z: number,
  sx: number,
  sz: number,
  minY: number,
  maxY: number,
  extra: Partial<Collider> = {},
): Collider {
  return {
    kind: 'box',
    x,
    z,
    halfX: sx / 2,
    halfZ: sz / 2,
    yaw: 0,
    minY,
    maxY,
    ...extra,
  } as Collider;
}

function run(s: CharacterState, z: OnFootZone, seconds: number, input: MoveInput = forward): void {
  for (let t = 0; t < seconds; t += DT) stepCharacter(s, input, NORTH, z, DT);
}

const hop: MoveInput = { ...forward, jump: true };

describe('vault and climb spots (plan 08 §3.1)', () => {
  it('vaults onto a waist-high crate marked as a vault spot, but only hops at an unmarked one', () => {
    const crate = (spot?: 'vault'): OnFootZone =>
      zone([box(0, -2, 2, 2, 0, 1.0, spot ? { spot } : {})]);
    const marked = crate('vault');
    const s = createCharacter({ x: 0, y: 0, z: -0.3 });
    run(s, marked, 0.3);
    stepCharacter(s, hop, NORTH, marked, DT);
    expect(s.move?.kind).toBe('vault');
    run(s, marked, 1, still);
    expect(s.move).toBeUndefined();
    expect(s.position.y).toBeCloseTo(1.0, 2);
    expect(s.grounded).toBe(true);

    const plain = crate();
    const p = createCharacter({ x: 0, y: 0, z: -0.3 });
    run(p, plain, 0.3);
    stepCharacter(p, hop, NORTH, plain, DT);
    expect(p.move).toBeUndefined();
    run(p, plain, 1);
    expect(p.position.y).toBeLessThan(0.5);
  });

  it('vaults over a thin fence to the far side', () => {
    const z = zone([box(0, -1.5, 6, 0.15, 0, 1.1, { spot: 'vault' })]);
    const s = createCharacter({ x: 0, y: 0, z: -0.9 });
    run(s, z, 0.1);
    stepCharacter(s, hop, NORTH, z, DT);
    expect(s.move?.kind).toBe('vault');
    run(s, z, 1, still);
    expect(s.position.z).toBeLessThan(-1.8);
    expect(s.position.y).toBeCloseTo(0, 2);
  });

  it('climbs a low roof marked as a climb spot', () => {
    const z = zone([box(0, -3, 4, 4, 0, 2.3, { spot: 'climb' })]);
    const s = createCharacter({ x: 0, y: 0, z: -0.8 });
    run(s, z, 0.2);
    stepCharacter(s, hop, NORTH, z, DT);
    expect(s.move?.kind).toBe('climb');
    run(s, z, 1.5, still);
    expect(s.position.y).toBeCloseTo(2.3, 2);
  });

  it('reports the surface underfoot: a prop, then the terrain', () => {
    const z: OnFootZone = {
      ...zone([box(0, 0, 4, 4, 0, 0.3, { surface: 'stone' })]),
      surfaceAt: () => 'grass',
    };
    const s = createCharacter({ x: 0, y: 0.3, z: 0 });
    run(s, z, 0.1, still);
    expect(s.surface).toBe('stone');
    run(s, z, 1.5);
    expect(s.surface).toBe('grass');
  });
});

describe('ladders (plan 08 §3.1)', () => {
  // A 2 m wall north of the origin with a ladder up its south face; the deck on top.
  const ladder: Ladder = { x: 0, z: -1, facing: NORTH, bottomY: 0, topY: 2, topX: 0, topZ: -1.8 };
  const wall = (): OnFootZone => zone([box(0, -3, 6, 4, 0, 2)], () => 0, -10, [ladder]);

  it('takes hold walking into its foot, climbs to the top and steps off onto the deck', () => {
    const z = wall();
    const s = createCharacter({ x: 0, y: 0, z: 0 });
    run(s, z, 0.5);
    expect(s.ladder).toBe(0);
    expect(s.gait).toBe('ladder');
    run(s, z, 2.5);
    expect(s.ladder).toBeUndefined();
    expect(s.position.y).toBeCloseTo(2, 2);
    expect(s.position.z).toBeLessThan(-1.5);
  });

  it('climbs back down from the top and lets go at the foot', () => {
    const z = wall();
    const s = createCharacter({ x: 0, y: 2, z: -1.8 });
    run(s, z, 0.1, still);
    expect(ladderTopNear(s, z)).toBe(0);
    climbDownLadder(s, z, 0);
    expect(s.ladder).toBe(0);
    run(s, z, 2.5, back);
    expect(s.ladder).toBeUndefined();
    expect(s.grounded).toBe(true);
    expect(s.position.y).toBeCloseTo(0, 2);
  });

  it('lets a swimmer grab a pier-head ladder out of the water', () => {
    const pierLadder: Ladder = {
      x: 0,
      z: -1,
      facing: NORTH,
      bottomY: -1.2,
      topY: 1.8,
      topX: 0,
      topZ: -1.8,
    };
    const z = zone([box(0, -10, 6, 18, -5, 1.8)], () => -5, 0, [pierLadder]);
    const s = createCharacter({ x: 0, y: -1.3, z: 1 });
    run(s, z, 0.2, still);
    expect(s.swimming).toBe(true);
    run(s, z, 1.5);
    expect(s.ladder).toBe(0);
    run(s, z, 4);
    expect(s.ladder).toBeUndefined();
    expect(s.position.y).toBeCloseTo(1.8, 2);
  });
});

describe('falls and the cold (plan 08 §3.3, plan 11 §3.2)', () => {
  it('records the landing speed of a fall off a ledge, and nothing for a hop', () => {
    const z = zone([box(0, 0, 4, 4, 0, 5)]);
    const s = createCharacter({ x: 0, y: 5, z: 0 });
    let landed = 0;
    for (let t = 0; t < 3; t += DT) {
      stepCharacter(s, forward, NORTH, z, DT);
      landed = Math.max(landed, s.landedSpeed);
    }
    expect(s.position.y).toBeCloseTo(0, 2);
    // Five meters at 18 m/s²: about 13 m/s.
    expect(landed).toBeGreaterThan(12);
    expect(fallDamage(landed)).toBeGreaterThan(20);

    const h = createCharacter({ x: 10, y: 0, z: 10 });
    run(h, zone(), 0.1, still);
    let hopLanded = 0;
    stepCharacter(h, { ...still, jump: true }, NORTH, zone(), DT);
    for (let t = 0; t < 1; t += DT) {
      stepCharacter(h, still, NORTH, zone(), DT);
      hopLanded = Math.max(hopLanded, h.landedSpeed);
    }
    expect(fallDamage(hopLanded)).toBe(0);
  });

  it('hurts nothing below the safe speed and kills at the deadly one; water cushions', () => {
    expect(fallDamage(SAFE_FALL_MS)).toBe(0);
    expect(fallDamage(DEADLY_FALL_MS)).toBe(MAX_HEALTH);
    expect(fallDamage(14)).toBeGreaterThan(0);
    expect(fallDamage(14, true)).toBe(0);
  });

  it('drains a swimmer fast in spring water and slowly in August', () => {
    expect(secondsToDrown(100, 4)).toBeLessThan(120);
    expect(secondsToDrown(100, 4)).toBeGreaterThan(60);
    expect(secondsToDrown(100, 17)).toBeGreaterThan(600);
    expect(coldDrainPerS(4)).toBeGreaterThan(coldDrainPerS(12));
  });

  it('heals over two game days, capped at full', () => {
    expect(heal(50, 24 * 3600)).toBeCloseTo(100);
    expect(heal(90, 48 * 3600)).toBe(100);
  });
});

describe('the boat (plan 02 §6.5, plan 08 §20.6 decision 2)', () => {
  // Water 3 m deep south of z = -20, shoaling to a beach that dries at z = -30.
  const depthAt = (_x: number, z: number): number => (z > -20 ? 3 : 3 + (z + 20) * 0.4);

  it('pulls to her top speed, turns, and takes the ground at the beach', () => {
    const b = createRowboat(0, 0, NORTH);
    for (let t = 0; t < 8; t += DT) stepRowboat(b, { pull: 1, turn: 0 }, { depthAt }, DT);
    expect(b.speed).toBeGreaterThan(ROWBOAT.pullMs * 0.9);
    for (let t = 0; t < 20; t += DT) stepRowboat(b, { pull: 1, turn: 0 }, { depthAt }, DT);
    expect(b.beached).toBe(true);
    expect(b.speed).toBe(0);
    // Her bow sits where the water is beach-shallow.
    expect(depthAt(0, b.z - ROWBOAT.lengthM / 2)).toBeLessThan(ROWBOAT.beachDepthM + 0.05);
    // She backs off again.
    for (let t = 0; t < 2; t += DT) stepRowboat(b, { pull: -1, turn: 0 }, { depthAt }, DT);
    expect(b.beached).toBe(false);
  });

  it('turns with the oars even when stopped', () => {
    const b = createRowboat(0, 0, NORTH);
    for (let t = 0; t < 2; t += DT) stepRowboat(b, { pull: 0, turn: 1 }, { depthAt: () => 5 }, DT);
    expect(b.heading).toBeGreaterThan(0.5);
  });

  it("won't go over the side in a sea, and swamps in a bigger one", () => {
    expect(launchRefusal(0.4)).toBeUndefined();
    expect(launchRefusal(1.5)).toMatch(/sea/);
    expect(swamped(1.0)).toBe(false);
    expect(swamped(2.0)).toBe(true);
  });
});

describe('the ashore scene (plan 03 §7)', () => {
  // Land north of z = -40, water south of it; a pier runs out south from the shore.
  const heightAt = (_x: number, z: number): number => (z < -40 ? 2 : -0.1 * (z + 40) - 0.5);
  const pier: PlacedPier = {
    id: 'pier.test',
    name: 'test pier',
    root: { x: 0, z: -40 },
    bearing: Math.PI,
    lengthM: 60,
    widthM: 8,
    deckM: 1.8,
    kind: 'city',
    port: undefined,
    site: undefined,
    shoreM: 4,
  } as unknown as PlacedPier;
  const ship = { pose: { x: 8, z: 0, heading: Math.PI }, lengthM: 17, beamM: 5, deckM: 1.2 };
  const scene = buildAshoreScene({
    ground: { heightAt, x0: -1000, z0: -1000, step: 4 },
    center: { x: 0, z: 0 },
    halfSizeM: 100,
    piers: [pier],
    ship,
  });

  it('builds the ground on the terrain grid, the pier deck and a ladder down its head', () => {
    expect(scene.ground.cellSize).toBe(4);
    expect((scene.ground.originX + 1000) % 4).toBe(0);
    expect(scene.ladders).toHaveLength(1);
    expect(scene.ladders[0]?.topY).toBe(1.8);
    expect(scene.ladders[0]?.z).toBeCloseTo(20, 1);
    expect(scene.ship).toBeDefined();
  });

  it('puts the gangway on the deck abreast of the ship, on her side', () => {
    const g = gangwayAt(pier, ship.pose);
    expect(g.y).toBe(1.8);
    expect(g.z).toBeCloseTo(0, 1);
    expect(g.x).toBeGreaterThan(2);
    expect(g.x).toBeLessThan(4);
    // You can stand there.
    const s = createCharacter(g);
    run(s, scene, 0.5, still);
    expect(s.position.y).toBeCloseTo(1.8, 2);
    expect(s.surface).toBe('wood');
  });

  it('lets you walk the pier ashore, but not through the ship', () => {
    const s = createCharacter(gangwayAt(pier, ship.pose));
    // East is the ship: blocked.
    for (let t = 0; t < 2; t += DT) stepCharacter(s, forward, Math.PI / 2, scene, DT);
    expect(s.position.x).toBeLessThan(5.6);
    // (Off the pier's edge and into the gap is your own lookout.) North along the deck to the land.
    const w = createCharacter(gangwayAt(pier, ship.pose));
    for (let t = 0; t < 25; t += DT) stepCharacter(w, forward, NORTH, scene, DT);
    expect(w.position.z).toBeLessThan(-42);
    expect(w.position.y).toBeCloseTo(2, 1);
  });

  it('finds a dry step up the beach from a boat bow, and none under a cliff', () => {
    const beach = (_x: number, z: number): number => -0.1 * (z + 40);
    const step = beachStep(beach, { x: 0, z: -35 }, NORTH);
    expect(step).toBeDefined();
    expect(step?.y).toBeGreaterThan(0.15);
    expect(beachStep(heightAt, { x: 0, z: -35 }, NORTH)).toBeUndefined();
  });

  it('knows a roof overhead from open sky', () => {
    const z = zone([box(0, 0, 4, 4, 2.4, 2.8)]);
    expect(roofOver(z, 0, DEFAULT_CONTROLLER.standHeight, 0)).toBe(true);
    expect(roofOver(z, 5, DEFAULT_CONTROLLER.standHeight, 5)).toBe(false);
  });
});
