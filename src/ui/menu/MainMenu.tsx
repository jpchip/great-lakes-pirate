import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { allPortraits, portraitDef, type BackgroundKey } from '../../sim/character/backgrounds';
import { checkSetup, NAME_MAX, type NewRunSetup } from '../../sim/character/new-run';
import { SettingsMenu } from '../settings/SettingsMenu';
import type { SettingsControls } from '../settings/controls';
import { backgroundCards, randomSeed, type SavedRunSummary } from './model';
import { Portrait } from './Portrait';

/**
 * The main menu and character creation (plan 13 §5, plan 12 §2; Phase 4 piece C). The
 * menu comes up before the game boots into a run: Continue (the one run, plan 16), New
 * run, and Settings. New run is character creation: the captain's name, a portrait,
 * a background, the schooner's name and the run seed. Starting a new run over a saved
 * one asks first, since there is only ever one run.
 */

export type MenuChoice = { kind: 'continue' } | { kind: 'new'; setup: NewRunSetup };

export interface MainMenuProps {
  saved: SavedRunSummary | undefined;
  /** Why the saved run can't be continued, if it can't. */
  savedProblem: string | undefined;
  settings: SettingsControls;
  choose(choice: MenuChoice): void;
  /** Character creation opened or closed (the mode machine follows). */
  onCreating?(creating: boolean): void;
}

type Screen = 'title' | 'create' | 'settings' | 'replace';

/** The renderer isn't up yet, so a preset change never waits for a reload here. */
const NO_RELOAD_NOTE = signal(false);

const CAPTAIN_NAMES = [
  'Ole Haugen',
  'Martin Kelleher',
  'Ida Bergquist',
  'Joseph Trudeau',
  'Anna Lindqvist',
  'Thomas Garrity',
  'Nils Ekdahl',
  'Margaret Doyle',
];
const SHIP_NAMES = ['Lizzie Bell', 'Ida May', 'Northern Belle', 'Maggie Ross', 'Hope', 'Kittiwake'];

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;

function Title({
  saved,
  savedProblem,
  go,
  resume,
}: {
  saved: SavedRunSummary | undefined;
  savedProblem: string | undefined;
  go(screen: Screen): void;
  resume(): void;
}) {
  return (
    <div class="title-card" data-testid="main-menu">
      <div class="title-kicker">Lake Superior, 1900</div>
      <h1 class="title-name">Great Lakes Pirate</h1>
      <div class="loading-rule" />
      {saved && (
        <div class="title-saved" data-testid="saved-run">
          <Portrait portrait={portraitDef(saved.portrait)} size={52} />
          <div>
            <div class="title-saved-name">
              Captain {saved.captain} of the <i>{saved.shipName}</i>
            </div>
            <div class="title-saved-meta">
              {saved.background} · {saved.where} · {saved.when} · {saved.purse}
            </div>
          </div>
        </div>
      )}
      {savedProblem && <p class="menu-note">{savedProblem}</p>}
      <nav class="title-buttons">
        {saved && (
          <button
            type="button"
            class="menu-button primary"
            data-testid="menu-continue"
            onClick={resume}
          >
            Continue
          </button>
        )}
        <button
          type="button"
          class={`menu-button${saved ? '' : ' primary'}`}
          data-testid="menu-new-run"
          onClick={() => go(saved ? 'replace' : 'create')}
        >
          New run
        </button>
        <button
          type="button"
          class="menu-button"
          data-testid="menu-settings"
          onClick={() => go('settings')}
        >
          Settings
        </button>
      </nav>
    </div>
  );
}

function Replace({ saved, go }: { saved: SavedRunSummary; go(screen: Screen): void }) {
  return (
    <div class="title-card" data-testid="menu-replace">
      <h2>Give up the {saved.shipName}?</h2>
      <p>
        There is only ever one run. A new captain ends Captain {saved.captain}'s for good: the ship,
        the purse and everything stashed go with it.
      </p>
      <nav class="title-buttons">
        <button type="button" class="menu-button" onClick={() => go('title')}>
          Keep sailing
        </button>
        <button
          type="button"
          class="menu-button danger"
          data-testid="menu-replace-confirm"
          onClick={() => go('create')}
        >
          Start a new captain
        </button>
      </nav>
    </div>
  );
}

function Create({ back, start }: { back(): void; start(setup: NewRunSetup): void }) {
  const cards = backgroundCards();
  const [name, setName] = useState(() => pick(CAPTAIN_NAMES));
  const [shipName, setShipName] = useState(() => pick(SHIP_NAMES));
  const [background, setBackground] = useState<BackgroundKey>('deckhand');
  const [portrait, setPortrait] = useState(() => allPortraits()[0]?.id ?? '');
  const [seed, setSeed] = useState(() => randomSeed());
  const [tried, setTried] = useState(false);
  const checked = checkSetup({ name, shipName, background, portrait, seed });
  const bad = (field: string): boolean => tried && checked.problems.includes(field as never);
  const chosen = cards.find((c) => c.key === background);
  const submit = (e: Event): void => {
    e.preventDefault();
    setTried(true);
    if (checked.problems.length === 0) start(checked.setup);
  };
  const text = (set: (v: string) => void) => (e: Event) =>
    set((e.currentTarget as HTMLInputElement).value);

  return (
    <form class="menu create" data-testid="character-creation" onSubmit={submit}>
      <header class="menu-header">
        <h2>A new captain</h2>
        <span class="menu-paused">May 7, 1900</span>
      </header>
      <div class="create-top">
        <div class="create-portrait">
          <Portrait portrait={portraitDef(portrait)} size={112} />
        </div>
        <div class="create-names">
          <label class={`menu-row${bad('name') ? ' bad' : ''}`}>
            <span>Captain's name</span>
            <input
              data-testid="create-name"
              value={name}
              maxLength={NAME_MAX}
              onInput={text(setName)}
            />
          </label>
          <label class={`menu-row${bad('shipName') ? ' bad' : ''}`}>
            <span>Your schooner</span>
            <input
              data-testid="create-ship"
              value={shipName}
              maxLength={NAME_MAX}
              onInput={text(setShipName)}
            />
          </label>
          <label class={`menu-row${bad('seed') ? ' bad' : ''}`}>
            <span>Run seed</span>
            <span class="create-seed">
              <input
                data-testid="create-seed"
                value={seed}
                maxLength={64}
                onInput={text(setSeed)}
              />
              <button
                type="button"
                class="port-mini"
                title="A new seed"
                onClick={() => setSeed(randomSeed())}
              >
                New
              </button>
            </span>
          </label>
          {tried && checked.problems.length > 0 && (
            <p class="menu-note bad" data-testid="create-problem">
              Every captain needs a name, a schooner with a name and a seed.
            </p>
          )}
        </div>
      </div>

      <h3 class="create-heading">Likeness</h3>
      <div class="create-portraits" role="radiogroup" aria-label="Likeness">
        {allPortraits().map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={p.id === portrait}
            class={`create-portrait-pick${p.id === portrait ? ' chosen' : ''}`}
            data-testid={`portrait-${p.id.slice('portrait.'.length)}`}
            title={p.name}
            onClick={() => setPortrait(p.id)}
          >
            <Portrait portrait={p} size={44} />
          </button>
        ))}
      </div>

      <h3 class="create-heading">Background</h3>
      <div class="create-backgrounds" role="radiogroup" aria-label="Background">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={c.key === background}
            class={`create-background${c.key === background ? ' chosen' : ''}`}
            data-testid={`background-${c.key}`}
            onClick={() => setBackground(c.key)}
          >
            <span class="create-background-name">{c.name}</span>
            <span class="create-background-port">
              {c.port}
              {c.harderStart && <span class="create-harder"> · harder start</span>}
            </span>
          </button>
        ))}
      </div>
      {chosen && (
        <div class="create-detail" data-testid="background-detail">
          <p class="create-blurb">{chosen.blurb}</p>
          <dl class="create-facts">
            <dt>Starts with</dt>
            <dd>
              {chosen.purse} and {chosen.cargo}
            </dd>
            <dt>Starting port</dt>
            <dd>
              {chosen.port}
              {chosen.harderStart && ' (busier and better policed: a harder start)'}
            </dd>
            <dt>Hideout</dt>
            <dd>The stash at {chosen.hideout}</dd>
          </dl>
          <ul class="create-perks">
            {chosen.perks.map((p) => (
              <li key={p.name}>
                <b>{p.name}.</b> {p.text}
                {p.later && <span class="port-dim"> ({p.later})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer class="menu-footer create-footer">
        <button type="button" class="menu-button" onClick={back}>
          Back
        </button>
        <button type="submit" class="menu-button primary" data-testid="create-start">
          Set out from {chosen?.port ?? 'port'}
        </button>
      </footer>
    </form>
  );
}

export function MainMenu({ saved, savedProblem, settings, choose, onCreating }: MainMenuProps) {
  const [screen, setScreenState] = useState<Screen>('title');
  // The screen as of the last change, read by the Esc listener, which is added once: a
  // listener re-added after each render would miss an Esc pressed before the effect ran.
  const current = useRef<Screen>('title');
  const setScreen = (next: Screen): void => {
    if ((next === 'create') !== (current.current === 'create')) onCreating?.(next === 'create');
    current.current = next;
    setScreenState(next);
  };
  // Esc steps back to the title (plan 13 §6).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape' || current.current === 'title') return;
      e.preventDefault();
      setScreen('title');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="front" data-testid="front-menu" data-screen={screen}>
      <div class="front-sky" />
      <div class="front-body">
        {screen === 'title' && (
          <Title
            saved={saved}
            savedProblem={savedProblem}
            go={setScreen}
            resume={() => choose({ kind: 'continue' })}
          />
        )}
        {screen === 'replace' && saved && <Replace saved={saved} go={setScreen} />}
        {screen === 'create' && (
          <Create
            back={() => setScreen('title')}
            start={(setup) => choose({ kind: 'new', setup })}
          />
        )}
        {screen === 'settings' && (
          <SettingsMenu
            settings={settings.current}
            bindings={settings.bindings}
            update={settings.update}
            rebind={settings.rebind}
            resetBindings={settings.resetBindings}
            close={() => setScreen('title')}
            reloadNote={NO_RELOAD_NOTE}
            audio={settings.audio}
            fromMainMenu
          />
        )}
      </div>
    </div>
  );
}
