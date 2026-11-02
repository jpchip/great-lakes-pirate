/**
 * Captions for directional cues (plan 15 §5, plan 13 §9): the lights' fog signals and the
 * ships' whistles get a line of text with an arrow toward where the sound came from, so
 * a player who can't hear them can still steer by them. The soundscapes push a caption
 * when a blast is scheduled; it shows from the moment the sound arrives (the speed of
 * sound included) and lingers a few seconds after. Pure state, no Web Audio, so it is
 * tested on its own; the HUD reads `visible` at its 10 Hz.
 */

export interface CaptionSource {
  /** One line per source: a new blast from the same source refreshes its line. */
  key: string;
  text: string;
  /** Where the sound comes from, zone meters. */
  at: { x: number; z: number };
}

interface Entry extends CaptionSource {
  /** Feed seconds the line shows from and until. */
  fromS: number;
  untilS: number;
}

/** What the HUD shows for one caption. */
export interface CaptionView {
  key: string;
  text: string;
  /** Bearing from the view, degrees clockwise: 0 straight ahead, ±180 behind. */
  bearingDeg: number;
  /** One of ↑ ↗ → ↘ ↓ ↙ ← ↖. */
  arrow: string;
  /** "close by", "" or "far off". */
  distance: string;
}

/** Lines shown at once; the oldest give way. */
export const MAX_CAPTIONS = 3;
/** Seconds a line lingers after its sound began. */
export const CAPTION_HOLD_S = 4;

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const;

/**
 * The bearing of `at` from a listener at `from` looking along `forward` (zone axes: x
 * east, z south), degrees clockwise in −180…180.
 */
export function relativeBearingDeg(
  from: { x: number; z: number },
  forward: { x: number; z: number },
  at: { x: number; z: number },
): number {
  const toward = Math.atan2(at.x - from.x, -(at.z - from.z));
  const facing = Math.atan2(forward.x, -forward.z);
  let d = ((toward - facing) * 180) / Math.PI;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return d;
}

/** The arrow for a relative bearing, in eight steps. */
export function arrowFor(bearingDeg: number): string {
  const i = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return ARROWS[i] as string;
}

/** A word for how far a sound is, zone meters. */
export function distanceWord(m: number): string {
  if (m < 400) return 'close by';
  if (m > 2500) return 'far off';
  return '';
}

export class CaptionFeed {
  /** False hides every caption (the Settings toggle). */
  enabled = true;
  private readonly entries = new Map<string, Entry>();

  /**
   * A cue that will be heard `delayS` from `nowS` (feed seconds), lasting `lengthS`. The
   * line shows once it arrives and stays `CAPTION_HOLD_S` past its start or its end.
   */
  push(source: CaptionSource, nowS: number, delayS = 0, lengthS = 0): void {
    const fromS = nowS + Math.max(0, delayS);
    const untilS = fromS + Math.max(lengthS, 0) + CAPTION_HOLD_S;
    const old = this.entries.get(source.key);
    if (old && old.untilS > fromS - 1) {
      // The same source still on screen: keep its line, extend it, take the newer text.
      old.text = source.text;
      old.at = source.at;
      old.fromS = Math.min(old.fromS, fromS);
      old.untilS = Math.max(old.untilS, untilS);
      return;
    }
    this.entries.set(source.key, { ...source, fromS, untilS });
  }

  /** The lines showing at `nowS`, newest first, with arrows from the listener's view. */
  visible(
    nowS: number,
    listener: { x: number; z: number },
    forward: { x: number; z: number },
  ): CaptionView[] {
    if (!this.enabled) return [];
    const out: (CaptionView & { fromS: number })[] = [];
    for (const [key, e] of this.entries) {
      if (e.untilS <= nowS) {
        this.entries.delete(key);
        continue;
      }
      if (e.fromS > nowS) continue;
      const bearingDeg = relativeBearingDeg(listener, forward, e.at);
      out.push({
        key,
        text: e.text,
        bearingDeg,
        arrow: arrowFor(bearingDeg),
        distance: distanceWord(Math.hypot(e.at.x - listener.x, e.at.z - listener.z)),
        fromS: e.fromS,
      });
    }
    out.sort((a, b) => b.fromS - a.fromS);
    return out.slice(0, MAX_CAPTIONS).map((v) => ({
      key: v.key,
      text: v.text,
      bearingDeg: v.bearingDeg,
      arrow: v.arrow,
      distance: v.distance,
    }));
  }

  clear(): void {
    this.entries.clear();
  }
}
