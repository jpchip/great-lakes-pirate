import { BUS_IDS, volumeToGain, type AudioSettings, type BusId, type VolumeId } from './settings';

/**
 * The thin mixer over Web Audio (plan 01 §2, plan 15 §7): a master gain, one gain per
 * bus, a voice cap with priorities (plan 15 §8), and the autoplay unlock. Sounds connect
 * to a bus; the mixer never knows what they are.
 */

/** Simultaneous one-shot voices (plan 15 §8). Looping beds are not counted. */
export const MAX_VOICES = 24;

/** Voice priorities: gameplay-critical cues > nearby SFX > ambience details. */
export const PRIORITY = { detail: 0, sfx: 1, critical: 2 } as const;

/** Seconds for gain changes to settle, so slider moves and mutes never click. */
const RAMP_S = 0.05;

export type MixerContext = Pick<
  BaseAudioContext,
  | 'createGain'
  | 'createBufferSource'
  | 'createBiquadFilter'
  | 'createPanner'
  | 'currentTime'
  | 'destination'
>;

/** A point in zone meters (x east, y up, z south), for positional sounds. */
export interface AudioPoint {
  x: number;
  y: number;
  z: number;
}

export interface OneShot {
  buffer: AudioBuffer;
  bus: BusId;
  /** Linear gain on top of the bus. */
  gain?: number;
  /** Playback rate; it shifts pitch too. */
  rate?: number;
  /** Start this far into the buffer, seconds. */
  offset?: number;
  /** Play only this long (buffer seconds), with a short fade-out. */
  duration?: number;
  /** With `duration`: fade out over this long (real seconds) instead of the short default. */
  fadeOutS?: number;
  /**
   * Pan the voice toward this point from the listener (plan 15 §7: equal-power panning).
   * Only the direction: distance is the caller's `gain` and `lowpassHz`, since the zone's
   * distances are compressed and each kind of sound carries differently.
   */
  at?: AudioPoint;
  /** Seconds from now. */
  delay?: number;
  /** Low-pass the voice at this frequency, Hz (distance, muffling). */
  lowpassHz?: number;
  priority?: number;
}

interface Voice {
  source: AudioBufferSourceNode;
  priority: number;
  startedAt: number;
}

export class AudioMixer {
  readonly master: GainNode;
  readonly buses: Readonly<Record<BusId, GainNode>>;
  private readonly voices: Voice[] = [];

  constructor(
    readonly ctx: MixerContext,
    readonly settings: AudioSettings,
  ) {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    const buses = {} as Record<BusId, GainNode>;
    for (const id of BUS_IDS) {
      const bus = ctx.createGain();
      bus.connect(this.master);
      buses[id] = bus;
    }
    this.buses = buses;
    this.applyAll(true);
  }

  get voiceCount(): number {
    return this.voices.length;
  }

  setVolume(id: VolumeId, volume: number): void {
    this.settings[id] = Math.min(Math.max(volume, 0), 1);
    this.applyAll();
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.applyAll();
  }

  /** Plays a buffer once on a bus. Returns undefined when the voice cap drops it. */
  play(shot: OneShot): AudioBufferSourceNode | undefined {
    const priority = shot.priority ?? PRIORITY.sfx;
    if (!this.makeRoom(priority)) return undefined;

    const { ctx } = this;
    const source = ctx.createBufferSource();
    source.buffer = shot.buffer;
    source.playbackRate.value = shot.rate ?? 1;
    const gain = ctx.createGain();
    gain.gain.value = shot.gain ?? 1;
    let head: AudioNode = source;
    if (shot.lowpassHz !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = shot.lowpassHz;
      source.connect(filter);
      head = filter;
    }
    head.connect(gain);
    let panner: PannerNode | undefined;
    if (shot.at) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.rolloffFactor = 0;
      setPosition(panner, shot.at);
      gain.connect(panner);
      panner.connect(this.buses[shot.bus]);
    } else {
      gain.connect(this.buses[shot.bus]);
    }

    const start = ctx.currentTime + (shot.delay ?? 0);
    const offset = Math.min(shot.offset ?? 0, Math.max(shot.buffer.duration - 0.01, 0));
    if (shot.duration !== undefined) {
      const real = shot.duration / (shot.rate ?? 1);
      const fade = Math.min(shot.fadeOutS ?? 0.08, real / 3);
      gain.gain.setValueAtTime(shot.gain ?? 1, start + real - fade);
      gain.gain.linearRampToValueAtTime(0, start + real);
      source.start(start, offset, shot.duration);
    } else {
      source.start(start, offset);
    }

    const voice: Voice = { source, priority, startedAt: start };
    this.voices.push(voice);
    source.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
    };
    return source;
  }

  /** Frees a voice for a new one of this priority: the oldest of the lowest priority. */
  private makeRoom(priority: number): boolean {
    if (this.voices.length < MAX_VOICES) return true;
    let victim: Voice | undefined;
    for (const v of this.voices) {
      if (v.priority > priority) continue;
      if (
        !victim ||
        v.priority < victim.priority ||
        (v.priority === victim.priority && v.startedAt < victim.startedAt)
      ) {
        victim = v;
      }
    }
    if (!victim) return false;
    this.voices.splice(this.voices.indexOf(victim), 1);
    victim.source.onended = null;
    victim.source.stop();
    victim.source.disconnect();
    return true;
  }

  private applyAll(immediate = false): void {
    const s = this.settings;
    const set = (node: GainNode, value: number): void => {
      if (immediate) node.gain.value = value;
      else node.gain.setTargetAtTime(value, this.ctx.currentTime, RAMP_S / 3);
    };
    set(this.master, s.muted ? 0 : volumeToGain(s.master));
    for (const id of BUS_IDS) set(this.buses[id], volumeToGain(s[id]));
  }
}

/** Moves a panner, with the AudioParams where the browser has them. */
export function setPosition(node: PannerNode, p: AudioPoint): void {
  if (node.positionX) {
    node.positionX.value = p.x;
    node.positionY.value = p.y;
    node.positionZ.value = p.z;
  } else {
    node.setPosition(p.x, p.y, p.z);
  }
}

/**
 * Puts the Web Audio listener at the camera, facing `forward` (zone axes; y up), so
 * positional sounds pan by where the player is looking. Call once a frame.
 */
export function placeListener(
  ctx: Pick<BaseAudioContext, 'listener'>,
  at: AudioPoint,
  forward: AudioPoint,
): void {
  const l = ctx.listener;
  if (l.positionX) {
    l.positionX.value = at.x;
    l.positionY.value = at.y;
    l.positionZ.value = at.z;
    l.forwardX.value = forward.x;
    l.forwardY.value = forward.y;
    l.forwardZ.value = forward.z;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  } else {
    l.setPosition(at.x, at.y, at.z);
    l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
  }
}

export type AudioState = 'locked' | 'running' | 'unavailable';

/**
 * Browsers start audio suspended until the player interacts (plan 15 §8). Resumes the
 * context on the first key, click or tap, and suspends it while the tab is hidden so the
 * sea doesn't keep roaring in a background tab. `onState` reports each change.
 */
export function unlockAudio(
  ctx: AudioContext,
  target: Window,
  onState: (state: AudioState) => void = () => {},
): () => void {
  let unlocked = ctx.state === 'running';
  const report = (): void => onState(ctx.state === 'running' ? 'running' : 'locked');
  const resume = (): void => {
    void ctx.resume().then(() => {
      unlocked = ctx.state === 'running';
      if (unlocked) for (const type of GESTURES) target.removeEventListener(type, resume, true);
    });
  };
  const visibility = (): void => {
    if (target.document.visibilityState === 'hidden') void ctx.suspend();
    else if (unlocked) void ctx.resume();
  };
  const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;
  for (const type of GESTURES) target.addEventListener(type, resume, true);
  target.document.addEventListener('visibilitychange', visibility);
  ctx.addEventListener('statechange', report);
  report();
  return () => {
    for (const type of GESTURES) target.removeEventListener(type, resume, true);
    target.document.removeEventListener('visibilitychange', visibility);
    ctx.removeEventListener('statechange', report);
  };
}
