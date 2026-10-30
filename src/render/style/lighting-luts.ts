import * as THREE from 'three';

/**
 * Lighting LUTs (plan 04 §9, plan 14 §2.3; Phase 2 piece E): the sky and ambient colors
 * as a table of sun elevation by weather type, so the art direction owns the palette. The
 * four columns follow plan 14's time-of-day moods, drawn from the Detroit Publishing
 * photochroms the palette is built on (soft, warm-gray, never fully saturated):
 *
 * - **clear:** dawn rose-gray, a cool blue-white day, golden dusk, blue night.
 * - **overcast:** a warm-gray lid, pink-gray at the horizon at sunrise and sunset.
 * - **storm:** a dark green-gray, the color the lake goes before a gale.
 * - **fog:** milky white-gray, bright at midday and cold and flat at night.
 *
 * `sampleLighting` blends the columns by how overcast, stormy and foggy it is, so the
 * weather sim's cloud cover, thunderstorm and visibility all reach the sky, the
 * hemisphere light and the fog color through one table.
 */

/** One row of a column: the colors at a sun elevation, in degrees. */
export interface LutKey {
  at: number;
  zenith: number;
  horizon: number;
  hemiSky: number;
  hemiGround: number;
  /** Ambient (hemisphere) light intensity. */
  hemi: number;
}

export type LutColumn = 'clear' | 'overcast' | 'storm' | 'fog';

export const LIGHTING_LUTS: Record<LutColumn, readonly LutKey[]> = {
  clear: [
    {
      at: -18,
      zenith: 0x05080f,
      horizon: 0x0c121c,
      hemiSky: 0x26324c,
      hemiGround: 0x04070a,
      hemi: 0.22,
    },
    {
      at: -9,
      zenith: 0x111b2f,
      horizon: 0x27324a,
      hemiSky: 0x34436a,
      hemiGround: 0x070b10,
      hemi: 0.32,
    },
    {
      at: -3,
      zenith: 0x2b4166,
      horizon: 0xb07258,
      hemiSky: 0x7d7f9a,
      hemiGround: 0x141a20,
      hemi: 0.6,
    },
    {
      at: 3,
      zenith: 0x56789e,
      horizon: 0xdcaa84,
      hemiSky: 0xd8c8b4,
      hemiGround: 0x22303a,
      hemi: 1.0,
    },
    {
      at: 12,
      zenith: 0x6f8ea3,
      horizon: 0xb7c6cf,
      hemiSky: 0xdfe9f0,
      hemiGround: 0x2a3a44,
      hemi: 1.4,
    },
    {
      at: 45,
      zenith: 0x5b83a8,
      horizon: 0xbfcdd6,
      hemiSky: 0xe6eef3,
      hemiGround: 0x2e3e48,
      hemi: 1.5,
    },
  ],
  overcast: [
    {
      at: -18,
      zenith: 0x070a10,
      horizon: 0x10151c,
      hemiSky: 0x1c2432,
      hemiGround: 0x05070a,
      hemi: 0.2,
    },
    {
      at: -9,
      zenith: 0x151b26,
      horizon: 0x2b323d,
      hemiSky: 0x2c3646,
      hemiGround: 0x07090d,
      hemi: 0.28,
    },
    {
      at: -3,
      zenith: 0x4b5560,
      horizon: 0x9a8f8c,
      hemiSky: 0x6d7380,
      hemiGround: 0x14191f,
      hemi: 0.5,
    },
    {
      at: 3,
      zenith: 0x6f7a85,
      horizon: 0xb7aea4,
      hemiSky: 0x9ea3a8,
      hemiGround: 0x232c33,
      hemi: 0.75,
    },
    {
      at: 12,
      zenith: 0x7d8991,
      horizon: 0xaab4ba,
      hemiSky: 0xaeb8bd,
      hemiGround: 0x2a353b,
      hemi: 0.95,
    },
    {
      at: 45,
      zenith: 0x808c94,
      horizon: 0xb0b9be,
      hemiSky: 0xb6bfc4,
      hemiGround: 0x2d383e,
      hemi: 1.0,
    },
  ],
  storm: [
    {
      at: -18,
      zenith: 0x04060a,
      horizon: 0x0a0f14,
      hemiSky: 0x141c26,
      hemiGround: 0x040608,
      hemi: 0.18,
    },
    {
      at: -9,
      zenith: 0x0d141b,
      horizon: 0x1d262d,
      hemiSky: 0x222d38,
      hemiGround: 0x06080b,
      hemi: 0.26,
    },
    {
      at: -3,
      zenith: 0x2c3a3e,
      horizon: 0x4a5a58,
      hemiSky: 0x3d4b52,
      hemiGround: 0x0e1317,
      hemi: 0.38,
    },
    {
      at: 3,
      zenith: 0x3f4f52,
      horizon: 0x6a7a74,
      hemiSky: 0x56656b,
      hemiGround: 0x161d21,
      hemi: 0.5,
    },
    {
      at: 12,
      zenith: 0x45565a,
      horizon: 0x70807c,
      hemiSky: 0x5b6b70,
      hemiGround: 0x1a2226,
      hemi: 0.6,
    },
    {
      at: 45,
      zenith: 0x485a5c,
      horizon: 0x74847f,
      hemiSky: 0x5f6f73,
      hemiGround: 0x1c2428,
      hemi: 0.65,
    },
  ],
  fog: [
    {
      at: -18,
      zenith: 0x070a0f,
      horizon: 0x1a2029,
      hemiSky: 0x202a38,
      hemiGround: 0x05070a,
      hemi: 0.22,
    },
    {
      at: -9,
      zenith: 0x1a212b,
      horizon: 0x3a424d,
      hemiSky: 0x33404f,
      hemiGround: 0x080b0f,
      hemi: 0.3,
    },
    {
      at: -3,
      zenith: 0x6b7480,
      horizon: 0xa59b9b,
      hemiSky: 0x7d8592,
      hemiGround: 0x161b21,
      hemi: 0.6,
    },
    {
      at: 3,
      zenith: 0x93a0aa,
      horizon: 0xc7c3bb,
      hemiSky: 0xaeb4ba,
      hemiGround: 0x28323a,
      hemi: 0.95,
    },
    {
      at: 12,
      zenith: 0xa7b3bb,
      horizon: 0xd0d5d6,
      hemiSky: 0xc2cacf,
      hemiGround: 0x2f3b42,
      hemi: 1.25,
    },
    {
      at: 45,
      zenith: 0xb0bcc3,
      horizon: 0xd6dadb,
      hemiSky: 0xcad2d6,
      hemiGround: 0x323e45,
      hemi: 1.35,
    },
  ],
};

/** How much of each weather mood is on the sky, each 0–1. */
export interface LightingWeather {
  /** Cloud cover: blends clear toward overcast. */
  cloud01: number;
  /** Thunderstorm: blends toward the storm column on top of the overcast. */
  storm01: number;
  /** Fog and haze: blends toward the fog column last. */
  fog01: number;
}

export interface LightingSample {
  zenith: THREE.Color;
  horizon: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  /** Hemisphere light intensity before the moonlight floor. */
  hemi: number;
}

export function createLightingSample(): LightingSample {
  return {
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemi: 0,
  };
}

type Colors = Record<'zenith' | 'horizon' | 'hemiSky' | 'hemiGround', THREE.Color>;
const work: Colors = {
  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
};
const ca = new THREE.Color();
const cb = new THREE.Color();

/** One column at an elevation, interpolated between its two nearest rows. */
function sampleColumn(keys: readonly LutKey[], elevationDeg: number, out: Colors): number {
  let i = 0;
  while (i < keys.length - 2 && (keys[i + 1] as LutKey).at < elevationDeg) i++;
  const a = keys[i] as LutKey;
  const b = keys[i + 1] as LutKey;
  const t = Math.min(1, Math.max(0, (elevationDeg - a.at) / (b.at - a.at)));
  const mix = (x: number, y: number, target: THREE.Color): void => {
    target.copy(ca.setHex(x)).lerp(cb.setHex(y), t);
  };
  mix(a.zenith, b.zenith, out.zenith);
  mix(a.horizon, b.horizon, out.horizon);
  mix(a.hemiSky, b.hemiSky, out.hemiSky);
  mix(a.hemiGround, b.hemiGround, out.hemiGround);
  return a.hemi + (b.hemi - a.hemi) * t;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * The sky and ambient colors for a sun elevation and the weather: clear blended toward
 * overcast by the cloud cover, then toward storm, then toward fog. The fog column is held
 * to 80% so a thick bank still keeps a hint of the time of day.
 */
export function sampleLighting(
  elevationDeg: number,
  weather: LightingWeather,
  out: LightingSample,
): void {
  let hemi = sampleColumn(LIGHTING_LUTS.clear, elevationDeg, out);
  const blend = (column: LutColumn, weight: number): void => {
    if (weight <= 0) return;
    const h = sampleColumn(LIGHTING_LUTS[column], elevationDeg, work);
    out.zenith.lerp(work.zenith, weight);
    out.horizon.lerp(work.horizon, weight);
    out.hemiSky.lerp(work.hemiSky, weight);
    out.hemiGround.lerp(work.hemiGround, weight);
    hemi += (h - hemi) * weight;
  };
  // Scattered cloud leaves the sky blue; the lid comes down as the cover passes half.
  blend('overcast', smoothstep(0.2, 1, weather.cloud01));
  blend('storm', clamp01(weather.storm01));
  blend('fog', 0.8 * clamp01(weather.fog01));
  out.hemi = hemi;
}

/** Fog amount, 0–1, from the haze visibility in meters: 0 at 15 km and up, 1 at 2 km. */
export function fogAmount(visibilityM: number): number {
  const v = Math.max(visibilityM, 1);
  return clamp01((Math.log(15_000) - Math.log(v)) / (Math.log(15_000) - Math.log(2_000)));
}
