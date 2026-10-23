import { describe, expect, it } from 'vitest';
import { FollowCamera } from '../src/gameplay/onfoot/camera';
import {
  ColliderSet,
  footprintDistance,
  OccupancyGrid,
  type Collider,
} from '../src/gameplay/onfoot/colliders';
import {
  createCharacter,
  DEFAULT_CONTROLLER,
  stepCharacter,
  type CharacterState,
  type MoveInput,
  type OnFootZone,
} from '../src/gameplay/onfoot/controller';
import { Heightfield } from '../src/gameplay/onfoot/heightfield';
import { createSpikeChunk } from '../src/debug/onfoot-spike/chunk';

const DT = 1 / 60;
const NORTH = 0;
const EAST = Math.PI / 2;

/** A 64 m square heightfield centred on the origin, from a height function. */
function field(height: (x: number, z: number) => number): Heightfield {
  const n = 65;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) heights[j * n + i] = height(i - 32, j - 32);
  return new Heightfield(n, n, 1, -32, -32, heights);
}

function zone(
  colliders: Collider[] = [],
  height: (x: number, z: number) => number = () => 0,
  waterLevel = -10,
): OnFootZone {
  const set = new ColliderSet();
  for (const c of colliders) set.add(c);
  return { ground: field(height), colliders: set, waterLevel };
}

function box(
  x: number,
  z: number,
  sx: number,
  sz: number,
  minY: number,
  maxY: number,
  yaw = 0,
): Collider {
  return { kind: 'box', x, z, halfX: sx / 2, halfZ: sz / 2, yaw, minY, maxY };
}

const forward: MoveInput = { forward: 1, right: 0, run: false, crouch: false };

function run(
  s: CharacterState,
  z: OnFootZone,
  seconds: number,
  input: MoveInput = forward,
  yaw = NORTH,
  dt = DT,
): void {
  for (let t = 0; t < seconds; t += dt) stepCharacter(s, input, yaw, z, dt);
}

describe('Heightfield', () => {
  it('interpolates bilinearly and reports the uphill gradient', () => {
    const g = field((x, z) => 0.5 * x + 0.25 * z);
    expect(g.heightAt(1.5, 2.25)).toBeCloseTo(0.75 + 0.5625);
    const grad = g.gradientAt(3.3, -7.1, { x: 0, z: 0 });
    expect(grad.x).toBeCloseTo(0.5);
    expect(grad.z).toBeCloseTo(0.25);
    expect(g.slopeAt(0, 0)).toBeCloseTo(Math.atan(Math.hypot(0.5, 0.25)));
  });

  it('clamps outside the grid', () => {
    const g = field((x) => x);
    expect(g.heightAt(1000, 0)).toBe(32);
    expect(g.heightAt(-1000, 0)).toBe(-32);
  });
});

describe('colliders', () => {
  it('measures signed distance to a rotated box', () => {
    // A 2 × 4 box turned 90°: its long side now runs east-west.
    const b = box(0, 0, 2, 4, 0, 1, Math.PI / 2);
    const out = { nx: 0, nz: 0 };
    expect(footprintDistance(b, 3, 0, out)).toBeCloseTo(1);
    expect(out.nx).toBeCloseTo(1);
    expect(footprintDistance(b, 0, 2, out)).toBeCloseTo(1);
    expect(out.nz).toBeCloseTo(1);
    expect(footprintDistance(b, 0, 0.8, out)).toBeCloseTo(-0.2);
    expect(out.nz).toBeCloseTo(1);
  });

  it('measures distance to a cylinder', () => {
    const out = { nx: 0, nz: 0 };
    const d = footprintDistance(
      { kind: 'cylinder', x: 1, z: 1, radius: 0.5, minY: 0, maxY: 1 },
      1,
      3,
      out,
    );
    expect(d).toBeCloseTo(1.5);
    expect(out.nz).toBeCloseTo(1);
  });

  it('returns each nearby collider once, plus occupied grid cells', () => {
    const set = new ColliderSet(2);
    const wide = box(0, 0, 10, 1, 0, 1);
    set.add(wide);
    set.add(box(30, 30, 1, 1, 0, 1));
    const grid = new OccupancyGrid(4, -1, 1, 3, 2, 0);
    grid.set(0, 0, 2);
    set.addGrid(grid);

    const out: Collider[] = [];
    set.query(3, 0, 2, out);
    expect(out.filter((c) => c === wide)).toHaveLength(1);
    expect(out).toHaveLength(2);
    const cell = out.find((c) => c !== wide);
    expect(cell).toMatchObject({ kind: 'box', x: 4.5, z: -0.5, maxY: 2 });
  });
});

describe('character controller', () => {
  it('walks at walking speed relative to the camera, and runs faster', () => {
    const z = zone();
    const s = createCharacter({ x: 0, y: 0, z: 0 });
    run(s, z, 1, forward, EAST);
    expect(s.grounded).toBe(true);
    expect(s.velocity.x).toBeCloseTo(DEFAULT_CONTROLLER.walkSpeed);
    expect(s.position.z).toBeCloseTo(0);
    expect(s.heading).toBeCloseTo(EAST);
    expect(s.gait).toBe('walk');

    run(s, z, 1, { ...forward, run: true }, EAST);
    expect(s.velocity.x).toBeCloseTo(DEFAULT_CONTROLLER.runSpeed);
    expect(s.gait).toBe('run');
  });

  it('stops at a wall and slides along it', () => {
    // Wall across the path, 3 m north.
    const z = zone([box(0, -3, 10, 0.4, 0, 3)]);
    const s = createCharacter({ x: 0, y: 0, z: 0 });
    run(s, z, 3);
    expect(s.position.z).toBeCloseTo(-3 + 0.2 + DEFAULT_CONTROLLER.radius, 2);

    // Moving diagonally into it keeps the sideways part.
    run(s, z, 1, { forward: 1, right: 1, run: false, crouch: false });
    expect(s.position.x).toBeGreaterThan(1);
    expect(s.position.z).toBeCloseTo(-3 + 0.2 + DEFAULT_CONTROLLER.radius, 2);
  });

  it('does not tunnel through a thin wall at a low tick rate', () => {
    const z = zone([box(0, -3, 10, 0.05, 0, 3)]);
    const s = createCharacter({ x: 0, y: 0, z: 0 });
    run(s, z, 3, { ...forward, run: true }, NORTH, 1 / 10);
    expect(s.position.z).toBeGreaterThan(-3);
  });

  it('walks up steps lower than the step height and is blocked by taller ledges', () => {
    const z = zone([box(0, -2, 4, 1, 0, 0.3), box(0, -3, 4, 1, 0, 0.6), box(0, -4, 4, 1, 0, 1.4)]);
    const s = createCharacter({ x: 0, y: 0, z: 0 });
    run(s, z, 4);
    // Up 0.3 then 0.6 (another 0.3), then blocked by the 0.8 rise to 1.4.
    expect(s.position.y).toBeCloseTo(0.6);
    expect(s.position.z).toBeCloseTo(-3.5 + DEFAULT_CONTROLLER.radius, 2);
  });

  it('follows the ground down and falls off a high ledge', () => {
    const z = zone([box(0, -1, 4, 2, 0, 3)]);
    const s = createCharacter({ x: 0, y: 3, z: -1.5 });
    run(s, z, 0.1, forward, NORTH);
    expect(s.grounded).toBe(true);
    expect(s.position.y).toBe(3);
    run(s, z, 0.3, forward, NORTH);
    expect(s.grounded).toBe(false);
    expect(s.gait).toBe('fall');
    run(s, z, 1.5, forward, NORTH);
    expect(s.grounded).toBe(true);
    expect(s.position.y).toBe(0);
  });

  it('crouches under an overhang and cannot stand up beneath it', () => {
    const z = zone([box(0, -3, 4, 2, 1.3, 1.6)]);
    const standing = createCharacter({ x: 0, y: 0, z: 0 });
    run(standing, z, 2);
    expect(standing.position.z).toBeGreaterThan(-2);

    const s = createCharacter({ x: 0, y: 0, z: 0 });
    run(s, z, 2.8, { ...forward, crouch: true });
    expect(s.position.z).toBeLessThan(-3);
    expect(s.gait).toBe('sneak');
    run(s, z, 0.5, { forward: 0, right: 0, run: false, crouch: false });
    expect(s.crouching).toBe(true);
  });

  it('cannot climb terrain steeper than the slope limit', () => {
    // A 60° wall of terrain rising north of z = -4.
    const z = zone([], (_x, zz) => (zz < -4 ? (-4 - zz) * Math.tan(Math.PI / 3) : 0));
    const s = createCharacter({ x: 0, y: 0, z: 0 });
    run(s, z, 4);
    expect(s.position.z).toBeGreaterThan(-5);
    expect(s.position.y).toBeLessThan(1.5);
  });

  it('climbs terrain gentler than the slope limit', () => {
    const z = zone([], (_x, zz) => (zz < -4 ? (-4 - zz) * Math.tan(Math.PI / 6) : 0));
    const s = createCharacter({ x: 0, y: 0, z: 0 });
    run(s, z, 4);
    expect(s.position.z).toBeLessThan(-8);
    expect(s.grounded).toBe(true);
    expect(s.position.y).toBeCloseTo(z.ground.heightAt(s.position.x, s.position.z), 3);
  });

  it('swims in deep water and walks out where it is shallow', () => {
    // The lake bed shelves from 3 m deep in the south up to dry land in the north.
    const z = zone([], (_x, zz) => -zz * 0.25, 0);
    const s = createCharacter({ x: 0, y: -5, z: 20 });
    run(s, z, 0.2);
    expect(s.swimming).toBe(true);
    expect(s.position.y).toBeCloseTo(-DEFAULT_CONTROLLER.swimDepth);
    expect(s.gait).toBe('swim');
    run(s, z, 30);
    expect(s.swimming).toBe(false);
    expect(s.grounded).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const make = (): CharacterState => {
      const z = zone([
        box(1, -3, 2, 2, 0, 0.35, 0.4),
        { kind: 'cylinder', x: -1, z: -6, radius: 0.4, minY: 0, maxY: 5 },
      ]);
      const s = createCharacter({ x: 0, y: 0, z: 0 });
      for (let i = 0; i < 600; i++) {
        const input = {
          forward: 1,
          right: Math.sin(i / 40),
          run: i % 200 > 100,
          crouch: i % 300 > 250,
        };
        stepCharacter(s, input, i / 300, z, DT);
      }
      return s;
    };
    expect(make()).toEqual(make());
  });
});

describe('follow camera', () => {
  it('pulls the boom in in front of a wall and eases back out', () => {
    const feet = { x: 0, y: 0, z: 0 };
    const open = zone();
    const cam = new FollowCamera();
    cam.pitch = 0;
    cam.update(feet, false, open, 1 / 60);
    // Looking north, the camera sits behind (south of) the character.
    expect(cam.position.z).toBeCloseTo(cam.params.distance);

    const walled = zone([box(0, 1.5, 10, 0.4, 0, 4)]);
    cam.update(feet, false, walled, 1 / 60);
    expect(cam.position.z).toBeLessThan(1.3);

    for (let i = 0; i < 120; i++) cam.update(feet, false, open, 1 / 60);
    expect(cam.position.z).toBeCloseTo(cam.params.distance);
  });

  it('clamps pitch', () => {
    const cam = new FollowCamera();
    cam.look(0, 1e6);
    expect(cam.pitch).toBe(cam.params.maxPitch);
    cam.look(0, -1e6);
    expect(cam.pitch).toBe(cam.params.minPitch);
  });
});

describe('spike S5 chunk', () => {
  // Walk up-slope across the north-east cliff band, at the gully and away from it.
  function climb(along: number): number {
    const chunk = createSpikeChunk();
    const x = (6 + along) / Math.SQRT2;
    const z = (along - 6) / Math.SQRT2;
    const s = createCharacter({ x, y: chunk.ground.heightAt(x, z) + 0.1, z });
    for (let i = 0; i < 600; i++) stepCharacter(s, forward, Math.PI / 4, chunk, DT);
    return (s.position.x - s.position.z) / Math.SQRT2 - 14;
  }

  it('lets you up the gully but not the cliff', () => {
    expect(climb(2)).toBeGreaterThan(5);
    expect(climb(20)).toBeLessThan(1);
  });
});
