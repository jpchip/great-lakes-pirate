import * as THREE from 'three';
import { moonAt, sunAt } from '../sim/weather/celestial';
import type { LocalWeather } from '../sim/weather/local-weather';
import { R_SAILING } from '../core/time';
import { createLightingSample, fogAmount, sampleLighting } from './style/lighting-luts';
import type { Sky } from './sky';
import type { Water } from './water/water';
import { applyWinterPalette } from './style/winter-palette';
import {
  ICE_CRACK_HEX,
  ICE_DARK_HEX,
  ICE_HEX,
  ICE_SNOW_HEX,
  SAND_HEX,
  SHALLOW_HEX,
} from './water/water-material';

/**
 * Day, night and weather (plan 04 §9, §10, §15): the sky gradient, clouds, sun and moon,
 * hemisphere and directional light, global exp² fog and the water's colors, all from the
 * sun's elevation, the moon and the weather's cloud, storm and visibility. The colors come
 * from the lighting LUTs (style/lighting-luts), keyed by elevation and weather type.
 */

const WHITE = new THREE.Color(0xffffff);
const SUN_LOW = new THREE.Color(0xffa865);
const SUN_HIGH = new THREE.Color(0xfff2d6);
const MOON_LIGHT = new THREE.Color(0x9fb6dc);
const DEEP = new THREE.Color(0x1d3a4a);
const CREST = new THREE.Color(0x4f7f8c);
const FOAM = new THREE.Color(0xe8eef0);
const SHALLOW = new THREE.Color(SHALLOW_HEX);
const SAND = new THREE.Color(SAND_HEX);
const NIGHT_TINT = new THREE.Color(0x6f88b8);
/** Winter water: a colder, darker steel against the ice (piece L). */
const WINTER_DEEP = new THREE.Color(0x15232c);
const WINTER_CREST = new THREE.Color(0x3d5f6c);
const WINTER_SUN = new THREE.Color(0xfff7ee);
const ICE = new THREE.Color(ICE_HEX);
const ICE_DARK = new THREE.Color(ICE_DARK_HEX);
const ICE_SNOW = new THREE.Color(ICE_SNOW_HEX);
const ICE_CRACK = new THREE.Color(ICE_CRACK_HEX);
/** The aurora's green, for the faint light it casts. */
const AURORA_GLOW = new THREE.Color(0x58e0a0);
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

export interface EnvironmentView {
  /** `at` is where the camera looks; whitecaps follow the wind there. */
  update(gameSeconds: number, at: { x: number; z: number }): void;
  /**
   * A lightning flash lighting the scene, 0–1, from the direction it struck (render/
   * atmosphere/lightning). Set it before `update`; it adds to the ambient light and lights
   * the clouds on that side.
   */
  flash01: number;
  readonly flashDirection: THREE.Vector3;
  /** The last frame's light state, for the debug readout. */
  readonly sunElevationDeg: number;
  /**
   * Winter's look (piece L), set before `update` by render/winter: the season's palette
   * blend, the snow cover (snow bounces light up), and the aurora's strength as seen
   * (after the dark and the cloud), with its clock in real seconds.
   */
  winter01: number;
  snow01: number;
  aurora01: number;
  auroraTime: number;
  /** Snow falling, 0–1: it closes the air in, at least to this (the sim's snow does more). */
  snowing01: number;
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
  const colors = createLightingSample();
  const sunColor = new THREE.Color();
  const cloudLit = new THREE.Color();
  const cloudShade = new THREE.Color();
  let sunElevationDeg = 0;
  // Where the clouds have drifted to, accumulated so a change of wind doesn't jump them.
  let driftX = 0;
  let driftY = 0;
  let lastT: number | undefined;

  return {
    winter01: 0,
    snow01: 0,
    aurora01: 0,
    auroraTime: 0,
    snowing01: 0,
    flash01: 0,
    flashDirection: new THREE.Vector3(0, 0.3, -1).normalize(),
    get sunElevationDeg() {
      return sunElevationDeg;
    },
    update(t, at) {
      const sun = sunAt(t);
      const moon = moonAt(t);
      const cloud = weather.cloudAt(t);
      const storm = weather.stormAt(t);
      sunElevationDeg = (sun.elevationRad * 180) / Math.PI;
      const moonDeg = (moon.elevationRad * 180) / Math.PI;

      const fog01 = fogAmount(weather.fogVisibilityAt(t));
      sampleLighting(sunElevationDeg, { cloud01: cloud, storm01: storm, fog01 }, colors);
      const winter = this.winter01;
      applyWinterPalette(colors, winter, this.snow01, sunElevationDeg);
      let ambient = colors.hemi;
      const flash = this.flash01;

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
      sunColor.lerp(WINTER_SUN, 0.4 * winter * smoothstep(2, 15, sunElevationDeg));
      u.uSunColor.value.copy(sunColor);
      u.uAurora.value = this.aurora01;
      u.uAuroraTime.value = this.auroraTime;
      // The cloud layers hide the sun, moon and stars where they are, so these only say
      // whether the body is up.
      u.uSunVisible.value = smoothstep(-3, 0, sunElevationDeg);
      u.uMoonVisible.value = smoothstep(-2, 1, moonDeg) * (1 - 0.7 * sunUp);
      u.uStars.value = 1 - smoothstep(-12, -4, sunElevationDeg);

      // Clouds: cover from the weather, drifting with the wind (about 0.0004 noise units
      // per real second per knot), lit from the horizon color and shaded from the zenith.
      const open = weather.windAt(at, t);
      const dtReal = lastT === undefined ? 0 : Math.min(1, Math.max(0, (t - lastT) / R_SAILING));
      lastT = t;
      driftX -= open.toKn.x * 0.0004 * dtReal;
      driftY += open.toKn.y * 0.0004 * dtReal;
      u.uCloudCover.value = cloud;
      u.uCloudStorm.value = storm;
      u.uCloudOffset.value.set(driftX, driftY);
      // Fair-weather cloud is whiter than the sky behind it; a lid of overcast is gray.
      const white = 0.5 * smoothstep(-4, 10, sunElevationDeg) * (1 - cloud ** 1.5) * (1 - storm);
      cloudLit
        .copy(colors.horizon)
        .lerp(WHITE, white)
        .multiplyScalar(1.1 - 0.2 * storm);
      cloudShade
        .copy(colors.zenith)
        .lerp(colors.horizon, 0.3)
        .multiplyScalar(0.8 - 0.3 * storm);
      u.uCloudLit.value.copy(cloudLit);
      u.uCloudShade.value.copy(cloudShade);
      u.uFlash.value = flash;
      u.uFlashDirection.value.copy(this.flashDirection);

      fog.color.copy(colors.horizon);
      fog.density = fogDensity(weather.fogVisibilityAt(t));
      if (this.snowing01 > 0) {
        fog.density = Math.max(
          fog.density,
          fogDensity(MAX_FOG_VISIBILITY_M * (1 - 0.85 * this.snowing01)),
        );
      }

      hemi.color.copy(colors.hemiSky);
      hemi.groundColor.copy(colors.hemiGround);
      // The aurora lights a clear night faintly green, the snow most of all.
      const aurora = this.aurora01;
      if (aurora > 0) {
        hemi.color.lerp(AURORA_GLOW, 0.18 * aurora);
        hemi.groundColor.lerp(AURORA_GLOW, 0.2 * aurora * this.snow01);
        ambient += 0.12 * aurora;
      }
      // Lightning lights the whole scene for a moment through the ambient light.
      hemi.intensity = ambient + 2.2 * flash;

      // One directional light: the sun by day, the moon by night.
      const sunIntensity = 2 * sunUp * (1 - 0.75 * cloud) * (1 - 0.35 * storm) * (1 - 0.3 * fog01);
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
        .lerp(WINTER_DEEP, 0.6 * winter)
        .lerp(NIGHT_TINT, night * 0.15)
        .multiplyScalar(brightness);
      w.uCrestColor.value
        .copy(CREST)
        .lerp(WINTER_CREST, 0.5 * winter)
        .lerp(NIGHT_TINT, night * 0.15)
        .multiplyScalar(brightness);
      // Ice and snow keep a little light at night: they show under the moon and the aurora.
      const iceLight = Math.max(brightness, 0.08 + 0.25 * moonlight + 0.1 * aurora);
      w.uIceColor.value
        .copy(ICE)
        .lerp(NIGHT_TINT, night * 0.2)
        .multiplyScalar(iceLight);
      w.uIceDarkColor.value
        .copy(ICE_DARK)
        .lerp(NIGHT_TINT, night * 0.15)
        .multiplyScalar(brightness);
      w.uIceSnowColor.value
        .copy(ICE_SNOW)
        .lerp(NIGHT_TINT, night * 0.3)
        .lerp(AURORA_GLOW, 0.25 * aurora)
        .multiplyScalar(iceLight);
      w.uIceCrackColor.value.copy(ICE_CRACK).multiplyScalar(brightness);
      w.uShallowColor.value
        .copy(SHALLOW)
        .lerp(NIGHT_TINT, night * 0.15)
        .multiplyScalar(brightness);
      w.uSandColor.value
        .copy(SAND)
        .lerp(NIGHT_TINT, night * 0.15)
        .multiplyScalar(brightness);
      w.uFoamColor.value.copy(FOAM).multiplyScalar(Math.min(1, brightness * brightness * 1.1));
      // The water and the ice give back the aurora's green at a grazing look.
      w.uSkyColor.value.copy(colors.horizon).lerp(AURORA_GLOW, 0.22 * this.aurora01);
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
