import * as THREE from 'three';
import type { DistrictDef } from '../../../data/schemas/districts';
import type { CharacterState, ControllerParams } from '../../gameplay/onfoot/controller';
import { createDistrictView, type DistrictView } from '../../render/district/district-view';
import { createLightingSample, sampleLighting } from '../../render/style/lighting-luts';
import { StyleLighting } from '../../render/style/stylized-material';
import type { DistrictModel } from '../../sim/district/district';
import type { NavMesh } from '../../sim/district/navmesh';
import { moonAt, sunAt } from '../../sim/weather/celestial';
import { zoneDef } from '../../sim/terrain/zones';
import { findHarbor, harborZoneId } from '../../sim/harbors';

/**
 * The district dev page's scene (Phase 7 piece C): the district view, sky and key light
 * from the game clock (sun or moon, turned into the district's frame), fog, a capsule for
 * the player and the test guards, and a navmesh overlay. Dev only.
 */

const DEG = Math.PI / 180;

export interface DistrictScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  view: DistrictView;
  /** 0 by day, 1 at night. */
  readonly night: number;
  /** The moon's lit fraction while it's up, else 0. */
  readonly moonPhase: number;
  setModel(model: DistrictModel): void;
  setNav(nav: NavMesh | undefined): void;
  showNav(on: boolean): void;
  setFog(on: boolean): void;
  /** Sky and light for the game clock. */
  setTime(gameSeconds: number): void;
  /** Places the player's capsule (feet) and heading (clockwise from north). */
  setPlayer(x: number, y: number, z: number, heading: number, crouching: boolean, visible: boolean): void;
  setGuards(positions: readonly { x: number; y: number; z: number; heading: number }[]): void;
  render(focus: THREE.Vector3): void;
}

export function createDistrictScene(
  container: HTMLElement,
  def: DistrictDef,
  model: DistrictModel,
  params: ControllerParams,
): DistrictScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color();
  scene.fog = new THREE.Fog(0x8a9aa6, 60, 320);
  scene.background = new THREE.Color();
  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1200);

  const lighting = new StyleLighting();
  let view = createDistrictView(model, lighting);
  scene.add(view.group);

  // The harbor's seaward bearing: a zone direction turns into the district by this much.
  const harbor = findHarbor(def.harbor);
  const piece = harbor ? zoneDef(harborZoneId(harbor)).setPieces.find((p) => p.id === harbor.setPiece) : undefined;
  const bearing = (piece?.bearingDeg ?? 0) * DEG;

  // The player and guards as capsules (piece B's characters replace them).
  const capsule = (color: number, height: number): THREE.Mesh => {
    const m = new THREE.Mesh(
      new THREE.CapsuleGeometry(params.radius, height - 2 * params.radius, 4, 10),
      new THREE.MeshLambertMaterial({ color }),
    );
    return m;
  };
  const player = new THREE.Group();
  const stand = capsule(0x2f3b55, params.standHeight);
  const crouch = capsule(0x2f3b55, params.crouchHeight);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.3), new THREE.MeshLambertMaterial({ color: 0xe0c070 }));
  player.add(stand, crouch, nose);
  scene.add(player);
  const playerLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  scene.add(playerLight);

  const guardMesh = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(params.radius, params.standHeight - 2 * params.radius, 3, 8).translate(0, params.standHeight / 2, 0),
    new THREE.MeshLambertMaterial({ color: 0x8a2c2c, emissive: 0x220808 }),
    32,
  );
  guardMesh.count = 0;
  guardMesh.frustumCulled = false;
  scene.add(guardMesh);

  let navLines: THREE.LineSegments | undefined;
  let navOn = false;
  const sample = createLightingSample();
  let night = 0;
  let moonPhase = 0;
  let fogOn = false;

  const onResize = (): void => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const v3 = new THREE.Vector3();

  return {
    renderer,
    scene,
    camera,
    get view() {
      return view;
    },
    set view(v) {
      view = v;
    },
    get night() {
      return night;
    },
    get moonPhase() {
      return moonPhase;
    },
    setModel(next) {
      scene.remove(view.group);
      view.dispose();
      view = createDistrictView(next, lighting);
      scene.add(view.group);
    },
    setNav(nav) {
      if (navLines) {
        scene.remove(navLines);
        navLines.geometry.dispose();
        navLines = undefined;
      }
      if (!nav) return;
      const pts: number[] = [];
      for (let i = 0; i < nav.polyCount; i++) {
        const vs = nav.polys[i]!;
        for (let k = 0; k < vs.length; k++) {
          const a = vs[k]!;
          const b = vs[(k + 1) % vs.length]!;
          pts.push(nav.vx[a]!, nav.vy[a]! + 0.08, nav.vz[a]!, nav.vx[b]!, nav.vy[b]! + 0.08, nav.vz[b]!);
        }
      }
      for (const l of nav.links) pts.push(l.pa.x, l.pa.y + 0.3, l.pa.z, l.pb.x, l.pb.y + 0.3, l.pb.z);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      navLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x3cf0a0, depthTest: true }));
      navLines.visible = navOn;
      scene.add(navLines);
    },
    showNav(on) {
      navOn = on;
      if (navLines) navLines.visible = on;
    },
    setFog(on) {
      fogOn = on;
    },
    setTime(gameSeconds) {
      const sun = sunAt(gameSeconds);
      const moon = moonAt(gameSeconds);
      moonPhase = moon.elevationRad > 0 ? moon.illumination01 : 0;
      const elev = sun.elevationRad / DEG;
      sampleLighting(elev, { cloud01: fogOn ? 0.6 : 0.15, storm01: 0, fog01: fogOn ? 1 : 0 }, sample);
      night = THREE.MathUtils.smoothstep(-elev, -4, 6);
      const toLocal = (b: { azimuthRad: number; elevationRad: number }): THREE.Vector3 => {
        const az = b.azimuthRad - bearing;
        const c = Math.cos(b.elevationRad);
        return new THREE.Vector3(c * Math.sin(az), Math.sin(b.elevationRad), -c * Math.cos(az));
      };
      const u = lighting.uniforms;
      const hemi = Math.max(sample.hemi, 0.08);
      u.uSkyAmbient.value.copy(sample.hemiSky).multiplyScalar(hemi * 0.55);
      u.uGroundAmbient.value.copy(sample.hemiGround).multiplyScalar(hemi * 0.45);
      // Starlight and sky glow: even a moonless night keeps shapes faintly readable.
      u.uSkyAmbient.value.r = Math.max(u.uSkyAmbient.value.r, 0.045);
      u.uSkyAmbient.value.g = Math.max(u.uSkyAmbient.value.g, 0.055);
      u.uSkyAmbient.value.b = Math.max(u.uSkyAmbient.value.b, 0.085);
      u.uGroundAmbient.value.r = Math.max(u.uGroundAmbient.value.r, 0.02);
      u.uGroundAmbient.value.g = Math.max(u.uGroundAmbient.value.g, 0.022);
      u.uGroundAmbient.value.b = Math.max(u.uGroundAmbient.value.b, 0.03);
      if (sun.elevationRad > -0.05) {
        u.uKeyDirection.value.copy(toLocal(sun)).normalize();
        u.uKeyColor.value.setHex(0xfff0d8).multiplyScalar(THREE.MathUtils.smoothstep(elev, -3, 12) * 1.1);
      } else if (moon.elevationRad > 0) {
        u.uKeyDirection.value.copy(toLocal(moon)).normalize();
        u.uKeyColor.value.setHex(0x9fb4d6).multiplyScalar(0.05 + 0.28 * moon.illumination01);
      } else {
        u.uKeyColor.value.setRGB(0, 0, 0);
      }
      u.uRimColor.value.setRGB(0, 0, 0);
      fogColor.copy(sample.horizon);
      (scene.background as THREE.Color).copy(fogOn ? sample.horizon : sample.zenith.clone().lerp(sample.horizon, 0.35));
      const fog = scene.fog as THREE.Fog;
      fog.color.copy(fogColor);
      fog.near = fogOn ? 6 : 80;
      fog.far = fogOn ? 70 : 420;
      playerLight.intensity = 0.4 + hemi;
    },
    setPlayer(x, y, z, heading, crouching, visible) {
      player.visible = visible;
      const h = crouching ? params.crouchHeight : params.standHeight;
      stand.visible = !crouching;
      crouch.visible = crouching;
      (crouching ? crouch : stand).position.y = h / 2;
      nose.position.set(0, h * 0.8, -params.radius);
      player.position.set(x, y, z);
      player.rotation.y = -heading;
    },
    setGuards(list) {
      guardMesh.count = Math.min(list.length, 32);
      for (let k = 0; k < guardMesh.count; k++) {
        const gd = list[k]!;
        q.setFromAxisAngle(up, -gd.heading);
        m4.compose(v3.set(gd.x, gd.y, gd.z), q, one);
        guardMesh.setMatrixAt(k, m4);
      }
      guardMesh.instanceMatrix.needsUpdate = true;
    },
    render(focus) {
      view.update(focus, night);
      renderer.render(scene, camera);
    },
  };
}
