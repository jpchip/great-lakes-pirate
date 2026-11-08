import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { EventBus } from '../core/events';
import type { GameCombat } from '../gameplay/combat';
import type { Entity } from '../gameplay/ecs';
import type { GameEvents } from '../modes/context';
import { addToHold } from '../sim/economy/hold';
import type { WorldState } from '../sim/world-state';

/**
 * The combat folder of the dev overlay (plan 07 §14.4 piece A): arm the ship, stow powder,
 * fire at the nearest ship or at a bearing, knock a ship's pools down, and read her damage
 * and the last combat event. Aim mode is piece B; this is for trying the core.
 */
export interface CombatPanelOptions {
  gui: GUI;
  combat: GameCombat;
  state: WorldState;
  events: EventBus<GameEvents>;
  player: Entity;
  /** The NPC ships on the water now. */
  ships(): Iterable<Entity>;
}

const COMBAT_EVENTS = new Set<keyof GameEvents>([
  'WeaponFired',
  'ShotLanded',
  'ShipHit',
  'CrewCasualties',
  'BoilerExploded',
  'ShipSunk',
]);

const DEG = Math.PI / 180;

export function createCombatPanel(options: CombatPanelOptions): { update(): void } {
  const { combat, state } = options;
  const root = options.gui.addFolder('Combat').close();
  const read = { guns: '', powder: '', reload: '', target: '', last: '' };
  const readout = root.addFolder('Readout');
  for (const k of Object.keys(read))
    readout
      .add(read, k as keyof typeof read)
      .disable()
      .listen();

  options.events.tap((type, payload) => {
    if (!COMBAT_EVENTS.has(type)) return;
    const fields = Object.entries(payload as Record<string, unknown>)
      .filter(([, v]) => typeof v !== 'object')
      .map(([k, v]) => `${k} ${typeof v === 'number' ? Math.round(v * 10) / 10 : String(v)}`);
    read.last = [type, ...fields].join('  ');
  });

  const nearest = (): Entity | undefined => {
    const p = options.player.transform?.position;
    if (!p) return undefined;
    let best: Entity | undefined;
    let bestD = Infinity;
    for (const e of options.ships()) {
      const t = e.transform?.position;
      if (!t || e.damage?.sunk) continue;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  };

  const form = {
    ammo: 'ammo.round',
    bearing: 90,
    range: 200,
    pool: 'hull' as 'hull' | 'rigging' | 'crew' | 'engine',
    points: 50,
  };
  const ammoIds = [...combat.defs.ammo.keys()];
  const say = (r: { ok: boolean; reason?: string }): void => {
    read.last = r.ok ? 'fired' : `refused: ${r.reason ?? ''}`;
  };

  const arm = root.addFolder('Arm');
  arm
    .add(
      {
        go: () => {
          const ship = state.player.ship;
          if (!ship) return;
          const m = combat.defs.mounts[ship.classId];
          ship.weapons = ship.weapons.filter((w) => w.mount === 'hand');
          for (let i = 0; i < (m?.bow ?? 0); i++)
            ship.weapons.push({ weapon: 'weapon.swivel', mount: 'bow' });
          for (let i = 0; i < (m?.broadside ?? 0); i++) {
            ship.weapons.push({ weapon: 'weapon.light_cannon', mount: 'port' });
            ship.weapons.push({ weapon: 'weapon.light_cannon', mount: 'starboard' });
          }
        },
      },
      'go',
    )
    .name('Mount every gun she carries');
  arm
    .add(
      { go: () => addToHold(state.player.cargo, { good: combat.defs.powder.good, qty: 3 }) },
      'go',
    )
    .name('Stow 3 kegs of powder');

  const fire = root.addFolder('Fire');
  fire.add(form, 'ammo', ammoIds);
  fire
    .add(
      {
        go: () => {
          const e = nearest();
          if (!e?.id) return void (read.last = 'no ship in sight');
          say(combat.fire({ ammo: form.ammo, target: e.id }));
        },
      },
      'go',
    )
    .name('Fire at nearest ship');
  fire.add(form, 'bearing', 0, 359, 1).name('bearing (deg)');
  fire.add(form, 'range', 20, 600, 10).name('range (m)');
  fire
    .add(
      {
        go: () => {
          const h = options.player.transform?.heading ?? 0;
          say(
            combat.fire({ ammo: form.ammo, bearing: h + form.bearing * DEG, rangeM: form.range }),
          );
        },
      },
      'go',
    )
    .name('Fire at bearing off the bow');

  const hurt = root.addFolder('Damage nearest');
  hurt.add(form, 'pool', ['hull', 'rigging', 'crew', 'engine']);
  hurt.add(form, 'points', 1, 500, 1);
  hurt
    .add(
      {
        go: () => {
          const e = nearest();
          if (e?.id) combat.damage(e.id, form.pool, form.points);
        },
      },
      'go',
    )
    .name('Knock it down');
  hurt
    .add(
      {
        go: () => {
          const e = nearest();
          if (e?.id) read.last = combat.explode(e.id) ? 'boiler burst' : 'no boiler to burst';
        },
      },
      'go',
    )
    .name('Burst her boiler');

  return {
    update() {
      read.guns = (state.player.ship?.weapons ?? [])
        .map((w) => `${w.mount}:${w.weapon.slice(7)}`)
        .join(' ');
      read.powder = `${combat.charges()} charges`;
      read.reload = Object.entries(combat.reloads())
        .map(([m, s]) => `${m} ${s.toFixed(1)}s`)
        .join(' ');
      const e = nearest();
      const d = e?.damage;
      read.target = !e
        ? '—'
        : !d
          ? `${e.id ?? ''} sound`
          : `${e.id ?? ''} hull ${d.hull.toFixed(0)}/${d.hullMax} rig ${d.rigging.toFixed(0)} ` +
            `eng ${d.engine.toFixed(0)} crew ${d.crew}/${d.crewMax} k${d.killed} w${d.wounded}` +
            (d.founderingS !== undefined ? ' FOUNDERING' : '');
    },
  };
}
