import * as THREE from 'three';
import { DEFAULT_COMPRESSION, sceneSpeed } from '../../core/coords';
import { R_SAILING } from '../../core/time';
import { interpolateTransform, type Entity, type Transform } from '../../gameplay/ecs';
import { SHIP_RECORDS } from '../../sim/sailing/ships';
import type { Wind } from '../../sim/weather/weather';
import type { OutlineSettings } from '../style/outline';
import type { StyleLighting } from '../style/stylized-material';
import { createShipWake, measureWaterline, type ShipWake, type WakeShip } from '../water/wake';
import type { Water } from '../water/water';
import { createFunnelSmoke, type FunnelSmoke, type SmokeSource } from './funnel-smoke';
import { npcLines } from './npc-lines';
import { createNpcShip, styleNpcShip, type NpcShipModel } from './npc-ship';

/**
 * The NPC ships in a scene (Phase 3 piece H): each one's model, posed on its transform,
 * its wake, its stacks' smoke into the local wind through one shared smoke system, and
 * its lamps and windows lit from dusk. The sailing scene loads this module the first time
 * an NPC entity appears, so a zone without traffic doesn't carry it.
 */

export interface NpcViewEnv {
  scene: THREE.Scene;
  water: Water;
  lighting: StyleLighting;
  outlines: OutlineSettings;
  /** The wind at a zone point now. */
  windAt(p: { x: number; z: number }): Wind;
}

export interface NpcView {
  readonly models: ReadonlyMap<Entity, NpcShipModel>;
  readonly smoke: FunnelSmoke;
  add(e: Entity): void;
  remove(e: Entity): void;
  /**
   * `now` is the wake clock (real seconds), `frameSeconds` 0 while paused;
   * `sunElevationDeg` and `fogDensity` light the lamps and windows.
   */
  update(
    alpha: number,
    now: number,
    frameSeconds: number,
    sunElevationDeg: number,
    fogDensity: number,
  ): void;
}

interface Drawn {
  model: NpcShipModel;
  wake: ShipWake;
  sources: SmokeSource[];
}

export function createNpcView(env: NpcViewEnv): NpcView {
  const { scene, water, lighting, outlines } = env;
  const drawn = new Map<Entity, Drawn>();
  const models = new Map<Entity, NpcShipModel>();
  const smoke = createFunnelSmoke(lighting);
  scene.add(smoke.points);

  const t: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
  const ship: WakeShip = { x: 0, z: 0, heading: 0, course: 0, speed: 0 };
  const air = { x: 0, z: 0 };
  const stackTop = new THREE.Vector3();
  const tint = new THREE.Color();
  const still = { x: 0, z: 0 };

  return {
    models,
    smoke,
    add(e) {
      const classId = e.npc?.classId;
      const record = SHIP_RECORDS.find((r) => r.id === classId);
      if (!record) throw new Error(`No ship class ${String(classId)}`);
      const model = createNpcShip(npcLines(record.modelId), record.displayScale);
      styleNpcShip(model, lighting, outlines);
      model.group.rotation.order = 'YXZ';
      scene.add(model.group);
      const wake = createShipWake(measureWaterline(model.group), water);
      scene.add(wake.mesh);
      // A wreck (Phase 3 piece G) has lost her canvas, her lamps and her fires.
      const derelict = e.npc?.derelict === true;
      if (derelict && model.sails) model.sails.visible = false;
      const sources = derelict ? [] : model.stacks.map(() => ({ owed: 0 }));
      drawn.set(e, { model, wake, sources });
      models.set(e, model);
    },
    remove(e) {
      const d = drawn.get(e);
      if (!d) return;
      scene.remove(d.model.group, d.wake.mesh);
      d.model.dispose();
      d.wake.dispose();
      drawn.delete(e);
      models.delete(e);
    },
    update(alpha, now, frameSeconds, sunElevationDeg, fogDensity) {
      for (const [e, { model, wake, sources }] of drawn) {
        interpolateTransform(e, alpha, t);
        const object = model.group;
        object.position.set(t.position.x, t.position.y, t.position.z);
        // Heading is clockwise from north; three.js yaw is counter-clockwise.
        object.rotation.set(t.pitch ?? 0, -t.heading, (t.roll ?? 0) + (e.npc?.listRad ?? 0));
        const wind = env.windAt(t.position);
        // Booms to leeward: the wind's bearing off the bow, starboard positive. A wreck
        // shows no lights: it's lit as at noon.
        const sun = e.npc?.derelict ? 90 : sunElevationDeg;
        model.update(sun, fogDensity, Math.sin(wind.fromRad - t.heading) > 0);
        const v = e.velocity ?? still;
        ship.x = t.position.x;
        ship.z = t.position.z;
        ship.heading = t.heading;
        ship.course = t.heading;
        ship.speed = Math.hypot(v.x, v.z);
        wake.update(ship, now);
        if (frameSeconds <= 0 || sources.length === 0) continue;
        object.updateMatrixWorld();
        // The wind's vector (knots, y north) in scene meters per second (z south).
        air.x = sceneSpeed(wind.toKn.x, R_SAILING, DEFAULT_COMPRESSION);
        air.z = -sceneSpeed(wind.toKn.y, R_SAILING, DEFAULT_COMPRESSION);
        tint.set(model.lines.paint.smoke);
        model.stacks.forEach((stack, i) => {
          stackTop.copy(stack.top).applyMatrix4(object.matrixWorld);
          const source = sources[i];
          if (source) smoke.emit(source, stackTop, v, air, stack.radius, tint, frameSeconds);
        });
      }
      smoke.update(frameSeconds);
    },
  };
}
