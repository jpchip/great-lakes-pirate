import { useLayoutEffect, useState } from 'preact/hooks';
import type { ReadonlySignal } from '@preact/signals';
import {
  codeLabel,
  DEFAULT_BINDINGS,
  REBINDABLE,
  RESERVED_CODES,
  type Action,
  type Bindings,
} from '../../core/input';
import type { AudioSettings, VolumeId } from '../../audio/settings';
import {
  HUD_DENSITIES,
  LOOKOUT_PREFS,
  RESOLUTION_SCALES,
  type HudDensity,
  type Settings,
} from '../../core/settings';
import type { LookoutPref } from '../../sim/chart/traffic';
import { LOOKOUT_LABELS } from '../chart/model';

/**
 * The settings screen (plan 13 §12 Phase 1): graphics preset, resolution scale and HUD
 * density; camera and sailing options; sound volumes (plan 15 §7, Phase 2 piece H); and
 * basic key rebinding for sailing. It opens
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
  rebind(action: Action, code: string): void;
  resetBindings(): void;
  close(): void;
  /** Shown under the preset picker when antialiasing waits for a reload. */
  reloadNote: ReadonlySignal<boolean>;
  /** Undefined when the browser has no Web Audio. */
  audio?: AudioControls | undefined;
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
};

const HUD_LABELS: Record<HudDensity, string> = {
  minimal: 'Minimal',
  full: 'Full',
  off: 'Off',
};

type Tab = 'graphics' | 'camera' | 'sound' | 'controls';

/** The sliders, in order. Voice joins when shouts exist. */
const VOLUMES: [VolumeId, string][] = [
  ['master', 'Master'],
  ['music', 'Music'],
  ['ambience', 'Weather & wildlife'],
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

function Sound({ audio }: SettingsMenuProps) {
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
    </div>
  );
}

function Controls({ bindings, rebind, resetBindings }: SettingsMenuProps) {
  const [listening, setListening] = useState<Action | undefined>(undefined);

  // A layout effect, so the keys are listened for before "Press a key…" shows.
  useLayoutEffect(() => {
    if (!listening) return undefined;
    // Capture before anything else sees it, so Esc cancels here and doesn't close the menu.
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!RESERVED_CODES.includes(e.code)) rebind(listening, e.code);
      setListening(undefined);
    };
    const onMouse = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      rebind(listening, `Mouse${e.button}`);
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

  const sailing = bindings.value.sailing;
  return (
    <div class="menu-section">
      <p class="menu-note">Click a key, then press the new key or mouse button. Esc cancels.</p>
      <div class="menu-keys">
        {(REBINDABLE.sailing ?? []).map((action) => {
          const codes = sailing[action] ?? [];
          const changed = (codes[0] ?? '') !== (DEFAULT_BINDINGS.sailing[action]?.[0] ?? '');
          return (
            <div class="menu-row" key={action}>
              <span>{ACTION_LABELS[action] ?? action}</span>
              <button
                type="button"
                class={`menu-key${changed ? ' changed' : ''}${listening === action ? ' listening' : ''}`}
                data-testid={`bind-${action}`}
                onClick={() => setListening(action)}
              >
                {listening === action
                  ? 'Press a key…'
                  : codes.length
                    ? codes.map(codeLabel).join(' / ')
                    : 'Unbound'}
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" class="menu-button" onClick={resetBindings}>
        Reset to defaults
      </button>
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
  ];
  return (
    <div class="menu-backdrop" data-testid="settings-menu">
      <div class="menu" role="dialog" aria-modal="true" aria-label="Settings">
        <header class="menu-header">
          <h2>Settings</h2>
          <span class="menu-paused">Paused</span>
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
        <footer class="menu-footer">
          <button
            type="button"
            class="menu-button primary"
            data-testid="settings-close"
            onClick={props.close}
          >
            Back to the helm (Esc)
          </button>
        </footer>
      </div>
    </div>
  );
}
