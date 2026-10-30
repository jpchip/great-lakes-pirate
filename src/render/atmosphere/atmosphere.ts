import * as THREE from 'three';
import { KNOT_MS } from '../../core/coords';
import type { LocalWeather } from '../../sim/weather/local-weather';
import type { EnvironmentView } from '../environment';
import type { QualityPreset } from '../quality';
import type { StyleLighting } from '../style/stylized-material';
import { createFogBanks, type FogBankView } from './fog-banks';
import { createLightning, type Lightning } from './lightning';
import { createRain, type Rain } from './rain';

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
  group.add(fogBanks.group, rain.lines, lightning.group);
  fogBanks.setEnabled(preset.fogBankSlabs);
  let wet = 0;
  let now = 0;

  return {
    group,
    fogBanks,
    rain,
    lightning,
    get wetness01() {
      return wet;
    },
    applyPreset(p) {
      fogBanks.setEnabled(p.fogBankSlabs);
      rain.setCapacity(p.rainStreaks);
    },
    update(dt, t, camera, focus) {
      now += dt;
      const rain01 = weather.rainAt(t);
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
    },
    dispose() {
      fogBanks.dispose();
      rain.dispose();
      lightning.dispose();
    },
  };
}
