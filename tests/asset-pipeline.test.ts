import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/render/style/palette';
import {
  assetHintsSchema,
  checkBudget,
  HULL_PALETTE,
  paletteForBlender,
  provenanceSchema,
  withManifestEntry,
  type ManifestLike,
} from '../tools/assets/lib/hull';

const hints = assetHintsSchema.parse({
  id: 'ship.schooner',
  category: 'ships',
  name: 'schooner-t1',
  source: 'meshy.glb',
  lengthM: 30,
  draftM: 2,
  maxTriangles: 11500,
  bundles: ['test-scene'],
});

describe('hull pipeline (plan 14 §7)', () => {
  it('converts palette hex to sRGB triples and keeps lamps out of hulls', () => {
    const p = paletteForBlender(PALETTE, HULL_PALETTE);
    expect(p['bootRed']).toEqual([0x8a / 255, 0x34 / 255, 0x26 / 255]);
    expect(Object.keys(p)).toHaveLength(HULL_PALETTE.length);
    expect(p['lampAmber']).toBeUndefined();
  });

  it('fails a mesh over its triangle budget', () => {
    expect(checkBudget(11500, 11500).ok).toBe(true);
    expect(checkBudget(11501, 11500).ok).toBe(false);
  });

  it('keeps the player ship within the 12k budget once the rig is added (plan 14 §8)', () => {
    expect(hints.maxTriangles).toBeLessThanOrEqual(12000 - 300);
  });

  it('adds the manifest entry and bundle membership without touching the rest', () => {
    const manifest: ManifestLike = {
      version: 1,
      assets: { 'prop.crate': { type: 'gltf', url: 'props/crate.glb' } },
      bundles: { 'test-scene': ['prop.crate'] },
    };
    const next = withManifestEntry(manifest, hints, 1234);
    expect(next.assets['ship.schooner']).toEqual({
      type: 'gltf',
      url: 'ships/schooner-t1.glb',
      bytes: 1234,
    });
    expect(next.assets['prop.crate']).toBeDefined();
    expect(next.bundles['test-scene']).toEqual(['prop.crate', 'ship.schooner']);
    // Idempotent: a rebuild doesn't list it twice.
    expect(withManifestEntry(next, hints, 99).bundles['test-scene']).toHaveLength(2);
  });

  it('requires the provenance fields CI checks for', () => {
    const ok = provenanceSchema.safeParse({
      source: 'ai',
      tool: 'Meshy 5 (web app, free plan)',
      author: 'Jared',
      reference: 'references/schooner.png',
      date: '2026-10-25',
      license: 'CC BY 4.0',
      attribution: 'Generated with Meshy (meshy.ai)',
    });
    expect(ok.success).toBe(true);
    expect(provenanceSchema.safeParse({ source: 'ai', tool: 'Meshy' }).success).toBe(false);
  });

  it('records the license gate for every AI tool the pipeline uses (plan 14 §6)', () => {
    const licenses = JSON.parse(readFileSync('assets/LICENSES.json', 'utf8')) as {
      tools: Record<string, { checked: string; terms: string[]; verdict: string }>;
    };
    for (const tool of ['meshy', 'nano-banana']) {
      const entry = licenses.tools[tool];
      expect(entry?.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry?.terms.length).toBeGreaterThan(0);
      expect(entry?.verdict).toMatch(/Allowed/);
    }
  });
});
