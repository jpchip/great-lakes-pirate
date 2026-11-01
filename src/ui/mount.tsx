import { render } from 'preact';
import { computed, signal } from '@preact/signals';
import { bindingOverrides, DEFAULT_BINDINGS, rebind, type Action } from '../core/input';
import { applyBindingOverrides, type SettingsStore } from '../core/settings';
import { Hud } from './hud/Hud';
import type { HudSnapshot } from './hud/model';
import { SettingsMenu, type AudioControls } from './settings/SettingsMenu';
import type { AudioSettings, VolumeId } from '../audio/settings';
import { LoadingScreen } from './loading/LoadingScreen';
import { ShipCardView } from './hud/ShipCardView';
import type { ShipCard } from './hud/ship-card';
import { ChartHud, type ChartHudActions } from './chart/ChartHud';
import type { ChartHudSnapshot } from './chart/model';
import type { LoadingScreen as LoadingModel } from './loading/model';
import './theme.css';

/**
 * The Preact DOM overlay above the canvas (plan 01 §2.2, plan 13 §3): the sailing HUD
 * and the settings screen. It reads the sim through HUD snapshots and the settings
 * store; the game reacts to settings through the store, never through the UI.
 */

export interface GameUiOptions {
  root: HTMLElement;
  settings: SettingsStore;
  /** The menu opened or closed: pause or resume the game. */
  onMenu(open: boolean): void;
  /** The chart HUD's buttons (Phase 3 piece D). */
  chart?: ChartHudActions | undefined;
  /** "Take to the chart" at the soft edge. */
  onTakeToChart?: (() => void) | undefined;
  /** The game's sound volumes, when it has Web Audio. */
  audio?:
    | {
        settings: AudioSettings;
        setVolume(id: VolumeId, volume: number): void;
        setMuted(muted: boolean): void;
      }
    | undefined;
}

export interface GameUi {
  setHud(snapshot: HudSnapshot | undefined): void;
  /** The chart HUD; undefined hides it. */
  setChart(snapshot: ChartHudSnapshot | undefined): void;
  setSpyglass(on: boolean): void;
  /** The "look her over" / hail card (Phase 4 piece D); undefined hides it. */
  setShipCard(card: ShipCard | undefined): void;
  /** Show the "antialiasing needs a reload" note under the preset picker. */
  setReloadNote(on: boolean): void;
  /** The fade to fog while a zone loads; undefined lifts it. */
  setLoading(screen: LoadingModel | undefined): void;
  readonly menuOpen: boolean;
  openMenu(): void;
  closeMenu(): void;
}

export function mountGameUi({
  root,
  settings,
  onMenu,
  audio,
  chart: chartActions,
  onTakeToChart,
}: GameUiOptions): GameUi {
  const hud = signal<HudSnapshot | undefined>(undefined);
  const chart = signal<ChartHudSnapshot | undefined>(undefined);
  const spyglass = signal(false);
  const shipCard = signal<ShipCard | undefined>(undefined);
  const menuOpen = signal(false);
  const reloadNote = signal(false);
  const loading = signal<LoadingModel | undefined>(undefined);
  const current = signal(settings.value);
  settings.subscribe((s) => (current.value = s));
  const density = computed(() => current.value.ui.hudDensity);
  const bindings = computed(() => applyBindingOverrides(DEFAULT_BINDINGS, current.value.bindings));

  const setMenu = (open: boolean): void => {
    if (menuOpen.value === open) return;
    menuOpen.value = open;
    onMenu(open);
  };
  const update = (change: Parameters<SettingsStore['update']>[0]): void => settings.update(change);
  const doRebind = (action: Action, code: string): void => {
    const next = rebind(bindings.value, 'sailing', action, code);
    settings.update((s) => (s.bindings = bindingOverrides(next)));
  };
  const resetBindings = (): void => settings.update((s) => (s.bindings = {}));
  // The volumes live in the mixer; a signal copy re-renders the sliders as they move.
  const audioSettings = audio ? signal<AudioSettings>({ ...audio.settings }) : undefined;
  const audioControls: AudioControls | undefined =
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
      : undefined;

  // Esc closes the menu (plan 13 §6); opening is the sailing Pause action, in main.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && menuOpen.value) {
      e.preventDefault();
      setMenu(false);
    }
  });

  function App() {
    return (
      <>
        <Hud hud={hud} density={density} spyglass={spyglass} onTakeToChart={onTakeToChart} />
        {!menuOpen.value && <ShipCardView card={shipCard} />}
        {chartActions && <ChartHud chart={chart} actions={chartActions} />}
        {!menuOpen.value && (
          <button
            type="button"
            class="hud-menu-button"
            data-testid="open-settings"
            title="Settings (Esc)"
            onClick={() => setMenu(true)}
          >
            Settings
          </button>
        )}
        {menuOpen.value && (
          <SettingsMenu
            settings={current}
            bindings={bindings}
            update={update}
            rebind={doRebind}
            resetBindings={resetBindings}
            close={() => setMenu(false)}
            reloadNote={reloadNote}
            audio={audioControls}
          />
        )}
        <LoadingScreen screen={loading} />
      </>
    );
  }

  render(<App />, root);

  return {
    setHud(snapshot) {
      hud.value = snapshot;
    },
    setChart(snapshot) {
      chart.value = snapshot;
    },
    setSpyglass(on) {
      spyglass.value = on;
    },
    setShipCard(card) {
      shipCard.value = card;
    },
    setReloadNote(on) {
      reloadNote.value = on;
    },
    setLoading(screen) {
      loading.value = screen;
    },
    get menuOpen() {
      return menuOpen.value;
    },
    openMenu: () => setMenu(true),
    closeMenu: () => setMenu(false),
  };
}
