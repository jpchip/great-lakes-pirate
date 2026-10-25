import { AudioContext as SharedAudioContext } from 'three';
import { headSeaAmplitude } from '../sim/sailing/controller';
import { seaScaleAt } from '../sim/weather/waves';
import type { GameContext } from '../modes/context';
import { loadSoundBank, type SoundBank } from './bank';
import { AudioMixer, unlockAudio, type AudioState } from './mixer';
import { SailingSoundscape } from './sailing-audio';
import { loadAudioSettings, saveAudioSettings, type VolumeId } from './settings';

/**
 * Audio for the running game: the mixer on three.js's shared AudioContext (so positional
 * sounds can join it later, plan 01 §2), the autoplay unlock, and the sailing soundscape
 * fed from the player's ship each frame.
 */

export const SAILING_AUDIO_BUNDLE = 'sailing-audio';

export interface GameAudio {
  mixer: AudioMixer;
  bank: SoundBank;
  sailing: SailingSoundscape;
  /** Call once per rendered frame with the current mode. */
  update(frameSeconds: number, mode: string | undefined): void;
  setVolume(id: VolumeId, volume: number): void;
  setMuted(muted: boolean): void;
}

export interface GameAudioOptions {
  game: GameContext;
  target: Window;
  storage?: Storage | undefined;
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
  const bank = await loadSoundBank(ctx, SAILING_AUDIO_BUNDLE, target.document.baseURI);
  const sailing = new SailingSoundscape(mixer, bank);

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

  let active = false;
  const persist = (): void => saveAudioSettings(settings, storage);

  return {
    mixer,
    bank,
    sailing,
    update(frameSeconds, mode) {
      const player = game.world.with('playerControlled', 'transform', 'sailing').first;
      const sailingNow = mode === 'sailing' && player !== undefined;
      if (sailingNow !== active) {
        active = sailingNow;
        sailing.setActive(active);
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
        },
        frameSeconds,
      );
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
