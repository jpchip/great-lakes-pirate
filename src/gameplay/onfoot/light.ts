import { daylight01, moonlight01, type SkyLight } from '../../sim/law/perception';

/**
 * Light on foot (plan 08 §4.1, §11; Phase 7 piece D): how lit the player is right now, 0
 * (pitch dark) to 1 (daylight). The sky gives the base (the sun, else the moon by its
 * phase and the cloud over it, else starlight), and the nearest lamps add pools on top:
 * gas lamps, lit windows and the lanterns guards carry. No shadow maps: each light is a
 * radius and an intensity, so this runs for a dozen guards many times a second.
 */

/** A light on foot: a gas lamp, a lit window, a lantern. Positions are zone meters. */
export interface Lamp {
  x: number;
  /** The flame's height, meters. */
  y: number;
  z: number;
  /** Meters out to where its pool fades to nothing. */
  radiusM: number;
  /** 0–1 at the foot of the lamp. */
  intensity: number;
  lit: boolean;
}

/** Starlight alone, on a moonless clear night. */
export const STARLIGHT = 0.04;
/** What a full moon high in a clear sky gives. */
export const FULL_MOON = 0.32;

/** The sky's light on the ground, 0–1: day, moonlight by phase and cloud, or starlight. */
export function ambientLight01(sky: SkyLight, fog01 = 0): number {
  const night = (STARLIGHT + FULL_MOON * moonlight01(sky)) * (1 - 0.3 * sky.cloud01);
  const day = daylight01(sky.sunElevationRad);
  // Fog scatters what light there is and swallows the moon's shadows.
  const dimmed = night * (1 - 0.35 * clamp01(fog01));
  return dimmed + (1 - dimmed) * day;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** One lamp's light at a distance: full at the post, easing to nothing at its radius. */
export function lampFalloff(distanceM: number, radiusM: number): number {
  if (distanceM >= radiusM) return 0;
  const t = 1 - (distanceM / radiusM) ** 2;
  return t * t;
}

/** The light at a point and where it comes from. */
export interface LightReading {
  /** Everything together, 0–1. */
  level01: number;
  /** The sky's part. */
  ambient01: number;
  /** The lamps' part, before the sky is added. */
  lamps01: number;
  /** The brightest lamp on the point, if any lights it. */
  brightest: Lamp | undefined;
}

const BUCKET_M = 8;

/**
 * The district's fixed lamps, bucketed so a query only looks at the few nearby (plan 08
 * §4.1: "the nearest few"). Carried lanterns move every tick and are passed per query.
 */
export class LampSet {
  private readonly all: Lamp[] = [];
  private readonly buckets = new Map<string, Lamp[]>();
  private maxRadius = 0;

  constructor(lamps: readonly Lamp[] = []) {
    for (const l of lamps) this.add(l);
  }

  get lamps(): readonly Lamp[] {
    return this.all;
  }

  add(l: Lamp): void {
    this.all.push(l);
    this.maxRadius = Math.max(this.maxRadius, l.radiusM);
    const key = `${Math.floor(l.x / BUCKET_M)},${Math.floor(l.z / BUCKET_M)}`;
    let list = this.buckets.get(key);
    if (!list) {
      list = [];
      this.buckets.set(key, list);
    }
    list.push(l);
  }

  /** Calls `fn` for every lamp whose pool might reach (x, z). */
  near(x: number, z: number, fn: (l: Lamp) => void): void {
    const r = this.maxRadius;
    const b0x = Math.floor((x - r) / BUCKET_M);
    const b1x = Math.floor((x + r) / BUCKET_M);
    const b0z = Math.floor((z - r) / BUCKET_M);
    const b1z = Math.floor((z + r) / BUCKET_M);
    for (let bz = b0z; bz <= b1z; bz++) {
      for (let bx = b0x; bx <= b1x; bx++) {
        const list = this.buckets.get(`${bx},${bz}`);
        if (list) for (const l of list) fn(l);
      }
    }
  }
}

/** The height on a figure the light is read at: the chest of someone standing. */
export const CHEST_M = 1.2;

/**
 * The light on a figure at (x, y, z) (feet): the sky plus every lamp and lantern in reach,
 * combined so two pools are brighter than one but never more than daylight.
 */
export function lightAt(
  x: number,
  y: number,
  z: number,
  ambient01: number,
  lamps: LampSet,
  carried: readonly Lamp[] = [],
): LightReading {
  let dark = 1;
  let best = 0;
  let brightest: Lamp | undefined;
  const cy = y + CHEST_M;
  const visit = (l: Lamp): void => {
    if (!l.lit) return;
    const d = Math.hypot(l.x - x, l.y - cy, l.z - z);
    const v = l.intensity * lampFalloff(d, l.radiusM);
    if (v <= 0) return;
    dark *= 1 - v;
    if (v > best) {
      best = v;
      brightest = l;
    }
  };
  lamps.near(x, z, visit);
  for (const l of carried) visit(l);
  const lamps01 = 1 - dark;
  return {
    level01: 1 - (1 - ambient01) * dark,
    ambient01,
    lamps01,
    brightest,
  };
}
