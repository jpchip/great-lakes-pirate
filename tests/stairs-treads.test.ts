import { describe, expect, it } from 'vitest';
import { placePiece } from '../src/sim/hideouts/edit';
import { BuildGrid, type BuildSite, type Piece } from '../src/sim/hideouts/grid';
import { hideoutColliders } from '../src/sim/hideouts/placed';

const flat: BuildSite = { cols: 12, rows: 10, baseM: 2, ground: () => 2 };
const P = (id: string, col: number, row: number, rot = 0): Piece => ({
  id: `build.${id}`,
  col,
  row,
  level: 0,
  rot,
  variant: 0,
  paint: 0,
});

describe('stairs walk up in steps, not as a wall (plan 09 §10)', () => {
  it('lays twelve treads rising to the upper floor, and no solid wall', () => {
    const g = new BuildGrid();
    for (const p of [P('foundation', 0, 0), P('foundation', 0, 1), P('stairs', 0, 0)]) {
      const r = placePiece(g, flat, p);
      expect(r.ok).toBe(true);
      if (r.ok) g.setBuilt(r.uids[0] ?? -1, true);
    }
    const all = hideoutColliders(g, flat);
    expect(all.some((c) => c.kind === 'solid' && c.maxY - c.minY >= 2.9)).toBe(false);
    const treads = all.filter((c) => c.uid === 3 && c.kind === 'floor');
    const tops = treads.map((t) => t.maxY).sort((a, b) => a - b);
    expect(tops).toHaveLength(12);
    expect(tops[0] ?? 0).toBeCloseTo(0.25, 2);
    expect(tops[11] ?? 0).toBeCloseTo(3, 2);
    for (let i = 1; i < tops.length; i++)
      expect((tops[i] ?? 0) - (tops[i - 1] ?? 0)).toBeLessThanOrEqual(0.4);
  });
});
