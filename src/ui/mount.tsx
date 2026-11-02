import { render } from 'preact';
import { computed, signal } from '@preact/signals';
import type { Action } from '../core/input';
import type { SettingsStore } from '../core/settings';
import { Hud } from './hud/Hud';
import type { HudSnapshot } from './hud/model';
import { SettingsMenu } from './settings/SettingsMenu';
import { settingsControls, type AudioVolumes } from './settings/controls';
import { LoadingScreen } from './loading/LoadingScreen';
import { ShipCardView } from './hud/ShipCardView';
import type { ShipCard } from './hud/ship-card';
import { ChartHud, type ChartHudActions } from './chart/ChartHud';
import type { ChartHudSnapshot } from './chart/model';
import type { LoadingScreen as LoadingModel } from './loading/model';
import { PortScreen, type PortActions } from './port/PortScreen';
import { Journal } from './port/Ledger';
import type { LedgerSnapshot, PortSnapshot, PortTab } from './port/model';
import { FirstWeekPage, FirstWeekTracker } from './hud/FirstWeek';
import type { FirstWeekSnapshot } from '../gameplay/captain';
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
  /** Put the First Week tracker away or bring it back (Phase 4 piece C). */
  setFirstWeekHidden?: ((hidden: boolean) => void) | undefined;
  /** The port screen's buttons and the journal's (Phase 4 piece B). */
  port?: (PortActions & { closeJournal(): void; openDocked(): void }) | undefined;
  /** The game's sound volumes, when it has Web Audio. */
  audio?: AudioVolumes | undefined;
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
  /** The port screen; undefined closes it. */
  setPort(snapshot: PortSnapshot | undefined): void;
  /** The journal's ledger at the helm; undefined closes it. */
  setJournal(snapshot: LedgerSnapshot | undefined): void;
  /** The First Week checklist (Phase 4 piece C); undefined for a run without one. */
  setFirstWeek(snapshot: FirstWeekSnapshot | undefined): void;
  /** Show a port screen tab (J in port turns to the ledger). */
  setPortTab(tab: PortTab): void;
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
  port: portActions,
  setFirstWeekHidden = () => undefined,
}: GameUiOptions): GameUi {
  const firstWeek = signal<FirstWeekSnapshot | undefined>(undefined);
  const port = signal<PortSnapshot | undefined>(undefined);
  const portTab = signal<PortTab>('market');
  const journal = signal<LedgerSnapshot | undefined>(undefined);
  const hud = signal<HudSnapshot | undefined>(undefined);
  const chart = signal<ChartHudSnapshot | undefined>(undefined);
  const spyglass = signal(false);
  const shipCard = signal<ShipCard | undefined>(undefined);
  const menuOpen = signal(false);
  const reloadNote = signal(false);
  const loading = signal<LoadingModel | undefined>(undefined);
  const controls = settingsControls(settings, audio);
  const { current, bindings } = controls;
  const density = computed(() => current.value.ui.hudDensity);

  const setMenu = (open: boolean): void => {
    if (menuOpen.value === open) return;
    menuOpen.value = open;
    onMenu(open);
  };

  // Esc closes the menu (plan 13 §6); opening is the sailing Pause action, in main.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (menuOpen.value) {
      e.preventDefault();
      setMenu(false);
    } else if (port.value) {
      e.preventDefault();
      portActions?.close();
    } else if (journal.value) {
      e.preventDefault();
      portActions?.closeJournal();
    }
  });
  // In port, F casts off and J turns to the ledger; J closes the journal (plan 13 §6).
  window.addEventListener('keydown', (e) => {
    if (menuOpen.value || e.repeat) return;
    const keys = bindings.value.sailing;
    const is = (action: Action): boolean => (keys[action] ?? []).includes(e.code);
    if (port.value && is('Interact')) {
      e.preventDefault();
      portActions?.castOff();
    } else if (port.value && is('Journal')) {
      e.preventDefault();
      portTab.value = 'ledger';
    } else if (journal.value && is('Journal')) {
      e.preventDefault();
      portActions?.closeJournal();
    }
  });

  function App() {
    return (
      <>
        <Hud
          hud={hud}
          density={density}
          spyglass={spyglass}
          onTakeToChart={onTakeToChart}
          onOpenPort={portActions?.openDocked}
        />
        {!menuOpen.value && <ShipCardView card={shipCard} />}
        {chartActions && <ChartHud chart={chart} actions={chartActions} />}
        {port.value && portActions && !menuOpen.value && (
          <PortScreen
            port={port.value}
            actions={portActions}
            tab={portTab.value}
            setTab={(t) => (portTab.value = t)}
          />
        )}
        {journal.value && portActions && !menuOpen.value && (
          <Journal
            ledger={journal.value}
            close={portActions.closeJournal}
            extra={
              firstWeek.value && (
                <FirstWeekPage week={firstWeek.value} setHidden={setFirstWeekHidden} />
              )
            }
          />
        )}
        {firstWeek.value &&
          !firstWeek.value.hidden &&
          !menuOpen.value &&
          !port.value &&
          !journal.value &&
          !chart.value && (
            <FirstWeekTracker week={firstWeek.value} setHidden={setFirstWeekHidden} />
          )}
        {!menuOpen.value && !port.value && !journal.value && (
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
            update={controls.update}
            rebind={controls.rebind}
            resetBindings={controls.resetBindings}
            close={() => setMenu(false)}
            reloadNote={reloadNote}
            audio={controls.audio}
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
    setPort(snapshot) {
      // A fresh visit starts on the market; a refresh after a trade stays on its tab.
      if (snapshot && port.value?.port !== snapshot.port) portTab.value = 'market';
      port.value = snapshot;
    },
    setJournal(snapshot) {
      journal.value = snapshot;
    },
    setFirstWeek(snapshot) {
      firstWeek.value = snapshot;
    },
    setPortTab(tab) {
      portTab.value = tab;
    },
    get menuOpen() {
      return menuOpen.value;
    },
    openMenu: () => setMenu(true),
    closeMenu: () => setMenu(false),
  };
}
