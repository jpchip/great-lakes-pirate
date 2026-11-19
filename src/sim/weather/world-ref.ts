import { ChartProjection } from '../../core/coords';

/**
 * Places the weather sim needs by name, in the world chart frame (core/coords' default
 * projection, the one the weather and the save use).
 */
const world = new ChartProjection();
export const WORLD_PROJECTION_REF = {
  duluth: world.geoToChart({ lat: 46.78, lon: -92.1 }),
} as const;
