import * as THREE from 'three';
import { zoneToChart, type Chart, type ZoneFrame } from '../core/coords';
import { snowAt, winterLookAt } from '../sim/ice/snow';
import {
  buildIceLut,
  buildShelterGrid,
  iceCalm,
  iceDayKey,
  lutSample,
  sampleShelterGrid,
  type IceLut,
  type ShelterGrid,
} from '../sim/ice/zone-ice';
import type { TerrainBounds } from '../sim/terrain/zone-terrain';
import { auroraAt } from '../sim/weather/aurora';
import type { LocalWeather } from '../sim/weather/local-weather';
import type { Atmosphere } from './atmosphere/atmosphere';
import type { EnvironmentView } from './environment';
import type { QualityPreset } from './quality';
import type { StyleLighting } from './style/stylized-material';
import { createFloes, type Floes } from './water/floes';
import type { Spray } from './water/spray';
import type { Water } from './water/water';

/**
 * Winter's look (plan 04 §8.3, §9, §11; plan 11 §18.4 piece L), one object the scene
 * updates each frame before the atmosphere and the environment:
 *
 * - **The ice sheet** over the water from piece K's ice: the zone's shelter as a texture
 *   (built once a zone) and the day's ice by shelter as a strip (once a calendar day),
 *   read by the water shader (water/ice-glsl.ts). The same pair calms the sea under the
 *   ice through the weather's sea scale, so the swell the ship rides is the swell drawn.
 * - **Floes** at the break-up as instanced meshes near the camera (water/floes.ts).
 * - **Snow** on everything the style lights that faces up (terrain, trees, roofs, decks,
 *   hideouts), from the snow on the ground (sim/ice/snow), off while you're indoors.
 * - **Winter palettes** and the **aurora** through the environment, frozen spray through
 *   the spray, and falling snow through the atmosphere (cold air turns rain to snow).
 *
 * `source` is the run's: its seed and the ice's shelter at a chart point. Until it's set
 * (or with no zone loaded) the look is summer's.
 */

export interface WinterSource {
  seed: string;
  /** The ice's shelter at a point on the world chart (zoneToChart's frame), 0–1. */
  shelterAt(p: Chart): number;
}

/** The winter hook's switches (`__glpWinter.set`): each forces its part for a look. */
export interface WinterOverrides {
  /** Snow cover on the ground, 0–1. */
  snow?: number | undefined;
  /** The aurora as seen, 0–1, whatever the hour and the sky. */
  aurora?: number | undefined;
  /** The season's palette, 0–1. */
  look?: number | undefined;
  /** Snow falling, 0–1. */
  falling?: number | undefined;
}

export interface WinterStats {
  on: boolean;
  look01: number;
  snow01: number;
  aurora01: number;
  iceOn: boolean;
  maxIceCover: number;
  floes: number;
  snowFlakes: number;
  frozenSpray01: number;
  shelterTexels: number;
  dayKey: string | undefined;
}

export interface WinterView {
  source: WinterSource | undefined;
  readonly overrides: WinterOverrides;
  /** True while the player is inside a building: the snow comes off the floors. */
  indoors: boolean;
  readonly floes: Floes;
  setZone(zone: { frame: ZoneFrame; bounds: TerrainBounds } | undefined): void;
  applyPreset(preset: QualityPreset): void;
  update(
    dt: number,
    gameSeconds: number,
    camera: THREE.Vector3,
    seaHeight: (x: number, z: number) => number,
  ): void;
  stats(): WinterStats;
  dispose(): void;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function createWinterView(opts: {
  scene: THREE.Scene;
  water: Water;
  environment: EnvironmentView;
  atmosphere: Atmosphere;
  lighting: StyleLighting;
  spray: Spray;
  weather: LocalWeather;
  preset: QualityPreset;
}): WinterView {
  const { water, environment, atmosphere, lighting, spray, weather } = opts;
  const u = water.material.uniforms;
  const floes = createFloes(lighting, opts.preset.iceFloes);
  opts.scene.add(floes.mesh);

  let zone: { frame: ZoneFrame; bounds: TerrainBounds } | undefined;
  let grid: ShelterGrid | undefined;
  let gridTexture: THREE.DataTexture | undefined;
  let lut: IceLut | undefined;
  const lutTexture = new THREE.DataTexture(new Uint8Array(64 * 4), 64, 1, THREE.RGBAFormat);
  lutTexture.magFilter = THREE.LinearFilter;
  lutTexture.minFilter = THREE.LinearFilter;
  lutTexture.wrapS = THREE.ClampToEdgeWrapping;
  lutTexture.wrapT = THREE.ClampToEdgeWrapping;
  u.uIceLut.value = lutTexture;
  let hasFloes = false;
  let indoorFade = 0;
  let auroraClock = 0;
  const last = { look: 0, snow: 0, aurora: 0, frozen: 0 };

  const clearIce = (): void => {
    u.uIceOn.value = 0;
    lut = undefined;
    hasFloes = false;
    weather.setSeaCalm(undefined);
  };

  const dropGrid = (): void => {
    gridTexture?.dispose();
    gridTexture = undefined;
    grid = undefined;
    clearIce();
  };

  const buildGrid = (source: WinterSource): void => {
    const z = zone;
    if (!z) return;
    grid = buildShelterGrid(z.bounds, (x, zz) =>
      source.shelterAt(zoneToChart({ x, z: zz }, z.frame)),
    );
    gridTexture = new THREE.DataTexture(grid.data, grid.width, grid.height, THREE.RedFormat);
    gridTexture.magFilter = THREE.LinearFilter;
    gridTexture.minFilter = THREE.LinearFilter;
    gridTexture.wrapS = THREE.ClampToEdgeWrapping;
    gridTexture.wrapT = THREE.ClampToEdgeWrapping;
    gridTexture.unpackAlignment = 1;
    gridTexture.needsUpdate = true;
    u.uIceShelter.value = gridTexture;
    u.uIceShelterRect.value.set(
      grid.minX,
      grid.minZ,
      1 / (grid.width * grid.cellM),
      1 / (grid.height * grid.cellM),
    );
  };

  const view: WinterView = {
    source: undefined,
    overrides: {},
    indoors: false,
    floes,
    setZone(next) {
      dropGrid();
      zone = next;
    },
    applyPreset(p) {
      floes.setCapacity(p.iceFloes);
    },
    update(dt, t, camera, seaHeight) {
      const o = view.overrides;
      const source = view.source;
      auroraClock += dt;
      if (!source) {
        environment.winter01 = o.look ?? 0;
        environment.snow01 = o.snow ?? 0;
        environment.aurora01 = o.aurora ?? 0;
        lighting.uniforms.uSnow.value = o.snow ?? 0;
        atmosphere.forceSnow = o.falling;
        return;
      }
      const seed = source.seed;
      const look = o.look ?? winterLookAt(seed, t);
      const snow = o.snow ?? snowAt(seed, t).cover01;
      // The aurora shows in the full dark, through a clear sky.
      const dark = 1 - smoothstep(-14, -8, environment.sunElevationDeg);
      const clear = 1 - smoothstep(0.25, 0.7, weather.cloudAt(t));
      const aurora = o.aurora ?? auroraAt(seed, t) * dark * clear;
      environment.winter01 = look;
      environment.snow01 = snow;
      environment.aurora01 = aurora;
      environment.auroraTime = auroraClock;
      environment.snowing01 = atmosphere.snowing01;

      indoorFade += ((view.indoors ? 1 : 0) - indoorFade) * (1 - Math.exp(-dt / 0.3));
      lighting.uniforms.uSnow.value = snow * (1 - indoorFade);
      // Snow's night glow: on from dusk, a little more under the aurora.
      const night = 1 - smoothstep(-8, 2, environment.sunElevationDeg);
      lighting.uniforms.uSnowNight.value = night * (0.07 + 0.05 * aurora);
      u.uIceSnow.value = snow;
      atmosphere.forceSnow = o.falling;

      // Spray freezes as it flies in hard cold.
      const air = weather.airTempAt(t);
      const frozen = smoothstep(-3, -12, air);
      spray.frozen01 = frozen;
      last.look = look;
      last.snow = snow;
      last.aurora = aurora;
      last.frozen = frozen;

      if (zone && !grid) buildGrid(source);
      if (grid) {
        const key = iceDayKey(seed, t);
        if (!lut || lut.key !== key) {
          const next = buildIceLut(seed, t);
          lut = next;
          (lutTexture.image.data as Uint8Array).set(next.data);
          lutTexture.needsUpdate = true;
          u.uIceOn.value = next.maxCover > 0.01 ? 1 : 0;
          hasFloes = next.samples.some((s) => s.kind === 'floes');
          const g = grid;
          weather.setSeaCalm(
            next.maxCover > 0.01
              ? (x, z) => iceCalm(lutSample(next, sampleShelterGrid(g, x, z)))
              : undefined,
          );
        }
      }
      u.uFloeNear.value = floes.nearM;
      const g = grid;
      const day = lut;
      if (g && day && hasFloes) {
        floes.update(
          camera,
          (x, z) => {
            const s = lutSample(day, sampleShelterGrid(g, x, z));
            return s.kind === 'floes' ? s.coverage : 0;
          },
          seaHeight,
          snow,
        );
      } else if (floes.drawn > 0) {
        floes.update(camera, () => 0, seaHeight, snow);
      }
    },
    stats() {
      return {
        on: view.source !== undefined,
        look01: last.look,
        snow01: last.snow,
        aurora01: last.aurora,
        iceOn: u.uIceOn.value > 0.5,
        maxIceCover: lut?.maxCover ?? 0,
        floes: floes.drawn,
        snowFlakes: atmosphere.snowfall.drawn,
        frozenSpray01: last.frozen,
        shelterTexels: grid ? grid.width * grid.height : 0,
        dayKey: lut?.key,
      };
    },
    dispose() {
      dropGrid();
      lutTexture.dispose();
      floes.dispose();
    },
  };
  return view;
}
