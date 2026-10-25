import { describe, expect, it } from 'vitest';
import { AudioMixer, MAX_VOICES, PRIORITY, type MixerContext } from '../src/audio/mixer';
import { noiseSamples } from '../src/audio/noise';
import {
  RandomTrigger,
  estimatedStrain,
  findOnsets,
  luffAmount,
  sailingMix,
  type SailingAudioInput,
} from '../src/audio/sailing-mix';
import {
  AUDIO_SETTINGS_KEY,
  defaultAudioSettings,
  loadAudioSettings,
  saveAudioSettings,
  volumeToGain,
} from '../src/audio/settings';
import { Rng } from '../src/core/rng';
import { createSailingState } from '../src/sim/sailing/controller';
import { defaultHandling } from '../src/sim/sailing/handling';
import { compileSailingClass } from '../src/sim/sailing/ship-class';
import { sailShipRecord, T1_SCHOONER_ID } from '../src/sim/sailing/ships';

const calm: SailingAudioInput = {
  windKn: 5,
  gust01: 0,
  speed01: 0.2,
  sailSetting: 3,
  luff01: 0,
  heel01: 0.1,
  motion: 0.02,
  headSeaM: 0.1,
};
const gale: SailingAudioInput = {
  ...calm,
  windKn: 38,
  gust01: 0.8,
  speed01: 0.9,
  heel01: 0.9,
  motion: 0.25,
  headSeaM: 2.5,
};

describe('sailing mix (plan 02 §9, plan 15 §4.2)', () => {
  it('gets louder and brighter in every layer from a breeze to a gale', () => {
    const a = sailingMix(calm);
    const b = sailingMix(gale);
    expect(b.windGain).toBeGreaterThan(a.windGain * 4);
    expect(b.windCutoffHz).toBeGreaterThan(a.windCutoffHz);
    expect(a.whistleGain).toBe(0);
    expect(b.whistleGain).toBeGreaterThan(0.1);
    expect(b.washGain).toBeGreaterThan(a.washGain);
    expect(b.creakPerS).toBeGreaterThan(a.creakPerS * 4);
    expect(b.slapPerS).toBeGreaterThan(a.slapPerS);
    expect(a.breakPerS).toBe(0);
    expect(b.breakPerS).toBeGreaterThan(0);
  });

  it('scales hull wash with speed, and sternway counts', () => {
    const still = sailingMix({ ...calm, speed01: 0 });
    const fast = sailingMix({ ...calm, speed01: 1 });
    expect(fast.washGain).toBeGreaterThan(still.washGain * 10);
    expect(fast.washRate).toBeGreaterThan(still.washRate);
    expect(sailingMix({ ...calm, speed01: -0.5 }).washGain).toBe(
      sailingMix({ ...calm, speed01: 0.5 }).washGain,
    );
  });

  it('uses the overpressing meter for creak when one is given', () => {
    const relaxed = sailingMix({ ...gale, strain01: 0 });
    const strained = sailingMix({ ...calm, strain01: 1 });
    expect(strained.creakPerS).toBeGreaterThan(relaxed.creakPerS);
    expect(estimatedStrain(1, 30, 3)).toBe(1);
    expect(estimatedStrain(1, 30, 0)).toBe(0);
  });

  it('flogs the canvas in irons or eased too far, never with the sails furled', () => {
    const cls = compileSailingClass(sailShipRecord(T1_SCHOONER_ID), defaultHandling());
    const s = createSailingState();
    s.sailLevel = 3;
    s.sailSetting = 3;
    expect(luffAmount(s, cls)).toBe(0);
    s.inIrons = true;
    expect(luffAmount(s, cls)).toBe(1);
    s.sailLevel = s.sailSetting = 0;
    expect(luffAmount(s, cls)).toBe(0);

    s.inIrons = false;
    s.sailLevel = s.sailSetting = 3;
    s.manualTrim = true;
    s.idealTrim = 0.2;
    s.trim = 1;
    expect(luffAmount(s, cls)).toBe(1);
    s.trim = 0.2;
    expect(luffAmount(s, cls)).toBe(0);

    // Sail being set: a light shake.
    s.sailSetting = 2.5;
    expect(luffAmount(s, cls)).toBeCloseTo(0.35);
    expect(sailingMix({ ...calm, luff01: 0 }).luffPerS).toBe(0);
  });
});

describe('random trigger', () => {
  it('fires at the asked rate on average, with irregular gaps', () => {
    const rng = Rng.fromSeed('audio-trigger');
    const t = new RandomTrigger(() => rng.next(), 0);
    let fired = 0;
    for (let i = 0; i < 60 * 600; i++) if (t.tick(1 / 60, 2)) fired++;
    expect(fired / 600).toBeGreaterThan(1.8);
    expect(fired / 600).toBeLessThan(2.2);
  });

  it('never fires at rate zero and respects the minimum gap', () => {
    const t = new RandomTrigger(() => 0.5, 1);
    for (let i = 0; i < 100; i++) expect(t.tick(0.1, 0)).toBe(false);
    let fired = 0;
    for (let i = 0; i < 100; i++) if (t.tick(0.1, 50)) fired++;
    expect(fired).toBeLessThanOrEqual(10);
  });
});

describe('clip helpers', () => {
  it('finds the separate hits in a clip', () => {
    const rate = 1000;
    const clip = new Float32Array(3000);
    for (const start of [100, 1100, 2200]) {
      for (let i = 0; i < 200; i++) clip[start + i] = Math.sin(i) * 0.8;
    }
    const onsets = findOnsets(clip, rate);
    expect(onsets).toHaveLength(3);
    expect(onsets[1]).toBeCloseTo(1.1, 1);
  });

  it('makes seamless noise loops at a fixed level', () => {
    const rng = Rng.fromSeed('audio-noise');
    for (const color of ['pink', 'brown'] as const) {
      const n = noiseSamples(48000, color, 48000, () => rng.next());
      let sum = 0;
      let maxStep = 0;
      for (let i = 0; i < n.length; i++) {
        sum += (n[i] as number) ** 2;
        if (i > 0) maxStep = Math.max(maxStep, Math.abs((n[i] as number) - (n[i - 1] as number)));
      }
      expect(Math.sqrt(sum / n.length)).toBeCloseTo(0.1, 3);
      // The wrap from the last sample to the first is no bigger than an ordinary step.
      const wrap = Math.abs((n[0] as number) - (n[n.length - 1] as number));
      expect(wrap).toBeLessThanOrEqual(maxStep);
    }
  });
});

describe('audio settings (plan 15 §7)', () => {
  it('falls back to defaults on missing or broken storage', () => {
    expect(loadAudioSettings(undefined)).toEqual(defaultAudioSettings());
    expect(loadAudioSettings({ getItem: () => '{nope' })).toEqual(defaultAudioSettings());
    expect(
      loadAudioSettings({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toEqual(defaultAudioSettings());
  });

  it('round-trips and fills in fields added later', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    saveAudioSettings({ ...defaultAudioSettings(), sfx: 0.25, muted: true }, storage);
    expect(loadAudioSettings(storage)).toMatchObject({ sfx: 0.25, muted: true });
    store.set(AUDIO_SETTINGS_KEY, JSON.stringify({ master: 0.5 }));
    expect(loadAudioSettings(storage)).toEqual({ ...defaultAudioSettings(), master: 0.5 });
  });

  it('maps the slider on a squared curve', () => {
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBe(0.25);
    expect(volumeToGain(2)).toBe(1);
  });
});

/** Just enough of an AudioContext to count voices. */
function fakeContext(): MixerContext {
  const param = () => ({
    value: 1,
    setTargetAtTime() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  const node = () => ({ connect: (n: unknown) => n, disconnect() {} });
  return {
    currentTime: 0,
    destination: node(),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param() }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      playbackRate: param(),
      onended: null,
      start() {},
      stop() {},
    }),
  } as unknown as MixerContext;
}

describe('mixer voice cap (plan 15 §8)', () => {
  const buffer = { duration: 1 } as AudioBuffer;

  it('caps one-shots and lets critical cues push out details', () => {
    const mixer = new AudioMixer(fakeContext(), defaultAudioSettings());
    for (let i = 0; i < MAX_VOICES; i++) {
      expect(mixer.play({ buffer, bus: 'sfx', priority: PRIORITY.detail })).toBeDefined();
    }
    expect(mixer.voiceCount).toBe(MAX_VOICES);
    // Another detail replaces the oldest detail; the count stays at the cap.
    expect(mixer.play({ buffer, bus: 'sfx', priority: PRIORITY.detail })).toBeDefined();
    expect(mixer.voiceCount).toBe(MAX_VOICES);

    for (let i = 0; i < MAX_VOICES; i++) {
      mixer.play({ buffer, bus: 'sfx', priority: PRIORITY.critical });
    }
    // Full of critical cues: a detail can't get in.
    expect(mixer.play({ buffer, bus: 'sfx', priority: PRIORITY.detail })).toBeUndefined();
    expect(mixer.voiceCount).toBe(MAX_VOICES);
  });

  it('applies bus volumes and mute through the master', () => {
    const mixer = new AudioMixer(fakeContext(), { ...defaultAudioSettings(), master: 0.5 });
    expect(mixer.master.gain.value).toBe(0.25);
    mixer.setMuted(true);
    expect(mixer.settings.muted).toBe(true);
  });
});
