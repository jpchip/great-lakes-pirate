import { render } from 'preact';
import { computed, signal } from '@preact/signals';
import type { Action } from '../core/input';
import type { SettingsStore } from '../core/settings';
import { Hud } from './hud/Hud';
import type { HudSnapshot } from './hud/model';
import type { CaptionView } from '../audio/captions';
import { Captions } from './hud/Captions';
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
import { SmugglerScreen, type SmugglerActions } from './port/SmugglerScreen';
import type { SmugglerSnapshot } from './port/smuggler-model';
import { LieDialog, StashScreen } from './stash/StashScreen';
import type { StashSnapshot } from './stash/model';
import type { StashActions } from '../gameplay/stash';
import { FirstWeekPage, FirstWeekTracker } from './hud/FirstWeek';
import type { FirstWeekSnapshot } from '../gameplay/captain';
import { JailScreen } from './jail/JailScreen';
import type { JailActions, JailSnapshot } from './jail/model';
import { EndScreen } from './end/EndScreen';
import type { LastRun } from '../sim/run/run-end';
import { MostWantedPage } from './news/MostWantedPage';
import type { MostWantedPage as FrontPageModel } from '../sim/news/papers';
import './theme.css';

/** Sail on or hold the ship, over the journal or a look at the chart. */
const SAIL_ON_KEY = 'KeyP';

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
  chart?: Omit<ChartHudActions, 'toggleSailOn'> | undefined;
  /** "Take to the chart" at the soft edge. */
  onTakeToChart?: (() => void) | undefined;
  /** The HUD's "Wait" while anchored or alongside: opens the lie-at-anchor choice. */
  onWait?: (() => void) | undefined;
  /** Put the First Week tracker away or bring it back (Phase 4 piece C). */
  setFirstWeekHidden?: ((hidden: boolean) => void) | undefined;
  /** The port screen's buttons and the journal's (Phase 4 piece B). */
  port?: (PortActions & { closeJournal(): void; openDocked(): void }) | undefined;
  /** Alongside the island smuggler (Phase 4 piece H). */
  smuggler?: SmugglerActions | undefined;
  /** The stash screen's buttons and the lie-at-anchor choice (Phase 4 piece E). */
  stash?: StashActions | undefined;
  /** The game's sound volumes, when it has Web Audio. */
  audio?: AudioVolumes | undefined;
  /** The jail screens' buttons (Phase 5 piece D). */
  jail?: JailActions | undefined;
  /** "Abandon run" on the pause menu, confirmed (plan 16 §3). */
  onAbandon?: (() => void) | undefined;
  /** From the end screen to the main menu. */
  onEndMenu?: (() => void) | undefined;
  /** The tier-5 front page was put down (piece F). */
  onFrontPageClosed?: (() => void) | undefined;
}

export interface GameUi {
  setHud(snapshot: HudSnapshot | undefined): void;
  /** The chart HUD; undefined hides it. */
  setChart(snapshot: ChartHudSnapshot | undefined): void;
  setSpyglass(on: boolean): void;
  /** Captions for directional sounds (plan 15 §5), newest first. */
  setCaptions(captions: readonly CaptionView[]): void;
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
  /**
   * Whether the ship sails on behind the open journal (true) or is held (false);
   * undefined where the choice isn't offered, as in an arena.
   */
  setJournalSailing(on: boolean | undefined): void;
  /** The island smuggler's screen; undefined closes it. */
  setSmuggler(snapshot: SmugglerSnapshot | undefined): void;
  /** The stash screen; undefined closes it (Phase 4 piece E). */
  setStash(snapshot: StashSnapshot | undefined): void;
  /** The lie-at-anchor choice: true opens it, false closes it; `docked` titles it alongside. */
  setLie(open: boolean, docked?: boolean): void;
  /** The First Week checklist (Phase 4 piece C); undefined for a run without one. */
  setFirstWeek(snapshot: FirstWeekSnapshot | undefined): void;
  /** The jail, bail and release screens (piece D); undefined closes them. */
  setJail(snapshot: JailSnapshot | undefined): void;
  /** The run is over: the front page and summary over everything. */
  setEnd(run: LastRun | undefined): void;
  /** The tier-5 full-screen front page (Phase 5 piece F); undefined puts it away. */
  setFrontPage(page: FrontPageModel | undefined): void;
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
  onWait,
  port: portActions,
  smuggler: smugglerActions,
  stash: stashActions,
  setFirstWeekHidden = () => undefined,
  jail: jailActions,
  onAbandon,
  onEndMenu = () => window.location.assign(window.location.pathname),
  onFrontPageClosed = () => undefined,
}: GameUiOptions): GameUi {
  const frontPage = signal<FrontPageModel | undefined>(undefined);
  const closeFrontPage = (): void => {
    if (!frontPage.value) return;
    frontPage.value = undefined;
    onFrontPageClosed();
  };
  const jail = signal<JailSnapshot | undefined>(undefined);
  const ended = signal<LastRun | undefined>(undefined);
  const smuggler = signal<SmugglerSnapshot | undefined>(undefined);
  const stash = signal<StashSnapshot | undefined>(undefined);
  const lie = signal(false);
  const lieDocked = signal(false);
  const firstWeek = signal<FirstWeekSnapshot | undefined>(undefined);
  const port = signal<PortSnapshot | undefined>(undefined);
  const portTab = signal<PortTab>('market');
  const journal = signal<LedgerSnapshot | undefined>(undefined);
  const journalSailing = signal<boolean | undefined>(undefined);
  const hud = signal<HudSnapshot | undefined>(undefined);
  const chart = signal<ChartHudSnapshot | undefined>(undefined);
  const spyglass = signal(false);
  const captions = signal<readonly CaptionView[]>([]);
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

  // P over the journal or a look at the chart: sail on behind it, or hold the ship. One
  // setting covers both, so the choice sticks between passages.
  const toggleSailOn = (): void =>
    settings.update((s) => (s.sailing.sailOnWhileReading = !s.sailing.sailOnWhileReading));
  const sailOnOffered = (): boolean =>
    (!!journal.value && journalSailing.value !== undefined) ||
    (!journal.value && !port.value && chart.value?.sailingOn !== undefined);

  // Esc closes the menu (plan 13 §6); opening is the sailing Pause action, in main.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    // No Esc out of the lockup or the end of the run.
    if (jail.value || ended.value) {
      e.preventDefault();
      return;
    }
    if (frontPage.value) {
      e.preventDefault();
      closeFrontPage();
    } else if (menuOpen.value) {
      e.preventDefault();
      setMenu(false);
    } else if (smuggler.value) {
      e.preventDefault();
      smugglerActions?.close();
    } else if (stash.value || lie.value) {
      e.preventDefault();
      stashActions?.close();
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
    if (menuOpen.value || frontPage.value || e.repeat) return;
    const keys = bindings.value.sailing;
    const is = (action: Action): boolean => (keys[action] ?? []).includes(e.code);
    if (smuggler.value && is('Interact')) {
      e.preventDefault();
      smugglerActions?.close();
    } else if (stash.value && is('Interact')) {
      e.preventDefault();
      stashActions?.castOff();
    } else if (port.value && is('Interact')) {
      e.preventDefault();
      portActions?.castOff();
    } else if (port.value && is('Journal')) {
      e.preventDefault();
      portTab.value = 'ledger';
    } else if (journal.value && is('Journal')) {
      e.preventDefault();
      portActions?.closeJournal();
    } else if (e.code === SAIL_ON_KEY && sailOnOffered()) {
      e.preventDefault();
      toggleSailOn();
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
          onWait={onWait}
        />
        {!menuOpen.value && !port.value && !journal.value && <Captions captions={captions} />}
        {!menuOpen.value && <ShipCardView card={shipCard} />}
        {chartActions && <ChartHud chart={chart} actions={{ ...chartActions, toggleSailOn }} />}
        {port.value && portActions && !menuOpen.value && (
          <PortScreen
            port={port.value}
            actions={portActions}
            tab={portTab.value}
            setTab={(t) => (portTab.value = t)}
          />
        )}
        {smuggler.value && smugglerActions && !menuOpen.value && (
          <SmugglerScreen smuggler={smuggler.value} actions={smugglerActions} />
        )}
        {stash.value && stashActions && !menuOpen.value && (
          <StashScreen stash={stash.value} actions={stashActions} />
        )}
        {lie.value && stashActions && !menuOpen.value && (
          <LieDialog actions={stashActions} docked={lieDocked.value} />
        )}
        {journal.value && portActions && !menuOpen.value && (
          <Journal
            ledger={journal.value}
            close={portActions.closeJournal}
            sailingOn={journalSailing.value}
            toggleSailOn={toggleSailOn}
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
          !smuggler.value &&
          !stash.value &&
          !lie.value &&
          !chart.value && (
            <FirstWeekTracker week={firstWeek.value} setHidden={setFirstWeekHidden} />
          )}
        {!menuOpen.value &&
          !port.value &&
          !journal.value &&
          !smuggler.value &&
          !stash.value &&
          !jail.value &&
          !ended.value &&
          !lie.value && (
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
            onAbandon={
              onAbandon &&
              (() => {
                setMenu(false);
                onAbandon();
              })
            }
          />
        )}
        {jail.value && jailActions && !menuOpen.value && (
          <JailScreen jail={jail.value} actions={jailActions} />
        )}
        {frontPage.value && !ended.value && (
          <MostWantedPage page={frontPage.value} close={closeFrontPage} />
        )}
        <LoadingScreen screen={loading} />
        {ended.value && <EndScreen run={ended.value} onMenu={onEndMenu} />}
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
    setCaptions(next) {
      // Most HUD samples change nothing; skip the re-render then.
      const same =
        next.length === captions.value.length &&
        next.every((c, i) => {
          const o = captions.value[i];
          return (
            o &&
            o.key === c.key &&
            o.text === c.text &&
            o.arrow === c.arrow &&
            o.distance === c.distance
          );
        });
      if (!same) captions.value = next;
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
    setStash(snapshot) {
      stash.value = snapshot;
    },
    setLie(open, docked) {
      lie.value = open;
      lieDocked.value = !!docked;
    },
    setJournal(snapshot) {
      journal.value = snapshot;
    },
    setJournalSailing(on) {
      journalSailing.value = on;
    },
    setSmuggler(snapshot) {
      smuggler.value = snapshot;
    },
    setFirstWeek(snapshot) {
      firstWeek.value = snapshot;
    },
    setPortTab(tab) {
      portTab.value = tab;
    },
    setFrontPage(page) {
      frontPage.value = page;
    },
    setJail(snapshot) {
      jail.value = snapshot;
    },
    setEnd(run) {
      ended.value = run;
      if (run) setMenu(false);
    },
    get menuOpen() {
      return menuOpen.value;
    },
    openMenu: () => setMenu(true),
    closeMenu: () => setMenu(false),
  };
}
