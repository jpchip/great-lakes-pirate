#!/usr/bin/env node
// The audio pipeline (plan 15 §9): every raw sound under raw-assets/audio/ is decoded to
// mono 48 kHz, trimmed, faded or loop-crossfaded, level-normalized, encoded to Opus in
// Ogg, and written with its provenance sidecar and an audio manifest entry.
//
//   npm run audio                                   # every sound, skipping unchanged ones
//   npm run audio -- raw-assets/audio/sailing/luff  # one sound
//   npm run audio -- --force                        # rebuild even if unchanged
//
// Needs ffmpeg with libopus on the PATH, or FFMPEG=/path/to/ffmpeg. Runs locally; CI only
// checks the outputs (tests/audio-pipeline.test.ts). Each folder holds sound.json (hints),
// provenance.json and the raw file named in sound.json's "source".

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_AUDIO_LICENSES,
  BITRATES,
  SAMPLE_RATE,
  audioProvenanceSchema,
  processSound,
  soundHintsSchema,
  withAudioEntry,
  type AudioManifest,
} from './lib/audio.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const RAW = join(ROOT, 'raw-assets', 'audio');
const OUT = join(ROOT, 'public', 'assets', 'audio');
const MANIFEST = join(OUT, 'manifest.json');
/** Bump to rebuild everything when the processing steps change. */
const PIPELINE_VERSION = 1;
const FFMPEG = process.env['FFMPEG'] ?? 'ffmpeg';

function fail(message: string): never {
  console.error(`audio: ${message}`);
  process.exit(1);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) fail(`missing ${relative(ROOT, path)}`);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function ffmpeg(args: string[], input?: Buffer): Buffer {
  const run = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], {
    input,
    maxBuffer: 1 << 30,
  });
  if (run.error) fail(`could not run ffmpeg (${run.error.message}); set FFMPEG=/path/to/ffmpeg`);
  if (run.status !== 0) fail(`ffmpeg ${args.join(' ')}\n${run.stderr.toString()}`);
  return run.stdout;
}

/** Every folder with a sound.json under raw-assets/audio/<category>/. */
function soundDirs(): string[] {
  const dirs: string[] = [];
  for (const category of readdirSync(RAW)) {
    const catDir = join(RAW, category);
    if (!statSync(catDir).isDirectory()) continue;
    for (const name of readdirSync(catDir)) {
      if (existsSync(join(catDir, name, 'sound.json'))) dirs.push(join(catDir, name));
    }
  }
  return dirs.sort();
}

function build(dir: string, manifest: AudioManifest, force: boolean): AudioManifest {
  const category = basename(dirname(dir));
  const hints = soundHintsSchema.parse(readJson(join(dir, 'sound.json')));
  const provenance = audioProvenanceSchema.safeParse(readJson(join(dir, 'provenance.json')));
  if (!provenance.success) fail(`${hints.name}/provenance.json: ${provenance.error.message}`);
  const license = provenance.data.license;
  if (!(ALLOWED_AUDIO_LICENSES as readonly string[]).includes(license)) {
    fail(`${hints.name}: license "${license}" is not allowed (plan 15 §3.2)`);
  }

  const sourcePath = join(dir, hints.source);
  if (!existsSync(sourcePath)) fail(`missing ${relative(ROOT, sourcePath)}`);
  const hash = createHash('sha256')
    .update(String(PIPELINE_VERSION))
    .update(readFileSync(sourcePath))
    .update(readFileSync(join(dir, 'sound.json')))
    .update(readFileSync(join(dir, 'provenance.json')))
    .digest('hex')
    .slice(0, 16);

  const outDir = join(OUT, category);
  const oggPath = join(outDir, `${hints.name}.ogg`);
  const sidecarPath = join(outDir, `${hints.name}.provenance.json`);
  if (!force && existsSync(oggPath) && existsSync(sidecarPath)) {
    const old = JSON.parse(readFileSync(sidecarPath, 'utf8')) as { inputHash?: string };
    if (old.inputHash === hash) {
      console.log(`audio: ${hints.id} unchanged`);
      return withAudioEntry(manifest, hints, category, statSync(oggPath).size);
    }
  }

  // Decode to mono float PCM, process in JS, encode to Opus.
  const pcm = ffmpeg([
    '-i',
    sourcePath,
    ...(hints.highpassHz !== undefined ? ['-af', `highpass=f=${hints.highpassHz}`] : []),
    '-ac',
    '1',
    '-ar',
    String(SAMPLE_RATE),
    '-f',
    'f32le',
    '-',
  ]);
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
  const { samples: processed, steps } = processSound(samples, hints);
  mkdirSync(outDir, { recursive: true });
  ffmpeg(
    [
      '-y',
      '-f',
      'f32le',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      '-i',
      '-',
      '-c:a',
      'libopus',
      '-b:a',
      `${BITRATES[hints.bus]}k`,
      '-application',
      'audio',
      oggPath,
    ],
    Buffer.from(processed.buffer, processed.byteOffset, processed.byteLength),
  );

  const bytes = statSync(oggPath).size;
  const sidecar = {
    ...provenance.data,
    description: hints.description,
    durationS: Number((processed.length / SAMPLE_RATE).toFixed(3)),
    pipeline: steps,
    inputHash: hash,
  };
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
  console.log(
    `audio: ${hints.id} → ${relative(ROOT, oggPath)} (${(bytes / 1024).toFixed(1)} KB, ` +
      `${sidecar.durationS} s)`,
  );
  return withAudioEntry(manifest, hints, category, bytes);
}

function main(): void {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const picked = args.filter((a) => !a.startsWith('--')).map((a) => resolve(ROOT, a));
  const dirs = picked.length > 0 ? picked : soundDirs();
  if (dirs.length === 0) fail('no sounds under raw-assets/audio/');

  let manifest: AudioManifest = existsSync(MANIFEST)
    ? (readJson(MANIFEST) as AudioManifest)
    : { version: 1, assets: {}, bundles: {} };
  for (const dir of dirs) manifest = build(dir, manifest, force);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

  const total = Object.values(manifest.assets).reduce((sum, a) => sum + (a.bytes ?? 0), 0);
  console.log(
    `audio: ${Object.keys(manifest.assets).length} sounds, ${(total / 1024).toFixed(1)} KB`,
  );
}

main();
