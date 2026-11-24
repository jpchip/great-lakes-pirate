import { useLayoutEffect, useState } from 'preact/hooks';
import type { ReadonlySignal } from '@preact/signals';
import {
  codeLabel,
  DEFAULT_BINDINGS,
  REBINDABLE,
  RESERVED_CODES,
  type Action,
  type Bindings,
  type InputContext,
} from '../../core/input';
import type { AudioSettings, VolumeId } from '../../audio/settings';
import {
  COLOR_MODES,
  HUD_DENSITIES,
  LOOKOUT_PREFS,
  RESOLUTION_SCALES,
  UI_SCALES,
  type ColorMode,
  type HudDensity,
  type Settings,
} from '../../core/settings';
import type { LookoutPref } from '../../sim/chart/traffic';
import { LOOKOUT_LABELS } from '../chart/model';

/**
 * The settings screen (plan 13 §12 Phase 1): graphics preset, resolution scale and HUD
 * density; camera and sailing options; sound volumes (plan 15 §7, Phase 2 piece H); key
 * rebinding at the helm, on foot and on the chart, with hold or toggle; and accessibility
 * (plan 13 §9: interface size, plain font, colour-blind palettes, reduce motion, gentle
 * lightning, brightness). It opens
 * over the game with Esc, which pauses the tick, and every change applies and saves at
 * once (core/settings).
 */

/** The sound volumes, kept apart from the other settings (audio/settings). */
export interface AudioControls {
  settings: ReadonlySignal<AudioSettings>;
  setVolume(id: VolumeId, volume: number): void;
  setMuted(muted: boolean): void;
}

export interface SettingsMenuProps {
  settings: ReadonlySignal<Settings>;
  bindings: ReadonlySignal<Bindings>;
  update(change: (draft: Settings) => void): void;
  rebind(context: InputContext, action: Action, code: string): void;
  resetBindings(): void;
  close(): void;
  /** Shown under the preset picker when antialiasing waits for a reload. */
  reloadNote: ReadonlySignal<boolean>;
  /** Undefined when the browser has no Web Audio. */
  audio?: AudioControls | undefined;
  /** Opened from the main menu, before a run: no game to pause or go back to. */
  fromMainMenu?: boolean;
  /** Ends the run for good, after a confirm (plan 16 §3 "Abandon run"). */
  onAbandon?: (() => void) | undefined;
  /**
   * Downloads the run as a file (plan 16 §9 "Export run"). Resolves to what to tell the
   * player: where it went, or why it can't be done now (never in danger, §4.2).
   */
  onExport?: (() => Promise<string>) | undefined;
}

/** Export run: saves and downloads the run, then says how it went. */
function ExportRun({ exportRun }: { exportRun(): Promise<string> }) {
  const [note, setNote] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  return (
    <span class="export-run">
      <button
        type="button"
        class="menu-button"
        data-testid="settings-export"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void exportRun()
            .then(setNote)
            .catch((err: unknown) => setNote(`The run couldn't be exported: ${String(err)}`))
            .finally(() => setBusy(false));
        }}
      >
        Export run
      </button>
      {note && (
        <span class="menu-note" data-testid="settings-export-note" role="status">
          {note}
        </span>
      )}
    </span>
  );
}

/** Abandon the run: one press asks, a second ends it (plan 13 §6: confirm the irreversible). */
function Abandon({ abandon }: { abandon(): void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        class="menu-button abandon"
        data-testid="settings-abandon"
        onClick={() => setAsking(true)}
      >
        Abandon run
      </button>
    );
  }
  return (
    <span class="abandon-confirm">
      <span>End this captain's run for good?</span>
      <button type="button" class="menu-button" onClick={() => setAsking(false)}>
        Keep sailing
      </button>
      <button
        type="button"
        class="menu-button danger"
        data-testid="settings-abandon-confirm"
        onClick={abandon}
      >
        Abandon
      </button>
    </span>
  );
}

const ACTION_LABELS: Partial<Record<Action, string>> = {
  SteerPort: 'Rudder to port',
  SteerStarboard: 'Rudder to starboard',
  RaiseSail: 'Raise sail',
  LowerSail: 'Lower sail',
  TrimIn: 'Trim sheets in',
  TrimOut: 'Ease sheets out',
  Anchor: 'Anchor',
  Sweeps: 'Sweeps out / in',
  Lantern: 'Lantern',
  Spyglass: 'Spyglass',
  Interact: 'Interact',
  Hail: 'Hail a ship',
  ToggleChart: 'Chart',
  Port: 'Port screen (docked)',
  Journal: 'Journal',
  LieAtAnchor: 'Lie at anchor',
  Repair: 'Use a repair kit',
  GoAshore: 'Go ashore',
  AimMode: 'Aim the guns',
  Fire: 'Fire (aiming)',
  AimSwivel: 'Bow swivel',
  AimBroadside: 'Broadside',
  AimRifle: 'Rifle',
  CycleAmmo: 'Change shot',
  MoveForward: 'Walk forward',
  MoveBack: 'Walk back',
  MoveLeft: 'Step left',
  MoveRight: 'Step right',
  Sprint: 'Run',
  Crouch: 'Crouch',
  Jump: 'Jump',
  LeanLeft: 'Lean left',
  LeanRight: 'Lean right',
  Build: 'Build (at a hideout)',
  Tool1: 'Tool 1',
  Tool2: 'Tool 2',
  Tool3: 'Tool 3',
  Tool4: 'Tool 4',
  Tool5: 'Tool 5',
  Tool6: 'Tool 6',
  Tool7: 'Tool 7',
  Tool8: 'Tool 8',
  Tool9: 'Tool 9',
  Confirm: 'Set sail on the course',
  Cancel: 'Take off the last waypoint',
};

/** The Controls tab's groups of keys, by where they act. */
const KEY_GROUPS: [InputContext, string][] = [
  ['sailing', 'At the helm'],
  ['onFoot', 'On foot'],
  ['chart', 'On the chart'],
];

const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  off: 'Off',
  redGreen: 'Red-green (protanopia, deuteranopia)',
  blueYellow: 'Blue-yellow (tritanopia)',
};

const HUD_LABELS: Record<HudDensity, string> = {
  minimal: 'Minimal',
  full: 'Full',
  off: 'Off',
};

type Tab = 'graphics' | 'camera' | 'sound' | 'controls' | 'access';

/** The sliders, in order. Voice joins when shouts exist. */
const VOLUMES: [VolumeId, string][] = [
  ['master', 'Master'],
  ['music', 'Music'],
  ['ambience', 'Weather, wildlife & harbors'],
  ['sfx', 'Ship & signals'],
  ['ui', 'Interface'],
];

function Toggle(props: { label: string; checked: boolean; onChange(on: boolean): void }) {
  return (
    <label class="menu-row">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange((e.currentTarget as HTMLInputElement).checked)}
      />
    </label>
  );
}

function Graphics({ settings, update, reloadNote }: SettingsMenuProps) {
  const g = settings.value.graphics;
  const resolutionValue = g.resolution === 'auto' ? 'auto' : String(g.resolution);
  return (
    <div class="menu-section">
      <label class="menu-row">
        <span>Quality preset</span>
        <select
          data-testid="setting-quality"
          value={g.quality}
          onChange={(e) => {
            const id = (e.currentTarget as HTMLSelectElement)
              .value as Settings['graphics']['quality'];
            update((s) => (s.graphics.quality = id));
          }}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      {reloadNote.value && (
        <p class="menu-note">Antialiasing changes the next time the game loads.</p>
      )}
      <label class="menu-row">
        <span>Resolution scale</span>
        <select
          data-testid="setting-resolution"
          value={resolutionValue}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            update((s) => (s.graphics.resolution = v === 'auto' ? 'auto' : Number(v)));
          }}
        >
          <option value="auto">Auto (keeps the frame rate)</option>
          {RESOLUTION_SCALES.map((scale) => (
            <option key={scale} value={String(scale)}>
              {Math.round(scale * 100)}%
            </option>
          ))}
        </select>
      </label>
      <label class="menu-row">
        <span>HUD</span>
        <select
          data-testid="setting-hud"
          value={settings.value.ui.hudDensity}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value as HudDensity;
            update((s) => (s.ui.hudDensity = v));
          }}
        >
          {HUD_DENSITIES.map((d) => (
            <option key={d} value={d}>
              {HUD_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Camera({ settings, update }: SettingsMenuProps) {
  const c = settings.value.camera;
  return (
    <div class="menu-section">
      <Toggle
        label="Camera swings back behind the ship"
        checked={c.autoRecenter}
        onChange={(on) => update((s) => (s.camera.autoRecenter = on))}
      />
      <Toggle
        label="Camera rolls with the ship"
        checked={c.rollWithShip}
        onChange={(on) => update((s) => (s.camera.rollWithShip = on))}
      />
      <Toggle
        label="Spyglass toggles instead of hold"
        checked={c.spyglassToggle}
        onChange={(on) => update((s) => (s.camera.spyglassToggle = on))}
      />
      <label class="menu-row">
        <span>Camera speed</span>
        <input
          type="range"
          min="0.25"
          max="3"
          step="0.05"
          value={c.sensitivity}
          onInput={(e) => {
            const v = Number((e.currentTarget as HTMLInputElement).value);
            update((s) => (s.camera.sensitivity = v));
          }}
        />
      </label>
      <Toggle
        label="Manual sail trim (Q / E)"
        checked={settings.value.sailing.manualTrim}
        onChange={(on) => update((s) => (s.sailing.manualTrim = on))}
      />
      <Toggle
        label="Keep sailing with the journal or chart open (P)"
        checked={settings.value.sailing.sailOnWhileReading}
        onChange={(on) => update((s) => (s.sailing.sailOnWhileReading = on))}
      />
      <label class="menu-row">
        <span>Lookouts report on the chart</span>
        <select
          data-testid="setting-lookout"
          value={settings.value.chart.lookout}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value as LookoutPref;
            update((s) => (s.chart.lookout = v));
          }}
        >
          {LOOKOUT_PREFS.map((pref) => (
            <option key={pref} value={pref}>
              {LOOKOUT_LABELS[pref]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Sound({ audio, settings, update }: SettingsMenuProps) {
  const captions = (
    <Toggle
      label="Captions for sounds (signals, whistles, shouts, guns, animals)"
      checked={settings.value.ui.captions}
      onChange={(on) => update((s) => (s.ui.captions = on))}
    />
  );
  if (!audio) {
    return (
      <div class="menu-section">
        <p class="menu-note">This browser has no Web Audio, so the game runs silent.</p>
      </div>
    );
  }
  const a = audio.settings.value;
  return (
    <div class="menu-section">
      {VOLUMES.map(([id, label]) => (
        <label class="menu-row menu-volume" key={id}>
          <span>{label}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={a[id]}
            data-testid={`volume-${id}`}
            aria-label={`${label} volume`}
            onInput={(e) =>
              audio.setVolume(id, Number((e.currentTarget as HTMLInputElement).value))
            }
          />
          <span class="menu-value">{Math.round(a[id] * 100)}%</span>
        </label>
      ))}
      <Toggle label="Mute all sound" checked={a.muted} onChange={(on) => audio.setMuted(on)} />
      {captions}
    </div>
  );
}

function Controls({ bindings, rebind, resetBindings, settings, update }: SettingsMenuProps) {
  const [listening, setListening] = useState<[InputContext, Action] | undefined>(undefined);

  // A layout effect, so the keys are listened for before "Press a key…" shows.
  useLayoutEffect(() => {
    if (!listening) return undefined;
    const [context, action] = listening;
    // Capture before anything else sees it, so Esc cancels here and doesn't close the menu.
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!RESERVED_CODES.includes(e.code)) rebind(context, action, e.code);
      setListening(undefined);
    };
    const onMouse = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      rebind(context, action, `Mouse${e.button}`);
      setListening(undefined);
    };
    const onContext = (e: Event): void => e.preventDefault();
    window.addEventListener('keydown', onKey, true);
    // The click that started listening has already landed; the next press binds.
    const t = window.setTimeout(() => window.addEventListener('mousedown', onMouse, true), 0);
    window.addEventListener('contextmenu', onContext, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('contextmenu', onContext, true);
    };
  }, [listening, rebind]);

  const a = settings.value.access;
  return (
    <div class="menu-section">
      <p class="menu-note">Click a key, then press the new key or mouse button. Esc cancels.</p>
      <Toggle
        label="Crouch toggles instead of hold"
        checked={a.crouchToggle}
        onChange={(on) => update((s) => (s.access.crouchToggle = on))}
      />
      <Toggle
        label="Run toggles instead of hold"
        checked={a.runToggle}
        onChange={(on) => update((s) => (s.access.runToggle = on))}
      />
      <Toggle
        label="Hold to aim the guns instead of toggling"
        checked={a.holdToAim}
        onChange={(on) => update((s) => (s.access.holdToAim = on))}
      />
      {KEY_GROUPS.map(([context, title]) => {
        const keys = bindings.value[context];
        return (
          <div class="menu-keys" key={context} data-testid={`keys-${context}`}>
            <h3 class="menu-keys-title">{title}</h3>
            {(REBINDABLE[context] ?? []).map((action) => {
              const codes = keys[action] ?? [];
              const was = DEFAULT_BINDINGS[context][action]?.[0] ?? '';
              const changed = (codes[0] ?? '') !== was;
              const on = listening?.[0] === context && listening[1] === action;
              // The helm's keys keep their old test ids (bind-RaiseSail).
              const id = context === 'sailing' ? `bind-${action}` : `bind-${context}-${action}`;
              return (
                <div class="menu-row" key={action}>
                  <span>{ACTION_LABELS[action] ?? action}</span>
                  <button
                    type="button"
                    class={`menu-key${changed ? ' changed' : ''}${on ? ' listening' : ''}`}
                    data-testid={id}
                    onClick={() => setListening([context, action])}
                  >
                    {on
                      ? 'Press a key…'
                      : codes.length
                        ? codes.map(codeLabel).join(' / ')
                        : 'Unbound'}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
      <button type="button" class="menu-button" onClick={resetBindings}>
        Reset keys to defaults
      </button>
    </div>
  );
}

/** Accessibility (plan 13 §9): size, font, colour, motion, flashes and brightness. */
function Access({ settings, update }: SettingsMenuProps) {
  const a = settings.value.access;
  return (
    <div class="menu-section">
      <label class="menu-row">
        <span>Interface size</span>
        <select
          data-testid="setting-ui-scale"
          value={String(a.uiScale)}
          onChange={(e) => {
            const v = Number((e.currentTarget as HTMLSelectElement).value);
            update((s) => (s.access.uiScale = v));
          }}
        >
          {UI_SCALES.map((scale) => (
            <option key={scale} value={String(scale)}>
              {Math.round(scale * 100)}%
            </option>
          ))}
        </select>
      </label>
      <Toggle
        label="Plain font (instead of the period type)"
        checked={a.plainFont}
        onChange={(on) => update((s) => (s.access.plainFont = on))}
      />
      <label class="menu-row">
        <span>Colour-blind palette</span>
        <select
          data-testid="setting-color-mode"
          value={a.colorMode}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value as ColorMode;
            update((s) => (s.access.colorMode = v));
          }}
        >
          {COLOR_MODES.map((m) => (
            <option key={m} value={m}>
              {COLOR_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <Toggle
        label="Reduce motion (level camera, still interface)"
        checked={a.reduceMotion}
        onChange={(on) => update((s) => (s.access.reduceMotion = on))}
      />
      <Toggle
        label="Gentle lightning (soft, dim flashes, far apart)"
        checked={a.gentleFlashes}
        onChange={(on) => update((s) => (s.access.gentleFlashes = on))}
      />
      <label class="menu-row">
        <span>Brightness</span>
        <input
          type="range"
          min="0.6"
          max="1.6"
          step="0.05"
          value={a.brightness}
          data-testid="setting-brightness"
          aria-label="Brightness"
          onInput={(e) => {
            const v = Number((e.currentTarget as HTMLInputElement).value);
            update((s) => (s.access.brightness = v));
          }}
        />
        <span class="menu-value">{Math.round(a.brightness * 100)}%</span>
      </label>
      <p class="menu-note">
        Captions are on the Sound tab, and keys and hold or toggle on the Controls tab.
      </p>
    </div>
  );
}

export function SettingsMenu(props: SettingsMenuProps) {
  const [tab, setTab] = useState<Tab>('graphics');
  const tabs: [Tab, string][] = [
    ['graphics', 'Graphics'],
    ['camera', 'Camera & sailing'],
    ['sound', 'Sound'],
    ['controls', 'Controls'],
    ['access', 'Accessibility'],
  ];
  return (
    <div class="menu-backdrop" data-testid="settings-menu">
      <div class="menu" role="dialog" aria-modal="true" aria-label="Settings">
        <header class="menu-header">
          <h2>Settings</h2>
          {!props.fromMainMenu && <span class="menu-paused">Paused</span>}
        </header>
        <nav class="menu-tabs">
          {tabs.map(([id, label]) => (
            <button
              type="button"
              key={id}
              class={`menu-tab${tab === id ? ' active' : ''}`}
              data-testid={`tab-${id}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {tab === 'graphics' && <Graphics {...props} />}
        {tab === 'camera' && <Camera {...props} />}
        {tab === 'sound' && <Sound {...props} />}
        {tab === 'controls' && <Controls {...props} />}
        {tab === 'access' && <Access {...props} />}
        <footer class="menu-footer">
          {props.onExport && <ExportRun exportRun={props.onExport} />}
          {props.onAbandon && <Abandon abandon={props.onAbandon} />}
          <button
            type="button"
            class="menu-button primary"
            data-testid="settings-close"
            onClick={props.close}
          >
            {props.fromMainMenu ? 'Back (Esc)' : 'Back to the helm (Esc)'}
          </button>
        </footer>
      </div>
    </div>
  );
}
