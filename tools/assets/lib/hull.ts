import { z } from 'zod';

/**
 * The pure parts of the hull pipeline (plan 14 §7): the per-asset hints, the provenance
 * record every shipped asset carries (plan 14 §6), the palette handed to Blender, and
 * the manifest update. build-hull.ts does the I/O.
 */

/** raw-assets/<category>/<name>/asset.json: what the clean step needs to know. */
export const assetHintsSchema = z.object({
  /** Manifest id the game loads it by, e.g. "ship.schooner". */
  id: z.string().regex(/^[a-z]+(\.[a-z0-9-]+)+$/),
  category: z.enum(['ships']),
  /** Output file name (no extension); public/assets/<category>/<name>.glb. */
  name: z.string().regex(/^[a-z0-9-]+$/),
  /** The raw file inside the folder, as the tool exported it. */
  source: z.string().min(1),
  /** Length of the hull on its long axis, meters (bowsprit excluded: it's procedural). */
  lengthM: z.number().positive(),
  /** Keel depth below the waterline, meters. */
  draftM: z.number().positive(),
  /** Triangle budget for this mesh alone (plan 14 §8, minus the procedural rig). */
  maxTriangles: z.number().int().positive(),
  bow: z.enum(['auto', '+y', '-y']).default('auto'),
  /** Delete faces entirely above this height, meters over the waterline. */
  stripAboveM: z.number().optional(),
  /** Manifest bundles that should include the asset. */
  bundles: z.array(z.string()).default([]),
});
export type AssetHints = z.infer<typeof assetHintsSchema>;

/** raw-assets/<category>/<name>/provenance.json (plan 14 §6). */
export const provenanceSchema = z.object({
  source: z.enum(['ai', 'cc0', 'procedural', 'hand']),
  /** Tool and version, or pack name, or the author's name. */
  tool: z.string().min(1),
  author: z.string().min(1),
  /** The input: reference image path, prompt, or pack URL. */
  reference: z.string().min(1),
  prompt: z.string().optional(),
  /** ISO date the raw asset was made or downloaded. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** License of the raw output, e.g. "CC BY 4.0". */
  license: z.string().min(1),
  /** Credit line the license requires, if any. */
  attribution: z.string().optional(),
  /** Where the tool's terms were checked; must match assets/LICENSES.json. */
  termsUrl: z.string().url().optional(),
  modifications: z.array(z.string()).default([]),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/** Palette for the Blender step: name → sRGB triple in 0..1. */
export function paletteForBlender(
  palette: Record<string, number>,
  names?: readonly string[],
): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const [name, hex] of Object.entries(palette)) {
    if (names && !names.includes(name)) continue;
    out[name] = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  }
  return out;
}

/** Palette entries a hull may use; lamps and ink stay out so no face snaps to them. */
export const HULL_PALETTE = [
  'hullBlack',
  'bootRed',
  'railWhite',
  'deckWood',
  'sparBrown',
  'canvas',
  'weatheredWood',
  'roofGray',
] as const;

export interface BudgetResult {
  ok: boolean;
  message: string;
}

export function checkBudget(triangles: number, max: number): BudgetResult {
  return triangles <= max
    ? { ok: true, message: `${triangles} triangles (budget ${max})` }
    : { ok: false, message: `${triangles} triangles is over the budget of ${max}` };
}

export interface ManifestLike {
  version: 1;
  assets: Record<string, { type: string; url: string; bytes?: number }>;
  bundles: Record<string, string[]>;
}

/** Add or replace one gltf entry and list it in its bundles, keeping everything else. */
export function withManifestEntry(
  manifest: ManifestLike,
  hints: AssetHints,
  bytes: number,
): ManifestLike {
  const bundles = { ...manifest.bundles };
  for (const bundle of hints.bundles) {
    const ids = bundles[bundle] ?? [];
    bundles[bundle] = ids.includes(hints.id) ? ids : [...ids, hints.id];
  }
  return {
    ...manifest,
    assets: {
      ...manifest.assets,
      [hints.id]: { type: 'gltf', url: `${hints.category}/${hints.name}.glb`, bytes },
    },
    bundles,
  };
}

/** The sidecar shipped next to the GLB: the raw record plus what the pipeline did. */
export function shippedProvenance(
  raw: Provenance,
  steps: readonly string[],
): Provenance & { pipeline: string[] } {
  return { ...raw, pipeline: [...steps] };
}
