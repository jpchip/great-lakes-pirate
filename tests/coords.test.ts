import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ChartProjection,
  chartToZone,
  DEFAULT_COMPRESSION,
  FloatingOrigin,
  knotsToMs,
  msToKnots,
  sceneSpeed,
  zoneToChart,
  type ZoneFrame,
} from '../src/core/coords';
import { R_SAILING } from '../src/core/time';

// Roughly the Apostle Islands.
const lat = fc.double({ min: 46, max: 49, noNaN: true });
const lon = fc.double({ min: -92.2, max: -84.3, noNaN: true });
const meters = fc.double({ min: -50_000, max: 50_000, noNaN: true });

describe('coords', () => {
  const projection = new ChartProjection();
  const frame: ZoneFrame = {
    origin: projection.geoToChart({ lat: 46.95, lon: -90.65 }),
    compression: DEFAULT_COMPRESSION,
  };

  it('round-trips geo → chart → zone → chart → geo', () => {
    fc.assert(
      fc.property(lat, lon, (la, lo) => {
        const zone = chartToZone(projection.geoToChart({ lat: la, lon: lo }), frame);
        const geo = projection.chartToGeo(zoneToChart(zone, frame));
        expect(geo.lat).toBeCloseTo(la, 9);
        expect(geo.lon).toBeCloseTo(lo, 9);
      }),
    );
  });

  it('measures a degree of latitude at ~111 km on the chart', () => {
    const a = projection.geoToChart({ lat: 46, lon: -90 });
    const b = projection.geoToChart({ lat: 47, lon: -90 });
    expect(b.y - a.y).toBeCloseTo(111_195, -1);
  });

  it('compresses by C, with north as -z', () => {
    const zone = chartToZone({ x: frame.origin.x + 800, y: frame.origin.y + 1600 }, frame);
    expect(zone.x).toBeCloseTo(100);
    expect(zone.z).toBeCloseTo(-200);
  });

  it('gives ~11–12 m/s on screen for a 7–8 kn schooner at R = 24, C = 8 (plan 03 §3.3)', () => {
    expect(sceneSpeed(knotsToMs(7), R_SAILING, DEFAULT_COMPRESSION)).toBeCloseTo(10.8, 1);
    expect(sceneSpeed(knotsToMs(8), R_SAILING, DEFAULT_COMPRESSION)).toBeCloseTo(12.35, 1);
    expect(msToKnots(knotsToMs(7.5))).toBeCloseTo(7.5);
  });

  it('floating origin recenters only past the threshold and round-trips', () => {
    const origin = new FloatingOrigin(2000);
    expect(origin.update({ x: 1500, z: 0 })).toBeUndefined();
    expect(origin.update({ x: 2500, z: 0 })).toEqual({ x: 2500, z: 0 });
    expect(origin.toRender({ x: 2600, z: 10 })).toEqual({ x: 100, z: 10 });
    fc.assert(
      fc.property(meters, meters, (x, z) => {
        const back = origin.toZone(origin.toRender({ x, z }));
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.z).toBeCloseTo(z, 6);
      }),
    );
  });
});
