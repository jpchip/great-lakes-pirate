import type { Pose } from './terrain/test-bay';
import { APOSTLES_ID, findZoneDef, nearestEntry, entryPose, spawnPose } from './terrain/zones';
import type { PlayerLocation, WorldState } from './world-state';

/**
 * Where a loaded run puts the ship (Phase 3 piece A): Continue goes back to the zone and
 * pose of the last save. A zone the data no longer has falls back to the Apostles spawn.
 */
export interface StartPlace {
  zoneId: string;
  pose: Pose;
  /** `saved`: the pose of the last save; `spawn`: the zone's spawn; `entry`: an entry point. */
  from: 'saved' | 'spawn' | 'entry';
}

const isFinitePose = (p: Pose): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.heading);

export function resolveStart(location: PlayerLocation): StartPlace {
  if (location.mode === 'chart') {
    // A run saved on the chart (piece D) loads the zone it left behind the chart, with the
    // ship at that zone's entry nearest its chart position, ready for the way back.
    const def = findZoneDef(location.fromZoneId ?? APOSTLES_ID) ?? findZoneDef(APOSTLES_ID);
    if (!def) throw new Error(`No zone ${APOSTLES_ID} in data/zones.json`);
    return { zoneId: def.id, pose: entryPose(nearestEntry(def, location.chartPos)), from: 'entry' };
  }
  const def = findZoneDef(location.zoneId);
  if (!def) {
    const apostles = findZoneDef(APOSTLES_ID);
    if (!apostles) throw new Error(`No zone ${APOSTLES_ID} in data/zones.json`);
    return { zoneId: apostles.id, pose: spawnPose(apostles), from: 'spawn' };
  }
  if (location.pose && isFinitePose(location.pose)) {
    return { zoneId: def.id, pose: { ...location.pose }, from: 'saved' };
  }
  return { zoneId: def.id, pose: spawnPose(def), from: 'spawn' };
}

const TAU = 2 * Math.PI;

/** A heading in [0, 2π). */
export function wrapHeading(rad: number): number {
  return ((rad % TAU) + TAU) % TAU;
}

/** Writes the ship's place in the zone into the state, just before a save. */
export function recordZonePose(state: WorldState, zoneId: string, pose: Pose): void {
  state.player.location = {
    mode: 'zone',
    zoneId,
    pose: { x: pose.x, z: pose.z, heading: wrapHeading(pose.heading) },
  };
}

/** Writes the ship's place on the chart into the state, just before a save (piece D). */
export function recordChartPosition(
  state: WorldState,
  chartPos: { x: number; y: number },
  heading: number,
  fromZoneId: string | undefined,
): void {
  state.player.location = {
    mode: 'chart',
    chartPos: { x: chartPos.x, y: chartPos.y },
    heading: wrapHeading(heading),
    ...(fromZoneId ? { fromZoneId } : {}),
  };
}
