import * as THREE from 'three';
import type { Transform } from '../../gameplay/ecs';
import type { FollowCamera } from '../../gameplay/onfoot/camera';
import type { BoxCollider, CylinderCollider } from '../../gameplay/onfoot/colliders';
import type { CharacterState, ControllerParams } from '../../gameplay/onfoot/controller';
import type { SpikeChunk } from './chunk';

/**
 * Greybox view for spike S5: vertex-colored terrain (sand, grass, and red where the
 * slope is too steep to walk), translucent water, every collider drawn through two
 * instanced meshes, and a capsule for the character.
 */
export function createSpikeScene(
  container: HTMLElement,
  chunk: SpikeChunk,
  character: CharacterState,
  previous: Transform,
  camera: FollowCamera,
  params: ControllerParams,
): { renderer: THREE.WebGLRenderer; render(alpha: number, frameSeconds: number): void } {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9bcc8);
  scene.fog = new THREE.Fog(0xa9bcc8, 40, 140);

  const view = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.05,
    400,
  );
  scene.add(new THREE.HemisphereLight(0xe4edf2, 0x3a4a3a, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  // Terrain from the heightfield.
  const g = chunk.ground;
  const terrainGeo = new THREE.PlaneGeometry(g.width, g.depth, g.samplesX - 1, g.samplesZ - 1);
  terrainGeo.rotateX(-Math.PI / 2);
  terrainGeo.translate(g.originX + g.width / 2, 0, g.originZ + g.depth / 2);
  const pos = terrainGeo.attributes['position'] as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xc8b98a);
  const grass = new THREE.Color(0x5f7d45);
  const steep = new THREE.Color(0xa0473a);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const z = pos.getZ(k);
    const h = g.heightAt(x, z);
    pos.setY(k, h);
    if (g.slopeAt(x, z) > params.maxSlope) c.copy(steep);
    else c.copy(sand).lerp(grass, THREE.MathUtils.smoothstep(h, 0.8, 2.2));
    c.toArray(colors, k * 3);
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  scene.add(
    new THREE.Mesh(
      terrainGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
    ),
  );

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({
      color: 0x2d5468,
      roughness: 0.3,
      transparent: true,
      opacity: 0.75,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = chunk.waterLevel;
  scene.add(water);

  // Colliders, plus one box per occupied building cell.
  const boxes: BoxCollider[] = [];
  const cylinders: CylinderCollider[] = [];
  for (const col of chunk.colliders.colliders()) {
    if (col.kind === 'box') boxes.push(col);
    else cylinders.push(col);
  }
  for (const grid of chunk.colliders.occupancyGrids()) {
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const h = grid.get(col, row);
        if (h <= 0) continue;
        const half = grid.cellSize / 2;
        boxes.push({
          kind: 'box',
          x: grid.originX + col * grid.cellSize + half,
          z: grid.originZ + row * grid.cellSize + half,
          halfX: half,
          halfZ: half,
          yaw: 0,
          minY: grid.baseY,
          maxY: grid.baseY + h,
        });
      }
    }
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const boxMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }),
    Math.max(boxes.length, 1),
  );
  boxes.forEach((b, k) => {
    q.setFromAxisAngle(up, b.yaw);
    m.compose(
      new THREE.Vector3(b.x, (b.minY + b.maxY) / 2, b.z),
      q,
      new THREE.Vector3(b.halfX * 2, b.maxY - b.minY, b.halfZ * 2),
    );
    boxMesh.setMatrixAt(k, m);
    // Steppable (≤ step height above its base) vs. blocking, by color.
    const tall = b.maxY - b.minY > 1.5;
    boxMesh.setColorAt(
      k,
      c.set(tall ? 0x8a8378 : b.minY < 0.95 && b.maxY < 1.3 ? 0x7a5a3a : 0xa07a4f),
    );
  });
  boxMesh.count = boxes.length;
  scene.add(boxMesh);

  const cylMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9, flatShading: true }),
    Math.max(cylinders.length, 1),
  );
  cylinders.forEach((cy, k) => {
    m.compose(
      new THREE.Vector3(cy.x, (cy.minY + cy.maxY) / 2, cy.z),
      q.identity(),
      new THREE.Vector3(cy.radius, cy.maxY - cy.minY, cy.radius),
    );
    cylMesh.setMatrixAt(k, m);
  });
  cylMesh.count = cylinders.length;
  scene.add(cylMesh);

  // The character: a capsule sized to the controller, with a nose showing its heading.
  const body = new THREE.Group();
  const capsuleMat = new THREE.MeshStandardMaterial({ color: 0x2f3b55, roughness: 0.6 });
  const standGeo = new THREE.CapsuleGeometry(
    params.radius,
    params.standHeight - 2 * params.radius,
    4,
    12,
  );
  const crouchGeo = new THREE.CapsuleGeometry(
    params.radius,
    params.crouchHeight - 2 * params.radius,
    4,
    12,
  );
  const capsule = new THREE.Mesh(standGeo, capsuleMat);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xe0c070 }),
  );
  body.add(capsule, nose);
  scene.add(body);

  const onResize = (): void => {
    view.aspect = container.clientWidth / container.clientHeight;
    view.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);

  const feet = { x: 0, y: 0, z: 0 };
  return {
    renderer,
    render(alpha, frameSeconds) {
      const p = character.position;
      const pr = previous.position;
      const x = pr.x + (p.x - pr.x) * alpha;
      const y = pr.y + (p.y - pr.y) * alpha;
      const z = pr.z + (p.z - pr.z) * alpha;
      const dh = Math.atan2(
        Math.sin(character.heading - previous.heading),
        Math.cos(character.heading - previous.heading),
      );
      const heading = previous.heading + dh * alpha;

      const height = character.crouching ? params.crouchHeight : params.standHeight;
      capsule.geometry = character.crouching ? crouchGeo : standGeo;
      capsule.position.y = height / 2;
      nose.position.set(0, height * 0.8, -params.radius);
      body.position.set(x, y, z);
      // Heading is clockwise from north; three.js yaw is counter-clockwise.
      body.rotation.y = -heading;

      feet.x = x;
      feet.y = y;
      feet.z = z;
      camera.update(feet, character.crouching, chunk, frameSeconds);
      view.position.set(camera.position.x, camera.position.y, camera.position.z);
      view.lookAt(camera.target.x, camera.target.y, camera.target.z);
      renderer.render(scene, view);
    },
  };
}
