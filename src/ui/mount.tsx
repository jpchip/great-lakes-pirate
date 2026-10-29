import { render } from 'preact';
import { computed, signal } from '@preact/signals';
import { bindingOverrides, DEFAULT_BINDINGS, rebind, type Action } from '../core/input';
import { applyBindingOverrides, type SettingsStore } from '../core/settings';
import { Hud } from './hud/Hud';
import type { HudSnapshot } from './hud/model';
import { SettingsMenu } from './settings/SettingsMenu';
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
}

export interface GameUi {
  setHud(snapshot: HudSnapshot | undefined): void;
  setSpyglass(on: boolean): void;
  /** Show the "antialiasing needs a reload" note under the preset picker. */
  setReloadNote(on: boolean): void;
  readonly menuOpen: boolean;
  openMenu(): void;
  closeMenu(): void;
}

export function mountGameUi({ root, settings, onMenu }: GameUiOptions): GameUi {
  const hud = signal<HudSnapshot | undefined>(undefined);
  const spyglass = signal(false);
  const menuOpen = signal(false);
  const reloadNote = signal(false);
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
        <Hud hud={hud} density={density} spyglass={spyglass} />
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
          />
        )}
      </>
    );
  }

  render(<App />, root);

  return {
    setHud(snapshot) {
      hud.value = snapshot;
    },
    setSpyglass(on) {
      spyglass.value = on;
    },
    setReloadNote(on) {
      reloadNote.value = on;
    },
    get menuOpen() {
      return menuOpen.value;
    },
    openMenu: () => setMenu(true),
    closeMenu: () => setMenu(false),
  };
}
