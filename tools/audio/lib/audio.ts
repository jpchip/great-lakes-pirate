import { z } from 'zod';
import { provenanceSchema } from '../../assets/lib/hull.ts';

/**
 * The pure parts of the audio pipeline (plan 15 §9): per-sound hints, the provenance
 * record, and the sample processing (trim, fades, seamless loops, level normalizing).
 * tools/audio/build.ts does the file and ffmpeg work around them.
 */

export const SAMPLE_RATE = 48000;

export const soundHintsSchema = z.object({
  /** Manifest id, e.g. "sfx.sail.luff". */
  id: z.string().regex(/^[a-z]+(\.[a-z0-9-]+)+$/),
  /** Output file name, without extension. */
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  /** The raw file inside the folder, as downloaded or recorded. */
  source: z.string().min(1),
  /** Loops get a crossfaded seam and no edge fades; one-shots get short edge fades. */
  kind: z.enum(['loop', 'oneshot']),
  /** The mixer bus it plays on; it also picks the level target and bitrate. */
  bus: z.enum(['music', 'ambience', 'sfx', 'voice', 'ui']),
  /** Keep only this part of the source, seconds. */
  trimStartS: z.number().nonnegative().default(0),
  trimEndS: z.number().positive().optional(),
  /** Loops only: how much of the tail is crossfaded into the head. */
  loopCrossfadeS: z.number().nonnegative().default(0),
  /** One-shots only: a longer fade-out than the default 30 ms, for clips cut mid-sound. */
  fadeOutS: z.number().positive().optional(),
  /** High-pass the source at this frequency while decoding, Hz (wind rumble, hum). */
  highpassHz: z.number().positive().optional(),
  bundles: z.array(z.string().min(1)).min(1),
});
export type SoundHints = z.infer<typeof soundHintsSchema>;

/** raw-assets/audio/<category>/<name>/provenance.json: the plan 14 §6 record. */
export const audioProvenanceSchema = provenanceSchema.extend({
  /** The file name inside the pack or download, so it can be found again. */
  originalFile: z.string().optional(),
});
export type AudioProvenance = z.infer<typeof audioProvenanceSchema>;

/** Licenses a shipped sound may carry (plan 15 §3.2: no NC or ND). */
export const ALLOWED_AUDIO_LICENSES = ['CC0 1.0', 'CC BY 4.0', 'Public domain'] as const;

/**
 * Level targets per bus (plan 15 §9). Beds are normalized by loudness; we approximate
 * LUFS with plain RMS, which is close enough for broadband noise like wind and water.
 * One-shots are peak-normalized so their gain in code means the same thing for each.
 */
export const LEVELS = {
  music: { mode: 'rms', db: -18 },
  ambience: { mode: 'rms', db: -24 },
  sfx: { mode: 'peak', db: -1 },
  voice: { mode: 'peak', db: -1 },
  ui: { mode: 'peak', db: -3 },
} as const satisfies Record<SoundHints['bus'], { mode: 'rms' | 'peak'; db: number }>;

/** Opus bitrates, kbps (plan 15 §9). */
export const BITRATES: Record<SoundHints['bus'], number> = {
  music: 112,
  ambience: 64,
  sfx: 56,
  voice: 48,
  ui: 48,
};

const EDGE_FADE_IN_S = 0.004;
const EDGE_FADE_OUT_S = 0.03;

export function trim(samples: Float32Array, hints: SoundHints, rate = SAMPLE_RATE): Float32Array {
  const start = Math.min(samples.length, Math.round(hints.trimStartS * rate));
  const end =
    hints.trimEndS === undefined
      ? samples.length
      : Math.min(samples.length, Math.round(hints.trimEndS * rate));
  return samples.slice(start, Math.max(start, end));
}

/** Short linear fades so a one-shot never starts or stops with a click. */
export function fadeEdges(
  samples: Float32Array,
  rate = SAMPLE_RATE,
  fadeOutS = EDGE_FADE_OUT_S,
): Float32Array {
  const out = samples.slice();
  const fadeIn = Math.min(out.length, Math.round(EDGE_FADE_IN_S * rate));
  const fadeOut = Math.min(out.length, Math.round(fadeOutS * rate));
  for (let i = 0; i < fadeIn; i++) out[i] = (out[i] as number) * (i / fadeIn);
  for (let i = 0; i < fadeOut; i++) {
    const j = out.length - 1 - i;
    out[j] = (out[j] as number) * (i / fadeOut);
  }
  return out;
}

/**
 * Makes a seamless loop by crossfading the last `fade` samples into the first ones with
 * an equal-power curve. The result is `fade` samples shorter, and its last sample runs
 * straight on into its first.
 */
export function crossfadeLoop(
  samples: Float32Array,
  fadeS: number,
  rate = SAMPLE_RATE,
): Float32Array {
  const fade = Math.min(Math.round(fadeS * rate), Math.floor(samples.length / 2));
  if (fade <= 0) return samples.slice();
  const n = samples.length - fade;
  const out = samples.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const t = (i + 0.5) / fade;
    const head = Math.sin((t * Math.PI) / 2);
    const tail = Math.cos((t * Math.PI) / 2);
    out[i] = (samples[i] as number) * head + (samples[n + i] as number) * tail;
  }
  return out;
}

export function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return 20 * Math.log10(Math.max(peak, 1e-9));
}

export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return 10 * Math.log10(Math.max(sum / Math.max(samples.length, 1), 1e-18));
}

/** Scales to the bus's level target, never past -1 dBFS peak. Returns the gain in dB too. */
export function normalize(
  samples: Float32Array,
  bus: SoundHints['bus'],
): { samples: Float32Array; gainDb: number } {
  const level = LEVELS[bus];
  const current = level.mode === 'rms' ? rmsDb(samples) : peakDb(samples);
  const headroom = -1 - peakDb(samples);
  const gainDb = Math.min(level.db - current, headroom);
  const gain = 10 ** (gainDb / 20);
  return { samples: samples.map((s) => s * gain), gainDb };
}

/** Runs the sample steps for one sound and lists what it did, for the provenance sidecar. */
export function processSound(
  samples: Float32Array,
  hints: SoundHints,
  rate = SAMPLE_RATE,
): { samples: Float32Array; steps: string[] } {
  const steps = [
    `decoded to mono ${rate} Hz` +
      (hints.highpassHz !== undefined ? `, high-passed at ${hints.highpassHz} Hz` : ''),
  ];
  let out = trim(samples, hints, rate);
  if (hints.trimStartS > 0 || hints.trimEndS !== undefined) {
    steps.push(`trimmed to ${hints.trimStartS}–${hints.trimEndS ?? 'end'} s`);
  }
  if (hints.kind === 'loop') {
    out = crossfadeLoop(out, hints.loopCrossfadeS, rate);
    if (hints.loopCrossfadeS > 0) steps.push(`loop seam crossfaded over ${hints.loopCrossfadeS} s`);
  } else {
    out = fadeEdges(out, rate, hints.fadeOutS);
    steps.push(
      hints.fadeOutS !== undefined ? `edge fades (${hints.fadeOutS} s out)` : 'edge fades',
    );
  }
  const normalized = normalize(out, hints.bus);
  const level = LEVELS[hints.bus];
  steps.push(
    `${level.mode === 'rms' ? 'RMS' : 'peak'}-normalized toward ${level.db} dB ` +
      `(${normalized.gainDb >= 0 ? '+' : ''}${normalized.gainDb.toFixed(1)} dB)`,
  );
  steps.push(`Opus ${BITRATES[hints.bus]} kbps mono in Ogg (ffmpeg libopus)`);
  return { samples: normalized.samples, steps };
}

export interface AudioManifest {
  version: 1;
  assets: Record<string, { type: string; url: string; bytes?: number }>;
  bundles: Record<string, string[]>;
}

/** Add or replace one audio entry and list it in its bundles, keeping everything else. */
export function withAudioEntry(
  manifest: AudioManifest,
  hints: SoundHints,
  category: string,
  bytes: number,
): AudioManifest {
  const bundles = { ...manifest.bundles };
  for (const bundle of hints.bundles) {
    const ids = bundles[bundle] ?? [];
    bundles[bundle] = ids.includes(hints.id) ? ids : [...ids, hints.id];
  }
  return {
    ...manifest,
    assets: {
      ...manifest.assets,
      [hints.id]: { type: 'audio', url: `${category}/${hints.name}.ogg`, bytes },
    },
    bundles,
  };
}
