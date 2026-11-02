import { render } from 'preact';
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from '../../audio/settings';
import type { SettingsStore } from '../../core/settings';
import { settingsControls } from '../settings/controls';
import { MainMenu, type MenuChoice } from './MainMenu';
import type { SavedRunSummary } from './model';

/**
 * Puts the main menu on the UI root before the game boots (Phase 4 piece C) and waits
 * for Continue or a new captain. The sound volumes are edited in storage here; the game's
 * mixer reads them when it starts. Once a choice is made the menu shows the fog card
 * while the game loads, and the game's own UI replaces it.
 */
export function showMainMenu(opts: {
  root: HTMLElement;
  settings: SettingsStore;
  storage: Storage | undefined;
  saved: SavedRunSummary | undefined;
  savedProblem: string | undefined;
  /** Character creation opened (true) or closed back to the title (false). */
  onCreating(creating: boolean): void;
  /** The fog card's words once a choice is made. */
  loading(choice: MenuChoice): { title: string; line: string };
}): Promise<MenuChoice> {
  const volumes: AudioSettings = loadAudioSettings(opts.storage);
  const controls = settingsControls(opts.settings, {
    settings: volumes,
    setVolume(id, volume) {
      volumes[id] = volume;
      saveAudioSettings(volumes, opts.storage);
    },
    setMuted(muted) {
      volumes.muted = muted;
      saveAudioSettings(volumes, opts.storage);
    },
  });
  return new Promise((resolve) => {
    const choose = (choice: MenuChoice): void => {
      const card = opts.loading(choice);
      render(
        <div class="front" data-testid="front-loading">
          <div class="loading loading-on">
            <div class="loading-card">
              <div class="loading-kicker">Making for</div>
              <div class="loading-title">{card.title}</div>
              <div class="loading-rule" />
              <div class="loading-line">{card.line}</div>
            </div>
          </div>
        </div>,
        opts.root,
      );
      resolve(choice);
    };
    render(
      <MainMenu
        saved={opts.saved}
        savedProblem={opts.savedProblem}
        settings={controls}
        choose={choose}
        onCreating={opts.onCreating}
      />,
      opts.root,
    );
  });
}
