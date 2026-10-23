import { describe, expect, it } from 'vitest';
import { createPolarGrid } from '../src/render/water/water';

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
});
