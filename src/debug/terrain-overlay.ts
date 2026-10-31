import * as THREE from 'three';
import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { dockBerths, TEST_BAY, type Dock } from '../sim/terrain/test-bay';
import type { ZoneTerrain } from '../sim/terrain/zone-terrain';

/**
 * The shelter-map debug overlay (plan 02 §14.2, Phase 1 piece B): the baked shelter,
 * fetch or funneling map for one wind direction, drawn over the water of the loaded
 * slice, plus the dock berth zones. Its wind direction is its own until the dev panel's
 * wind (piece D) drives it.
 */

export type TerrainMap = 'off' | 'shelter' | 'fetch' | 'funnel';

/** Texel size of the overlay, zone meters (the maps are 32 m cells, blended). */
const TEXEL_M = 16;
/** Above the default sea's crests, so the overlay reads; land hides it where it rises. */
const OVERLAY_Y = 2.5;

const DEG = Math.PI / 180;

export interface TerrainOverlay {
  readonly settings: { map: TerrainMap; windFromDeg: number; opacity: number };
  /** One line about the terrain at (x, z) for the stats readout. */
  describe(x: number, z: number): string;
  /** Takes it out of the scene and the panel, when the zone changes. */
  dispose(): void;
}

const ramp = new THREE.Color();
const low = new THREE.Color();
const high = new THREE.Color();

/** RGBA 0–255 for a map value, or transparent. */
function colorFor(map: TerrainMap, value: number, out: Uint8Array, k: number): void {
  let alpha = 0.7;
  if (map === 'shelter') {
    // Clear in full wind, orange to deep red in a dead lee.
    ramp.setHSL(0.1 * (1 - value), 0.9, 0.5);
    alpha = 0.85 * value;
  } else if (map === 'fetch') {
    // Log scale: 100 m real (short, choppy) to 600 km (the length of Superior).
    const t = THREE.MathUtils.clamp(
      Math.log10(Math.max(value, 100) / 100) / Math.log10(6000),
      0,
      1,
    );
    ramp.copy(low.setHex(0x2ec27e)).lerp(high.setHex(0x8e2bd9), t);
  } else {
    ramp.setHex(0x37e05b);
    alpha = value * 0.9;
  }
  out[k] = Math.round(ramp.r * 255);
  out[k + 1] = Math.round(ramp.g * 255);
  out[k + 2] = Math.round(ramp.b * 255);
  out[k + 3] = Math.round(alpha * 255);
}

export function createTerrainOverlay(
  scene: THREE.Scene,
  terrain: ZoneTerrain,
  gui: GUI,
  initial: { map: TerrainMap; windFromDeg: number },
  docks: readonly Dock[] = TEST_BAY.docks,
): TerrainOverlay {
  const { minX, minZ, maxX, maxZ } = terrain.bounds;
  const cols = Math.ceil((maxX - minX) / TEXEL_M);
  const rows = Math.ceil((maxZ - minZ) / TEXEL_M);
  const data = new Uint8Array(cols * rows * 4);
  const texture = new THREE.DataTexture(data, cols, rows);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(cols * TEXEL_M, rows * TEXEL_M).rotateX(-Math.PI / 2);
  const plane = new THREE.Mesh(geometry, material);
  plane.name = 'terrain-overlay';
  plane.position.set(minX + (cols * TEXEL_M) / 2, OVERLAY_Y, minZ + (rows * TEXEL_M) / 2);
  plane.renderOrder = 10;
  plane.visible = false;
  scene.add(plane);

  // Berth zones as outlines on the water.
  const berths = new THREE.Group();
  berths.name = 'berth-zones';
  berths.visible = false;
  const berthMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, fog: false });
  for (const dock of docks) {
    for (const berth of dockBerths(dock)) {
      const { x, z, heading } = berth.pose;
      const box = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(
            ([a = 0, b = 0]) => new THREE.Vector3(a * berth.halfWidthM, 0, b * (berth.lengthM / 2)),
          ),
        ),
        berthMaterial,
      );
      box.position.set(x, OVERLAY_Y + 0.1, z);
      box.rotation.y = -heading;
      berths.add(box);
    }
  }
  scene.add(berths);

  const settings = { ...initial, opacity: 1 };
  const repaint = (): void => {
    plane.visible = settings.map !== 'off';
    berths.visible = plane.visible;
    if (!plane.visible) return;
    const from = settings.windFromDeg * DEG;
    for (let r = 0; r < rows; r++) {
      // Row 0 is the plane's south edge after the rotation.
      const z = maxZ - (r + 0.5) * TEXEL_M;
      for (let c = 0; c < cols; c++) {
        const x = minX + (c + 0.5) * TEXEL_M;
        const k = (r * cols + c) * 4;
        if (terrain.shoreDistanceAt(x, z) < 0) {
          data[k + 3] = 0;
          continue;
        }
        const value =
          settings.map === 'shelter'
            ? terrain.shelterAt(x, z, from)
            : settings.map === 'fetch'
              ? terrain.fetchAt(x, z, from)
              : terrain.funnelAt(x, z, from);
        colorFor(settings.map, value, data, k);
      }
    }
    texture.needsUpdate = true;
  };

  const folder = gui.addFolder('Terrain');
  folder
    .add(settings, 'map', ['off', 'shelter', 'fetch', 'funnel'])
    .name('Overlay')
    .onChange(repaint);
  folder.add(settings, 'windFromDeg', 0, 360, 1).name('Wind from (°)').onChange(repaint);
  folder
    .add(settings, 'opacity', 0.1, 1, 0.05)
    .name('Opacity')
    .onChange((v: number) => (material.opacity = v));
  repaint();

  return {
    settings,
    dispose() {
      scene.remove(plane, berths);
      texture.dispose();
      material.dispose();
      geometry.dispose();
      berthMaterial.dispose();
      for (const box of berths.children) (box as THREE.LineLoop).geometry.dispose();
      folder.destroy();
    },
    describe(x, z) {
      const from = settings.windFromDeg * DEG;
      const depth = terrain.depthAt(x, z);
      const shore = terrain.shoreDistanceAt(x, z);
      return [
        `depth ${depth.toFixed(1)} m  shore ${shore.toFixed(0)} m`,
        `wind from ${settings.windFromDeg.toFixed(0)}°: shelter ${terrain.shelterAt(x, z, from).toFixed(2)}` +
          `  fetch ${(terrain.fetchAt(x, z, from) / 1000).toFixed(1)} km` +
          `  funnel ${terrain.funnelAt(x, z, from).toFixed(2)}`,
      ].join('\n');
    },
  };
}
