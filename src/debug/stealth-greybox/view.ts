import * as THREE from 'three';
import type { Transform } from '../../gameplay/ecs';
import type { FollowCamera } from '../../gameplay/onfoot/camera';
import type { CharacterState, ControllerParams } from '../../gameplay/onfoot/controller';
import type { Lamp } from '../../gameplay/onfoot/light';
import { isDown, type Guard, type GuardState } from '../../gameplay/onfoot/stealth';
import type { Projected } from '../../ui/hud/stealth-model';
import type { GreyboxDistrict } from './district';

/**
 * The stealth greybox's view (dev only): plain boxes, lamp posts with fake light pools on
 * the ground (plan 08 §14: emissive plus pools, ≤ 4 real lights), capsules for the player
 * and the guards, the guards' lanterns, and optional sight cones. The night is drawn by
 * dimming the sky light to the same ambient level the perception uses.
 */

const STATE_COLOR: Record<GuardState, number> = {
  patrol: 0x6d7f8f,
  suspicious: 0xd8b13a,
  alerted: 0xd0402f,
  search: 0xe08a2a,
  fetch: 0xe08a2a,
  return: 0x8c9aa6,
  distracted: 0xc9b06a,
  drunk: 0x8d5aa8,
  unconscious: 0x3c3c3c,
  bound: 0x3c3c3c,
  bribed: 0x4c9a5a,
  dead: 0x1d1d1d,
};

function poolTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,214,140,1)');
    grad.addColorStop(0.5, 'rgba(255,200,120,0.32)');
    grad.addColorStop(1, 'rgba(255,190,110,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface GreyboxView {
  renderer: THREE.WebGLRenderer;
  showCones: boolean;
  /** The sky's light on the ground, 0–1 (the perception's ambient), and fog. */
  setNight(ambient01: number, fogM: number): void;
  setGuards(guards: readonly Guard[]): void;
  render(alpha: number, frameSeconds: number, playerLantern: Lamp | undefined): void;
  project(p: { x: number; y: number; z: number }): Projected;
  size(): { width: number; height: number };
}

export function createGreyboxView(
  container: HTMLElement,
  district: GreyboxDistrict,
  character: CharacterState,
  previous: Transform,
  camera: FollowCamera,
  params: ControllerParams,
): GreyboxView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const dayColor = new THREE.Color(0xa9bcc8);
  const nightColor = new THREE.Color(0x0b1220);
  scene.background = dayColor.clone();
  scene.fog = new THREE.Fog(0xa9bcc8, 30, 160);

  const view = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.05,
    400,
  );
  const hemi = new THREE.HemisphereLight(0xc8d6e8, 0x2a3138, 1.2);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xb8c8ff, 0.6);
  moon.position.set(-30, 60, 20);
  scene.add(moon);

  // Ground and water.
  const b = district.bounds;
  const land = new THREE.Mesh(
    new THREE.PlaneGeometry(b.maxX - b.minX, 20 - b.minZ),
    new THREE.MeshStandardMaterial({ color: 0x7a6e5c, roughness: 1 }),
  );
  land.rotation.x = -Math.PI / 2;
  land.position.set((b.minX + b.maxX) / 2, 1.5, (b.minZ + 20) / 2);
  scene.add(land);
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 16),
    new THREE.MeshStandardMaterial({ color: 0x8f877a, roughness: 1 }),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(13, 1.51, 6);
  scene.add(yard);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x1f3d4c, roughness: 0.35 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = district.waterLevel;
  scene.add(water);

  // Every box through one instanced mesh, coloured by kind.
  const boxMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }),
    district.boxes.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  district.boxes.forEach((bx, k) => {
    q.setFromAxisAngle(up, bx.yaw);
    m.compose(
      new THREE.Vector3(bx.x, (bx.minY + bx.maxY) / 2, bx.z),
      q,
      new THREE.Vector3(bx.halfX * 2, bx.maxY - bx.minY, bx.halfZ * 2),
    );
    boxMesh.setMatrixAt(k, m);
    const h = bx.maxY - bx.minY;
    c.set(h > 4 ? 0x8a8378 : h > 2.2 ? 0x6f6559 : bx.maxY <= 1.6 ? 0x6b5236 : 0x9a7546);
    boxMesh.setColorAt(k, c);
  });
  scene.add(boxMesh);

  // Lamps: posts, flames and pools on the ground.
  const lamps = district.lamps.lamps;
  const pool = poolTexture();
  const posts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.07, 0.09, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x2d2a26 }),
    lamps.length,
  );
  const flames: THREE.Mesh[] = [];
  const pools: THREE.Mesh[] = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd58a });
  const darkFlameMat = new THREE.MeshBasicMaterial({ color: 0x3a3630 });
  const poolMat = new THREE.MeshBasicMaterial({
    map: pool,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  lamps.forEach((l, k) => {
    const h = l.y - 1.5;
    m.compose(new THREE.Vector3(l.x, 1.5 + h / 2, l.z), q.identity(), new THREE.Vector3(1, h, 1));
    posts.setMatrixAt(k, m);
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      l.lit ? flameMat : darkFlameMat,
    );
    flame.position.set(l.x, l.y, l.z);
    scene.add(flame);
    flames.push(flame);
    if (l.lit) {
      const p = new THREE.Mesh(
        new THREE.PlaneGeometry(l.radiusM * 2, l.radiusM * 2),
        poolMat.clone(),
      );
      p.rotation.x = -Math.PI / 2;
      p.position.set(l.x, 1.53, l.z);
      (p.material as THREE.MeshBasicMaterial).opacity = l.intensity;
      scene.add(p);
      pools.push(p);
    }
  });
  scene.add(posts);
  // A few real lights at the lamps nearest the player.
  const real = Array.from({ length: 4 }, () => {
    const pl = new THREE.PointLight(0xffc98a, 0, 12, 1.6);
    scene.add(pl);
    return pl;
  });

  // The player.
  const capsuleGeo = (h: number, r: number) => new THREE.CapsuleGeometry(r, h - 2 * r, 4, 10);
  const standGeo = capsuleGeo(params.standHeight, params.radius);
  const crouchGeo = capsuleGeo(params.crouchHeight, params.radius);
  const playerMesh = new THREE.Mesh(
    standGeo,
    new THREE.MeshStandardMaterial({ color: 0x2f4d7a, roughness: 0.6 }),
  );
  scene.add(playerMesh);
  const playerLamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), flameMat);
  const playerPool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolMat.clone());
  playerPool.rotation.x = -Math.PI / 2;
  scene.add(playerLamp, playerPool);

  // Guards: a capsule, a nose, a lantern and its pool, and a cone on the ground.
  interface GuardMesh {
    body: THREE.Mesh;
    nose: THREE.Mesh;
    lamp: THREE.Mesh;
    pool: THREE.Mesh;
    cone: THREE.Mesh;
    edge: THREE.Mesh;
    mat: THREE.MeshStandardMaterial;
    coneMat: THREE.MeshBasicMaterial;
  }
  let guards: readonly Guard[] = [];
  let guardMeshes: GuardMesh[] = [];
  const guardGeo = capsuleGeo(1.75, 0.3);
  const downGeo = new THREE.CapsuleGeometry(0.28, 1.1, 4, 8);
  downGeo.rotateZ(Math.PI / 2);
  const noseGeo = new THREE.BoxGeometry(0.12, 0.12, 0.3);
  const noseMat = new THREE.MeshStandardMaterial({ color: 0xe0c070 });

  const self: GreyboxView = {
    renderer,
    showCones: true,
    setNight(ambient01, fogM) {
      const t = Math.min(1, Math.max(0, ambient01));
      hemi.intensity = 0.08 + 1.3 * t;
      moon.intensity = 0.15 + 1.2 * t;
      // The eye adapts less than the gem says: keep a moonlit night looking like night.
      const bg = nightColor.clone().lerp(dayColor, t * t);
      scene.background = bg;
      const f = scene.fog as THREE.Fog;
      f.color.copy(bg);
      f.near = Math.min(30, fogM * 0.1);
      f.far = Math.max(25, Math.min(220, fogM * 0.9));
      for (const p of pools) p.visible = t < 0.6;
    },
    setGuards(gs) {
      for (const gm of guardMeshes) {
        scene.remove(gm.body, gm.nose, gm.lamp, gm.pool, gm.cone, gm.edge);
      }
      guards = gs;
      guardMeshes = gs.map((g) => {
        const mat = new THREE.MeshStandardMaterial({ color: STATE_COLOR[g.state], roughness: 0.6 });
        const body = new THREE.Mesh(guardGeo, mat);
        const nose = new THREE.Mesh(noseGeo, noseMat);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), flameMat);
        const gp = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolMat.clone());
        gp.rotation.x = -Math.PI / 2;
        const sight = g.type.sight;
        const coneMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
        });
        const fov = (sight.fovDeg * Math.PI) / 180;
        const cone = new THREE.Mesh(
          new THREE.CircleGeometry(sight.rangeM, 24, Math.PI / 2 - fov / 2, fov),
          coneMat,
        );
        cone.rotation.x = -Math.PI / 2;
        const per = (sight.peripheralDeg * Math.PI) / 180;
        const edge = new THREE.Mesh(
          new THREE.CircleGeometry(sight.rangeM * 0.5, 24, Math.PI / 2 - per / 2, per),
          coneMat,
        );
        edge.rotation.x = -Math.PI / 2;
        scene.add(body, nose, lamp, gp, cone, edge);
        return { body, nose, lamp, pool: gp, cone, edge, mat, coneMat };
      });
    },
    project(p) {
      const v = new THREE.Vector3(p.x, p.y, p.z);
      const cam = v.clone().applyMatrix4(view.matrixWorldInverse);
      v.project(view);
      const w = container.clientWidth;
      const h = container.clientHeight;
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind: cam.z > 0 };
    },
    size() {
      return { width: container.clientWidth, height: container.clientHeight };
    },
    render(alpha, frameSeconds, playerLantern) {
      const p = character.position;
      const pr = previous.position;
      const x = pr.x + (p.x - pr.x) * alpha;
      const y = pr.y + (p.y - pr.y) * alpha;
      const z = pr.z + (p.z - pr.z) * alpha;
      const height = character.crouching ? params.crouchHeight : params.standHeight;
      playerMesh.geometry = character.crouching ? crouchGeo : standGeo;
      playerMesh.position.set(x, y + height / 2, z);
      playerMesh.rotation.y = -character.heading;
      playerLamp.visible = Boolean(playerLantern?.lit);
      playerPool.visible = playerLamp.visible;
      if (playerLantern?.lit) {
        playerLamp.position.set(x + 0.3, y + 1.0, z);
        playerPool.position.set(x, 1.535, z);
        playerPool.scale.set(playerLantern.radiusM * 2, playerLantern.radiusM * 2, 1);
      }

      guards.forEach((g, k) => {
        const gm = guardMeshes[k];
        if (!gm) return;
        const gx = g.previous.x + (g.body.position.x - g.previous.x) * alpha;
        const gy = g.previous.y + (g.body.position.y - g.previous.y) * alpha;
        const gz = g.previous.z + (g.body.position.z - g.previous.z) * alpha;
        const down = isDown(g.state);
        gm.body.geometry = down ? downGeo : guardGeo;
        gm.body.position.set(gx, gy + (down ? 0.3 : 0.875), gz);
        gm.body.rotation.y = -g.body.heading;
        gm.mat.color.set(STATE_COLOR[g.state]);
        gm.nose.visible = !down;
        gm.nose.position.set(
          gx + Math.sin(g.body.heading) * 0.3,
          gy + 1.45,
          gz - Math.cos(g.body.heading) * 0.3,
        );
        gm.nose.rotation.y = -g.body.heading;
        const lit = Boolean(g.lantern?.lit);
        gm.lamp.visible = lit;
        gm.pool.visible = lit;
        if (lit && g.lantern) {
          gm.lamp.position.set(
            gx + Math.cos(g.body.heading) * 0.35,
            gy + 1.0,
            gz + Math.sin(g.body.heading) * 0.35,
          );
          gm.pool.position.set(gx, 1.54, gz);
          gm.pool.scale.set(g.lantern.radiusM * 2, g.lantern.radiusM * 2, 1);
        }
        const cones = self.showCones && !down && g.state !== 'bribed';
        gm.cone.visible = cones;
        gm.edge.visible = cones;
        // CircleGeometry's 0 rad is +x; rotate so the fan's middle points along the heading.
        for (const mesh of [gm.cone, gm.edge]) {
          mesh.position.set(gx, gy + 0.06, gz);
          mesh.rotation.set(-Math.PI / 2, 0, -g.body.heading);
        }
        gm.coneMat.color.set(STATE_COLOR[g.state]);
        gm.coneMat.opacity = g.state === 'alerted' ? 0.16 : 0.09;
      });

      // The four lamps nearest the player get a real light.
      const near = [...lamps]
        .filter((l) => l.lit)
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
      real.forEach((pl, k) => {
        const l = near[k];
        if (!l) {
          pl.intensity = 0;
          return;
        }
        pl.position.set(l.x, l.y, l.z);
        pl.distance = l.radiusM * 1.6;
        pl.intensity = (scene.background as THREE.Color).r < 0.3 ? 6 * l.intensity : 0;
      });

      camera.update({ x, y, z }, character.crouching, district, frameSeconds);
      view.position.set(camera.position.x, camera.position.y, camera.position.z);
      view.lookAt(camera.target.x, camera.target.y, camera.target.z);
      view.updateMatrixWorld();
      renderer.render(scene, view);
    },
  };

  const onResize = (): void => {
    view.aspect = container.clientWidth / container.clientHeight;
    view.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);
  return self;
}
