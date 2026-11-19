import * as THREE from 'three';
import { KNOT_MS } from '../../core/coords';
import type { LocalWeather } from '../../sim/weather/local-weather';
import type { EnvironmentView } from '../environment';
import type { QualityPreset } from '../quality';
import type { StyleLighting } from '../style/stylized-material';
import { createFogBanks, type FogBankView } from './fog-banks';
import { createLightning, type Lightning } from './lightning';
import { createRain, type Rain } from './rain';
import { createSnowfall, type Snowfall } from './snowfall';

/**
 * The weather you see (plan 04 §9–11, Phase 2 piece E), on top of the sky and light the
 * environment view sets: fog banks standing on the water, rain around the camera,
 * lightning, and how wet the world is. One object so the scene updates it with one call a
 * frame, before the environment (it hands lightning to the environment as a flash).
 *
 * Wetness follows the rain with a lag, rising in about 20 real seconds and drying over
 * about two and a half minutes, and darkens everything the unified material lights.
 */

const WET_RISE_S = 20;
const WET_DRY_S = 150;

export interface Atmosphere {
  readonly group: THREE.Group;
  readonly fogBanks: FogBankView;
  readonly rain: Rain;
  readonly lightning: Lightning;
  /** Snow falling instead of rain in cold air (piece L). */
  readonly snowfall: Snowfall;
  /** How hard it's snowing now, 0–1 (the precipitation's share that falls as snow). */
  readonly snowing01: number;
  /** Overrides the snow falling, 0–1 (the winter hook, for a look); undefined follows the weather. */
  forceSnow: number | undefined;
  /** How wet surfaces are, 0–1. */
  readonly wetness01: number;
  applyPreset(preset: QualityPreset): void;
  /**
   * `dt` real seconds (0 holds everything still), `gameSeconds` the game clock, `camera`
   * the camera's position and `focus` the player's, zone meters.
   */
  update(
    dt: number,
    gameSeconds: number,
    camera: THREE.Vector3,
    focus: { x: number; z: number },
  ): void;
  dispose(): void;
}

export function createAtmosphere(
  scene: THREE.Scene,
  weather: LocalWeather,
  environment: EnvironmentView,
  lighting: StyleLighting,
  hemi: THREE.HemisphereLight,
  preset: QualityPreset,
): Atmosphere {
  const group = new THREE.Group();
  group.name = 'atmosphere';
  const fogBanks = createFogBanks();
  const rain = createRain(preset.rainStreaks);
  const lightning = createLightning();
  const snowfall = createSnowfall(preset.snowFlakes);
  group.add(fogBanks.group, rain.lines, snowfall.points, lightning.group);
  fogBanks.setEnabled(preset.fogBankSlabs);
  let wet = 0;
  let now = 0;
  let snowing = 0;

  return {
    group,
    fogBanks,
    rain,
    lightning,
    snowfall,
    forceSnow: undefined,
    get snowing01() {
      return snowing;
    },
    get wetness01() {
      return wet;
    },
    applyPreset(p) {
      fogBanks.setEnabled(p.fogBankSlabs);
      rain.setCapacity(p.rainStreaks);
      snowfall.setCapacity(p.snowFlakes);
    },
    update(dt, t, camera, focus) {
      now += dt;
      // Below freezing the precipitation comes down as snow, with sleet between 0 and 2 °C.
      const precipitation = weather.rainAt(t);
      const air = weather.airTempAt(t);
      const share = Math.min(1, Math.max(0, (2 - air) / 2));
      snowing = this.forceSnow ?? precipitation * share;
      const rain01 = this.forceSnow === undefined ? precipitation * (1 - share) : 0;
      const storm01 = weather.stormAt(t);

      lightning.update(dt, storm01, rain01, camera);
      environment.flash01 = lightning.flash01;
      environment.flashDirection.copy(lightning.direction);

      // Wet surfaces: quick to soak, slow to dry.
      const target = Math.min(1, rain01 * 1.5);
      const tau = target > wet ? WET_RISE_S : WET_DRY_S;
      wet += (target - wet) * (1 - Math.exp(-dt / tau));
      if (Math.abs(target - wet) < 1e-3) wet = target;
      lighting.uniforms.uWet.value = wet;

      const fog = scene.fog instanceof THREE.FogExp2 ? scene.fog : undefined;
      const light = Math.min(1, hemi.intensity / 1.4);
      if (fog) {
        fogBanks.update(weather.fogBanks(t), camera, fog.color, light, fog.density);
      }

      // Rain falls with the wind: its drops drift downwind at a share of the wind's speed.
      const wind = weather.windAt(focus, t);
      const drift = KNOT_MS * 0.7;
      rain.update(camera, rain01, { x: wind.toKn.x * drift, z: -wind.toKn.y * drift }, light, now);
      // Snow goes with the wind almost entirely.
      const carry = KNOT_MS * 0.9;
      snowfall.update(
        camera,
        snowing,
        { x: wind.toKn.x * carry, z: -wind.toKn.y * carry },
        light,
        now,
      );
    },
    dispose() {
      fogBanks.dispose();
      rain.dispose();
      snowfall.dispose();
      lightning.dispose();
    },
  };
}
