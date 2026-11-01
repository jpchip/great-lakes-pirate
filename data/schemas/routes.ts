import { z } from 'zod';
import { idOf } from './common';

/**
 * The route graph traffic sails on (plan 03 §6.1, §9 `routes.json`; plan 01 §3.4; Phase 3
 * piece F). Positions are WGS84 `[lon, lat]`, GeoJSON order, like `chart.json`.
 *
 * - **Nodes** are where lanes start and end: a port's approach (ships lie in port there,
 *   off the chart), a zone entry, fishing grounds (tugs work there, in sight), or the
 *   "lower lakes" sink at the chart's east edge (plan 05 §8.1), where ships leave the
 *   charted water and come back after a while.
 * - **Lanes** join two nodes through waypoints. Each carries a fleet of ships by class,
 *   how long they lie at each end, and a monthly weight: the share of the fleet sailing
 *   that month (plan 05 §8.1's seasonal flows, without the cargo until Phase 4). A
 *   `patrol` lane is the revenue cutter's beat.
 * - **Points of interest** are static: derelicts and wrecks the lookouts can raise.
 *
 * Every lane leg is checked against the chart's land mask in tests/routes.test.ts.
 */

const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** Twelve monthly values, January first. */
const monthly = z.array(z.number().min(0).max(1)).length(12);

const fleetEntry = z.object({
  /** ships.json class. */
  classId: idOf('ship'),
  count: z.number().int().min(1),
  /** Service speed on this lane, game knots; the class's speed when omitted. */
  speedKn: z.number().positive().optional(),
  /** A consort in tow astern (a schooner-barge behind a steam freighter, plan 05 §8.1). */
  consort: idOf('ship').optional(),
  /** The consort's name. */
  consortName: z.string().min(1).optional(),
  /** Names for this entry's ships, one per ship; fictional (plan 05 §10). */
  names: z.array(z.string().min(1)).min(1),
});

export const routeFeatureSchema = z.discriminatedUnion('kind', [
  z.object({
    id: idOf('node'),
    kind: z.literal('node'),
    name: z.string().min(1),
    /**
     * `port`: ships lie alongside out of sight. `sink`: off the chart (the lower lakes).
     * `grounds`: fishing grounds, where tugs work in sight. `waypoint`: a turning mark.
     */
    role: z.enum(['port', 'sink', 'grounds', 'waypoint']),
    at: lonLat,
    /** The port it serves, in ports.json. */
    port: idOf('port').optional(),
  }),
  z.object({
    id: idOf('lane'),
    kind: z.literal('lane'),
    name: z.string().min(1),
    /** What the lane is for: trade (prizes), fishing (local traffic), or a patrol. */
    use: z.enum(['trade', 'fishing', 'patrol']),
    from: idOf('node'),
    to: idOf('node'),
    /** Waypoints between the two nodes. */
    via: z.array(lonLat),
    fleet: z.array(fleetEntry).min(1),
    /** Hours a ship lies at `from` and at `to` between passages. */
    dwellH: z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
    /** Share of the fleet sailing each month (0 laid up for the ice, 1 all out). */
    season: monthly,
  }),
  z.object({
    id: idOf('poi'),
    kind: z.literal('poi'),
    name: z.string().min(1),
    /** Only derelicts in Phase 3; wrecks and secrets come with plan 11. */
    poi: z.enum(['derelict']),
    at: lonLat,
    /** ships.json class it's drawn as in an arena. */
    classId: idOf('ship'),
    /** What the lookout calls it. */
    description: z.string().min(1),
  }),
]);

export const routesFileSchema = z.array(routeFeatureSchema);
export type RouteFeature = z.infer<typeof routeFeatureSchema>;
export type RouteNode = Extract<RouteFeature, { kind: 'node' }>;
export type RouteLane = Extract<RouteFeature, { kind: 'lane' }>;
export type RoutePoi = Extract<RouteFeature, { kind: 'poi' }>;
