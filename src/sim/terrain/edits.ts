import type { GridField } from './grid-field';
import type { ZoneManifest } from './manifest';
import { manifestFrame, setPieceFootprint, zoneDef } from './zones';

/**
 * The set pieces a zone's bake hasn't flattened yet, flattened as the zone loads (Phase 9
 * piece W): the bake's hand-edit layer (tools/geo/lib/edits.ts) run on the loaded 4 m
 * heights for a set piece added to data/zones.json since the zone was baked. The bake
 * lists what it flattened in the manifest's `handEdits`, so once the zone is baked again
 * this does nothing for it.
 *
 * Only land is changed, as the bake does, so the shoreline, its SDF and the wind maps stay
 * as baked. Returns the set piece ids flattened here.
 */
export function flattenUnbaked(manifest: ZoneManifest, height: GridField): string[] {
  const baked = new Set(
    ((manifest as { handEdits?: { id: string; kind: string }[] }).handEdits ?? [])
      .filter((e) => e.kind === 'flatten')
      .map((e) => e.id),
  );
  let def;
  try {
    def = zoneDef(manifest.zone);
  } catch {
    return [];
  }
  const frame = manifestFrame(manifest);
  const done: string[] = [];
  for (const piece of def.setPieces) {
    if (baked.has(piece.id)) continue;
    const fp = setPieceFootprint(piece, frame);
    flattenFootprint(height, fp.anchor, fp.bearing, piece);
    done.push(piece.id);
  }
  return done;
}

/** One footprint flattened into a grid in zone meters (the bake's `flattenFootprint`). */
export function flattenFootprint(
  height: GridField,
  anchor: { x: number; z: number },
  bearing: number,
  fp: { alongM: number; inlandM: number; seawardM: number; groundM: number; blendM: number },
): number {
  const halfAlong = fp.alongM / 2;
  const reach = Math.hypot(Math.max(fp.inlandM, fp.seawardM), halfAlong) + fp.blendM;
  const { x0, z0, step, width } = height;
  const i0 = Math.max(0, Math.floor((anchor.x - reach - x0) / step));
  const i1 = Math.min(width - 1, Math.ceil((anchor.x + reach - x0) / step));
  const j0 = Math.max(0, Math.floor((anchor.z - reach - z0) / step));
  const j1 = Math.min(height.height - 1, Math.ceil((anchor.z + reach - z0) / step));
  // Out over the water, and along the shore to its right (x east, z south).
  const ox = Math.sin(bearing);
  const oz = -Math.cos(bearing);
  let changed = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * width + i;
      const h = height.values[k] ?? 0;
      if (h <= 0) continue;
      const dx = x0 + i * step - anchor.x;
      const dz = z0 + j * step - anchor.z;
      const out = dx * ox + dz * oz;
      const along = -dx * oz + dz * ox;
      // Distance outside the rectangle, 0 inside.
      const du = Math.max(-fp.inlandM - out, out - fp.seawardM, 0);
      const dv = Math.max(Math.abs(along) - halfAlong, 0);
      const d = Math.hypot(du, dv);
      if (d >= fp.blendM && d > 0) continue;
      const w = fp.blendM > 0 ? 1 - smoothstep(0, fp.blendM, d) : 1;
      height.values[k] = h + (fp.groundM - h) * w;
      changed++;
    }
  }
  return changed;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
