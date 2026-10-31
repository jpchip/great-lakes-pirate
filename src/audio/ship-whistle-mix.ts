import type { FogSignal } from '../../data/schemas/lighthouses';

/**
 * When and how the NPC ships sound (plan 15 §4.3, §11 Phase 3; Phase 3 piece J): their fog
 * signals under the 1895 Great Lakes rules, the passing signal when one meets you in clear
 * weather, and how far a whistle or a fog horn carries. Pure numbers, tested without Web
 * Audio; ship-whistles.ts plays them.
 *
 * The rules, as the game reads them (Act of February 8, 1895, in force on the lakes in 1900):
 * - A steam vessel under way sounds three distinct blasts of her whistle at intervals of not
 *   more than one minute (rule 15). The lakes used three, not the international single
 *   prolonged blast.
 * - A sailing vessel under way sounds her fog horn: one blast on the starboard tack, two on
 *   the port tack, three with the wind abaft the beam. (The tack code is the international
 *   one; the 1895 text for sail is still to be checked against R1, see plan 15 §15.)
 * - A vessel not under way rings her bell rapidly for about five seconds each minute. The
 *   game treats a ship lying stopped as at anchor.
 * - Meeting in sight, a steamer gives one short blast for "I'm going to starboard, pass
 *   port to port", two for "starboard to starboard". Sailing vessels give none, and nobody
 *   does in fog, where the fog signal is all you sound.
 */

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

export type WhistleKind = 'steam' | 'horn';

/** What a ship is doing, for which fog signal it sounds. */
export type FogSignalCase =
  'steam-under-way' | 'starboard-tack' | 'port-tack' | 'running' | 'at-anchor';

/** Below this speed a ship counts as stopped (at anchor), game knots. */
export const STOPPED_KN = 0.3;

/** The fog signal's cycle, seconds: "not more than one minute", a little under it. */
export const SHIP_FOG_PERIOD_S = 50;

/** A distinct blast and the gap after it, seconds. */
const BLAST_S = 1.6;
const BLAST_GAP_S = 0.9;
/** A fog horn blast is shorter: a breath of the bellows. */
const HORN_S = 1.8;
const HORN_GAP_S = 1.1;
/** The bell's rapid ringing: strokes this far apart for about five seconds. */
const BELL_STROKE_S = 0.45;
const BELL_RING_S = 5;
/** The passing signal's short blast, about a second. */
export const SHORT_BLAST_S = 0.9;
const SHORT_GAP_S = 0.8;

/**
 * Which fog signal a ship sounds. `windFromRad` and `headingRad` are clockwise from north;
 * the tack is the side the wind comes over, abaft the beam is "running".
 */
export function fogSignalCase(
  kind: WhistleKind,
  speedKn: number,
  headingRad: number,
  windFromRad: number,
): FogSignalCase {
  if (speedKn < STOPPED_KN) return 'at-anchor';
  if (kind === 'steam') return 'steam-under-way';
  // The wind's angle off the bow, -π..π: positive is to starboard.
  const off = Math.atan2(Math.sin(windFromRad - headingRad), Math.cos(windFromRad - headingRad));
  if (Math.abs(off) > Math.PI / 2) return 'running';
  return off >= 0 ? 'starboard-tack' : 'port-tack';
}

/** A run of `count` blasts `lengthS` long with `gapS` between them. */
function blasts(count: number, lengthS: number, gapS: number): [number, number][] {
  return Array.from({ length: count }, (_, i) => [i * (lengthS + gapS), lengthS]);
}

/** The pattern each fog signal case sounds, in the lighthouses' `FogSignal` shape. */
export function fogSignalPattern(c: FogSignalCase): Pick<FogSignal, 'pattern' | 'periodS'> {
  switch (c) {
    case 'steam-under-way':
      return { pattern: blasts(3, BLAST_S, BLAST_GAP_S), periodS: SHIP_FOG_PERIOD_S };
    case 'starboard-tack':
      return { pattern: blasts(1, HORN_S, HORN_GAP_S), periodS: SHIP_FOG_PERIOD_S };
    case 'port-tack':
      return { pattern: blasts(2, HORN_S, HORN_GAP_S), periodS: SHIP_FOG_PERIOD_S };
    case 'running':
      return { pattern: blasts(3, HORN_S, HORN_GAP_S), periodS: SHIP_FOG_PERIOD_S };
    case 'at-anchor': {
      const strokes = Math.floor(BELL_RING_S / BELL_STROKE_S) + 1;
      return { pattern: blasts(strokes, 0, BELL_STROKE_S), periodS: SHIP_FOG_PERIOD_S + 10 };
    }
  }
}

/** The passing signal's blasts: one for port to port, two for starboard to starboard. */
export function passingPattern(blastsN: 1 | 2): [number, number][] {
  return blasts(blastsN, SHORT_BLAST_S, SHORT_GAP_S);
}

/**
 * How loud and bright a ship's whistle or horn is `distanceM` away, or undefined past its
 * `rangeM`; the same shape as a lighthouse signal's (world-mix `signalLevel`), so a
 * freighter a few kilometers off in fog sits under Outer Island's whistle.
 */
export function whistleLevel(
  kind: WhistleKind,
  rangeM: number,
  distanceM: number,
  damping = 1,
): { gain: number; lowpassHz: number } | undefined {
  if (distanceM >= rangeM) return undefined;
  const ref = kind === 'steam' ? rangeM / 12 : rangeM / 15;
  const d = Math.max(distanceM, ref);
  const edge = smooth((rangeM - distanceM) / (0.2 * rangeM));
  return {
    gain: (ref / d) ** 0.85 * edge * (kind === 'steam' ? 0.9 : 0.7),
    lowpassHz: Math.max(500, 12000 * (ref / d) ** 0.6 * damping),
  };
}

/** Meeting distance within which a ship gives the passing signal, zone meters. */
export const PASSING_RANGE_M = 1500;

export interface MeetingInput {
  /** The NPC: where it is, its heading (clockwise from north, zone z south), speed. */
  ship: { x: number; z: number; headingRad: number; speedKn: number };
  /** The player's ship. */
  other: { x: number; z: number; headingRad: number };
  /** Fog visibility at the ship, meters: no passing signals out of sight. */
  visibilityM: number;
}

/**
 * The passing signal a ship gives on meeting you, or undefined: when you're ahead of it
 * (within 35° of the bow), within 1.5 km and in sight, heading roughly the other way
 * (courses more than 110° apart). One blast to pass port to port, the usual meeting, when
 * you're dead ahead or on its port bow; two when you're more than 8° on its starboard bow.
 */
export function passingSignal(m: MeetingInput): 1 | 2 | undefined {
  const { ship, other } = m;
  if (ship.speedKn < STOPPED_KN) return undefined;
  const dx = other.x - ship.x;
  const dz = other.z - ship.z;
  const d = Math.hypot(dx, dz);
  if (d > PASSING_RANGE_M || d > m.visibilityM) return undefined;
  const bearing = Math.atan2(dx, -dz);
  const off = Math.atan2(Math.sin(bearing - ship.headingRad), Math.cos(bearing - ship.headingRad));
  if (Math.abs(off) > (35 * Math.PI) / 180) return undefined;
  const courses = Math.abs(
    Math.atan2(
      Math.sin(other.headingRad - ship.headingRad),
      Math.cos(other.headingRad - ship.headingRad),
    ),
  );
  if (courses < (110 * Math.PI) / 180) return undefined;
  return off > (8 * Math.PI) / 180 ? 2 : 1;
}
