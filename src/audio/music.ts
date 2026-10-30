import type { MusicMood } from './world-mix';

/**
 * Open-water music v1 (plan 15 §6, §11 Phase 2): a cue for the day and one for the
 * night, each played whole and then followed by a long silence, since "long stretches of
 * pure ambience at sea are part of the mood" (§6.2). A cue fades out when the mood turns
 * quiet (fog, heavy weather) and dips under the fog signals (ducking, §6.2). The cues
 * stream from media elements rather than being decoded into memory (§8).
 */

export interface MusicPlayer {
  /** Starts from the top at full level. */
  play(): void;
  /** Fades to silence over `seconds` and stops. */
  stop(seconds: number): void;
  /** The cue's own level, 0–1, for ducking; changes glide over `seconds`. */
  setLevel(level: number, seconds: number): void;
  readonly playing: boolean;
}

export interface MusicDirectorOptions {
  players: Partial<Record<Exclude<MusicMood, 'quiet'>, MusicPlayer>>;
  random?: () => number;
  /** Silence before the first cue, seconds. */
  firstWaitS?: [number, number];
  /** Silence between cues, seconds. */
  gapS?: [number, number];
}

/** Level the music dips to while a fog signal is heard. */
export const DUCK_LEVEL = 0.3;
/** Seconds a quiet mood fades a playing cue out over. */
export const QUIET_FADE_S = 6;

export class MusicDirector {
  /** What is playing now, for the dev panel. */
  current: Exclude<MusicMood, 'quiet'> | undefined;
  /** Seconds until the next cue may start. */
  waitS: number;
  private readonly random: () => number;
  private readonly gap: [number, number];
  private ducked = false;
  private enabled = false;

  constructor(private readonly options: MusicDirectorOptions) {
    this.random = options.random ?? Math.random;
    this.gap = options.gapS ?? [90, 240];
    const [lo, hi] = options.firstWaitS ?? [20, 45];
    this.waitS = lo + (hi - lo) * this.random();
  }

  /** Music only plays while sailing; leaving fades it out. */
  setActive(active: boolean): void {
    this.enabled = active;
    if (!active) this.stopCurrent(2);
  }

  /** Starts the next cue now (dev panel), if the mood allows one. */
  playNow(mood: MusicMood): void {
    if (mood === 'quiet') return;
    this.stopCurrent(1);
    this.start(mood);
  }

  update(dt: number, mood: MusicMood, signalHeard: boolean): void {
    if (!this.enabled) return;
    const player = this.current ? this.options.players[this.current] : undefined;
    if (player && !player.playing) {
      // The cue ended on its own: wait out a silence before the next.
      this.current = undefined;
      this.waitS = this.draw(this.gap);
      return;
    }
    if (this.current && mood === 'quiet') {
      this.stopCurrent(QUIET_FADE_S);
      this.waitS = Math.max(this.waitS, this.draw([30, 60]));
    }
    if (this.current && signalHeard !== this.ducked) {
      this.ducked = signalHeard;
      this.options.players[this.current]?.setLevel(
        signalHeard ? DUCK_LEVEL : 1,
        signalHeard ? 0.4 : 2.5,
      );
    }
    if (this.current) return;
    this.waitS -= dt;
    if (this.waitS <= 0 && mood !== 'quiet') this.start(mood);
  }

  private start(mood: Exclude<MusicMood, 'quiet'>): void {
    const player = this.options.players[mood];
    if (!player) {
      this.waitS = this.draw(this.gap);
      return;
    }
    this.current = mood;
    this.ducked = false;
    player.play();
  }

  private stopCurrent(fadeS: number): void {
    if (!this.current) return;
    this.options.players[this.current]?.stop(fadeS);
    this.current = undefined;
  }

  private draw([lo, hi]: [number, number]): number {
    return lo + (hi - lo) * this.random();
  }
}

/**
 * A streamed cue: a media element through its own gain into the music bus. Without
 * media elements (tests, workers) there's no player and the cue just never plays.
 */
export function createStreamPlayer(
  ctx: AudioContext,
  url: string,
  out: AudioNode,
  doc: Document = document,
): MusicPlayer {
  const element = doc.createElement('audio');
  element.preload = 'none';
  element.crossOrigin = 'anonymous';
  element.src = url;
  const source = ctx.createMediaElementSource(element);
  const fade = ctx.createGain();
  const level = ctx.createGain();
  source.connect(fade).connect(level).connect(out);
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    play() {
      if (stopTimer !== undefined) clearTimeout(stopTimer);
      stopTimer = undefined;
      const now = ctx.currentTime;
      fade.gain.cancelScheduledValues(now);
      fade.gain.setValueAtTime(1, now);
      level.gain.setValueAtTime(1, now);
      element.currentTime = 0;
      void element.play().catch((err: unknown) => console.warn('Music cue would not play', err));
    },
    stop(seconds) {
      const now = ctx.currentTime;
      fade.gain.cancelScheduledValues(now);
      fade.gain.setValueAtTime(fade.gain.value, now);
      fade.gain.linearRampToValueAtTime(0, now + seconds);
      if (stopTimer !== undefined) clearTimeout(stopTimer);
      stopTimer = setTimeout(() => element.pause(), seconds * 1000 + 50);
    },
    setLevel(value, seconds) {
      level.gain.setTargetAtTime(value, ctx.currentTime, Math.max(seconds, 0.01) / 3);
    },
    get playing() {
      return !element.paused && !element.ended && stopTimer === undefined;
    },
  };
}
