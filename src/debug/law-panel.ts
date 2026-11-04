import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { IDENTIFICATIONS, WITNESS_KINDS } from '../../data/schemas/law';
import type { EventBus } from '../core/events';
import { devWitness, type GameLaw } from '../gameplay/law';
import type { GameEvents } from '../modes/context';
import { fameTier, fameTierName, wantedTier, wantedTierName } from '../sim/law/defs';
import type { WorldState } from '../sim/world-state';
import type { Identification, WitnessKind } from '../sim/law/witness';

/**
 * The law folder of the dev overlay (plan 06 §14.4 piece A): heat and tier in every
 * region, Fame, the reports on their way, the last law event; commit a crime with a
 * witness, land or stop reports, and set a region's tier.
 */
export interface LawPanelOptions {
  gui: GUI;
  law: GameLaw;
  state: WorldState;
  events: EventBus<GameEvents>;
}

const LAW_EVENTS = new Set<keyof GameEvents>([
  'CrimeCommitted',
  'Witnessed',
  'ReportFiled',
  'ReportIntercepted',
  'WantedTierChanged',
  'HeatSpread',
  'FameChanged',
  'ProfileChanged',
]);

export function createLawPanel(options: LawPanelOptions): { update(): void } {
  const { law, state } = options;
  const { defs } = law;
  const root = options.gui.addFolder('Law').close();

  const read: Record<string, string> = { here: '', fame: '', reports: '', last: '' };
  for (const r of defs.regions) read[r.id] = '';
  const readFolder = root.addFolder('Readout');
  readFolder.add(read, 'here').disable().listen();
  for (const r of defs.regions) readFolder.add(read, r.id).name(r.name).disable().listen();
  readFolder.add(read, 'fame').disable().listen();
  readFolder.add(read, 'reports').disable().listen();
  readFolder.add(read, 'last').disable().listen();

  options.events.tap((type, payload) => {
    if (!LAW_EVENTS.has(type)) return;
    const fields = Object.entries(payload as Record<string, unknown>)
      .filter(([, v]) => typeof v !== 'object')
      .map(([k, v]) => `${k} ${typeof v === 'number' ? Math.round(v * 10) / 10 : String(v)}`);
    read.last = [type, ...fields].join('  ');
  });

  const crimeIds = [...defs.crimes.keys()];
  const regionIds = defs.regions.map((r) => r.id);
  const form = {
    crime: crimeIds[0] ?? '',
    region: law.region() ?? regionIds[0] ?? '',
    witness: 'keeper' as WitnessKind | 'none',
    identification: 'ship' as Identification,
    tier: 1,
  };
  const commit = root.addFolder('Commit');
  commit.add(form, 'crime', crimeIds);
  commit.add(form, 'region', regionIds).listen();
  commit.add(form, 'witness', ['none', ...WITNESS_KINDS]);
  commit.add(form, 'identification', [...IDENTIFICATIONS]);
  commit
    .add(
      {
        go: () =>
          law.commit({
            crime: form.crime,
            region: form.region,
            witnesses:
              form.witness === 'none' ? [] : [devWitness(form.witness, form.identification)],
          }),
      },
      'go',
    )
    .name('Commit crime');
  root.add({ file: () => law.fileAll() }, 'file').name('File all reports now');
  root
    .add(
      {
        stop: () => {
          const r = state.reports.inProgress[0];
          if (r) law.intercept(r.id);
        },
      },
      'stop',
    )
    .name('Intercept next report');
  const tiers = root.addFolder('Set tier');
  tiers.add(form, 'tier', 0, defs.wanted.tiers.length - 1, 1);
  tiers.add({ set: () => law.setTier(form.region, form.tier) }, 'set').name('Set region tier');

  return {
    update() {
      const here = law.region();
      read['here'] = here ?? '—';
      for (const r of defs.regions) {
        const w = state.wanted[r.id];
        const heat = w?.heat ?? 0;
        read[r.id] =
          `${wantedTierName(defs, wantedTier(defs, heat))} ${heat.toFixed(1)}` +
          (w?.shipHeat ? ` (ship ${w.shipHeat.toFixed(1)})` : '') +
          (w?.alert ? ` alert ${w.alert.toFixed(1)}` : '');
      }
      read['fame'] =
        `${fameTierName(defs, fameTier(defs, state.fame.value))} ${state.fame.value.toFixed(1)}`;
      const now = state.environment.clock.gameSeconds;
      read['reports'] =
        state.reports.inProgress
          .map((r) => `${r.witness.kind} ${((r.eta - now) / 3600).toFixed(1)}h`)
          .join(', ') || 'none';
    },
  };
}
