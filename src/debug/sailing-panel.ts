import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { SailShipRecord } from '../../data/schemas/ships';
import { msToKnots } from '../core/coords';
import type { SailingShip } from '../gameplay/sailing';
import { SAIL_LEVELS, speedKn, type SailingWind } from '../sim/sailing/controller';
import type { HandlingRecord } from '../sim/sailing/handling';
import { parsePreset, serializePreset } from '../sim/sailing/preset';
import { compileSailingClass } from '../sim/sailing/ship-class';

/**
 * The sailing tuning panel (plan 02 §14.8): every number in the ship record and the
 * handling rules, a live readout of the speed model, the dev wind, and tuning presets
 * saved to and loaded from JSON. Edits rebuild the ship's class straight away.
 */
export interface SailingPanelOptions {
  gui: GUI;
  ship: SailingShip;
  /** The ships.json record and handling the game started with, for Reset. */
  record: SailShipRecord;
  handling: HandlingRecord;
  /** The wind the ship sails in until the weather system provides it (piece D). */
  wind: SailingWind;
}

const DEG = 180 / Math.PI;

/** Fields that are labels or links, not tuning. */
const SKIP = new Set(['id', 'name', 'tier', 'propulsion', 'modelId', 'LODs', 'visibilityProfile']);

type Curve = [number, number][];

function isCurve(v: unknown): v is Curve {
  return Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2);
}

function addNumber(
  folder: GUI,
  obj: Record<string, unknown>,
  key: string,
  onChange: () => void,
): void {
  const nums = obj as Record<string, number>;
  const max = Math.max(1, Math.abs(nums[key] ?? 0) * 3);
  folder.add(nums, key, 0, max).onChange(onChange);
}

/** One folder of number inputs over an object's numbers, curves, tuples and sub-objects. */
function addFields(folder: GUI, obj: Record<string, unknown>, onChange: () => void): void {
  for (const [key, value] of Object.entries(obj)) {
    if (SKIP.has(key)) continue;
    if (typeof value === 'number') {
      addNumber(folder, obj, key, onChange);
    } else if (typeof value === 'boolean') {
      folder.add(obj as Record<string, boolean>, key).onChange(onChange);
    } else if (isCurve(value)) {
      const sub = folder.addFolder(`${key} [x, y]`).close();
      value.forEach((point, i) => {
        // Only y is tunable here; x positions are edited in the JSON.
        const row = { [String(point[0])]: point[1] };
        sub.add(row, String(point[0]), 0, Math.max(1, point[1] * 3)).onChange((y: number) => {
          value[i] = [point[0], y];
          onChange();
        });
      });
    } else if (Array.isArray(value)) {
      const sub = folder.addFolder(key).close();
      value.forEach((_, i) =>
        addNumber(sub, value as unknown as Record<string, unknown>, String(i), onChange),
      );
    } else if (value && typeof value === 'object') {
      addFields(folder.addFolder(key).close(), value as Record<string, unknown>, onChange);
    }
  }
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function pickFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) file.text().then(resolve, reject);
    };
    input.click();
  });
}

export function createSailingPanel(options: SailingPanelOptions): { update(): void } {
  const { ship, wind } = options;
  const root = options.gui.addFolder('Sailing');
  let record: SailShipRecord = structuredClone(options.record);
  let handling: HandlingRecord = structuredClone(options.handling);

  const rebuildClass = (): void => {
    try {
      ship.cls = compileSailingClass(record, handling);
    } catch (err) {
      console.warn('Tuning not applied', err);
    }
  };

  // Live readout of the plan 02 §3.1 product.
  const read = {
    speed: '',
    target: '',
    wind: '',
    sails: '',
    factors: '',
    trim: '',
    state: '',
  };
  const readFolder = root.addFolder('Readout');
  for (const key of Object.keys(read) as (keyof typeof read)[]) {
    readFolder.add(read, key).disable().listen();
  }

  const windDeg = { fromDeg: Math.round(wind.fromRad * DEG) };
  const windFolder = root.addFolder('Wind (dev)');
  windFolder
    .add(windDeg, 'fromDeg', 0, 359, 1)
    .name('From (°)')
    .onChange((d: number) => (wind.fromRad = d / DEG));
  windFolder.add(wind, 'speedKn', 0, 50, 0.5).name('Speed (kn)');
  windFolder.add(wind, 'gust01', 0, 1, 0.01).name('Gust');

  const helm = root.addFolder('Helm');
  helm.add(ship.state, 'manualTrim').name('Manual trim (Q/E)');

  let tuning: GUI | undefined;
  const buildTuning = (): void => {
    tuning?.destroy();
    tuning = root.addFolder('Tuning').close();
    addFields(tuning.addFolder(`Ship: ${record.name}`).close(), record, rebuildClass);
    addFields(tuning.addFolder('Handling').close(), handling, rebuildClass);
  };

  const presets = root.addFolder('Presets');
  presets
    .add(
      { save: () => download(`sailing-${record.id}.json`, serializePreset(record, handling)) },
      'save',
    )
    .name('Save JSON');
  presets
    .add(
      {
        load: async () => {
          try {
            const preset = parsePreset(await pickFile());
            record = preset.ship;
            handling = preset.handling;
            rebuildClass();
            buildTuning();
          } catch (err) {
            window.alert(String(err));
          }
        },
      },
      'load',
    )
    .name('Load JSON');
  presets
    .add(
      {
        reset: () => {
          record = structuredClone(options.record);
          handling = structuredClone(options.handling);
          rebuildClass();
          buildTuning();
        },
      },
      'reset',
    )
    .name('Reset to ships.json');

  buildTuning();

  const f = (v: number): string => v.toFixed(2);
  return {
    update() {
      const s = ship.state;
      read.speed = `${speedKn(s).toFixed(1)} kn  heading ${Math.round((s.heading * DEG + 360) % 360)}°`;
      read.target = `${msToKnots(s.targetSpeed).toFixed(1)} kn`;
      read.wind = `${s.windKn.toFixed(1)} kn  ${Math.round(s.windAngle * DEG)}° off the bow`;
      const ordered = SAIL_LEVELS[s.sailLevel] ?? '';
      read.sails = `${ordered}${s.sailSetting !== s.sailLevel ? ` (setting ${f(s.sailSetting)})` : ''}`;
      read.factors = `sail ${f(s.sailFactor)} polar ${f(s.polarFactor)} wind ${f(s.windFactor)} sea ${f(s.seaStateFactor)}`;
      read.trim = `factor ${f(s.trimFactor)}  sheet ${f(s.trim)}  ideal ${f(s.idealTrim)}`;
      read.state = [
        s.stalled ? 'STALLED' : s.inIrons ? 'in irons' : '',
        s.sweepsOut ? 'sweeps' : '',
        `heel ${(s.heel * DEG).toFixed(1)}°`,
      ]
        .filter(Boolean)
        .join('  ');
    },
  };
}
