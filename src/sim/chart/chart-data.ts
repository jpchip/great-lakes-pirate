import chartJson from '../../../data/chart.json';
import coastJson from '../../../data/chart-coast.json';
import { chartFileSchema } from '../../../data/schemas/chart';
import type { ZoneDef } from '../../../data/schemas/zones';
import { ZONE_DEFS, zoneGeoBounds } from '../terrain/zones';
import { buildGeography, type ChartFeatureInput, type ChartGeography } from './geography';

/**
 * The western Superior chart (plan 03 §8.2 step 9, §20 piece B): the hand-authored
 * `chart.json` (charted area, ports, lights) plus the baked `chart-coast.json` (lake
 * ring, islands, depth contours, soundings), with every baked zone's outline taken from
 * its bake settings in `zones.json`. Zones not baked yet keep chart.json's bounds.
 */
export function chartFeatures(
  chart: readonly ChartFeatureInput[],
  coast: readonly ChartFeatureInput[],
  zones: readonly ZoneDef[],
): ChartFeatureInput[] {
  const baked = new Set(zones.map((z) => z.id));
  const out = chart.filter((f) => !(f.kind === 'zone' && baked.has(f.id)));
  out.push(...coast);
  for (const def of zones) {
    // Keep the chart's label for the zone where it has one ("Twin Ports" over a longer name).
    const named = chart.find((f) => f.kind === 'zone' && f.id === def.id);
    const name = named?.kind === 'zone' ? named.name : def.name;
    out.push({ id: def.id, kind: 'zone', name, bounds: zoneGeoBounds(def) });
  }
  return out;
}

let cached: ChartGeography | undefined;

/** The validated, projected western Superior chart. Built once on first use. */
export function westernSuperiorChart(): ChartGeography {
  cached ??= buildGeography(
    chartFeatures(chartFileSchema.parse(chartJson), chartFileSchema.parse(coastJson), ZONE_DEFS),
  );
  return cached;
}
