/**
 * Procedural noise for the wind and swell beds (plan 15 §3.1: "layered procedural wind
 * and wave noise"). Generated once at start-up as short seamless loops; filters and gains
 * shape them live, so there is nothing to download.
 */

export type NoiseColor = 'pink' | 'brown';

/** RMS level of a generated loop, before any filtering. */
const TARGET_RMS = 0.1;
const LOOP_FADE_S = 0.25;

/**
 * `length` samples of colored noise whose end runs seamlessly into its start, scaled to
 * a fixed RMS. Pink uses Paul Kellet's economy filter; brown is leaky-integrated white.
 */
export function noiseSamples(
  length: number,
  color: NoiseColor,
  sampleRate: number,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer> {
  const fade = Math.min(Math.round(LOOP_FADE_S * sampleRate), Math.floor(length / 2));
  const raw = new Float32Array(length + fade);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let brown = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = random() * 2 - 1;
    if (color === 'pink') {
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      raw[i] = b0 + b1 + b2 + white * 0.1848;
    } else {
      brown = 0.995 * brown + white * 0.05;
      raw[i] = brown;
    }
  }

  // Equal-power crossfade of the extra tail into the head.
  const out = raw.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const t = (i + 0.5) / fade;
    out[i] =
      (raw[i] as number) * Math.sin((t * Math.PI) / 2) +
      (raw[length + i] as number) * Math.cos((t * Math.PI) / 2);
  }

  let mean = 0;
  for (const s of out) mean += s;
  mean /= length;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    out[i] = (out[i] as number) - mean;
    sum += (out[i] as number) ** 2;
  }
  const gain = TARGET_RMS / Math.sqrt(Math.max(sum / length, 1e-12));
  for (let i = 0; i < length; i++) out[i] = (out[i] as number) * gain;
  return out;
}

export function createNoiseBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  color: NoiseColor,
): AudioBuffer {
  const length = Math.round(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  buffer.copyToChannel(noiseSamples(length, color, ctx.sampleRate), 0);
  return buffer;
}
