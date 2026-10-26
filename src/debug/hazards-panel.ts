import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { SailShipRecord } from '../../data/schemas/ships';
import type { EventBus } from '../core/events';
import type { ShipHazards } from '../gameplay/hazards';
import type { GameEvents } from '../modes/context';
import type { HazardRules } from '../sim/sailing/hazard-rules';
import { compileHazardClass, repairAll } from '../sim/sailing/hazards';

/**
 * The hazards folder of the dev overlay (plan 02 §14.6–8): live hull, rigging, strain,
 * depth, anchor and berth, the last hazard event, a repair button, and every hazard
 * rule. Edits rebuild the ship's hazard class straight away.
 */
export interface HazardsPanelOptions {
  gui: GUI;
  hazards: ShipHazards;
  record: SailShipRecord;
  rules: HazardRules;
  events: EventBus<GameEvents>;
}

const HAZARD_EVENTS = new Set<keyof GameEvents>([
  'ShipGrounded',
  'ShipRefloated',
  'ShipStruck',
  'ShipKnockedDown',
  'ShipFoundering',
  'ShipJibed',
  'AnchorDropped',
  'AnchorWeighed',
  'AnchorDragging',
  'AnchorRefused',
  'ShipDocked',
  'ShipCastOff',
  'DockRefused',
]);

export function createHazardsPanel(options: HazardsPanelOptions): { update(): void } {
  const { hazards } = options;
  const root = options.gui.addFolder('Hazards');
  let rules: HazardRules = structuredClone(options.rules);
  const rebuild = (): void => {
    hazards.cls = compileHazardClass(options.record, rules);
  };

  const read = { hull: '', rigging: '', strain: '', depth: '', anchor: '', berth: '', last: '' };
  const readFolder = root.addFolder('Readout');
  for (const key of Object.keys(read) as (keyof typeof read)[]) {
    readFolder.add(read, key).disable().listen();
  }

  options.events.tap((type, payload) => {
    if (!HAZARD_EVENTS.has(type)) return;
    const fields = Object.entries(payload as Record<string, unknown>)
      .filter(([k]) => k !== 'shipId')
      .map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(1) : String(v)}`);
    read.last = [type, ...fields].join('  ');
  });

  root.add({ repair: () => repairAll(hazards.state, hazards.cls) }, 'repair').name('Repair all');

  let tuning: GUI | undefined;
  const buildTuning = (): void => {
    tuning?.destroy();
    tuning = root.addFolder('Rules').close();
    const nums = rules as unknown as Record<string, number | number[]>;
    for (const [key, value] of Object.entries(nums)) {
      if (Array.isArray(value)) {
        const sub = tuning.addFolder(key).close();
        const row = value as unknown as Record<string, number>;
        value.forEach((v, i) => sub.add(row, String(i), 0, Math.max(1, v * 3)).onChange(rebuild));
      } else {
        const obj = nums as Record<string, number>;
        tuning.add(obj, key, 0, Math.max(1, Math.abs(value) * 3)).onChange(rebuild);
      }
    }
  };
  root
    .add(
      {
        copy: () => void navigator.clipboard.writeText(JSON.stringify(rules, null, 2)),
      },
      'copy',
    )
    .name('Copy rules JSON');
  root
    .add(
      {
        reset: () => {
          rules = structuredClone(options.rules);
          rebuild();
          buildTuning();
        },
      },
      'reset',
    )
    .name('Reset rules');
  buildTuning();

  return {
    update() {
      const h = hazards.state;
      const c = hazards.cls;
      read.hull = `${h.hull.toFixed(0)} / ${c.hullHP}${h.foundering ? '  FOUNDERING' : ''}`;
      read.rigging = `${h.rigging.toFixed(0)} / ${c.riggingHP}`;
      read.strain = `${h.strain.toFixed(2)} (heading for ${h.overpress.toFixed(2)})${h.knockdown > 0 ? '  KNOCKDOWN' : ''}`;
      const depth = Number.isFinite(h.depth) ? `${h.depth.toFixed(1)} m` : 'open water';
      read.depth = `${depth}  draft ${h.draft.toFixed(2)} m${h.shallow ? '  SHALLOW' : ''}${h.aground ? '  AGROUND' : ''}${h.kedging ? ' (kedging)' : ''}`;
      read.anchor =
        h.anchor === 'up'
          ? 'up'
          : `${h.anchor}  holds ${h.holdingKn.toFixed(0)} kn, load ${h.anchorLoadKn.toFixed(0)} kn${h.dragging ? '  DRAGGING' : ''}`;
      read.berth = h.mooring === 'free' ? '—' : `${h.mooring} ${h.berthId ?? ''}`;
    },
  };
}
