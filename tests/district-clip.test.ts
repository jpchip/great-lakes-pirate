import { describe, expect, it } from 'vitest';
import { districtDef, districtFrame } from '../src/gameplay/district/ground';
import { Heightfield } from '../src/gameplay/onfoot/heightfield';
import { zoneDef } from '../src/sim/terrain/zones';
import {
  createDistrictGroundClipUniforms,
  setDistrictGroundClip,
} from '../src/render/terrain/district-clip';

function insideClip(
  u: ReturnType<typeof createDistrictGroundClipUniforms>,
  x: number,
  z: number,
): boolean {
  if (u.uDistrictClipActive.value < 0.5) return false;
  const c = u.uDistrictClipCenter.value;
  const ax = u.uDistrictClipAxisX.value;
  const az = u.uDistrictClipAxisZ.value;
  const half = u.uDistrictClipHalf.value;
  const rel = { x: x - c.x, z: z - c.y };
  const alongX = rel.x * ax.x + rel.z * ax.y;
  const alongZ = rel.x * az.x + rel.z * az.y;
  return Math.abs(alongX) <= half.x && Math.abs(alongZ) <= half.y;
}

describe('district ground clip', () => {
  it('matches the Duluth ground rectangle in zone space', () => {
    const def = districtDef('district.duluth');
    const piece = zoneDef('zone.twin_ports').setPieces.find((p) => p.id === 'setpiece.duluth');
    if (!piece) throw new Error('no Duluth set piece');
    const dFrame = districtFrame(def, {
      id: piece.id,
      anchor: { x: 0, z: 0 },
      bearing: (piece.bearingDeg * Math.PI) / 180,
      def: piece,
    });
    const ground = new Heightfield(10, 8, 1, -5, -3, new Float32Array(80).fill(2));
    const u = createDistrictGroundClipUniforms();
    setDistrictGroundClip(u, ground, dFrame);
    expect(u.uDistrictClipActive.value).toBe(1);
    const center = dFrame.toZone(
      ground.originX + ground.width / 2,
      ground.originZ + ground.depth / 2,
    );
    expect(insideClip(u, center.x, center.z)).toBe(true);
    const inset = dFrame.toZone(ground.originX + 1, ground.originZ + 1);
    expect(insideClip(u, inset.x, inset.z)).toBe(true);
    const far = dFrame.toZone(ground.originX - 50, ground.originZ);
    expect(insideClip(u, far.x, far.z)).toBe(false);
  });
});
