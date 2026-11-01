import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { GameAudio } from '../audio/game-audio';
import { CHART_SOUND, type StingerId } from '../audio/chart-audio';
import { BUS_IDS, type VolumeId } from '../audio/settings';

/**
 * Audio in the dev overlay: bus volumes and mute (also on the settings screen), buttons
 * for the event sounds, and a live readout of the sailing mix, the world around the ship,
 * the ships' whistles and the music, and the chart's stingers and fade-to-fog sound.
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
    thunderNear: () => audio.world.thunder(Math.random() * Math.PI * 2, 1200, true),
    thunderFar: () => audio.world.thunder(Math.random() * Math.PI * 2, 5000, false),
    fogSignal: () => audio.world.signalNow(),
    shipFogSignal: () => audio.whistles.fogSignalNow(),
    shipPassing: () => audio.whistles.passingNow(),
    gull: () => audio.world.callNow('gull'),
    loon: () => audio.world.callNow('loon'),
    musicDay: () => audio.music.playNow('day'),
    musicNight: () => audio.music.playNow('night'),
  };
  const events = folder.addFolder('Play').close();
  events.add(actions, 'dropAnchor').name('Drop anchor');
  events.add(actions, 'weighAnchor').name('Weigh anchor');
  events.add(actions, 'tack').name('Tack');
  events.add(actions, 'jibe').name('Jibe');
  events.add(actions, 'uncontrolledJibe').name('Uncontrolled jibe');
  events.add(actions, 'thunderNear').name('Thunder, 1.2 km');
  events.add(actions, 'thunderFar').name('Thunder, 5 km');
  events.add(actions, 'fogSignal').name('Nearest fog signal');
  events.add(actions, 'shipFogSignal').name("Nearest ship's fog signal");
  events.add(actions, 'shipPassing').name('Nearest ship: passing blast');
  events.add(actions, 'gull').name('Gull');
  events.add(actions, 'loon').name('Loon');
  events.add(actions, 'musicDay').name('Music: day');
  events.add(actions, 'musicNight').name('Music: night');
  for (const id of Object.keys(CHART_SOUND.stinger) as StingerId[]) {
    events.add({ play: () => audio.chartCues.stinger(id) }, 'play').name(`Stinger: ${id}`);
  }
  events.add({ play: () => audio.chartCues.transition() }, 'play').name('Fade to fog');

  const status = {
    context: '',
    music: '',
    mood: '',
    chartMusic: '',
    lastStinger: '',
    lastWhistle: '',
  };
  const readout = {
    voices: 0,
    sounds: audio.bank.size,
    wind: 0,
    whistle: 0,
    wash: 0,
    creakPerS: 0,
    luffPerS: 0,
    slapPerS: 0,
    rain: 0,
    fogHush: 0,
    gullsPerS: 0,
    loonsPerS: 0,
    signalsHeard: 0,
    shipsSounding: 0,
  };
  const mix = folder.addFolder('Mix').close();
  mix.add(status, 'context').disable().listen();
  mix.add(status, 'music').disable().listen();
  mix.add(status, 'mood').disable().listen();
  mix.add(status, 'chartMusic').disable().listen();
  mix.add(status, 'lastStinger').disable().listen();
  mix.add(status, 'lastWhistle').disable().listen();
  for (const key of Object.keys(readout) as (keyof typeof readout)[]) {
    mix.add(readout, key).disable().listen();
  }

  const round = (v: number): number => Math.round(v * 100) / 100;
  return {
    update() {
      status.context = (audio.mixer.ctx as BaseAudioContext).state;
      readout.voices = audio.mixer.voiceCount;
      const w = audio.world.levels;
      readout.rain = round(w.rain);
      readout.fogHush = round(w.hush);
      readout.gullsPerS = round(w.gullsPerS);
      readout.loonsPerS = round(w.loonsPerS);
      readout.signalsHeard = w.signalsHeard;
      readout.shipsSounding = audio.whistles.levels.shipsSounding;
      status.lastWhistle = audio.whistles.levels.lastSignal;
      status.mood = audio.mood;
      status.chartMusic = audio.chartMusic.playing
        ? `playing${audio.chartMusic.duckS > 0 ? ' (ducked)' : ''}`
        : 'off';
      status.lastStinger = audio.chartCues.last ?? '';
      status.music =
        audio.music.current ?? `silent ${Math.max(0, Math.round(audio.music.waitS))} s`;
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
