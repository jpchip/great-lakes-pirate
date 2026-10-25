import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { GameAudio } from '../audio/game-audio';
import { BUS_IDS, type VolumeId } from '../audio/settings';

/**
 * Audio in the dev overlay: bus volumes and mute until the settings menu (plan 13 §12)
 * has them, buttons for the event sounds, and a live readout of the sailing mix.
 */
export interface AudioPanelOptions {
  gui: GUI;
  audio: GameAudio;
  /** Water depth under the ship, for the anchor's chain length. */
  depthM: () => number;
}

export function createAudioPanel(options: AudioPanelOptions): { update(): void } {
  const { audio } = options;
  const folder = options.gui.addFolder('Audio').close();
  const settings = audio.mixer.settings;

  folder.add(settings, 'muted').onChange((v: boolean) => audio.setMuted(v));
  for (const id of ['master', ...BUS_IDS] as VolumeId[]) {
    folder.add(settings, id, 0, 1, 0.01).onChange((v: number) => audio.setVolume(id, v));
  }

  const actions = {
    dropAnchor: () => audio.sailing.anchorDropped(options.depthM()),
    weighAnchor: () => audio.sailing.anchorWeighed(options.depthM()),
    tack: () => audio.sailing.tacked(),
    jibe: () => audio.sailing.jibed(false),
    uncontrolledJibe: () => audio.sailing.jibed(true),
  };
  const events = folder.addFolder('Play').close();
  events.add(actions, 'dropAnchor').name('Drop anchor');
  events.add(actions, 'weighAnchor').name('Weigh anchor');
  events.add(actions, 'tack').name('Tack');
  events.add(actions, 'jibe').name('Jibe');
  events.add(actions, 'uncontrolledJibe').name('Uncontrolled jibe');

  const status = { context: '' };
  const readout = {
    voices: 0,
    sounds: audio.bank.size,
    wind: 0,
    whistle: 0,
    wash: 0,
    creakPerS: 0,
    luffPerS: 0,
    slapPerS: 0,
  };
  const mix = folder.addFolder('Mix').close();
  mix.add(status, 'context').disable().listen();
  for (const key of Object.keys(readout) as (keyof typeof readout)[]) {
    mix.add(readout, key).disable().listen();
  }

  const round = (v: number): number => Math.round(v * 100) / 100;
  return {
    update() {
      status.context = (audio.mixer.ctx as BaseAudioContext).state;
      readout.voices = audio.mixer.voiceCount;
      const m = audio.sailing.levels;
      if (!m) return;
      readout.wind = round(m.windGain);
      readout.whistle = round(m.whistleGain);
      readout.wash = round(m.washGain);
      readout.creakPerS = round(m.creakPerS);
      readout.luffPerS = round(m.luffPerS);
      readout.slapPerS = round(m.slapPerS);
    },
  };
}
