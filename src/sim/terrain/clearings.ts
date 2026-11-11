import { harborClearings, type HarborLayout } from '../harbors';
import type { PlacedIsland } from '../islands/on-foot';
import { lightClearing, lightsIn, placeLights } from '../lighthouses';
import type { LoadedZone } from './load';
import { clearingFromFootprint, type Clearing } from './vegetation';
import { manifestFrame, setPieceFootprint, zoneDef } from './zones';

/**
 * Where a zone's forest leaves the ground clear (plan 03 §14; Phase 3 piece G, Phase 7
 * piece H): set-piece footprints, light stations, the harbors' buildings and pier ends,
 * and the walkable islands' points of interest. The renderer plants around these, and
 * the on-foot scene puts trunks where it planted, so both read this one list.
 */
export function zoneClearings(
  zone: Pick<LoadedZone, 'manifest' | 'terrain'>,
  harbors: readonly HarborLayout[],
  islands: readonly PlacedIsland[],
): Clearing[] {
  const frame = manifestFrame(zone.manifest);
  const out: Clearing[] = zoneDef(zone.manifest.zone).setPieces.map((def) => {
    const f = setPieceFootprint(def, frame);
    return clearingFromFootprint(
      f.anchor,
      f.bearing,
      def.alongM + def.blendM,
      def.inlandM + def.blendM,
      def.seawardM,
    );
  });
  out.push(...placeLights(lightsIn(zone.manifest.zone), frame, zone.terrain).map(lightClearing));
  for (const layout of harbors) out.push(...harborClearings(layout));
  for (const island of islands) out.push(...island.clearings);
  return out;
}
