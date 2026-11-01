import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLighthouses } from '../src/render/lighthouses/lighthouses';
import { buildStation } from '../src/render/lighthouses/kit';
import { QUALITY_PRESETS } from '../src/render/quality';
import { OutlineSettings } from '../src/render/style/outline';
import { StyleLighting } from '../src/render/style/stylized-material';
import {
  BEAM_HALF_ANGLE_RAD,
  LIGHTHOUSES,
  LIGHT_TIERS,
  beamBearing,
  lightsIn,
  flashSeen,
  lampLevel,
  lightClearing,
  lightRangeM,
  placeLights,
  viewingSpot,
  type LightTerrain,
} from '../src/sim/lighthouses';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame, defFrame, zoneDef } from '../src/sim/terrain/zones';

/** A value that must exist; a missing one fails the test with its own message. */
function need<T>(value: T | null | undefined, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

const byId = (id: string) => {
  const def = LIGHTHOUSES.find((l) => l.id === id);
  if (!def) throw new Error(`no ${id}`);
  return def;
};

describe('the 1900 lights (R1 §2.1)', () => {
  it('has the seven lights of the Apostles', () => {
    expect(
      lightsIn('zone.apostles')
        .map((l) => l.id)
        .sort(),
    ).toEqual([
      'light.chequamegon',
      'light.devils',
      'light.lapointe',
      'light.michigan',
      'light.outer',
      'light.raspberry',
      'light.sand',
    ]);
  });

  it('shows each light as it did at night in spring 1900', () => {
    expect(byId('light.raspberry').characteristic).toEqual({
      kind: 'flashing',
      color: 'white',
      periodS: 90,
    });
    expect(byId('light.outer').characteristic).toEqual({
      kind: 'flashing',
      color: 'white',
      periodS: 90,
    });
    expect(byId('light.sand').characteristic).toEqual({ kind: 'fixed', color: 'white' });
    // Devils Island's 3rd-order lens doesn't arrive until 1901: a temporary fixed red.
    expect(byId('light.devils').characteristic).toEqual({ kind: 'fixed', color: 'red' });
  });

  it('has the Twin Ports and Two Harbors lights of 1900 (Phase 3 piece I)', () => {
    expect(
      lightsIn('zone.twin_ports')
        .map((l) => l.id)
        .sort(),
    ).toEqual(['light.duluth_south_pier', 'light.minnesota_point', 'light.superior_entry']);
    expect(lightsIn('zone.two_harbors').map((l) => l.id)).toEqual(['light.two_harbors']);
    // The canal's south pier light is a temporary tower while the pier is rebuilt, and
    // both entry lights stand on their piers' ends.
    expect(byId('light.duluth_south_pier').pier).toBe('pier.duluth_canal_south');
    expect(byId('light.duluth_south_pier').tier).toBe('weak');
    expect(byId('light.superior_entry').pier).toBe('pier.superior_entry_south');
    // Two Harbors: the red-brick station with its 4th-order lens.
    expect(byId('light.two_harbors').tier).toBe('medium');
    expect(byId('light.two_harbors').tower.finish).toBe('brick');
    // Minnesota Point stands dark: extinguished in 1885, no keeper, no signal.
    const dark = byId('light.minnesota_point');
    expect(dark.lit).toBe(false);
    expect(dark.keepers).toBe(0);
    expect(dark.fogSignal).toBeUndefined();
    expect(LIGHTHOUSES.filter((l) => !l.lit).map((l) => l.id)).toEqual(['light.minnesota_point']);
  });

  it('gives the strong lens the longest reach and the temporary light the shortest', () => {
    expect(byId('light.outer').tier).toBe('strong');
    expect(byId('light.devils').tier).toBe('weak');
    expect(lightRangeM(byId('light.outer'))).toBeGreaterThan(lightRangeM(byId('light.sand')));
    expect(lightRangeM(byId('light.sand'))).toBeGreaterThan(lightRangeM(byId('light.devils')));
    // The 6 km fog floor caps what any light can show in the zone.
    for (const t of Object.values(LIGHT_TIERS)) expect(t.rangeM).toBeLessThanOrEqual(6000);
  });
});

describe('lamps and lenses', () => {
  it('lights the lamps from sunset to sunrise', () => {
    expect(lampLevel(40)).toBe(0);
    expect(lampLevel(5)).toBe(0);
    expect(lampLevel(-10)).toBe(1);
    expect(lampLevel(-1)).toBeGreaterThan(lampLevel(1));
    expect(lampLevel(-1)).toBeGreaterThan(0);
    expect(lampLevel(-1)).toBeLessThan(1);
  });

  it('turns a flashing lens once per period, and a fixed light not at all', () => {
    const raspberry = byId('light.raspberry');
    const a = beamBearing(raspberry, 10);
    expect(beamBearing(raspberry, 100)).toBeCloseTo(a, 6);
    expect(beamBearing(raspberry, 10 + 45)).toBeCloseTo((a + Math.PI) % (Math.PI * 2), 6);
    expect(beamBearing(byId('light.sand'), 123)).toBe(0);
  });

  it('puts the lenses of Raspberry and Outer Island out of step', () => {
    expect(beamBearing(byId('light.raspberry'), 0)).not.toBeCloseTo(
      beamBearing(byId('light.outer'), 0),
      3,
    );
  });

  it('flashes at a viewer only while the beam points at them', () => {
    const outer = byId('light.outer');
    const t = 17;
    const at = beamBearing(outer, t);
    expect(flashSeen(outer, t, at)).toBe(1);
    expect(flashSeen(outer, t, at + BEAM_HALF_ANGLE_RAD)).toBeLessThan(1);
    expect(flashSeen(outer, t, at + BEAM_HALF_ANGLE_RAD)).toBeGreaterThan(0);
    expect(flashSeen(outer, t, at + Math.PI)).toBe(0);
    // Wrapping through north works.
    expect(flashSeen(outer, t, at - Math.PI * 2)).toBe(1);
    expect(flashSeen(byId('light.sand'), t, 0)).toBe(0);
  });
});

describe('placing lights on land', () => {
  /** A round island of land 3 m above the lake around (0, 0), 200 m across; sea beyond. */
  const island: LightTerrain = {
    heightAt: (x, z) => (Math.hypot(x, z) < 100 ? 3 : -5),
    shoreNormalAt(x, z, out) {
      const r = Math.hypot(x, z) || 1;
      out.x = x / r;
      out.z = z / r;
      return out;
    },
  };
  const frame = defFrame(zoneDef('zone.apostles'));

  it('moves a light that lands offshore onto the nearest ground', () => {
    // Raspberry's coordinates in this frame are far from the test island, so it can't find
    // ground within reach and stays put; a light placed at the island does not move.
    const near = {
      ...byId('light.raspberry'),
      at: { lat: 46.835, lon: -90.72 },
    };
    const p = need(placeLights([near], frame, island)[0], 'placed light');
    expect(Math.hypot(p.x, p.z)).toBeLessThan(100);
    expect(p.groundM).toBe(3);
  });

  it('faces the tower out over the water', () => {
    const near = { ...byId('light.outer'), at: { lat: 46.835, lon: -90.72 } };
    // The frame's origin is rounded to whole meters, so the point is within a few meters
    // of the island's center; pushed to the east edge, the sea is to the east.
    const east: LightTerrain = {
      heightAt: (x) => (x < 20 ? 3 : -5),
      shoreNormalAt: (_x, _z, out) => ((out.x = 1), (out.z = 0), out),
    };
    const p = need(placeLights([near], frame, east)[0], 'placed light');
    expect(p.seaward).toBeCloseTo(Math.PI / 2, 6);
  });

  it('keeps trees off the ground around a light', () => {
    const c = lightClearing({ x: 100, z: -50 });
    expect(c).toMatchObject({ x: 100, z: -50 });
    expect(c.halfAlong).toBeGreaterThan(15);
  });
});

describe('the kit', () => {
  it.each(LIGHTHOUSES.map((l) => [l.id, l] as const))('builds %s within budget', (_id, def) => {
    const parts = buildStation(def);
    // Plan 14 §8: a light station is a few thousand triangles at most.
    expect(parts.triangles).toBeGreaterThan(100);
    expect(parts.triangles).toBeLessThan(5000);
    expect(parts.lampY).toBeCloseTo(def.tower.heightM + 1.2, 6);
    expect(parts.body.getAttribute('color')).toBeDefined();
    parts.body.computeBoundingBox();
    // The tower reaches its height and the foundation goes below the ground.
    const box = need(parts.body.boundingBox, 'bounds');
    expect(box.max.y).toBeGreaterThan(def.tower.heightM);
    expect(box.min.y).toBeLessThan(0);
  });

  it('gives Devils Island ruby glass and the others amber', () => {
    const color = (id: string): THREE.Color => {
      const c = buildStation(byId(id)).lantern.getAttribute('color');
      return new THREE.Color(c.getX(0), c.getY(0), c.getZ(0));
    };
    const red = color('light.devils');
    const amber = color('light.sand');
    expect(red.r).toBeGreaterThan(red.g * 2);
    expect(amber.g).toBeGreaterThan(red.g * 2);
  });
});

describe('the lights on the Apostles zone', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
  let zone: LoadedZone;
  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));
  });

  it('stands every light on dry ground, near where it really stood', () => {
    if (!baked) return;
    const frame = manifestFrame(zone.manifest);
    const placed = placeLights(lightsIn('zone.apostles'), frame, zone.terrain);
    expect(placed).toHaveLength(7);
    for (const p of placed) {
      expect(zone.terrain.heightAt(p.x, p.z), p.def.id).toBeGreaterThanOrEqual(1.5);
      expect(zone.terrain.contains(p.x, p.z), p.def.id).toBe(true);
    }
  });

  it('finds open water to view every light from, facing it', () => {
    if (!baked) return;
    const placed = placeLights(
      lightsIn('zone.apostles'),
      manifestFrame(zone.manifest),
      zone.terrain,
    );
    for (const p of placed) {
      const spot = need(viewingSpot(p, zone.terrain, 500), p.def.id);
      expect(zone.terrain.heightAt(spot.x, spot.z), p.def.id).toBeLessThanOrEqual(-6);
      const d = Math.hypot(spot.x - p.x, spot.z - p.z);
      expect(d, p.def.id).toBeGreaterThan(100);
      expect(d, p.def.id).toBeLessThanOrEqual(500 + 1);
      // Facing the light: the heading points from the ship at the tower.
      const toLight = Math.atan2(p.x - spot.x, -(p.z - spot.z));
      expect(Math.cos(spot.heading - toLight), p.def.id).toBeGreaterThan(0.999);
    }
  });

  it('draws them at night, with the lamp lit and the nearest one reported', () => {
    if (!baked) return;
    const frame = manifestFrame(zone.manifest);
    const lighting = new StyleLighting();
    const view = createLighthouses(
      frame,
      zone.terrain,
      lighting,
      new OutlineSettings(),
      QUALITY_PRESETS.medium,
      lightsIn('zone.apostles'),
    );
    const outer = need(
      view.placed.find((p) => p.def.id === 'light.outer'),
      'outer',
    );
    const camera = new THREE.Vector3(outer.x, 20, outer.z + 150);
    view.update(0, camera, -20, 0.0003);
    expect(view.nearest?.id).toBe('light.outer');
    expect(view.nearest?.level).toBe(1);
    expect(view.lit).toBeGreaterThan(0);
    // Within reach, the nearest lamp lights the ground.
    expect(lighting.uniforms.uLampColor.value.r).toBeGreaterThan(0);

    // In full day the lamps are out and the lamp light is off.
    view.update(0, camera, 30, 0.0003);
    expect(view.lit).toBe(0);
    expect(lighting.uniforms.uLampColor.value.r).toBe(0);
    view.dispose();
  });

  it('draws no beam cone on Low', () => {
    if (!baked) return;
    const view = createLighthouses(
      manifestFrame(zone.manifest),
      zone.terrain,
      new StyleLighting(),
      new OutlineSettings(),
      QUALITY_PRESETS.low,
      lightsIn('zone.apostles'),
    );
    const outer = need(
      view.placed.find((p) => p.def.id === 'light.outer'),
      'outer',
    );
    const camera = new THREE.Vector3(outer.x, 20, outer.z + 300);
    const cones = (): number => {
      let n = 0;
      view.group.traverse((o) => {
        if (
          o instanceof THREE.Mesh &&
          (o.material as THREE.Material).name === 'lighthouse-beam' &&
          o.parent?.visible
        )
          n++;
      });
      return n;
    };
    view.update(0, camera, -20, 0.0003);
    expect(cones()).toBe(0);
    view.applyPreset(QUALITY_PRESETS.medium);
    view.update(0, camera, -20, 0.0003);
    expect(cones()).toBeGreaterThan(0);
    view.dispose();
  });
});

describe('the lights in the Twin Ports (Phase 3 piece I)', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'twin_ports');
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;

  it.skipIf(!baked)(
    'leaves Minnesota Point dark at night while the entry light burns',
    async () => {
      const zone = await loadZoneTerrain(
        async (path) => new Uint8Array(readFileSync(join(dir, path))),
      );
      const lighting = new StyleLighting();
      const view = createLighthouses(
        manifestFrame(zone.manifest),
        zone.terrain,
        lighting,
        new OutlineSettings(),
        QUALITY_PRESETS.medium,
        lightsIn('zone.twin_ports'),
      );
      const dark = need(
        view.placed.find((p) => p.def.id === 'light.minnesota_point'),
        'Minnesota Point',
      );
      // Standing beside the old tower at midnight: it's the nearest, and it shows nothing.
      const camera = new THREE.Vector3(dark.x, 20, dark.z + 60);
      view.update(0, camera, -20, 0.0003);
      expect(view.nearest?.id).toBe('light.minnesota_point');
      expect(view.nearest?.level).toBe(0);
      // The Superior Entry and canal lights still show across the harbor.
      expect(view.lit).toBeGreaterThanOrEqual(1);
      view.dispose();
    },
  );
});
