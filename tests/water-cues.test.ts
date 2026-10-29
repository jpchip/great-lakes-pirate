import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { R_SAILING } from '../src/core/time';
import { GridField } from '../src/sim/terrain/grid-field';
import { createLocalWeather, weatherPreset } from '../src/sim/weather/local-weather';
import {
  bakeShore,
  decodeDepth,
  decodeShore,
  encodeDepth,
  encodeShore,
} from '../src/render/water/shore';
import {
  TRAIL_POINTS,
  TRAIL_STYLES,
  Trail,
  type TrailPoint,
  WEDGE_ANGLE,
  measureWaterline,
  wakeStrength,
} from '../src/render/water/wake';
import { createWaterMaterial } from '../src/render/water/water-material';
import { GUST_SAMPLES, createWindCues, windFlowMs } from '../src/render/water/wind-cues';

const field = (f: (i: number, j: number) => number): GridField => {
  const values = new Float32Array(6 * 5);
  for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) values[j * 6 + i] = f(i, j);
  return new GridField(-20, -16, 8, 6, 5, values);
};

describe('shore texture', () => {
  it('keeps shallow depths sharp and shore distances to half a meter', () => {
    for (const d of [0, 0.5, 1.5, 4, 9]) {
      expect(Math.abs(decodeDepth(encodeDepth(d)) - d)).toBeLessThan(0.05 + d * 0.03);
    }
    expect(decodeDepth(encodeDepth(500))).toBeCloseTo(32);
    expect(decodeDepth(encodeDepth(-3))).toBe(0);
    for (const s of [-10, 0, 2.5, 12, 40]) {
      expect(Math.abs(decodeShore(encodeShore(s)) - s)).toBeLessThanOrEqual(0.26);
    }
  });

  it('bakes depth and shore distance, with open water round the edge', () => {
    const seabed = field((i) => 4 - 3 * i); // land at i = 0, 1
    const shoreline = field((i) => 8 * i - 10);
    const g = bakeShore(seabed, shoreline);
    expect([g.width, g.height, g.step, g.x0, g.z0]).toEqual([6, 5, 8, -20, -16]);
    const at = (i: number, j: number, c: number): number => g.data[(j * 6 + i) * 2 + c] ?? -1;
    expect(decodeDepth(at(1, 2, 0))).toBe(0);
    expect(decodeDepth(at(3, 2, 0))).toBeCloseTo(5, 0);
    expect(decodeShore(at(2, 2, 1))).toBeCloseTo(6, 0);
    for (const [i, j] of [
      [0, 0],
      [5, 2],
      [2, 4],
    ] as const) {
      expect(at(i, j, 0)).toBe(255);
      expect(at(i, j, 1)).toBe(255);
    }
  });

  it('refuses grids on different frames', () => {
    const other = new GridField(0, 0, 8, 6, 5, new Float32Array(30));
    expect(() =>
      bakeShore(
        field(() => 0),
        other,
      ),
    ).toThrow(RangeError);
  });
});

describe('wake trails', () => {
  it('lays points by distance and drops them when they die', () => {
    const trail = new Trail(TRAIL_STYLES.stern);
    // 10 m/s along +x for 4 s at 60 fps.
    for (let f = 0; f <= 240; f++) trail.update(f / 60, (f / 60) * 10, 0, 10, 0, 0);
    const pts = trail.points;
    expect(pts.length).toBeGreaterThan(12);
    expect(pts.length).toBeLessThanOrEqual(TRAIL_POINTS);
    for (let i = 1; i < pts.length; i++) {
      const gap = (pts[i]?.x ?? 0) - (pts[i - 1]?.x ?? 0);
      expect(gap).toBeGreaterThanOrEqual(2.5 - 1e-9);
      expect(gap).toBeLessThan(3);
    }
    // Stop; after a lifetime everything laid while moving is gone.
    for (let f = 0; f <= 600; f++) trail.update(4 + f / 60, 40, 0, 0, 0, 0);
    expect(pts.every((p) => p.strength === 0)).toBe(true);
  });

  it('never holds more than its budget, even at speed', () => {
    const trail = new Trail(TRAIL_STYLES.stern);
    for (let f = 0; f <= 1200; f++) trail.update(f / 60, (f / 60) * 40, 0, 40, 0, 0);
    expect(trail.points.length).toBeLessThanOrEqual(TRAIL_POINTS);
    // The trail still covers about its lifetime of track.
    const first = trail.points[0]?.x ?? 0;
    const last = trail.points[trail.points.length - 1]?.x ?? 0;
    expect(last - first).toBeGreaterThan(40 * TRAIL_STYLES.stern.lifetime * 0.9);
  });

  it('spreads a bow-wave arm at the wedge angle', () => {
    const trail = new Trail(TRAIL_STYLES.starboard);
    const v = 10;
    const spread = v * Math.tan(WEDGE_ANGLE);
    for (let f = 0; f <= 180; f++) trail.update(f / 60, 0, -(f / 60) * v, v, spread, 0);
    const now = 3;
    const oldest = trail.positionAt(trail.points[0] as TrailPoint, now, { x: 0, z: 0 });
    const head = { x: 0, z: -now * v };
    const angle = Math.atan2(oldest.x - head.x, oldest.z - head.z);
    expect(angle).toBeCloseTo(WEDGE_ANGLE, 1);
  });

  it('has no wake going astern and a full one at 20 visual knots', () => {
    expect(wakeStrength(-3)).toBe(0);
    expect(wakeStrength(0)).toBe(0);
    expect(wakeStrength(5)).toBeGreaterThan(0.3);
    expect(wakeStrength(10)).toBe(1);
  });

  it('measures the hull at the waterline, not the bowsprit', () => {
    const group = new THREE.Group();
    // A flat waterline outline 6 × 30 m, and a bowsprit up at the rail.
    const waterline = new THREE.Mesh(new THREE.PlaneGeometry(6, 30).rotateX(-Math.PI / 2));
    const bowsprit = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 10));
    bowsprit.position.set(0, 3, -20);
    group.add(waterline, bowsprit);
    const m = measureWaterline(group);
    expect(m.bowZ).toBeCloseTo(-15);
    expect(m.sternZ).toBeCloseTo(15);
    expect(m.beam).toBeCloseTo(6);
  });
});

describe('wind cues', () => {
  it('move the air at the same scene speed as ships', () => {
    // 10 kn is 5.14 m/s; R / C = 24 / 8 = 3.
    expect(windFlowMs(10)).toBeCloseTo(15.43, 1);
  });

  it('show the gusts that are coming, one per second upwind', () => {
    const weather = createLocalWeather(weatherPreset('fresh'));
    const material = createWaterMaterial();
    const cues = createWindCues(material.uniforms, weather);
    const at = { x: 100, z: -50 };
    const t = 3600;
    cues.update(at, t, 10);
    const u = material.uniforms;
    for (let k = 0; k < GUST_SAMPLES; k++) {
      expect(u.uGustAhead.value[k]).toBeCloseTo(weather.windAt(at, t + k * R_SAILING).gust01, 5);
    }
    const wind = weather.windAt(at, t);
    expect(u.uGustOrigin.value.z).toBeCloseTo(windFlowMs(wind.speedKn), 5);
    // The air moves away from where the wind comes from.
    expect(u.uWindDir.value.x).toBeCloseTo(-Math.sin(wind.fromRad), 5);
    expect(u.uWindDir.value.y).toBeCloseTo(Math.cos(wind.fromRad), 5);
    expect(u.uCatsPaws.value).toBe(1);

    // The patches drift with the wind's flow, not jump when it changes.
    cues.update(at, t + 4.8, 10.2);
    expect(u.uWindOffset.value).toBeCloseTo(windFlowMs(wind.speedKn) * 0.2, 0);
    cues.enabled = false;
    cues.update(at, t + 48, 11);
    expect(u.uCatsPaws.value).toBe(0);
  });

  it("drop the cat's-paws for the preset but keep the streaks in a blow", () => {
    const weather = createLocalWeather(weatherPreset('gale'));
    const material = createWaterMaterial();
    const cues = createWindCues(material.uniforms, weather);
    const u = material.uniforms;
    cues.catsPaws = false;
    cues.update({ x: 0, z: 0 }, 3600, 10);
    expect(u.uCatsPaws.value).toBe(0);
    expect(u.uStreaks.value).toBeGreaterThan(0);
    cues.enabled = false;
    cues.update({ x: 0, z: 0 }, 3610, 11);
    expect(u.uStreaks.value).toBe(0);
  });
});
