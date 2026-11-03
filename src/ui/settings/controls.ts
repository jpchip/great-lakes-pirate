import { computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import {
  bindingOverrides,
  DEFAULT_BINDINGS,
  rebind,
  type Action,
  type Bindings,
} from '../../core/input';
import { applyBindingOverrides, type Settings, type SettingsStore } from '../../core/settings';
import type { AudioSettings, VolumeId } from '../../audio/settings';
import type { AudioControls } from './SettingsMenu';

/** The game's sound volumes, where they live (the mixer, or storage before the game runs). */
export interface AudioVolumes {
  settings: AudioSettings;
  setVolume(id: VolumeId, volume: number): void;
  setMuted(muted: boolean): void;
}

export interface SettingsControls {
  current: Signal<Settings>;
  bindings: ReadonlySignal<Bindings>;
  update(change: (draft: Settings) => void): void;
  rebind(action: Action, code: string): void;
  resetBindings(): void;
  audio: AudioControls | undefined;
}

/**
 * What the settings screen edits, from the settings store (plan 13 §11): shared by the
 * game's overlay and the main menu (Phase 4 piece C).
 */
export function settingsControls(
  settings: SettingsStore,
  audio: AudioVolumes | undefined,
): SettingsControls {
  const current = signal(settings.value);
  settings.subscribe((s) => (current.value = s));
  const bindings = computed(() => applyBindingOverrides(DEFAULT_BINDINGS, current.value.bindings));
  // The volumes live in the mixer; a signal copy re-renders the sliders as they move.
  const audioSettings = audio ? signal<AudioSettings>({ ...audio.settings }) : undefined;
  return {
    current,
    bindings,
    update: (change) => settings.update(change),
    rebind(action, code) {
      const next = rebind(bindings.value, 'sailing', action, code);
      settings.update((s) => (s.bindings = bindingOverrides(next)));
    },
    resetBindings: () => settings.update((s) => (s.bindings = {})),
    audio:
      audio && audioSettings
        ? {
            settings: audioSettings,
            setVolume(id, volume) {
              audio.setVolume(id, volume);
              audioSettings.value = { ...audio.settings };
            },
            setMuted(muted) {
              audio.setMuted(muted);
              audioSettings.value = { ...audio.settings };
            },
          }
        : undefined,
  };
}
