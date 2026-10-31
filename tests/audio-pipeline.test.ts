import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOUND } from '../src/audio/sailing-audio';
import {
  MUSIC_BUNDLE,
  MUSIC_CUES,
  SAILING_AUDIO_BUNDLE,
  WORLD_AUDIO_BUNDLE,
} from '../src/audio/game-audio';
import { WORLD_SOUND } from '../src/audio/world-audio';
import { assetManifestSchema } from '../src/core/assets';
import {
  ALLOWED_AUDIO_LICENSES,
  audioProvenanceSchema,
  crossfadeLoop,
  fadeEdges,
  normalize,
  peakDb,
  processSound,
  rmsDb,
  soundHintsSchema,
  withAudioEntry,
} from '../tools/audio/lib/audio';

const RATE = 1000;
const sine = (n: number, freq = 50, amp = 0.5): Float32Array =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / RATE));

const loopHints = soundHintsSchema.parse({
  id: 'amb.test.loop',
  name: 'loop',
  description: 'test',
  source: 'source.wav',
  kind: 'loop',
  bus: 'ambience',
  loopCrossfadeS: 0.1,
  bundles: ['b'],
});

describe('audio pipeline steps (plan 15 §9)', () => {
  it('crossfades a loop so its end runs straight into its start', () => {
    // A ramp has a big jump at the seam; after the crossfade the jump is gone.
    const ramp = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
    const loop = crossfadeLoop(ramp, 0.1, RATE);
    expect(loop.length).toBe(900);
    const seam = Math.abs((loop[0] as number) - (loop[loop.length - 1] as number));
    expect(seam).toBeLessThan(0.01);
  });

  it('fades one-shot edges to silence', () => {
    const out = fadeEdges(
      Float32Array.from({ length: 200 }, () => 1),
      RATE,
    );
    expect(out[0]).toBe(0);
    expect(Math.abs(out[out.length - 1] as number)).toBe(0);
    expect(out[100]).toBe(1);
  });

  it('normalizes ambience by RMS and SFX by peak, never past -1 dBFS', () => {
    const quiet = sine(1000, 50, 0.01);
    const bed = normalize(quiet, 'ambience').samples;
    expect(rmsDb(bed)).toBeCloseTo(-24, 1);
    const hit = normalize(quiet, 'sfx').samples;
    expect(peakDb(hit)).toBeCloseTo(-1, 1);
    // A spiky bed can't reach its RMS target without clipping: the peak limit wins.
    const spiky = new Float32Array(1000);
    spiky[10] = 0.5;
    expect(peakDb(normalize(spiky, 'ambience').samples)).toBeLessThanOrEqual(-0.99);
  });

  it('records a high-pass and a long fade-out when the hints ask for them', () => {
    const hints = soundHintsSchema.parse({
      ...loopHints,
      kind: 'oneshot',
      bus: 'sfx',
      highpassHz: 450,
      fadeOutS: 0.5,
    });
    const { samples, steps } = processSound(sine(2000), hints, RATE);
    expect(steps[0]).toContain('high-passed at 450 Hz');
    expect(steps.join(' ')).toContain('edge fades (0.5 s out)');
    // The last half second ramps down to silence.
    expect(Math.abs(samples[samples.length - 250] as number)).toBeLessThan(0.5);
  });

  it('records each step it took', () => {
    const { samples, steps } = processSound(sine(2000), loopHints, RATE);
    expect(samples.length).toBe(1900);
    expect(steps.join(' ')).toMatch(/crossfaded.*normalized.*Opus 64 kbps/s);
  });

  it('adds manifest entries and bundle membership idempotently', () => {
    const empty = { version: 1 as const, assets: {}, bundles: {} };
    const once = withAudioEntry(empty, loopHints, 'test', 10);
    const twice = withAudioEntry(once, loopHints, 'test', 12);
    expect(twice.assets['amb.test.loop']).toEqual({
      type: 'audio',
      url: 'test/loop.ogg',
      bytes: 12,
    });
    expect(twice.bundles['b']).toEqual(['amb.test.loop']);
  });
});

const ROOT = join(import.meta.dirname, '..');
const RAW = join(ROOT, 'raw-assets', 'audio');
const OUT = join(ROOT, 'public', 'assets', 'audio');
const manifest = assetManifestSchema.parse(
  JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')),
);
const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');

describe('shipped sounds (plan 15 §3.2, §8)', () => {
  const rawDirs = readdirSync(RAW).flatMap((category) =>
    readdirSync(join(RAW, category)).map((name) => ({ category, name })),
  );

  it.each(rawDirs)('raw $category/$name has hints and a license-clean provenance', (d) => {
    const dir = join(RAW, d.category, d.name);
    const hints = soundHintsSchema.parse(JSON.parse(readFileSync(join(dir, 'sound.json'), 'utf8')));
    expect(hints.name).toBe(d.name);
    expect(existsSync(join(dir, hints.source))).toBe(true);
    const prov = audioProvenanceSchema.parse(
      JSON.parse(readFileSync(join(dir, 'provenance.json'), 'utf8')),
    );
    expect(ALLOWED_AUDIO_LICENSES).toContain(prov.license);
    expect(manifest.assets[hints.id]?.url).toBe(`${d.category}/${hints.name}.ogg`);
  });

  it.each(Object.entries(manifest.assets))('%s ships with provenance and a credit', (_, entry) => {
    expect(entry.type).toBe('audio');
    expect(existsSync(join(OUT, entry.url))).toBe(true);
    const sidecar = join(OUT, entry.url.replace(/\.ogg$/, '.provenance.json'));
    const prov = audioProvenanceSchema
      .extend({ pipeline: audioProvenanceSchema.shape.modifications.unwrap() })
      .parse(JSON.parse(readFileSync(sidecar, 'utf8')));
    expect(ALLOWED_AUDIO_LICENSES).toContain(prov.license);
    expect(prov.pipeline.length).toBeGreaterThan(0);
    expect(credits).toContain(`public/assets/audio/${entry.url}`);
  });

  it('has every sound the sailing soundscape plays in its bundle', () => {
    const ids = Object.values(SOUND).flat();
    const bundle = manifest.bundles[SAILING_AUDIO_BUNDLE] ?? [];
    for (const id of ids) expect(bundle, id).toContain(id);
  });

  it('has every sound the world soundscape plays in its bundle, and both music cues', () => {
    const bundle = manifest.bundles[WORLD_AUDIO_BUNDLE] ?? [];
    for (const id of Object.values(WORLD_SOUND).flat()) expect(bundle, id).toContain(id);
    const music = manifest.bundles[MUSIC_BUNDLE] ?? [];
    for (const id of Object.values(MUSIC_CUES)) expect(music, id).toContain(id);
  });

  it('keeps the initial audio download within 5 MB, music streaming on top', () => {
    const size = (bundle: string): number =>
      (manifest.bundles[bundle] ?? []).reduce(
        (sum, id) => sum + (manifest.assets[id]?.bytes ?? 0),
        0,
      );
    expect(size(SAILING_AUDIO_BUNDLE) + size(WORLD_AUDIO_BUNDLE)).toBeLessThanOrEqual(
      1.5 * 1024 * 1024,
    );
    const bytes = Object.values(manifest.assets).reduce((sum, a) => sum + (a.bytes ?? 0), 0);
    expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});
