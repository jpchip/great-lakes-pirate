import type { Mount } from '../../data/schemas/combat';
import type { ShipRecord } from '../../data/schemas/ships';
import type { InputMapper } from '../core/input';
import type { AimView } from './camera/ship-camera';
import type { GameContext } from '../modes/context';
import { arcCenter, reachM, reloadSeconds, spreadRad } from '../sim/combat/armament';
import {
  AIM_KIND,
  barrelTilt,
  previewArc,
  sideFor,
  solveAim,
  wrapPi,
  type AimSolution,
  type AimWeapon,
  type ArcPreview,
} from '../sim/combat/aim';
import { ammoDef, weaponDef } from '../sim/combat/defs';
import type { ShipDamage } from '../sim/combat/damage';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import type { TargetPhase } from '../sim/targets/morale';
import { crewFor } from '../sim/traffic/cargo';
import type { FireRefusal, GameCombat } from './combat';
import type { Entity } from './ecs';
import type { TargetView } from './targets';

/**
 * Aim mode in play (plan 07 §3; Phase 6 piece B). Tab swings the camera out over the
 * chosen side, or the bow for the swivel; the cursor lays the gun where it meets the water,
 * inside the gun's arc and reach, and the dotted arc and splash ring show where the shot
 * goes now: with the ship's roll in it, so the ring swings with the sea and firing as she
 * rolls down is the skill. 1/2/3 pick the swivel, the broadside (2 again for the other
 * side) and the rifle; C changes the shot; the left mouse fires. On the T1 you steer and
 * shoot yourself, so the rudder holds where it was while you aim.
 */

export interface AimDeps {
  ctx: GameContext;
  player: Entity;
  combat: GameCombat;
  /** How far the fall of shot can be seen now, meters (light and fog). */
  sightM(): number;
  /** Why the guns can't be worked now (docked, ashore); undefined when they can. */
  refusal(): string | undefined;
  /** Her steady heel, radians: the gunner lays it out. */
  heel(): number;
  /** Ships on the water now: the target card's choice. */
  ships(): Iterable<Entity>;
  captains(): readonly TargetView[];
  nameOf(id: string): string;
  notice(text: string): void;
}

export type AimStatus =
  'ready' | 'reloading' | 'outOfArc' | 'beyondReach' | 'pastSight' | 'noPowder' | 'firing';

export interface AimHudSnapshot {
  weapon: AimWeapon;
  /** "Bow swivel", "Starboard broadside, 2 guns", "Rifle". */
  title: string;
  ammo: string;
  /** Every shot this gun takes, the loaded one marked. */
  ammoChoices: { id: string; name: string; selected: boolean }[];
  /** Range to the point laid on, meters. */
  rangeM: number;
  reachM: number;
  sightM: number;
  status: AimStatus;
  statusText: string;
  /** Each mounted gun's load: 1 ready, seconds to go. */
  reloads: { mount: Mount; label: string; ready01: number; seconds: number }[];
  charges: number;
  steeringLocked: boolean;
  /** The barrel's tilt off the sight, degrees (+ up), and which way it's moving. */
  tiltDeg: number;
  falling: boolean;
  /** Which of the three are mounted. */
  available: Record<AimWeapon, boolean>;
}

/** The target card (plan 13 §4.5): who she is and how she's taking it. */
export interface TargetCardSnapshot {
  shipId: string;
  name: string;
  className: string;
  phase: TargetPhase | 'unknown';
  phaseLabel: string;
  /** 0–100; undefined when her captain isn't watched (law ships). */
  morale: number | undefined;
  why: string;
  crew: number;
  killed: number;
  wounded: number;
  hull01: number;
  rigging01: number;
  engine01: number | undefined;
  struck: boolean;
  foundering: boolean;
  towParted: boolean | undefined;
  rangeM: number;
}

export interface GameAim {
  readonly active: boolean;
  readonly weapon: AimWeapon;
  readonly ammo: string;
  readonly side: 'port' | 'starboard';
  /** One sailing tick: Tab, 1/2/3, C, and the left mouse (`fireAllowed` when it hit the sea). */
  step(input: InputMapper, fireAllowed: boolean): void;
  /** Every frame: the cursor's ray from the camera, and the real seconds since the last. */
  setCursor(ray: Ray, frameSeconds: number): void;
  /** Lay on a point on the water directly (tests, the dev hook). */
  aimAt(x: number, z: number): void;
  enter(weapon?: AimWeapon): boolean;
  exit(): void;
  select(weapon: AimWeapon): boolean;
  cycleAmmo(): string;
  /** Fire on the current lay. */
  fire(): { ok: true } | { ok: false; reason: FireRefusal };
  /** The T1's rudder holds while you aim (§3). */
  steeringLocked(): boolean;
  /** How the ship's motion throws a mount's barrel off its sight now (for the combat core). */
  tilt(mount: Mount): number;
  camera(): AimView | undefined;
  solution(): AimSolution | undefined;
  preview(): ArcPreview | undefined;
  hud(): AimHudSnapshot | undefined;
  targetCard(): TargetCardSnapshot | undefined;
}

interface Ray {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
}

const DEG = Math.PI / 180;
/** Where the aim point is put when the cursor's above the horizon: far along its bearing. */
const SKY_AIM_M = 2000;
/** The target card shows the ship within this of the lay, or a quarter of her range. */
const TARGET_NEAR_M = 80;
/** A hull shows further off than the fall of shot does (sim/combat/aim's sight shares). */
const HULL_SIGHT_MUL = 1.7;
/** The swivel and rifle views turn toward the aim once it's this far off their center. */
const LOOK_DEADZONE = 14 * DEG;
const LOOK_RATE = 1.6;
/** The camera's place for each gun (plan 07 §3: on the chosen side, or the bow). */
const VIEWS: Record<AimWeapon, { backM: number; aftM: number; upM: number; leadM: number }> = {
  swivel: { backM: 4, aftM: 0, upM: 24, leadM: 140 },
  broadside: { backM: -2, aftM: 6, upM: 6, leadM: 120 },
  rifle: { backM: 2, aftM: 0, upM: 16, leadM: 90 },
};
const PHASE_LABELS: Record<TargetPhase, string> = {
  transit: 'On her course',
  alert: 'Alert',
  fleeing: 'Running',
  fighting: 'Turning on you',
  struck: 'Colors struck',
  fled: 'Got clear',
};
const MOUNT_LABELS: Record<Mount, string> = {
  bow: 'Swivel',
  port: 'Port',
  starboard: 'Stbd',
  hand: 'Rifle',
};
const STATUS_TEXT: Record<AimStatus, string> = {
  ready: 'Ready',
  reloading: 'Loading',
  outOfArc: 'Gun at the end of her arc',
  beyondReach: 'Beyond her reach',
  pastSight: "Can't see the fall of shot",
  noPowder: 'No powder',
  firing: 'Firing',
};
const REFUSAL_TEXT: Record<FireRefusal, string> = {
  unarmed: 'No gun mounted there',
  outOfArc: "The gun won't bear",
  reloading: 'Still loading',
  noPowder: 'Out of powder and shot',
  outOfRange: 'Out of range',
  wrongAmmo: "That gun doesn't take that shot",
  noTarget: 'Nothing to lay on',
  sunk: 'Sunk',
};

const recordOf = (classId: string): ShipRecord | undefined =>
  SHIP_RECORDS.find((r) => r.id === classId);

export function attachAim(deps: AimDeps): GameAim {
  const { ctx, player, combat } = deps;
  const defs = combat.defs;
  let active = false;
  let weapon: AimWeapon = 'swivel';
  /** The gun last picked with 1/2/3: Tab comes back to it while it's mounted. */
  let chosen: AimWeapon | undefined;
  let side: 'port' | 'starboard' = 'starboard';
  /** Where the camera looks, off the bow; the swivel and rifle views follow the aim. */
  let lookRel = 0;
  const ammoFor: Record<AimWeapon, string | undefined> = {
    swivel: undefined,
    broadside: undefined,
    rifle: undefined,
  };
  const aimPoint = { x: 0, z: 0 };
  let hasAim = false;
  let lastTilt = 0;
  let falling = false;

  const mounted = (w: AimWeapon): { weapon: string; mount: Mount }[] => {
    const kind = AIM_KIND[w];
    return (ctx.state.player.ship?.weapons ?? []).filter(
      (m) => defs.weapons.get(m.weapon)?.kind === kind,
    );
  };
  const available = (): Record<AimWeapon, boolean> => ({
    swivel: mounted('swivel').length > 0,
    broadside: mounted('broadside').length > 0,
    rifle: mounted('rifle').length > 0,
  });
  /** The gun laid now: the mount for the weapon (the chosen side for a broadside). */
  const current = (): { weapon: string; mount: Mount; guns: number } | undefined => {
    const list = mounted(weapon);
    const mount: Mount | undefined =
      weapon === 'broadside' ? side : weapon === 'swivel' ? 'bow' : 'hand';
    const on = list.filter((m) => m.mount === mount);
    const first = on[0];
    return first ? { weapon: first.weapon, mount: first.mount, guns: on.length } : undefined;
  };
  const ammoOf = (gunId: string): string => {
    const w = weaponDef(defs, gunId);
    const pick = ammoFor[weapon];
    return pick && w.ammo.includes(pick) ? pick : (w.ammo[0] ?? 'ammo.round');
  };

  const heading = (): number => player.transform?.heading ?? 0;

  const tilt = (mount: Mount): number => {
    const t = player.transform;
    if (!t) return 0;
    return barrelTilt(mount, { roll: t.roll ?? 0, pitch: t.pitch ?? 0, heel: deps.heel() });
  };

  const solution = (): AimSolution | undefined => {
    const gun = current();
    if (!active || !gun || !hasAim) return undefined;
    const muzzle = combat.muzzle(gun.mount);
    if (!muzzle) return undefined;
    const w = weaponDef(defs, gun.weapon);
    // A hair inside the arc, so the core's own check passes on the edge.
    const held = { ...w, arcDeg: Math.min(w.arcDeg, w.arcDeg * 0.995) };
    return solveAim(
      held,
      gun.mount,
      muzzle,
      heading(),
      aimPoint,
      reachM(defs, gun.weapon, ammoOf(gun.weapon)),
    );
  };

  const preview = (): ArcPreview | undefined => {
    const gun = current();
    const sol = solution();
    const muzzle = gun && combat.muzzle(gun.mount);
    if (!gun || !sol || !muzzle) return undefined;
    const w = weaponDef(defs, gun.weapon);
    return previewArc(
      muzzle,
      combat.playerVelocity(),
      sol.bearing,
      sol.elevation + tilt(gun.mount),
      w.muzzleMs,
      spreadRad(defs, gun.weapon, ammoOf(gun.weapon), combat.gunnery()),
      deps.sightM(),
    );
  };

  const nearestTargetSide = (): 'port' | 'starboard' | undefined => {
    const t = player.transform;
    if (!t) return undefined;
    let best: { d: number; side: 'port' | 'starboard' } | undefined;
    for (const e of deps.ships()) {
      const p = e.transform?.position;
      if (!p || e === player || e.damage?.sunk) continue;
      const d = Math.hypot(p.x - t.position.x, p.z - t.position.z);
      const b = Math.atan2(p.x - t.position.x, -(p.z - t.position.z));
      if (!best || d < best.d) best = { d, side: sideFor(t.heading, b) };
    }
    return best?.side;
  };

  /** Where the camera starts for a weapon, and the first aim point out on the water. */
  const settle = (): void => {
    const t = player.transform;
    if (weapon === 'broadside') lookRel = arcCenter(side);
    else if (weapon === 'swivel') lookRel = 0;
    // The rifle keeps whatever it last looked at.
    if (t) {
      const gun = current();
      const reach = gun ? reachM(defs, gun.weapon, ammoOf(gun.weapon)) : 200;
      const b = t.heading + lookRel;
      aimPoint.x = t.position.x + Math.sin(b) * reach * 0.6;
      aimPoint.z = t.position.z - Math.cos(b) * reach * 0.6;
      hasAim = true;
    }
  };

  const api: GameAim = {
    get active() {
      return active;
    },
    get weapon() {
      return weapon;
    },
    get ammo() {
      const gun = current();
      return gun ? ammoOf(gun.weapon) : '';
    },
    get side() {
      return side;
    },

    enter(pick) {
      const why = deps.refusal();
      if (why) {
        deps.notice(why);
        return false;
      }
      const have = available();
      const want = pick ?? chosen ?? 'swivel';
      weapon = have[want] ? want : have.swivel ? 'swivel' : have.broadside ? 'broadside' : 'rifle';
      if (!have[weapon]) {
        deps.notice('No gun aboard to aim');
        return false;
      }
      if (weapon === 'broadside') side = nearestTargetSide() ?? side;
      active = true;
      settle();
      return true;
    },

    exit() {
      active = false;
      hasAim = false;
    },

    select(pick) {
      if (!available()[pick]) {
        deps.notice(
          pick === 'broadside'
            ? 'She mounts no broadside'
            : pick === 'swivel'
              ? 'No swivel on her bow'
              : 'No rifle aboard',
        );
        return false;
      }
      chosen = pick;
      if (!active) return api.enter(pick);
      if (pick === weapon && pick === 'broadside') {
        side = side === 'port' ? 'starboard' : 'port';
      } else if (pick === weapon) {
        return true;
      } else {
        weapon = pick;
        if (weapon === 'broadside') side = nearestTargetSide() ?? side;
      }
      settle();
      return true;
    },

    cycleAmmo() {
      const gun = current();
      if (!gun) return '';
      const list = weaponDef(defs, gun.weapon).ammo;
      const now = ammoOf(gun.weapon);
      const next = list[(list.indexOf(now) + 1) % list.length] ?? now;
      ammoFor[weapon] = next;
      return next;
    },

    fire() {
      const gun = current();
      const sol = solution();
      if (!gun || !sol) return { ok: false, reason: 'unarmed' };
      const r = combat.fire({
        ammo: ammoOf(gun.weapon),
        mount: gun.mount,
        bearing: sol.bearing,
        elevation: sol.elevation,
      });
      if (r.ok) return { ok: true };
      return { ok: false, reason: r.reason };
    },

    step(input, fireAllowed) {
      if (input.context !== 'sailing') {
        if (active) api.exit();
        return;
      }
      if (input.pressed('AimMode')) {
        if (active) api.exit();
        else api.enter();
      }
      if (input.pressed('AimSwivel')) api.select('swivel');
      if (input.pressed('AimBroadside')) api.select('broadside');
      if (input.pressed('AimRifle')) api.select('rifle');
      if (!active) return;
      const why = deps.refusal();
      if (why) {
        api.exit();
        return;
      }
      if (input.pressed('CycleAmmo')) {
        const a = api.cycleAmmo();
        if (a) deps.notice(`${ammoDef(defs, a).name} loaded`);
      }
      if (fireAllowed && input.pressed('Fire')) {
        const r = api.fire();
        if (!r.ok) deps.notice(REFUSAL_TEXT[r.reason]);
      }
    },

    setCursor(ray, frameSeconds) {
      const t = player.transform;
      if (!active || !t) return;
      const { origin, dir } = ray;
      if (dir.y < -1e-4) {
        const k = -origin.y / dir.y;
        aimPoint.x = origin.x + dir.x * k;
        aimPoint.z = origin.z + dir.z * k;
      } else {
        const flat = Math.hypot(dir.x, dir.z) || 1;
        aimPoint.x = t.position.x + (dir.x / flat) * SKY_AIM_M;
        aimPoint.z = t.position.z + (dir.z / flat) * SKY_AIM_M;
      }
      hasAim = true;
      // The swivel's and the rifle's view turns toward an aim off to one side of it.
      if (weapon !== 'broadside' && frameSeconds > 0) {
        const rel = wrapPi(
          Math.atan2(aimPoint.x - t.position.x, -(aimPoint.z - t.position.z)) - t.heading,
        );
        const off = wrapPi(rel - lookRel);
        if (Math.abs(off) > LOOK_DEADZONE) {
          const step =
            (off - Math.sign(off) * LOOK_DEADZONE) * (1 - Math.exp(-frameSeconds * LOOK_RATE));
          lookRel = wrapPi(lookRel + step);
        }
        if (weapon === 'swivel') {
          const half = (weaponDef(defs, current()?.weapon ?? 'weapon.swivel').arcDeg / 2) * DEG;
          lookRel = Math.max(-half, Math.min(half, lookRel));
        }
      }
      // Which way the barrel is moving: down is the moment to fire.
      const gun = current();
      if (gun && frameSeconds > 0) {
        const now = tilt(gun.mount);
        if (Math.abs(now - lastTilt) > 1e-5) falling = now < lastTilt;
        lastTilt = now;
      }
    },

    aimAt(x, z) {
      aimPoint.x = x;
      aimPoint.z = z;
      hasAim = true;
    },

    steeringLocked() {
      return active && !combat.crewed();
    },

    tilt,

    camera() {
      if (!active) return undefined;
      return { lookRel, ...VIEWS[weapon] };
    },

    solution,
    preview,

    hud() {
      const gun = current();
      if (!active || !gun) return undefined;
      const sol = solution();
      const p = preview();
      const ammo = ammoOf(gun.weapon);
      const w = weaponDef(defs, gun.weapon);
      const reloadsLeft = combat.reloads();
      const crewed = combat.crewed();
      const gunnery = combat.gunnery();
      const reloads: AimHudSnapshot['reloads'] = [];
      const seen = new Set<Mount>();
      for (const m of ctx.state.player.ship?.weapons ?? []) {
        if (seen.has(m.mount)) continue;
        seen.add(m.mount);
        const full = reloadSeconds(weaponDef(defs, m.weapon), crewed, gunnery);
        const left = reloadsLeft[m.mount] ?? 0;
        reloads.push({
          mount: m.mount,
          label: MOUNT_LABELS[m.mount],
          ready01: full > 0 ? 1 - left / full : 1,
          seconds: left,
        });
      }
      const charges = combat.charges();
      const needs = w.charges * gun.guns;
      const sightM = deps.sightM();
      let status: AimStatus = 'ready';
      if ((reloadsLeft[gun.mount] ?? 0) > 0)
        status = combat.volleysPending() > 0 ? 'firing' : 'reloading';
      else if (charges < needs) status = 'noPowder';
      else if (sol?.arcLimited) status = 'outOfArc';
      else if (sol?.beyondReach) status = 'beyondReach';
      else if (p && !p.splash) status = 'pastSight';
      const left = reloadsLeft[gun.mount] ?? 0;
      const tiltDeg = tilt(gun.mount) / DEG;
      const title =
        weapon === 'broadside'
          ? `${side === 'port' ? 'Port' : 'Starboard'} broadside, ${gun.guns} gun${gun.guns === 1 ? '' : 's'}`
          : w.name;
      return {
        weapon,
        title,
        ammo,
        ammoChoices: w.ammo.map((id) => ({
          id,
          name: ammoDef(defs, id).name,
          selected: id === ammo,
        })),
        rangeM: sol?.rangeM ?? 0,
        reachM: reachM(defs, gun.weapon, ammo),
        sightM,
        status,
        statusText: status === 'reloading' ? `Loading, ${left.toFixed(1)} s` : STATUS_TEXT[status],
        reloads,
        charges,
        steeringLocked: !crewed,
        tiltDeg: Math.round(tiltDeg * 10) / 10,
        falling,
        available: available(),
      };
    },

    targetCard() {
      const t = player.transform;
      if (!active || !t) return undefined;
      // The ship nearest where the cursor (or the shot) is laid, within a quarter of her
      // range: what the gunner is looking at.
      const p = preview();
      const at = [aimPoint, ...(p ? [p.impact] : [])];
      let best: { e: Entity; d: number } | undefined;
      const sight = deps.sightM();
      for (const e of deps.ships()) {
        const pos = e.transform?.position;
        if (!pos || e === player || !e.id || !e.npc || e.damage?.sunk) continue;
        const d = Math.min(...at.map((a) => Math.hypot(pos.x - a.x, pos.z - a.z)));
        const off = Math.hypot(pos.x - t.position.x, pos.z - t.position.z);
        // Not a ship the eye can't make out in the dark or the fog.
        if (off > sight * HULL_SIGHT_MUL) continue;
        if (d < Math.max(TARGET_NEAR_M, off * 0.25) && (!best || d < best.d)) best = { e, d };
      }
      if (!best) return undefined;
      const e = best.e;
      const id = e.id ?? '';
      const r = recordOf(e.npc?.classId ?? '');
      const d: ShipDamage | undefined = combat.peek(id);
      const cap = deps.captains().find((c) => c.id === id);
      const pos = e.transform?.position ?? t.position;
      const steamer = (r?.propulsion ?? '') === 'steam';
      return {
        shipId: id,
        name: deps.nameOf(id),
        className: r?.name ?? 'Ship',
        phase: cap?.phase ?? 'unknown',
        phaseLabel: cap ? PHASE_LABELS[cap.phase] : 'Unknown',
        morale: cap?.morale,
        why: cap?.why ?? '',
        crew: d ? d.crew : crewFor(r?.id ?? ''),
        killed: d?.killed ?? 0,
        wounded: d?.wounded ?? 0,
        hull01: d && d.hullMax > 0 ? d.hull / d.hullMax : 1,
        rigging01: d && d.riggingMax > 0 ? d.rigging / d.riggingMax : 1,
        engine01: steamer ? (d && d.engineMax > 0 ? d.engine / d.engineMax : 1) : undefined,
        struck: cap?.phase === 'struck',
        foundering: d?.founderingS !== undefined,
        towParted: cap?.towedBy !== undefined ? !!cap.towParted : undefined,
        rangeM: Math.hypot(pos.x - t.position.x, pos.z - t.position.z),
      };
    },
  };
  return api;
}
