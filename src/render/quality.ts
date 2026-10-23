/**
 * Quality presets (plan 01 §5, §11.1 task 8). Medium is the baseline the budgets are
 * written for; Low is the 30 fps floor. Values here are the Phase 0 starting points and
 * get tuned by the spikes.
 */

export type QualityId = 'low' | 'medium' | 'high';

export const QUALITY_IDS: readonly QualityId[] = ['low', 'medium', 'high'];

export interface QualityPreset {
  id: QualityId;
  label: string;
  /** Dynamic resolution range, as a fraction of the CSS-pixel size. */
  resolutionScale: { min: number; max: number };
  /** Cap on devicePixelRatio before the resolution scale is applied. */
  maxPixelRatio: number;
  /** MSAA is fixed when the WebGL context is created, so changing it needs a reload. */
  antialias: boolean;
  /** Frame time the dynamic resolution aims for, milliseconds. */
  targetFrameMs: number;
  /** Gerstner waves drawn by the water shader (plan 04 §6.2). Buoyancy always uses 4. */
  waveCount: number;
  /** Foam on steep crests (plan 04 §7). */
  crestFoam: boolean;
  /** Water grid density: rings out from the camera and segments around each ring. */
  waterRings: number;
  waterSegments: number;
}

export const QUALITY_PRESETS: Record<QualityId, QualityPreset> = {
  low: {
    id: 'low',
    label: 'Low',
    resolutionScale: { min: 0.6, max: 0.75 },
    maxPixelRatio: 1,
    antialias: false,
    targetFrameMs: 1000 / 30,
    waveCount: 4,
    crestFoam: false,
    waterRings: 56,
    waterSegments: 96,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    resolutionScale: { min: 0.85, max: 1 },
    maxPixelRatio: 1,
    antialias: false,
    targetFrameMs: 1000 / 60,
    waveCount: 6,
    crestFoam: true,
    waterRings: 80,
    waterSegments: 144,
  },
  high: {
    id: 'high',
    label: 'High',
    resolutionScale: { min: 1, max: 1 },
    maxPixelRatio: 2,
    antialias: true,
    targetFrameMs: 1000 / 60,
    waveCount: 8,
    crestFoam: true,
    waterRings: 112,
    waterSegments: 192,
  },
};

export const DEFAULT_QUALITY: QualityId = 'medium';

// Phase 0 keeps the choice in localStorage; it moves to the IndexedDB settings store
// with the settings screen in Phase 1 (plan 16 §2).
const STORAGE_KEY = 'glp.quality';

/** window.localStorage, or undefined where touching it throws (some private modes). */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function isQualityId(value: unknown): value is QualityId {
  return typeof value === 'string' && (QUALITY_IDS as readonly string[]).includes(value);
}

/** `?quality=low` wins, then the stored choice, then the default. */
export function initialQuality(search: string, storage?: Pick<Storage, 'getItem'>): QualityId {
  const fromUrl = new URLSearchParams(search).get('quality');
  if (isQualityId(fromUrl)) return fromUrl;
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    if (isQualityId(stored)) return stored;
  } catch {
    // Storage can throw in private windows; fall through to the default.
  }
  return DEFAULT_QUALITY;
}

export function storeQuality(id: QualityId, storage?: Pick<Storage, 'setItem'>): void {
  try {
    storage?.setItem(STORAGE_KEY, id);
  } catch {
    // Not fatal: the preset just won't stick across reloads.
  }
}
