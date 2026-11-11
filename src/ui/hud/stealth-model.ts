import { R_ON_FOOT } from '../../core/time';
import { gemLevel, SUSPICIOUS, type GemLevel } from '../../gameplay/onfoot/perception';
import type { GuardState, StealthReadout } from '../../gameplay/onfoot/stealth';
import { sunAt } from '../../sim/weather/celestial';

/**
 * The on-foot HUD's model (plan 13 §4.2, plan 08 §12; Phase 7 piece D): the light gem, the
 * noise ring, an eye over every guard who has noticed something (or an arrow at the screen's
 * edge when they're behind you), and the dawn countdown. Pure, from the stealth system's
 * readout, so what the HUD says is exactly what the sim did (exit criterion 2).
 */

export interface GemView {
  exposure01: number;
  level: GemLevel;
  words: string;
}

export type NoiseLevel = 'silent' | 'quiet' | 'loud' | 'veryLoud';

export interface NoiseView {
  radiusM: number;
  /** The ring's size, 0–1 of its largest. */
  ring01: number;
  level: NoiseLevel;
  words: string;
}

/** What an eye says, by shape and word as well as colour (plan 13). */
export type EyeState = 'noticed' | 'suspicious' | 'alerted' | 'searching';

export interface EyeView {
  id: string;
  name: string;
  state: EyeState;
  /** How full the eye is: the detection meter, 0–1. */
  fill01: number;
  identified: boolean;
  /** Screen pixels: over their head, or pinned to the edge when off screen. */
  x: number;
  y: number;
  onScreen: boolean;
  /** Off screen: which way to turn, radians clockwise from screen up. */
  angle: number;
  distanceM: number;
  label: string;
}

export interface DawnView {
  /** Game seconds to civil dawn. */
  gameSecondsLeft: number;
  /** Real minutes at R = 6. */
  realMinutes: number;
  text: string;
  /** Under ten real minutes: hurry. */
  urgent: boolean;
}

export interface StealthHudSnapshot {
  gem: GemView;
  noise: NoiseView;
  eyes: EyeView[];
  dawn: DawnView | undefined;
  /** The worst any guard is at: drives a banner line and the music (piece I). */
  danger: 'none' | 'suspicious' | 'searching' | 'pursued';
}

const GEM_WORDS: Record<GemLevel, string> = {
  hidden: 'Hidden',
  dim: 'In shadow',
  lit: 'Lit',
  exposed: 'Exposed',
};

export function gemView(exposure01: number): GemView {
  const level = gemLevel(exposure01);
  return { exposure01: Math.min(1, exposure01), level, words: GEM_WORDS[level] };
}

/** The ring is at its largest by this radius (a run on planks). */
export const RING_MAX_M = 18;

export function noiseView(radiusM: number): NoiseView {
  const level: NoiseLevel =
    radiusM < 0.5 ? 'silent' : radiusM < 4 ? 'quiet' : radiusM < 12 ? 'loud' : 'veryLoud';
  const words: Record<NoiseLevel, string> = {
    silent: 'Silent',
    quiet: 'Quiet',
    loud: 'Loud',
    veryLoud: 'Very loud',
  };
  return {
    radiusM,
    ring01: Math.min(1, radiusM / RING_MAX_M),
    level,
    words: words[level],
  };
}

/** Where a point lands on screen: pixels, and whether it's behind the camera. */
export interface Projected {
  x: number;
  y: number;
  behind: boolean;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Off-screen markers sit this far in from the edge. */
const EDGE_PX = 36;
/** Off-screen markers stay above the bottom meters. */
const BOTTOM_CLEAR_PX = 140;
/** Eyes show from this much of the meter (a flicker below it isn't news). */
const SHOW_FROM = 0.04;

function eyeState(state: GuardState, meter: number): EyeState | undefined {
  switch (state) {
    case 'alerted':
      return 'alerted';
    case 'search':
    case 'fetch':
      return 'searching';
    case 'suspicious':
    case 'distracted':
      return 'suspicious';
    case 'unconscious':
    case 'bound':
    case 'dead':
      return undefined;
    default:
      if (meter >= SUSPICIOUS) return 'suspicious';
      return meter >= SHOW_FROM ? 'noticed' : undefined;
  }
}

const EYE_WORDS: Record<EyeState, string> = {
  noticed: 'noticed something',
  suspicious: 'suspicious',
  alerted: 'has seen you',
  searching: 'searching',
};

/** The eyes over the guards, projected (the view's `project`), nearest first. */
export function eyeViews(
  readout: StealthReadout,
  player: { x: number; z: number },
  project: (p: { x: number; y: number; z: number }) => Projected,
  vp: Viewport,
): EyeView[] {
  const out: EyeView[] = [];
  for (const g of readout.guards) {
    const state = eyeState(g.state, g.meter);
    if (!state) continue;
    const p = project(g);
    const inside =
      !p.behind &&
      p.x >= EDGE_PX &&
      p.x <= vp.width - EDGE_PX &&
      p.y >= EDGE_PX &&
      p.y <= vp.height - EDGE_PX;
    let x = p.x;
    let y = p.y;
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    let dx = p.x - cx;
    let dy = p.y - cy;
    if (p.behind) {
      // Behind the camera the projection mirrors: flip it so the arrow points the right way.
      dx = -dx;
      dy = Math.abs(dy) + vp.height;
    }
    const angle = Math.atan2(dx, -dy);
    if (!inside) {
      // Pin to the screen's edge along the direction from the centre.
      const sx = (vp.width / 2 - EDGE_PX) / Math.max(1e-6, Math.abs(dx));
      const sy = (vp.height / 2 - EDGE_PX) / Math.max(1e-6, Math.abs(dy));
      const s = Math.min(sx, sy);
      x = cx + dx * s;
      // Keep clear of the gem and the ring at the bottom centre.
      y = Math.min(cy + dy * s, vp.height - BOTTOM_CLEAR_PX);
    }
    const fill01 = state === 'alerted' ? 1 : Math.min(1, g.meter);
    out.push({
      id: g.id,
      name: g.name,
      state,
      fill01,
      identified: g.identified,
      x,
      y,
      onScreen: inside,
      angle,
      distanceM: Math.hypot(g.x - player.x, g.z - player.z),
      label: `${g.name}: ${EYE_WORDS[state]}${g.identified ? ', knows your face' : ''}`,
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

/** Civil dawn: the sun 6° below the horizon and rising. */
const DAWN_ELEVATION = (-6 * Math.PI) / 180;

/**
 * Game seconds from now to civil dawn, or undefined in daylight (the countdown shows only
 * ashore at night, plan 08 §11). Searches forward in five-minute steps then refines.
 */
export function secondsToDawn(gameSeconds: number): number | undefined {
  if (sunAt(gameSeconds).elevationRad >= DAWN_ELEVATION) return undefined;
  const step = 300;
  for (let t = step; t <= 20 * 3600; t += step) {
    if (sunAt(gameSeconds + t).elevationRad >= DAWN_ELEVATION) {
      let lo = t - step;
      let hi = t;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (sunAt(gameSeconds + mid).elevationRad >= DAWN_ELEVATION) hi = mid;
        else lo = mid;
      }
      return hi;
    }
  }
  return undefined;
}

export function dawnView(gameSeconds: number): DawnView | undefined {
  const left = secondsToDawn(gameSeconds);
  if (left === undefined) return undefined;
  const realMinutes = left / R_ON_FOOT / 60;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  return {
    gameSecondsLeft: left,
    realMinutes,
    text: h > 0 ? `Dawn in ${h} h ${String(m).padStart(2, '0')} m` : `Dawn in ${m} m`,
    urgent: realMinutes < 10,
  };
}

export function stealthHud(
  readout: StealthReadout,
  player: { x: number; z: number },
  project: (p: { x: number; y: number; z: number }) => Projected,
  vp: Viewport,
  gameSeconds: number,
): StealthHudSnapshot {
  const eyes = eyeViews(readout, player, project, vp);
  const danger = readout.pursued
    ? 'pursued'
    : readout.searched || eyes.some((e) => e.state === 'searching' || e.state === 'alerted')
      ? 'searching'
      : eyes.some((e) => e.state === 'suspicious')
        ? 'suspicious'
        : 'none';
  return {
    gem: gemView(readout.exposure01),
    noise: noiseView(readout.noiseM),
    eyes,
    dawn: dawnView(gameSeconds),
    danger,
  };
}
