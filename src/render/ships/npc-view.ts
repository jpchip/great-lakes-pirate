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
  /** A consort's hawser to her steamer's stern (Phase 6 piece C). */
  hawser?: THREE.Line;
}

/** Points along a drawn hawser, and how far it sags into the water at its middle. */
const HAWSER_POINTS = 16;
const HAWSER_SAG_M = 2.5;

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

  const bowAt = new THREE.Vector3();
  const sternAt = new THREE.Vector3();
  const lt: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
  const ct: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
  const halfOf = (e: Entity): number => {
    const r = SHIP_RECORDS.find((k) => k.id === e.npc?.classId);
    return r ? (r.lengthM * r.displayScale) / 2 : 20;
  };
  /** The consort's hawser, from her steamer's stern to her bow, sagging to the water. */
  const drawHawser = (e: Entity, line: THREE.Line): void => {
    const leader = e.npc?.towParted
      ? undefined
      : [...drawn.keys()].find((k) => k.id === e.npc?.towedBy);
    line.visible = !!leader;
    if (!leader) return;
    interpolateTransform(leader, lastAlpha, lt);
    interpolateTransform(e, lastAlpha, ct);
    const lh = halfOf(leader) * 0.97;
    const ch = halfOf(e) * 0.97;
    sternAt.set(
      lt.position.x - Math.sin(lt.heading) * lh,
      lt.position.y + 1.6,
      lt.position.z + Math.cos(lt.heading) * lh,
    );
    bowAt.set(
      ct.position.x + Math.sin(ct.heading) * ch,
      ct.position.y + 2.2,
      ct.position.z - Math.cos(ct.heading) * ch,
    );
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < HAWSER_POINTS; i++) {
      const u = i / (HAWSER_POINTS - 1);
      const sag = Math.sin(Math.PI * u) * HAWSER_SAG_M;
      attr.setXYZ(
        i,
        sternAt.x + (bowAt.x - sternAt.x) * u,
        sternAt.y + (bowAt.y - sternAt.y) * u - sag,
        sternAt.z + (bowAt.z - sternAt.z) * u,
      );
    }
    attr.needsUpdate = true;
  };
  let lastAlpha = 1;

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
      let hawser: THREE.Line | undefined;
      if (e.npc?.towedBy) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(HAWSER_POINTS * 3), 3),
        );
        hawser = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x3b3328 }));
        hawser.name = 'hawser';
        hawser.frustumCulled = false;
        scene.add(hawser);
      }
      drawn.set(e, { model, wake, sources, ...(hawser ? { hawser } : {}) });
      models.set(e, model);
    },
    remove(e) {
      const d = drawn.get(e);
      if (!d) return;
      scene.remove(d.model.group, d.wake.mesh);
      if (d.hawser) {
        scene.remove(d.hawser);
        d.hawser.geometry.dispose();
        (d.hawser.material as THREE.Material).dispose();
      }
      d.model.dispose();
      d.wake.dispose();
      drawn.delete(e);
      models.delete(e);
    },
    update(alpha, now, frameSeconds, sunElevationDeg, fogDensity) {
      lastAlpha = alpha;
      for (const [e, d] of drawn) {
        if (d.hawser) drawHawser(e, d.hawser);
      }
      for (const [e, { model, wake, sources }] of drawn) {
        interpolateTransform(e, alpha, t);
        const object = model.group;
        // A foundering ship settles (Phase 6 piece A).
        object.position.set(t.position.x, t.position.y - (e.npc?.sinkM ?? 0), t.position.z);
        // Heading is clockwise from north; three.js yaw is counter-clockwise.
        object.rotation.set(t.pitch ?? 0, -t.heading, (t.roll ?? 0) + (e.npc?.listRad ?? 0));
        const wind = env.windAt(t.position);
        // Booms to leeward: the wind's bearing off the bow, starboard positive. A wreck
        // shows no lights: it's lit as at noon.
        const sun = e.npc?.derelict ? 90 : sunElevationDeg;
        model.update(sun, fogDensity, Math.sin(wind.fromRad - t.heading) > 0);
        model.setStruck(e.npc?.struck === true);
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
