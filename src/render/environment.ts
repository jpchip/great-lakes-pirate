import * as THREE from 'three';
import { moonAt, sunAt } from '../sim/weather/celestial';
import type { LocalWeather } from '../sim/weather/local-weather';
import type { Sky } from './sky';
import type { Water } from './water/water';
import { SAND_HEX, SHALLOW_HEX } from './water/water-material';

/**
 * Basic day and night (plan 04 §9, §10, §15 Phase 1): the sky gradient, sun and moon,
 * hemisphere and directional light, global exp² fog and the water's colors, all from the
 * sun's elevation, the moon and the weather's cloud and visibility. The palette is a
 * stand-in until the art style test (S4) picks one; plan 04's lighting LUTs replace it.
 */

interface PaletteKey {
  /** Sun elevation, degrees. */
  at: number;
  zenith: number;
  horizon: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
}

const PALETTE: readonly PaletteKey[] = [
  {
    at: -18,
    zenith: 0x05080f,
    horizon: 0x0c121c,
    hemiSky: 0x26324c,
    hemiGround: 0x04070a,
    hemiIntensity: 0.22,
  },
  {
    at: -9,
    zenith: 0x111b2f,
    horizon: 0x27324a,
    hemiSky: 0x34436a,
    hemiGround: 0x070b10,
    hemiIntensity: 0.32,
  },
  {
    at: -3,
    zenith: 0x2b4166,
    horizon: 0xb07258,
    hemiSky: 0x7d7f9a,
    hemiGround: 0x141a20,
    hemiIntensity: 0.6,
  },
  {
    at: 3,
    zenith: 0x56789e,
    horizon: 0xdcaa84,
    hemiSky: 0xd8c8b4,
    hemiGround: 0x22303a,
    hemiIntensity: 1.0,
  },
  {
    at: 12,
    zenith: 0x6f8ea3,
    horizon: 0xb7c6cf,
    hemiSky: 0xdfe9f0,
    hemiGround: 0x2a3a44,
    hemiIntensity: 1.4,
  },
  {
    at: 45,
    zenith: 0x5b83a8,
    horizon: 0xbfcdd6,
    hemiSky: 0xe6eef3,
    hemiGround: 0x2e3e48,
    hemiIntensity: 1.5,
  },
];

const SUN_LOW = new THREE.Color(0xffa865);
const SUN_HIGH = new THREE.Color(0xfff2d6);
const MOON_LIGHT = new THREE.Color(0x9fb6dc);
const OVERCAST = new THREE.Color(0x8d969c);
const DEEP = new THREE.Color(0x1d3a4a);
const CREST = new THREE.Color(0x4f7f8c);
const FOAM = new THREE.Color(0xe8eef0);
const SHALLOW = new THREE.Color(SHALLOW_HEX);
const SAND = new THREE.Color(SAND_HEX);
const NIGHT_TINT = new THREE.Color(0x6f88b8);
/** Crest foam threshold in light air and in a gale. */
const FOAM_CALM = 0.6;
const FOAM_GALE = 0.3;

/** exp² fog reaches 2% transmission at visibility V when density = √(ln 50) / V. */
const FOG_K = Math.sqrt(Math.log(50));
/**
 * The draw-distance floor: even clear air fogs out by here (plan 04 §10). The far-water
 * LOD (water.ts) runs to 10 km, where this leaves under 0.1% of the color.
 */
export const MAX_FOG_VISIBILITY_M = 6000;

export function fogDensity(visibilityM: number): number {
  return FOG_K / Math.min(Math.max(visibilityM, 30), MAX_FOG_VISIBILITY_M);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const ca = new THREE.Color();
const cb = new THREE.Color();

function samplePalette(
  elevationDeg: number,
  out: { zenith: THREE.Color; horizon: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color },
): number {
  let i = 0;
  while (i < PALETTE.length - 2 && (PALETTE[i + 1] as PaletteKey).at < elevationDeg) i++;
  const a = PALETTE[i] as PaletteKey;
  const b = PALETTE[i + 1] as PaletteKey;
  const t = Math.min(1, Math.max(0, (elevationDeg - a.at) / (b.at - a.at)));
  const mix = (x: number, y: number, target: THREE.Color): void => {
    target.copy(ca.setHex(x)).lerp(cb.setHex(y), t);
  };
  mix(a.zenith, b.zenith, out.zenith);
  mix(a.horizon, b.horizon, out.horizon);
  mix(a.hemiSky, b.hemiSky, out.hemiSky);
  mix(a.hemiGround, b.hemiGround, out.hemiGround);
  return a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
}

/** Grays and darkens a color toward overcast, keeping some of its brightness. */
function cloudify(color: THREE.Color, cloud01: number, darkness: number): void {
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  cb.copy(OVERCAST).multiplyScalar(luminance / 0.27);
  color.lerp(cb, cloud01 * 0.85).multiplyScalar(1 - darkness * cloud01);
}

export interface EnvironmentView {
  /** `at` is where the camera looks; whitecaps follow the wind there. */
  update(gameSeconds: number, at: { x: number; z: number }): void;
  /** The last frame's light state, for the debug readout. */
  readonly sunElevationDeg: number;
}

export function createEnvironmentView(
  scene: THREE.Scene,
  sky: Sky,
  hemi: THREE.HemisphereLight,
  light: THREE.DirectionalLight,
  water: Water,
  weather: LocalWeather,
): EnvironmentView {
  const fog = new THREE.FogExp2(0xb7c6cf, fogDensity(MAX_FOG_VISIBILITY_M));
  scene.fog = fog;
  const u = sky.material.uniforms;
  const w = water.material.uniforms;
  const colors = {
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
  };
  const sunColor = new THREE.Color();
  let sunElevationDeg = 0;

  return {
    get sunElevationDeg() {
      return sunElevationDeg;
    },
    update(t, at) {
      const sun = sunAt(t);
      const moon = moonAt(t);
      const cloud = weather.cloudAt(t);
      sunElevationDeg = (sun.elevationRad * 180) / Math.PI;
      const moonDeg = (moon.elevationRad * 180) / Math.PI;

      let ambient = samplePalette(sunElevationDeg, colors);
      cloudify(colors.zenith, cloud, 0.5);
      cloudify(colors.horizon, cloud, 0.4);
      cloudify(colors.hemiSky, cloud, 0.25);
      ambient *= 1 - 0.35 * cloud;

      // Moonlight floor so a clear night stays playable (plan 04 §9 night readability).
      const sunUp = smoothstep(-2, 10, sunElevationDeg);
      const moonUp = smoothstep(-2, 8, moonDeg);
      const moonlight = 0.4 * moon.illumination01 * moonUp * (1 - 0.7 * cloud) * (1 - sunUp);
      ambient += moonlight * 0.6;

      u.uZenith.value.copy(colors.zenith);
      u.uHorizon.value.copy(colors.horizon);
      u.uSunDirection.value.set(sun.direction.x, sun.direction.y, sun.direction.z);
      u.uMoonDirection.value.set(moon.direction.x, moon.direction.y, moon.direction.z);
      u.uMoonPhase.value = moon.phase01;
      sunColor.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0, 20, sunElevationDeg));
      u.uSunColor.value.copy(sunColor);
      u.uSunVisible.value = (1 - cloud ** 1.5) * smoothstep(-3, 0, sunElevationDeg);
      u.uMoonVisible.value = (1 - cloud) * smoothstep(-2, 1, moonDeg) * (1 - 0.7 * sunUp);
      u.uStars.value = (1 - smoothstep(-12, -4, sunElevationDeg)) * (1 - cloud) ** 2;

      fog.color.copy(colors.horizon);
      fog.density = fogDensity(weather.fogVisibilityAt(t));

      hemi.color.copy(colors.hemiSky);
      hemi.groundColor.copy(colors.hemiGround);
      hemi.intensity = ambient;

      // One directional light: the sun by day, the moon by night.
      const sunIntensity = 2 * sunUp * (1 - 0.75 * cloud);
      const lit = sunIntensity >= moonlight ? sun : moon;
      light.position
        .set(lit.direction.x, Math.max(lit.direction.y, 0.05), lit.direction.z)
        .multiplyScalar(100);
      if (sunIntensity >= moonlight) {
        light.color.copy(sunColor);
        light.intensity = sunIntensity;
      } else {
        light.color.copy(MOON_LIGHT);
        light.intensity = moonlight;
      }

      // The water shader is unlit apart from its toon bands, so scale its palette here.
      const brightness = Math.min(1.05, Math.max(0.06, ambient / 1.4));
      const night = 1 - smoothstep(-8, 2, sunElevationDeg);
      w.uDeepColor.value
        .copy(DEEP)
        .lerp(NIGHT_TINT, night * 0.15)
        .multiplyScalar(brightness);
      w.uCrestColor.value
        .copy(CREST)
        .lerp(NIGHT_TINT, night * 0.15)
        .multiplyScalar(brightness);
      w.uShallowColor.value
        .copy(SHALLOW)
        .lerp(NIGHT_TINT, night * 0.15)
        .multiplyScalar(brightness);
      w.uSandColor.value
        .copy(SAND)
        .lerp(NIGHT_TINT, night * 0.15)
        .multiplyScalar(brightness);
      w.uFoamColor.value.copy(FOAM).multiplyScalar(Math.min(1, brightness * brightness * 1.1));
      w.uSkyColor.value.copy(colors.horizon);
      // Whitecaps spread as the wind rises (plan 04 §6.2): the foam threshold drops.
      const wind = weather.windAt(at, t).speedKn;
      w.uFoamThreshold.value = FOAM_CALM - (FOAM_CALM - FOAM_GALE) * smoothstep(12, 40, wind);
      w.uSunDirection.value.copy(light.position).normalize();
      // Glint fades with cloud; at night the moon makes a dimmer, cooler path.
      w.uSunColor.value
        .copy(light.color)
        .multiplyScalar(Math.min(1, light.intensity / 2) * (1 - 0.85 * cloud));
    },
  };
}
