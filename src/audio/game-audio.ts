import { AudioContext as SharedAudioContext } from 'three';
import { calendarDate } from '../core/time';
import { headSeaAmplitude } from '../sim/sailing/controller';
import { sunAt } from '../sim/weather/celestial';
import { seaScaleAt } from '../sim/weather/waves';
import type { GameContext } from '../modes/context';
import { loadSoundBank, soundUrls, type SoundBank } from './bank';
import { AudioMixer, placeListener, unlockAudio, type AudioPoint, type AudioState } from './mixer';
import { MusicDirector, createStreamPlayer, type MusicPlayer } from './music';
import { SailingSoundscape } from './sailing-audio';
import { loadAudioSettings, saveAudioSettings, type VolumeId } from './settings';
import { WorldSoundscape, type SignalStation } from './world-audio';
import { musicMood, type MusicMood } from './world-mix';

/**
 * Audio for the running game: the mixer on three.js's shared AudioContext (plan 01 §2),
 * the autoplay unlock, the sailing soundscape fed from the player's ship each frame, the
 * world around it (weather, fog signals, birds; Phase 2 piece H), and open-water music.
 */

export const SAILING_AUDIO_BUNDLE = 'sailing-audio';
export const WORLD_AUDIO_BUNDLE = 'world-audio';
export const MUSIC_BUNDLE = 'music-open-water';
export const MUSIC_CUES: Readonly<Record<Exclude<MusicMood, 'quiet'>, string>> = {
  day: 'music.open-water.day',
  night: 'music.open-water.night',
};

/** Where the ears are: the camera, and which way it looks (zone axes). */
export interface ListenerPose {
  at: AudioPoint;
  forward: AudioPoint;
}

export interface GameAudio {
  mixer: AudioMixer;
  bank: SoundBank;
  sailing: SailingSoundscape;
  world: WorldSoundscape;
  music: MusicDirector;
  /** The music mood now, for the dev panel. */
  readonly mood: MusicMood;
  /** Call once per rendered frame with the current mode. */
  update(frameSeconds: number, mode: string | undefined): void;
  /** Hear from the camera instead of the ship once there is one. */
  setListener(pose: () => ListenerPose): void;
  setVolume(id: VolumeId, volume: number): void;
  setMuted(muted: boolean): void;
}

export interface GameAudioOptions {
  game: GameContext;
  target: Window;
  storage?: Storage | undefined;
  /** The lights with fog signals, placed in the zone. */
  stations?: readonly SignalStation[];
  /** Points in the harbors (pier roots), where the gulls gather. */
  harbors?: readonly { x: number; z: number }[];
  /** Each lock-state change, e.g. for a "click to enable sound" hint. */
  onState?: (state: AudioState) => void;
}

/** Undefined when the browser has no Web Audio; the game runs silent then. */
export async function createGameAudio(options: GameAudioOptions): Promise<GameAudio | undefined> {
  const { game, target, storage } = options;
  if (!('AudioContext' in target)) {
    options.onState?.('unavailable');
    return undefined;
  }
  const ctx = SharedAudioContext.getContext() as AudioContext;
  const settings = loadAudioSettings(storage);
  const mixer = new AudioMixer(ctx, settings);
  unlockAudio(ctx, target, options.onState);

  // Decoding works while the context is still locked, so this needn't wait for a click.
  const baseUrl = target.document.baseURI;
  const [bank, musicUrls] = await Promise.all([
    loadSoundBank(ctx, [SAILING_AUDIO_BUNDLE, WORLD_AUDIO_BUNDLE], baseUrl),
    soundUrls(MUSIC_BUNDLE, baseUrl).catch((err: unknown) => {
      console.warn('Music unavailable', err);
      return new Map<string, string>();
    }),
  ]);
  const sailing = new SailingSoundscape(mixer, bank);
  const world = new WorldSoundscape(mixer, bank, options.stations);
  const players: Partial<Record<Exclude<MusicMood, 'quiet'>, MusicPlayer>> = {};
  for (const [mood, id] of Object.entries(MUSIC_CUES) as [Exclude<MusicMood, 'quiet'>, string][]) {
    const url = musicUrls.get(id);
    if (url) players[mood] = createStreamPlayer(ctx, url, mixer.buses.music, target.document);
  }
  const music = new MusicDirector({ players });

  const isPlayer = (shipId: string | undefined): boolean => {
    const player = game.world.with('playerControlled').first;
    return player !== undefined && shipId === player.id;
  };
  game.events.on('ShipTacked', ({ shipId }) => {
    if (isPlayer(shipId)) sailing.tacked();
  });
  game.events.on('ShipJibed', ({ shipId, uncontrolled }) => {
    if (isPlayer(shipId)) sailing.jibed(uncontrolled);
  });
  const depthUnderPlayer = (): number => {
    const p = game.world.with('playerControlled', 'transform').first?.transform.position;
    return p ? (game.terrain?.depthAt(p.x, p.z) ?? 10) : 10;
  };
  game.events.on('AnchorDropped', ({ shipId }) => {
    if (isPlayer(shipId)) sailing.anchorDropped(depthUnderPlayer());
  });
  game.events.on('AnchorWeighed', ({ shipId }) => {
    if (isPlayer(shipId)) sailing.anchorWeighed(depthUnderPlayer());
  });

  let active = false;
  let mood: MusicMood = 'quiet';
  let nowS = 0;
  let listener: (() => ListenerPose) | undefined;
  const towardShore = { x: 0, z: 0 };
  const harbors = options.harbors ?? [];
  const persist = (): void => saveAudioSettings(settings, storage);

  return {
    mixer,
    bank,
    sailing,
    world,
    music,
    get mood() {
      return mood;
    },
    update(frameSeconds, mode) {
      nowS += frameSeconds;
      const player = game.world.with('playerControlled', 'transform', 'sailing').first;
      const sailingNow = mode === 'sailing' && player !== undefined;
      if (sailingNow !== active) {
        active = sailingNow;
        sailing.setActive(active);
        world.setActive(active);
        music.setActive(active);
      }
      if (!player || !sailingNow || ctx.state !== 'running') return;

      const { state, cls } = player.sailing;
      const gameSeconds = game.state.environment.clock.gameSeconds;
      const wind = game.weather.windAt({ x: state.x, z: state.z }, gameSeconds);
      sailing.update(
        {
          state,
          cls,
          transform: player.transform,
          headSeaM: headSeaAmplitude(
            game.sea.waves,
            state.heading,
            seaScaleAt(game.sea, state.x, state.z),
          ),
          gust01: wind.gust01,
          strain01: player.hazards?.state.strain,
        },
        frameSeconds,
      );

      const pose = listener?.() ?? {
        at: { x: state.x, y: 3, z: state.z },
        forward: { x: Math.sin(state.heading), y: 0, z: -Math.cos(state.heading) },
      };
      placeListener(ctx, pose.at, pose.forward);
      const terrain = game.terrain;
      if (terrain) terrain.shoreNormalAt(state.x, state.z, towardShore);
      let harborDistanceM = Infinity;
      for (const h of harbors) {
        harborDistanceM = Math.min(harborDistanceM, Math.hypot(h.x - state.x, h.z - state.z));
      }
      const sunElevationDeg = (sunAt(gameSeconds).elevationRad * 180) / Math.PI;
      const fogVisibilityM = game.weather.fogVisibilityAt(gameSeconds);
      const rain01 = game.weather.rainAt(gameSeconds);
      const storm01 = game.weather.stormAt(gameSeconds);
      world.update(
        {
          listener: pose.at,
          ship: { x: state.x, z: state.z },
          nowS,
          windKn: state.windKn,
          rain01,
          storm01,
          fogVisibilityM,
          fogBanks: game.weather.fogBanks(gameSeconds),
          sunElevationDeg,
          month0: calendarDate(gameSeconds).getUTCMonth(),
          shoreDistanceM: terrain?.contains(state.x, state.z)
            ? terrain.shoreDistanceAt(state.x, state.z)
            : 5000,
          // The shore normal points out to sea; the shore is the other way.
          towardShore: { x: -towardShore.x, z: -towardShore.z },
          harborDistanceM,
        },
        frameSeconds,
      );
      mood = musicMood({ sunElevationDeg, fogVisibilityM, windKn: state.windKn, rain01, storm01 });
      music.update(frameSeconds, mood, world.signalHeard);
    },
    setListener(pose) {
      listener = pose;
    },
    setVolume(id, volume) {
      mixer.setVolume(id, volume);
      persist();
    },
    setMuted(muted) {
      mixer.setMuted(muted);
      persist();
    },
  };
}
