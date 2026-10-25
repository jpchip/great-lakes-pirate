import { R_SAILING } from '../../core/time';
import { fractalNoise, valueNoise } from './noise';
import {
  bakeSeaScale,
  createSeaScaleBaker,
  easeSeaShape,
  retuneSea,
  seaShapeChanged,
  targetSeaShape,
  waveSet,
  wrapAngle,
  type SeaScaleBake,
  type SeaScaleBaker,
  type SeaShape,
} from './sea-state';
import { OPEN_WATER, type ShelterField } from './shelter';
import { moonAt, sunAt } from './celestial';
import { CLEAR_VISIBILITY_M, type Wind } from './weather';
import { seaScaleAt, type PackedWave, type Sea } from './waves';

/**
 * The Phase 1 weather (plan 02 §11, plan 04 §15): one dev-panel wind for the whole zone
 * with slow drift and gusts, the island lee and channel funneling from the baked maps, a
 * sea that builds from that wind, and a scripted gale. It answers the plan 02 §11 queries
 * with the same Wind shape as the S9 sim, so Phase 2 can swap the source underneath.
 *
 * Positions are zone meters (x east, z south). Time is game seconds, the clock the S9 sim
 * runs on: at R = 24 a game hour is 2.5 real minutes.
 */

export interface WeatherSettings {
  /** Where the wind comes from, degrees clockwise from north. */
  fromDeg: number;
  /** Sustained open-water wind, game knots. */
  speedKn: number;
  /** Amplitude of the slow direction drift, degrees. */
  driftDeg: number;
  /** Amplitude of the slow speed drift, a fraction of speedKn. */
  surge: number;
  /** How gusty, 0–1. Gust strength peaks at this. */
  gustiness: number;
  /** Fog and haze visibility, meters. */
  visibilityM: number;
  /** Cloud cover, 0–1: darkens and grays the sky. */
  cloud01: number;
  /** Wave height multiplier on top of the wind sea (dev panel). */
  seaGain: number;
  /** Game minutes for the sea to catch up with the wind (e-folding); 0 is instant. */
  seaLagMin: number;
}

export type WeatherPresetId = 'calm' | 'light' | 'moderate' | 'fresh' | 'strong' | 'gale';

const BASE: WeatherSettings = {
  fromDeg: 315,
  speedKn: 14,
  driftDeg: 12,
  surge: 0.15,
  gustiness: 0.35,
  visibilityM: 20_000,
  cloud01: 0.3,
  seaGain: 1,
  seaLagMin: 45,
};

/** Steady states across the plan 02 §3.5 wind bands. */
export const WEATHER_PRESETS: Record<WeatherPresetId, WeatherSettings> = {
  calm: { ...BASE, speedKn: 2, gustiness: 0.05, visibilityM: 3_000, cloud01: 0.2 },
  light: { ...BASE, speedKn: 7, gustiness: 0.2, cloud01: 0.15 },
  moderate: { ...BASE },
  fresh: { ...BASE, speedKn: 21, gustiness: 0.5, cloud01: 0.45 },
  strong: { ...BASE, speedKn: 26, gustiness: 0.6, cloud01: 0.7, visibilityM: 12_000 },
  gale: { ...BASE, speedKn: 36, gustiness: 0.8, cloud01: 0.95, visibilityM: 4_000 },
};

export function weatherPreset(id: WeatherPresetId): WeatherSettings {
  return { ...WEATHER_PRESETS[id] };
}

/** One step of the scripted gale. `atMin` is real minutes after the start at R = 24. */
export interface GaleKey {
  atMin: number;
  fromDeg: number;
  speedKn: number;
  gustiness: number;
  visibilityM: number;
  cloud01: number;
}

/**
 * The scripted gale (plan 02 §14 acceptance): a November blow on Superior. The wind
 * backs into the northeast and builds through gale force within three real minutes, so
 * a ship at Full sail is overpressed, holds past 40 kn, then veers northwest on the back
 * side and eases. About eleven real minutes from first warning to moderate.
 */
export const GALE_SCRIPT: readonly GaleKey[] = [
  { atMin: 0, fromDeg: 120, speedKn: 14, gustiness: 0.3, visibilityM: 15_000, cloud01: 0.6 },
  { atMin: 1.5, fromDeg: 90, speedKn: 26, gustiness: 0.55, visibilityM: 8_000, cloud01: 0.85 },
  { atMin: 3, fromDeg: 60, speedKn: 38, gustiness: 0.8, visibilityM: 2_500, cloud01: 1 },
  { atMin: 6, fromDeg: 35, speedKn: 44, gustiness: 0.9, visibilityM: 2_000, cloud01: 1 },
  { atMin: 8, fromDeg: 330, speedKn: 38, gustiness: 0.8, visibilityM: 6_000, cloud01: 0.85 },
  { atMin: 11, fromDeg: 315, speedKn: 20, gustiness: 0.45, visibilityM: 15_000, cloud01: 0.5 },
];

/** The wind's speed loss at full shelter: a deep lee keeps a breath of air (plan 02 §11). */
export const SHELTER_WIND_LOSS = 0.85;
/** Speed-up at full funneling strength: a channel squeezes the wind by up to 30%. */
export const FUNNEL_GAIN = 0.3;
/** Extra gust strength at the edge of a lee, where the air tumbles off the land. */
export const LEE_EDGE_GUST = 0.35;
/** The scale grid is rebaked when the wind turns this far. */
const REBAKE_TURN_RAD = (4 * Math.PI) / 180;
/** Rows of the scale grid baked per tick: a 256-row grid takes about half a second. */
const BAKE_ROWS_PER_TICK = 16;
const HOUR = 3600;

export interface WindReading extends Wind {
  /** The shelter at this spot, 0–1, for the HUD and debug readout. */
  shelter01: number;
}

export interface WaveParams {
  /** The zone's wave set (shared GPU/CPU); never cache it across ticks. */
  waves: readonly PackedWave[];
  /** Local calming by shelter and fetch at this spot; scales amplitude and steepness. */
  scale: number;
  /** Significant wave height here, meters. */
  hsM: number;
}

export interface LocalWeather {
  readonly settings: WeatherSettings;
  /** Shelter, fetch and funneling. Swap in the real maps when the terrain loads. */
  shelter: ShelterField;
  /** Seed for the stateless drift and gust noise. */
  readonly noiseSeed: number;
  windAt(p: { x: number; z: number }, gameSeconds: number): WindReading;
  waveParams(p: { x: number; z: number }): WaveParams;
  iceAt(
    p: { x: number; z: number },
    gameSeconds: number,
  ): { coverage01: number; thickness: number };
  /** Gameplay visibility: fog, and the dark at night (plan 02 §11). */
  visibilityAt(p: { x: number; z: number }, gameSeconds: number): number;
  /** Fog and haze alone, for the renderer; the night is drawn, not fogged. */
  fogVisibilityAt(gameSeconds: number): number;
  cloudAt(gameSeconds: number): number;
  /** The sea's current shape, after lag. */
  readonly seaShape: SeaShape;
  applyPreset(id: WeatherPresetId): void;
  /** Starts the scripted gale at this game time. */
  startGale(gameSeconds: number): void;
  readonly galeActive: boolean;
  /**
   * Rebuild the sea from the wind. Call once per gameplay tick after the clocks advance;
   * `anchor` is where the surface must not jump (the player).
   */
  tick(gameSeconds: number, anchor: { x: number; z: number }, sea: Sea): void;
  /** Rebake the shelter scale now (after swapping `shelter`). */
  invalidate(): void;
}

interface Base {
  fromRad: number;
  speedKn: number;
  gustiness: number;
  visibilityM: number;
  cloud01: number;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerpAngleDeg(a: number, b: number, t: number): number {
  let d = ((((b - a) % 360) + 540) % 360) - 180;
  if (d === -180) d = 180;
  return a + d * t;
}

/** The gale's steady state `elapsedGameS` after it started; undefined once it's over. */
export function galeAt(elapsedGameS: number): GaleKey | undefined {
  const min = elapsedGameS / 60 / R_SAILING;
  const last = GALE_SCRIPT[GALE_SCRIPT.length - 1] as GaleKey;
  if (min < 0 || min > last.atMin) return undefined;
  let i = 0;
  while (i < GALE_SCRIPT.length - 2 && (GALE_SCRIPT[i + 1] as GaleKey).atMin < min) i++;
  const a = GALE_SCRIPT[i] as GaleKey;
  const b = GALE_SCRIPT[i + 1] as GaleKey;
  const t = smoothstep(Math.min(1, Math.max(0, (min - a.atMin) / (b.atMin - a.atMin))));
  const mix = (x: number, y: number): number => x + (y - x) * t;
  return {
    atMin: min,
    fromDeg: lerpAngleDeg(a.fromDeg, b.fromDeg, t),
    speedKn: mix(a.speedKn, b.speedKn),
    gustiness: mix(a.gustiness, b.gustiness),
    visibilityM: Math.exp(mix(Math.log(a.visibilityM), Math.log(b.visibilityM))),
    cloud01: mix(a.cloud01, b.cloud01),
  };
}

export function createLocalWeather(
  settings: WeatherSettings = weatherPreset('moderate'),
  shelter: ShelterField = OPEN_WATER,
  noiseSeed = 0x51ea,
): LocalWeather {
  let galeStart: number | undefined;
  let shape: SeaShape | undefined;
  let bakedFromRad: number | undefined;
  let referenceFetchM = 0;
  let lastTick: number | undefined;
  let baker: { fromRad: number; baker: SeaScaleBaker } | undefined;
  let seaRef: Sea | undefined;

  const baseAt = (t: number): Base => {
    if (galeStart !== undefined) {
      const g = galeAt(t - galeStart);
      if (g) {
        return {
          fromRad: (g.fromDeg * Math.PI) / 180,
          speedKn: g.speedKn,
          gustiness: g.gustiness,
          visibilityM: g.visibilityM,
          cloud01: g.cloud01,
        };
      }
    }
    return {
      fromRad: (settings.fromDeg * Math.PI) / 180,
      speedKn: settings.speedKn,
      gustiness: settings.gustiness,
      visibilityM: settings.visibilityM,
      cloud01: settings.cloud01,
    };
  };

  /** The open-water wind before shelter: base plus slow drift (as S9's windAt). */
  const openWind = (t: number): { fromRad: number; speedKn: number; gustiness: number } => {
    const base = baseAt(t);
    const hours = t / HOUR;
    const veer = ((settings.driftDeg * Math.PI) / 180) * fractalNoise(noiseSeed, hours / 3);
    const surge = 1 + settings.surge * fractalNoise(noiseSeed + 7, hours / 2);
    return {
      fromRad: wrapAngle(base.fromRad + veer),
      speedKn: Math.max(0, base.speedKn * surge),
      gustiness: base.gustiness,
    };
  };

  const weather: LocalWeather = {
    settings,
    shelter,
    noiseSeed,

    windAt(p, t) {
      const open = openWind(t);
      const s = weather.shelter.shelterAt(p.x, p.z, open.fromRad);
      const funnel = 1 + FUNNEL_GAIN * weather.shelter.funnelAt(p.x, p.z, open.fromRad);
      const speedKn = open.speedKn * (1 - SHELTER_WIND_LOSS * s) * funnel;
      // Gusts as S9: a few seconds each, never in a near calm, livelier at the lee's edge.
      const gustNoise = 0.5 + 0.5 * valueNoise(noiseSeed + 13, t / 90);
      const edge = LEE_EDGE_GUST * 4 * s * (1 - s);
      const gust01 = Math.max(
        0,
        Math.min(1, Math.min(1, open.gustiness + edge) * gustNoise * Math.min(1, speedKn / 8)),
      );
      // The air moves away from fromRad; north is +y in the S9 vector.
      const toKn = { x: -Math.sin(open.fromRad) * speedKn, y: -Math.cos(open.fromRad) * speedKn };
      return { fromRad: open.fromRad, speedKn, gust01, toKn, shelter01: s };
    },

    waveParams(p) {
      const scale = seaRef ? seaScaleAt(seaRef, p.x, p.z) : 1;
      return { waves: seaRef?.waves ?? [], scale, hsM: (shape?.hsM ?? 0) * scale };
    },

    iceAt: () => ({ coverage01: 0, thickness: 0 }),

    visibilityAt(_p, t) {
      const fog = weather.fogVisibilityAt(t);
      const sun = sunAt(t).elevationRad;
      if (sun > 0) return fog;
      // Night: a moonless overcast night sees a few hundred meters; a full moon, ~2 km.
      const moon = moonAt(t);
      const moonlight = moon.elevationRad > 0 ? moon.illumination01 : 0;
      const dark = Math.min(1, -sun / ((12 * Math.PI) / 180));
      const nightM = (300 + 1700 * moonlight) * (1 - 0.6 * weather.cloudAt(t));
      return Math.min(fog, Math.exp(Math.log(fog) * (1 - dark) + Math.log(nightM) * dark));
    },

    fogVisibilityAt(t) {
      return Math.min(baseAt(t).visibilityM, CLEAR_VISIBILITY_M);
    },

    cloudAt(t) {
      return baseAt(t).cloud01;
    },

    get seaShape() {
      return shape ?? targetSeaShape(settings.speedKn, 0, referenceFetchM || 1, settings.seaGain);
    },

    applyPreset(id) {
      Object.assign(settings, WEATHER_PRESETS[id]);
      galeStart = undefined;
    },

    startGale(t) {
      galeStart = t;
    },

    get galeActive() {
      return galeStart !== undefined;
    },

    tick(t, anchor, sea) {
      seaRef = sea;
      const dtGame = lastTick === undefined ? 0 : Math.max(0, t - lastTick);
      lastTick = t;
      if (galeStart !== undefined && !galeAt(t - galeStart)) {
        // Leave the panel on the gale's last state so nothing jumps when it ends.
        const last = GALE_SCRIPT[GALE_SCRIPT.length - 1] as GaleKey;
        Object.assign(settings, {
          fromDeg: last.fromDeg,
          speedKn: last.speedKn,
          gustiness: last.gustiness,
          visibilityM: last.visibilityM,
          cloud01: last.cloud01,
        });
        galeStart = undefined;
      }
      const open = openWind(t);

      const apply = (fromRad: number, bake: SeaScaleBake): void => {
        sea.scale = bake.grid;
        sea.scaleVersion++;
        referenceFetchM = bake.referenceFetchM;
        bakedFromRad = fromRad;
      };
      if (bakedFromRad === undefined) {
        // First tick, or the shelter changed: bake all at once so the lee is right away.
        baker = undefined;
        apply(open.fromRad, bakeSeaScale(weather.shelter, open.fromRad));
      } else if (baker) {
        const bake = baker.baker.step(BAKE_ROWS_PER_TICK);
        if (bake) {
          apply(baker.fromRad, bake);
          baker = undefined;
        }
      } else {
        let turned = Math.abs(wrapAngle(open.fromRad - bakedFromRad));
        turned = Math.min(turned, 2 * Math.PI - turned);
        if (turned >= REBAKE_TURN_RAD) {
          baker = {
            fromRad: open.fromRad,
            baker: createSeaScaleBaker(weather.shelter, open.fromRad),
          };
        }
      }

      const target = targetSeaShape(open.speedKn, open.fromRad, referenceFetchM, settings.seaGain);
      const next = shape
        ? easeSeaShape(shape, target, dtGame, settings.seaLagMin * 60)
        : { ...target };
      if (!shape || seaShapeChanged(shape, next)) {
        retuneSea(sea, waveSet(next), anchor.x, anchor.z);
      }
      shape = next;
    },

    invalidate() {
      bakedFromRad = undefined;
    },
  };

  return weather;
}
