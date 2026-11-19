import type { Chart } from '../../core/coords';
import { westernSuperiorChart } from '../chart/chart-data';
import type { ChartGeography } from '../chart/geography';
import { shelterAt, shelterField, type ShelterField } from './field';
import {
  calendarMs,
  closeAndOpen,
  ICE,
  ICE_KINDS,
  iceForShelter,
  winterAt,
  winterDay,
  winterOf,
  type IceKind,
  type IceSample,
  type Winter,
} from './season';

export type { IceKind, IceSample, Winter } from './season';

/**
 * The lake's ice for a run (plan 04 §8.2 `iceAt`; plan 11 §18.4 piece K): the shelter field
 * of its chart and the winters of its seed. `at` answers for any chart point and game
 * time; the harbors' freeze-up and ice-out, what a hull can make way through, and the
 * chart's picture all come from it.
 *
 * Chart points are in the chart geography's own frame (`westernSuperiorChart()`); a zone
 * point gets there by `zoneToChart` and `fromWorldChart`.
 */
export class LakeIce {
  readonly field: ShelterField;

  constructor(
    readonly seed: string,
    readonly geo: ChartGeography,
  ) {
    this.field = shelterField(geo);
  }

  /** How readily the water at a chart point freezes, 0–1. */
  shelter(p: Chart): number {
    return shelterAt(this.field, p);
  }

  /** The ice at a chart point. */
  at(p: Chart, gameSeconds: number): IceSample {
    return iceForShelter(this.seed, this.shelter(p), gameSeconds);
  }

  /** The ice in a port's harbor. */
  harbor(portId: string, gameSeconds: number): IceSample {
    return iceForShelter(this.seed, harborShelter(this, portId), gameSeconds);
  }

  /** The port is frozen in: no ship can make it or leave it. */
  harborClosed(portId: string, gameSeconds: number): boolean {
    return harborClosedSample(this.harbor(portId, gameSeconds));
  }

  /** The winter a game time falls in (or, in summer, the coming one). */
  winter(gameSeconds: number): Winter {
    return winterAt(this.seed, gameSeconds);
  }

  /**
   * A port's freeze-up and ice-out in the winter a game time falls in (or the coming one),
   * game seconds. A port that never closes that winter has neither.
   */
  harborSeason(portId: string, gameSeconds: number): { closeAt?: number; openAt?: number } {
    return harborSeasonOf(harborShelter(this, portId), this.winter(gameSeconds));
  }

  /**
   * When the port next opens after the ice (its ice-out), if it's closed now; undefined
   * when it's open.
   */
  openAgainAt(portId: string, gameSeconds: number): number | undefined {
    if (!this.harborClosed(portId, gameSeconds)) return undefined;
    return this.harborSeason(portId, gameSeconds).openAt;
  }

  /** The water at a chart point reopens (ice-out there), if it's closed to a plain hull now. */
  openAgainAtPoint(p: Chart, gameSeconds: number, stopCm = ICE.hull.stopCm): number | undefined {
    const shelter = this.shelter(p);
    const w = this.winter(gameSeconds);
    if (!closesHull(this.at(p, gameSeconds), stopCm)) return undefined;
    return closeAndOpen(
      w,
      shelter,
      (s) => closesHull(s, stopCm),
      (s) => !closesHull(s, stopCm) && s.coverage < ICE.harbor.openCoverage,
    ).openAt;
  }

  /** The chart's picture of the ice at a game time: coverage and kind per field cell. */
  picture(gameSeconds: number): IcePicture {
    const f = this.field;
    const n = f.cols * f.rows;
    const coverage = new Float32Array(n);
    const kind = new Uint8Array(n);
    const wd = winterDay(calendarMs(gameSeconds));
    if (wd) {
      for (let i = 0; i < n; i++) {
        if (!f.water[i]) continue;
        const s = iceForShelter(this.seed, f.shelter[i] as number, gameSeconds);
        coverage[i] = s.coverage;
        kind[i] = ICE_KINDS.indexOf(s.kind);
      }
    }
    // A key that changes once a calendar day: the picture is redrawn no oftener.
    const day = Math.floor(calendarMs(gameSeconds) / 86_400_000);
    return { key: `${this.seed}|${day}`, min: f.min, cellM: f.cellM, cols: f.cols, rows: f.rows, coverage, kind };
  }
}

/** The chart's ice: what the chart view draws (hatched fast ice, stippled floes). */
export interface IcePicture {
  key: string;
  min: Chart;
  cellM: number;
  cols: number;
  rows: number;
  coverage: Float32Array;
  /** Index in ICE_KINDS. */
  kind: Uint8Array;
}

function harborShelter(ice: LakeIce, portId: string): number {
  const h = ICE.harbors[portId];
  if (h) return h.shelter;
  const port = ice.geo.ports.find((p) => p.id === portId);
  return port ? ice.shelter(port.pos) : 0;
}

export function harborClosedSample(s: IceSample): boolean {
  return (
    s.kind !== 'floes' &&
    s.coverage >= ICE.harbor.closedCoverage &&
    s.thicknessCm >= ICE.harbor.closedCm
  );
}

function harborSeasonOf(shelter: number, w: Winter): { closeAt?: number; openAt?: number } {
  return closeAndOpen(w, shelter, harborClosedSample, (s) => s.coverage < ICE.harbor.openCoverage);
}

/** The thickness a hull can force her way through, cm: more with the ice bow. */
export function stopCmFor(iceBow: boolean): number {
  return ICE.hull.stopCm * (iceBow ? ICE_BOW.stopMul : 1);
}

/** Ice that stops a hull rated for `stopCm`: closed over its water and that thick. */
export function closesHull(s: IceSample, stopCm: number): boolean {
  return s.kind !== 'floes' && s.coverage >= ICE.hull.stopCoverage && s.thicknessCm >= stopCm;
}

/** The ice-strengthened bow's numbers (plan 10 §5.1: −70% ice damage, less drag). */
export const ICE_BOW = { stopMul: 2.5, damageMul: 0.3, dragMul: 0.6 } as const;

/**
 * What ice does to a hull making way through it (plan 02 §5.2): the speed multiplier
 * (`iceFactor`), and the hull HP it costs a real second per knot of speed over the
 * threshold.
 */
export function hullInIce(
  s: IceSample,
  iceBow: boolean,
): { drag: number; damagePerKn: number; fromKn: number } {
  const h = ICE.hull;
  const bow = iceBow ? ICE_BOW : { stopMul: 1, damageMul: 1, dragMul: 1 };
  if (s.kind === 'open' || s.coverage <= 0) return { drag: 1, damagePerKn: 0, fromKn: 0 };
  if (s.kind === 'floes') {
    return {
      drag: 1 - h.floeDrag * s.coverage * bow.dragMul,
      damagePerKn: h.floeDamagePerKn * s.coverage * bow.damageMul,
      fromKn: h.floeFromKn,
    };
  }
  const stopCm = h.stopCm * bow.stopMul;
  const hardness = Math.min(1, s.thicknessCm / stopCm);
  return {
    drag: 1 - h.drag * s.coverage * hardness * bow.dragMul,
    damagePerKn: h.damagePerKn * s.coverage * hardness * bow.damageMul,
    fromKn: h.damageFromKn,
  };
}

export { ICE, iceForShelter, winterOf };

let shared: LakeIce | undefined;

/** The run's ice on the western Superior chart (one per seed, shared by every system). */
export function lakeIceFor(seed: string): LakeIce {
  if (shared?.seed !== seed) shared = new LakeIce(seed, westernSuperiorChart());
  return shared;
}
