/**
 * Color regions of the humanoid (plan 14 §4, plan 08 §20 piece B). The asset pipeline
 * bakes each vertex's region into the `_look` attribute (x = region, y = shade), and the
 * character material looks the region's color up in a per-character palette. So one mesh
 * dresses a captain, a watchman or a constable by palette alone.
 *
 * No three.js here: tools/assets/build-characters.ts reads these too.
 */

export const REGIONS = [
  'skin',
  'eyeWhite',
  'iris',
  'hair',
  'shirt',
  'vest',
  'trousers',
  'boots',
  'leather',
  'metal',
  'coat',
  'coatTrim',
  'hat',
  'hatBand',
  'lampGlass',
  'prop',
] as const;

export type RegionName = (typeof REGIONS)[number];

/** The index baked into the mesh and used by the shader. */
export const REGION: { readonly [K in RegionName]: number } = Object.fromEntries(
  REGIONS.map((name, i) => [name, i]),
) as { [K in RegionName]: number };

export const REGION_COUNT = REGIONS.length;
