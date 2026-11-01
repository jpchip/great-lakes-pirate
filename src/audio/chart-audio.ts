import type { ContactKind } from '../sim/chart/traffic';
import type { SoundBank } from './bank';
import { PRIORITY, type AudioMixer } from './mixer';
import type { MusicPlayer } from './music';

/**
 * Chart audio (plan 15 §6.1, §11 Phase 3; plan 03 §20.4 piece J part 2): the chart's
 * traveling theme while the chart is open, a stinger when the lookout reports something
 * (and when you slip away from it), and the fade-to-fog sound under every loading screen.
 */

export const CHART_AUDIO_BUNDLE = 'chart-audio';
export const CHART_MUSIC_BUNDLE = 'music-chart';
export const CHART_MUSIC_CUE = 'music.chart.voyage';

export type StingerId = 'sail' | 'threat' | 'hunted' | 'squall' | 'derelict' | 'clear';

export const CHART_SOUND = {
  stinger: {
    sail: 'music.stinger.sail',
    threat: 'music.stinger.threat',
    hunted: 'music.stinger.hunted',
    squall: 'music.stinger.squall',
    derelict: 'music.stinger.derelict',
    clear: 'music.stinger.clear',
  } satisfies Record<StingerId, string>,
  transition: 'ui.transition.fog',
} as const;

/** What the lookout reported, as the chart's encounter event carries it. */
export interface SpottedContact {
  kind: ContactKind;
  hostile: boolean;
  forced: boolean;
}

/**
 * The stinger for a report: the cutter closing with no way out is the sharpest, the cutter
 * seen first a warning, weather and wrecks their own colors, and any other ship a sail.
 */
export function stingerFor(c: SpottedContact): StingerId {
  if (c.forced) return 'hunted';
  if (c.hostile || c.kind === 'cutter') return 'threat';
  if (c.kind === 'storm') return 'squall';
  if (c.kind === 'derelict') return 'derelict';
  return 'sail';
}

/** Seconds the chart must stay open before its theme starts: a quick look stays quiet. */
export const CHART_MUSIC_DELAY_S = 1.5;
/** Fade in, and out when the chart closes, seconds. */
export const CHART_MUSIC_FADE_IN_S = 2.5;
export const CHART_MUSIC_FADE_OUT_S = 1.5;
/** The theme's level under a stinger. */
export const STINGER_DUCK_LEVEL = 0.2;

/**
 * The chart's theme: it starts once the chart has been open a moment, loops for as long as
 * it stays open, dips under a stinger, and fades when the chart closes (into a zone, an
 * arena or back to the helm, where the open-water music takes over).
 */
export class ChartMusic {
  /** Seconds the chart has been open; 0 when closed. */
  openS = 0;
  /** Seconds left of the stinger the theme is ducked under. */
  duckS = 0;
  private ducked = false;

  constructor(private readonly player: MusicPlayer | undefined) {}

  get playing(): boolean {
    return this.player?.playing ?? false;
  }

  /** Dip the theme for `seconds` (a stinger's length). */
  duck(seconds: number): void {
    this.duckS = Math.max(this.duckS, seconds);
  }

  update(dt: number, open: boolean): void {
    const player = this.player;
    if (!player) return;
    if (!open) {
      if (this.openS > 0 && player.playing) player.stop(CHART_MUSIC_FADE_OUT_S);
      this.openS = 0;
      this.duckS = 0;
      this.ducked = false;
      return;
    }
    const before = this.openS;
    this.openS += dt;
    if (before < CHART_MUSIC_DELAY_S && this.openS >= CHART_MUSIC_DELAY_S && !player.playing) {
      player.play(CHART_MUSIC_FADE_IN_S);
      this.ducked = false;
    }
    this.duckS = Math.max(0, this.duckS - dt);
    const duck = this.duckS > 0;
    if (duck !== this.ducked && player.playing) {
      this.ducked = duck;
      player.setLevel(duck ? STINGER_DUCK_LEVEL : 1, duck ? 0.25 : 2);
    }
  }
}

/** The stingers and the transition sound, played from the decoded bank. */
export class ChartCues {
  /** The last stinger played, for the dev panel. */
  last: StingerId | undefined;
  /** Fade-to-fog sounds played, for the dev panel and the e2e tests. */
  transitions = 0;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private readonly music: ChartMusic,
  ) {}

  /** Plays a stinger over the theme, which dips under it. */
  stinger(id: StingerId): void {
    const buffer = this.bank.get(CHART_SOUND.stinger[id]);
    if (!buffer) return;
    this.last = id;
    this.music.duck(buffer.duration);
    this.mixer.play({ buffer, bus: 'music', priority: PRIORITY.critical });
  }

  /** The fade to fog, as a loading screen comes up. */
  transition(): void {
    const buffer = this.bank.get(CHART_SOUND.transition);
    if (!buffer) return;
    this.transitions++;
    this.mixer.play({ buffer, bus: 'ui', priority: PRIORITY.critical });
  }
}
