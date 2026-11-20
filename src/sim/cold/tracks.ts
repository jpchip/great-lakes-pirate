import { COLD } from './footing';

/**
 * Tracks in the snow (plan 11 §3.3, §18.4 piece M): where the snow lies, you leave a print
 * every stride, and a sled's runners with them. Prints last a day and are filled by an hour
 * of steady snow. A guard (the district watch, a keeper, the island posse) who comes across
 * a fresh one goes to look where the trail leads, and at the next stretch looks again, and
 * so follows it to you.
 *
 * In a district the watch only follows prints where nobody should have walked: those you
 * left while being seen would have been suspicious (`suspect`). Off it (an island, the
 * ice), every print is yours alone and is followed.
 */

export interface Print {
  x: number;
  z: number;
  heading: number;
  /** Game seconds laid. */
  at: number;
  /** The snow fallen (rate × game seconds) when laid. */
  snowAt: number;
  sled: boolean;
  suspect: boolean;
}

export class TrackLog {
  readonly prints: Print[] = [];
  /** Snowfall so far, rate × game seconds: a print is filled `fillS` of full snow later. */
  snowfall = 0;
  private walked = 0;
  private last: { x: number; z: number } | undefined;

  /** Snow falling at `rate01` for `gameSeconds`. */
  snow(rate01: number, gameSeconds: number): void {
    if (rate01 > 0) this.snowfall += rate01 * gameSeconds;
  }

  /**
   * You walked to (x, z) on snow: a print once you've gone a stride since the last. Off the
   * snow (or after a jump of more than a few meters), the stride starts over.
   */
  step(
    x: number,
    z: number,
    heading: number,
    at: number,
    onSnow: boolean,
    opts: { sled?: boolean; suspect?: boolean } = {},
  ): Print | undefined {
    const prev = this.last;
    this.last = { x, z };
    if (!onSnow || !prev) return undefined;
    const d = Math.hypot(x - prev.x, z - prev.z);
    if (d > 4) return undefined;
    this.walked += d;
    if (this.walked < COLD.tracks.spacingM) return undefined;
    this.walked = 0;
    const p: Print = {
      x,
      z,
      heading,
      at,
      snowAt: this.snowfall,
      sled: !!opts.sled,
      suspect: !!opts.suspect,
    };
    this.prints.push(p);
    if (this.prints.length > COLD.tracks.max) this.prints.shift();
    return p;
  }

  /** A print still to be seen at game time `now`. */
  visible(p: Print, now: number): boolean {
    const t = COLD.tracks;
    return now - p.at < t.lifeS && this.snowfall - p.snowAt < t.fillS;
  }

  /** Drops the prints that are gone. */
  prune(now: number): void {
    let k = 0;
    while (k < this.prints.length && !this.visible(this.prints[k] as Print, now)) k++;
    if (k > 0) this.prints.splice(0, k);
  }

  /** Breaks the trail (a fade, a new scene): the next stride starts afresh. */
  lift(): void {
    this.last = undefined;
    this.walked = 0;
  }

  /**
   * Where a guard at (x, z) who has noticed a fresh print would go: a stretch further along
   * the trail toward you, or undefined if no fresh print is in reach. `suspectOnly` keeps a
   * district's watch off the prints of honest errands.
   */
  lead(
    x: number,
    z: number,
    now: number,
    suspectOnly = false,
    near = COLD.tracks.noticeM,
  ): { x: number; z: number; index: number } | undefined {
    const t = COLD.tracks;
    let best = -1;
    for (let i = this.prints.length - 1; i >= 0; i--) {
      const p = this.prints[i] as Print;
      if (now - p.at > t.freshS) break;
      if (!this.visible(p, now) || (suspectOnly && !p.suspect)) continue;
      if (Math.hypot(p.x - x, p.z - z) <= near) {
        best = i;
        break;
      }
    }
    if (best < 0) return undefined;
    const to = Math.min(this.prints.length - 1, best + t.leadPrints);
    const p = this.prints[to] as Print;
    return { x: p.x, z: p.z, index: to };
  }
}
