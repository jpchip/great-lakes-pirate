import * as THREE from 'three';
import { interpolateTransform, type GameWorld, type Transform } from '../../gameplay/ecs';
import type { ContactKind } from '../../sim/chart/traffic';
import { createSea, testBaySea, type Sea } from '../../sim/weather/waves';
import type { GameRenderer } from '../../render/renderer';
import { createPlaceholderSchooner } from '../../render/ships/placeholder-schooner';
import { createSky } from '../../render/sky';
import { createWater, type Water } from '../../render/water/water';

/**
 * Three.js side of the S8 arena: the S2 water and sky, the placeholder schooner, and a
 * box-built stand-in for whatever was met. A chase camera sits behind the schooner.
 */

const DAY_HORIZON = new THREE.Color(0xb7c6cf);
const DAY_ZENITH = new THREE.Color(0x6f8ea3);
const NIGHT_HORIZON = new THREE.Color(0x1a2433);
const NIGHT_ZENITH = new THREE.Color(0x070b14);
const STORM_HORIZON = new THREE.Color(0x5d666c);
const STORM_ZENITH = new THREE.Color(0x3a4247);
const SUN_DIRECTION = new THREE.Vector3(0.45, 0.55, -0.35).normalize();

export interface ArenaScene {
  readonly sea: Sea;
  /** Rebuild for a new encounter. */
  setup(world: GameWorld, kind: ContactKind, daylight: number): void;
  /** Match the camera and canvas to the container (call after showing it). */
  resize(): void;
  render(world: GameWorld, alpha: number, frameSeconds: number): void;
}

export function createArenaScene(renderer: GameRenderer): ArenaScene {
  const scene = new THREE.Scene();
  const fog = new THREE.Fog(DAY_HORIZON.clone(), 200, 2200);
  scene.fog = fog;
  const horizon = DAY_HORIZON.clone();
  const zenith = DAY_ZENITH.clone();
  const sky = createSky(horizon, zenith);
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(50, renderer.aspect, 0.5, 5000);
  const hemi = new THREE.HemisphereLight(0xdfe9f0, 0x2a3a44, 1.4);
  const sun = new THREE.DirectionalLight(0xfff2d6, 2);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(100);
  scene.add(hemi, sun);

  const sea = createSea();
  const water: Water = createWater(sea, renderer.preset);
  water.material.uniforms.uSunDirection.value.copy(SUN_DIRECTION);
  scene.add(water.mesh);
  renderer.onPresetChange((preset) => water.applyPreset(preset));

  const schooner = createPlaceholderSchooner();
  schooner.rotation.order = 'YXZ';
  scene.add(schooner);
  let other: THREE.Object3D | undefined;
  let otherId: string | undefined;

  const resize = (): void => {
    camera.aspect = renderer.aspect;
    camera.updateProjectionMatrix();
    renderer.resize();
  };
  window.addEventListener('resize', resize);

  let camDistance = 85;
  renderer.renderer.domElement.addEventListener('wheel', (e) => {
    camDistance = Math.min(Math.max(camDistance * (e.deltaY > 0 ? 1.1 : 0.9), 30), 400);
  });

  const t: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
  const camTarget = new THREE.Vector3();

  return {
    sea,
    resize,
    setup(world, kind, daylight) {
      const storm = kind === 'storm';
      const waves = testBaySea(storm ? 2.2 : 1);
      Object.assign(sea, createSea(waves), { time: sea.time });
      water.setWaves(sea);

      horizon.copy(NIGHT_HORIZON).lerp(storm ? STORM_HORIZON : DAY_HORIZON, daylight);
      zenith.copy(NIGHT_ZENITH).lerp(storm ? STORM_ZENITH : DAY_ZENITH, daylight);
      fog.color.copy(horizon);
      fog.near = storm ? 60 : 200;
      fog.far = storm ? 750 : 600 + 1600 * daylight;
      water.material.uniforms.uSkyColor.value.copy(horizon);
      hemi.intensity = 0.25 + 1.15 * daylight;
      sun.intensity = storm ? 0.3 : 0.1 + 1.9 * daylight;

      if (other) scene.remove(other);
      other = undefined;
      otherId = undefined;
      const target = [...world].find((e) => e.transform && !e.playerControlled);
      if (target) {
        other = createContactModel(kind);
        other.rotation.order = 'YXZ';
        if (daylight < 0.6) {
          // Running lights cut through the night fog, so a ship reads before its hull.
          const lamp = new THREE.Mesh(
            new THREE.SphereGeometry(1.6, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog: false }),
          );
          lamp.position.y = 14;
          other.add(lamp);
        }
        scene.add(other);
        otherId = target.id;
      }
    },
    render(world, alpha, frameSeconds) {
      for (const e of world) {
        if (!e.transform) continue;
        interpolateTransform(e, alpha, t);
        const object = e.playerControlled ? schooner : e.id === otherId ? other : undefined;
        if (!object) continue;
        object.position.set(t.position.x, t.position.y, t.position.z);
        object.rotation.set(t.pitch ?? 0, -t.heading, t.roll ?? 0);
        if (e.playerControlled) {
          // Chase camera: behind and above the stern, looking a little ahead.
          camTarget.set(
            t.position.x + Math.sin(t.heading) * 20,
            4,
            t.position.z - Math.cos(t.heading) * 20,
          );
          const want = new THREE.Vector3(
            t.position.x - Math.sin(t.heading) * camDistance,
            camDistance * 0.32,
            t.position.z + Math.cos(t.heading) * camDistance,
          );
          camera.position.lerp(want, Math.min(frameSeconds * 3, 1));
          camera.lookAt(camTarget);
        }
      }
      sky.position.copy(camera.position);
      water.update(camera, sea.time);
      renderer.render(scene, camera, frameSeconds);
    },
  };
}

/** Box-built stand-ins; plan 14's assets replace them. Bow toward -z, waterline y = 0. */
function createContactModel(kind: ContactKind): THREE.Object3D {
  if (kind === 'derelict') {
    // A dismasted hulk: the schooner hull, sails struck, listing hard.
    const hulk = createPlaceholderSchooner();
    const sails = hulk.children[1];
    if (sails) hulk.remove(sails);
    const group = new THREE.Group();
    hulk.rotation.z = 0.35;
    hulk.position.y = -0.8;
    group.add(hulk);
    return group;
  }
  const spec = {
    freighter: {
      length: 90,
      beam: 13,
      hull: 0x6b2a20,
      upper: 0x1f1f1f,
      cabin: 0xe8e0cc,
      funnel: 0x1a1a1a,
    },
    steamer: {
      length: 55,
      beam: 10,
      hull: 0xe8e4da,
      upper: 0xe8e4da,
      cabin: 0xd8cfb8,
      funnel: 0xb03a2e,
    },
    cutter: {
      length: 50,
      beam: 9,
      hull: 0xf0efea,
      upper: 0xf0efea,
      cabin: 0xc9b98f,
      funnel: 0xc8a050,
    },
    tug: {
      length: 20,
      beam: 5.5,
      hull: 0x2d3a33,
      upper: 0x2d3a33,
      cabin: 0xe2d8c2,
      funnel: 0x1a1a1a,
    },
    storm: { length: 1, beam: 1, hull: 0, upper: 0, cabin: 0, funnel: 0 },
  }[kind];
  const mat = (color: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 });
  const group = new THREE.Group();
  const box = (
    w: number,
    h: number,
    d: number,
    color: number,
    x: number,
    y: number,
    z: number,
  ): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  const { length: L, beam: B } = spec;
  box(B, 3, L, spec.hull, 0, -0.5, 0);
  box(B * 0.96, 2, L * 0.98, spec.upper, 0, 2, 0);
  // Pointed bow.
  const bow = new THREE.Mesh(new THREE.ConeGeometry(B / 2, B * 1.2, 4), mat(spec.upper));
  bow.rotation.set(-Math.PI / 2, Math.PI / 4, 0);
  bow.scale.set(1, 1, 0.5);
  bow.position.set(0, 1, -L / 2 - B * 0.5);
  group.add(bow);
  if (kind === 'freighter') {
    // Laker profile: pilothouse forward, engine house and funnel aft.
    box(B * 0.7, 4, 6, spec.cabin, 0, 5, -L / 2 + 6);
    box(B * 0.8, 4, 12, spec.cabin, 0, 5, L / 2 - 9);
    box(2.2, 9, 2.2, spec.funnel, 0, 11, L / 2 - 8);
  } else {
    box(B * 0.7, 3.5, L * 0.35, spec.cabin, 0, 4.7, L * 0.05);
    box(B * 0.25, 7, B * 0.25, spec.funnel, 0, 9, L * 0.08);
  }
  return group;
}
