import * as THREE from 'three';
import type { LightingSample } from './lighting-luts';

/**
 * Winter's palette (plan 14 §2, plan 04 §9; plan 11 §18.4 piece L): the lighting LUTs'
 * colors moved toward the cold months'. Applied after `sampleLighting`, so the weather's
 * columns (overcast, storm, fog) still do their part and the season only shifts them.
 *
 * - **Day:** a paler, colder sky, a white-gray haze at the horizon, the sun whiter.
 * - **Low sun:** the long winter dusk goes rose and salmon along the horizon.
 * - **Night:** a deeper, bluer dark.
 * - **Snow on the ground** bounces light back up: the hemisphere's ground color rises
 *   toward a cold white and the ambient brightens, so a snowy day is a bright one.
 *
 * `winter01` is the season's look (sim/ice/snow `winterLookAt`), `snow01` the cover.
 */

const DAY_ZENITH = new THREE.Color(0x7e9cbc);
const DAY_HORIZON = new THREE.Color(0xd3dbe2);
const DAY_HEMI_SKY = new THREE.Color(0xd9e3ee);
const DUSK_HORIZON = new THREE.Color(0xe2aea2);
const DUSK_ZENITH = new THREE.Color(0x5a6f99);
const NIGHT_ZENITH = new THREE.Color(0x0b1730);
const NIGHT_HORIZON = new THREE.Color(0x24324a);
const SNOW_BOUNCE = new THREE.Color(0xc2cfdc);
const SNOW_BOUNCE_NIGHT = new THREE.Color(0x3a4a66);

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const bounce = new THREE.Color();

export function applyWinterPalette(
  c: LightingSample,
  winter01: number,
  snow01: number,
  sunElevationDeg: number,
): void {
  if (winter01 <= 0 && snow01 <= 0) return;
  const w = Math.min(1, Math.max(0, winter01));
  const day = smoothstep(-2, 10, sunElevationDeg);
  const dusk = smoothstep(-8, -1, sunElevationDeg) * (1 - smoothstep(4, 14, sunElevationDeg));
  const night = 1 - smoothstep(-10, -2, sunElevationDeg);

  c.zenith.lerp(DAY_ZENITH, 0.35 * w * day);
  c.horizon.lerp(DAY_HORIZON, 0.32 * w * day);
  c.hemiSky.lerp(DAY_HEMI_SKY, 0.25 * w * day);
  c.horizon.lerp(DUSK_HORIZON, 0.3 * w * dusk);
  c.zenith.lerp(DUSK_ZENITH, 0.2 * w * dusk);
  c.zenith.lerp(NIGHT_ZENITH, 0.35 * w * night);
  c.horizon.lerp(NIGHT_HORIZON, 0.25 * w * night);

  const s = Math.min(1, Math.max(0, snow01));
  if (s > 0) {
    bounce.copy(SNOW_BOUNCE_NIGHT).lerp(SNOW_BOUNCE, day);
    c.hemiGround.lerp(bounce, 0.6 * s);
    c.hemi *= 1 + 0.12 * s * day;
  }
}
