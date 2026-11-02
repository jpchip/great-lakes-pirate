import type { SoundBank } from './bank';
import { PRIORITY, type AudioMixer, type AudioPoint, type OneShot } from './mixer';
import { RandomTrigger } from './sailing-mix';
import { WORK, workActivity, workLevel, type WorkKind, type WorkSite } from './harbor-mix';
import { SOUND_MS } from './world-mix';

/**
 * The harbors at work (plan 15 §4.1 "Docks at day", Phase 4 piece J): a sawmill's head
 * saw biting into a log, caulking mallets at the Superior shipyard, the cooper at
 * Bayfield, ore cars dumping into the Ashland and Two Harbors pockets, and the railroad
 * banging cars together along the docks. Each site sounds on its own clock while its
 * work is going on (harbor-mix.ts: the hours, the season, the weather) and the listener
 * is in range; every sound is placed at its site and arrives at the speed of sound.
 */

export const HARBOR_AUDIO_BUNDLE = 'harbor-audio';

export const HARBOR_SOUND = {
  saw: 'amb.harbor.mill-saw',
  hammerWood: 'amb.harbor.hammer-wood',
  hammerMetal: 'amb.harbor.hammer-metal',
  oreDump: 'amb.harbor.ore-dump',
  carBang: 'amb.harbor.car-bang',
} as const;

/** What the harbor soundscape reads each frame. */
export interface HarborFrame {
  listener: AudioPoint;
  /** Local hour 0–24 and calendar month (0 = January). */
  hour: number;
  month0: number;
  rain01: number;
  storm01: number;
  /** The fog's roll-off on distant sounds (world-mix `fogMix().damping`). */
  damping: number;
}

/** Overall level of the harbor sounds against the other ambience. */
const HARBOR_GAIN = 0.8;

export class HarborWorks {
  /** The latest readout, for the dev panel. */
  readonly levels = { sitesAtWork: 0, sitesHeard: 0, last: '' };
  private sites: readonly WorkSite[] = [];
  private readonly triggers = new Map<string, RandomTrigger>();
  private last: HarborFrame | undefined;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private readonly random: () => number = Math.random,
  ) {}

  /** The zone's work sites (its harbors' mills, yards and docks). */
  setSites(sites: readonly WorkSite[]): void {
    this.sites = sites;
    this.triggers.clear();
  }

  get siteCount(): number {
    return this.sites.length;
  }

  update(f: HarborFrame, dt: number): void {
    if (dt <= 0) return;
    this.last = f;
    let atWork = 0;
    let heard = 0;
    for (const site of this.sites) {
      const activity = workActivity(site.kind, f.hour, f.month0, f.rain01, f.storm01);
      if (activity <= 0) continue;
      atWork++;
      const d = dist(site, f.listener);
      const level = workLevel(site.kind, d, f.damping);
      if (!level) continue;
      heard++;
      let trigger = this.triggers.get(site.id);
      if (!trigger) {
        trigger = new RandomTrigger(this.random, 2);
        this.triggers.set(site.id, trigger);
      }
      const rate = activity * WORK[site.kind].perS;
      if (trigger.tick(dt, rate)) this.sound(site, level, d / SOUND_MS);
    }
    this.levels.sitesAtWork = atWork;
    this.levels.sitesHeard = heard;
  }

  /** The nearest site of `kind` (or any) sounds once now, for the dev panel. */
  workNow(kind?: WorkKind): void {
    const f = this.last;
    if (!f) return;
    const site = this.sites
      .filter((s) => !kind || s.kind === kind)
      .sort((a, b) => dist(a, f.listener) - dist(b, f.listener))[0];
    if (!site) return;
    const d = dist(site, f.listener);
    this.sound(
      site,
      workLevel(site.kind, d, f.damping) ?? { gain: 0.05, lowpassHz: 900 },
      d / SOUND_MS,
    );
  }

  private sound(site: WorkSite, level: { gain: number; lowpassHz: number }, delay: number): void {
    this.levels.last = `${site.kind} (${site.id})`;
    const at = { x: site.x, y: site.y, z: site.z };
    const base = { lowpassHz: level.lowpassHz, priority: PRIORITY.detail, at };
    const g = level.gain * HARBOR_GAIN;
    switch (site.kind) {
      case 'saw':
        this.play(HARBOR_SOUND.saw, { ...base, gain: g, delay, rate: this.between(0.94, 1.06) });
        break;
      case 'caulking':
      case 'cooper': {
        // A burst of blows: a slice of the recording, a few seconds long.
        const id = site.kind === 'caulking' ? HARBOR_SOUND.hammerWood : HARBOR_SOUND.hammerMetal;
        const buffer = this.bank.get(id);
        if (!buffer) return;
        const length = Math.min(buffer.duration, this.between(1.5, 4));
        this.mixer.play({
          buffer,
          bus: 'ambience',
          ...base,
          gain: g * this.between(0.6, 1),
          delay,
          rate: this.between(0.92, 1.08),
          offset: this.random() * Math.max(0, buffer.duration - length),
          duration: length,
          fadeOutS: 0.25,
        });
        break;
      }
      case 'ore':
        // The car is spotted over the pocket (a bang as the train stops), then dumped.
        this.play(HARBOR_SOUND.carBang, {
          ...base,
          gain: 0.5 * g,
          delay,
          rate: this.between(0.8, 0.95),
        });
        this.play(HARBOR_SOUND.oreDump, {
          ...base,
          gain: g,
          delay: delay + this.between(1.2, 2.5),
          rate: this.between(0.92, 1.05),
        });
        break;
      case 'yard': {
        // The slack running out of a train: bangs rippling down the cars, each softer.
        const cars = 3 + Math.floor(this.random() * 5);
        let t = 0;
        for (let k = 0; k < cars; k++) {
          this.play(HARBOR_SOUND.carBang, {
            ...base,
            gain: g * 0.9 ** k * this.between(0.7, 1),
            delay: delay + t,
            rate: this.between(0.78, 1.0),
          });
          t += this.between(0.28, 0.6);
        }
        break;
      }
    }
  }

  private play(id: string, shot: Omit<OneShot, 'buffer' | 'bus'>): void {
    const buffer = this.bank.get(id);
    if (buffer) this.mixer.play({ buffer, bus: 'ambience', ...shot });
  }

  private between(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }
}

function dist(a: AudioPoint, b: AudioPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
