import * as THREE from 'three';

/**
 * Lighting presets for the S4 style test (plan 14 §3.2): dusk and night, each with fog
 * on and off. They are hand-set stand-ins for the lighting LUTs of plan 04 §9, which
 * will drive the same values from sun elevation and weather.
 */

export type TimeOfDayId = 'dusk' | 'night';
export const TIME_OF_DAY_IDS: readonly TimeOfDayId[] = ['dusk', 'night'];

export interface FogSetting {
  color: number;
  near: number;
  far: number;
}

export interface TimeOfDay {
  id: TimeOfDayId;
  label: string;
  /** Sky dome. With fog off the horizon is also the haze color. */
  horizon: number;
  zenith: number;
  /** Direction toward the key light (the sun at dusk, the moon at night). */
  keyDirection: THREE.Vector3;
  keyColor: number;
  keyIntensity: number;
  /** Hemisphere ambient: sky and ground colors and a shared intensity. */
  skyAmbient: number;
  groundAmbient: number;
  ambientIntensity: number;
  /** Silhouette rim light (plan 14 §4), strongest against a bright sky. */
  rimColor: number;
  rimIntensity: number;
  water: { deep: number; crest: number; sky: number; glint: number; foam: number };
  /** Lighthouse lamp and beam strength; the beam barely shows at dusk. */
  lampIntensity: number;
  haze: FogSetting;
  fog: FogSetting;
}

/** Unit vector toward a light at a compass azimuth (clockwise from north) and elevation. */
export function directionFrom(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  // North is -z and east is +x, as in gameplay/buoyancy.ts.
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export const TIMES_OF_DAY: Record<TimeOfDayId, TimeOfDay> = {
  dusk: {
    id: 'dusk',
    label: 'Dusk',
    // Golden dusk (plan 14 §2.3): amber low in the west, rose-gray above, cold blue overhead.
    horizon: 0xd9a77e,
    zenith: 0x56708c,
    keyDirection: directionFrom(258, 5),
    keyColor: 0xffb071,
    keyIntensity: 1.5,
    skyAmbient: 0x8a96b0,
    groundAmbient: 0x2e2a2c,
    ambientIntensity: 1.05,
    rimColor: 0xffc9a0,
    rimIntensity: 0.35,
    water: { deep: 0x1f3446, crest: 0x55687a, sky: 0xc99a7a, glint: 0xffc48a, foam: 0xe6d8c6 },
    lampIntensity: 0.55,
    haze: { color: 0xc7a184, near: 500, far: 2600 },
    fog: { color: 0xa99a90, near: 25, far: 480 },
  },
  night: {
    id: 'night',
    label: 'Night',
    // Blue night (plan 14 §2.3) under a high moon, so silhouettes still read.
    horizon: 0x26364c,
    zenith: 0x0b1424,
    keyDirection: directionFrom(150, 32),
    keyColor: 0x9fb6d8,
    keyIntensity: 0.55,
    skyAmbient: 0x33456a,
    groundAmbient: 0x0c1016,
    ambientIntensity: 0.55,
    rimColor: 0x7d99c4,
    rimIntensity: 0.45,
    water: { deep: 0x0b1825, crest: 0x1f3448, sky: 0x2f4562, glint: 0xb8cbe6, foam: 0x56667c },
    lampIntensity: 1,
    haze: { color: 0x1f2d40, near: 400, far: 2200 },
    fog: { color: 0x3e4a5c, near: 20, far: 420 },
  },
};
