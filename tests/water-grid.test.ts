import { describe, expect, it } from 'vitest';
import { WATER_FAR_RADIUS_M, createPolarGrid, type GridSpacing } from '../src/render/water/water';

describe('water grid', () => {
  it('is dense at the camera and reaches past the fog', () => {
    const rings = 80;
    const segments = 144;
    const grid = createPolarGrid(rings, segments);
    const pos = grid.getAttribute('position');
    expect(pos.count).toBe(1 + rings * segments);
    expect(grid.getIndex()?.count).toBe(segments * 3 + (rings - 1) * segments * 6);

    const radius = (i: number): number => Math.hypot(pos.getX(i), pos.getZ(i));
    expect(radius(1)).toBeCloseTo(0.5, 3);
    expect(radius(pos.count - 1)).toBeCloseTo(2500, 0);
  });

  it('faces up', () => {
    const grid = createPolarGrid(4, 8);
    grid.computeVertexNormals();
    const normals = grid.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(0.99);
  });

  it('reports a vertex spacing that bounds the real one', () => {
    const rings = 80;
    const segments = 144;
    const grid = createPolarGrid(rings, segments);
    const { offset, growth } = grid.userData['spacing'] as GridSpacing;
    const pos = grid.getAttribute('position');
    const radius = (ring: number): number =>
      Math.hypot(pos.getX(1 + (ring - 1) * segments), pos.getZ(1 + (ring - 1) * segments));
    for (const ring of [1, 10, 40, 79]) {
      const r = radius(ring);
      const step = Math.max(radius(ring + 1) - r, (2 * Math.PI * r) / segments);
      const estimate = (r + offset) * growth;
      expect(estimate).toBeGreaterThanOrEqual(step * 0.99);
      expect(estimate).toBeLessThan(step * 1.2);
    }
  });

  it('carries on at the same growth out to the far water', () => {
    const rings = 80;
    const segments = 144;
    const near = createPolarGrid(rings, segments);
    const far = createPolarGrid(rings, segments, WATER_FAR_RADIUS_M);
    expect(far.userData['spacing']).toEqual(near.userData['spacing']);
    const pos = far.getAttribute('position');
    const radius = (ring: number): number =>
      Math.hypot(pos.getX(1 + (ring - 1) * segments), pos.getZ(1 + (ring - 1) * segments));
    const total = (pos.count - 1) / segments;
    expect(radius(rings)).toBeCloseTo(2500, 0);
    expect(radius(total)).toBeCloseTo(WATER_FAR_RADIUS_M, 0);
    // A handful of extra rings: the far LOD is cheap.
    expect(total - rings).toBeGreaterThan(5);
    expect(total - rings).toBeLessThan(20);
    for (let r = 1; r < total; r++) expect(radius(r + 1)).toBeGreaterThan(radius(r));
  });
});
