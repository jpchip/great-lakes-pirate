import { z } from 'zod';

/**
 * Per-bus volumes (plan 15 §7), kept in settings outside the run save (plan 16 §2). The
 * settings menu (plan 13 §12) edits them; until it exists, the dev overlay does.
 */

export const BUS_IDS = ['music', 'ambience', 'sfx', 'voice', 'ui'] as const;
export type BusId = (typeof BUS_IDS)[number];
export type VolumeId = 'master' | BusId;

const volume = z.number().min(0).max(1);

export const audioSettingsSchema = z.object({
  master: volume.default(0.8),
  music: volume.default(0.7),
  ambience: volume.default(0.8),
  sfx: volume.default(0.8),
  voice: volume.default(0.8),
  ui: volume.default(0.6),
  muted: z.boolean().default(false),
});
export type AudioSettings = z.infer<typeof audioSettingsSchema>;

export const AUDIO_SETTINGS_KEY = 'glp.settings.audio';

export function defaultAudioSettings(): AudioSettings {
  return audioSettingsSchema.parse({});
}

/** The stored settings, falling back field by field to the defaults. */
export function loadAudioSettings(storage?: Pick<Storage, 'getItem'>): AudioSettings {
  try {
    const raw = storage?.getItem(AUDIO_SETTINGS_KEY);
    if (!raw) return defaultAudioSettings();
    const parsed = audioSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultAudioSettings();
  } catch {
    return defaultAudioSettings();
  }
}

export function saveAudioSettings(
  settings: AudioSettings,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private windows and full storage: the volumes just won't persist.
  }
}

/** Slider position to gain: a squared curve, so the middle of the slider sounds like half. */
export function volumeToGain(volume: number): number {
  const v = Math.min(Math.max(volume, 0), 1);
  return v * v;
}
