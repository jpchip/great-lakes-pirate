import * as THREE from 'three';

/**
 * Palette v1 (plan 14 §2): the master colors every stylized asset is drawn from. The
 * values lean on the Detroit Publishing photochroms: soft, slightly warm, never fully
 * saturated. Assets reference these by name so a later palette pass retunes them in one
 * place; the pipeline's palette-ization step (plan 14 §4) maps AI textures onto them.
 */
export const PALETTE = {
  // Ships
  hullBlack: 0x262b2a,
  hullWhite: 0xd6d0c2,
  bootRed: 0x8a3426,
  railWhite: 0xd8d0bc,
  deckWood: 0xa48760,
  sparBrown: 0x6a4b31,
  canvas: 0xe2d6bc,
  /** Pennant and wool telltales: the one saturated accent, so the wind reads. */
  flagRed: 0xb3392b,
  // Lighthouses and buildings
  towerWhite: 0xe6e0d0,
  lanternBlack: 0x23282a,
  brick: 0x9a4a36,
  roofGray: 0x5b5f5d,
  weatheredWood: 0x8b857a,
  // Shore and land (the terrain shader and vegetation, Phase 2 piece C)
  sandstone: 0x9c4f37,
  /** The darker beds in the Apostles' layered sandstone. */
  sandstoneDark: 0x7a3a29,
  wetRock: 0x3d3833,
  slopeRock: 0x77736a,
  beachSand: 0xcdb98e,
  wetSand: 0x9a8865,
  shoal: 0x9a8c64,
  seabed: 0x2f3f3b,
  meadow: 0x6b7647,
  forestFloor: 0x46512f,
  pine: 0x2f4a36,
  /** Far forest, where the trees have blurred into one canopy. */
  canopy: 0x2c4232,
  birch: 0xd9d4c4,
  birchLeaf: 0x6a8442,
  shoreRock: 0x6b655c,
  // Light
  lampAmber: 0xffc873,
  windowAmber: 0xf2a24e,
  // Outlines: a warm near-black ink, not pure black, so it sits in the fog
  ink: 0x1a1714,
} as const;

export type PaletteName = keyof typeof PALETTE;

export function paletteColor(name: PaletteName): THREE.Color {
  return new THREE.Color(PALETTE[name]);
}
