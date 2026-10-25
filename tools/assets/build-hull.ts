#!/usr/bin/env node
// Runs one AI-generated hull through the asset pipeline (plan 14 §7, spike S4):
// headless Blender clean step, then gltf-transform (weld, simplify to budget, meshopt
// compression), the budget and provenance checks, and the manifest entry.
//
//   node tools/assets/build-hull.ts raw-assets/ships/schooner-t1
//   node tools/assets/build-hull.ts raw-assets/ships/schooner-t1 --skip-clean   # reuse .cache
//
// Needs Blender 4.2+ on the PATH, or BLENDER=/path/to/blender. Blender runs locally only;
// CI never runs it (plan 14 §7). The folder holds asset.json (hints), provenance.json and
// the raw export named in asset.json's "source".

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { PALETTE } from '../../src/render/style/palette.ts';
import {
  assetHintsSchema,
  checkBudget,
  HULL_PALETTE,
  paletteForBlender,
  provenanceSchema,
  shippedProvenance,
  withManifestEntry,
  type ManifestLike,
} from './lib/hull.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

function fail(message: string): never {
  console.error(`build-hull: ${message}`);
  process.exit(1);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) fail(`missing ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function triangles(doc: Document): number {
  let count = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const positions = prim.getAttribute('POSITION');
      count += Math.floor((indices ? indices.getCount() : (positions?.getCount() ?? 0)) / 3);
    }
  }
  return count;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rawDir = args.find((a) => !a.startsWith('--'));
  if (!rawDir) fail('usage: node tools/assets/build-hull.ts <raw-assets/category/name>');
  const dir = resolve(ROOT, rawDir);

  const hints = assetHintsSchema.parse(readJson(join(dir, 'asset.json')));
  const provenance = provenanceSchema.safeParse(readJson(join(dir, 'provenance.json')));
  if (!provenance.success) fail(`provenance.json: ${provenance.error.message}`);

  const cache = join(ROOT, 'tools', 'assets', '.cache', hints.name);
  mkdirSync(cache, { recursive: true });
  const cleaned = join(cache, 'cleaned.glb');
  const reportPath = join(cache, 'clean-report.json');

  // 1. Blender clean step.
  if (!args.includes('--skip-clean')) {
    const palettePath = join(cache, 'palette.json');
    writeFileSync(palettePath, JSON.stringify(paletteForBlender(PALETTE, HULL_PALETTE), null, 2));
    const blender = process.env['BLENDER'] ?? 'blender';
    const cleanArgs = [
      '-b',
      '--factory-startup',
      '-P',
      join(ROOT, 'tools', 'assets', 'blender', 'clean.py'),
      '--',
      '--input',
      join(dir, hints.source),
      '--output',
      cleaned,
      '--report',
      reportPath,
      '--length',
      String(hints.lengthM),
      '--draft',
      String(hints.draftM),
      '--max-tris',
      String(hints.maxTriangles),
      '--bow',
      hints.bow,
      '--palette',
      palettePath,
    ];
    if (hints.stripAboveM !== undefined) cleanArgs.push('--strip-above', String(hints.stripAboveM));
    console.log(`build-hull: ${blender} ${cleanArgs.join(' ')}`);
    const run = spawnSync(blender, cleanArgs, { stdio: 'inherit' });
    if (run.error)
      fail(`could not run Blender (${run.error.message}); set BLENDER=/path/to/blender`);
    if (run.status !== 0) fail(`Blender exited with ${run.status}`);
  }
  if (!existsSync(cleaned)) fail(`no cleaned mesh at ${cleaned}; run without --skip-clean`);

  // 2. gltf-transform: weld, simplify if still over budget, compress.
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  const doc = await io.read(cleaned);
  const steps = [
    `Blender clean step (tools/assets/blender/clean.py), report in ${basename(reportPath)}`,
  ];
  await doc.transform(dedup(), weld());
  let tris = triangles(doc);
  if (tris > hints.maxTriangles) {
    await doc.transform(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: (hints.maxTriangles / tris) * 0.95,
        error: 0.01,
      }),
    );
    steps.push(`meshopt simplify from ${tris} triangles`);
    tris = triangles(doc);
  }
  const budget = checkBudget(tris, hints.maxTriangles);
  console.log(`build-hull: ${budget.message}`);
  if (!budget.ok) fail(budget.message);
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  steps.push('gltf-transform dedup, weld, prune, meshopt compression');

  // 3. Write the GLB, its provenance sidecar and the manifest entry.
  const outDir = join(ROOT, 'public', 'assets', hints.category);
  mkdirSync(outDir, { recursive: true });
  const glbPath = join(outDir, `${hints.name}.glb`);
  await io.write(glbPath, doc);
  const bytes = statSync(glbPath).size;
  writeFileSync(
    join(outDir, `${hints.name}.provenance.json`),
    JSON.stringify(shippedProvenance(provenance.data, steps), null, 2) + '\n',
  );
  const manifestPath = join(ROOT, 'public', 'assets', 'manifest.json');
  const manifest = readJson(manifestPath) as ManifestLike;
  writeFileSync(
    manifestPath,
    JSON.stringify(withManifestEntry(manifest, hints, bytes), null, 2) + '\n',
  );
  console.log(`build-hull: wrote ${glbPath} (${(bytes / 1024).toFixed(1)} KB, ${tris} triangles)`);
  if (provenance.data.attribution) {
    console.log(`build-hull: add a CREDITS.md row crediting "${provenance.data.attribution}"`);
  }
}

await main();
