import coldJson from '../../../data/cold.json';
import { coldFileSchema, type ColdFile } from '../../../data/schemas/cold';
import type { IceSample } from '../ice/season';

/**
 * Walking where the ice holds (plan 04 §8.2, plan 11 §3.2; Phase 9 piece M). The lake's ice
 * (piece K's `iceAt`) is a surface to stand on where it covers its water and is thick enough
 * to be ice at all; whether it *holds* you is another matter. Thin ice works toward breaking
 * under you: a crack underfoot, then a groan, then it goes, and you have a short while in
 * the water to haul yourself out over the edge before the cold takes your strength.
 *
 * Pure numbers, so the tests and the dev hooks can drive them.
 */

export const COLD: ColdFile = coldFileSchema.parse(coldJson);

/** Ice there to stand on (it may not hold you): closed enough, and more than slush. */
export function iceUnderfoot(s: IceSample): boolean {
  return (
    s.kind !== 'open' &&
    s.kind !== 'floes' &&
    s.coverage >= COLD.ice.minCoverage &&
    s.thicknessCm >= COLD.ice.formsCm
  );
}

/** The ice a man needs under him to be safe, cm, with `loadKg` more hauled behind him. */
export function holdCmFor(loadKg = 0): number {
  return COLD.ice.holdCm + Math.max(0, loadKg) / COLD.ice.kgPerCm;
}

function hash2(x: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The share of the ice's thickness at a zone point once its weak spots are counted: 1 on
 * sound ice, down to `1 − weakSpotDepth` over a spring or a pressure crack. Smooth value
 * noise on a `weakSpotM` grid, only its lowest third weakening the ice.
 */
export function weakness(x: number, z: number, seed = 0): number {
  const cell = COLD.ice.weakSpotM;
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const u = fx - ix;
  const v = fz - iz;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const n = a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  const weak = Math.max(0, (0.33 - n) / 0.33);
  return 1 - COLD.ice.weakSpotDepth * weak;
}

export type ThinStage = 'sound' | 'cracking' | 'groaning' | 'broken';

/** The ice under you, building toward breaking. */
export interface ThinIce {
  /** 0 … 1: at 1 it goes. */
  stress: number;
  stage: ThinStage;
}

export function freshThinIce(): ThinIce {
  return { stress: 0, stage: 'sound' };
}

export interface ThinIceInput {
  /** Ice under your feet now, cm (its weak spots counted); undefined off the ice. */
  thicknessCm: number | undefined;
  /** What you haul (the sled and its load), kg. */
  loadKg: number;
  gait: 'idle' | 'sneak' | 'walk' | 'run' | string;
}

/**
 * One step: stress builds on ice thinner than you need (the faster, the thinner and the
 * heavier you are on it) and eases off it. Returns the stage it moved into this step, if it
 * moved up one: `cracking` and `groaning` are the warnings, `broken` is through.
 */
export function stepThinIce(s: ThinIce, input: ThinIceInput, dt: number): ThinStage | undefined {
  if (s.stage === 'broken') return undefined;
  const t = COLD.thin;
  const need = holdCmFor(input.loadKg);
  const h = input.thicknessCm;
  if (h === undefined || h >= need) {
    s.stress = Math.max(0, s.stress - t.relax * dt);
  } else {
    const shortfall = (need - h) / need;
    const gait = input.gait === 'run' ? t.runMul : input.gait === 'idle' ? t.stillMul : 1;
    s.stress = Math.min(1, s.stress + t.rate * shortfall * gait * dt);
  }
  const stage: ThinStage =
    s.stress >= 1
      ? 'broken'
      : s.stress >= t.groanAt
        ? 'groaning'
        : s.stress >= t.crackAt
          ? 'cracking'
          : 'sound';
  const rank = (x: ThinStage): number => ['sound', 'cracking', 'groaning', 'broken'].indexOf(x);
  const up = rank(stage) > rank(s.stage);
  s.stage = stage;
  return up ? stage : undefined;
}

/** In the water through the ice: hauling out over the edge, against the cold's clock. */
export interface ClimbOut {
  /** Seconds since you went through. */
  inS: number;
  /** Hauling, 0 … 1. */
  progress: number;
  /** Times the edge broke away under you. */
  slips: number;
}

export function freshClimbOut(): ClimbOut {
  return { inS: 0, progress: 0, slips: 0 };
}

/**
 * One step in the hole. Holding F hauls you up over the edge; let go and you slide back a
 * little. At the top the edge holds or breaks away (more often on thin ice, `roll` in 0–1):
 * `out` you're on the ice, `slipped` you're back in and the hole wider; the window run out,
 * `lost` the cold has taken your strength.
 */
export function stepClimbOut(
  c: ClimbOut,
  hauling: boolean,
  edgeCm: number,
  roll: number,
  dt: number,
): 'out' | 'slipped' | 'lost' | undefined {
  const t = COLD.thin;
  c.inS += dt;
  if (c.inS >= t.windowS) return 'lost';
  c.progress = hauling
    ? Math.min(1, c.progress + dt / t.climbS)
    : Math.max(0, c.progress - (0.5 * dt) / t.climbS);
  if (c.progress < 1) return undefined;
  const holds = Math.min(1, Math.max(t.edgeHoldMin, edgeCm / COLD.ice.holdCm));
  if (roll < holds) return 'out';
  c.progress = 0;
  c.slips += 1;
  return 'slipped';
}
